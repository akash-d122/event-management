const { Pool } = require('pg');
const { execSync } = require('child_process');
const path = require('path');

// Test database configuration
const TEST_DB_CONFIG = {
  host: process.env.TEST_DB_HOST || 'localhost',
  port: parseInt(process.env.TEST_DB_PORT) || 5432,
  user: process.env.TEST_DB_USER || 'postgres',
  password: process.env.TEST_DB_PASSWORD || 'password',
  database: process.env.TEST_DB_NAME || 'event_management_test'
};

// Admin connection (without database specified)
const ADMIN_CONFIG = {
  ...TEST_DB_CONFIG,
  database: 'postgres'
};

async function globalSetup() {
  console.log('🔧 Setting up test environment...');
  
  try {
    // Create admin connection
    const adminPool = new Pool(ADMIN_CONFIG);
    
    // Drop test database if it exists
    console.log('🗑️  Dropping existing test database...');
    try {
      await adminPool.query(`DROP DATABASE IF EXISTS "${TEST_DB_CONFIG.database}"`);
    } catch (error) {
      console.warn('Warning: Could not drop test database:', error.message);
    }
    
    // Create test database
    console.log('🏗️  Creating test database...');
    await adminPool.query(`CREATE DATABASE "${TEST_DB_CONFIG.database}"`);
    
    await adminPool.end();
    
    // Connect to test database
    const testPool = new Pool(TEST_DB_CONFIG);
    
    // Run migrations on test database
    console.log('🔄 Running migrations on test database...');
    
    // Set environment variables for migration
    process.env.DB_HOST = TEST_DB_CONFIG.host;
    process.env.DB_PORT = TEST_DB_CONFIG.port;
    process.env.DB_NAME = TEST_DB_CONFIG.database;
    process.env.DB_USER = TEST_DB_CONFIG.user;
    process.env.DB_PASSWORD = TEST_DB_CONFIG.password;
    process.env.NODE_ENV = 'test';
    
    // Run migrations using the CLI
    try {
      execSync('npm run migrate:up', {
        stdio: 'inherit',
        cwd: path.resolve(__dirname, '../..')
      });
    } catch (error) {
      console.error('Migration failed:', error.message);
      throw error;
    }
    
    // Verify database setup
    console.log('✅ Verifying database setup...');
    const tableCheck = await testPool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('users', 'events', 'registrations')
      ORDER BY table_name
    `);
    
    const expectedTables = ['events', 'registrations', 'users'];
    const actualTables = tableCheck.rows.map(row => row.table_name).sort();
    
    if (JSON.stringify(actualTables) !== JSON.stringify(expectedTables)) {
      throw new Error(`Database setup incomplete. Expected: ${expectedTables.join(', ')}, Got: ${actualTables.join(', ')}`);
    }
    
    await testPool.end();
    
    console.log('✅ Test database setup completed successfully');
    
    // Store config for tests
    global.__TEST_DB_CONFIG__ = TEST_DB_CONFIG;
    
  } catch (error) {
    console.error('❌ Test database setup failed:', error);
    process.exit(1);
  }
}

module.exports = globalSetup;
