const DiscoveryEngine = require('./DiscoveryEngine');
const DiscoveryService = require('./DiscoveryService');

// Create singleton service instance
const discoveryService = new DiscoveryService({
  maxConcurrentDiscoveries: parseInt(process.env.MAX_CONCURRENT_DISCOVERIES) || 5,
  discoveryTimeout: parseInt(process.env.DISCOVERY_TIMEOUT_MS) || 30000,
  minConfidenceThreshold: parseInt(process.env.MIN_CONFIDENCE_THRESHOLD) || 60,
  enableBreachDataLookup: process.env.ENABLE_BREACH_DATA_LOOKUP !== 'false',
  enableSocialGraphAnalysis: process.env.ENABLE_SOCIAL_GRAPH_ANALYSIS !== 'false'
});

module.exports = {
  DiscoveryEngine,
  DiscoveryService,
  discoveryService
};