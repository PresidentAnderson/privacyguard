const axios = require('axios');
const puppeteer = require('puppeteer');
const logger = require('../utils/logger');

class EmailAccountScanner {
  constructor() {
    this.browser = null;
    this.rateLimitDelay = 2000; // 2 seconds between requests
  }

  async scanByEmail(emails, methods) {
    const results = [];
    
    for (const email of emails) {
      logger.info(`Scanning accounts for email: ${email}`);
      
      try {
        const scanResults = await Promise.allSettled([
          methods.includes('password_reset') ? this.passwordResetEnumeration(email) : [],
          methods.includes('api_enumeration') ? this.apiEnumeration(email) : [],
          methods.includes('public_profile') ? this.publicProfileDiscovery(email) : [],
          methods.includes('breach_correlation') ? this.correlateBreaches(email) : []
        ]);

        for (const result of scanResults) {
          if (result.status === 'fulfilled' && result.value) {
            results.push(...result.value);
          }
        }
      } catch (error) {
        logger.error(`Email scanning failed for ${email}`, error);
      }
    }

    return results;
  }

  async passwordResetEnumeration(email) {
    const platforms = [
      { name: 'facebook', url: 'https://www.facebook.com/login/identify/', selector: '.uiBoxRed' },
      { name: 'twitter', url: 'https://twitter.com/account/begin_password_reset', selector: '.message-text' },
      { name: 'instagram', url: 'https://www.instagram.com/accounts/password/reset/', selector: '.eiCW-' },
      { name: 'linkedin', url: 'https://www.linkedin.com/checkpoint/requestPassword', selector: '.alert' },
      { name: 'github', url: 'https://github.com/password_reset', selector: '.flash-error' }
    ];

    const detectedAccounts = [];
    
    if (!this.browser) {
      this.browser = await puppeteer.launch({ 
        headless: process.env.PUPPETEER_HEADLESS === 'true',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }

    for (const platform of platforms) {
      try {
        const page = await this.browser.newPage();
        await page.goto(platform.url, { waitUntil: 'networkidle2' });
        
        // Find email input field
        const emailInput = await page.$('input[type="email"], input[name="email"], input[name="username"]');
        if (emailInput) {
          await emailInput.type(email);
          
          // Submit form
          const submitButton = await page.$('button[type="submit"], input[type="submit"]');
          if (submitButton) {
            await submitButton.click();
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 }).catch(() => {});
            
            // Check for account existence indicators
            const hasAccount = await this.checkAccountExistence(page, platform);
            
            if (hasAccount) {
              detectedAccounts.push({
                platform: platform.name,
                email: email,
                detectionMethod: 'password_reset',
                confidence: 85,
                lastVerified: new Date()
              });
            }
          }
        }
        
        await page.close();
        await this.delay(this.rateLimitDelay);
        
      } catch (error) {
        logger.warn(`Password reset check failed for ${platform.name}`, error);
      }
    }

    return detectedAccounts;
  }

  async checkAccountExistence(page, platform) {
    // Platform-specific logic to detect if account exists
    const indicators = {
      facebook: async () => {
        const errorElement = await page.$('.uiBoxRed');
        return !errorElement; // No error = account exists
      },
      twitter: async () => {
        const successElement = await page.$('.message-text');
        const text = successElement ? await page.evaluate(el => el.textContent, successElement) : '';
        return text.includes('email');
      },
      instagram: async () => {
        const errorElement = await page.$('.eiCW-');
        return !errorElement;
      },
      linkedin: async () => {
        const alertElement = await page.$('.alert-error');
        return !alertElement;
      },
      github: async () => {
        const flashError = await page.$('.flash-error');
        return !flashError;
      }
    };

    const checker = indicators[platform.name];
    return checker ? await checker() : false;
  }

  async apiEnumeration(email) {
    const apiChecks = [
      {
        platform: 'gravatar',
        check: async (email) => {
          const hash = require('crypto').createHash('md5').update(email.toLowerCase()).digest('hex');
          const response = await axios.get(`https://www.gravatar.com/avatar/${hash}?d=404`);
          return response.status === 200;
        }
      },
      {
        platform: 'spotify',
        check: async (email) => {
          // Spotify Web API check (requires client credentials)
          return false; // Placeholder
        }
      }
    ];

    const results = [];
    
    for (const api of apiChecks) {
      try {
        const exists = await api.check(email);
        if (exists) {
          results.push({
            platform: api.platform,
            email: email,
            detectionMethod: 'api_enumeration',
            confidence: 75,
            lastVerified: new Date()
          });
        }
      } catch (error) {
        logger.warn(`API check failed for ${api.platform}`, error);
      }
    }

    return results;
  }

  async publicProfileDiscovery(email) {
    // Search for public profiles using the email
    const profiles = [];
    
    try {
      // Use search engines to find public profiles
      const searchQuery = encodeURIComponent(`"${email}" site:linkedin.com OR site:twitter.com OR site:facebook.com`);
      // Implementation would use search APIs or careful web scraping
      
      // Placeholder for actual implementation
      logger.info(`Public profile search for ${email}`);
    } catch (error) {
      logger.error(`Public profile discovery failed for ${email}`, error);
    }

    return profiles;
  }

  async correlateBreaches(email) {
    // Check if email appears in known data breaches
    const breachResults = [];
    
    try {
      // Would integrate with HaveIBeenPwned API
      if (process.env.HAVEIBEENPWNED_API_KEY) {
        const response = await axios.get(
          `https://haveibeenpwned.com/api/v3/breachedaccount/${email}`,
          {
            headers: {
              'hibp-api-key': process.env.HAVEIBEENPWNED_API_KEY
            }
          }
        );

        if (response.data && response.data.length > 0) {
          for (const breach of response.data) {
            breachResults.push({
              platform: breach.Domain,
              email: email,
              detectionMethod: 'breach_data',
              confidence: 95,
              breachDate: breach.BreachDate,
              dataTypes: breach.DataClasses
            });
          }
        }
      }
    } catch (error) {
      if (error.response?.status !== 404) {
        logger.error(`Breach correlation failed for ${email}`, error);
      }
    }

    return breachResults;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = EmailAccountScanner;