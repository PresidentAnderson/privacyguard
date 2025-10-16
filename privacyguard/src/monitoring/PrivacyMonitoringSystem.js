const DataBreachMonitor = require('./DataBreachMonitor');
const DigitalFootprintScanner = require('./DigitalFootprintScanner');
const PrivacyAlertSystem = require('./PrivacyAlertSystem');
const OnlineReputationMonitor = require('./OnlineReputationMonitor');
const logger = require('../utils/logger');

class PrivacyMonitoringSystem {
  constructor() {
    this.breachMonitor = new DataBreachMonitor();
    this.footprintScanner = new DigitalFootprintScanner();
    this.alertSystem = new PrivacyAlertSystem();
    this.reputationMonitor = new OnlineReputationMonitor();
    this.isRunning = false;
  }

  async startContinuousMonitoring(userProfile) {
    if (this.isRunning) {
      logger.warn('Monitoring already running for user', { userId: userProfile._id });
      return;
    }

    this.isRunning = true;
    logger.info('Starting continuous privacy monitoring', { userId: userProfile._id });

    try {
      // Schedule monitoring tasks
      const monitoringTasks = [
        this.monitorDataBreaches(userProfile),
        this.monitorNewAccounts(userProfile),
        this.monitorDataBrokerListings(userProfile),
        this.monitorReputationChanges(userProfile)
      ];

      // Run monitoring tasks concurrently
      const results = await Promise.allSettled(monitoringTasks);

      // Analyze results and generate alerts
      const alerts = await this.analyzeMonitoringResults(results, userProfile);

      // Send notifications for critical issues
      for (const alert of alerts) {
        if (alert.severity >= 3) { // High severity
          await this.alertSystem.sendImmediateAlert(alert);
        }
      }

      // Update user's last monitoring timestamp
      await this.updateLastMonitoring(userProfile._id);

      return {
        monitoringResults: results,
        alertsGenerated: alerts,
        nextScanScheduled: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
      };

    } catch (error) {
      logger.error('Continuous monitoring failed', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  async monitorDataBreaches(userProfile) {
    logger.info('Monitoring data breaches', { userId: userProfile._id });
    
    const emails = [userProfile.email, ...(userProfile.profile.alternativeEmails || [])];
    const newBreaches = [];

    for (const email of emails) {
      try {
        const breaches = await this.breachMonitor.checkEmailBreaches(email);
        
        // Filter for new breaches since last check
        const lastCheck = userProfile.lastBreachCheck || new Date(0);
        const recentBreaches = breaches.filter(breach => 
          new Date(breach.dateDiscovered) > lastCheck
        );

        newBreaches.push(...recentBreaches.map(breach => ({
          ...breach,
          email,
          type: 'data_breach'
        })));

      } catch (error) {
        logger.error(`Breach monitoring failed for email ${email}`, error);
      }
    }

    return {
      type: 'data_breach_monitoring',
      newBreaches,
      totalExposures: newBreaches.length,
      severityAssessment: this.assessBreachSeverity(newBreaches)
    };
  }

  async monitorNewAccounts(userProfile) {
    logger.info('Monitoring for new accounts', { userId: userProfile._id });
    
    const newAccounts = [];
    const emails = [userProfile.email, ...(userProfile.profile.alternativeEmails || [])];

    // Check for new account registrations
    for (const email of emails) {
      try {
        const detectedAccounts = await this.footprintScanner.scanForNewAccounts(email);
        
        // Filter out already known accounts
        const knownPlatforms = await this.getKnownPlatforms(userProfile._id);
        const genuinelyNew = detectedAccounts.filter(account => 
          !knownPlatforms.includes(account.platform)
        );

        newAccounts.push(...genuinelyNew);

      } catch (error) {
        logger.error(`New account monitoring failed for ${email}`, error);
      }
    }

    return {
      type: 'new_account_monitoring',
      newAccounts,
      platformsFound: [...new Set(newAccounts.map(a => a.platform))]
    };
  }

  async monitorDataBrokerListings(userProfile) {
    logger.info('Monitoring data broker listings', { userId: userProfile._id });
    
    const personalInfo = {
      fullName: userProfile.profile.fullName,
      emails: [userProfile.email, ...(userProfile.profile.alternativeEmails || [])],
      phoneNumbers: userProfile.profile.phoneNumbers || [],
      location: userProfile.profile.location
    };

    const brokerFindings = await this.footprintScanner.scanDataBrokers(personalInfo);

    return {
      type: 'data_broker_monitoring',
      brokerFindings,
      totalListings: brokerFindings.reduce((sum, broker) => sum + broker.listingsFound, 0),
      removalActions: brokerFindings.map(broker => ({
        broker: broker.broker,
        removalProcess: broker.removalProcess,
        autoRemovalAvailable: broker.autoRemovalAvailable || false
      }))
    };
  }

  async monitorReputationChanges(userProfile) {
    logger.info('Monitoring reputation changes', { userId: userProfile._id });
    
    const reputationData = await this.reputationMonitor.scanOnlineReputation({
      fullName: userProfile.profile.fullName,
      emails: [userProfile.email, ...(userProfile.profile.alternativeEmails || [])],
      usernames: userProfile.profile.commonUsernames || []
    });

    return {
      type: 'reputation_monitoring',
      mentions: reputationData.mentions,
      sentiment: reputationData.sentiment,
      newMentions: reputationData.newMentions,
      riskyMentions: reputationData.riskyMentions
    };
  }

  async analyzeMonitoringResults(results, userProfile) {
    const alerts = [];

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        const data = result.value;

        switch (data.type) {
          case 'data_breach_monitoring':
            if (data.newBreaches.length > 0) {
              alerts.push({
                type: 'data_breach',
                severity: data.severityAssessment.maxSeverity,
                title: `${data.newBreaches.length} New Data Breach(es) Found`,
                message: `Your email was found in ${data.newBreaches.length} new data breach(es)`,
                details: data.newBreaches,
                actions: ['change_passwords', 'enable_2fa', 'monitor_accounts']
              });
            }
            break;

          case 'new_account_monitoring':
            if (data.newAccounts.length > 0) {
              alerts.push({
                type: 'new_account',
                severity: 2,
                title: `${data.newAccounts.length} New Account(s) Detected`,
                message: `We found ${data.newAccounts.length} potential new account(s) you may not be aware of`,
                details: data.newAccounts,
                actions: ['verify_accounts', 'add_to_monitoring', 'schedule_deletion']
              });
            }
            break;

          case 'data_broker_monitoring':
            if (data.totalListings > 0) {
              alerts.push({
                type: 'data_broker',
                severity: 3,
                title: `Found on ${data.brokerFindings.length} Data Broker Site(s)`,
                message: `Your personal information appears on ${data.totalListings} data broker listing(s)`,
                details: data.brokerFindings,
                actions: ['initiate_removal', 'opt_out_all', 'legal_action']
              });
            }
            break;

          case 'reputation_monitoring':
            if (data.riskyMentions.length > 0) {
              alerts.push({
                type: 'reputation_risk',
                severity: 3,
                title: `${data.riskyMentions.length} Risky Online Mention(s)`,
                message: `We found potentially harmful mentions of you online`,
                details: data.riskyMentions,
                actions: ['review_mentions', 'request_removal', 'reputation_management']
              });
            }
            break;
        }
      }
    }

    return alerts;
  }

  assessBreachSeverity(breaches) {
    let maxSeverity = 1;
    const sensitiveDataTypes = ['passwords', 'ssn', 'credit_cards', 'bank_accounts'];
    
    for (const breach of breaches) {
      let severity = 1;
      
      // Check for sensitive data types
      const dataTypes = breach.dataTypes || [];
      if (dataTypes.some(type => sensitiveDataTypes.includes(type))) {
        severity = 4; // Critical
      } else if (dataTypes.includes('passwords')) {
        severity = 3; // High
      } else if (dataTypes.length > 3) {
        severity = 2; // Medium
      }
      
      maxSeverity = Math.max(maxSeverity, severity);
    }

    return {
      maxSeverity,
      riskLevel: maxSeverity >= 4 ? 'critical' : 
                maxSeverity >= 3 ? 'high' : 
                maxSeverity >= 2 ? 'medium' : 'low'
    };
  }

  async getKnownPlatforms(userId) {
    const Account = require('../models/Account');
    const accounts = await Account.find({ userId }, 'platform');
    return accounts.map(account => account.platform);
  }

  async updateLastMonitoring(userId) {
    const User = require('../models/User');
    await User.findByIdAndUpdate(userId, {
      lastBreachCheck: new Date()
    });
  }

  async scheduleMonitoring(userProfile, interval = 24) {
    // Schedule monitoring to run at specified interval (hours)
    const scheduleTime = new Date(Date.now() + interval * 60 * 60 * 1000);
    
    logger.info(`Scheduling next monitoring for ${scheduleTime}`, { 
      userId: userProfile._id 
    });

    // Would integrate with job scheduler like Bull or Agenda
    return {
      scheduled: true,
      nextRun: scheduleTime,
      interval: `${interval} hours`
    };
  }

  async generatePrivacyReport(userId, timeframe = 30) {
    logger.info(`Generating privacy report for user ${userId}`);
    
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - timeframe * 24 * 60 * 60 * 1000);

    // Get monitoring history
    const monitoringHistory = await this.getMonitoringHistory(userId, startDate, endDate);
    
    // Get alert history
    const alertHistory = await this.alertSystem.getAlertHistory(userId, startDate, endDate);
    
    // Calculate privacy score
    const privacyScore = await this.calculatePrivacyScore(userId);
    
    // Generate recommendations
    const recommendations = await this.generateRecommendations(userId, alertHistory);

    return {
      reportPeriod: { startDate, endDate },
      privacyScore,
      monitoringHistory,
      alertSummary: {
        total: alertHistory.length,
        critical: alertHistory.filter(a => a.severity >= 4).length,
        high: alertHistory.filter(a => a.severity === 3).length,
        medium: alertHistory.filter(a => a.severity === 2).length,
        low: alertHistory.filter(a => a.severity === 1).length
      },
      trends: this.analyzePrivacyTrends(alertHistory),
      recommendations,
      generatedAt: new Date()
    };
  }

