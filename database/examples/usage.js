const { databaseManager } = require('../config/database');

/**
 * Example usage of the Event Management Database
 * Demonstrates connection pooling, transactions, and race condition prevention
 */

class EventManagementExample {
  constructor() {
    this.pool = null;
  }
  
  async initialize() {
    await databaseManager.initialize();
    this.pool = databaseManager.getPool();
    console.log('✅ Database initialized');
  }
  
  async cleanup() {
    await databaseManager.close();
    console.log('✅ Database connections closed');
  }
  
  // Example 1: Basic CRUD operations
  async basicCrudExample() {
    console.log('\n📝 Basic CRUD Operations Example');
    
    try {
      // Create a user
      const userResult = await this.pool.query(`
        INSERT INTO users (name, email, password_hash)
        VALUES ($1, $2, $3)
        RETURNING id, name, email, created_at
      `, ['John Doe', 'john@example.com', '$2b$12$hashedpassword']);
      
      const user = userResult.rows[0];
      console.log('Created user:', user);
      
      // Create an event
      const eventResult = await this.pool.query(`
        INSERT INTO events (title, description, date_time, location, capacity, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, title, date_time, capacity
      `, [
        'Tech Conference 2024',
        'Annual technology conference',
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        'Convention Center',
        100,
        user.id
      ]);
      
      const event = eventResult.rows[0];
      console.log('Created event:', event);
      
      return { user, event };
      
    } catch (error) {
      console.error('CRUD operation failed:', error.message);
      throw error;
    }
  }
  
  // Example 2: Safe event registration with race condition prevention
  async safeRegistrationExample() {
    console.log('\n🔒 Safe Registration Example');
    
    try {
      // Create test data
      const { user, event } = await this.basicCrudExample();
      
      // Use the safe registration function
      const registrationResult = await this.pool.safeEventRegistration(user.id, event.id);
      
      if (registrationResult.success) {
        console.log('✅ Registration successful:', registrationResult);
        
        // Get updated event statistics
        const stats = await this.pool.getEventStats(event.id);
        console.log('📊 Event statistics:', stats);
        
        // Try to register the same user again (should fail)
        const duplicateResult = await this.pool.safeEventRegistration(user.id, event.id);
        console.log('❌ Duplicate registration attempt:', duplicateResult);
        
      } else {
        console.log('❌ Registration failed:', registrationResult);
      }
      
    } catch (error) {
      console.error('Safe registration example failed:', error.message);
    }
  }
  
  // Example 3: Transaction usage
  async transactionExample() {
    console.log('\n💳 Transaction Example');
    
    try {
      const result = await this.pool.withTransaction(async (client) => {
        // Create user within transaction
        const userResult = await client.query(`
          INSERT INTO users (name, email, password_hash)
          VALUES ($1, $2, $3)
          RETURNING id
        `, ['Jane Smith', 'jane@example.com', '$2b$12$hashedpassword']);
        
        const userId = userResult.rows[0].id;
        
        // Create event within same transaction
        const eventResult = await client.query(`
          INSERT INTO events (title, date_time, capacity, created_by)
          VALUES ($1, $2, $3, $4)
          RETURNING id
        `, [
          'Workshop Series',
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
          50,
          userId
        ]);
        
        const eventId = eventResult.rows[0].id;
        
        // Register user for their own event
        await client.query(`
          INSERT INTO registrations (user_id, event_id, status)
          VALUES ($1, $2, $3)
        `, [userId, eventId, 'confirmed']);
        
        return { userId, eventId };
      });
      
      console.log('✅ Transaction completed successfully:', result);
      
    } catch (error) {
      console.error('❌ Transaction failed:', error.message);
      // Transaction was automatically rolled back
    }
  }
  
