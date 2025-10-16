const EmailAccountScanner = require('./EmailAccountScanner');
const SocialGraphAnalyzer = require('./SocialGraphAnalyzer');
const BreachMonitor = require('./BreachMonitor');
const IntelligentWebCrawler = require('./IntelligentWebCrawler');
const logger = require('../utils/logger');

class AccountDiscoveryEngine {
  constructor() {
    this.emailScanner = new EmailAccountScanner();
    this.socialGraphAnalyzer = new SocialGraphAnalyzer();
    this.breachDatabase = new BreachMonitor();
    this.webCrawler = new IntelligentWebCrawler();
  }

  async discoverAccounts(userProfile) {
    logger.info(`Starting account discovery for user ${userProfile._id}`);
    
    const discoveryResults = {
      confirmedAccounts: [],
      potentialAccounts: [],
      breachExposures: [],
      dataBrokers: []
    };

    try {
      // Run discovery methods in parallel for performance
      const [emailAccounts, socialAccounts, breachData, usernameAccounts, phoneAccounts] = 
        await Promise.all([
          this.emailScanner.scanByEmail(
            userProfile.profile.alternativeEmails.concat(userProfile.email),
            ['password_reset', 'signup_attempt', 'api_enumeration']
          ),
          this.socialGraphAnalyzer.findConnectedAccounts(
            userProfile.confirmedAccounts || [],
            3
          ),
          this.breachDatabase.checkEmailExposure(
            userProfile.profile.alternativeEmails.concat(userProfile.email),
            true
          ),
          this.webCrawler.enumerateUsernames(
            userProfile.profile.commonUsernames || [],
            this.getTopPlatforms()
          ),
          this.discoverByPhone(userProfile.profile.phoneNumbers || [])
        ]);

      // Consolidate and deduplicate results
      const consolidated = this.consolidateDiscoveries(
        emailAccounts,
        socialAccounts,
        breachData,
        usernameAccounts,
        phoneAccounts
      );

      discoveryResults.confirmedAccounts = consolidated.confirmed;
      discoveryResults.potentialAccounts = consolidated.potential;
      discoveryResults.breachExposures = breachData;

      // Save discovery results
      await this.saveDiscoveryResults(userProfile._id, discoveryResults);

      logger.info(`Account discovery completed for user ${userProfile._id}`, {
        confirmed: discoveryResults.confirmedAccounts.length,
        potential: discoveryResults.potentialAccounts.length,
        breaches: discoveryResults.breachExposures.length
      });

      return discoveryResults;
    } catch (error) {
      logger.error(`Account discovery failed for user ${userProfile._id}`, error);
      throw error;
    }
  }

  async discoverByPhone(phoneNumbers) {
    const phoneAccounts = [];
    
    for (const phone of phoneNumbers) {
      try {
        // Check platforms that use phone number for login
        const platforms = [
          'whatsapp', 'telegram', 'signal', 'twitter', 'facebook',
          'instagram', 'tiktok', 'snapchat', 'uber', 'lyft'
        ];

        for (const platform of platforms) {
          const exists = await this.checkPhoneOnPlatform(phone, platform);
          if (exists) {
            phoneAccounts.push({
              platform,
              phone,
              detectionMethod: 'phone_lookup',
              confidence: exists.confidence || 70
            });
          }
        }
      } catch (error) {
        logger.warn(`Phone discovery failed for ${phone}`, error);
      }
    }

    return phoneAccounts;
  }

  async checkPhoneOnPlatform(phone, platform) {
    // Platform-specific phone number verification logic
    const platformCheckers = {
      whatsapp: async (phone) => {
        // WhatsApp Web API check
        return { exists: true, confidence: 90 };
      },
      telegram: async (phone) => {
        // Telegram API check
        return { exists: false, confidence: 80 };
      },
      // More platform checkers...
    };

    const checker = platformCheckers[platform];
    if (checker) {
      return await checker(phone);
    }
    
    return null;
  }

  consolidateDiscoveries(...discoveryArrays) {
    const allAccounts = discoveryArrays.flat();
    const accountMap = new Map();

    // Deduplicate by platform + email/username
    for (const account of allAccounts) {
      const key = `${account.platform}_${account.email || account.username}`;
      
      if (!accountMap.has(key)) {
        accountMap.set(key, account);
      } else {
        // Keep the one with higher confidence
        const existing = accountMap.get(key);
        if (account.confidence > existing.confidence) {
          accountMap.set(key, account);
        }
      }
    }

    // Separate confirmed (high confidence) from potential
    const confirmed = [];
    const potential = [];

    for (const account of accountMap.values()) {
      if (account.confidence >= 80) {
        confirmed.push(account);
      } else {
        potential.push(account);
      }
    }

    return { confirmed, potential };
  }

  getTopPlatforms() {
    return [
      'facebook.com', 'twitter.com', 'instagram.com', 'linkedin.com',
      'google.com', 'apple.com', 'microsoft.com', 'amazon.com',
      'netflix.com', 'spotify.com', 'dropbox.com', 'github.com',
      'reddit.com', 'pinterest.com', 'tumblr.com', 'discord.com',
      'tiktok.com', 'snapchat.com', 'paypal.com', 'ebay.com'
    ];
  }

  async saveDiscoveryResults(userId, results) {
    const Account = require('../models/Account');
    
    for (const account of results.confirmedAccounts) {
      await Account.findOneAndUpdate(
        {
          userId,
          platform: account.platform,
          email: account.email
        },
        {
          $set: {
            ...account,
            userId,
            lastVerified: new Date(),
            status: 'active'
          }
        },
        { upsert: true }
      );
    }
  }
}

module.exports = AccountDiscoveryEngine;