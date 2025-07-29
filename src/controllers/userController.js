const User = require('../models/User');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

// Get user profile (same as auth controller, but kept for consistency)
const getProfile = catchAsync(async (req, res, next) => {
  res.status(200).json({
    status: 'success',
    data: {
      user: req.user
    }
  });
});

// Update user profile
const updateProfile = catchAsync(async (req, res, next) => {
  const { username, email, first_name, last_name } = req.body;

  // Don't allow password updates through this endpoint
  if (req.body.password) {
    return next(new AppError('This route is not for password updates. Please use /auth/update-password', 400));
  }

  try {
    const updatedUser = await req.user.update({
      username,
      email,
      first_name,
      last_name
    });

    logger.info(`User profile updated: ${updatedUser.email}`);

    res.status(200).json({
      status: 'success',
      data: {
        user: updatedUser
      }
    });
  } catch (error) {
    if (error.message === 'Email already exists' || error.message === 'Username already exists') {
      return next(new AppError(error.message, 400));
    }
    throw error;
  }
});

// Delete user account
const deleteAccount = catchAsync(async (req, res, next) => {
  await req.user.delete();

  logger.info(`User account deleted: ${req.user.email}`);

  res.status(204).json({
    status: 'success',
    data: null
  });
});

// Get user's created events
const getUserEvents = catchAsync(async (req, res, next) => {
  const events = await req.user.getEvents();

  res.status(200).json({
    status: 'success',
    results: events.length,
    data: {
      events
    }
  });
});

// Get user's event registrations
const getUserRegistrations = catchAsync(async (req, res, next) => {
  const registrations = await req.user.getRegistrations();

  res.status(200).json({
    status: 'success',
    results: registrations.length,
    data: {
      registrations
    }
  });
});

module.exports = {
  getProfile,
  updateProfile,
  deleteAccount,
  getUserEvents,
  getUserRegistrations
};
