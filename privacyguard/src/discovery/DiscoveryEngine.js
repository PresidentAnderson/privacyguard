const { registry } = require('../platforms');
const User = require('../models/User');
const Account = require('../models/Account');
const { createComponentLogger, performanceLogger } = require('../utils/logger');
const { retry, sleep } = require('../utils/helpers');
const axios = require('axios');

const logger = createComponentLogger('discovery-engine');

/**
 * AccountDiscoveryEngine - Multi-vector account detection system
 * 
 * Discovers user accounts across platforms using various techniques:
 * 1. Email enumeration via password reset flows
 * 2. Username enumeration across platforms
 * 3. Social graph analysis and correlation
 * 4. Breach data correlation
 * 5. Phone number enumeration
 */
class AccountDiscoveryEngine {
  constructor(config = {}) {
    this.config = {
      maxConcurrentDiscoveries: 5,
      discoveryTimeout: 30000, // 30 seconds per platform
      minConfidenceThreshold: 60,
      maxRetryAttempts: 3,
      delayBetweenRequests: 2000,
      enableBreachDataLookup: true,
      enableSocialGraphAnalysis: true,
      ...config
    };
    
    this.activeDiscoveries = new Map();
    this.discoveryQueue = [];
    this.breachDatabases = [
      'haveibeenpwned',
      'dehashed',
      'intelx'
    ];
  }

