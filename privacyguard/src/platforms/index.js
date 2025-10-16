const TwitterAdapter = require('./TwitterAdapter');
const FacebookAdapter = require('./FacebookAdapter');
const { createComponentLogger } = require('../utils/logger');

const logger = createComponentLogger('platform-registry');

/**
 * Platform Registry - Central registry for all platform adapters
 * Manages platform discovery, initialization, and metadata
 */
class PlatformRegistry {
  constructor() {
    this.adapters = new Map();
    this.platformConfigs = new Map();
    this.initialized = false;
    
    // Initialize built-in adapters
    this.registerBuiltInAdapters();
  }

  /**
   * Register built-in platform adapters
   */
  registerBuiltInAdapters() {
    // Social Media Platforms
    this.register('twitter', TwitterAdapter, {
      category: 'social_media',
      icon: 'twitter',
      color: '#1DA1F2',
      priority: 100,
      popular: true
    });

    this.register('facebook', FacebookAdapter, {
      category: 'social_media',
      icon: 'facebook',
      color: '#4267B2',
      priority: 95,
      popular: true
    });

    // Additional platforms would be registered here
    // this.register('instagram', InstagramAdapter, { ... });
    // this.register('linkedin', LinkedInAdapter, { ... });
    // this.register('google', GoogleAdapter, { ... });
    // this.register('amazon', AmazonAdapter, { ... });
    
    logger.info(`Registered ${this.adapters.size} platform adapters`);
  }

  /**
   * Register a platform adapter
   * @param {string} platformKey - Unique platform identifier
   * @param {class} AdapterClass - Platform adapter class
   * @param {Object} config - Platform configuration
   */
  register(platformKey, AdapterClass, config = {}) {
    if (this.adapters.has(platformKey)) {
      logger.warn(`Platform ${platformKey} is already registered, overwriting`);
    }

    this.adapters.set(platformKey, AdapterClass);
    this.platformConfigs.set(platformKey, {
      key: platformKey,
      name: platformKey.charAt(0).toUpperCase() + platformKey.slice(1),
      category: 'other',
      priority: 0,
      popular: false,
      ...config
    });

    logger.debug(`Registered platform adapter: ${platformKey}`);
  }

