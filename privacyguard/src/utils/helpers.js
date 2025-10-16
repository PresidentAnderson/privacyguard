const crypto = require('crypto');
const validator = require('validator');
const moment = require('moment');
const { createComponentLogger } = require('./logger');

const logger = createComponentLogger('helpers');

/**
 * Validate email address
 * @param {string} email - Email to validate
 * @returns {boolean} Validation result
 */
function isValidEmail(email) {
  return validator.isEmail(email);
}

/**
 * Sanitize email address
 * @param {string} email - Email to sanitize
 * @returns {string} Sanitized email
 */
function sanitizeEmail(email) {
  return validator.normalizeEmail(email, {
    gmail_remove_dots: false,
    gmail_remove_subaddress: false,
    outlookdotcom_remove_subaddress: false,
    yahoo_remove_subaddress: false,
    icloud_remove_subaddress: false
  });
}

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {Object} Validation result with score and requirements
 */
function validatePassword(password) {
  const requirements = {
    minLength: password.length >= 8,
    hasUpperCase: /[A-Z]/.test(password),
    hasLowerCase: /[a-z]/.test(password),
    hasNumbers: /\d/.test(password),
    hasSpecialChars: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\?]/.test(password)
  };

  const score = Object.values(requirements).filter(Boolean).length;
  
  return {
    isValid: score >= 4 && requirements.minLength,
    score,
    requirements,
    strength: getPasswordStrength(score)
  };
}

/**
 * Get password strength label
 * @param {number} score - Password score
 * @returns {string} Strength label
 */
function getPasswordStrength(score) {
  if (score < 2) return 'Very Weak';
  if (score < 3) return 'Weak';
  if (score < 4) return 'Fair';
  if (score < 5) return 'Strong';
  return 'Very Strong';
}

/**
 * Generate a unique identifier
 * @param {string} [prefix=''] - Optional prefix
 * @returns {string} Unique identifier
 */
function generateUniqueId(prefix = '') {
  const timestamp = Date.now().toString(36);
  const randomStr = crypto.randomBytes(6).toString('hex');
  return `${prefix}${prefix ? '_' : ''}${timestamp}_${randomStr}`;
}

/**
 * Generate a human-readable unique ID
 * @param {number} [length=8] - Length of the ID
 * @returns {string} Human-readable ID
 */
function generateReadableId(length = 8) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  
  for (let i = 0; i < length; i++) {
    result += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  
  return result;
}

/**
 * Format bytes into human readable format
 * @param {number} bytes - Number of bytes
 * @param {number} [decimals=2] - Number of decimal places
 * @returns {string} Formatted string
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Format duration in milliseconds to human readable format
 * @param {number} milliseconds - Duration in milliseconds
 * @returns {string} Formatted duration
 */
function formatDuration(milliseconds) {
  const duration = moment.duration(milliseconds);
  
  if (duration.asSeconds() < 1) {
    return `${Math.round(milliseconds)}ms`;
  }
  
  if (duration.asMinutes() < 1) {
    return `${Math.round(duration.asSeconds())}s`;
  }
  
  if (duration.asHours() < 1) {
    return `${Math.floor(duration.asMinutes())}m ${Math.round(duration.seconds())}s`;
  }
  
  if (duration.asDays() < 1) {
    return `${Math.floor(duration.asHours())}h ${Math.floor(duration.minutes())}m`;
  }
  
  return `${Math.floor(duration.asDays())}d ${Math.floor(duration.hours())}h`;
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} Promise that resolves after the delay
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {number} [maxRetries=3] - Maximum number of retries
 * @param {number} [baseDelay=1000] - Base delay in milliseconds
 * @returns {Promise} Promise with the result or final error
 */
async function retry(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      const delay = baseDelay * Math.pow(2, attempt);
      logger.warn(`Retry attempt ${attempt + 1}/${maxRetries} failed, retrying in ${delay}ms`, {
        error: error.message
      });
      
      await sleep(delay);
    }
  }
  
  throw lastError;
}

