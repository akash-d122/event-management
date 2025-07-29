const { body, param, query, validationResult } = require('express-validator');
const { ValidationError } = require('./errorHandler');

// Handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(error => ({
      field: error.path,
      message: error.msg,
      value: error.value
    }));
    
    const errorMessage = `Validation failed: ${errorMessages.map(e => `${e.field} - ${e.message}`).join(', ')}`;
    return next(new ValidationError(errorMessage));
  }
  next();
};

// Validation for creating events
const validateCreateEvent = [
  body('title')
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage('Title must be between 1 and 500 characters')
    .matches(/^[a-zA-Z0-9\s\-_.,!?()]+$/)
    .withMessage('Title contains invalid characters'),
  
  body('description')
    .optional()
    .trim()
    .isLength({ max: 10000 })
    .withMessage('Description must be less than 10000 characters'),
  
  body('date_time')
    .isISO8601({ strict: true })
    .withMessage('Date must be a valid ISO 8601 datetime')
    .custom((value) => {
      const eventDate = new Date(value);
      const now = new Date();
      const minFutureTime = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour from now
      
      if (eventDate <= minFutureTime) {
        throw new Error('Event must be scheduled at least 1 hour in the future');
      }
      
      const maxFutureTime = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year from now
      if (eventDate > maxFutureTime) {
        throw new Error('Event cannot be scheduled more than 1 year in the future');
      }
      
      return true;
    }),
  
  body('location')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Location must be less than 500 characters'),
  
  body('capacity')
    .isInt({ min: 1, max: 1000 })
    .withMessage('Capacity must be an integer between 1 and 1000')
    .toInt(),
  
  handleValidationErrors
];

// Validation for event ID parameter
const validateEventId = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('Event ID must be a positive integer')
    .toInt(),
  
  handleValidationErrors
];

// Validation for user ID parameter
const validateUserId = [
  param('userId')
    .isInt({ min: 1 })
    .withMessage('User ID must be a positive integer')
    .toInt(),
  
  handleValidationErrors
];

// Validation for registration request
const validateRegistration = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('Event ID must be a positive integer')
    .toInt(),
  
  body('user_id')
    .optional()
    .isInt({ min: 1 })
    .withMessage('User ID must be a positive integer')
    .toInt(),
  
  handleValidationErrors
];

// Validation for upcoming events query
const validateUpcomingEventsQuery = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer')
    .toInt(),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100')
    .toInt(),
  
  query('sort_by')
    .optional()
    .isIn(['date_time', 'title', 'capacity', 'current_registrations', 'created_at'])
    .withMessage('Invalid sort field. Allowed: date_time, title, capacity, current_registrations, created_at'),
  
  query('sort_order')
    .optional()
    .isIn(['ASC', 'DESC', 'asc', 'desc'])
    .withMessage('Sort order must be ASC or DESC')
    .customSanitizer(value => value ? value.toUpperCase() : 'ASC'),
  
  query('search')
    .optional()
    .trim()
    .isLength({ max: 255 })
    .withMessage('Search term must be less than 255 characters')
    .escape(), // Escape HTML entities for security
  
  query('location')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Location filter must be less than 500 characters')
    .escape(),
  
  query('min_capacity')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Minimum capacity must be a positive integer')
    .toInt(),
  
  query('max_capacity')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Maximum capacity must be a positive integer')
    .toInt(),
  
  query('date_from')
    .optional()
    .isISO8601()
    .withMessage('Date from must be a valid ISO 8601 date'),
  
  query('date_to')
    .optional()
    .isISO8601()
    .withMessage('Date to must be a valid ISO 8601 date'),
  
  // Custom validation for date range
  query('date_to')
    .optional()
    .custom((value, { req }) => {
      if (value && req.query.date_from) {
        const dateFrom = new Date(req.query.date_from);
        const dateTo = new Date(value);
        
        if (dateTo <= dateFrom) {
          throw new Error('Date to must be after date from');
        }
      }
      return true;
    }),
  
  // Custom validation for capacity range
  query('max_capacity')
    .optional()
    .custom((value, { req }) => {
      if (value && req.query.min_capacity) {
        if (parseInt(value) < parseInt(req.query.min_capacity)) {
          throw new Error('Maximum capacity must be greater than minimum capacity');
        }
      }
      return true;
    }),
  
  handleValidationErrors
];

// Validation for updating events
const validateUpdateEvent = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('Event ID must be a positive integer')
    .toInt(),
  
  body('title')
    .optional()
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage('Title must be between 1 and 500 characters')
    .matches(/^[a-zA-Z0-9\s\-_.,!?()]+$/)
    .withMessage('Title contains invalid characters'),
  
  body('description')
    .optional()
    .trim()
    .isLength({ max: 10000 })
    .withMessage('Description must be less than 10000 characters'),
  
  body('date_time')
    .optional()
    .isISO8601({ strict: true })
    .withMessage('Date must be a valid ISO 8601 datetime')
    .custom((value) => {
      const eventDate = new Date(value);
      const now = new Date();
      const minFutureTime = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour from now
      
      if (eventDate <= minFutureTime) {
        throw new Error('Event must be scheduled at least 1 hour in the future');
      }
      
      return true;
    }),
  
  body('location')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Location must be less than 500 characters'),
  
  body('capacity')
    .optional()
    .isInt({ min: 1, max: 1000 })
    .withMessage('Capacity must be an integer between 1 and 1000')
    .toInt(),
  
  handleValidationErrors
];

// Validation for batch operations
const validateBatchRegistration = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('Event ID must be a positive integer')
    .toInt(),
  
  body('user_ids')
    .isArray({ min: 1, max: 100 })
    .withMessage('User IDs must be an array with 1-100 elements'),
  
  body('user_ids.*')
    .isInt({ min: 1 })
    .withMessage('Each user ID must be a positive integer')
    .toInt(),
  
  handleValidationErrors
];

module.exports = {
  validateCreateEvent,
  validateEventId,
  validateUserId,
  validateRegistration,
  validateUpcomingEventsQuery,
  validateUpdateEvent,
  validateBatchRegistration,
  handleValidationErrors
};
