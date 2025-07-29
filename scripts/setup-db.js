#!/usr/bin/env node

const { testConnection, initializeDatabase, closePool } = require('../src/config/init-db');
const logger = require('../src/utils/logger');

async function setupDatabase() {
  try {
    console.log('🔄 Setting up Event Management Database...\n');

    // Test database connection
    console.log('1. Testing database connection...');
    const connected = await testConnection();
    
    if (!connected) {
      console.error('❌ Failed to connect to database.');
      console.error('Please ensure PostgreSQL is running and the database exists.');
      console.error('You can create the database with: createdb event_management');
      process.exit(1);
    }

    // Initialize database tables
    console.log('2. Initializing database tables...');
    await initializeDatabase();

    console.log('\n✅ Database setup completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Update your .env file with correct database credentials');
    console.log('2. Run "npm run dev" to start the development server');
    console.log('3. Run "npm test" to execute the test suite');

  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    logger.error('Database setup error:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

// Run setup if this script is executed directly
if (require.main === module) {
  setupDatabase();
}

module.exports = { setupDatabase };
