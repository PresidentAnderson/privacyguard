const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;
const EncryptedStorageManager = require('./EncryptedStorageManager');
const DataTimelineEngine = require('./DataTimelineEngine');
const PersonalSearchIndex = require('./PersonalSearchIndex');
const MetadataExtractor = require('./MetadataExtractor');
const logger = require('../utils/logger');

class PersonalArchiveSystem {
  constructor() {
    this.storageManager = new EncryptedStorageManager();
    this.timelineEngine = new DataTimelineEngine();
    this.searchIndex = new PersonalSearchIndex();
    this.metadataExtractor = new MetadataExtractor();
  }

  async archiveExtractedData(platform, data, extractionDate, userId) {
    logger.info(`Archiving data for ${platform}`, {
      dataSize: JSON.stringify(data).length,
      extractionDate
    });

    try {
      // Create platform-specific archive structure
      const archivePath = await this.createArchiveStructure(platform, extractionDate, userId);
      
      // Process different data types
      const processedData = await this.processDataByType(platform, data);
      
      // Extract comprehensive metadata
      const metadata = await this.metadataExtractor.extractAllMetadata(
        platform,
        data,
        extractionDate
      );

      // Store with encryption
      const encryptionKey = await this.getUserEncryptionKey(userId);
      const archiveId = await this.storageManager.storeEncrypted({
        path: archivePath,
        data: processedData,
        metadata,
        encryptionKey
      });

      // Index for search
      await this.searchIndex.indexArchive(archiveId, metadata, userId);
      
      // Update timeline
      await this.timelineEngine.addTimelineEntry({
        userId,
        platform,
        extractionDate,
        metadata,
        archiveId
      });

      logger.info(`Archive created successfully`, { archiveId, platform });

      return {
        archiveId,
        path: archivePath,
        size: metadata.totalSize,
        itemCount: metadata.totalItems,
        encryptionStatus: 'encrypted'
      };

    } catch (error) {
      logger.error(`Archive creation failed for ${platform}`, error);
      throw error;
    }
  }

  async createArchiveStructure(platform, date, userId) {
    const baseDir = await this.getArchiveRoot(userId);
    
    // Create organized directory structure
    const platformDir = path.join(baseDir, platform.toLowerCase());
    const yearDir = path.join(platformDir, date.getFullYear().toString());
    const monthDir = path.join(yearDir, (date.getMonth() + 1).toString().padStart(2, '0'));
    
    const structure = {
      photos: path.join(monthDir, 'photos'),
      messages: path.join(monthDir, 'messages'),
      posts: path.join(monthDir, 'posts'),
      contacts: path.join(monthDir, 'contacts'),
      activity: path.join(monthDir, 'activity'),
      metadata: path.join(monthDir, 'metadata'),
      raw_data: path.join(monthDir, 'raw')
    };

    // Create all directories
    for (const dir of Object.values(structure)) {
      await fs.mkdir(dir, { recursive: true });
    }

    return structure;
  }

  async processDataByType(platform, data) {
    const processed = {
      photos: [],
      messages: [],
      posts: [],
      contacts: [],
      activity: [],
      raw: data
    };

    // Process photos/media
    if (data.photos || data.mediaItems) {
      processed.photos = await this.processPhotos(data.photos || data.mediaItems);
    }

    // Process messages
    if (data.messages || data.conversations) {
      processed.messages = await this.processMessages(data.messages || data.conversations);
    }

    // Process posts
    if (data.posts || data.tweets || data.statuses) {
      processed.posts = await this.processPosts(data.posts || data.tweets || data.statuses);
    }

    // Process contacts
    if (data.contacts || data.friends || data.connections) {
      processed.contacts = await this.processContacts(data.contacts || data.friends || data.connections);
    }

    // Process activity
    if (data.activity || data.history) {
      processed.activity = await this.processActivity(data.activity || data.history);
    }

    return processed;
  }

