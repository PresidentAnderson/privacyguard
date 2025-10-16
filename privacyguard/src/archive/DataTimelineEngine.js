const logger = require('../utils/logger');

class DataTimelineEngine {
  constructor() {
    this.timelineCache = new Map();
  }

  async buildComprehensiveTimeline(userId, dateRange) {
    logger.info(`Building timeline for user ${userId}`);
    
    try {
      // Get all archives for user
      const archives = await this.getUserArchives(userId, dateRange);
      
      // Extract chronological events
      const timelineEvents = [];
      for (const archive of archives) {
        const events = await this.extractChronologicalEvents(archive);
        timelineEvents.push(...events);
      }

      // Sort chronologically
      timelineEvents.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      // Deduplicate cross-platform events
      const deduplicated = await this.deduplicateCrossPlatform(timelineEvents);
      
      // Analyze patterns and generate insights
      const insights = await this.analyzeTimelinePatterns(deduplicated);
      
      // Calculate statistics
      const statistics = this.calculateTimelineStats(deduplicated);

      return {
        events: deduplicated,
        insights,
        statistics,
        dateRange,
        generatedAt: new Date()
      };

    } catch (error) {
      logger.error('Timeline generation failed', error);
      throw error;
    }
  }

  async extractChronologicalEvents(archive) {
    const events = [];
    
    // Extract photo events
    if (archive.data.photos) {
      for (const photo of archive.data.photos) {
        events.push({
          id: `photo_${photo.id}`,
          type: 'photo_upload',
          platform: archive.platform,
          timestamp: photo.timestamp || photo.createdTime,
          content: {
            fileName: photo.filename,
            location: photo.location,
            faces: photo.faces || [],
            tags: photo.tags || []
          },
          privacy: 'private',
          searchableText: `${photo.filename} ${(photo.tags || []).join(' ')}`
        });
      }
    }

    // Extract post events
    if (archive.data.posts) {
      for (const post of archive.data.posts) {
        events.push({
          id: `post_${post.id}`,
          type: 'social_post',
          platform: archive.platform,
          timestamp: post.timestamp,
          content: {
            text: post.content,
            engagement: post.engagement,
            privacy: post.privacy,
            attachments: post.attachments?.length || 0
          },
          privacy: post.privacy || 'unknown',
          searchableText: post.content
        });
      }
    }

    // Extract message events
    if (archive.data.messages) {
      for (const conversation of archive.data.messages) {
        for (const message of conversation.messages || []) {
          events.push({
            id: `message_${message.id}`,
            type: 'message',
            platform: archive.platform,
            timestamp: message.timestamp,
            content: {
              conversationId: conversation.conversationId,
              participants: conversation.participants,
              hasAttachments: message.attachments?.length > 0
            },
            privacy: 'private',
            searchableText: message.content
          });
        }
      }
    }

    // Extract activity events
    if (archive.data.activity) {
      for (const activity of archive.data.activity) {
        events.push({
          id: `activity_${activity.id}`,
          type: `activity_${activity.type}`,
          platform: archive.platform,
          timestamp: activity.timestamp,
          content: {
            description: activity.description,
            details: activity.details
          },
          privacy: 'private',
          searchableText: activity.description
        });
      }
    }

    return events;
  }

  async deduplicateCrossPlatform(events) {
    const deduplicated = [];
    const seen = new Map();

    for (const event of events) {
      // Create a signature for potential duplicates
      const signature = this.createEventSignature(event);
      
      if (!seen.has(signature)) {
        seen.set(signature, event);
        deduplicated.push(event);
      } else {
        // Merge information from duplicate events
        const existing = seen.get(signature);
        existing.platforms = existing.platforms || [existing.platform];
        if (!existing.platforms.includes(event.platform)) {
          existing.platforms.push(event.platform);
        }
      }
    }

    return deduplicated;
  }

