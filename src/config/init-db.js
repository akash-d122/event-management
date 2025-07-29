const { testConnection } = require('./database');
const MigrationRunner = require('../migrations/migrationRunner');

// Initialize database using migrations
const initializeDatabase = async () => {
  try {
    console.log('🔄 Initializing database...');

    // Test connection first
    const connected = await testConnection();
    if (!connected) {
      throw new Error('Database connection failed');
    }

    // Run migrations
    const migrationRunner = new MigrationRunner();
    await migrationRunner.runMigrations();

    console.log('✅ Database initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    throw error;
  }
};

module.exports = {
  initializeDatabase
};
