const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

class TestHelpers {
  constructor() {
    this.pool = null;
  }

  async initialize() {
    if (!this.pool) {
      // Simple test database connection
      this.pool = new Pool({
        host: process.env.TEST_DB_HOST || 'localhost',
        port: process.env.TEST_DB_PORT || 5432,
        user: process.env.TEST_DB_USER || 'postgres',
        password: process.env.TEST_DB_PASSWORD || 'password',
        database: process.env.TEST_DB_NAME || 'event_management_test'
      });
    }
  }

  async cleanup() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  async cleanDatabase() {
    await this.initialize();
    await this.pool.query('TRUNCATE TABLE registrations, events, users RESTART IDENTITY CASCADE');
  }

  async query(sql, params = []) {
    await this.initialize();
    return this.pool.query(sql, params);
  }

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

    return {
      ...createdUser,
      token,
      password: user.password
    };
  }

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

    return result.rows[0];
  }

  async createRegistration(userId, eventId, status = 'confirmed') {
    const result = await this.query(`
      INSERT INTO registrations (user_id, event_id, status)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [userId, eventId, status]);

    return result.rows[0];
  }

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

  getFutureDate(daysFromNow = 7) {
    return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  }

  getPastDate(daysAgo = 7) {
    return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  }
}

// Export singleton instance
module.exports = new TestHelpers();
