const DiscoveryEngine = require('./DiscoveryEngine');
const User = require('../models/User');
const Account = require('../models/Account');
const { createComponentLogger } = require('../utils/logger');
const { registry } = require('../platforms');

const logger = createComponentLogger('discovery-service');

/**
 * DiscoveryService - High-level service for account discovery operations
 * 
 * Provides a user-friendly interface to the DiscoveryEngine with additional
 * features like job management, scheduling, and result caching.
 */
class DiscoveryService {
  constructor(config = {}) {
    this.engine = new DiscoveryEngine(config);
    this.activeJobs = new Map();
    this.jobHistory = new Map();
    
    this.config = {
      maxActiveJobs: 10,
      jobTimeoutMs: 300000, // 5 minutes
      autoCleanupIntervalMs: 60000, // 1 minute
      ...config
    };
    
    // Start cleanup interval
    this.startAutoCleanup();
  }

  /**
   * Start account discovery for a user
   * @param {string} userId - User ID
   * @param {Object} options - Discovery options
   * @returns {Promise<Object>} Discovery job information
   */
  async startDiscovery(userId, options = {}) {
    logger.info('Starting account discovery', { userId });
    
    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    
    // Check for active jobs
    if (this.activeJobs.has(userId)) {
      const existingJob = this.activeJobs.get(userId);
      logger.warn('Discovery already in progress for user', {
        userId,
        jobId: existingJob.id,
        startedAt: existingJob.startedAt
      });
      
      return {
        jobId: existingJob.id,
        status: 'in_progress',
        message: 'Discovery already in progress',
        startedAt: existingJob.startedAt
      };
    }
    
    // Check active job limit
    if (this.activeJobs.size >= this.config.maxActiveJobs) {
      throw new Error('Maximum number of concurrent discovery jobs reached');
    }
    
    // Create job
    const jobId = this.generateJobId();
    const job = {
      id: jobId,
      userId,
      status: 'starting',
      startedAt: new Date(),
      options,
      progress: {
        step: 'initializing',
        percentage: 0,
        message: 'Preparing discovery...'
      }
    };
    
    this.activeJobs.set(userId, job);
    
    // Start discovery asynchronously
    this.executeDiscovery(job).catch(error => {
      logger.error('Discovery execution failed', {
        jobId,
        userId,
        error: error.message
      });
    });
    
    return {
      jobId,
      status: 'in_progress',
      message: 'Discovery started successfully',
      startedAt: job.startedAt
    };
  }

  /**
   * Get discovery job status
   * @param {string} jobId - Job ID
   * @returns {Object} Job status information
   */
  getJobStatus(jobId) {
    // Check active jobs
    for (const [userId, job] of this.activeJobs) {
      if (job.id === jobId) {
        return {
          jobId,
          userId,
          status: job.status,
          progress: job.progress,
          startedAt: job.startedAt,
          estimatedCompletion: this.estimateCompletion(job)
        };
      }
    }
    
    // Check job history
    const historicalJob = this.jobHistory.get(jobId);
    if (historicalJob) {
      return {
        jobId,
        userId: historicalJob.userId,
        status: historicalJob.status,
        startedAt: historicalJob.startedAt,
        completedAt: historicalJob.completedAt,
        results: historicalJob.results,
        error: historicalJob.error
      };
    }
    
    return null;
  }

  /**
   * Cancel a discovery job
   * @param {string} jobId - Job ID to cancel
   * @returns {boolean} Whether job was cancelled
   */
  cancelJob(jobId) {
    for (const [userId, job] of this.activeJobs) {
      if (job.id === jobId) {
        job.status = 'cancelled';
        job.cancelled = true;
        
        logger.info('Discovery job cancelled', { jobId, userId });
        
        // Move to history
        this.moveJobToHistory(job);
        this.activeJobs.delete(userId);
        
        return true;
      }
    }
    
    return false;
  }

  /**
   * Get discovery history for a user
   * @param {string} userId - User ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Discovery history
   */
  async getDiscoveryHistory(userId, options = {}) {
    const { limit = 10, offset = 0 } = options;
    
    // Get from job history
    const historicalJobs = Array.from(this.jobHistory.values())
      .filter(job => job.userId === userId)
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
      .slice(offset, offset + limit);
    
    // Also get database records (for persistence across restarts)
    const user = await User.findById(userId);
    const dbHistory = [];
    
    if (user?.lastAccountDiscovery) {
      dbHistory.push({
        type: 'database_record',
        completedAt: user.lastAccountDiscovery,
        // Get account counts as a simple metric
        accountsFound: await Account.countDocuments({ userId })
      });
    }
    
    return {
      current: historicalJobs,
      database: dbHistory,
      total: historicalJobs.length + dbHistory.length
    };
  }

