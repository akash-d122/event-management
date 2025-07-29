const { Pool } = require('pg');

// Extend Jest matchers
expect.extend({
  toBeValidDate(received) {
    const pass = received instanceof Date && !isNaN(received);
    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid date`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid date`,
        pass: false,
      };
    }
  },
  
  toBeWithinRange(received, floor, ceiling) {
    const pass = received >= floor && received <= ceiling;
    if (pass) {
      return {
        message: () => `expected ${received} not to be within range ${floor} - ${ceiling}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be within range ${floor} - ${ceiling}`,
        pass: false,
      };
    }
  },
  
  toHaveValidPagination(received) {
    const requiredFields = ['current_page', 'total_pages', 'total_items', 'items_per_page', 'has_next_page', 'has_prev_page'];
    const hasAllFields = requiredFields.every(field => received.hasOwnProperty(field));
    
    if (hasAllFields) {
      return {
        message: () => `expected pagination object not to have all required fields`,
        pass: true,
      };
    } else {
      const missingFields = requiredFields.filter(field => !received.hasOwnProperty(field));
      return {
        message: () => `expected pagination object to have fields: ${missingFields.join(', ')}`,
        pass: false,
      };
    }
  }
});

// Global test configuration
global.testConfig = {
  timeout: 30000,
  retries: 2
};

// Console override for cleaner test output
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

console.error = (...args) => {
  // Filter out expected error messages during tests
  const message = args.join(' ');
  if (
    message.includes('Warning: Could not drop test database') ||
    message.includes('Migration failed') ||
    message.includes('Database setup incomplete')
  ) {
    return;
  }
  originalConsoleError.apply(console, args);
};

console.warn = (...args) => {
  // Filter out expected warnings during tests
  const message = args.join(' ');
  if (message.includes('Warning:')) {
    return;
  }
  originalConsoleWarn.apply(console, args);
};

// Restore console methods after tests
afterAll(() => {
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
});

// Global error handler for unhandled promises
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Reduce log noise during tests

// Increase timeout for database operations
jest.setTimeout(30000);
