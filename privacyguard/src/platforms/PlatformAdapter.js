/**
 * PlatformAdapter - Base class for all platform integrations
 * 
 * This interface defines the contract that all platform adapters must implement
 * to provide consistent account discovery, data extraction, and deletion capabilities.
 */

const { createComponentLogger } = require('../utils/logger');

class PlatformAdapter {
  constructor(platformName, config = {}) {
    this.platformName = platformName;
    this.config = config;
    this.logger = createComponentLogger(`platform-${platformName.toLowerCase()}`);
    
    // Platform capabilities
    this.capabilities = {
      hasOfficialAPI: false,
      supportsGDPRRequests: false,
      supportsOAuth: false,
      supportsPasswordReset: false,
      supportsAccountDeletion: false,
      supportsDataExport: false,
      requiresManualVerification: false,
      ...config.capabilities
    };
    
    // Rate limiting configuration
    this.rateLimits = {
      requestsPerMinute: 60,
      requestsPerHour: 1000,
      requestsPerDay: 10000,
      ...config.rateLimits
    };
    
    // Platform-specific configuration
    this.endpoints = config.endpoints || {};
    this.selectors = config.selectors || {};
    this.headers = config.headers || {};
  }

  /**
   * Get platform information
   * @returns {Object} Platform metadata
   */
  getPlatformInfo() {
    return {
      name: this.platformName,
      capabilities: this.capabilities,
      rateLimits: this.rateLimits,
      supportedDataTypes: this.getSupportedDataTypes()
    };
  }

  /**
   * Check if platform has official API
   * @returns {boolean}
   */
  hasOfficialAPI() {
    return this.capabilities.hasOfficialAPI;
  }

  /**
   * Get supported data types for this platform
   * @returns {Array} List of supported data types
   */
  getSupportedDataTypes() {
    return [
      'profile',
      'posts',
      'messages',
      'photos',
      'videos',
      'contacts',
      'activity_logs'
    ];
  }

  /**
   * Authenticate with the platform
   * @param {Object} credentials - Authentication credentials
   * @returns {Promise<Object>} Authentication session
   */
  async authenticate(credentials) {
    throw new Error(`authenticate() method must be implemented by ${this.platformName} adapter`);
  }

  /**
   * Verify account exists on platform
   * @param {string} identifier - Email or username
   * @param {Object} options - Verification options
   * @returns {Promise<Object>} Account verification result
   */
  async verifyAccount(identifier, options = {}) {
    throw new Error(`verifyAccount() method must be implemented by ${this.platformName} adapter`);
  }

  /**
   * Discover account using various methods
   * @param {string} identifier - Email, username, or phone
   * @param {Object} options - Discovery options
   * @returns {Promise<Object>} Discovery result
   */
  async discoverAccount(identifier, options = {}) {
    throw new Error(`discoverAccount() method must be implemented by ${this.platformName} adapter`);
  }

  /**
   * Extract specific data type from platform
   * @param {Object} session - Authenticated session
   * @param {string} dataType - Type of data to extract
   * @param {Object} options - Extraction options
   * @returns {Promise<Object>} Extracted data
   */
  async extractDataType(session, dataType, options = {}) {
    throw new Error(`extractDataType() method must be implemented by ${this.platformName} adapter`);
  }

  /**
   * Extract all available data from platform
   * @param {Object} session - Authenticated session
   * @param {Object} options - Extraction options
   * @returns {Promise<Object>} All extracted data
   */
  async extractAllData(session, options = {}) {
    const supportedTypes = this.getSupportedDataTypes();
    const extractedData = {};
    const errors = [];

    for (const dataType of supportedTypes) {
      try {
        this.logger.info(`Extracting ${dataType} data`, {
          platform: this.platformName,
          dataType
        });

        extractedData[dataType] = await this.extractDataType(session, dataType, options);
      } catch (error) {
        this.logger.error(`Failed to extract ${dataType} data`, {
          platform: this.platformName,
          dataType,
          error: error.message
        });
        errors.push({ dataType, error: error.message });
      }
    }

    return {
      platform: this.platformName,
      extractedAt: new Date(),
      data: extractedData,
      errors,
      success: errors.length === 0
    };
  }

  /**
   * Request GDPR data export
   * @param {Object} session - Authenticated session
   * @param {Object} options - Request options
   * @returns {Promise<Object>} GDPR request result
   */
  async requestGDPRExport(session, options = {}) {
    if (!this.capabilities.supportsGDPRRequests) {
      throw new Error(`${this.platformName} does not support GDPR data export requests`);
    }
    throw new Error(`requestGDPRExport() method must be implemented by ${this.platformName} adapter`);
  }

