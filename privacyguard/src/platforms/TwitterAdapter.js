const PlatformAdapter = require('./PlatformAdapter');
const axios = require('axios');
const puppeteer = require('puppeteer');

/**
 * TwitterAdapter - Platform adapter for Twitter/X
 * Supports API-based and web scraping approaches
 */
class TwitterAdapter extends PlatformAdapter {
  constructor(config = {}) {
    super('Twitter', {
      capabilities: {
        hasOfficialAPI: true,
        supportsGDPRRequests: true,
        supportsOAuth: true,
        supportsPasswordReset: true,
        supportsAccountDeletion: true,
        supportsDataExport: true,
        requiresManualVerification: false
      },
      rateLimits: {
        requestsPerMinute: 300,
        requestsPerHour: 15000,
        requestsPerDay: 500000
      },
      endpoints: {
        api: 'https://api.twitter.com/2',
        oauth: 'https://api.twitter.com/oauth',
        web: 'https://twitter.com',
        settings: 'https://twitter.com/settings'
      },
      selectors: {
        loginForm: '[data-testid="LoginForm"]',
        usernameInput: '[name="text"]',
        passwordInput: '[name="password"]',
        loginButton: '[data-testid="LoginForm_Login_Button"]',
        profileName: '[data-testid="UserName"]',
        deleteAccountButton: '[data-testid="deactivateAccountButton"]'
      },
      ...config
    });
  }

  getSupportedDataTypes() {
    return [
      'profile',
      'tweets',
      'direct_messages',
      'followers',
      'following',
      'likes',
      'bookmarks',
      'lists',
      'moments',
      'analytics',
      'ad_preferences'
    ];
  }

  async authenticate(credentials) {
    this.logOperationStart('authenticate');
    
    try {
      if (credentials.apiKey && credentials.apiSecret) {
        return await this.authenticateWithAPI(credentials);
      } else if (credentials.username && credentials.password) {
        return await this.authenticateWithCredentials(credentials);
      } else {
        throw new Error('Invalid credentials provided');
      }
    } catch (error) {
      this.logOperationComplete('authenticate', false, { error: error.message });
      throw this.createError('authenticate', error, { hasApiKey: !!credentials.apiKey });
    }
  }

  async authenticateWithAPI(credentials) {
    const { apiKey, apiSecret, accessToken, accessTokenSecret } = credentials;
    
    // OAuth 1.0a authentication for Twitter API v1.1
    const authHeader = this.generateOAuthHeader({
      method: 'GET',
      url: `${this.endpoints.api}/users/me`,
      apiKey,
      apiSecret,
      accessToken,
      accessTokenSecret
    });

    try {
      const response = await axios.get(`${this.endpoints.api}/users/me`, {
        headers: {
          'Authorization': authHeader,
          'User-Agent': 'PrivacyGuard/1.0'
        }
      });

      const session = {
        type: 'api',
        platform: this.platformName,
        authenticated: true,
        user: response.data,
        credentials: {
          apiKey,
          apiSecret,
          accessToken,
          accessTokenSecret
        },
        expiresAt: null // Twitter API tokens don't expire unless revoked
      };

      this.logOperationComplete('authenticate', true, { 
        userId: response.data.id,
        username: response.data.username 
      });
      
      return session;
    } catch (error) {
      if (error.response?.status === 401) {
        throw new Error('Invalid Twitter API credentials');
      }
      throw error;
    }
  }

