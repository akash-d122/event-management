const User = require('../models/User');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const { createSendToken } = require('../middleware/auth');
const logger = require('../utils/logger');

// Register a new user
const register = catchAsync(async (req, res, next) => {
  const { username, email, password, first_name, last_name } = req.body;

  // Check if user already exists
  const existingUser = await User.findByEmail(email);
  if (existingUser) {
    return next(new AppError('User with this email already exists', 400));
  }

  const existingUsername = await User.findByUsername(username);
  if (existingUsername) {
    return next(new AppError('Username is already taken', 400));
  }

  // Create new user
  const newUser = await User.create({
    username,
    email,
    password,
    first_name,
    last_name
  });

  logger.logUserAction('register', newUser.id, {
    email: newUser.email,
    username: newUser.username
  });

  // Send token
  createSendToken(newUser, 201, res);
});

// Login user
const login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  // Find user by email
  const user = await User.findByEmail(email);
  if (!user) {
    return next(new AppError('Invalid email or password', 401));
  }

  // Check password
  const isPasswordValid = await user.verifyPassword(password);
  if (!isPasswordValid) {
    return next(new AppError('Invalid email or password', 401));
  }

  logger.logUserAction('login', user.id, {
    email: user.email
  });

  // Send token
  createSendToken(user, 200, res);
});

// Get current user profile
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
    return next(new AppError('This route is not for password updates. Please use /update-password', 400));
  }

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
});

// Update password
const updatePassword = catchAsync(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;

  // Validate current password
  const isCurrentPasswordValid = await req.user.verifyPassword(currentPassword);
  if (!isCurrentPasswordValid) {
    return next(new AppError('Current password is incorrect', 401));
  }

  // Update password
  await req.user.updatePassword(newPassword);

  logger.info(`Password updated for user: ${req.user.email}`);

  // Send new token
  createSendToken(req.user, 200, res);
});

// Get user's events
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
  register,
  login,
  getProfile,
  updateProfile,
  updatePassword,
  getUserEvents,
  getUserRegistrations
};