  async processPhotos(photos) {
    if (!Array.isArray(photos)) return [];

    return photos.map(photo => ({
      id: photo.id || crypto.randomBytes(16).toString('hex'),
      filename: photo.filename || photo.name,
      url: photo.url || photo.productUrl,
      timestamp: photo.createdTime || photo.timestamp,
      location: photo.location || this.extractLocationFromMetadata(photo),
      tags: photo.tags || [],
      faces: photo.faces || [],
      metadata: {
        width: photo.width,
        height: photo.height,
        size: photo.size,
        mimeType: photo.mimeType
      }
    }));
  }

  async processMessages(messages) {
    if (!Array.isArray(messages)) return [];

    const processedMessages = [];
    
    for (const conversation of messages) {
      const processed = {
        conversationId: conversation.id || crypto.randomBytes(16).toString('hex'),
        participants: conversation.participants || [],
        messages: []
      };

      if (conversation.messages) {
        processed.messages = conversation.messages.map(msg => ({
          id: msg.id,
          sender: msg.sender || msg.from,
          timestamp: msg.timestamp || msg.sentTime,
          content: msg.content || msg.text,
          attachments: msg.attachments || [],
          reactions: msg.reactions || []
        }));
      }

      processedMessages.push(processed);
    }

    return processedMessages;
  }

  async processPosts(posts) {
    if (!Array.isArray(posts)) return [];

    return posts.map(post => ({
      id: post.id || crypto.randomBytes(16).toString('hex'),
      timestamp: post.createdTime || post.timestamp,
      content: post.content || post.text || post.message,
      attachments: post.attachments || [],
      engagement: {
        likes: post.likes || post.favoriteCount || 0,
        shares: post.shares || post.retweetCount || 0,
        comments: post.comments || post.replyCount || 0
      },
      privacy: post.privacy || 'unknown',
      location: post.location,
      tags: post.tags || []
    }));
  }

  async processContacts(contacts) {
    if (!Array.isArray(contacts)) return [];

    return contacts.map(contact => ({
      id: contact.id || crypto.randomBytes(16).toString('hex'),
      name: contact.name || `${contact.firstName} ${contact.lastName}`.trim(),
      email: contact.email,
      phone: contact.phone,
      profileUrl: contact.profileUrl,
      connectionDate: contact.connectionDate,
      relationship: contact.relationship || 'contact'
    }));
  }

  async processActivity(activity) {
    if (!Array.isArray(activity)) return [];

    return activity.map(item => ({
      id: item.id || crypto.randomBytes(16).toString('hex'),
      timestamp: item.timestamp || item.time,
      type: item.type || 'unknown',
      description: item.description || item.title,
      details: item.details || {},
      location: item.location
    }));
  }

  async getUserEncryptionKey(userId) {
    // Get or generate user-specific encryption key
    const User = require('../models/User');
    const user = await User.findById(userId);
    
    if (!user.encryptionKey) {
      // Generate new encryption key
      user.encryptionKey = crypto.randomBytes(32).toString('hex');
      await user.save();
    }

    return user.encryptionKey;
  }

  async getArchiveRoot(userId) {
    // Get user-specific archive root directory
    const baseDir = process.env.ARCHIVE_BASE_DIR || './archives';
    const userDir = path.join(baseDir, userId.toString());
    
    await fs.mkdir(userDir, { recursive: true });
    return userDir;
  }

  extractLocationFromMetadata(item) {
    // Extract location from various metadata formats
    if (item.gpsLocation) {
      return item.gpsLocation;
    }
    
    if (item.metadata?.location) {
      return item.metadata.location;
    }
    
    if (item.latitude && item.longitude) {
      return {
        lat: item.latitude,
        lng: item.longitude
      };
    }
    
    return null;
  }

  async searchArchive(userId, query, options = {}) {
    return await this.searchIndex.search(userId, query, options);
  }

  async getTimeline(userId, dateRange) {
    return await this.timelineEngine.buildComprehensiveTimeline(userId, dateRange);
  }

  async getArchiveStats(userId) {
    const stats = await this.storageManager.getStorageStats(userId);
    const timeline = await this.timelineEngine.getTimelineStats(userId);
    
    return {
      totalSize: stats.totalSize,
      platformCount: stats.platformCount,
      oldestData: timeline.oldestEntry,
      newestData: timeline.newestEntry,
      totalItems: stats.totalItems,
      breakdown: stats.breakdown
    };
  }
}

module.exports = PersonalArchiveSystem;