  async calculatePrivacyScore(userId) {
    // Calculate privacy score based on various factors
    let score = 100;
    
    // Factor in recent breaches
    const recentBreaches = await this.getRecentBreaches(userId, 30);
    score -= recentBreaches.length * 10;
    
    // Factor in data broker listings
    const dataBrokerListings = await this.getDataBrokerListings(userId);
    score -= dataBrokerListings * 5;
    
    // Factor in account security
    const accountSecurity = await this.assessAccountSecurity(userId);
    score -= (100 - accountSecurity.averageScore) * 0.3;
    
    return Math.max(0, Math.min(100, score));
  }

  async generateRecommendations(userId, alertHistory) {
    const recommendations = [];
    
    // Analyze alert patterns
    const breachAlerts = alertHistory.filter(a => a.type === 'data_breach');
    const dataBrokerAlerts = alertHistory.filter(a => a.type === 'data_broker');
    const reputationAlerts = alertHistory.filter(a => a.type === 'reputation_risk');

    if (breachAlerts.length > 0) {
      recommendations.push({
        priority: 'high',
        category: 'security',
        title: 'Enable Two-Factor Authentication',
        description: 'Your accounts have been exposed in data breaches. Enable 2FA on all important accounts.',
        actions: ['enable_2fa', 'change_passwords', 'security_audit']
      });
    }

    if (dataBrokerAlerts.length > 0) {
      recommendations.push({
        priority: 'high',
        category: 'privacy',
        title: 'Remove Your Data from Broker Sites',
        description: 'Your personal information is available on data broker websites.',
        actions: ['initiate_removal', 'opt_out_services', 'monitor_regularly']
      });
    }

    if (reputationAlerts.length > 0) {
      recommendations.push({
        priority: 'medium',
        category: 'reputation',
        title: 'Monitor Your Online Reputation',
        description: 'We found concerning mentions about you online.',
        actions: ['reputation_monitoring', 'content_removal', 'positive_content']
      });
    }

    return recommendations;
  }

  analyzePrivacyTrends(alertHistory) {
    // Analyze trends in privacy alerts over time
    const trends = {
      improving: false,
      declining: false,
      stable: true
    };

    if (alertHistory.length > 5) {
      const recent = alertHistory.slice(-5);
      const older = alertHistory.slice(0, -5);
      
      const recentSeverity = recent.reduce((sum, alert) => sum + alert.severity, 0) / recent.length;
      const olderSeverity = older.reduce((sum, alert) => sum + alert.severity, 0) / older.length;
      
      if (recentSeverity < olderSeverity - 0.5) {
        trends.improving = true;
        trends.stable = false;
      } else if (recentSeverity > olderSeverity + 0.5) {
        trends.declining = true;
        trends.stable = false;
      }
    }

    return trends;
  }

  async getMonitoringHistory(userId, startDate, endDate) {
    // Would get monitoring history from database
    return [];
  }

  async getRecentBreaches(userId, days) {
    // Would get recent breaches from database
    return [];
  }

  async getDataBrokerListings(userId) {
    // Would get data broker listings count
    return 0;
  }

  async assessAccountSecurity(userId) {
    // Would assess security of monitored accounts
    return { averageScore: 75 };
  }
}

module.exports = PrivacyMonitoringSystem;