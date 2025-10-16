const serverless = require('serverless-http');
const app = require('../../src/app');

// Export the handler
exports.handler = serverless(app);