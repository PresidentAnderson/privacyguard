const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const { createComponentLogger, securityLogger } = require('../utils/logger');
const { sanitizeForLogging } = require('../utils/helpers');

const logger = createComponentLogger('auth-middleware');

/**
 * JWT Authentication middleware
 * Verifies JWT tokens and attaches user to request object
 */
const authenticate = async (req, res, next) => {
  try {
    let token;
    
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
    
    // Get token from cookie if not in header
    if (!token && req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user from database
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Token is valid but user no longer exists.'
      });
    }
    
    // Check if user is active
    if (!user.isActive) {
      securityLogger.suspiciousActivity(
        user.id,
        'INACTIVE_USER_ACCESS_ATTEMPT',
        { ip: req.ip, userAgent: req.get('User-Agent') }
      );
      
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated.'
      });
    }
    
    // Check if account is locked
    if (user.isLocked) {
      securityLogger.accountLock(user.email, 'LOCKED_ACCOUNT_ACCESS_ATTEMPT');
      
      return res.status(423).json({
        success: false,
        message: 'Account is temporarily locked due to suspicious activity.'
      });
    }
    
    // Attach user to request
    req.user = user;
    
    // Log successful authentication
    securityLogger.dataAccess(
      user.id,
      'API_ACCESS',
      `${req.method} ${req.originalUrl}`,
      req.ip
    );
    
    next();
  } catch (error) {
    logger.error('Authentication failed', {
      error: error.message,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.originalUrl
    });
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token has expired.'
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Authentication error.'
    });
  }
};

/**
 * Optional authentication middleware
 * Attaches user if token is valid, but doesn't require authentication
 */
const optionalAuth = async (req, res, next) => {
  try {
    let token;
    
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
    
    if (!token && req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }
    
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('-password');
        
        if (user && user.isActive && !user.isLocked) {
          req.user = user;
        }
      } catch (error) {
        // Ignore token errors in optional auth
        logger.debug('Optional auth token invalid', { error: error.message });
      }
    }
    
    next();
  } catch (error) {
    logger.error('Optional authentication error', { error: error.message });
    next(); // Continue without authentication
  }
};

/**
 * Authorization middleware for specific roles/permissions
 * @param {Array|String} requiredRoles - Required roles or single role
 */
const authorize = (requiredRoles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.'
      });
    }
    
    const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
    
    // Check subscription tier as role
    const userRole = req.user.subscription?.tier || 'free';
    
    if (roles.length > 0 && !roles.includes(userRole)) {
      securityLogger.suspiciousActivity(
        req.user.id,
        'UNAUTHORIZED_ACCESS_ATTEMPT',
        {
          requiredRoles: roles,
          userRole,
          url: req.originalUrl,
          ip: req.ip
        }
      );
      
      return res.status(403).json({
        success: false,
        message: 'Insufficient privileges.',
        required: roles,
        current: userRole
      });
    }
    
    next();
  };
};

/**
 * Subscription tier authorization
 * @param {String} minimumTier - Minimum required subscription tier
 */
const requireSubscription = (minimumTier) => {
  const tierHierarchy = ['free', 'privacy', 'professional', 'enterprise'];
  
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.'
      });
    }
    
    const userTier = req.user.subscription?.tier || 'free';
    const userTierIndex = tierHierarchy.indexOf(userTier);
    const requiredTierIndex = tierHierarchy.indexOf(minimumTier);
    
    if (userTierIndex < requiredTierIndex) {
      return res.status(402).json({
        success: false,
        message: 'Subscription upgrade required.',
        required: minimumTier,
        current: userTier
      });
    }
    
    // Check if subscription is active
    if (!req.user.subscriptionActive && userTier !== 'free') {
      return res.status(402).json({
        success: false,
        message: 'Subscription has expired.',
        current: userTier,
        expired: true
      });
    }
    
    next();
  };
};

/**
 * Email verification requirement middleware
 */
const requireEmailVerification = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required.'
    });
  }
  
  if (!req.user.security.emailVerified) {
    return res.status(403).json({
      success: false,
      message: 'Email verification required.',
      requiresVerification: true
    });
  }
  
  next();
};

/**
 * Two-factor authentication requirement middleware
 */
const requireTwoFactor = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required.'
    });
  }
  
  if (!req.user.security.twoFactorEnabled) {
    return res.status(403).json({
      success: false,
      message: 'Two-factor authentication required.',
      requires2FA: true
    });
  }
  
  // Check if 2FA was verified in this session
  if (!req.session?.twoFactorVerified) {
    return res.status(403).json({
      success: false,
      message: 'Two-factor authentication verification required for this session.',
      requires2FAVerification: true
    });
  }
  
  next();
};

