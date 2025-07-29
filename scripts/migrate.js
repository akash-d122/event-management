#!/usr/bin/env node

const MigrationRunner = require('../src/migrations/migrationRunner');
const { closePool } = require('../src/config/database');
const logger = require('../src/utils/logger');

const command = process.argv[2];

async function runCommand() {
  const migrationRunner = new MigrationRunner();

  try {
    switch (command) {
      case 'up':
        console.log('🔄 Running migrations...');
        await migrationRunner.runMigrations();
        break;

      case 'status':
        console.log('📊 Migration status:');
        const status = await migrationRunner.getMigrationStatus();
        status.forEach(migration => {
          const statusIcon = migration.applied ? '✅' : '⏳';
          console.log(`${statusIcon} ${migration.filename}`);
        });
        break;

      case 'rollback':
        console.log('⚠️  Rolling back last migration...');
        await migrationRunner.rollbackLastMigration();
        break;

      default:
        console.log('Usage: npm run migrate [up|status|rollback]');
        console.log('');
        console.log('Commands:');
        console.log('  up       - Run all pending migrations');
        console.log('  status   - Show migration status');
        console.log('  rollback - Rollback last migration');
        break;
    }
  } catch (error) {
    logger.error('Migration command failed:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

runCommand();
