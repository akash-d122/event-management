const { query, closePool } = require('../src/config/database');

// Test database setup
const setupTestDatabase = async () => {
  try {
    // Clean up existing test data
    await query('TRUNCATE TABLE event_registrations, events, users RESTART IDENTITY CASCADE');
    console.log('✅ Test database cleaned');
  } catch (error) {
    console.error('❌ Error setting up test database:', error);
    throw error;
  }
};

// Clean up test database
const cleanupTestDatabase = async () => {
  try {
    await query('TRUNCATE TABLE event_registrations, events, users RESTART IDENTITY CASCADE');
    console.log('✅ Test database cleaned up');
  } catch (error) {
    console.error('❌ Error cleaning up test database:', error);
  }
};

// Global setup for all tests
beforeAll(async () => {
  await setupTestDatabase();
});

// Global cleanup after all tests
afterAll(async () => {
  await cleanupTestDatabase();
  await closePool();
});

// Clean up after each test
afterEach(async () => {
  await cleanupTestDatabase();
});

module.exports = {
  setupTestDatabase,
  cleanupTestDatabase
};