  async authenticateWithCredentials(credentials) {
    const { username, password } = credentials;
    
    const browser = await puppeteer.launch({
      headless: process.env.NODE_ENV === 'production',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      
      // Navigate to login page
      await page.goto(`${this.endpoints.web}/login`, { waitUntil: 'networkidle2' });
      
      // Fill login form
      await page.waitForSelector(this.selectors.usernameInput);
      await page.type(this.selectors.usernameInput, username);
      
      // Click Next button (Twitter has a multi-step login)
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      
      // Wait for password field and enter password
      await page.waitForSelector(this.selectors.passwordInput, { timeout: 10000 });
      await page.type(this.selectors.passwordInput, password);
      
      // Submit login form
      await page.waitForSelector(this.selectors.loginButton);
      await page.click(this.selectors.loginButton);
      
      // Wait for successful login (check for profile element)
      await page.waitForNavigation({ waitUntil: 'networkidle2' });
      
      // Verify login success
      const isLoggedIn = await page.$(this.selectors.profileName) !== null;
      if (!isLoggedIn) {
        throw new Error('Login failed - could not find profile elements');
      }
      
      // Extract session cookies
      const cookies = await page.cookies();
      
      const session = {
        type: 'web',
        platform: this.platformName,
        authenticated: true,
        cookies,
        userAgent: await page.evaluate(() => navigator.userAgent),
        browser,
        page,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
      };

      this.logOperationComplete('authenticate', true, { 
        username: username.substring(0, 3) + '...',
        sessionType: 'web'
      });
      
      return session;
    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  async verifyAccount(identifier, options = {}) {
    this.logOperationStart('verifyAccount', { identifier: identifier.substring(0, 5) + '...' });
    
    try {
      // Try password reset approach first (most reliable)
      if (this.capabilities.supportsPasswordReset) {
        return await this.verifyAccountViaPasswordReset(identifier);
      }
      
      // Fallback to public profile check
      return await this.verifyAccountViaPublicProfile(identifier);
    } catch (error) {
      this.logOperationComplete('verifyAccount', false, { error: error.message });
      throw this.createError('verifyAccount', error, { identifier: identifier.substring(0, 5) + '...' });
    }
  }

  async verifyAccountViaPasswordReset(email) {
    const browser = await puppeteer.launch({
      headless: process.env.NODE_ENV === 'production',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
      const page = await browser.newPage();
      await page.goto(`${this.endpoints.web}/i/flow/password_reset`, { waitUntil: 'networkidle2' });
      
      // Enter email in password reset form
      await page.waitForSelector('input[name="text"]');
      await page.type('input[name="text"]', email);
      
      // Submit form
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);
      
      // Check for error messages or success indicators
      const errorElement = await page.$('[data-testid="error"]');
      const successElement = await page.$('[data-testid="success"]');
      
      if (errorElement) {
        const errorText = await errorElement.textContent();
        if (errorText.includes('not found') || errorText.includes('does not exist')) {
          return { exists: false, method: 'password_reset', confidence: 90 };
        }
      }
      
      if (successElement || !errorElement) {
        return { exists: true, method: 'password_reset', confidence: 85 };
      }
      
      return { exists: false, method: 'password_reset', confidence: 70 };
    } finally {
      await browser.close();
    }
  }

  async verifyAccountViaPublicProfile(username) {
    try {
      const profileUrl = `${this.endpoints.web}/${username.replace('@', '')}`;
      const response = await axios.get(profileUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PrivacyGuard/1.0)' }
      });
      
      const exists = !response.data.includes('This account doesn\'t exist') && 
                    !response.data.includes('Account suspended');
      
      return { 
        exists, 
        method: 'public_profile',
        confidence: 80,
        profileUrl: exists ? profileUrl : null
      };
    } catch (error) {
      if (error.response?.status === 404) {
        return { exists: false, method: 'public_profile', confidence: 95 };
      }
      throw error;
    }
  }

  async discoverAccount(identifier, options = {}) {
    this.logOperationStart('discoverAccount', { identifier: identifier.substring(0, 5) + '...' });
    
    // Twitter discovery methods:
    // 1. Email -> Password reset flow
    // 2. Username -> Public profile check
    // 3. Phone -> Limited, requires API access
    
    if (identifier.includes('@')) {
      return await this.verifyAccount(identifier, options);
    } else {
      // Treat as username
      return await this.verifyAccountViaPublicProfile(identifier);
    }
  }

  async extractDataType(session, dataType, options = {}) {
    this.logOperationStart('extractDataType', { dataType });
    
    if (session.type === 'api') {
      return await this.extractDataTypeViaAPI(session, dataType, options);
    } else {
      return await this.extractDataTypeViaWeb(session, dataType, options);
    }
  }

  async extractDataTypeViaAPI(session, dataType, options = {}) {
    const { credentials } = session;
    const limit = options.limit || 1000;
    
    const authHeader = this.generateOAuthHeader({
      method: 'GET',
      url: `${this.endpoints.api}/users/me/tweets`,
      ...credentials
    });

    switch (dataType) {
      case 'profile':
        return await this.extractAPIProfile(authHeader);
      case 'tweets':
        return await this.extractAPITweets(authHeader, limit);
      case 'followers':
        return await this.extractAPIFollowers(authHeader, limit);
      case 'following':
        return await this.extractAPIFollowing(authHeader, limit);
      default:
        throw new Error(`Data type ${dataType} not supported via API`);
    }
  }

  async extractDataTypeViaWeb(session, dataType, options = {}) {
    const { page } = session;
    
    switch (dataType) {
      case 'profile':
        return await this.extractWebProfile(page);
      case 'tweets':
        return await this.extractWebTweets(page, options);
      case 'direct_messages':
        return await this.extractWebDirectMessages(page, options);
      default:
        throw new Error(`Data type ${dataType} not supported via web scraping`);
    }
  }

  async requestGDPRExport(session, options = {}) {
    this.logOperationStart('requestGDPRExport');
    
    if (session.type !== 'web') {
      throw new Error('GDPR export requires web session');
    }
    
    const { page } = session;
    
    try {
      // Navigate to data export settings
      await page.goto(`${this.endpoints.web}/settings/download_your_data`);
      
      // Click on request data button
      await page.waitForSelector('[data-testid="requestDataButton"]');
      await page.click('[data-testid="requestDataButton"]');
      
      // Wait for confirmation
      await page.waitForSelector('[data-testid="confirmRequest"]');
      await page.click('[data-testid="confirmRequest"]');
      
      this.logOperationComplete('requestGDPRExport', true);
      
      return {
        platform: this.platformName,
        requested: true,
        estimatedTime: '24-48 hours',
        deliveryMethod: 'email',
        requestedAt: new Date()
      };
    } catch (error) {
      this.logOperationComplete('requestGDPRExport', false, { error: error.message });
      throw this.createError('requestGDPRExport', error);
    }
  }

  async executeDeletion(session, options = {}) {
    this.logOperationStart('executeDeletion');
    
    if (session.type !== 'web') {
      throw new Error('Account deletion requires web session');
    }
    
    const { page } = session;
    
    try {
      // Navigate to deactivation settings
      await page.goto(`${this.endpoints.web}/settings/deactivate`);
      
      // Click deactivate button
      await page.waitForSelector(this.selectors.deleteAccountButton);
      await page.click(this.selectors.deleteAccountButton);
      
      // Handle confirmation dialog
      await page.waitForSelector('[data-testid="confirmDeactivation"]');
      await page.type('input[name="password"]', session.password || '');
      await page.click('[data-testid="confirmDeactivation"]');
      
      // Wait for final confirmation
      await page.waitForNavigation({ waitUntil: 'networkidle2' });
      
      this.logOperationComplete('executeDeletion', true);
      
      return {
        platform: this.platformName,
        status: 'deactivated',
        permanent: false,
        reactivationPeriod: '30 days',
        deletedAt: new Date()
      };
    } catch (error) {
      this.logOperationComplete('executeDeletion', false, { error: error.message });
      throw this.createError('executeDeletion', error);
    }
  }

  async verifyDeletion(identifier, options = {}) {
    this.logOperationStart('verifyDeletion', { identifier: identifier.substring(0, 5) + '...' });
    
    try {
      // Check if account still exists via public profile
      const result = await this.verifyAccountViaPublicProfile(identifier);
      
      this.logOperationComplete('verifyDeletion', true, {
        deleted: !result.exists,
        confidence: result.confidence
      });
      
      return {
        platform: this.platformName,
        identifier,
        deleted: !result.exists,
        confidence: result.confidence,
        verifiedAt: new Date()
      };
    } catch (error) {
      this.logOperationComplete('verifyDeletion', false, { error: error.message });
      throw this.createError('verifyDeletion', error, { identifier: identifier.substring(0, 5) + '...' });
    }
  }

  // Helper methods for API operations
  generateOAuthHeader({ method, url, apiKey, apiSecret, accessToken, accessTokenSecret }) {
    // This is a simplified OAuth 1.0a implementation
    // In production, use a proper OAuth library
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = Math.random().toString(36).substring(7);
    
    const params = {
      oauth_consumer_key: apiKey,
      oauth_token: accessToken,
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: timestamp,
      oauth_nonce: nonce,
      oauth_version: '1.0'
    };
    
    // In a real implementation, you'd properly generate the OAuth signature
    return `OAuth ${Object.entries(params).map(([k, v]) => `${k}="${v}"`).join(', ')}`;
  }

  async extractAPIProfile(authHeader) {
    const response = await axios.get(`${this.endpoints.api}/users/me`, {
      headers: { 'Authorization': authHeader }
    });
    
    return {
      dataType: 'profile',
      extractedAt: new Date(),
      data: response.data
    };
  }

  async extractWebProfile(page) {
    await page.goto(`${this.endpoints.web}/home`);
    
    // Extract profile information from the web interface
    const profile = await page.evaluate(() => {
      return {
        name: document.querySelector('[data-testid="UserName"]')?.textContent,
        username: document.querySelector('[data-testid="UserScreenName"]')?.textContent,
        bio: document.querySelector('[data-testid="UserDescription"]')?.textContent,
        location: document.querySelector('[data-testid="UserLocation"]')?.textContent,
        website: document.querySelector('[data-testid="UserUrl"]')?.textContent,
        joinDate: document.querySelector('[data-testid="UserJoinDate"]')?.textContent
      };
    });
    
    return {
      dataType: 'profile',
      extractedAt: new Date(),
      data: profile
    };
  }

  async cleanup(session) {
    if (session.browser) {
      await session.browser.close();
    }
  }
}

module.exports = TwitterAdapter;