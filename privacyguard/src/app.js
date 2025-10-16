require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

// Import utilities
const { logger, requestLogger, errorLogger } = require('./utils/logger');
const { createComponentLogger } = require('./utils/logger');

// Import middleware
const { authenticate, apiRateLimit } = require('./middleware/auth');

// Import services
const { discoveryService } = require('./discovery');

const appLogger = createComponentLogger('app');

// Create Express application
const app = express();

// Environment variables
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/privacyguard';

/**
 * Database Connection
 */
async function connectDatabase() {
  try {
    const options = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    };

    await mongoose.connect(MONGODB_URI, options);
    appLogger.info('Connected to MongoDB successfully', {
      database: mongoose.connection.name,
      host: mongoose.connection.host,
      port: mongoose.connection.port
    });
  } catch (error) {
    appLogger.error('Failed to connect to MongoDB', {
      error: error.message,
      uri: MONGODB_URI.replace(/\/\/[^@]+@/, '//***:***@') // Hide credentials in logs
    });
    process.exit(1);
  }
}

/**
 * Security Middleware
 */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false
}));

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      'https://privacyguard.io',
      'https://app.privacyguard.io'
    ];
    
    // Allow requests with no origin (mobile apps, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
};

app.use(cors(corsOptions));

/**
 * General Middleware
 */
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Trust proxy for accurate IP addresses
app.set('trust proxy', 1);

// Request logging
app.use(requestLogger);

/**
 * Rate Limiting
 */
const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(generalRateLimit);

/**
 * Health Check Endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
    version: process.env.npm_package_version || '1.0.0',
    uptime: process.uptime(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

/**
 * API Status Endpoint
 */
app.get('/api/status', (req, res) => {
  const status = {
    api: 'operational',
    database: mongoose.connection.readyState === 1 ? 'operational' : 'error',
    services: {
      discovery: 'operational',
      extraction: 'operational', 
      deletion: 'operational',
      monitoring: 'operational'
    },
    stats: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      activeConnections: mongoose.connection.readyState,
    }
  };
  
  const overallStatus = Object.values(status.services).every(s => s === 'operational') &&
                       status.database === 'operational' ? 'operational' : 'degraded';
  
  res.json({
    status: overallStatus,
    ...status,
    timestamp: new Date().toISOString()
  });
});

/**
 * Simple placeholder routes for testing
 */

// Authentication routes placeholder
app.use('/api/auth', (req, res, next) => {
  // Basic auth route stub
  if (req.path === '/login' && req.method === 'POST') {
    res.json({ success: true, message: 'Login endpoint (placeholder)' });
  } else if (req.path === '/register' && req.method === 'POST') {
    res.json({ success: true, message: 'Register endpoint (placeholder)' });
  } else {
    res.status(404).json({ success: false, message: 'Auth endpoint not implemented' });
  }
});

// Discovery routes placeholder
app.use('/api/discovery', authenticate, (req, res) => {
  if (req.path === '/start' && req.method === 'POST') {
    res.json({ success: true, message: 'Discovery started (placeholder)' });
  } else {
    res.status(404).json({ success: false, message: 'Discovery endpoint not implemented' });
  }
});

// Platforms info endpoint
app.get('/api/platforms', (req, res) => {
  res.json({
    success: true,
    platforms: [
      { key: 'twitter', name: 'Twitter', supported: true },
      { key: 'facebook', name: 'Facebook', supported: true }
    ]
  });
});

/**
 * 404 Handler
 */
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

/**
 * Error Handling Middleware
 */
app.use(errorLogger);

app.use((error, req, res, next) => {
  // Handle specific error types
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: Object.values(error.errors).map(err => ({
        field: err.path,
        message: err.message
      }))
    });
  }
  
  if (error.name === 'MongoError' && error.code === 11000) {
    return res.status(409).json({
      success: false,
      message: 'Resource already exists',
      field: Object.keys(error.keyValue)[0]
    });
  }
  
  if (error.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'Invalid resource ID format'
    });
  }
  
  // Default error response
  const statusCode = error.statusCode || error.status || 500;
  const message = NODE_ENV === 'production' 
    ? 'An unexpected error occurred' 
    : error.message;
  
  res.status(statusCode).json({
    success: false,
    message,
    ...(NODE_ENV === 'development' && { stack: error.stack })
  });
});

/**
 * Graceful Shutdown Handler
 */
async function gracefulShutdown(signal) {
  appLogger.info(`Received ${signal}, starting graceful shutdown...`);
  
  try {
    // Close database connection
    await mongoose.connection.close();
    appLogger.info('Database connection closed');
    
    // Shutdown discovery service
    await discoveryService.shutdown();
    appLogger.info('Discovery service shut down');
    
    // Close server
    if (global.server) {
      global.server.close(() => {
        appLogger.info('HTTP server closed');
        process.exit(0);
      });
      
      // Force close after 10 seconds
      setTimeout(() => {
        appLogger.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
      }, 10000);
    } else {
      process.exit(0);
    }
    
  } catch (error) {
    appLogger.error('Error during graceful shutdown', { error: error.message });
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  appLogger.error('Uncaught Exception', {
    error: error.message,
    stack: error.stack
  });
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  appLogger.error('Unhandled Rejection', {
    reason: reason.message || reason,
    promise: promise.toString()
  });
  gracefulShutdown('UNHANDLED_REJECTION');
});

/**
 * Start Server
 */
async function startServer() {
  try {
    // Connect to database
    await connectDatabase();
    
    // Initialize services
    if (discoveryService.initialize) {
      await discoveryService.initialize();
    }
    
    // Start HTTP server
    const server = app.listen(PORT, () => {
      appLogger.info(`PrivacyGuard server started successfully`, {
        port: PORT,
        environment: NODE_ENV,
        nodeVersion: process.version,
        pid: process.pid
      });
      
      if (NODE_ENV === 'development') {
        console.log(`
🚀 PrivacyGuard API Server Running
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 Server URL: http://localhost:${PORT}
📍 Health Check: http://localhost:${PORT}/health
📍 API Status: http://localhost:${PORT}/api/status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Environment: ${NODE_ENV}
Database: ${mongoose.connection.name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        `);
      }
    });
    
    // Store server reference for graceful shutdown
    global.server = server;
    
    return server;
  } catch (error) {
    appLogger.error('Failed to start server', {
      error: error.message
    });
    process.exit(1);
  }
}

// Start server if this file is run directly
if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };