const puppeteer = require('puppeteer');
const logger = require('../../utils/logger');

class FacebookDeletionStrategy {
  async executeDeletion(account, deletionType) {
    logger.info('Executing Facebook deletion strategy');
    
    const browser = await puppeteer.launch({
      headless: process.env.PUPPETEER_HEADLESS === 'true',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
      const page = await browser.newPage();
      
      // Login to Facebook
      await this.loginToFacebook(page, account.credentials);
      
      // Navigate to deletion page
      await page.goto('https://www.facebook.com/help/delete_account', {
        waitUntil: 'networkidle2'
      });

      // Handle the deliberately confusing deletion flow
      await this.navigateDeletionMaze(page);

      // Submit final deletion request
      const result = await this.submitDeletionRequest(page);

      return {
        status: 'cooling_off',
        method: 'automated_browser',
        coolingOffPeriod: 30 * 24 * 60 * 60 * 1000, // 30 days in ms
        coolingOffEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        finalDeletionDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        reactivationRisk: true,
        requiresLegalAction: false,
        screenshots: result.screenshots
      };

    } catch (error) {
      logger.error('Facebook deletion failed', error);
      return {
        status: 'failed',
        error: error.message,
        requiresLegalAction: true
      };
    } finally {
      await browser.close();
    }
  }

  async loginToFacebook(page, credentials) {
    await page.goto('https://www.facebook.com/login');
    
    // Enter credentials
    await page.type('#email', credentials.email || credentials.username);
    await page.type('#pass', credentials.password);
    
    // Submit login
    await Promise.all([
      page.click('#loginbutton'),
      page.waitForNavigation({ waitUntil: 'networkidle2' })
    ]);

    // Handle 2FA if present
    const has2FA = await page.$('input[name="approvals_code"]');
    if (has2FA) {
      // Would need to handle 2FA flow
      throw new Error('2FA required - manual intervention needed');
    }
  }

  async navigateDeletionMaze(page) {
    // Facebook makes deletion intentionally difficult
    const obstacles = [
      { text: 'Your friends will miss you', action: 'continue' },
      { text: 'You can deactivate instead', action: 'delete' },
      { text: 'Download your information first', action: 'skip' },
      { text: 'Are you sure', action: 'confirm' },
      { text: 'This is permanent', action: 'understand' }
    ];

    for (const obstacle of obstacles) {
      try {
        // Look for obstacle text
        const element = await page.waitForXPath(
          `//*[contains(text(), "${obstacle.text}")]`,
          { timeout: 5000 }
        );

        if (element) {
          // Find and click the continue/delete button
          const continueButton = await page.$x(
            `//button[contains(text(), "Delete") or contains(text(), "Continue") or contains(text(), "Confirm")]`
          );
          
          if (continueButton.length > 0) {
            await continueButton[0].click();
            await page.waitForTimeout(2000);
          }
        }
      } catch (e) {
        // Some obstacles might not appear for all users
        logger.debug(`Obstacle not found: ${obstacle.text}`);
      }
    }
  }

  async submitDeletionRequest(page) {
    const screenshots = [];
    
    // Take screenshot before final submission
    const beforeScreenshot = await page.screenshot({ 
      path: `deletion_facebook_before_${Date.now()}.png`,
      fullPage: true 
    });
    screenshots.push(beforeScreenshot);

    // Find and click final delete button
    const deleteButton = await page.$x(
      '//button[contains(text(), "Delete Account") and not(@disabled)]'
    );

    if (deleteButton.length > 0) {
      await deleteButton[0].click();
      
      // Wait for confirmation
      await page.waitForTimeout(5000);
      
      // Take confirmation screenshot
      const afterScreenshot = await page.screenshot({ 
        path: `deletion_facebook_after_${Date.now()}.png`,
        fullPage: true 
      });
      screenshots.push(afterScreenshot);

      // Check for success message
      const successMessage = await page.$x(
        '//*[contains(text(), "scheduled for deletion") or contains(text(), "will be deleted")]'
      );

      if (successMessage.length > 0) {
        logger.info('Facebook deletion request submitted successfully');
        return { success: true, screenshots };
      }
    }

    throw new Error('Could not submit deletion request');
  }

  async verifyDeletion(account) {
    // Verification logic for Facebook
    try {
      const browser = await puppeteer.launch({ headless: true });
      const page = await browser.newPage();
      
      // Try to access the profile
      await page.goto(`https://www.facebook.com/${account.username || account.userId}`);
      
      // Check if profile exists
      const profileNotFound = await page.$x(
        '//*[contains(text(), "This content isn\'t available") or contains(text(), "Page not found")]'
      );

      await browser.close();

      return {
        deleted: profileNotFound.length > 0,
        checkedAt: new Date()
      };
    } catch (error) {
      logger.error('Facebook deletion verification failed', error);
      return { deleted: false, error: error.message };
    }
  }
}

module.exports = FacebookDeletionStrategy;