  /**
   * Discover accounts for a user across all supported platforms
   * @param {string} userId - User ID
   * @param {Object} discoveryOptions - Discovery configuration
   * @returns {Promise<Object>} Discovery results
   */
  async discoverUserAccounts(userId, discoveryOptions = {}) {
    const timer = performanceLogger.startTimer('full_account_discovery');
    
    try {
      logger.info('Starting account discovery', { userId });
      
      // Get user information
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }
      
      // Prepare discovery identifiers
      const identifiers = this.prepareDiscoveryIdentifiers(user);
      logger.info('Prepared discovery identifiers', { 
        userId, 
        identifierCount: identifiers.length 
      });
      
      // Get platforms to search
      const platforms = this.selectPlatformsForDiscovery(discoveryOptions);
      logger.info('Selected platforms for discovery', {
        userId,
        platformCount: platforms.length
      });
      
      // Execute discovery across all platforms
      const discoveryResults = await this.executeDiscoveryAcrossPlatforms(
        identifiers,
        platforms,
        discoveryOptions
      );
      
      // Analyze and correlate results
      const analysisResults = await this.analyzeDiscoveryResults(
        discoveryResults,
        identifiers
      );
      
      // Save discovered accounts to database
      const savedAccounts = await this.saveDiscoveredAccounts(
        userId,
        analysisResults.accounts
      );
      
      // Update user discovery timestamp
      await User.findByIdAndUpdate(userId, {
        lastAccountDiscovery: new Date()
      });
      
      const duration = timer.end({ userId, accountsFound: savedAccounts.length });
      
      logger.info('Account discovery completed', {
        userId,
        duration: `${duration}ms`,
        accountsFound: savedAccounts.length,
        platformsSearched: platforms.length
      });
      
      return {
        userId,
        discoveryId: this.generateDiscoveryId(),
        startedAt: new Date(Date.now() - duration),
        completedAt: new Date(),
        duration,
        identifiersSearched: identifiers.length,
        platformsSearched: platforms.length,
        accountsFound: savedAccounts.length,
        accounts: savedAccounts,
        analysis: analysisResults,
        rawResults: discoveryOptions.includeRawResults ? discoveryResults : undefined
      };
    } catch (error) {
      timer.end({ userId, error: error.message });
      logger.error('Account discovery failed', {
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Prepare discovery identifiers from user profile
   * @param {Object} user - User object
   * @returns {Array} List of identifiers to search
   */
  prepareDiscoveryIdentifiers(user) {
    const identifiers = [];
    
    // Primary email
    if (user.email) {
      identifiers.push({
        type: 'email',
        value: user.email,
        confidence: 100,
        source: 'primary_email'
      });
    }
    
    // Alternative emails
    if (user.profile?.alternativeEmails) {
      user.profile.alternativeEmails.forEach(email => {
        identifiers.push({
          type: 'email',
          value: email,
          confidence: 90,
          source: 'alternative_email'
        });
      });
    }
    
    // Phone numbers
    if (user.profile?.phoneNumbers) {
      user.profile.phoneNumbers.forEach(phone => {
        identifiers.push({
          type: 'phone',
          value: phone,
          confidence: 85,
          source: 'phone_number'
        });
      });
    }
    
    // Common usernames
    if (user.profile?.commonUsernames) {
      user.profile.commonUsernames.forEach(username => {
        identifiers.push({
          type: 'username',
          value: username,
          confidence: 75,
          source: 'common_username'
        });
      });
    }
    
    // Generate variations from email
    if (user.email) {
      const emailVariations = this.generateEmailVariations(user.email);
      emailVariations.forEach(variation => {
        identifiers.push({
          type: 'username',
          value: variation,
          confidence: 60,
          source: 'email_variation'
        });
      });
    }
    
    // Generate variations from full name
    if (user.profile?.fullName) {
      const nameVariations = this.generateNameVariations(user.profile.fullName);
      nameVariations.forEach(variation => {
        identifiers.push({
          type: 'username',
          value: variation,
          confidence: 50,
          source: 'name_variation'
        });
      });
    }
    
    return identifiers;
  }

  /**
   * Generate email variations for username discovery
   * @param {string} email - Email address
   * @returns {Array} List of username variations
   */
  generateEmailVariations(email) {
    const [localPart] = email.split('@');
    const variations = [localPart];
    
    // Remove numbers
    const withoutNumbers = localPart.replace(/\d+/g, '');
    if (withoutNumbers !== localPart && withoutNumbers.length > 3) {
      variations.push(withoutNumbers);
    }
    
    // Remove dots and underscores
    const normalized = localPart.replace(/[._]/g, '');
    if (normalized !== localPart && normalized.length > 3) {
      variations.push(normalized);
    }
    
    // Add common variations
    variations.push(
      `${localPart}01`,
      `${localPart}1`,
      `${localPart}_`,
      `_${localPart}`,
      `${localPart}.official`
    );
    
    return [...new Set(variations)].filter(v => v.length >= 3);
  }

  /**
   * Generate username variations from full name
   * @param {string} fullName - User's full name
   * @returns {Array} List of username variations
   */
  generateNameVariations(fullName) {
    const names = fullName.toLowerCase().split(' ').filter(n => n.length > 1);
    if (names.length === 0) return [];
    
    const variations = [];
    
    if (names.length >= 2) {
      const [first, last] = names;
      variations.push(
        `${first}${last}`,
        `${first}_${last}`,
        `${first}.${last}`,
        `${first}${last[0]}`,
        `${first[0]}${last}`,
        `${last}${first}`,
        `${last}_${first}`,
        `${last}.${first}`
      );
    }
    
    // Add individual names
    names.forEach(name => {
      if (name.length >= 4) {
        variations.push(name);
      }
    });
    
    return [...new Set(variations)];
  }

  /**
   * Select platforms for discovery based on options and capabilities
   * @param {Object} options - Discovery options
   * @returns {Array} List of platform configurations
   */
  selectPlatformsForDiscovery(options = {}) {
    const { 
      includePlatforms,
      excludePlatforms,
      popularOnly,
      category
    } = options;
    
    let platforms = registry.getSupportedPlatforms({
      popular: popularOnly,
      category
    });
    
    // Filter by included platforms
    if (includePlatforms && includePlatforms.length > 0) {
      platforms = platforms.filter(p => 
        includePlatforms.includes(p.key)
      );
    }
    
    // Filter out excluded platforms
    if (excludePlatforms && excludePlatforms.length > 0) {
      platforms = platforms.filter(p => 
        !excludePlatforms.includes(p.key)
      );
    }
    
    return platforms;
  }

  /**
   * Execute discovery across multiple platforms concurrently
   * @param {Array} identifiers - Identifiers to search
   * @param {Array} platforms - Platforms to search
   * @param {Object} options - Discovery options
   * @returns {Promise<Array>} Discovery results
   */
  async executeDiscoveryAcrossPlatforms(identifiers, platforms, options = {}) {
    const results = [];
    const concurrencyLimit = this.config.maxConcurrentDiscoveries;
    
    // Create discovery tasks
    const tasks = [];
    for (const platform of platforms) {
      for (const identifier of identifiers) {
        // Skip if platform doesn't support this identifier type
        if (!this.platformSupportsIdentifierType(platform, identifier.type)) {
          continue;
        }
        
        tasks.push({
          platform: platform.key,
          identifier,
          options
        });
      }
    }
    
    logger.info('Created discovery tasks', { taskCount: tasks.length });
    
    // Execute tasks with concurrency control
    const taskChunks = this.chunkArray(tasks, concurrencyLimit);
    
    for (const chunk of taskChunks) {
      const chunkResults = await Promise.allSettled(
        chunk.map(task => this.executeDiscoveryTask(task))
      );
      
      chunkResults.forEach(result => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          logger.error('Discovery task failed', {
            error: result.reason?.message
          });
        }
      });
      
      // Delay between chunks to be respectful
      if (taskChunks.indexOf(chunk) < taskChunks.length - 1) {
        await sleep(this.config.delayBetweenRequests);
      }
    }
    
    return results.filter(result => result !== null);
  }

  /**
   * Execute individual discovery task
   * @param {Object} task - Discovery task
   * @returns {Promise<Object>} Discovery result
   */
  async executeDiscoveryTask(task) {
    const { platform, identifier, options } = task;
    const timer = performanceLogger.startTimer(`discovery_${platform}`);
    
    try {
      logger.debug('Executing discovery task', {
        platform,
        identifierType: identifier.type,
        identifierSource: identifier.source
      });
      
      // Get platform adapter
      const adapter = registry.getAdapter(platform);
      
      // Execute discovery with retry logic
      const result = await retry(
        async () => {
          const discoveryResult = await Promise.race([
            adapter.discoverAccount(identifier.value, {
              method: this.getOptimalDiscoveryMethod(platform, identifier.type),
              ...options
            }),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Discovery timeout')), this.config.discoveryTimeout)
            )
          ]);
          
          return discoveryResult;
        },
        this.config.maxRetryAttempts,
        1000
      );
      
      const duration = timer.end({
        platform,
        success: true,
        exists: result.exists
      });
      
      return {
        platform,
        identifier,
        result,
        duration,
        success: true,
        discoveredAt: new Date()
      };
    } catch (error) {
      timer.end({
        platform,
        success: false,
        error: error.message
      });
      
      logger.warn('Discovery task failed', {
        platform,
        identifierType: identifier.type,
        error: error.message
      });
      
      return {
        platform,
        identifier,
        result: null,
        error: error.message,
        success: false,
        discoveredAt: new Date()
      };
    }
  }

