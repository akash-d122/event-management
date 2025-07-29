const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

class TestHelpers {
  constructor() {
    this.pool = null;
    this.testUsers = new Map();
    this.testEvents = new Map();
  }

  async initialize() {
    if (!this.pool) {
      this.pool = new Pool(global.__TEST_DB_CONFIG__);
    }
  }

  async cleanup() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    this.testUsers.clear();
    this.testEvents.clear();
  }

  // Database helpers
  async cleanDatabase() {
    await this.initialize();
    await this.pool.query('TRUNCATE TABLE registrations, events, users RESTART IDENTITY CASCADE');
    this.testUsers.clear();
    this.testEvents.clear();
  }

  async query(sql, params = []) {
    await this.initialize();
    return this.pool.query(sql, params);
  }

  // User creation helpers
  async createTestUser(userData = {}) {
    const defaultUser = {
      name: 'Test User',
      email: 'test@example.com',
      password: 'TestPassword123!',
      is_active: true
    };

    const user = { ...defaultUser, ...userData };
    const hashedPassword = await bcrypt.hash(user.password, 12);

    const result = await this.query(`
      INSERT INTO users (name, email, password_hash, is_active)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, email, is_active, created_at, updated_at
    `, [user.name, user.email, hashedPassword, user.is_active]);

    const createdUser = result.rows[0];
    const token = this.generateJWT(createdUser);

    const userWithToken = {
      ...createdUser,
      token,
      password: user.password // Keep original password for testing
    };

    this.testUsers.set(createdUser.id, userWithToken);
    return userWithToken;
  }

  async createMultipleUsers(count, baseData = {}) {
    const users = [];
    for (let i = 0; i < count; i++) {
      const userData = {
        name: `Test User ${i + 1}`,
        email: `test${i + 1}@example.com`,
        ...baseData
      };
      const user = await this.createTestUser(userData);
      users.push(user);
    }
    return users;
  }

  // Event creation helpers
  async createTestEvent(eventData = {}, createdBy = null) {
    if (!createdBy) {
      const user = await this.createTestUser();
      createdBy = user.id;
    }

    const defaultEvent = {
      title: 'Test Event',
      description: 'A test event for testing purposes',
      date_time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
      location: 'Test Location',
      capacity: 100
    };

    const event = { ...defaultEvent, ...eventData };

    const result = await this.query(`
      INSERT INTO events (title, description, date_time, location, capacity, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [event.title, event.description, event.date_time, event.location, event.capacity, createdBy]);

    const createdEvent = result.rows[0];
    this.testEvents.set(createdEvent.id, createdEvent);
    return createdEvent;
  }

  async createMultipleEvents(count, baseData = {}, createdBy = null) {
    const events = [];
    for (let i = 0; i < count; i++) {
      const eventData = {
        title: `Test Event ${i + 1}`,
        date_time: new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000),
        ...baseData
      };
      const event = await this.createTestEvent(eventData, createdBy);
      events.push(event);
    }
    return events;
  }

  // Registration helpers
  async createRegistration(userId, eventId, status = 'confirmed') {
    const result = await this.query(`
      INSERT INTO registrations (user_id, event_id, status)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [userId, eventId, status]);

    return result.rows[0];
  }

  async fillEventToCapacity(eventId, excludeUserId = null) {
    const eventResult = await this.query('SELECT capacity, current_registrations FROM events WHERE id = $1', [eventId]);
    const event = eventResult.rows[0];
    
    const spotsToFill = event.capacity - event.current_registrations;
    const users = [];

    for (let i = 0; i < spotsToFill; i++) {
      const user = await this.createTestUser({
        name: `Filler User ${i + 1}`,
        email: `filler${i + 1}@example.com`
      });
      
      if (user.id !== excludeUserId) {
        await this.createRegistration(user.id, eventId);
        users.push(user);
      }
    }

    return users;
  }

  // JWT helpers
  generateJWT(user) {
    return jwt.sign(
      { 
        id: user.id, 
        email: user.email,
        name: user.name 
      },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '24h' }
    );
  }

  // Date helpers
  getFutureDate(daysFromNow = 7) {
    return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  }

  getPastDate(daysAgo = 7) {
    return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  }

  // Validation helpers
  expectValidEvent(event) {
    expect(event).toHaveProperty('id');
    expect(event).toHaveProperty('title');
    expect(event).toHaveProperty('date_time');
    expect(event).toHaveProperty('capacity');
    expect(event).toHaveProperty('current_registrations');
    expect(event).toHaveProperty('created_by');
    expect(event).toHaveProperty('created_at');
    expect(event).toHaveProperty('updated_at');
    expect(typeof event.id).toBe('number');
    expect(typeof event.title).toBe('string');
    expect(typeof event.capacity).toBe('number');
    expect(typeof event.current_registrations).toBe('number');
  }

  expectValidUser(user) {
    expect(user).toHaveProperty('id');
    expect(user).toHaveProperty('name');
    expect(user).toHaveProperty('email');
    expect(user).toHaveProperty('created_at');
    expect(user).toHaveProperty('updated_at');
    expect(typeof user.id).toBe('number');
    expect(typeof user.name).toBe('string');
    expect(typeof user.email).toBe('string');
    expect(user.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  }

  expectValidRegistration(registration) {
    expect(registration).toHaveProperty('id');
    expect(registration).toHaveProperty('user_id');
    expect(registration).toHaveProperty('event_id');
    expect(registration).toHaveProperty('registered_at');
    expect(registration).toHaveProperty('status');
    expect(typeof registration.id).toBe('number');
    expect(typeof registration.user_id).toBe('number');
    expect(typeof registration.event_id).toBe('number');
    expect(['confirmed', 'cancelled', 'waitlist', 'pending']).toContain(registration.status);
  }

  expectErrorResponse(response, statusCode, messageContains = null) {
    expect(response.status).toBe(statusCode);
    expect(response.body).toHaveProperty('success', false);
    expect(response.body).toHaveProperty('message');
    if (messageContains) {
      expect(response.body.message).toContain(messageContains);
    }
  }

  expectSuccessResponse(response, statusCode = 200) {
    expect(response.status).toBe(statusCode);
    expect(response.body).toHaveProperty('success', true);
    expect(response.body).toHaveProperty('data');
  }

  // Concurrent operation helpers
  async simulateConcurrentRegistrations(eventId, userCount) {
    const users = await this.createMultipleUsers(userCount);
    
    const registrationPromises = users.map(user => 
      this.query('SELECT safe_event_registration($1, $2) as result', [user.id, eventId])
    );

    const results = await Promise.allSettled(registrationPromises);
    
    return {
      users,
      results: results.map(r => r.status === 'fulfilled' ? r.value.rows[0].result : { success: false, error: r.reason })
    };
  }

  // Performance helpers
  async measureExecutionTime(asyncFunction) {
    const startTime = Date.now();
    const result = await asyncFunction();
    const endTime = Date.now();
    
    return {
      result,
      executionTime: endTime - startTime
    };
  }

  // Data verification helpers
  async verifyDatabaseConsistency(eventId) {
    const eventResult = await this.query('SELECT capacity, current_registrations FROM events WHERE id = $1', [eventId]);
    const registrationResult = await this.query('SELECT COUNT(*) as count FROM registrations WHERE event_id = $1 AND status = $2', [eventId, 'confirmed']);
    
    const event = eventResult.rows[0];
    const actualCount = parseInt(registrationResult.rows[0].count);
    
    return {
      isConsistent: event.current_registrations === actualCount,
      storedCount: event.current_registrations,
      actualCount: actualCount,
      capacity: event.capacity
    };
  }
}

// Export singleton instance
module.exports = new TestHelpers();
