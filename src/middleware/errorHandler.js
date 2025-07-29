const logger = require('../utils/logger');

// Base custom error class
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Specific error classes for different scenarios
class ValidationError extends AppError {
  constructor(message) {
    super(message, 400);
    this.name = 'ValidationError';
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404);
    this.name = 'NotFoundError';
  }
}

class ConflictError extends AppError {
  constructor(message) {
    super(message, 409);
    this.name = 'ConflictError';
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized access') {
    super(message, 401);
    this.name = 'UnauthorizedError';
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Forbidden access') {
    super(message, 403);
    this.name = 'ForbiddenError';
  }
}

class BusinessLogicError extends AppError {
  constructor(message) {
    super(message, 400);
    this.name = 'BusinessLogicError';
  }
}

// Handle PostgreSQL errors
const handlePostgresError = (err) => {
  const { code, constraint, detail } = err;

  switch (code) {
    case '23505': // Unique violation
      if (constraint === 'users_email_key') {
        return new ConflictError('Email address is already registered');
      }
      if (constraint === 'users_username_key') {
        return new ConflictError('Username is already taken');
      }
      if (constraint === 'event_registrations_user_id_event_id_key') {
        return new ConflictError('User is already registered for this event');
      }
      return new ConflictError('Duplicate entry detected');

    case '23503': // Foreign key violation
      return new ValidationError('Referenced record does not exist');

    case '23514': // Check constraint violation
      if (constraint === 'valid_capacity') {
        return new ValidationError('Event capacity must be a positive number');
      }
      if (constraint === 'valid_registrations') {
        return new ValidationError('Registration count cannot exceed capacity');
      }
      if (constraint === 'valid_dates') {
        return new ValidationError('End date must be after start date');
      }
      return new ValidationError('Data violates business rules');

    case '22001': // String data too long
      return new ValidationError('Input data exceeds maximum length');

    case '22P02': // Invalid text representation
      return new ValidationError('Invalid data format');

    default:
      logger.error('Unhandled PostgreSQL error:', { code, constraint, detail });
      return new AppError('Database operation failed', 500);
  }
};

// Handle cast errors (invalid data types)
const handleCastError = (err) => {
  const message = `Invalid ${err.path}: ${err.value}`;
  return new ValidationError(message);
};

// Handle validation errors
const handleValidationError = (err) => {
  const errors = Object.values(err.errors).map(el => el.message);
  const message = `Invalid input data. ${errors.join('. ')}`;
  return new ValidationError(message);
};

// Handle JWT errors
const handleJWTError = () =>
  new AppError('Invalid token. Please log in again!', 401);

const handleJWTExpiredError = () =>
  new AppError('Your token has expired! Please log in again.', 401);

// Send error in development
const sendErrorDev = (err, res) => {
  res.status(err.statusCode).json({
    status: err.status,
    error: err,
    message: err.message,
    stack: err.stack
  });
};

// Send error in production
const sendErrorProd = (err, res) => {
  // Operational, trusted error: send message to client
  if (err.isOperational) {
    res.status(err.statusCode).json({
      status: err.status,
      message: err.message
    });
  } else {
    // Programming or other unknown error: don't leak error details
    logger.error('ERROR 💥', err);

    res.status(500).json({
      status: 'error',
      message: 'Something went wrong!'
    });
  }
};

// Global error handling middleware
const globalErrorHandler = (err, req, res, next) => {
  // Log all errors with context
  logger.error('Error occurred:', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });

  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(err, res);
  } else {
    let error = { ...err };
    error.message = err.message;

    // Handle specific error types
    if (error.code && error.code.startsWith('23')) error = handlePostgresError(error); // PostgreSQL errors
    if (error.name === 'CastError') error = handleCastError(error);
    if (error.name === 'ValidationError') error = handleValidationError(error);
    if (error.name === 'JsonWebTokenError') error = handleJWTError();
    if (error.name === 'TokenExpiredError') error = handleJWTExpiredError();

    sendErrorProd(error, res);
  }
};

// Catch async errors
const catchAsync = (fn) => {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
};

// Handle 404 errors
const notFound = (req, res, next) => {
  const err = new AppError(`Can't find ${req.originalUrl} on this server!`, 404);
  next(err);
};

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  BusinessLogicError,
  globalErrorHandler,
  catchAsync,
  notFound
};