  /**
   * Execute account deletion
   * @param {Object} session - Authenticated session
   * @param {Object} options - Deletion options
   * @returns {Promise<Object>} Deletion result
   */
  async executeDeletion(session, options = {}) {
    if (!this.capabilities.supportsAccountDeletion) {
      throw new Error(`${this.platformName} does not support automated account deletion`);
    }
    throw new Error(`executeDeletion() method must be implemented by ${this.platformName} adapter`);
  }

  /**
   * Verify account deletion was successful
   * @param {string} identifier - Account identifier
   * @param {Object} options - Verification options
   * @returns {Promise<Object>} Verification result
   */
  async verifyDeletion(identifier, options = {}) {
    throw new Error(`verifyDeletion() method must be implemented by ${this.platformName} adapter`);
  }

  /**
   * Get account metadata and statistics
   * @param {Object} session - Authenticated session
   * @returns {Promise<Object>} Account metadata
   */
  async getAccountMetadata(session) {
    return {
      platform: this.platformName,
      accountAge: null,
      followers: null,
      following: null,
      postsCount: null,
      isVerified: false,
      lastActivity: null,
      accountType: 'personal'
    };
  }

  /**
   * Monitor account for changes
   * @param {string} identifier - Account identifier
   * @param {Object} options - Monitoring options
   * @returns {Promise<Object>} Monitoring result
   */
  async monitorAccount(identifier, options = {}) {
    this.logger.info(`Monitoring account on ${this.platformName}`, {
      identifier: identifier.substring(0, 5) + '...',
      options
    });

    // Default implementation just checks if account still exists
    try {
      const result = await this.verifyAccount(identifier, options);
      return {
        platform: this.platformName,
        identifier,
        exists: result.exists,
        changes: [],
        checkedAt: new Date()
      };
    } catch (error) {
      this.logger.error(`Failed to monitor account on ${this.platformName}`, {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Validate credentials format
   * @param {Object} credentials - Credentials to validate
   * @returns {Object} Validation result
   */
  validateCredentials(credentials) {
    const required = ['username', 'password'];
    const missing = required.filter(field => !credentials[field]);
    
    return {
      valid: missing.length === 0,
      missing,
      message: missing.length > 0 ? `Missing required fields: ${missing.join(', ')}` : 'Valid'
    };
  }

  /**
   * Handle rate limiting
   * @param {Function} operation - Operation to execute
   * @param {Object} options - Rate limiting options
   * @returns {Promise} Operation result with rate limiting
   */
  async withRateLimit(operation, options = {}) {
    const delay = options.delay || 1000;
    const maxRetries = options.maxRetries || 3;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await operation();
        return result;
      } catch (error) {
        if (error.code === 'RATE_LIMITED' && attempt < maxRetries - 1) {
          this.logger.warn(`Rate limited on ${this.platformName}, retrying in ${delay}ms`, {
            attempt: attempt + 1,
            maxRetries
          });
          await new Promise(resolve => setTimeout(resolve, delay * (attempt + 1)));
          continue;
        }
        throw error;
      }
    }
  }

  /**
   * Sanitize data for logging (remove sensitive information)
   * @param {Object} data - Data to sanitize
   * @returns {Object} Sanitized data
   */
  sanitizeForLogging(data) {
    const sensitiveKeys = ['password', 'token', 'key', 'secret', 'auth', 'credential'];
    const sanitized = JSON.parse(JSON.stringify(data));
    
    function sanitizeObject(obj) {
      for (const key in obj) {
        if (typeof obj[key] === 'object' && obj[key] !== null) {
          sanitizeObject(obj[key]);
        } else if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
          obj[key] = '[REDACTED]';
        }
      }
    }
    
    sanitizeObject(sanitized);
    return sanitized;
  }

  /**
   * Create standardized error response
   * @param {string} operation - Operation that failed
   * @param {Error} error - Original error
   * @param {Object} context - Additional context
   * @returns {Object} Standardized error
   */
  createError(operation, error, context = {}) {
    return {
      platform: this.platformName,
      operation,
      error: error.message,
      code: error.code || 'UNKNOWN_ERROR',
      context: this.sanitizeForLogging(context),
      timestamp: new Date()
    };
  }

  /**
   * Log operation start
   * @param {string} operation - Operation name
   * @param {Object} context - Operation context
   */
  logOperationStart(operation, context = {}) {
    this.logger.info(`Starting ${operation} on ${this.platformName}`, {
      operation,
      context: this.sanitizeForLogging(context)
    });
  }

  /**
   * Log operation completion
   * @param {string} operation - Operation name
   * @param {boolean} success - Whether operation succeeded
   * @param {Object} result - Operation result
   */
  logOperationComplete(operation, success, result = {}) {
    const logLevel = success ? 'info' : 'error';
    this.logger[logLevel](`Completed ${operation} on ${this.platformName}`, {
      operation,
      success,
      result: this.sanitizeForLogging(result)
    });
  }
}

module.exports = PlatformAdapter;