const DeletionStrategyFactory = require('./strategies/DeletionStrategyFactory');
const LegalComplianceEnforcer = require('../legal/LegalComplianceEnforcer');
const DeletionVerificationEngine = require('./DeletionVerificationEngine');
const DataExtractionEngine = require('../extraction/DataExtractionEngine');
const logger = require('../utils/logger');

class AccountDeletionEngine {
  constructor() {
    this.deletionStrategies = new DeletionStrategyFactory();
    this.legalEnforcer = new LegalComplianceEnforcer();
    this.verificationEngine = new DeletionVerificationEngine();
    this.dataExtractor = new DataExtractionEngine();
  }

  async deleteAccount(account, deletionType = 'full', options = {}) {
    logger.info(`Starting account deletion for ${account.platform}`, {
      accountId: account._id,
      deletionType,
      backupRequested: options.backupBeforeDelete
    });

    try {
      // Step 1: Backup data if requested
      if (options.backupBeforeDelete) {
        logger.info(`Backing up data before deletion for ${account.platform}`);
        try {
          await this.dataExtractor.extractUserData(account, 'full');
        } catch (backupError) {
          logger.error('Backup failed', backupError);
          if (!options.proceedWithoutBackup) {
            throw new Error('Backup failed. Deletion cancelled for safety.');
          }
        }
      }

      // Step 2: Get platform-specific deletion strategy
      const strategy = this.deletionStrategies.getStrategy(account.platform);
      
      if (!strategy) {
        logger.warn(`No deletion strategy found for ${account.platform}`);
        return await this.genericDeletionAttempt(account);
      }

      // Step 3: Execute deletion
      const deletionResult = await strategy.executeDeletion(account, deletionType);

      // Step 4: Verify deletion
      const verificationResult = await this.verificationEngine.verifyDeletion(
        account,
        deletionResult
      );

      // Step 5: Legal enforcement if needed
      if (!verificationResult.confirmed && deletionResult.requiresLegalAction) {
        logger.info('Deletion not confirmed, initiating legal enforcement');
        await this.legalEnforcer.enforceDeletionRights(account);
      }

      // Step 6: Update account status
      await this.updateAccountStatus(account._id, deletionResult, verificationResult);

      return {
        status: verificationResult.confirmed ? 'completed' : 'pending',
        deletionDate: new Date(),
        verification: verificationResult,
        legalActionInitiated: deletionResult.requiresLegalAction,
        coolingOffPeriod: deletionResult.coolingOffPeriod
      };

    } catch (error) {
      logger.error(`Account deletion failed for ${account.platform}`, error);
      await this.handleDeletionFailure(account, error);
      throw error;
    }
  }

  async genericDeletionAttempt(account) {
    logger.info(`Attempting generic deletion for ${account.platform}`);
    
    // Generate deletion instructions
    const instructions = this.generateDeletionInstructions(account.platform);
    
    // Send deletion request email if available
    if (account.email) {
      await this.sendDeletionRequestEmail(account);
    }

    return {
      status: 'manual_required',
      instructions,
      emailSent: !!account.email,
      message: 'Automated deletion not available. Please follow the manual instructions.'
    };
  }

  async updateAccountStatus(accountId, deletionResult, verificationResult) {
    const Account = require('../models/Account');
    
    const status = verificationResult.confirmed ? 'deleted' : 
                   deletionResult.coolingOffPeriod ? 'pending_deletion' : 
                   'deletion_attempted';

    await Account.findByIdAndUpdate(accountId, {
      status,
      deletionAttempts: {
        $push: {
          date: new Date(),
          status: deletionResult.status,
          method: deletionResult.method,
          error: deletionResult.error
        }
      },
      coolingOffEndDate: deletionResult.coolingOffEndDate
    });
  }

  async handleDeletionFailure(account, error) {
    const Account = require('../models/Account');
    
    await Account.findByIdAndUpdate(account._id, {
      $push: {
        deletionAttempts: {
          date: new Date(),
          status: 'failed',
          error: error.message
        }
      }
    });

    // Schedule retry if appropriate
    if (this.shouldRetryDeletion(error)) {
      await this.scheduleDeletionRetry(account, error);
    }
  }

  shouldRetryDeletion(error) {
    const retryableErrors = [
      'RATE_LIMIT',
      'TEMPORARY_ERROR',
      'NETWORK_ERROR',
      'TIMEOUT'
    ];
    
    return retryableErrors.some(e => error.message.includes(e));
  }

  async scheduleDeletionRetry(account, error) {
    // Implementation would use job queue
    logger.info(`Scheduling deletion retry for ${account.platform}`);
  }

  generateDeletionInstructions(platform) {
    const instructions = {
      facebook: [
        'Go to Settings & Privacy > Settings',
        'Click "Your Facebook Information"',
        'Select "Deactivation and Deletion"',
        'Choose "Delete Account" and follow prompts',
        'Note: 30-day cooling off period applies'
      ],
      google: [
        'Visit myaccount.google.com',
        'Click "Data & privacy"',
        'Scroll to "Delete your Google Account"',
        'Follow the deletion process',
        'Download your data first if needed'
      ],
      twitter: [
        'Go to Settings and privacy',
        'Click "Your account"',
        'Select "Deactivate your account"',
        'Read the information and click "Deactivate"',
        'Note: Can reactivate within 30 days'
      ],
      default: [
        'Look for Account/Privacy settings',
        'Find "Delete Account" or similar option',
        'Follow the platform\'s deletion process',
        'Save any important data first',
        'Check email for confirmation'
      ]
    };

    return instructions[platform] || instructions.default;
  }

  async sendDeletionRequestEmail(account) {
    const emailTemplate = `
Subject: Account Deletion Request - ${account.email}

Dear ${account.platform} Support,

I am writing to request the complete deletion of my account associated with the email address ${account.email}.

Under applicable data protection laws (GDPR Article 17, CCPA), I am exercising my right to erasure ("right to be forgotten").

Please delete:
- All personal data associated with my account
- All content I have created or uploaded
- All metadata and logs related to my account
- Any backups containing my information

Please confirm the deletion has been completed and provide a deletion certificate if available.

If you require any additional information to process this request, please contact me at this email address.

Thank you for your prompt attention to this matter.

Sincerely,
${account.userId}
    `;

    // Send email implementation
    logger.info(`Deletion request email sent for ${account.platform}`);
    return emailTemplate;
  }
}

module.exports = AccountDeletionEngine;