  /**
   * Get discovery statistics for a user
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Discovery statistics
   */
  async getDiscoveryStats(userId) {
    const accounts = await Account.find({ userId });
    const user = await User.findById(userId);
    
    // Group accounts by platform
    const platformStats = {};
    let totalConfidence = 0;
    
    accounts.forEach(account => {
      if (!platformStats[account.platform]) {
        platformStats[account.platform] = {
          count: 0,
          avgConfidence: 0,
          detectionMethods: {},
          lastDiscovered: null
        };
      }
      
      const stats = platformStats[account.platform];
      stats.count++;
      totalConfidence += account.confidence || 0;
      
      // Track detection methods
      const method = account.detectionMethod || 'unknown';
      stats.detectionMethods[method] = (stats.detectionMethods[method] || 0) + 1;
      
      // Track latest discovery
      if (!stats.lastDiscovered || account.lastVerified > stats.lastDiscovered) {
        stats.lastDiscovered = account.lastVerified;
      }
    });
    
    // Calculate average confidence per platform
    Object.keys(platformStats).forEach(platform => {
      const platformAccounts = accounts.filter(a => a.platform === platform);
      const totalPlatformConfidence = platformAccounts.reduce((sum, a) => sum + (a.confidence || 0), 0);
      platformStats[platform].avgConfidence = platformAccounts.length > 0 
        ? Math.round(totalPlatformConfidence / platformAccounts.length) 
        : 0;
    });
    
    return {
      totalAccounts: accounts.length,
      platformCount: Object.keys(platformStats).length,
      avgConfidence: accounts.length > 0 ? Math.round(totalConfidence / accounts.length) : 0,
      platformStats,
      lastDiscovery: user?.lastAccountDiscovery,
      discoveryStats: {
        accountsDiscovered: user?.usage?.accountsDiscovered || 0,
        lastBreachCheck: user?.lastBreachCheck
      }
    };
  }

  /**
   * Quick discovery for specific platforms
   * @param {string} userId - User ID
   * @param {Array} platforms - Specific platforms to check
   * @param {Object} options - Discovery options
   * @returns {Promise<Object>} Quick discovery results
   */
  async quickDiscovery(userId, platforms = [], options = {}) {
    logger.info('Starting quick discovery', { userId, platforms });
    
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    
    // Prepare limited identifiers (primary only)
    const identifiers = [
      {
        type: 'email',
        value: user.email,
        confidence: 100,
        source: 'primary_email'
      }
    ];
    
    // Validate platforms
    const validPlatforms = platforms.filter(p => registry.isSupported(p));
    if (validPlatforms.length === 0) {
      throw new Error('No valid platforms specified');
    }
    
    const platformConfigs = validPlatforms.map(p => registry.getPlatformConfig(p));
    
    // Execute quick discovery
    const results = await this.engine.executeDiscoveryAcrossPlatforms(
      identifiers,
      platformConfigs,
      { ...options, quickMode: true }
    );
    
    // Simple analysis
    const accounts = results
      .filter(r => r.success && r.result?.exists)
      .map(r => ({
        platform: r.platform,
        exists: true,
        confidence: r.result.confidence || 70,
        method: r.result.method,
        profileUrl: r.result.profileUrl
      }));
    
    return {
      userId,
      platforms: validPlatforms,
      accountsFound: accounts.length,
      accounts,
      executedAt: new Date()
    };
  }

  /**
   * Verify existing accounts
   * @param {string} userId - User ID
   * @param {Object} options - Verification options
   * @returns {Promise<Object>} Verification results
   */
  async verifyExistingAccounts(userId, options = {}) {
    logger.info('Verifying existing accounts', { userId });
    
    const accounts = await Account.find({ 
      userId,
      status: { $in: ['active', 'unknown'] }
    });
    
    if (accounts.length === 0) {
      return {
        message: 'No accounts to verify',
        verified: 0,
        total: 0
      };
    }
    
    const verificationResults = [];
    
    for (const account of accounts) {
      try {
        const adapter = registry.getAdapter(account.platform);
        const identifier = account.email || account.username;
        
        if (!identifier) {
          logger.warn('Account missing identifier', {
            accountId: account._id,
            platform: account.platform
          });
          continue;
        }
        
        const result = await adapter.verifyAccount(identifier);
        
        // Update account based on verification
        account.lastVerified = new Date();
        account.status = result.exists ? 'active' : 'deleted';
        account.confidence = result.confidence || account.confidence;
        
        if (!result.exists) {
          account.metadata = {
            ...account.metadata,
            verificationNote: 'Account appears to be deleted or inaccessible'
          };
        }
        
        await account.save();
        
        verificationResults.push({
          accountId: account._id,
          platform: account.platform,
          identifier: identifier.substring(0, 5) + '...',
          status: account.status,
          confidence: account.confidence,
          verified: true
        });
      } catch (error) {
        logger.error('Account verification failed', {
          accountId: account._id,
          platform: account.platform,
          error: error.message
        });
        
        verificationResults.push({
          accountId: account._id,
          platform: account.platform,
          verified: false,
          error: error.message
        });
      }
    }
    
    const verifiedCount = verificationResults.filter(r => r.verified).length;
    
    return {
      total: accounts.length,
      verified: verifiedCount,
      results: verificationResults,
      verifiedAt: new Date()
    };
  }

