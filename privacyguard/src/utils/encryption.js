const crypto = require('crypto');
const { createComponentLogger } = require('./logger');

const logger = createComponentLogger('encryption');

// Encryption configuration
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // For GCM, this is 12-16 bytes
const TAG_LENGTH = 16; // GCM tag length
const KEY_LENGTH = 32; // 256 bits
const SALT_LENGTH = 32; // For key derivation

/**
 * Generate a cryptographically secure random key
 * @param {number} length - Key length in bytes (default: 32 for AES-256)
 * @returns {Buffer} Random key
 */
function generateKey(length = KEY_LENGTH) {
  return crypto.randomBytes(length);
}

/**
 * Generate a cryptographically secure random salt
 * @param {number} length - Salt length in bytes (default: 32)
 * @returns {Buffer} Random salt
 */
function generateSalt(length = SALT_LENGTH) {
  return crypto.randomBytes(length);
}

/**
 * Derive a key from a password using PBKDF2
 * @param {string} password - The password to derive from
 * @param {Buffer|string} salt - Salt for key derivation
 * @param {number} iterations - Number of iterations (default: 100000)
 * @param {number} keyLength - Desired key length in bytes (default: 32)
 * @returns {Buffer} Derived key
 */
function deriveKey(password, salt, iterations = 100000, keyLength = KEY_LENGTH) {
  try {
    if (typeof salt === 'string') {
      salt = Buffer.from(salt, 'hex');
    }
    
    return crypto.pbkdf2Sync(password, salt, iterations, keyLength, 'sha256');
  } catch (error) {
    logger.error('Key derivation failed', { error: error.message });
    throw new Error('Failed to derive encryption key');
  }
}

/**
 * Encrypt data using AES-256-GCM
 * @param {string|Buffer} data - Data to encrypt
 * @param {Buffer|string} key - Encryption key
 * @param {string} [encoding='base64'] - Output encoding
 * @returns {Object} Encrypted data with IV and tag
 */
