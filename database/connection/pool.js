const { Pool } = require('pg');
const EventEmitter = require('events');

class DatabasePool extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // Default configuration
    this.config = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || 'event_management',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      
      // Connection pool settings
      max: parseInt(process.env.DB_POOL_MAX) || 20,
      min: parseInt(process.env.DB_POOL_MIN) || 5,
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
      connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 5000,
      acquireTimeoutMillis: parseInt(process.env.DB_ACQUIRE_TIMEOUT) || 60000,
      
      // SSL configuration
      ssl: process.env.DB_SSL === 'true' ? {
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
        ca: process.env.DB_SSL_CA,
        cert: process.env.DB_SSL_CERT,
        key: process.env.DB_SSL_KEY
      } : false,
      
      // Application name for monitoring
      application_name: process.env.DB_APPLICATION_NAME || 'event-management-api',
      
      // Statement timeout
      statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT) || 30000,
      
      // Query timeout
      query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT) || 30000,
      
      ...config
    };
    
    this.pool = null;
    this.isConnected = false;
    this.connectionAttempts = 0;
    this.maxConnectionAttempts = 5;
    this.reconnectDelay = 1000;
    
    // Metrics
    this.metrics = {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      waitingClients: 0,
      totalQueries: 0,
      errorCount: 0,
      averageQueryTime: 0,
      slowQueries: 0
    };
    
    this.initialize();
  }
  
  initialize() {
    this.pool = new Pool(this.config);
    this.setupEventHandlers();
    this.startHealthCheck();
  }
  
  setupEventHandlers() {
    // Connection established
    this.pool.on('connect', (client) => {
      this.isConnected = true;
      this.connectionAttempts = 0;
      this.metrics.totalConnections++;
      
      console.log(`✅ Database connection established (PID: ${client.processID})`);
      this.emit('connect', client);
      
      // Set session parameters
      client.query(`
        SET statement_timeout = ${this.config.statement_timeout};
        SET lock_timeout = 10000;
        SET idle_in_transaction_session_timeout = 60000;
      `).catch(err => {
        console.error('Error setting session parameters:', err);
      });
    });
    
    // Connection error
    this.pool.on('error', (err, client) => {
      this.metrics.errorCount++;
      console.error('❌ Database pool error:', err);
      this.emit('error', err, client);
      
      // Attempt reconnection
      this.handleConnectionError(err);
    });
    
    // Client acquired from pool
    this.pool.on('acquire', (client) => {
      this.metrics.activeConnections++;
      this.emit('acquire', client);
    });
    
    // Client released back to pool
    this.pool.on('release', (err, client) => {
      this.metrics.activeConnections--;
      if (err) {
        console.error('Error releasing client:', err);
      }
      this.emit('release', err, client);
    });
    
    // Client removed from pool
    this.pool.on('remove', (client) => {
      console.log(`Client removed from pool (PID: ${client.processID})`);
      this.emit('remove', client);
    });
  }
  
  async handleConnectionError(err) {
    this.isConnected = false;
    this.connectionAttempts++;
    
    if (this.connectionAttempts >= this.maxConnectionAttempts) {
      console.error(`❌ Max connection attempts (${this.maxConnectionAttempts}) reached`);
      this.emit('maxRetriesReached', err);
      return;
    }
    
    console.log(`🔄 Attempting to reconnect (${this.connectionAttempts}/${this.maxConnectionAttempts})...`);
    
    setTimeout(() => {
      this.testConnection();
    }, this.reconnectDelay * this.connectionAttempts);
  }
  
  async testConnection() {
    try {
      const client = await this.pool.connect();
      const result = await client.query('SELECT NOW() as current_time, version() as version');
      client.release();
      
      console.log('✅ Database connection test successful');
      this.emit('reconnect');
      return result.rows[0];
    } catch (err) {
      console.error('❌ Database connection test failed:', err.message);
      this.handleConnectionError(err);
      throw err;
    }
  }
  
  async query(text, params = []) {
    const startTime = Date.now();
    
    try {
      this.metrics.totalQueries++;
      const result = await this.pool.query(text, params);
      
      const duration = Date.now() - startTime;
      this.updateQueryMetrics(duration);
      
      // Log slow queries
      if (duration > 1000) {
        this.metrics.slowQueries++;
        console.warn(`🐌 Slow query detected (${duration}ms):`, text.substring(0, 100));
      }
      
      return result;
    } catch (err) {
      this.metrics.errorCount++;
      console.error('❌ Query error:', {
        error: err.message,
        query: text.substring(0, 100),
        params: params,
        duration: Date.now() - startTime
      });
      throw err;
    }
  }
  
  async getClient() {
    try {
      const client = await this.pool.connect();
      
      // Wrap client methods to track metrics
      const originalQuery = client.query.bind(client);
      client.query = async (text, params) => {
        const startTime = Date.now();
        try {
          this.metrics.totalQueries++;
          const result = await originalQuery(text, params);
          this.updateQueryMetrics(Date.now() - startTime);
          return result;
        } catch (err) {
          this.metrics.errorCount++;
          throw err;
        }
      };
      
      return client;
    } catch (err) {
      this.metrics.errorCount++;
      throw err;
    }
  }
  
  updateQueryMetrics(duration) {
    // Update average query time using exponential moving average
    this.metrics.averageQueryTime = this.metrics.averageQueryTime === 0 
      ? duration 
      : (this.metrics.averageQueryTime * 0.9) + (duration * 0.1);
  }
  
  getMetrics() {
    return {
      ...this.metrics,
      poolStats: {
        totalCount: this.pool.totalCount,
        idleCount: this.pool.idleCount,
        waitingCount: this.pool.waitingCount
      },
      isConnected: this.isConnected,
      connectionAttempts: this.connectionAttempts
    };
  }
  
  startHealthCheck() {
    // Health check every 30 seconds
    setInterval(async () => {
      try {
        await this.query('SELECT 1');
        this.emit('healthCheck', { status: 'healthy' });
      } catch (err) {
        this.emit('healthCheck', { status: 'unhealthy', error: err.message });
      }
    }, 30000);
  }
  
  async close() {
    if (this.pool) {
      console.log('🔄 Closing database connection pool...');
      await this.pool.end();
      console.log('✅ Database connection pool closed');
      this.emit('close');
    }
  }
  
  // Transaction helper
  async withTransaction(callback) {
    const client = await this.getClient();
    
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  
  // Safe registration using database function
  async safeEventRegistration(userId, eventId) {
    const result = await this.query(
      'SELECT safe_event_registration($1, $2) as result',
      [userId, eventId]
    );
    return result.rows[0].result;
  }
  
  // Safe unregistration using database function
  async safeEventUnregistration(userId, eventId) {
    const result = await this.query(
      'SELECT safe_event_unregistration($1, $2) as result',
      [userId, eventId]
    );
    return result.rows[0].result;
  }
  
  // Get event statistics
  async getEventStats(eventId) {
    const result = await this.query(
      'SELECT get_event_registration_stats($1) as stats',
      [eventId]
    );
    return result.rows[0].stats;
  }
}

module.exports = DatabasePool;