  /**
   * Analyze discovery results and extract accounts
   * @param {Array} discoveryResults - Raw discovery results
   * @param {Array} identifiers - Original identifiers
   * @returns {Promise<Object>} Analysis results
   */
  async analyzeDiscoveryResults(discoveryResults, identifiers) {
    logger.info('Analyzing discovery results', {
      resultCount: discoveryResults.length
    });
    
    const accounts = [];
    const platformStats = {};
    const identifierStats = {};
    
    // Process each discovery result
    for (const discovery of discoveryResults) {
      const { platform, identifier, result, success } = discovery;
      
      // Update platform stats
      if (!platformStats[platform]) {
        platformStats[platform] = {
          searched: 0,
          found: 0,
          errors: 0
        };
      }
      
      platformStats[platform].searched++;
      
      if (!success) {
        platformStats[platform].errors++;
        continue;
      }
      
      if (result && result.exists) {
        platformStats[platform].found++;
        
        // Create account record
        const account = {
          platform,
          email: identifier.type === 'email' ? identifier.value : null,
          username: identifier.type === 'username' ? identifier.value : null,
          platformId: result.platformId || null,
          detectionMethod: result.method || 'unknown',
          confidence: this.calculateAccountConfidence(result, identifier),
          metadata: {
            profileUrl: result.profileUrl,
            isVerified: result.isVerified || false,
            lastActivity: result.lastActivity,
            accountAge: result.accountAge,
            followers: result.followers,
            following: result.following
          },
          lastVerified: new Date(),
          status: 'active'
        };
        
        accounts.push(account);
      }
      
      // Update identifier stats
      const identifierKey = `${identifier.type}:${identifier.source}`;
      if (!identifierStats[identifierKey]) {
        identifierStats[identifierKey] = {
          searched: 0,
          found: 0
        };
      }
      
      identifierStats[identifierKey].searched++;
      if (result && result.exists) {
        identifierStats[identifierKey].found++;
      }
    }
    
    // Deduplicate accounts
    const deduplicatedAccounts = this.deduplicateAccounts(accounts);
    
    // Enhance with breach data if enabled
    let breachData = {};
    if (this.config.enableBreachDataLookup) {
      breachData = await this.lookupBreachData(identifiers);
    }
    
    return {
      accounts: deduplicatedAccounts,
      originalAccountCount: accounts.length,
      deduplicatedAccountCount: deduplicatedAccounts.length,
      platformStats,
      identifierStats,
      breachData,
      analysisCompletedAt: new Date()
    };
  }

  /**
   * Calculate confidence score for discovered account
   * @param {Object} result - Discovery result
   * @param {Object} identifier - Original identifier
   * @returns {number} Confidence score (0-100)
   */
  calculateAccountConfidence(result, identifier) {
    let confidence = result.confidence || 50;
    
    // Boost confidence based on identifier source
    switch (identifier.source) {
      case 'primary_email':
        confidence += 20;
        break;
      case 'alternative_email':
        confidence += 15;
        break;
      case 'phone_number':
        confidence += 10;
        break;
      case 'common_username':
        confidence += 5;
        break;
    }
    
    // Boost confidence based on detection method
    switch (result.method) {
      case 'password_reset':
        confidence += 15;
        break;
      case 'api_verification':
        confidence += 20;
        break;
      case 'public_profile':
        confidence += 10;
        break;
      case 'email_enumeration':
        confidence += 12;
        break;
    }
    
    // Cap at 100
    return Math.min(confidence, 100);
  }