function encrypt(data, key, encoding = 'base64') {
  try {
    // Ensure key is a Buffer
    if (typeof key === 'string') {
      key = Buffer.from(key, 'hex');
    }
    
    // Generate random IV
    const iv = crypto.randomBytes(IV_LENGTH);
    
    // Create cipher
    const cipher = crypto.createCipher(ALGORITHM, key);
    cipher.setAAD(Buffer.from('PrivacyGuard', 'utf8')); // Additional authenticated data
    
    // Encrypt data
    let encrypted = cipher.update(data, 'utf8', encoding);
    encrypted += cipher.final(encoding);
    
    // Get authentication tag
    const tag = cipher.getAuthTag();
    
    return {
      encrypted,
      iv: iv.toString(encoding),
      tag: tag.toString(encoding),
      algorithm: ALGORITHM
    };
  } catch (error) {
    logger.error('Encryption failed', { error: error.message });
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt data using AES-256-GCM
 * @param {Object} encryptedData - Object containing encrypted data, IV, and tag
 * @param {Buffer|string} key - Decryption key
 * @param {string} [encoding='base64'] - Input encoding
 * @returns {string} Decrypted data
 */
function decrypt(encryptedData, key, encoding = 'base64') {
  try {
    const { encrypted, iv, tag, algorithm } = encryptedData;
    
    // Validate required fields
    if (!encrypted || !iv || !tag) {
      throw new Error('Missing required encryption fields');
    }
    
    // Ensure key is a Buffer
    if (typeof key === 'string') {
      key = Buffer.from(key, 'hex');
    }
    
    // Create decipher
    const decipher = crypto.createDecipher(algorithm || ALGORITHM, key);
    decipher.setAAD(Buffer.from('PrivacyGuard', 'utf8')); // Same AAD used in encryption
    decipher.setAuthTag(Buffer.from(tag, encoding));
    
    // Decrypt data
    let decrypted = decipher.update(encrypted, encoding, 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    logger.error('Decryption failed', { error: error.message });
    throw new Error('Failed to decrypt data');
  }
}

/**
 * Encrypt a file using AES-256-GCM
 * @param {Buffer} fileBuffer - File data to encrypt
 * @param {Buffer|string} key - Encryption key
 * @returns {Object} Encrypted file data with metadata
 */
function encryptFile(fileBuffer, key) {
  try {
    // Generate random IV
    const iv = crypto.randomBytes(IV_LENGTH);
    
    // Ensure key is a Buffer
    if (typeof key === 'string') {
      key = Buffer.from(key, 'hex');
    }
    
    // Create cipher
    const cipher = crypto.createCipher(ALGORITHM, key);
    cipher.setAAD(iv); // Use IV as additional authenticated data
    
    // Encrypt file
    const encrypted = Buffer.concat([
      cipher.update(fileBuffer),
      cipher.final()
    ]);
    
    // Get authentication tag
    const tag = cipher.getAuthTag();
    
    return {
      encrypted,
      iv,
      tag,
      algorithm: ALGORITHM,
      originalSize: fileBuffer.length,
      encryptedSize: encrypted.length
    };
  } catch (error) {
    logger.error('File encryption failed', { error: error.message });
    throw new Error('Failed to encrypt file');
  }
}

/**
 * Decrypt a file using AES-256-GCM
 * @param {Object} encryptedFile - Encrypted file data with metadata
 * @param {Buffer|string} key - Decryption key
 * @returns {Buffer} Decrypted file data
 */
function decryptFile(encryptedFile, key) {
  try {
    const { encrypted, iv, tag, algorithm } = encryptedFile;
    
    // Ensure key is a Buffer
    if (typeof key === 'string') {
      key = Buffer.from(key, 'hex');
    }
    
    // Create decipher
    const decipher = crypto.createDecipher(algorithm || ALGORITHM, key);
    decipher.setAAD(iv); // Same AAD used in encryption
    decipher.setAuthTag(tag);
    
    // Decrypt file
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
    
    return decrypted;
  } catch (error) {
    logger.error('File decryption failed', { error: error.message });
    throw new Error('Failed to decrypt file');
  }
}

/**
 * Hash data using SHA-256
 * @param {string|Buffer} data - Data to hash
 * @param {string} [encoding='hex'] - Output encoding
 * @returns {string} Hash digest
 */
function hash(data, encoding = 'hex') {
  try {
    return crypto.createHash('sha256').update(data).digest(encoding);
  } catch (error) {
    logger.error('Hashing failed', { error: error.message });
    throw new Error('Failed to hash data');
  }
}

/**
 * Generate HMAC for data integrity verification
 * @param {string|Buffer} data - Data to sign
 * @param {Buffer|string} key - HMAC key
 * @param {string} [algorithm='sha256'] - Hash algorithm
 * @param {string} [encoding='hex'] - Output encoding
 * @returns {string} HMAC digest
 */
function generateHMAC(data, key, algorithm = 'sha256', encoding = 'hex') {
  try {
    if (typeof key === 'string') {
      key = Buffer.from(key, 'hex');
    }
    
    return crypto.createHmac(algorithm, key).update(data).digest(encoding);
  } catch (error) {
    logger.error('HMAC generation failed', { error: error.message });
    throw new Error('Failed to generate HMAC');
  }
}

/**
 * Verify HMAC for data integrity
 * @param {string|Buffer} data - Original data
 * @param {string} signature - HMAC signature to verify
 * @param {Buffer|string} key - HMAC key
 * @param {string} [algorithm='sha256'] - Hash algorithm
 * @param {string} [encoding='hex'] - Input encoding
 * @returns {boolean} Verification result
 */
function verifyHMAC(data, signature, key, algorithm = 'sha256', encoding = 'hex') {
  try {
    const expectedSignature = generateHMAC(data, key, algorithm, encoding);
    return crypto.timingSafeEqual(
      Buffer.from(signature, encoding),
      Buffer.from(expectedSignature, encoding)
    );
  } catch (error) {
    logger.error('HMAC verification failed', { error: error.message });
    return false;
  }
}

/**
 * Generate a secure random token
 * @param {number} [length=32] - Token length in bytes
 * @param {string} [encoding='hex'] - Output encoding
 * @returns {string} Random token
 */
function generateToken(length = 32, encoding = 'hex') {
  try {
    return crypto.randomBytes(length).toString(encoding);
  } catch (error) {
    logger.error('Token generation failed', { error: error.message });
    throw new Error('Failed to generate token');
  }
}

/**
 * Generate a secure password hash using bcrypt-compatible format
 * @param {string} password - Password to hash
 * @param {number} [rounds=12] - Number of salt rounds
 * @returns {Promise<string>} Password hash
 */
async function hashPassword(password, rounds = 12) {
  const bcrypt = require('bcryptjs');
  try {
    return await bcrypt.hash(password, rounds);
  } catch (error) {
    logger.error('Password hashing failed', { error: error.message });
    throw new Error('Failed to hash password');
  }
}

/**
 * Verify a password against its hash
 * @param {string} password - Plain text password
 * @param {string} hash - Stored password hash
 * @returns {Promise<boolean>} Verification result
 */
async function verifyPassword(password, hash) {
  const bcrypt = require('bcryptjs');
  try {
    return await bcrypt.compare(password, hash);
  } catch (error) {
    logger.error('Password verification failed', { error: error.message });
    return false;
  }
}

/**
 * Encrypt sensitive user data with user-specific key
 * @param {string} data - Data to encrypt
 * @param {string} userPassword - User's password for key derivation
 * @param {string} userSalt - User's unique salt
 * @returns {Object} Encrypted data with metadata
 */
function encryptUserData(data, userPassword, userSalt) {
  try {
    // Derive encryption key from user password and salt
    const key = deriveKey(userPassword, userSalt);
    
    // Encrypt the data
    const encrypted = encrypt(data, key);
    
    // Add user-specific metadata
    return {
      ...encrypted,
      keyDerivation: {
        algorithm: 'pbkdf2',
        hash: 'sha256',
        iterations: 100000,
        salt: userSalt
      }
    };
  } catch (error) {
    logger.error('User data encryption failed', { error: error.message });
    throw new Error('Failed to encrypt user data');
  }
}

/**
 * Decrypt sensitive user data with user-specific key
 * @param {Object} encryptedData - Encrypted data with metadata
 * @param {string} userPassword - User's password for key derivation
 * @returns {string} Decrypted data
 */
function decryptUserData(encryptedData, userPassword) {
  try {
    const { keyDerivation } = encryptedData;
    
    if (!keyDerivation || !keyDerivation.salt) {
      throw new Error('Missing key derivation information');
    }
    
    // Derive decryption key from user password and stored salt
    const key = deriveKey(
      userPassword,
      keyDerivation.salt,
      keyDerivation.iterations || 100000
    );
    
    // Decrypt the data
    return decrypt(encryptedData, key);
  } catch (error) {
    logger.error('User data decryption failed', { error: error.message });
    throw new Error('Failed to decrypt user data');
  }
}

/**
 * Create a secure checksum for file integrity verification
 * @param {Buffer} data - File data
 * @param {string} [algorithm='sha256'] - Hash algorithm
 * @returns {Object} Checksums using multiple algorithms
 */
function createChecksum(data, algorithm = 'sha256') {
  try {
    return {
      md5: crypto.createHash('md5').update(data).digest('hex'),
      sha1: crypto.createHash('sha1').update(data).digest('hex'),
      sha256: crypto.createHash('sha256').update(data).digest('hex'),
      sha512: crypto.createHash('sha512').update(data).digest('hex')
    };
  } catch (error) {
    logger.error('Checksum creation failed', { error: error.message });
    throw new Error('Failed to create checksum');
  }
}

/**
 * Verify file integrity using checksum
 * @param {Buffer} data - File data to verify
 * @param {Object} expectedChecksums - Expected checksum values
 * @returns {Object} Verification results for each algorithm
 */
function verifyChecksum(data, expectedChecksums) {
  try {
    const actualChecksums = createChecksum(data);
    
    const results = {};
    for (const [algorithm, expectedHash] of Object.entries(expectedChecksums)) {
      results[algorithm] = actualChecksums[algorithm] === expectedHash;
    }
    
    return {
      verified: Object.values(results).every(result => result),
      results,
      actualChecksums
    };
  } catch (error) {
    logger.error('Checksum verification failed', { error: error.message });
    throw new Error('Failed to verify checksum');
  }
}

module.exports = {
  // Core encryption functions
  generateKey,
  generateSalt,
  deriveKey,
  encrypt,
  decrypt,
  
  // File encryption
  encryptFile,
  decryptFile,
  
  // Hashing and integrity
  hash,
  generateHMAC,
  verifyHMAC,
  createChecksum,
  verifyChecksum,
  
  // Utility functions
  generateToken,
  hashPassword,
  verifyPassword,
  
  // User-specific encryption
  encryptUserData,
  decryptUserData,
  
  // Constants
  ALGORITHM,
  IV_LENGTH,
  TAG_LENGTH,
  KEY_LENGTH,
  SALT_LENGTH
};