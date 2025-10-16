const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true
  },
  profile: {
    fullName: String,
    phoneNumbers: [String],
    alternativeEmails: [String],
    commonUsernames: [String],
    birthDate: Date,
    location: {
      country: String,
      state: String,
      city: String
    }
  },
  subscription: {
    tier: {
      type: String,
      enum: ['free', 'privacy', 'professional', 'enterprise'],
      default: 'free'
    },
    startDate: Date,
    endDate: Date,
    stripeCustomerId: String,
    stripeSubscriptionId: String
  },
  privacySettings: {
    monitoringEnabled: {
      type: Boolean,
      default: true
    },
    alertPreferences: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      push: { type: Boolean, default: true },
      breachAlerts: { type: Boolean, default: true },
      deletionUpdates: { type: Boolean, default: true },
      monthlyReports: { type: Boolean, default: true }
    },
    retentionPeriod: {
      type: Number,
      default: 365
    },
    autoDeleteExpiredData: {
      type: Boolean,
      default: true
    },
    dataEncryptionEnabled: {
      type: Boolean,
      default: true
    }
  },
  security: {
    emailVerified: {
      type: Boolean,
      default: false
    },
    twoFactorEnabled: {
      type: Boolean,
      default: false
    },
    twoFactorSecret: String,
    loginAttempts: {
      type: Number,
      default: 0
    },
    lockUntil: Date,
    passwordResetToken: String,
    passwordResetExpires: Date,
    emailVerificationToken: String,
    emailVerificationExpires: Date
  },
  encryption: {
    masterKey: String,
    keyDerivationSalt: String,
    keyDerivationRounds: {
      type: Number,
      default: 100000
    }
  },
  usage: {
    accountsDiscovered: {
      type: Number,
      default: 0
    },
    accountsDeleted: {
      type: Number,
      default: 0
    },
    dataExtracted: {
      type: Number,
      default: 0
    },
    breachesFound: {
      type: Number,
      default: 0
    },
    lastLogin: Date,
    totalLogins: {
      type: Number,
      default: 0
    }
  },
  lastBreachCheck: Date,
  lastAccountDiscovery: Date,
  lastDataExtraction: Date,
  lastComplianceCheck: Date,
  isActive: {
    type: Boolean,
    default: true
  },
  deactivatedAt: Date,
  deactivationReason: String
}, {
  timestamps: true
});

// Indexes for efficient querying
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ 'subscription.stripeCustomerId': 1 });
userSchema.index({ 'security.emailVerified': 1 });
userSchema.index({ isActive: 1 });
userSchema.index({ lastLogin: -1 });

// Pre-save middleware
userSchema.pre('save', async function(next) {
  // Hash password if modified
  if (this.isModified('password')) {
    const rounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    this.password = await bcrypt.hash(this.password, rounds);
  }
  
  // Generate master encryption key for new users
  if (this.isNew && !this.encryption.masterKey) {
    this.encryption.keyDerivationSalt = crypto.randomBytes(32).toString('hex');
    this.encryption.masterKey = crypto.randomBytes(32).toString('hex');
  }
  
  next();
});

// Instance methods
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.generatePasswordResetToken = function() {
  const token = crypto.randomBytes(20).toString('hex');
  this.security.passwordResetToken = crypto.createHash('sha256').update(token).digest('hex');
  this.security.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
  return token;
};

userSchema.methods.generateEmailVerificationToken = function() {
  const token = crypto.randomBytes(20).toString('hex');
  this.security.emailVerificationToken = crypto.createHash('sha256').update(token).digest('hex');
  this.security.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  return token;
};

userSchema.methods.incrementLoginAttempts = function() {
  // Lock account after 5 failed attempts for 2 hours
  if (this.security.loginAttempts + 1 >= 5 && !this.security.lockUntil) {
    this.security.lockUntil = Date.now() + 2 * 60 * 60 * 1000;
  }
  this.security.loginAttempts += 1;
  return this.save();
};

userSchema.methods.resetLoginAttempts = function() {
  this.security.loginAttempts = 0;
  this.security.lockUntil = undefined;
  this.usage.lastLogin = new Date();
  this.usage.totalLogins += 1;
  return this.save();
};

userSchema.methods.deriveEncryptionKey = function(password) {
  const salt = Buffer.from(this.encryption.keyDerivationSalt, 'hex');
  return crypto.pbkdf2Sync(password, salt, this.encryption.keyDerivationRounds, 32, 'sha256');
};

userSchema.methods.updateUsageStats = function(type, increment = 1) {
  switch(type) {
    case 'accountsDiscovered':
      this.usage.accountsDiscovered += increment;
      break;
    case 'accountsDeleted':
      this.usage.accountsDeleted += increment;
      break;
    case 'dataExtracted':
      this.usage.dataExtracted += increment;
      break;
    case 'breachesFound':
      this.usage.breachesFound += increment;
      break;
  }
  return this.save();
};

// Virtual properties
userSchema.virtual('isLocked').get(function() {
  return !!(this.security.lockUntil && this.security.lockUntil > Date.now());
});

userSchema.virtual('subscriptionActive').get(function() {
  return this.subscription.endDate && this.subscription.endDate > new Date();
});

userSchema.virtual('privacyScore').get(function() {
  let score = 0;
  
  // Email verification
  if (this.security.emailVerified) score += 20;
  
  // Two-factor authentication
  if (this.security.twoFactorEnabled) score += 30;
  
  // Data encryption enabled
  if (this.privacySettings.dataEncryptionEnabled) score += 25;
  
  // Monitoring enabled
  if (this.privacySettings.monitoringEnabled) score += 15;
  
  // Auto-delete expired data
  if (this.privacySettings.autoDeleteExpiredData) score += 10;
  
  return Math.min(score, 100);
});

// Static methods
userSchema.statics.findByEmail = function(email) {
  return this.findOne({ email: email.toLowerCase() });
};

userSchema.statics.findByPasswordResetToken = function(token) {
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  return this.findOne({
    'security.passwordResetToken': hashedToken,
    'security.passwordResetExpires': { $gt: Date.now() }
  });
};

userSchema.statics.findByEmailVerificationToken = function(token) {
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  return this.findOne({
    'security.emailVerificationToken': hashedToken,
    'security.emailVerificationExpires': { $gt: Date.now() }
  });
};

userSchema.statics.getSubscriptionStats = function() {
  return this.aggregate([
    {
      $group: {
        _id: '$subscription.tier',
        count: { $sum: 1 },
        activeCount: {
          $sum: {
            $cond: [
              { $gt: ['$subscription.endDate', new Date()] },
              1,
              0
            ]
          }
        }
      }
    }
  ]);
};

module.exports = mongoose.model('User', userSchema);