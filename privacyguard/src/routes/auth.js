const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, password, fullName, tier = 'free' } = req.body;

    // Validate input
    if (!email || !password || !fullName) {
      return res.status(400).json({
        success: false,
        error: 'Email, password, and full name are required'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'User already exists with this email'
      });
    }

    // Create new user
    const user = new User({
      email: email.toLowerCase(),
      password,
      profile: {
        fullName,
        phoneNumbers: [],
        alternativeEmails: [],
        commonUsernames: []
      },
      subscription: {
        tier,
        startDate: new Date()
      },
      privacySettings: {
        monitoringEnabled: true,
        alertPreferences: {
          email: true,
          sms: false,
          push: true
        }
      }
    });

    await user.save();

    // Generate JWT token
    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    logger.info('User registered successfully', { userId: user._id, email });

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        email: user.email,
        fullName: user.profile.fullName,
        tier: user.subscription.tier
      }
    });

  } catch (error) {
    logger.error('Registration failed', error);
    res.status(500).json({
      success: false,
      error: 'Registration failed'
    });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    logger.info('User logged in successfully', { userId: user._id, email });

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        email: user.email,
        fullName: user.profile.fullName,
        tier: user.subscription.tier
      }
    });

  } catch (error) {
    logger.error('Login failed', error);
    res.status(500).json({
      success: false,
      error: 'Login failed'
    });
  }
});

// Get user profile
router.get('/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      user
    });

  } catch (error) {
    logger.error('Failed to get user profile', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user profile'
    });
  }
});

// Update user profile
router.put('/profile', auth, async (req, res) => {
  try {
    const { fullName, phoneNumbers, alternativeEmails, commonUsernames, location } = req.body;

    const updateData = {};
    if (fullName) updateData['profile.fullName'] = fullName;
    if (phoneNumbers) updateData['profile.phoneNumbers'] = phoneNumbers;
    if (alternativeEmails) updateData['profile.alternativeEmails'] = alternativeEmails;
    if (commonUsernames) updateData['profile.commonUsernames'] = commonUsernames;
    if (location) updateData['profile.location'] = location;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updateData },
      { new: true }
    ).select('-password');

    logger.info('User profile updated', { userId: user._id });

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user
    });

  } catch (error) {
    logger.error('Failed to update user profile', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update profile'
    });
  }
});

// Update privacy settings
router.put('/privacy-settings', auth, async (req, res) => {
  try {
    const { monitoringEnabled, alertPreferences, retentionPeriod } = req.body;

    const updateData = {};
    if (typeof monitoringEnabled === 'boolean') {
      updateData['privacySettings.monitoringEnabled'] = monitoringEnabled;
    }
    if (alertPreferences) {
      updateData['privacySettings.alertPreferences'] = alertPreferences;
    }
    if (retentionPeriod) {
      updateData['privacySettings.retentionPeriod'] = retentionPeriod;
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updateData },
      { new: true }
    ).select('-password');

    logger.info('Privacy settings updated', { userId: user._id });

    res.json({
      success: true,
      message: 'Privacy settings updated successfully',
      user
    });

  } catch (error) {
    logger.error('Failed to update privacy settings', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update privacy settings'
    });
  }
});

// Change password
router.put('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Current password and new password are required'
      });
    }

    // Get user with password
    const user = await User.findById(req.user.id);
    
    // Verify current password
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Current password is incorrect'
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    logger.info('Password changed successfully', { userId: user._id });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    logger.error('Failed to change password', error);
    res.status(500).json({
      success: false,
      error: 'Failed to change password'
    });
  }
});

// Logout (client-side token removal)
router.post('/logout', auth, (req, res) => {
  logger.info('User logged out', { userId: req.user.id });
  
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

// Delete account
router.delete('/account', auth, async (req, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        error: 'Password is required to delete account'
      });
    }

    // Get user with password
    const user = await User.findById(req.user.id);
    
    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Password is incorrect'
      });
    }

    // Delete all user data
    await Promise.all([
      User.findByIdAndDelete(req.user.id),
      // Delete related data
      require('../models/Account').deleteMany({ userId: req.user.id })
      // Add more cleanup as needed
    ]);

    logger.info('User account deleted', { userId: req.user.id });

    res.json({
      success: true,
      message: 'Account deleted successfully'
    });

  } catch (error) {
    logger.error('Failed to delete account', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete account'
    });
  }
});

module.exports = router;