  createEventSignature(event) {
    // Create signature for detecting cross-platform duplicates
    const timestamp = new Date(event.timestamp);
    const timeWindow = new Date(timestamp);
    timeWindow.setMinutes(Math.floor(timeWindow.getMinutes() / 5) * 5); // 5-minute window
    
    if (event.type === 'photo_upload' && event.content.fileName) {
      return `photo_${event.content.fileName}_${timeWindow.toISOString()}`;
    }
    
    if (event.type === 'social_post' && event.content.text) {
      const textPreview = event.content.text.substring(0, 50);
      return `post_${textPreview}_${timeWindow.toISOString()}`;
    }
    
    return `${event.type}_${timeWindow.toISOString()}_${event.platform}`;
  }

  async analyzeTimelinePatterns(events) {
    const insights = {
      activityPeriods: this.findActivityPeriods(events),
      platformUsage: this.analyzePlatformUsage(events),
      privacyTrends: this.analyzePrivacyTrends(events),
      communicationPatterns: this.analyzeCommunicationPatterns(events),
      contentTypes: this.analyzeContentTypes(events),
      peakActivity: this.findPeakActivityTimes(events)
    };

    return insights;
  }

  findActivityPeriods(events) {
    if (events.length === 0) return {};

    const periods = {
      daily: {},
      weekly: {},
      monthly: {},
      yearly: {}
    };

    for (const event of events) {
      const date = new Date(event.timestamp);
      
      // Daily (hour of day)
      const hour = date.getHours();
      periods.daily[hour] = (periods.daily[hour] || 0) + 1;
      
      // Weekly (day of week)
      const dayOfWeek = date.getDay();
      periods.weekly[dayOfWeek] = (periods.weekly[dayOfWeek] || 0) + 1;
      
      // Monthly (day of month)
      const dayOfMonth = date.getDate();
      periods.monthly[dayOfMonth] = (periods.monthly[dayOfMonth] || 0) + 1;
      
      // Yearly (month)
      const month = date.getMonth();
      periods.yearly[month] = (periods.yearly[month] || 0) + 1;
    }

    return periods;
  }

  analyzePlatformUsage(events) {
    const usage = {};
    const platformTimeline = {};

    for (const event of events) {
      const platform = event.platform;
      const year = new Date(event.timestamp).getFullYear();
      
      // Overall usage
      usage[platform] = (usage[platform] || 0) + 1;
      
      // Timeline by platform
      if (!platformTimeline[platform]) {
        platformTimeline[platform] = {};
      }
      platformTimeline[platform][year] = (platformTimeline[platform][year] || 0) + 1;
    }

    // Find platform migration patterns
    const migrations = [];
    const platforms = Object.keys(platformTimeline);
    
    for (let i = 0; i < platforms.length; i++) {
      const platform = platforms[i];
      const years = Object.keys(platformTimeline[platform]).sort();
      
      if (years.length > 0) {
        migrations.push({
          platform,
          firstYear: parseInt(years[0]),
          lastYear: parseInt(years[years.length - 1]),
          peakYear: this.findPeakYear(platformTimeline[platform])
        });
      }
    }

    return {
      totalByPlatform: usage,
      timeline: platformTimeline,
      migrations
    };
  }

  findPeakYear(yearData) {
    let peakYear = null;
    let maxCount = 0;
    
    for (const [year, count] of Object.entries(yearData)) {
      if (count > maxCount) {
        maxCount = count;
        peakYear = parseInt(year);
      }
    }
    
    return peakYear;
  }

  analyzePrivacyTrends(events) {
    const privacyByYear = {};
    const privacyByPlatform = {};

    for (const event of events) {
      const year = new Date(event.timestamp).getFullYear();
      const privacy = event.privacy || 'unknown';
      
      // By year
      if (!privacyByYear[year]) {
        privacyByYear[year] = { public: 0, private: 0, unknown: 0 };
      }
      privacyByYear[year][privacy]++;
      
      // By platform
      if (!privacyByPlatform[event.platform]) {
        privacyByPlatform[event.platform] = { public: 0, private: 0, unknown: 0 };
      }
      privacyByPlatform[event.platform][privacy]++;
    }

    // Calculate privacy score trend
    const privacyScores = {};
    for (const [year, data] of Object.entries(privacyByYear)) {
      const total = data.public + data.private + data.unknown;
      privacyScores[year] = total > 0 ? (data.private / total) * 100 : 0;
    }

    return {
      byYear: privacyByYear,
      byPlatform: privacyByPlatform,
      privacyScoreTrend: privacyScores
    };
  }

