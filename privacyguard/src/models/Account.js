const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  platform: {
    type: String,
    required: true
  },
  platformId: String,
  email: String,
  username: String,
  status: {
    type: String,
    enum: ['active', 'inactive', 'deleted', 'pending_deletion', 'unknown'],
    default: 'active'
  },
  detectionMethod: {
    type: String,
    enum: ['password_reset', 'api_enumeration', 'social_graph', 'breach_data', 'manual', 'email_scan']
  },
  confidence: {
    type: Number,
    min: 0,
    max: 100,
    default: 50
  },
  lastVerified: Date,
  dataExtracted: {
    status: {
      type: String,
      enum: ['not_started', 'in_progress', 'completed', 'failed'],
      default: 'not_started'
    },
    lastExtraction: Date,
    dataTypes: [String],
    archiveId: String
  },
  deletion: {
    status: {
      type: String,
      enum: ['not_started', 'in_progress', 'completed', 'failed', 'verified', 'partially_deleted'],
      default: 'not_started'
    },
    method: {
      type: String,
      enum: ['automated', 'manual', 'gdpr_request', 'ccpa_request', 'api', 'scraping']
    },
    requestedAt: Date,
    completedAt: Date,
    verifiedAt: Date,
    attempts: [{
      date: { type: Date, default: Date.now },
      status: {
        type: String,
        enum: ['pending', 'in_progress', 'completed', 'failed', 'timeout']
      },
      method: String,
      error: String,
      response: String,
      duration: Number,
      screenshotPath: String
    }],
    verificationMethods: [String],
    backupCreated: {
      type: Boolean,
      default: false
    }
  },
  metadata: {
    createdDate: Date,
    lastActivity: Date,
    dataSize: Number,
    hasPaymentMethod: Boolean,
    subscription: String,
    profileUrl: String,
    accountType: String,
    followers: Number,
    following: Number,
    postsCount: Number,
    isVerified: Boolean,
    accountAge: Number,
    lastKnownLocation: String,
    connectionInfo: {
      friends: Number,
      connections: Number,
      groups: [String],
      pages: [String]
    }
  },
  credentials: {
    encryptedPassword: String,
    encryptionIV: String,
    oauth: {
      provider: String,
      token: String,
      refreshToken: String,
      expiresAt: Date,
      scope: [String]
    },
    apiKeys: {
      accessToken: String,
      apiKey: String,
      secret: String
    },
    sessionData: {
      cookies: String,
      userAgent: String,
      headers: String,
      lastUsed: Date
    }
  },
  privacy: {
    riskLevel: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium'
    },
    dataTypes: {
      personal: { type: Boolean, default: false },
      financial: { type: Boolean, default: false },
      health: { type: Boolean, default: false },
      location: { type: Boolean, default: false },
      biometric: { type: Boolean, default: false },
      behavioral: { type: Boolean, default: false }
    },
    sensitivityScore: {
      type: Number,
      min: 0,
      max: 10,
      default: 5
    },
    breaches: [{
      source: String,
      date: Date,
      dataTypes: [String],
      severity: String,
      verified: Boolean
    }]
  },
  monitoring: {
    enabled: {
      type: Boolean,
      default: true
    },
    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly'],
      default: 'weekly'
    },
    lastCheck: Date,
    alerts: [{
      type: String,
      message: String,
      severity: String,
      date: Date,
      resolved: Boolean
    }]
  }
}, {
  timestamps: true
});

// Indexes for efficient querying
accountSchema.index({ userId: 1, platform: 1, email: 1 });
accountSchema.index({ userId: 1, status: 1 });
accountSchema.index({ platform: 1, status: 1 });
accountSchema.index({ 'deletion.status': 1 });
accountSchema.index({ 'dataExtracted.status': 1 });
accountSchema.index({ detectionMethod: 1 });
accountSchema.index({ confidence: -1 });
accountSchema.index({ lastVerified: -1 });

// Instance methods
accountSchema.methods.addDeletionAttempt = function(method, status, error = null, response = null, duration = null) {
  this.deletion.attempts.push({
    date: new Date(),
    status,
    method,
    error,
    response,
    duration
  });
  
  // Keep only last 10 attempts
  if (this.deletion.attempts.length > 10) {
    this.deletion.attempts = this.deletion.attempts.slice(-10);
  }
};

accountSchema.methods.updateDeletionStatus = function(status, method = null) {
  this.deletion.status = status;
  if (method) this.deletion.method = method;
  
  if (status === 'in_progress' && !this.deletion.requestedAt) {
    this.deletion.requestedAt = new Date();
  }
  
  if (status === 'completed' && !this.deletion.completedAt) {
    this.deletion.completedAt = new Date();
  }
};

