const DatabasePool = require('../connection/pool');
const path = require('path');
const fs = require('fs');

class DatabaseManager {
  constructor() {
    this.pool = null;
    this.isInitialized = false;
  }
  
  async initialize() {
    if (this.isInitialized) {
      return this.pool;
    }
    
    try {
      // Create database pool
      this.pool = new DatabasePool();
      
      // Set up event listeners
      this.setupEventListeners();
      
      // Test connection
      await this.pool.testConnection();
      
      // Run migrations if needed
      await this.runMigrations();
      
      this.isInitialized = true;
      console.log('✅ Database manager initialized successfully');
      
      return this.pool;
    } catch (error) {
      console.error('❌ Failed to initialize database manager:', error);
      throw error;
    }
  }
  
  setupEventListeners() {
    this.pool.on('error', (err) => {
      console.error('Database pool error:', err);
    });
    
    this.pool.on('connect', () => {
      console.log('New database connection established');
    });
    
    this.pool.on('healthCheck', (status) => {
      if (status.status === 'unhealthy') {
        console.warn('Database health check failed:', status.error);
      }
    });
    
    this.pool.on('maxRetriesReached', (err) => {
      console.error('Database connection max retries reached. Manual intervention required.');
      // Here you could implement alerting, graceful shutdown, etc.
    });
  }
  
  async runMigrations() {
    const migrationRunner = new MigrationRunner(this.pool);
    await migrationRunner.runPendingMigrations();
  }
  
  getPool() {
    if (!this.isInitialized) {
      throw new Error('Database manager not initialized. Call initialize() first.');
    }
    return this.pool;
  }
  
  async close() {
    if (this.pool) {
      await this.pool.close();
      this.isInitialized = false;
    }
  }
}

class MigrationRunner {
  constructor(pool) {
    this.pool = pool;
    this.migrationsDir = path.join(__dirname, '../schema');
  }
  
  async createMigrationsTable() {
    const sql = `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        checksum VARCHAR(64) NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        execution_time_ms INTEGER
      );
      
      CREATE INDEX IF NOT EXISTS idx_schema_migrations_filename ON schema_migrations(filename);
    `;
    
    await this.pool.query(sql);
  }
  
  async getAppliedMigrations() {
    try {
      const result = await this.pool.query(
        'SELECT filename, checksum FROM schema_migrations ORDER BY filename'
      );
      return result.rows;
    } catch (error) {
      if (error.code === '42P01') { // Table doesn't exist
        return [];
      }
      throw error;
    }
  }
  
  getMigrationFiles() {
    if (!fs.existsSync(this.migrationsDir)) {
      console.warn(`Migrations directory not found: ${this.migrationsDir}`);
      return [];
    }
    
    return fs.readdirSync(this.migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();
  }
  
  calculateChecksum(content) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(content).digest('hex');
  }
  
  readMigrationFile(filename) {
    const filePath = path.join(this.migrationsDir, filename);
    return fs.readFileSync(filePath, 'utf8');
  }
  
  async applyMigration(filename) {
    const content = this.readMigrationFile(filename);
    const checksum = this.calculateChecksum(content);
    const startTime = Date.now();
    
    try {
      // Execute migration in a transaction
      await this.pool.withTransaction(async (client) => {
        // Execute the migration SQL
        await client.query(content);
        
        // Record the migration
        await client.query(
          `INSERT INTO schema_migrations (filename, checksum, execution_time_ms) 
           VALUES ($1, $2, $3)`,
          [filename, checksum, Date.now() - startTime]
        );
      });
      
      console.log(`✅ Applied migration: ${filename} (${Date.now() - startTime}ms)`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to apply migration ${filename}:`, error.message);
      throw error;
    }
  }
  
  async validateMigration(filename, appliedChecksum) {
    const content = this.readMigrationFile(filename);
    const currentChecksum = this.calculateChecksum(content);
    
    if (currentChecksum !== appliedChecksum) {
      throw new Error(
        `Migration ${filename} has been modified after being applied. ` +
        `Expected checksum: ${appliedChecksum}, Current checksum: ${currentChecksum}`
      );
    }
  }
  
  async runPendingMigrations() {
    try {
      console.log('🔄 Checking for database migrations...');
      
      // Ensure migrations table exists
      await this.createMigrationsTable();
      
      // Get applied and available migrations
      const appliedMigrations = await this.getAppliedMigrations();
      const migrationFiles = this.getMigrationFiles();
      
      // Validate applied migrations haven't been modified
      for (const applied of appliedMigrations) {
        if (migrationFiles.includes(applied.filename)) {
          await this.validateMigration(applied.filename, applied.checksum);
        }
      }
      
      // Find pending migrations
      const appliedFilenames = appliedMigrations.map(m => m.filename);
      const pendingMigrations = migrationFiles.filter(
        file => !appliedFilenames.includes(file)
      );
      
      if (pendingMigrations.length === 0) {
        console.log('✅ No pending migrations found');
        return;
      }
      
      console.log(`📋 Found ${pendingMigrations.length} pending migration(s):`);
      pendingMigrations.forEach(migration => {
        console.log(`  - ${migration}`);
      });
      
      // Apply each pending migration
      for (const migration of pendingMigrations) {
        await this.applyMigration(migration);
      }
      
      console.log(`✅ Successfully applied ${pendingMigrations.length} migration(s)`);
      
    } catch (error) {
      console.error('❌ Migration failed:', error.message);
      throw error;
    }
  }
  
  async getMigrationStatus() {
    await this.createMigrationsTable();
    
    const appliedMigrations = await this.getAppliedMigrations();
    const migrationFiles = this.getMigrationFiles();
    
    const appliedFilenames = appliedMigrations.map(m => m.filename);
    
    return migrationFiles.map(file => ({
      filename: file,
      applied: appliedFilenames.includes(file),
      appliedAt: appliedMigrations.find(m => m.filename === file)?.applied_at || null
    }));
  }
  
  async rollbackLastMigration() {
    const result = await this.pool.query(
      'SELECT filename FROM schema_migrations ORDER BY applied_at DESC LIMIT 1'
    );
    
    if (result.rows.length === 0) {
      console.log('No migrations to rollback');
      return;
    }
    
    const lastMigration = result.rows[0].filename;
    
    // Remove from migrations table
    await this.pool.query(
      'DELETE FROM schema_migrations WHERE filename = $1',
      [lastMigration]
    );
    
    console.log(`⚠️  Rolled back migration: ${lastMigration}`);
    console.warn('Note: This only removes the migration record. Manual schema changes may be required.');
  }
}

// Singleton instance
const databaseManager = new DatabaseManager();

module.exports = {
  DatabaseManager,
  MigrationRunner,
  databaseManager
};
