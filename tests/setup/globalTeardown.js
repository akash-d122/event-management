const { Pool } = require('pg');

async function globalTeardown() {
  console.log('🧹 Cleaning up test environment...');
  
  try {
    const testDbConfig = global.__TEST_DB_CONFIG__;
    
    if (!testDbConfig) {
      console.log('No test database config found, skipping cleanup');
      return;
    }
    
    // Admin connection to drop test database
    const adminConfig = {
      ...testDbConfig,
      database: 'postgres'
    };
    
    const adminPool = new Pool(adminConfig);
    
    // Terminate all connections to test database
    console.log('🔌 Terminating database connections...');
    await adminPool.query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()
    `, [testDbConfig.database]);
    
    // Drop test database
    console.log('🗑️  Dropping test database...');
    await adminPool.query(`DROP DATABASE IF EXISTS "${testDbConfig.database}"`);
    
    await adminPool.end();
    
    console.log('✅ Test environment cleanup completed');
    
  } catch (error) {
    console.error('❌ Test cleanup failed:', error);
    // Don't exit with error code as this might prevent test results from being reported
  }
}

module.exports = globalTeardown;