accountSchema.methods.addBreachRecord = function(source, dataTypes, severity = 'medium') {
  const existingBreach = this.privacy.breaches.find(b => b.source === source);
  if (!existingBreach) {
    this.privacy.breaches.push({
      source,
      date: new Date(),
      dataTypes,
      severity,
      verified: false
    });
  }
};

accountSchema.methods.calculateSensitivityScore = function() {
  let score = 0;
  
  // Base score from data types
  Object.entries(this.privacy.dataTypes).forEach(([type, hasData]) => {
    if (hasData) {
      switch(type) {
        case 'financial':
        case 'health':
        case 'biometric':
          score += 3;
          break;
        case 'personal':
        case 'location':
          score += 2;
          break;
        case 'behavioral':
          score += 1;
          break;
      }
    }
  });
  
  // Breach history impact
  score += this.privacy.breaches.length;
  
  // Account metadata impact
  if (this.metadata.hasPaymentMethod) score += 2;
  if (this.metadata.isVerified) score += 1;
  
  this.privacy.sensitivityScore = Math.min(score, 10);
  return this.privacy.sensitivityScore;
};

accountSchema.methods.calculateRiskLevel = function() {
  const score = this.calculateSensitivityScore();
  
  if (score <= 3) {
    this.privacy.riskLevel = 'low';
  } else if (score <= 6) {
    this.privacy.riskLevel = 'medium';
  } else if (score <= 8) {
    this.privacy.riskLevel = 'high';
  } else {
    this.privacy.riskLevel = 'critical';
  }
  
  return this.privacy.riskLevel;
};

accountSchema.methods.addAlert = function(type, message, severity = 'medium') {
  this.monitoring.alerts.push({
    type,
    message,
    severity,
    date: new Date(),
    resolved: false
  });
  
  // Keep only last 20 alerts
  if (this.monitoring.alerts.length > 20) {
    this.monitoring.alerts = this.monitoring.alerts.slice(-20);
  }
};

accountSchema.methods.canAttemptDeletion = function() {
  const recentFailedAttempts = this.deletion.attempts.filter(
    attempt => attempt.status === 'failed' && 
    Date.now() - attempt.date.getTime() < 24 * 60 * 60 * 1000 // 24 hours
  );
  
  return recentFailedAttempts.length < 3;
};

// Static methods
accountSchema.statics.findByPlatform = function(platform, userId = null) {
  const query = { platform };
  if (userId) query.userId = userId;
  return this.find(query);
};

accountSchema.statics.findPendingDeletion = function(userId = null) {
  const query = { 'deletion.status': { $in: ['not_started', 'in_progress'] } };
  if (userId) query.userId = userId;
  return this.find(query);
};

accountSchema.statics.findHighRisk = function(userId = null) {
  const query = { 'privacy.riskLevel': { $in: ['high', 'critical'] } };
  if (userId) query.userId = userId;
  return this.find(query);
};

accountSchema.statics.getDiscoveryStats = function(userId) {
  return this.aggregate([
    { $match: { userId: mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: '$detectionMethod',
        count: { $sum: 1 },
        avgConfidence: { $avg: '$confidence' }
      }
    }
  ]);
};

accountSchema.statics.getPlatformStats = function(userId) {
  return this.aggregate([
    { $match: { userId: mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: '$platform',
        total: { $sum: 1 },
        active: {
          $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
        },
        deleted: {
          $sum: { $cond: [{ $eq: ['$deletion.status', 'completed'] }, 1, 0] }
        },
        avgRisk: { $avg: '$privacy.sensitivityScore' }
      }
    }
  ]);
};

accountSchema.statics.findDueForMonitoring = function() {
  const now = new Date();
  return this.find({
    'monitoring.enabled': true,
    $or: [
      { 'monitoring.lastCheck': { $exists: false } },
      {
        $expr: {
          $lt: [
            '$monitoring.lastCheck',
            {
              $dateSubtract: {
                startDate: now,
                unit: 'day',
                amount: {
                  $switch: {
                    branches: [
                      { case: { $eq: ['$monitoring.frequency', 'daily'] }, then: 1 },
                      { case: { $eq: ['$monitoring.frequency', 'weekly'] }, then: 7 },
                      { case: { $eq: ['$monitoring.frequency', 'monthly'] }, then: 30 }
                    ],
                    default: 7
                  }
                }
              }
            }
          ]
        }
      }
    ]
  });
};

module.exports = mongoose.model('Account', accountSchema);