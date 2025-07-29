// Simple console logger for development
const logger = {
  info: (message, ...args) => console.log(`[INFO] ${message}`, ...args),
  error: (message, ...args) => console.error(`[ERROR] ${message}`, ...args),
  warn: (message, ...args) => console.warn(`[WARN] ${message}`, ...args),
  debug: (message, ...args) => console.log(`[DEBUG] ${message}`, ...args),

  // Stream for morgan middleware
  stream: {
    write: (message) => console.log(message.trim())
  }
};

// Define log format with more detailed information
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS'
  }),
  winston.format.errors({ stack: true }),
  winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
  winston.format.json()
);

// Define console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS'
  }),
  winston.format.printf(({ timestamp, level, message, stack, metadata }) => {
    let logMessage = `${timestamp} [${level}]: ${stack || message}`;

    // Add metadata if present
    if (metadata && Object.keys(metadata).length > 0) {
      logMessage += ` | ${JSON.stringify(metadata)}`;
    }

    return logMessage;
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'event-management-api' },
  transports: [
    // Write all logs with level 'error' and below to error.log
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Write all logs with level 'info' and below to combined.log
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
});

// If we're not in production, log to the console as well
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: consoleFormat
  }));
}

// Create a stream object for Morgan HTTP request logging
logger.stream = {
  write: (message) => {
    logger.info(message.trim());
  }
};

// Add structured logging methods
logger.logUserAction = (action, userId, details = {}) => {
  logger.info('User action', {
    action,
    userId,
    ...details,
    timestamp: new Date().toISOString()
  });
};

logger.logDatabaseOperation = (operation, table, details = {}) => {
  logger.info('Database operation', {
    operation,
    table,
    ...details,
    timestamp: new Date().toISOString()
  });
};

logger.logAPIRequest = (method, url, statusCode, responseTime, userId = null) => {
  logger.info('API request', {
    method,
    url,
    statusCode,
    responseTime,
    userId,
    timestamp: new Date().toISOString()
  });
};

logger.logSecurityEvent = (event, details = {}) => {
  logger.warn('Security event', {
    event,
    ...details,
    timestamp: new Date().toISOString()
  });
};

logger.logBusinessLogic = (operation, details = {}) => {
  logger.info('Business logic', {
    operation,
    ...details,
    timestamp: new Date().toISOString()
  });
};

module.exports = logger;
