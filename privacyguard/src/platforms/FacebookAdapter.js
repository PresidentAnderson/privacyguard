const PlatformAdapter = require('./PlatformAdapter');
const axios = require('axios');
const puppeteer = require('puppeteer');

/**
 * FacebookAdapter - Platform adapter for Facebook
 * Supports Graph API and web scraping approaches
 */
class FacebookAdapter extends PlatformAdapter {
  constructor(config = {}) {
    super('Facebook', {
      capabilities: {
        hasOfficialAPI: true,
        supportsGDPRRequests: true,
        supportsOAuth: true,
        supportsPasswordReset: true,
        supportsAccountDeletion: true,
        supportsDataExport: true,
        requiresManualVerification: true
      },
      rateLimits: {
        requestsPerMinute: 200,
        requestsPerHour: 4800,
        requestsPerDay: 100000
      },
      endpoints: {
        api: 'https://graph.facebook.com/v18.0',
        oauth: 'https://www.facebook.com/v18.0/dialog/oauth',
        web: 'https://www.facebook.com',
        mobileWeb: 'https://m.facebook.com',
        settings: 'https://www.facebook.com/settings'
      },
      selectors: {
        loginEmail: '#email',
        loginPassword: '#pass',
        loginButton: '[name="login"]',
        profileName: '[data-testid="profile_name"]',
        settingsMenu: '[aria-label="Settings & privacy"]',
        downloadData: '[data-testid="download_data_link"]',
        deleteAccountButton: '[data-testid="delete_account_button"]'
      },
      ...config
    });
  }

  getSupportedDataTypes() {
    return [
      'profile',
      'posts',
      'photos',
      'videos',
      'friends',
      'pages',
      'groups',
      'events',
      'messages',
      'timeline',
      'reactions',
      'check_ins',
      'ad_preferences',
      'apps_and_websites'
    ];
  }

  async authenticate(credentials) {
    this.logOperationStart('authenticate');
    
    try {
      if (credentials.accessToken) {
        return await this.authenticateWithAccessToken(credentials);
      } else if (credentials.email && credentials.password) {
        return await this.authenticateWithCredentials(credentials);
      } else {
        throw new Error('Invalid credentials provided');
      }
    } catch (error) {
      this.logOperationComplete('authenticate', false, { error: error.message });
      throw this.createError('authenticate', error, { hasAccessToken: !!credentials.accessToken });
    }
  }

  async authenticateWithAccessToken(credentials) {
    const { accessToken } = credentials;
    
    try {
      // Validate access token by fetching user info
      const response = await axios.get(`${this.endpoints.api}/me`, {
        params: {
          access_token: accessToken,
          fields: 'id,name,email,verified'
        }
      });

      const session = {
        type: 'api',
        platform: this.platformName,
        authenticated: true,
        user: response.data,
        accessToken,
        expiresAt: null // Long-lived tokens don't expire unless revoked
      };

      this.logOperationComplete('authenticate', true, { 
        userId: response.data.id,
        username: response.data.name 
      });
      
      return session;
    } catch (error) {
      if (error.response?.status === 400) {
        throw new Error('Invalid or expired Facebook access token');
      }
      throw error;
    }
  }

