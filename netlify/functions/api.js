const serverless = require('serverless-http');
const { app } = require('../../privacyguard/src/app');

// Export the handler
exports.handler = serverless(app);