  /**
   * Get platform adapter instance
   * @param {string} platformKey - Platform identifier
   * @param {Object} config - Adapter configuration
   * @returns {PlatformAdapter} Adapter instance
   */
  getAdapter(platformKey, config = {}) {
    const AdapterClass = this.adapters.get(platformKey.toLowerCase());
    
    if (!AdapterClass) {
      throw new Error(`Platform adapter not found: ${platformKey}`);
    }

    try {
      const adapter = new AdapterClass(config);
      logger.debug(`Created adapter instance for ${platformKey}`);
      return adapter;
    } catch (error) {
      logger.error(`Failed to create adapter for ${platformKey}`, {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Check if platform is supported
   * @param {string} platformKey - Platform identifier
   * @returns {boolean} Whether platform is supported
   */
  isSupported(platformKey) {
    return this.adapters.has(platformKey.toLowerCase());
  }

  /**
   * Get list of all supported platforms
   * @param {Object} options - Filtering options
   * @returns {Array} List of platform configurations
   */
  getSupportedPlatforms(options = {}) {
    const { category, popular, limit } = options;
    
    let platforms = Array.from(this.platformConfigs.values());
    
    // Filter by category
    if (category) {
      platforms = platforms.filter(p => p.category === category);
    }
    
    // Filter by popularity
    if (popular !== undefined) {
      platforms = platforms.filter(p => p.popular === popular);
    }
    
    // Sort by priority (descending)
    platforms.sort((a, b) => b.priority - a.priority);
    
    // Limit results
    if (limit) {
      platforms = platforms.slice(0, limit);
    }
    
    return platforms;
  }

  /**
   * Get popular platforms
   * @param {number} limit - Maximum number of platforms to return
   * @returns {Array} List of popular platforms
   */
  getPopularPlatforms(limit = 10) {
    return this.getSupportedPlatforms({ popular: true, limit });
  }

  /**
   * Get platforms by category
   * @param {string} category - Platform category
   * @returns {Array} List of platforms in category
   */
  getPlatformsByCategory(category) {
    return this.getSupportedPlatforms({ category });
  }

  /**
   * Search for platforms by name or key
   * @param {string} query - Search query
   * @returns {Array} Matching platforms
   */
  searchPlatforms(query) {
    const searchTerm = query.toLowerCase();
    
    return Array.from(this.platformConfigs.values()).filter(platform => 
      platform.key.toLowerCase().includes(searchTerm) ||
      platform.name.toLowerCase().includes(searchTerm)
    ).sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get platform configuration
   * @param {string} platformKey - Platform identifier
   * @returns {Object} Platform configuration
   */
  getPlatformConfig(platformKey) {
    const config = this.platformConfigs.get(platformKey.toLowerCase());
    if (!config) {
      throw new Error(`Platform configuration not found: ${platformKey}`);
    }
    return { ...config };
  }

  /**
   * Get platform capabilities
   * @param {string} platformKey - Platform identifier
   * @returns {Object} Platform capabilities
   */
  getPlatformCapabilities(platformKey) {
    const adapter = this.getAdapter(platformKey);
    return adapter.getPlatformInfo();
  }

  /**
   * Test platform adapter
   * @param {string} platformKey - Platform identifier
   * @param {Object} testConfig - Test configuration
   * @returns {Promise<Object>} Test result
   */
  async testAdapter(platformKey, testConfig = {}) {
    logger.info(`Testing platform adapter: ${platformKey}`);
    
    try {
      const adapter = this.getAdapter(platformKey, testConfig);
      const info = adapter.getPlatformInfo();
      
      // Basic adapter validation
      const tests = {
        instantiation: true,
        getPlatformInfo: !!info && !!info.name,
        getSupportedDataTypes: Array.isArray(adapter.getSupportedDataTypes()),
        hasOfficialAPI: typeof adapter.hasOfficialAPI() === 'boolean',
        validateCredentials: typeof adapter.validateCredentials === 'function'
      };
      
      const passed = Object.values(tests).every(result => result === true);
      
      logger.info(`Platform adapter test completed for ${platformKey}`, {
        passed,
        tests
      });
      
      return {
        platform: platformKey,
        passed,
        tests,
        info,
        testedAt: new Date()
      };
    } catch (error) {
      logger.error(`Platform adapter test failed for ${platformKey}`, {
        error: error.message
      });
      
      return {
        platform: platformKey,
        passed: false,
        error: error.message,
        testedAt: new Date()
      };
    }
  }

  /**
   * Test all registered adapters
   * @returns {Promise<Array>} Test results for all adapters
   */
  async testAllAdapters() {
    logger.info('Testing all platform adapters');
    
    const results = [];
    const platforms = Array.from(this.adapters.keys());
    
    for (const platform of platforms) {
      try {
        const result = await this.testAdapter(platform);
        results.push(result);
      } catch (error) {
        results.push({
          platform,
          passed: false,
          error: error.message,
          testedAt: new Date()
        });
      }
    }
    
    const passedCount = results.filter(r => r.passed).length;
    logger.info(`Adapter testing completed: ${passedCount}/${results.length} passed`);
    
    return results;
  }

  /**
   * Get platform statistics
   * @returns {Object} Registry statistics
   */
  getStats() {
    const platforms = Array.from(this.platformConfigs.values());
    
    const categories = {};
    let popularCount = 0;
    
    platforms.forEach(platform => {
      categories[platform.category] = (categories[platform.category] || 0) + 1;
      if (platform.popular) popularCount++;
    });
    
    return {
      totalPlatforms: platforms.length,
      categories,
      popularPlatforms: popularCount,
      supportedDataTypes: this.getAllSupportedDataTypes().length
    };
  }

  /**
   * Get all unique data types supported across platforms
   * @returns {Array} List of all supported data types
   */
  getAllSupportedDataTypes() {
    const allDataTypes = new Set();
    
    for (const [platformKey] of this.adapters) {
      try {
        const adapter = this.getAdapter(platformKey);
        const dataTypes = adapter.getSupportedDataTypes();
        dataTypes.forEach(type => allDataTypes.add(type));
      } catch (error) {
        logger.warn(`Failed to get data types for ${platformKey}`, {
          error: error.message
        });
      }
    }
    
    return Array.from(allDataTypes).sort();
  }

  /**
   * Initialize registry (can be used for async initialization)
   */
  async initialize() {
    if (this.initialized) return;
    
    logger.info('Initializing platform registry');
    
    // Perform any async initialization here
    // e.g., loading platform configurations from database
    
    this.initialized = true;
    logger.info('Platform registry initialized successfully');
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    logger.info('Cleaning up platform registry');
    this.adapters.clear();
    this.platformConfigs.clear();
    this.initialized = false;
  }
}

// Create and export singleton instance
const registry = new PlatformRegistry();

module.exports = {
  PlatformRegistry,
  registry,
  
  // Export adapter classes for direct use
  TwitterAdapter,
  FacebookAdapter,
  
  // Convenience methods
  getAdapter: (platform, config) => registry.getAdapter(platform, config),
  getSupportedPlatforms: (options) => registry.getSupportedPlatforms(options),
  isSupported: (platform) => registry.isSupported(platform),
  searchPlatforms: (query) => registry.searchPlatforms(query)
};