/**
 * Debounce a function
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @param {boolean} [immediate=false] - Execute on leading edge
 * @returns {Function} Debounced function
 */
function debounce(func, wait, immediate = false) {
  let timeout;
  
  return function executedFunction(...args) {
    const later = () => {
      timeout = null;
      if (!immediate) func(...args);
    };
    
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    
    if (callNow) func(...args);
  };
}

/**
 * Throttle a function
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function} Throttled function
 */
function throttle(func, limit) {
  let inThrottle;
  
  return function executedFunction(...args) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Deep clone an object
 * @param {Object} obj - Object to clone
 * @returns {Object} Cloned object
 */
function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime());
  if (obj instanceof Array) return obj.map(item => deepClone(item));
  if (typeof obj === 'object') {
    const clonedObj = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clonedObj[key] = deepClone(obj[key]);
      }
    }
    return clonedObj;
  }
}

/**
 * Remove sensitive data from objects for logging
 * @param {Object} obj - Object to sanitize
 * @param {Array} [sensitiveKeys] - Keys to redact
 * @returns {Object} Sanitized object
 */
function sanitizeForLogging(obj, sensitiveKeys = ['password', 'token', 'key', 'secret', 'auth', 'credential']) {
  const sanitized = deepClone(obj);
  
  function redactSensitiveData(item) {
    if (item === null || typeof item !== 'object') return item;
    
    if (Array.isArray(item)) {
      return item.map(redactSensitiveData);
    }
    
    const result = {};
    for (const [key, value] of Object.entries(item)) {
      const lowerKey = key.toLowerCase();
      const isSensitive = sensitiveKeys.some(sensitive => lowerKey.includes(sensitive));
      
      if (isSensitive && typeof value === 'string') {
        result[key] = '[REDACTED]';
      } else if (typeof value === 'object') {
        result[key] = redactSensitiveData(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
  
  return redactSensitiveData(sanitized);
}

/**
 * Parse user agent string
 * @param {string} userAgent - User agent string
 * @returns {Object} Parsed user agent information
 */
function parseUserAgent(userAgent) {
  const ua = userAgent || '';
  
  // Simple regex-based parsing (in production, consider using a library like 'useragent')
  const browserMatch = ua.match(/(Chrome|Firefox|Safari|Edge|Opera|Internet Explorer)\/?([\d.]+)/i);
  const osMatch = ua.match(/(Windows|Mac OS|Linux|Android|iOS)/i);
  const mobileMatch = ua.match(/(Mobile|Tablet)/i);
  
  return {
    browser: browserMatch ? browserMatch[1] : 'Unknown',
    browserVersion: browserMatch ? browserMatch[2] : 'Unknown',
    os: osMatch ? osMatch[1] : 'Unknown',
    isMobile: !!mobileMatch,
    isBot: /bot|crawler|spider|crawling/i.test(ua)
  };
}

/**
 * Extract domain from URL or email
 * @param {string} input - URL or email
 * @returns {string} Domain name
 */
function extractDomain(input) {
  try {
    // Handle email
    if (input.includes('@')) {
      return input.split('@')[1].toLowerCase();
    }
    
    // Handle URL
    const url = new URL(input.startsWith('http') ? input : `https://${input}`);
    return url.hostname.toLowerCase();
  } catch (error) {
    return input.toLowerCase();
  }
}

/**
 * Generate random string with specified charset
 * @param {number} length - Length of string
 * @param {string} [charset] - Character set to use
 * @returns {string} Random string
 */
function generateRandomString(length, charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') {
  let result = '';
  const charactersLength = charset.length;
  
  for (let i = 0; i < length; i++) {
    result += charset.charAt(Math.floor(Math.random() * charactersLength));
  }
  
  return result;
}

/**
 * Check if a date is within a specific range
 * @param {Date|string} date - Date to check
 * @param {Date|string} startDate - Start of range
 * @param {Date|string} endDate - End of range
 * @returns {boolean} Whether date is in range
 */
function isDateInRange(date, startDate, endDate) {
  const checkDate = moment(date);
  const start = moment(startDate);
  const end = moment(endDate);
  
  return checkDate.isBetween(start, end, null, '[]'); // inclusive
}

/**
 * Calculate age from birth date
 * @param {Date|string} birthDate - Birth date
 * @returns {number} Age in years
 */
function calculateAge(birthDate) {
  return moment().diff(moment(birthDate), 'years');
}

/**
 * Mask sensitive string (e.g., email, phone)
 * @param {string} str - String to mask
 * @param {number} [visibleChars=3] - Number of visible characters at start/end
 * @param {string} [maskChar='*'] - Character to use for masking
 * @returns {string} Masked string
 */
function maskString(str, visibleChars = 3, maskChar = '*') {
  if (!str || str.length <= visibleChars * 2) {
    return str;
  }
  
  const start = str.substring(0, visibleChars);
  const end = str.substring(str.length - visibleChars);
  const maskLength = str.length - (visibleChars * 2);
  
  return start + maskChar.repeat(Math.min(maskLength, 8)) + end;
}

/**
 * Convert string to title case
 * @param {string} str - String to convert
 * @returns {string} Title case string
 */
function toTitleCase(str) {
  return str.replace(/\w\S*/g, txt => 
    txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
  );
}

/**
 * Validate and normalize phone number
 * @param {string} phone - Phone number to validate
 * @param {string} [countryCode='US'] - Country code for validation
 * @returns {Object} Validation result and normalized number
 */
function validatePhoneNumber(phone, countryCode = 'US') {
  // Simple validation (in production, use a library like libphonenumber-js)
  const cleaned = phone.replace(/\D/g, '');
  const isValid = cleaned.length >= 10 && cleaned.length <= 15;
  
  return {
    isValid,
    original: phone,
    cleaned,
    formatted: isValid ? formatPhoneNumber(cleaned, countryCode) : null
  };
}

/**
 * Format phone number for display
 * @param {string} phone - Cleaned phone number
 * @param {string} [countryCode='US'] - Country code for formatting
 * @returns {string} Formatted phone number
 */
function formatPhoneNumber(phone, countryCode = 'US') {
  if (countryCode === 'US' && phone.length === 10) {
    return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`;
  }
  
  if (countryCode === 'US' && phone.length === 11 && phone.startsWith('1')) {
    const number = phone.slice(1);
    return `+1 (${number.slice(0, 3)}) ${number.slice(3, 6)}-${number.slice(6)}`;
  }
  
  return phone;
}

/**
 * Create a rate limiter map
 * @param {number} maxRequests - Maximum requests per window
 * @param {number} windowMs - Window size in milliseconds
 * @returns {Function} Rate limiter function
 */
function createRateLimiter(maxRequests, windowMs) {
  const requests = new Map();
  
  return (identifier) => {
    const now = Date.now();
    const windowStart = now - windowMs;
    
    // Get existing requests for this identifier
    const userRequests = requests.get(identifier) || [];
    
    // Filter out old requests
    const recentRequests = userRequests.filter(time => time > windowStart);
    
    // Check if limit exceeded
    if (recentRequests.length >= maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: Math.min(...recentRequests) + windowMs
      };
    }
    
    // Add current request
    recentRequests.push(now);
    requests.set(identifier, recentRequests);
    
    return {
      allowed: true,
      remaining: maxRequests - recentRequests.length,
      resetTime: now + windowMs
    };
  };
}

module.exports = {
  // Validation functions
  isValidEmail,
  sanitizeEmail,
  validatePassword,
  getPasswordStrength,
  validatePhoneNumber,
  formatPhoneNumber,
  
  // ID generation
  generateUniqueId,
  generateReadableId,
  generateRandomString,
  
  // Formatting functions
  formatBytes,
  formatDuration,
  maskString,
  toTitleCase,
  
  // Utility functions
  sleep,
  retry,
  debounce,
  throttle,
  deepClone,
  sanitizeForLogging,
  parseUserAgent,
  extractDomain,
  
  // Date functions
  isDateInRange,
  calculateAge,
  
  // Rate limiting
  createRateLimiter
};