/**
 * Generate JWT token for user
 * @param {Object} user - User object
 * @param {Object} options - Token options
 * @returns {String} JWT token
 */
const generateToken = (user, options = {}) => {
  const payload = {
    id: user._id,
    email: user.email,
    role: user.subscription?.tier || 'free',
    iat: Math.floor(Date.now() / 1000)
  };
  
  const tokenOptions = {
    expiresIn: options.expiresIn || process.env.JWT_EXPIRES_IN || '7d',
    issuer: 'PrivacyGuard',
    audience: user._id.toString()
  };
  
  return jwt.sign(payload, process.env.JWT_SECRET, tokenOptions);
};

/**
 * Generate refresh token
 * @param {Object} user - User object
 * @returns {String} Refresh token
 */
const generateRefreshToken = (user) => {
  const payload = {
    id: user._id,
    type: 'refresh',
    iat: Math.floor(Date.now() / 1000)
  };
  
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: '30d',
    issuer: 'PrivacyGuard',
    audience: user._id.toString()
  });
};

/**
 * Verify refresh token and generate new access token
 * @param {String} refreshToken - Refresh token
 * @returns {Object} New tokens or error
 */
const refreshAccessToken = async (refreshToken) => {
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    
    if (decoded.type !== 'refresh') {
      throw new Error('Invalid token type');
    }
    
    const user = await User.findById(decoded.id).select('-password');
    if (!user || !user.isActive) {
      throw new Error('User not found or inactive');
    }
    
    const newAccessToken = generateToken(user);
    const newRefreshToken = generateRefreshToken(user);
    
    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      user: sanitizeForLogging(user.toObject())
    };
  } catch (error) {
    throw new Error('Invalid refresh token');
  }
};

/**
 * Rate limiting middleware for authentication endpoints
 */
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    securityLogger.suspiciousActivity(
      req.body?.email || 'unknown',
      'RATE_LIMIT_EXCEEDED',
      {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        endpoint: req.originalUrl
      }
    );
    
    res.status(429).json({
      success: false,
      message: 'Too many authentication attempts, please try again later.',
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
    });
  },
  keyGenerator: (req) => {
    // Rate limit by IP and email combination
    return `${req.ip}-${req.body?.email || 'anonymous'}`;
  }
});

/**
 * General API rate limiting middleware
 */
const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: (req) => {
    // Different limits based on subscription tier
    if (!req.user) return 100; // Anonymous users
    
    const tier = req.user.subscription?.tier || 'free';
    const limits = {
      free: 100,
      privacy: 500,
      professional: 1000,
      enterprise: 5000
    };
    
    return limits[tier] || 100;
  },
  message: {
    success: false,
    message: 'Rate limit exceeded. Please upgrade your subscription for higher limits.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.user ? req.user.id : req.ip;
  }
});

/**
 * Validate API key middleware (for external API access)
 */
const validateApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
      return res.status(401).json({
        success: false,
        message: 'API key required.'
      });
    }
    
    // In a real implementation, you'd validate against stored API keys
    // For now, we'll use a simple format check
    if (!apiKey.startsWith('pg_') || apiKey.length !== 44) {
      return res.status(401).json({
        success: false,
        message: 'Invalid API key format.'
      });
    }
    
    // Here you would typically:
    // 1. Look up the API key in the database
    // 2. Check if it's active and not expired
    // 3. Load associated user/organization
    // 4. Check rate limits and permissions
    
    next();
  } catch (error) {
    logger.error('API key validation error', { error: error.message });
    return res.status(500).json({
      success: false,
      message: 'Authentication error.'
    });
  }
};

// For backward compatibility, export authenticate as default
module.exports = authenticate;

// Export all middleware functions
module.exports.authenticate = authenticate;
module.exports.optionalAuth = optionalAuth;
module.exports.authorize = authorize;
module.exports.requireSubscription = requireSubscription;
module.exports.requireEmailVerification = requireEmailVerification;
module.exports.requireTwoFactor = requireTwoFactor;
module.exports.generateToken = generateToken;
module.exports.generateRefreshToken = generateRefreshToken;
module.exports.refreshAccessToken = refreshAccessToken;
module.exports.authRateLimit = authRateLimit;
module.exports.apiRateLimit = apiRateLimit;
module.exports.validateApiKey = validateApiKey;