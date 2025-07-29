#!/usr/bin/env node

const { databaseManager, MigrationRunner } = require('../config/database');
const path = require('path');
const fs = require('fs');

class MigrationCLI {
  constructor() {
    this.commands = {
      'up': this.runMigrations.bind(this),
      'down': this.rollbackMigration.bind(this),
      'status': this.showStatus.bind(this),
      'create': this.createMigration.bind(this),
      'validate': this.validateMigrations.bind(this),
      'reset': this.resetDatabase.bind(this),
      'help': this.showHelp.bind(this)
    };
  }
  
  async run() {
    const command = process.argv[2] || 'help';
    const args = process.argv.slice(3);
    
    if (!this.commands[command]) {
      console.error(`❌ Unknown command: ${command}`);
      this.showHelp();
      process.exit(1);
    }
    
    try {
      await databaseManager.initialize();
      await this.commands[command](args);
    } catch (error) {
      console.error('❌ Command failed:', error.message);
      if (process.env.NODE_ENV === 'development') {
        console.error(error.stack);
      }
      process.exit(1);
    } finally {
      await databaseManager.close();
    }
  }
  
  async runMigrations(args) {
    const pool = databaseManager.getPool();
    const migrationRunner = new MigrationRunner(pool);
    
    console.log('🔄 Running database migrations...');
    await migrationRunner.runPendingMigrations();
    console.log('✅ Migrations completed successfully');
  }
  
  async rollbackMigration(args) {
    const pool = databaseManager.getPool();
    const migrationRunner = new MigrationRunner(pool);
    
    console.log('⚠️  Rolling back last migration...');
    await migrationRunner.rollbackLastMigration();
    console.log('✅ Rollback completed');
  }
  
  async showStatus(args) {
    const pool = databaseManager.getPool();
    const migrationRunner = new MigrationRunner(pool);
    
    console.log('📊 Migration Status:');
    console.log('==================');
    
    const status = await migrationRunner.getMigrationStatus();
    
    if (status.length === 0) {
      console.log('No migrations found');
      return;
    }
    
    status.forEach(migration => {
      const statusIcon = migration.applied ? '✅' : '⏳';
      const appliedInfo = migration.applied 
        ? ` (applied: ${new Date(migration.appliedAt).toLocaleString()})`
        : '';
      console.log(`${statusIcon} ${migration.filename}${appliedInfo}`);
    });
    
    const appliedCount = status.filter(m => m.applied).length;
    const pendingCount = status.length - appliedCount;
    
    console.log('==================');
    console.log(`Applied: ${appliedCount}, Pending: ${pendingCount}, Total: ${status.length}`);
  }
  
  async createMigration(args) {
    const migrationName = args[0];
    
    if (!migrationName) {
      console.error('❌ Migration name is required');
      console.log('Usage: npm run migrate create <migration_name>');
      return;
    }
    
    // Generate timestamp-based filename
    const timestamp = new Date().toISOString()
      .replace(/[-:]/g, '')
      .replace(/\..+/, '')
      .replace('T', '_');
    
    const filename = `${timestamp}_${migrationName.replace(/\s+/g, '_').toLowerCase()}.sql`;
    const filePath = path.join(__dirname, '../schema', filename);
    
    // Create migration template
    const template = `-- Migration: ${filename}
-- Description: ${migrationName}
-- Created: ${new Date().toISOString().split('T')[0]}

-- Add your migration SQL here
-- Example:
-- CREATE TABLE example (
--     id SERIAL PRIMARY KEY,
--     name VARCHAR(255) NOT NULL,
--     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
-- );

-- Don't forget to add appropriate indexes:
-- CREATE INDEX idx_example_name ON example(name);

-- Add comments for documentation:
-- COMMENT ON TABLE example IS 'Description of the table';
-- COMMENT ON COLUMN example.name IS 'Description of the column';
`;
    
    fs.writeFileSync(filePath, template);
    console.log(`✅ Created migration file: ${filename}`);
    console.log(`📝 Edit the file at: ${filePath}`);
  }
  
