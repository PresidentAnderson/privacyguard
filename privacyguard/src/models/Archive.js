const mongoose = require('mongoose');

const archiveSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  accountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    required: true
  },
  platform: {
    type: String,
    required: true
  },
  archiveId: {
    type: String,
    required: true,
    unique: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'encrypted'],
    default: 'pending'
  },
  dataTypes: [{
    type: {
      type: String,
      enum: [
        'profile', 'posts', 'messages', 'photos', 'videos', 'contacts',
        'location_data', 'search_history', 'ad_preferences', 'payment_data',
        'activity_logs', 'settings', 'connections', 'groups', 'events',
        'comments', 'likes', 'shares', 'bookmarks', 'analytics'
      ]
    },
    extractedAt: Date,
    fileCount: Number,
    dataSize: Number,
    status: {
      type: String,
      enum: ['pending', 'extracted', 'failed'],
      default: 'pending'
    }
  }],
  extraction: {
    method: {
      type: String,
      enum: ['api', 'gdpr_request', 'scraping', 'manual_upload'],
      required: true
    },
    startedAt: Date,
    completedAt: Date,
    extractedDataSize: Number,
    fileCount: Number,
    errors: [String],
    retryCount: {
      type: Number,
      default: 0
    }
  },
  storage: {
    provider: {
      type: String,
      enum: ['local', 'aws_s3', 'google_cloud', 'azure'],
      default: 'local'
    },
    bucketName: String,
    filePath: String,
    encryptionKey: String,
    checksumMd5: String,
    checksumSha256: String,
    compressedSize: Number,
    uncompressedSize: Number
  },
  timeline: {
    reconstructed: {
      type: Boolean,
      default: false
    },
    timelineData: {
      startDate: Date,
      endDate: Date,
      eventCount: Number,
      categories: [String]
    },
    lastTimelineUpdate: Date
  },
  searchIndex: {
    indexed: {
      type: Boolean,
      default: false
    },
    indexedAt: Date,
    searchableFields: [String],
    tags: [String],
    keywords: [String]
  },
  privacy: {
    isEncrypted: {
      type: Boolean,
      default: true
    },
    encryptionAlgorithm: {
      type: String,
      default: 'AES-256-GCM'
    },
    accessLog: [{
      timestamp: Date,
      action: String,
      ipAddress: String,
      userAgent: String
    }]
  },
  retention: {
    retentionPolicy: {
      type: String,
      enum: ['user_defined', 'legal_hold', 'auto_delete', 'permanent'],
      default: 'user_defined'
    },
    expiresAt: Date,
    autoDeleteEnabled: {
      type: Boolean,
      default: true
    }
  },
  metadata: {
    originalFormat: String,
    mimeTypes: [String],
    languages: [String],
    personalDataTypes: [String],
    sensitivityScore: {
      type: Number,
      min: 0,
      max: 10,
      default: 5
    },
    qualityScore: {
      type: Number,
      min: 0,
      max: 10
    }
  },
  sharing: {
    isShared: {
      type: Boolean,
      default: false
    },
    sharedWith: [{
      email: String,
      permissions: [String],
      sharedAt: Date,
      expiresAt: Date
    }],
    publicUrl: String,
    accessToken: String
  }
}, {
  timestamps: true
});

// Indexes for efficient querying
archiveSchema.index({ userId: 1, platform: 1 });
archiveSchema.index({ status: 1 });
archiveSchema.index({ 'retention.expiresAt': 1 });
archiveSchema.index({ 'searchIndex.keywords': 1 });
archiveSchema.index({ 'searchIndex.tags': 1 });
archiveSchema.index({ createdAt: -1 });

// Instance methods
archiveSchema.methods.updateSearchIndex = function(keywords, tags) {
  this.searchIndex.keywords = keywords;
  this.searchIndex.tags = tags;
  this.searchIndex.indexed = true;
  this.searchIndex.indexedAt = new Date();
};

archiveSchema.methods.logAccess = function(action, ipAddress, userAgent) {
  this.privacy.accessLog.push({
    timestamp: new Date(),
    action,
    ipAddress,
    userAgent
  });
  
  // Keep only last 100 access logs
  if (this.privacy.accessLog.length > 100) {
    this.privacy.accessLog = this.privacy.accessLog.slice(-100);
  }
};

archiveSchema.methods.calculateSensitivityScore = function() {
  let score = 0;
  const sensitiveTypes = ['payment_data', 'location_data', 'messages', 'photos'];
  
  this.dataTypes.forEach(dataType => {
    if (sensitiveTypes.includes(dataType.type)) {
      score += 2;
    } else {
      score += 1;
    }
  });
  
  this.metadata.sensitivityScore = Math.min(score, 10);
  return this.metadata.sensitivityScore;
};

// Static methods
archiveSchema.statics.findExpired = function() {
  return this.find({
    'retention.expiresAt': { $lt: new Date() },
    'retention.autoDeleteEnabled': true
  });
};

archiveSchema.statics.findByPlatform = function(platform, userId) {
  return this.find({ platform, userId }).populate('accountId');
};

archiveSchema.statics.getStorageStats = function(userId) {
  return this.aggregate([
    { $match: { userId: mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: '$platform',
        totalSize: { $sum: '$storage.compressedSize' },
        count: { $sum: 1 },
        avgSize: { $avg: '$storage.compressedSize' }
      }
    }
  ]);
};

module.exports = mongoose.model('Archive', archiveSchema);