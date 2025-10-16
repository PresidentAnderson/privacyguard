const GDPRRequestAutomator = require('./GDPRRequestAutomator');
const DownloadManager = require('./DownloadManager');
const PersonalDataOrganizer = require('./PersonalDataOrganizer');
const PlatformAdapterFactory = require('./adapters/PlatformAdapterFactory');
const logger = require('../utils/logger');

class DataExtractionEngine {
  constructor() {
    this.platformAdapters = new PlatformAdapterFactory();
    this.gdprAutomator = new GDPRRequestAutomator();
    this.downloadManager = new DownloadManager();
    this.dataOrganizer = new PersonalDataOrganizer();
  }

  async extractUserData(account, extractionType = 'full') {
    logger.info(`Starting data extraction for ${account.platform}`, {
      accountId: account._id,
      extractionType
    });

    try {
      // Get platform-specific adapter
      const adapter = this.platformAdapters.getAdapter(account.platform);
      
      if (!adapter) {
        logger.warn(`No adapter found for platform: ${account.platform}`);
        return await this.genericExtractionFallback(account);
      }

      // Try extraction methods in order of preference
      let result = null;

      // Method 1: Official API (preferred)
      if (adapter.hasOfficialAPI()) {
        result = await this.extractViaAPI(account, adapter);
      }
      
      // Method 2: GDPR/CCPA Data Export (legal right)
      if (!result && this.gdprAutomator.supportsPlatform(account.platform)) {
        result = await this.extractViaGDPR(account);
      }
      
      // Method 3: Intelligent web scraping (last resort)
      if (!result) {
        result = await this.extractViaScraping(account, adapter);
      }

      // Organize and store extracted data
      if (result) {
        const organized = await this.dataOrganizer.organizeData(
          account.platform,
          result,
          new Date()
        );

        // Update account extraction status
        await this.updateExtractionStatus(account._id, 'completed', organized.archiveId);

        return organized;
      }

      throw new Error('All extraction methods failed');

    } catch (error) {
      logger.error(`Data extraction failed for ${account.platform}`, error);
      await this.updateExtractionStatus(account._id, 'failed', null, error.message);
      throw error;
    }
  }

  async extractViaAPI(account, adapter) {
    logger.info(`Attempting API extraction for ${account.platform}`);
    
    try {
      // Authenticate using stored credentials
      const session = await adapter.authenticate(account.credentials);
      
      if (!session) {
        throw new Error('Authentication failed');
      }

      // Get extraction plan
      const extractionPlan = adapter.getExtractionPlan();
      const extractedData = {};

      // Extract each data type
      for (const dataType of extractionPlan) {
        try {
          logger.info(`Extracting ${dataType} from ${account.platform}`);
          
          const data = await adapter.extractDataType(session, dataType);
          extractedData[dataType] = data;

          // Save incrementally for large datasets
          await this.saveDataIncrementally(account, dataType, data);

          // Update progress
          await this.updateExtractionProgress(account._id, dataType, 'completed');

        } catch (error) {
          if (error.name === 'RateLimitError') {
            // Schedule retry for rate-limited requests
            await this.scheduleRetry(account, dataType, error.retryAfter);
          } else {
            logger.error(`Failed to extract ${dataType}`, error);
            await this.updateExtractionProgress(account._id, dataType, 'failed');
          }
        }
      }

      return extractedData;

    } catch (error) {
      logger.error(`API extraction failed for ${account.platform}`, error);
      return null;
    }
  }

  async extractViaGDPR(account) {
    logger.info(`Attempting GDPR extraction for ${account.platform}`);
    
    try {
      // Generate GDPR data request
      const request = await this.gdprAutomator.createDataRequest({
        account,
        requestType: 'data_portability',
        legalBasis: 'GDPR Article 20'
      });

      // Submit request through platform's official channels
      const submission = await this.gdprAutomator.submitRequest(account, request);

      // Monitor request status
      const result = await this.monitorGDPRRequest(account, submission.requestId);

      return result;

    } catch (error) {
      logger.error(`GDPR extraction failed for ${account.platform}`, error);
      return null;
    }
  }

  async extractViaScraping(account, adapter) {
    logger.info(`Attempting scraping extraction for ${account.platform}`);
    
    try {
      // Use adapter's scraping capabilities
      const scrapingSession = await adapter.initializeScraping(account.credentials);
      
      if (!scrapingSession) {
        throw new Error('Could not initialize scraping session');
      }

      const extractedData = await adapter.scrapeUserData(scrapingSession);
      
      await scrapingSession.close();

      return extractedData;

    } catch (error) {
      logger.error(`Scraping extraction failed for ${account.platform}`, error);
      return null;
    }
  }

  async monitorGDPRRequest(account, requestId) {
    const maxAttempts = 30; // 30 days
    const checkInterval = 24 * 60 * 60 * 1000; // Daily checks

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const status = await this.gdprAutomator.checkRequestStatus(account, requestId);

      if (status.completed) {
        if (status.downloadUrl) {
          // Download the data archive
          const downloadPath = await this.downloadManager.downloadFile(
            status.downloadUrl,
            `${account.platform}_gdpr_export.zip`
          );

          // Extract and process the archive
          const extractedData = await this.processGDPRArchive(downloadPath);
          
          return extractedData;
        }
      }

      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    throw new Error('GDPR request timeout');
  }

  async saveDataIncrementally(account, dataType, data) {
    const batchSize = 1000;
    
    if (Array.isArray(data) && data.length > batchSize) {
      // Save in batches
      for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize);
        await this.downloadManager.saveBatch(account._id, dataType, batch, i);
      }
    } else {
      // Save all at once
      await this.downloadManager.saveData(account._id, dataType, data);
    }
  }

  async updateExtractionStatus(accountId, status, archiveId = null, error = null) {
    const Account = require('../models/Account');
    
    await Account.findByIdAndUpdate(accountId, {
      'dataExtracted.status': status,
      'dataExtracted.lastExtraction': new Date(),
      'dataExtracted.archiveId': archiveId,
      'dataExtracted.error': error
    });
  }

  async updateExtractionProgress(accountId, dataType, status) {
    // Update progress in database for UI display
    const progress = {
      accountId,
      dataType,
      status,
      timestamp: new Date()
    };

    // Emit progress event for real-time updates
    this.emit('extraction-progress', progress);
  }

  async scheduleRetry(account, dataType, retryAfter) {
    const retryDate = new Date(Date.now() + retryAfter * 1000);
    
    logger.info(`Scheduling retry for ${account.platform} ${dataType} at ${retryDate}`);
    
    // Implementation would use a job queue like Bull or Agenda
    // For now, just log the scheduled retry
  }

  async processGDPRArchive(archivePath) {
    // Extract and process GDPR data archive
    const extractedPath = await this.downloadManager.extractArchive(archivePath);
    const processedData = await this.dataOrganizer.processGDPRExport(extractedPath);
    
    return processedData;
  }

  async genericExtractionFallback(account) {
    logger.warn(`Using generic extraction for ${account.platform}`);
    
    // Generic extraction logic for unsupported platforms
    return {
      platform: account.platform,
      extractionMethod: 'generic',
      extractedAt: new Date(),
      data: {
        message: 'Platform-specific extraction not available. Please use manual export.'
      }
    };
  }
}

module.exports = DataExtractionEngine;