  /**
   * Deduplicate discovered accounts
   * @param {Array} accounts - List of discovered accounts
   * @returns {Array} Deduplicated accounts
   */
  deduplicateAccounts(accounts) {
    const seen = new Set();
    const deduplicated = [];
    
    for (const account of accounts) {
      const key = `${account.platform}:${account.email || account.username}`;
      
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(account);
      } else {
        // If we've seen this before, keep the one with higher confidence
        const existingIndex = deduplicated.findIndex(a => 
          `${a.platform}:${a.email || a.username}` === key
        );
        
        if (existingIndex >= 0 && account.confidence > deduplicated[existingIndex].confidence) {
          deduplicated[existingIndex] = account;
        }
      }
    }
    
    return deduplicated;
  }

  /**
   * Save discovered accounts to database
   * @param {string} userId - User ID
   * @param {Array} accounts - Discovered accounts
   * @returns {Promise<Array>} Saved account objects
   */
  async saveDiscoveredAccounts(userId, accounts) {
    const savedAccounts = [];
    
    for (const accountData of accounts) {
      try {
        // Check if account already exists
        const existing = await Account.findOne({
          userId,
          platform: accountData.platform,
          $or: [
            { email: accountData.email },
            { username: accountData.username }
          ]
        });
        
        if (existing) {
          // Update existing account
          Object.assign(existing, {
            confidence: Math.max(existing.confidence || 0, accountData.confidence),
            lastVerified: new Date(),
            detectionMethod: accountData.detectionMethod,
            metadata: { ...existing.metadata, ...accountData.metadata }
          });
          
          await existing.save();
          savedAccounts.push(existing);
        } else {
          // Create new account
          const newAccount = new Account({
            userId,
            ...accountData
          });
          
          await newAccount.save();
          savedAccounts.push(newAccount);
        }
      } catch (error) {
        logger.error('Failed to save discovered account', {
          userId,
          platform: accountData.platform,
          error: error.message
        });
      }
    }
    
    return savedAccounts;
  }

  /**
   * Lookup breach data for identifiers
   * @param {Array} identifiers - List of identifiers
   * @returns {Promise<Object>} Breach data
   */
  async lookupBreachData(identifiers) {
    const breachData = {};
    
    // Extract email identifiers
    const emails = identifiers
      .filter(i => i.type === 'email')
      .map(i => i.value);
    
    if (emails.length === 0) return breachData;
    
    try {
      // Lookup breaches for each email
      for (const email of emails) {
        breachData[email] = await this.lookupEmailBreaches(email);
      }
    } catch (error) {
      logger.error('Breach data lookup failed', {
        error: error.message
      });
    }
    
    return breachData;
  }

  /**
   * Lookup breaches for specific email
   * @param {string} email - Email to check
   * @returns {Promise<Array>} List of breaches
   */
  async lookupEmailBreaches(email) {
    const breaches = [];
    
    // Example: HaveIBeenPwned API
    if (process.env.HAVEIBEENPWNED_API_KEY) {
      try {
        const response = await axios.get(
          `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}`,
          {
            headers: {
              'hibp-api-key': process.env.HAVEIBEENPWNED_API_KEY,
              'User-Agent': 'PrivacyGuard'
            }
          }
        );
        
        breaches.push(...response.data.map(breach => ({
          source: 'haveibeenpwned',
          name: breach.Name,
          domain: breach.Domain,
          breachDate: breach.BreachDate,
          dataClasses: breach.DataClasses,
          verified: breach.IsVerified
        })));
      } catch (error) {
        if (error.response?.status !== 404) {
          logger.warn('HaveIBeenPwned lookup failed', {
            email: email.substring(0, 5) + '...',
            error: error.message
          });
        }
      }
    }
    
    return breaches;
  }

  /**
   * Helper methods
   */
  
  platformSupportsIdentifierType(platform, identifierType) {
    // Most platforms support email and username discovery
    // Phone discovery is more limited
    if (identifierType === 'phone') {
      return ['twitter', 'facebook', 'whatsapp', 'telegram'].includes(platform.key);
    }
    return true;
  }
  
  getOptimalDiscoveryMethod(platform, identifierType) {
    // Return the best discovery method for platform/identifier combination
    const methodMap = {
      twitter: {
        email: 'password_reset',
        username: 'public_profile'
      },
      facebook: {
        email: 'email_enumeration',
        username: 'public_profile'
      }
    };
    
    return methodMap[platform]?.[identifierType] || 'public_profile';
  }
  
  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
  
  generateDiscoveryId() {
    return `disc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = AccountDiscoveryEngine;