  analyzeCommunicationPatterns(events) {
    const messageEvents = events.filter(e => e.type === 'message');
    const patterns = {
      totalMessages: messageEvents.length,
      conversationCount: new Set(messageEvents.map(e => e.content.conversationId)).size,
      participantCount: new Set(messageEvents.flatMap(e => e.content.participants || [])).size,
      messagesByPlatform: {},
      messagesByYear: {}
    };

    for (const event of messageEvents) {
      const platform = event.platform;
      const year = new Date(event.timestamp).getFullYear();
      
      patterns.messagesByPlatform[platform] = (patterns.messagesByPlatform[platform] || 0) + 1;
      patterns.messagesByYear[year] = (patterns.messagesByYear[year] || 0) + 1;
    }

    return patterns;
  }

  analyzeContentTypes(events) {
    const types = {};
    
    for (const event of events) {
      types[event.type] = (types[event.type] || 0) + 1;
    }
    
    return types;
  }

  findPeakActivityTimes(events) {
    const hourlyActivity = new Array(24).fill(0);
    
    for (const event of events) {
      const hour = new Date(event.timestamp).getHours();
      hourlyActivity[hour]++;
    }
    
    const peakHour = hourlyActivity.indexOf(Math.max(...hourlyActivity));
    const averagePerHour = events.length / 24;
    
    return {
      peakHour,
      hourlyDistribution: hourlyActivity,
      averagePerHour,
      mostActiveHours: hourlyActivity
        .map((count, hour) => ({ hour, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
    };
  }

  calculateTimelineStats(events) {
    if (events.length === 0) {
      return {
        totalEvents: 0,
        dateRange: { start: null, end: null },
        platforms: [],
        eventTypes: {}
      };
    }

    const timestamps = events.map(e => new Date(e.timestamp));
    const platforms = [...new Set(events.map(e => e.platform))];
    const eventTypes = {};
    
    for (const event of events) {
      eventTypes[event.type] = (eventTypes[event.type] || 0) + 1;
    }

    return {
      totalEvents: events.length,
      dateRange: {
        start: new Date(Math.min(...timestamps)),
        end: new Date(Math.max(...timestamps))
      },
      platforms,
      eventTypes,
      averageEventsPerDay: events.length / this.daysBetween(Math.min(...timestamps), Math.max(...timestamps))
    };
  }

  daysBetween(start, end) {
    const diff = Math.abs(end - start);
    return Math.ceil(diff / (1000 * 60 * 60 * 24)) || 1;
  }

  async addTimelineEntry(entry) {
    // Add new entry to timeline
    const Timeline = require('../models/Timeline');
    
    await Timeline.create({
      userId: entry.userId,
      platform: entry.platform,
      extractionDate: entry.extractionDate,
      metadata: entry.metadata,
      archiveId: entry.archiveId
    });
  }

  async getUserArchives(userId, dateRange) {
    const Archive = require('../models/Archive');
    
    const query = { userId };
    
    if (dateRange) {
      query.createdAt = {
        $gte: dateRange.start,
        $lte: dateRange.end
      };
    }
    
    return await Archive.find(query);
  }

  async getTimelineStats(userId) {
    const Timeline = require('../models/Timeline');
    
    const entries = await Timeline.find({ userId }).sort({ extractionDate: 1 });
    
    if (entries.length === 0) {
      return {
        oldestEntry: null,
        newestEntry: null,
        totalEntries: 0
      };
    }
    
    return {
      oldestEntry: entries[0].extractionDate,
      newestEntry: entries[entries.length - 1].extractionDate,
      totalEntries: entries.length
    };
  }
}

module.exports = DataTimelineEngine;