  async authenticateWithCredentials(credentials) {
    const { email, password } = credentials;
    
    const browser = await puppeteer.launch({
      headless: process.env.NODE_ENV === 'production',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      
      // Navigate to login page
      await page.goto(this.endpoints.web, { waitUntil: 'networkidle2' });
      
      // Handle cookie consent if present
      try {
        const acceptCookiesButton = await page.$('[data-testid="cookie-policy-manage-dialog-accept-button"]');
        if (acceptCookiesButton) {
          await acceptCookiesButton.click();
          await page.waitForTimeout(2000);
        }
      } catch (e) {
        // Cookie dialog not present, continue
      }
      
      // Fill login form
      await page.waitForSelector(this.selectors.loginEmail);
      await page.type(this.selectors.loginEmail, email);
      await page.type(this.selectors.loginPassword, password);
      
      // Submit login form
      await page.click(this.selectors.loginButton);
      await page.waitForNavigation({ waitUntil: 'networkidle2' });
      
      // Handle 2FA if required
      const twoFactorInput = await page.$('[name="approvals_code"]');
      if (twoFactorInput) {
        throw new Error('Two-factor authentication required. Please disable 2FA or provide token.');
      }
      
      // Check for login errors
      const errorElement = await page.$('[data-testid="royal_login_error"]');
      if (errorElement) {
        const errorText = await errorElement.textContent();
        throw new Error(`Facebook login failed: ${errorText}`);
      }
      
      // Verify successful login by checking for profile elements
      await page.waitForSelector('[data-testid="royal_login_button"]', { timeout: 5000 })
        .catch(() => {}); // This selector should NOT be present after successful login
      
      const isLoggedIn = await page.$('[data-testid="royal_login_button"]') === null;
      if (!isLoggedIn) {
        throw new Error('Login failed - still on login page');
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
        email: email.substring(0, 3) + '...',
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
      // Facebook doesn't allow easy email enumeration via password reset
      // We'll use the Graph API search if available, otherwise profile check
      if (identifier.includes('@')) {
        return await this.verifyAccountViaEmail(identifier);
      } else {
        return await this.verifyAccountViaUsername(identifier);
      }
    } catch (error) {
      this.logOperationComplete('verifyAccount', false, { error: error.message });
      throw this.createError('verifyAccount', error, { identifier: identifier.substring(0, 5) + '...' });
    }
  }

  async verifyAccountViaEmail(email) {
    // Facebook has strict privacy controls, so email verification is limited
    // This would require a valid access token with appropriate permissions
    return {
      exists: null, // Unable to determine without proper API access
      method: 'email_lookup',
      confidence: 0,
      note: 'Facebook does not allow email enumeration for privacy reasons'
    };
  }

  async verifyAccountViaUsername(username) {
    try {
      // Check if public profile exists
      const profileUrl = `${this.endpoints.web}/${username}`;
      const response = await axios.get(profileUrl, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (compatible; PrivacyGuard/1.0)' 
        }
      });
      
      const pageContent = response.data;
      const exists = !pageContent.includes('Page Not Found') &&
                    !pageContent.includes('Content Not Found') &&
                    !pageContent.includes('This content isn\'t available');
      
      return { 
        exists, 
        method: 'public_profile',
        confidence: exists ? 75 : 90, // Lower confidence for exists due to privacy settings
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
    
    // Facebook discovery is very limited due to privacy restrictions
    return await this.verifyAccount(identifier, options);
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
    const { accessToken } = session;
    const limit = options.limit || 1000;
    
    switch (dataType) {
      case 'profile':
        return await this.extractAPIProfile(accessToken);
      case 'posts':
        return await this.extractAPIPosts(accessToken, limit);
      case 'photos':
        return await this.extractAPIPhotos(accessToken, limit);
      case 'friends':
        return await this.extractAPIFriends(accessToken, limit);
      default:
        throw new Error(`Data type ${dataType} not supported via API`);
    }
  }

  async extractDataTypeViaWeb(session, dataType, options = {}) {
    const { page } = session;
    
    switch (dataType) {
      case 'profile':
        return await this.extractWebProfile(page);
      case 'posts':
        return await this.extractWebPosts(page, options);
      case 'photos':
        return await this.extractWebPhotos(page, options);
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
      // Navigate to settings page
      await page.goto(`${this.endpoints.settings}`, { waitUntil: 'networkidle2' });
      
      // Navigate to "Your Facebook Information" section
      await page.waitForSelector('[data-testid="settings_menu_item_your_facebook_information"]');
      await page.click('[data-testid="settings_menu_item_your_facebook_information"]');
      
      // Click on "Download Your Information"
      await page.waitForSelector(this.selectors.downloadData);
      await page.click(this.selectors.downloadData);
      
      // Configure download options
      await page.waitForSelector('[data-testid="download_format_select"]');
      await page.select('[data-testid="download_format_select"]', 'JSON');
      
      // Select all data categories (or customize based on options)
      const selectAllButton = await page.$('[data-testid="select_all_data"]');
      if (selectAllButton) {
        await selectAllButton.click();
      }
      
      // Submit request
      await page.click('[data-testid="submit_download_request"]');
      
      // Wait for confirmation
      await page.waitForSelector('[data-testid="download_confirmation"]', { timeout: 10000 });
      
      this.logOperationComplete('requestGDPRExport', true);
      
      return {
        platform: this.platformName,
        requested: true,
        format: 'JSON',
        estimatedTime: '1-10 days',
        deliveryMethod: 'download_link',
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
      // Navigate to account deletion page
      await page.goto(`${this.endpoints.settings}?tab=your_facebook_information`, { waitUntil: 'networkidle2' });
      
      // Click on "Deactivation and Deletion"
      await page.waitForSelector('[data-testid="deactivation_and_deletion_link"]');
      await page.click('[data-testid="deactivation_and_deletion_link"]');
      
      // Choose permanent deletion option
      await page.waitForSelector('[data-testid="delete_account_radio"]');
      await page.click('[data-testid="delete_account_radio"]');
      
      // Click continue
      await page.click('[data-testid="continue_to_account_deletion"]');
      
      // Enter password for confirmation
      await page.waitForSelector('[name="password"]');
      await page.type('[name="password"]', session.password || '');
      
      // Final confirmation
      await page.click(this.selectors.deleteAccountButton);
      
      // Handle deletion confirmation
      await page.waitForSelector('[data-testid="deletion_confirmation"]', { timeout: 15000 });
      
      this.logOperationComplete('executeDeletion', true);
      
      return {
        platform: this.platformName,
        status: 'scheduled_for_deletion',
        permanent: true,
        gracePeriod: '30 days',
        deletedAt: new Date(),
        note: 'Account will be permanently deleted after 30-day grace period'
      };
    } catch (error) {
      this.logOperationComplete('executeDeletion', false, { error: error.message });
      throw this.createError('executeDeletion', error);
    }
  }

  async verifyDeletion(identifier, options = {}) {
    this.logOperationStart('verifyDeletion', { identifier: identifier.substring(0, 5) + '...' });
    
    try {
      // Check if profile is still accessible
      const result = await this.verifyAccount(identifier, options);
      
      const isDeleted = result.exists === false && result.confidence > 90;
      
      this.logOperationComplete('verifyDeletion', true, {
        deleted: isDeleted,
        confidence: result.confidence
      });
      
      return {
        platform: this.platformName,
        identifier,
        deleted: isDeleted,
        confidence: result.confidence,
        verifiedAt: new Date(),
        note: isDeleted ? 'Profile no longer accessible' : 'Profile still accessible or privacy settings prevent verification'
      };
    } catch (error) {
      this.logOperationComplete('verifyDeletion', false, { error: error.message });
      throw this.createError('verifyDeletion', error, { identifier: identifier.substring(0, 5) + '...' });
    }
  }

  // API extraction methods
  async extractAPIProfile(accessToken) {
    const response = await axios.get(`${this.endpoints.api}/me`, {
      params: {
        access_token: accessToken,
        fields: 'id,name,email,birthday,location,hometown,relationship_status,about,quotes,work,education,verified,updated_time'
      }
    });
    
    return {
      dataType: 'profile',
      extractedAt: new Date(),
      data: response.data
    };
  }

  async extractAPIPosts(accessToken, limit) {
    const response = await axios.get(`${this.endpoints.api}/me/posts`, {
      params: {
        access_token: accessToken,
        limit,
        fields: 'id,message,created_time,updated_time,type,link,place,privacy'
      }
    });
    
    return {
      dataType: 'posts',
      extractedAt: new Date(),
      count: response.data.data.length,
      data: response.data.data
    };
  }

  // Web extraction methods
  async extractWebProfile(page) {
    // Navigate to profile page
    await page.goto(`${this.endpoints.web}/me`, { waitUntil: 'networkidle2' });
    
    // Extract profile information
    const profile = await page.evaluate(() => {
      const getName = () => {
        const nameEl = document.querySelector('[data-testid="profile_name"]') || 
                     document.querySelector('h1');
        return nameEl ? nameEl.textContent.trim() : null;
      };
      
      const getBio = () => {
        const bioEl = document.querySelector('[data-testid="profile_bio"]');
        return bioEl ? bioEl.textContent.trim() : null;
      };
      
      return {
        name: getName(),
        bio: getBio(),
        profileUrl: window.location.href
      };
    });
    
    return {
      dataType: 'profile',
      extractedAt: new Date(),
      data: profile
    };
  }

  async getAccountMetadata(session) {
    if (session.type === 'api') {
      try {
        const profile = await this.extractAPIProfile(session.accessToken);
        return {
          platform: this.platformName,
          accountId: profile.data.id,
          name: profile.data.name,
          verified: profile.data.verified || false,
          lastActivity: profile.data.updated_time ? new Date(profile.data.updated_time) : null,
          accountType: 'personal'
        };
      } catch (error) {
        this.logger.warn('Failed to extract account metadata via API', { error: error.message });
      }
    }
    
    // Return basic metadata
    return super.getAccountMetadata(session);
  }

  async cleanup(session) {
    if (session.browser) {
      await session.browser.close();
    }
  }
}

module.exports = FacebookAdapter;