  // Example 4: Concurrent registration simulation
  async concurrentRegistrationExample() {
    console.log('\n🏃‍♂️ Concurrent Registration Example');
    
    try {
      // Create event with limited capacity
      const { user, event } = await this.basicCrudExample();
      
      // Update event to have only 2 spots
      await this.pool.query(`
        UPDATE events SET capacity = 2 WHERE id = $1
      `, [event.id]);
      
      // Create additional users
      const users = [];
      for (let i = 0; i < 5; i++) {
        const userResult = await this.pool.query(`
          INSERT INTO users (name, email, password_hash)
          VALUES ($1, $2, $3)
          RETURNING id
        `, [`User ${i}`, `user${i}@example.com`, '$2b$12$hashedpassword']);
        
        users.push(userResult.rows[0]);
      }
      
      // Simulate concurrent registrations
      console.log('🔄 Simulating concurrent registrations...');
      
      const registrationPromises = users.map(user => 
        this.pool.safeEventRegistration(user.id, event.id)
      );
      
      const results = await Promise.allSettled(registrationPromises);
      
      // Analyze results
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
      const failed = results.length - successful;
      
      console.log(`✅ Successful registrations: ${successful}`);
      console.log(`❌ Failed registrations: ${failed}`);
      
      // Get final event statistics
      const finalStats = await this.pool.getEventStats(event.id);
      console.log('📊 Final event statistics:', finalStats);
      
    } catch (error) {
      console.error('Concurrent registration example failed:', error.message);
    }
  }
  
  // Example 5: Search and filtering
  async searchExample() {
    console.log('\n🔍 Search and Filtering Example');
    
    try {
      // Create sample events
      const events = [
        { title: 'JavaScript Workshop', location: 'Tech Hub', capacity: 30 },
        { title: 'Python Bootcamp', location: 'Learning Center', capacity: 25 },
        { title: 'React Conference', location: 'Convention Hall', capacity: 200 }
      ];
      
      const userId = 1; // Assume user exists
      
      for (const eventData of events) {
        await this.pool.query(`
          INSERT INTO events (title, location, capacity, created_by, date_time)
          VALUES ($1, $2, $3, $4, $5)
        `, [
          eventData.title,
          eventData.location,
          eventData.capacity,
          userId,
          new Date(Date.now() + Math.random() * 30 * 24 * 60 * 60 * 1000)
        ]);
      }
      
      // Full-text search example
      const searchResult = await this.pool.query(`
        SELECT id, title, location, capacity, 
               ts_rank(to_tsvector('english', title || ' ' || COALESCE(location, '')), 
                      plainto_tsquery('english', $1)) as rank
        FROM events
        WHERE to_tsvector('english', title || ' ' || COALESCE(location, '')) 
              @@ plainto_tsquery('english', $1)
        ORDER BY rank DESC
      `, ['JavaScript']);
      
      console.log('🔍 Search results for "JavaScript":', searchResult.rows);
      
      // Filter by capacity
      const capacityResult = await this.pool.query(`
        SELECT title, location, capacity, current_registrations,
               (capacity - current_registrations) as available_spots
        FROM events
        WHERE capacity >= $1 AND is_active = true
        ORDER BY capacity DESC
      `, [50]);
      
      console.log('📊 Events with capacity >= 50:', capacityResult.rows);
      
    } catch (error) {
      console.error('Search example failed:', error.message);
    }
  }
  
  // Example 6: Performance monitoring
  async performanceMonitoringExample() {
    console.log('\n📈 Performance Monitoring Example');
    
    try {
      // Get connection pool metrics
      const poolMetrics = this.pool.getMetrics();
      console.log('🔌 Connection pool metrics:', poolMetrics);
      
      // Get index usage statistics
      const indexStats = await this.pool.query(`
        SELECT * FROM get_index_usage_stats()
        ORDER BY idx_scan DESC
        LIMIT 10
      `);
      console.log('📊 Top 10 most used indexes:', indexStats.rows);
      
      // Check for unused indexes
      const unusedIndexes = await this.pool.query(`
        SELECT * FROM get_unused_indexes()
      `);
      console.log('⚠️  Unused indexes:', unusedIndexes.rows);
      
      // Validate business rules
      const ruleViolations = await this.pool.query(`
        SELECT * FROM validate_business_rules()
      `);
      console.log('🚨 Business rule violations:', ruleViolations.rows);
      
    } catch (error) {
      console.error('Performance monitoring failed:', error.message);
    }
  }
  
  // Run all examples
  async runAllExamples() {
    try {
      await this.initialize();
      
      await this.basicCrudExample();
      await this.safeRegistrationExample();
      await this.transactionExample();
      await this.concurrentRegistrationExample();
      await this.searchExample();
      await this.performanceMonitoringExample();
      
    } catch (error) {
      console.error('❌ Example execution failed:', error);
    } finally {
      await this.cleanup();
    }
  }
}

// Run examples if this file is executed directly
if (require.main === module) {
  const example = new EventManagementExample();
  example.runAllExamples()
    .then(() => {
      console.log('\n✅ All examples completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Examples failed:', error);
      process.exit(1);
    });
}

module.exports = EventManagementExample;
