# Event Management Database Schema

This directory contains the complete PostgreSQL database schema for the Event Management API, designed with performance, data integrity, and race condition prevention in mind.

## 📁 Directory Structure

```
database/
├── schema/                 # Migration files
│   ├── 001_create_users_table.sql
│   ├── 002_create_events_table.sql
│   ├── 003_create_registrations_table.sql
│   ├── 004_race_condition_prevention.sql
│   ├── 005_performance_indexes.sql
│   └── 006_advanced_validation.sql
├── connection/            # Database connection management
│   └── pool.js           # Connection pooling with monitoring
├── config/               # Database configuration
│   └── database.js       # Database manager and migration runner
├── cli/                  # Command line tools
│   └── migrate.js        # Migration CLI
└── README.md            # This file
```

## 🗄️ Database Schema

### Tables

#### 1. Users Table
```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(320) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

**Features:**
- Email validation with regex constraints
- Bcrypt password hash validation
- Automatic timestamp management
- Soft delete capability with `is_active`

#### 2. Events Table
```sql
CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    date_time TIMESTAMP WITH TIME ZONE NOT NULL,
    location VARCHAR(500),
    capacity INTEGER NOT NULL CHECK (capacity > 0 AND capacity <= 10000),
    current_registrations INTEGER DEFAULT 0,
    created_by INTEGER NOT NULL REFERENCES users(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

**Features:**
- Capacity limits (1-10,000 attendees)
- Future date validation
- Automatic registration count tracking
- Full-text search capabilities

#### 3. Registrations Table (Junction)
```sql
CREATE TABLE registrations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    event_id INTEGER NOT NULL REFERENCES events(id),
    registered_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'confirmed',
    UNIQUE(user_id, event_id)
);
```

**Features:**
- Many-to-many relationship between users and events
- Prevents duplicate registrations
- Status tracking (confirmed, cancelled, waitlist, pending)
- Automatic registration count updates

## 🔒 Race Condition Prevention

### Advisory Locks
- Uses PostgreSQL advisory locks for event registration
- Prevents concurrent registration conflicts
- Ensures data consistency under high load

### Safe Registration Functions
```sql
-- Safe registration with proper locking
SELECT safe_event_registration(user_id, event_id);

-- Safe unregistration
SELECT safe_event_unregistration(user_id, event_id);

-- Get event statistics
SELECT get_event_registration_stats(event_id);
```

### Transaction Management
- All critical operations wrapped in transactions
- Automatic rollback on errors
- Row-level locking for concurrent updates

## 📈 Performance Optimizations

### Strategic Indexes
- **Primary indexes**: All foreign keys and frequently queried columns
- **Composite indexes**: Common query patterns (active events, user registrations)
- **Partial indexes**: Filtered indexes for specific use cases
- **Full-text search**: GIN indexes for text search across title, description, location
- **Covering indexes**: Include frequently accessed columns

### Query Optimization
- Materialized registration counts
- Efficient date range queries
- Optimized search functionality
- Index usage monitoring functions

## ✅ Data Validation

### Database-Level Constraints
- **Email validation**: Regex pattern matching
- **Capacity limits**: 1-10,000 attendees
- **Date validation**: Events must be in the future
- **Registration limits**: Cannot exceed event capacity
- **Status validation**: Enum-like constraints

### Triggers and Functions
- **Automatic timestamps**: `updated_at` maintenance
- **Registration counting**: Real-time count updates
- **Business rule validation**: Cross-table consistency checks
- **Audit logging**: Complete change tracking

### Domain Types
```sql
CREATE DOMAIN email_address AS VARCHAR(320) 
    CHECK (VALUE ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

CREATE DOMAIN event_capacity AS INTEGER 
    CHECK (VALUE > 0 AND VALUE <= 10000);
```

## 🔧 Migration System

### Features
- **Version control**: Checksums prevent unauthorized changes
- **Rollback capability**: Safe migration rollbacks
- **Validation**: Ensures migration integrity
- **Atomic operations**: All-or-nothing migration execution

### CLI Commands
```bash
# Run pending migrations
npm run migrate up

# Check migration status
npm run migrate status

# Create new migration
npm run migrate create "add_new_feature"

# Rollback last migration
npm run migrate down

# Validate migrations
npm run migrate validate

# Reset database (development only)
npm run migrate reset --confirm
```

## 🔌 Connection Pooling

### Features
- **Intelligent pooling**: Min/max connection limits
- **Health monitoring**: Automatic connection health checks
- **Metrics tracking**: Query performance and connection stats
- **Error recovery**: Automatic reconnection with backoff
- **Transaction helpers**: Simplified transaction management

### Configuration
```javascript
const pool = new DatabasePool({
    max: 20,                    // Maximum connections
    min: 5,                     // Minimum connections
    idleTimeoutMillis: 30000,   // Idle timeout
    connectionTimeoutMillis: 5000, // Connection timeout
    acquireTimeoutMillis: 60000    // Acquire timeout
});
```

## 📊 Monitoring and Maintenance

### Built-in Functions
```sql
-- Update table statistics
SELECT update_table_statistics();

-- Get index usage stats
SELECT * FROM get_index_usage_stats();

-- Find unused indexes
SELECT * FROM get_unused_indexes();

-- Validate business rules
SELECT * FROM validate_business_rules();

-- Clean up old audit logs
SELECT cleanup_audit_logs(90); -- Keep 90 days
```

### Metrics Available
- Connection pool statistics
- Query performance metrics
- Index usage statistics
- Business rule violations
- Audit log summaries

## 🚀 Getting Started

### 1. Environment Setup
```bash
# Copy environment template
cp .env.example .env

# Edit database configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=event_management
DB_USER=postgres
DB_PASSWORD=your_password
```

### 2. Database Initialization
```bash
# Create database
createdb event_management

# Run migrations
npm run migrate up

# Verify setup
npm run migrate status
```

### 3. Connection Testing
```javascript
const { databaseManager } = require('./database/config/database');

async function test() {
    await databaseManager.initialize();
    const pool = databaseManager.getPool();
    
    // Test query
    const result = await pool.query('SELECT NOW()');
    console.log('Database connected:', result.rows[0]);
    
    await databaseManager.close();
}
```

## 🔍 Troubleshooting

### Common Issues

1. **Connection Timeouts**
   - Check network connectivity
   - Verify database is running
   - Review connection pool settings

2. **Migration Failures**
   - Check database permissions
   - Verify migration file syntax
   - Review constraint violations

3. **Performance Issues**
   - Analyze query execution plans
   - Check index usage statistics
   - Monitor connection pool metrics

### Debug Commands
```bash
# Check database connectivity
psql -h localhost -U postgres -d event_management -c "SELECT version();"

# Monitor active connections
psql -c "SELECT * FROM pg_stat_activity WHERE datname = 'event_management';"

# Check table sizes
psql -c "SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size FROM pg_tables WHERE schemaname = 'public';"
```

## 📝 Best Practices

1. **Always use migrations** for schema changes
2. **Test migrations** in development first
3. **Monitor performance** regularly
4. **Keep statistics updated** for optimal query planning
5. **Use transactions** for multi-step operations
6. **Validate data** at both application and database levels
7. **Monitor connection pools** for optimal sizing
8. **Regular maintenance** of indexes and statistics

## 🔐 Security Considerations

- All user inputs validated at database level
- SQL injection prevention through parameterized queries
- Audit logging for compliance requirements
- Connection encryption support
- Role-based access control ready
- Sensitive data handling (password hashing)
