const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const PrivacyMonitoringSystem = require('../monitoring/PrivacyMonitoringSystem');
const PersonalArchiveSystem = require('../archive/PersonalArchiveSystem');
const AccountDiscoveryEngine = require('../discovery/AccountDiscoveryEngine');

const monitoringSystem = new PrivacyMonitoringSystem();
const archiveSystem = new PersonalArchiveSystem();
const discoveryEngine = new AccountDiscoveryEngine();

// Dashboard overview
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get dashboard data in parallel
    const [
      accounts,
      recentActivity,
      privacyScore,
      archiveStats,
      alertsSummary
    ] = await Promise.all([
      getAccountsSummary(userId),
      getRecentActivity(userId),
      getPrivacyScore(userId),
      archiveSystem.getArchiveStats(userId),
      getAlertsSummary(userId)
    ]);

    res.json({
      success: true,
      dashboard: {
        accounts,
        recentActivity,
        privacyScore,
        archiveStats,
        alertsSummary,
        lastUpdated: new Date()
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Privacy monitoring status
router.get('/monitoring', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const User = require('../models/User');
    const user = await User.findById(userId);
    
    if (!user.privacySettings.monitoringEnabled) {
      return res.json({
        success: true,
        monitoring: {
          enabled: false,
          message: 'Privacy monitoring is disabled'
        }
      });
    }

    // Get monitoring status
    const monitoringStatus = await getMonitoringStatus(userId);
    
    res.json({
      success: true,
      monitoring: monitoringStatus
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start privacy monitoring
router.post('/monitoring/start', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const User = require('../models/User');
    const user = await User.findById(userId);
    
    // Enable monitoring
    await User.findByIdAndUpdate(userId, {
      'privacySettings.monitoringEnabled': true
    });

    // Start monitoring
    const result = await monitoringSystem.startContinuousMonitoring(user);
    
    res.json({
      success: true,
      message: 'Privacy monitoring started',
      monitoring: result
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get privacy timeline
router.get('/timeline', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { startDate, endDate, platform } = req.query;
    
    const dateRange = {
      start: startDate ? new Date(startDate) : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
      end: endDate ? new Date(endDate) : new Date()
    };

    const timeline = await archiveSystem.getTimeline(userId, dateRange);
    
    // Filter by platform if specified
    if (platform) {
      timeline.events = timeline.events.filter(event => event.platform === platform);
    }

    res.json({
      success: true,
      timeline
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Search personal archive
router.get('/search', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { query, platform, type, limit = 50 } = req.query;
    
    if (!query) {
      return res.status(400).json({ 
        success: false, 
        error: 'Search query is required' 
      });
    }

    const searchOptions = {
      platform,
      type,
      limit: parseInt(limit)
    };

    const results = await archiveSystem.searchArchive(userId, query, searchOptions);
    
    res.json({
      success: true,
      search: {
        query,
        results: results.hits,
        totalResults: results.total,
        searchTime: results.searchTime
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get privacy report
router.get('/report', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { timeframe = 30 } = req.query;
    
    const report = await monitoringSystem.generatePrivacyReport(userId, parseInt(timeframe));
    
    res.json({
      success: true,
      report
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Export privacy report
router.get('/report/export', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { format = 'pdf', timeframe = 30 } = req.query;
    
    const report = await monitoringSystem.generatePrivacyReport(userId, parseInt(timeframe));
    
    if (format === 'pdf') {
      // Generate PDF report
      const pdfBuffer = await generatePDFReport(report);
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="privacy-report-${new Date().toISOString().split('T')[0]}.pdf"`);
      res.send(pdfBuffer);
    } else {
      // JSON export
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="privacy-report-${new Date().toISOString().split('T')[0]}.json"`);
      res.json(report);
    }

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get account insights
router.get('/insights', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const insights = await generateAccountInsights(userId);
    
    res.json({
      success: true,
      insights
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper functions
async function getAccountsSummary(userId) {
  const Account = require('../models/Account');
  
  const accounts = await Account.find({ userId });
  const summary = {
    total: accounts.length,
    active: accounts.filter(a => a.status === 'active').length,
    deleted: accounts.filter(a => a.status === 'deleted').length,
    pendingDeletion: accounts.filter(a => a.status === 'pending_deletion').length,
    platforms: [...new Set(accounts.map(a => a.platform))],
    lastDiscovery: accounts.reduce((latest, acc) => 
      acc.lastVerified > latest ? acc.lastVerified : latest, new Date(0)
    )
  };
  
  return summary;
}

async function getRecentActivity(userId) {
  // Get recent activity from various sources
  const activities = [];
  
  // Recent account discoveries
  const Account = require('../models/Account');
  const recentAccounts = await Account.find({ 
    userId, 
    createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
  }).sort({ createdAt: -1 }).limit(5);
  
  for (const account of recentAccounts) {
    activities.push({
      type: 'account_discovered',
      timestamp: account.createdAt,
      description: `Discovered account on ${account.platform}`,
      platform: account.platform
    });
  }
  
  // Recent data extractions
  const extractions = await Account.find({
    userId,
    'dataExtracted.lastExtraction': { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
  }).sort({ 'dataExtracted.lastExtraction': -1 }).limit(5);
  
  for (const extraction of extractions) {
    activities.push({
      type: 'data_extracted',
      timestamp: extraction.dataExtracted.lastExtraction,
      description: `Data extracted from ${extraction.platform}`,
      platform: extraction.platform
    });
  }
  
  return activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 10);
}

async function getPrivacyScore(userId) {
  return await monitoringSystem.calculatePrivacyScore(userId);
}

async function getAlertsSummary(userId) {
  // Get recent alerts summary
  return {
    total: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    lastAlert: null
  };
}

async function getMonitoringStatus(userId) {
  const User = require('../models/User');
  const user = await User.findById(userId);
  
  return {
    enabled: user.privacySettings.monitoringEnabled,
    lastScan: user.lastBreachCheck,
    nextScan: user.lastBreachCheck ? 
      new Date(user.lastBreachCheck.getTime() + 24 * 60 * 60 * 1000) : 
      new Date(),
    alertsEnabled: user.privacySettings.alertPreferences.email
  };
}

async function generateAccountInsights(userId) {
  const Account = require('../models/Account');
  const accounts = await Account.find({ userId });
  
  const insights = {
    platformDistribution: {},
    securityRisks: [],
    deletionOpportunities: [],
    dataExposure: {
      total: 0,
      byPlatform: {}
    }
  };
  
  // Platform distribution
  for (const account of accounts) {
    insights.platformDistribution[account.platform] = 
      (insights.platformDistribution[account.platform] || 0) + 1;
  }
  
  // Security risks
  const inactiveAccounts = accounts.filter(a => 
    a.metadata.lastActivity && 
    new Date() - new Date(a.metadata.lastActivity) > 365 * 24 * 60 * 60 * 1000
  );
  
  if (inactiveAccounts.length > 0) {
    insights.securityRisks.push({
      type: 'inactive_accounts',
      count: inactiveAccounts.length,
      message: `${inactiveAccounts.length} accounts haven't been used in over a year`,
      recommendation: 'Consider deleting unused accounts'
    });
  }
  
  // Deletion opportunities
  const lowValuePlatforms = ['quiz sites', 'temporary services', 'promotional accounts'];
  const deletionCandidates = accounts.filter(a => 
    lowValuePlatforms.some(platform => a.platform.toLowerCase().includes(platform))
  );
  
  insights.deletionOpportunities = deletionCandidates.map(account => ({
    platform: account.platform,
    reason: 'Low value platform',
    effort: 'Easy'
  }));
  
  return insights;
}

async function generatePDFReport(report) {
  // Would generate PDF using a library like PDFKit or Puppeteer
  // For now, return a placeholder
  return Buffer.from('PDF Report Placeholder');
}

module.exports = router;