  /**
   * Execute discovery job
   * @param {Object} job - Job object
   * @private
   */
  async executeDiscovery(job) {
    try {
      job.status = 'in_progress';
      job.progress = {
        step: 'discovering',
        percentage: 10,
        message: 'Discovering accounts across platforms...'
      };
      
      // Execute discovery
      const results = await this.engine.discoverUserAccounts(job.userId, job.options);
      
      job.status = 'completed';
      job.completedAt = new Date();
      job.results = results;
      job.progress = {
        step: 'completed',
        percentage: 100,
        message: `Discovered ${results.accountsFound} accounts`
      };
      
      logger.info('Discovery job completed successfully', {
        jobId: job.id,
        userId: job.userId,
        accountsFound: results.accountsFound
      });
      
    } catch (error) {
      job.status = 'failed';
      job.completedAt = new Date();
      job.error = error.message;
      job.progress = {
        step: 'failed',
        percentage: 0,
        message: `Discovery failed: ${error.message}`
      };
      
      logger.error('Discovery job failed', {
        jobId: job.id,
        userId: job.userId,
        error: error.message
      });
    } finally {
      // Move job to history and remove from active jobs
      this.moveJobToHistory(job);
      this.activeJobs.delete(job.userId);
    }
  }

  /**
   * Move job to history
   * @param {Object} job - Job to move
   * @private
   */
  moveJobToHistory(job) {
    this.jobHistory.set(job.id, {
      ...job,
      movedToHistoryAt: new Date()
    });
    
    // Keep history limited to prevent memory leaks
    if (this.jobHistory.size > 100) {
      const oldestKey = this.jobHistory.keys().next().value;
      this.jobHistory.delete(oldestKey);
    }
  }

  /**
   * Estimate job completion time
   * @param {Object} job - Job object
   * @returns {Date} Estimated completion time
   * @private
   */
  estimateCompletion(job) {
    const elapsed = Date.now() - new Date(job.startedAt).getTime();
    const progress = job.progress?.percentage || 0;
    
    if (progress > 0 && progress < 100) {
      const estimatedTotal = (elapsed / progress) * 100;
      const remaining = estimatedTotal - elapsed;
      return new Date(Date.now() + remaining);
    }
    
    return null;
  }

  /**
   * Start auto-cleanup process
   * @private
   */
  startAutoCleanup() {
    setInterval(() => {
      this.cleanupStaleJobs();
    }, this.config.autoCleanupIntervalMs);
  }

  /**
   * Clean up stale jobs
   * @private
   */
  cleanupStaleJobs() {
    const now = Date.now();
    
    for (const [userId, job] of this.activeJobs) {
      const elapsed = now - new Date(job.startedAt).getTime();
      
      if (elapsed > this.config.jobTimeoutMs) {
        logger.warn('Cleaning up stale discovery job', {
          jobId: job.id,
          userId,
          elapsed: `${elapsed}ms`
        });
        
        job.status = 'timeout';
        job.completedAt = new Date();
        job.error = 'Job timed out';
        
        this.moveJobToHistory(job);
        this.activeJobs.delete(userId);
      }
    }
  }

  /**
   * Generate unique job ID
   * @returns {string} Job ID
   * @private
   */
  generateJobId() {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get service statistics
   * @returns {Object} Service statistics
   */
  getServiceStats() {
    return {
      activeJobs: this.activeJobs.size,
      historicalJobs: this.jobHistory.size,
      supportedPlatforms: registry.getSupportedPlatforms().length,
      engineConfig: this.engine.config
    };
  }

  /**
   * Shutdown service gracefully
   */
  async shutdown() {
    logger.info('Shutting down discovery service');
    
    // Cancel all active jobs
    for (const [userId, job] of this.activeJobs) {
      this.cancelJob(job.id);
    }
    
    // Clear intervals and cleanup
    // (In a real implementation, you'd store the interval ID and clear it)
  }
}

module.exports = DiscoveryService;