const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

// Create logs directory if it doesn't exist
const fs = require('fs');
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white'
};

winston.addColors(colors);

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    
    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    
    return msg;
  })
);

// Custom format for file output
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let msg = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    
    if (stack) {
      msg += `\n${stack}`;
    }
    
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta, null, 2)}`;
    }
    
    return msg;
  })
);

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  format: fileFormat,
  defaultMeta: {
    service: 'privacyguard'
  },
  transports: [
    // Error log file
    new DailyRotateFile({
      filename: path.join(logsDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      handleExceptions: true,
      handleRejections: true,
      maxSize: '20m',
      maxFiles: '30d',
      zippedArchive: true
    }),
    
    // Combined log file
    new DailyRotateFile({
      filename: path.join(logsDir, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      handleExceptions: true,
      handleRejections: true,
      maxSize: '20m',
      maxFiles: '30d',
      zippedArchive: true
    }),
    
    // HTTP requests log
    new DailyRotateFile({
      filename: path.join(logsDir, 'http-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'http',
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true
    }),
    
    // Security events log
    new DailyRotateFile({
      filename: path.join(logsDir, 'security-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '90d', // Keep security logs longer
      zippedArchive: true,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  ],
  
  // Handle uncaught exceptions and rejections
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'exceptions.log'),
      handleExceptions: true
    })
  ],
  
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'rejections.log'),
      handleRejections: true
    })
  ],
  
  exitOnError: false
});

// Add console transport in non-production environments
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: consoleFormat,
    level: process.env.LOG_LEVEL || 'debug'
  }));
}

// Create specialized loggers for different components
const createComponentLogger = (component) => {
  return {
    error: (message, meta = {}) => logger.error(message, { component, ...meta }),
    warn: (message, meta = {}) => logger.warn(message, { component, ...meta }),
    info: (message, meta = {}) => logger.info(message, { component, ...meta }),
    http: (message, meta = {}) => logger.http(message, { component, ...meta }),
    debug: (message, meta = {}) => logger.debug(message, { component, ...meta })
  };
};

// Security logger for sensitive operations
const securityLogger = {
  log: (event, details = {}) => {
    const securityTransport = logger.transports.find(
      t => t.filename && t.filename.includes('security')
    );
    
    if (securityTransport) {
      logger.info('SECURITY_EVENT', {
        event,
        timestamp: new Date().toISOString(),
        ...details
      });
    }
  },
  
  loginAttempt: (email, success, ip, userAgent) => {
    securityLogger.log('LOGIN_ATTEMPT', {
      email,
      success,
      ip,
      userAgent,
      severity: success ? 'info' : 'warning'
    });
  },
  
  passwordReset: (email, ip) => {
    securityLogger.log('PASSWORD_RESET_REQUEST', {
      email,
      ip,
      severity: 'info'
    });
  },
  
  accountLock: (email, reason) => {
    securityLogger.log('ACCOUNT_LOCKED', {
      email,
      reason,
      severity: 'warning'
    });
  },
  
  dataAccess: (userId, resourceType, action, ip) => {
    securityLogger.log('DATA_ACCESS', {
      userId,
      resourceType,
      action,
      ip,
      severity: 'info'
    });
  },
  
  suspiciousActivity: (userId, activity, details) => {
    securityLogger.log('SUSPICIOUS_ACTIVITY', {
      userId,
      activity,
      details,
      severity: 'high'
    });
  }
};

// Performance logger for tracking timing and metrics
const performanceLogger = {
  startTimer: (operation) => {
    const startTime = process.hrtime.bigint();
    return {
      end: (metadata = {}) => {
        const endTime = process.hrtime.bigint();
        const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
        
        logger.info('PERFORMANCE_METRIC', {
          operation,
          duration: `${duration.toFixed(2)}ms`,
          ...metadata
        });
        
        return duration;
      }
    };
  },
  
  trackMemory: (operation) => {
    const memUsage = process.memoryUsage();
    logger.debug('MEMORY_USAGE', {
      operation,
      rss: `${Math.round(memUsage.rss / 1024 / 1024 * 100) / 100} MB`,
      heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024 * 100) / 100} MB`,
      heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024 * 100) / 100} MB`
    });
  }
};

// API request logger middleware
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLevel = res.statusCode >= 400 ? 'warn' : 'http';
    
    logger.log(logLevel, 'HTTP_REQUEST', {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id || 'anonymous'
    });
  });
  
  next();
};

// Error logger middleware
const errorLogger = (err, req, res, next) => {
  logger.error('UNHANDLED_ERROR', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userId: req.user?.id,
    body: req.body,
    params: req.params,
    query: req.query
  });
  
  next(err);
};

module.exports = {
  logger,
  createComponentLogger,
  securityLogger,
  performanceLogger,
  requestLogger,
  errorLogger
};