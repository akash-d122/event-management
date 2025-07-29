const fs = require('fs');
const path = require('path');
const { query } = require('../config/database');
const logger = require('../utils/logger');

class MigrationRunner {
  constructor() {
    this.migrationsDir = __dirname;
  }

  // Create migrations table to track applied migrations
  async createMigrationsTable() {
    const sql = `
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    
    await query(sql);
    logger.info('Migrations table created or already exists');
  }

  // Get list of applied migrations
  async getAppliedMigrations() {
    try {
      const result = await query('SELECT filename FROM migrations ORDER BY filename');
      return result.rows.map(row => row.filename);
    } catch (error) {
      // If migrations table doesn't exist, return empty array
      if (error.code === '42P01') {
        return [];
      }
      throw error;
    }
  }

  // Get list of migration files
  getMigrationFiles() {
    const files = fs.readdirSync(this.migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();
    
    return files;
  }

  // Read migration file content
  readMigrationFile(filename) {
    const filePath = path.join(this.migrationsDir, filename);
    return fs.readFileSync(filePath, 'utf8');
  }

  // Apply a single migration
  async applyMigration(filename) {
    const sql = this.readMigrationFile(filename);
    
    try {
      // Execute migration SQL
      await query(sql);
      
      // Record migration as applied
      await query(
        'INSERT INTO migrations (filename) VALUES ($1)',
        [filename]
      );
      
      logger.info(`✅ Applied migration: ${filename}`);
      return true;
    } catch (error) {
      logger.error(`❌ Failed to apply migration ${filename}:`, error);
      throw error;
    }
  }

  // Run all pending migrations
  async runMigrations() {
    try {
      logger.info('🔄 Starting database migrations...');
      
      // Ensure migrations table exists
      await this.createMigrationsTable();
      
      // Get applied and available migrations
      const appliedMigrations = await this.getAppliedMigrations();
      const migrationFiles = this.getMigrationFiles();
      
      // Find pending migrations
      const pendingMigrations = migrationFiles.filter(
        file => !appliedMigrations.includes(file)
      );
      
      if (pendingMigrations.length === 0) {
        logger.info('✅ No pending migrations found');
        return;
      }
      
      logger.info(`Found ${pendingMigrations.length} pending migration(s)`);
      
      // Apply each pending migration
      for (const migration of pendingMigrations) {
        await this.applyMigration(migration);
      }
      
      logger.info(`✅ Successfully applied ${pendingMigrations.length} migration(s)`);
      
    } catch (error) {
      logger.error('❌ Migration failed:', error);
      throw error;
    }
  }

  // Rollback last migration (basic implementation)
  async rollbackLastMigration() {
    try {
      const result = await query(
        'SELECT filename FROM migrations ORDER BY applied_at DESC LIMIT 1'
      );
      
      if (result.rows.length === 0) {
        logger.info('No migrations to rollback');
        return;
      }
      
      const lastMigration = result.rows[0].filename;
      
      // Remove from migrations table
      await query('DELETE FROM migrations WHERE filename = $1', [lastMigration]);
      
      logger.info(`⚠️  Rolled back migration: ${lastMigration}`);
      logger.warn('Note: This only removes the migration record. Manual schema changes may be required.');
      
    } catch (error) {
      logger.error('❌ Rollback failed:', error);
      throw error;
    }
  }

  // Get migration status
  async getMigrationStatus() {
    try {
      await this.createMigrationsTable();
      
      const appliedMigrations = await this.getAppliedMigrations();
      const migrationFiles = this.getMigrationFiles();
      
      const status = migrationFiles.map(file => ({
        filename: file,
        applied: appliedMigrations.includes(file)
      }));
      
      return status;
    } catch (error) {
      logger.error('❌ Failed to get migration status:', error);
      throw error;
    }
  }
}

module.exports = MigrationRunner;