  async validateMigrations(args) {
    const pool = databaseManager.getPool();
    const migrationRunner = new MigrationRunner(pool);
    
    console.log('🔍 Validating migrations...');
    
    try {
      const appliedMigrations = await migrationRunner.getAppliedMigrations();
      const migrationFiles = migrationRunner.getMigrationFiles();
      
      // Check for applied migrations that no longer exist
      const missingFiles = appliedMigrations.filter(
        applied => !migrationFiles.includes(applied.filename)
      );
      
      if (missingFiles.length > 0) {
        console.warn('⚠️  Warning: Applied migrations with missing files:');
        missingFiles.forEach(missing => {
          console.warn(`  - ${missing.filename}`);
        });
      }
      
      // Validate checksums for existing applied migrations
      for (const applied of appliedMigrations) {
        if (migrationFiles.includes(applied.filename)) {
          try {
            await migrationRunner.validateMigration(applied.filename, applied.checksum);
            console.log(`✅ ${applied.filename} - checksum valid`);
          } catch (error) {
            console.error(`❌ ${applied.filename} - ${error.message}`);
          }
        }
      }
      
      console.log('✅ Migration validation completed');
      
    } catch (error) {
      console.error('❌ Validation failed:', error.message);
      throw error;
    }
  }
  
  async resetDatabase(args) {
    const confirmFlag = args.find(arg => arg === '--confirm');
    
    if (!confirmFlag) {
      console.error('❌ Database reset requires confirmation');
      console.log('Usage: npm run migrate reset --confirm');
      console.log('⚠️  WARNING: This will drop all tables and data!');
      return;
    }
    
    const pool = databaseManager.getPool();
    
    console.log('⚠️  Resetting database...');
    
    // Drop all tables in reverse dependency order
    const dropSQL = `
      DROP TABLE IF EXISTS registrations CASCADE;
      DROP TABLE IF EXISTS events CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
      DROP TABLE IF EXISTS schema_migrations CASCADE;
      
      -- Drop functions
      DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
      DROP FUNCTION IF EXISTS update_event_registration_count() CASCADE;
      DROP FUNCTION IF EXISTS validate_event_date() CASCADE;
      DROP FUNCTION IF EXISTS validate_event_registration() CASCADE;
      DROP FUNCTION IF EXISTS safe_event_registration(INTEGER, INTEGER) CASCADE;
      DROP FUNCTION IF EXISTS safe_event_unregistration(INTEGER, INTEGER) CASCADE;
      DROP FUNCTION IF EXISTS get_event_registration_stats(INTEGER) CASCADE;
      DROP FUNCTION IF EXISTS batch_event_registration(INTEGER[], INTEGER) CASCADE;
      DROP FUNCTION IF EXISTS update_table_statistics() CASCADE;
      DROP FUNCTION IF EXISTS get_index_usage_stats() CASCADE;
      DROP FUNCTION IF EXISTS get_unused_indexes() CASCADE;
    `;
    
    await pool.query(dropSQL);
    console.log('✅ Database reset completed');
    
    // Run migrations to recreate schema
    console.log('🔄 Running migrations to recreate schema...');
    const migrationRunner = new MigrationRunner(pool);
    await migrationRunner.runPendingMigrations();
    console.log('✅ Schema recreated successfully');
  }
  
  showHelp() {
    console.log(`
📚 Database Migration CLI

Usage: npm run migrate <command> [options]

Commands:
  up        Run all pending migrations
  down      Rollback the last migration
  status    Show migration status
  create    Create a new migration file
  validate  Validate applied migrations
  reset     Reset database (drops all tables) - requires --confirm
  help      Show this help message

Examples:
  npm run migrate up
  npm run migrate status
  npm run migrate create "add_user_preferences_table"
  npm run migrate reset --confirm

Environment Variables:
  DB_HOST              Database host (default: localhost)
  DB_PORT              Database port (default: 5432)
  DB_NAME              Database name (default: event_management)
  DB_USER              Database user (default: postgres)
  DB_PASSWORD          Database password
  DB_POOL_MAX          Maximum pool connections (default: 20)
  DB_POOL_MIN          Minimum pool connections (default: 5)
  DB_SSL               Enable SSL (default: false)
    `);
  }
}

// Run CLI if this file is executed directly
if (require.main === module) {
  const cli = new MigrationCLI();
  cli.run();
}

module.exports = MigrationCLI;
