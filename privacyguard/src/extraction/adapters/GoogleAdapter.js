const { google } = require('googleapis');
const puppeteer = require('puppeteer');
const logger = require('../../utils/logger');

class GoogleAdapter {
  constructor() {
    this.takeoutUrl = 'https://takeout.google.com';
    this.apiScopes = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/photoslibrary.readonly',
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/contacts.readonly'
    ];
  }

  hasOfficialAPI() {
    return true;
  }

  async authenticate(credentials) {
    try {
      if (credentials.oauth && credentials.oauth.token) {
        // Use existing OAuth token
        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({
          access_token: credentials.oauth.token,
          refresh_token: credentials.oauth.refreshToken
        });
        
        return oauth2Client;
      }
      
      // Fallback to browser automation for authentication
      return await this.browserAuthenticate(credentials);
    } catch (error) {
      logger.error('Google authentication failed', error);
      return null;
    }
  }

  getExtractionPlan() {
    return [
      'gmail',
      'drive',
      'photos',
      'youtube',
      'maps',
      'chrome',
      'search_history',
      'contacts',
      'calendar'
    ];
  }

  async extractDataType(session, dataType) {
    const extractors = {
      gmail: () => this.extractGmailData(session),
      drive: () => this.extractDriveData(session),
      photos: () => this.extractPhotosData(session),
      youtube: () => this.extractYouTubeData(session),
      contacts: () => this.extractContactsData(session),
      calendar: () => this.extractCalendarData(session),
      search_history: () => this.extractSearchHistory(session),
      chrome: () => this.extractChromeData(session),
      maps: () => this.extractMapsData(session)
    };

    const extractor = extractors[dataType];
    if (!extractor) {
      throw new Error(`Unknown data type: ${dataType}`);
    }

    return await extractor();
  }

  async extractGmailData(auth) {
    const gmail = google.gmail({ version: 'v1', auth });
    
    try {
      // Get all messages
      const messages = await this.paginateGmailMessages(gmail);
      
      // Extract full message content
      const fullMessages = [];
      const batchSize = 50;
      
      for (let i = 0; i < messages.length; i += batchSize) {
        const batch = messages.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(msg => this.getFullMessage(gmail, msg.id))
        );
        fullMessages.push(...batchResults);
        
        // Progress update
        logger.info(`Extracted ${fullMessages.length}/${messages.length} Gmail messages`);
      }

      // Get additional Gmail data
      const [labels, filters, settings] = await Promise.all([
        this.extractGmailLabels(gmail),
        this.extractGmailFilters(gmail),
        this.extractGmailSettings(gmail)
      ]);

      return {
        messages: fullMessages,
        labels,
        filters,
        settings,
        totalMessages: fullMessages.length,
        extractedAt: new Date()
      };
    } catch (error) {
      logger.error('Gmail extraction failed', error);
      throw error;
    }
  }

  async paginateGmailMessages(gmail) {
    const messages = [];
    let pageToken = null;

    do {
      const response = await gmail.users.messages.list({
        userId: 'me',
        pageToken,
        maxResults: 500
      });

      if (response.data.messages) {
        messages.push(...response.data.messages);
      }

      pageToken = response.data.nextPageToken;
    } while (pageToken);

    return messages;
  }

  async getFullMessage(gmail, messageId) {
    try {
      const response = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full'
      });

      const message = response.data;
      
      // Extract attachments if present
      const attachments = await this.extractAttachments(gmail, message);

      return {
        id: message.id,
        threadId: message.threadId,
        labelIds: message.labelIds,
        snippet: message.snippet,
        payload: message.payload,
        attachments,
        sizeEstimate: message.sizeEstimate,
        internalDate: message.internalDate
      };
    } catch (error) {
      logger.warn(`Failed to get message ${messageId}`, error);
      return null;
    }
  }

  async extractAttachments(gmail, message) {
    const attachments = [];
    
    const findAttachments = (parts) => {
      for (const part of parts || []) {
        if (part.filename && part.body.attachmentId) {
          attachments.push({
            filename: part.filename,
            mimeType: part.mimeType,
            size: part.body.size,
            attachmentId: part.body.attachmentId
          });
        }
        
        if (part.parts) {
          findAttachments(part.parts);
        }
      }
    };

    if (message.payload) {
      findAttachments([message.payload]);
      findAttachments(message.payload.parts);
    }

    return attachments;
  }

  async extractDriveData(auth) {
    const drive = google.drive({ version: 'v3', auth });
    
    try {
      // Get all files
      const files = await this.paginateDriveFiles(drive);
      
      // Group files by type
      const filesByType = {
        documents: [],
        spreadsheets: [],
        presentations: [],
        images: [],
        videos: [],
        others: []
      };

      for (const file of files) {
        const category = this.categorizeDriveFile(file);
        filesByType[category].push({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          size: file.size,
          createdTime: file.createdTime,
          modifiedTime: file.modifiedTime,
          owners: file.owners,
          shared: file.shared,
          trashed: file.trashed,
          webViewLink: file.webViewLink
        });
      }

      return {
        files: filesByType,
        totalFiles: files.length,
        totalSize: files.reduce((sum, file) => sum + (parseInt(file.size) || 0), 0),
        extractedAt: new Date()
      };
    } catch (error) {
      logger.error('Drive extraction failed', error);
      throw error;
    }
  }

  async paginateDriveFiles(drive) {
    const files = [];
    let pageToken = null;

    do {
      const response = await drive.files.list({
        pageSize: 1000,
        pageToken,
        fields: 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, owners, shared, trashed, webViewLink)',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true
      });

      if (response.data.files) {
        files.push(...response.data.files);
      }

      pageToken = response.data.nextPageToken;
    } while (pageToken);

    return files;
  }

  categorizeDriveFile(file) {
    const mimeType = file.mimeType;
    
    if (mimeType.includes('document')) return 'documents';
    if (mimeType.includes('spreadsheet')) return 'spreadsheets';
    if (mimeType.includes('presentation')) return 'presentations';
    if (mimeType.includes('image')) return 'images';
    if (mimeType.includes('video')) return 'videos';
    
    return 'others';
  }

  async extractPhotosData(auth) {
    // Google Photos API has limitations, may need to use Takeout
    try {
      const photos = google.photoslibrary({ version: 'v1', auth });
      
      // Get albums
      const albums = await this.paginatePhotoAlbums(photos);
      
      // Get media items
      const mediaItems = await this.paginatePhotoMediaItems(photos);

      return {
        albums: albums.map(album => ({
          id: album.id,
          title: album.title,
          productUrl: album.productUrl,
          mediaItemsCount: album.mediaItemsCount
        })),
        mediaItems: mediaItems.map(item => ({
          id: item.id,
          description: item.description,
          productUrl: item.productUrl,
          mimeType: item.mimeType,
          filename: item.filename,
          creationTime: item.mediaMetadata.creationTime,
          width: item.mediaMetadata.width,
          height: item.mediaMetadata.height
        })),
        totalPhotos: mediaItems.length,
        extractedAt: new Date()
      };
    } catch (error) {
      logger.error('Photos extraction failed', error);
      // Fallback to Takeout request
      return { requiresTakeout: true, error: error.message };
    }
  }

  async browserAuthenticate(credentials) {
    // Implement browser-based authentication for Google
    const browser = await puppeteer.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
      const page = await browser.newPage();
      await page.goto('https://accounts.google.com');
      
      // Login flow would be implemented here
      // This is a placeholder for the actual implementation
      
      return null; // Would return authenticated session
    } finally {
      await browser.close();
    }
  }

  async initializeScraping(credentials) {
    // Initialize browser for scraping Google Takeout
    const browser = await puppeteer.launch({
      headless: process.env.PUPPETEER_HEADLESS === 'true',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    
    // Login and navigate to Takeout
    await this.loginToGoogle(page, credentials);
    await page.goto(this.takeoutUrl);

    return { browser, page };
  }

  async scrapeUserData(session) {
    const { page } = session;
    
    try {
      // Select all Google products for export
      await page.click('button[aria-label="Deselect all"]');
      await page.click('button[aria-label="Select all"]');
      
      // Configure export settings
      await page.click('button[aria-label="Next step"]');
      
      // Choose delivery method and frequency
      await page.select('select[aria-label="Delivery method"]', 'email');
      await page.select('select[aria-label="File type"]', 'zip');
      
      // Create export
      await page.click('button[aria-label="Create export"]');
      
      // Get export ID for tracking
      const exportId = await page.evaluate(() => {
        // Extract export ID from page
        return document.querySelector('.export-id')?.textContent;
      });

      return {
        exportRequested: true,
        exportId,
        estimatedTime: '2-7 days',
        deliveryMethod: 'email'
      };
    } catch (error) {
      logger.error('Google Takeout scraping failed', error);
      throw error;
    }
  }
}

module.exports = GoogleAdapter;