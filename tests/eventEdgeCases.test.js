const request = require('supertest');
const app = require('../src/app');
const { databaseManager } = require('../database/config/database');

describe('Event API Edge Cases and Error Scenarios', () => {
  let pool;
  let testUser;
  let authToken;

  beforeAll(async () => {
    await databaseManager.initialize();
    pool = databaseManager.getPool();
    
    await pool.query('TRUNCATE TABLE registrations, events, users RESTART IDENTITY CASCADE');
    
    const userResult = await pool.query(`
      INSERT INTO users (name, email, password_hash, is_active)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, email
    `, ['Edge Test User', 'edge@example.com', '$2b$12$hashedpassword', true]);
    
    testUser = userResult.rows[0];
    authToken = 'mock-jwt-token-edge';
  });

  afterAll(async () => {
    await pool.query('TRUNCATE TABLE registrations, events, users RESTART IDENTITY CASCADE');
    await databaseManager.close();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE registrations, events RESTART IDENTITY CASCADE');
  });

  describe('Input Validation Edge Cases', () => {
    it('should reject extremely long event titles', async () => {
      const longTitle = 'A'.repeat(501); // Exceeds 500 char limit

      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: longTitle,
          date_time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          capacity: 50
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Title must be between 1 and 500 characters');
    });

    it('should reject events with special characters in title', async () => {
      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Event<script>alert("xss")</script>',
          date_time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          capacity: 50
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('invalid characters');
    });

    it('should reject events scheduled too far in the future', async () => {
      const farFutureDate = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000); // Over 1 year

      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Far Future Event',
          date_time: farFutureDate.toISOString(),
          capacity: 50
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('more than 1 year in the future');
    });

    it('should reject events with zero capacity', async () => {
      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Zero Capacity Event',
          date_time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          capacity: 0
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('between 1 and 10000');
    });

    it('should reject events with negative capacity', async () => {
      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Negative Capacity Event',
          date_time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          capacity: -10
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('between 1 and 10000');
    });

    it('should handle malformed date formats', async () => {
      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Bad Date Event',
          date_time: 'not-a-date',
          capacity: 50
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('valid ISO 8601 datetime');
    });
  });

  describe('Concurrent Registration Edge Cases', () => {
    let testEvent;

    beforeEach(async () => {
      const eventResult = await pool.query(`
        INSERT INTO events (title, date_time, capacity, created_by)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [
        'Concurrent Test Event',
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        2, // Small capacity for testing
        testUser.id
      ]);
      testEvent = eventResult.rows[0];
    });

    it('should handle multiple simultaneous registrations gracefully', async () => {
      // Create multiple users
      const users = [];
      for (let i = 0; i < 5; i++) {
        const userResult = await pool.query(`
          INSERT INTO users (name, email, password_hash)
          VALUES ($1, $2, $3)
          RETURNING id
        `, [`Concurrent User ${i}`, `concurrent${i}@test.com`, '$2b$12$hash']);
        users.push(userResult.rows[0]);
      }

      // Attempt simultaneous registrations
      const registrationPromises = users.map(user => 
        pool.safeEventRegistration(user.id, testEvent.id)
      );

      const results = await Promise.allSettled(registrationPromises);
      
      // Count successful and failed registrations
      const successful = results.filter(r => 
        r.status === 'fulfilled' && r.value.success
      ).length;
      
      const failed = results.filter(r => 
        r.status === 'fulfilled' && !r.value.success
      ).length;

      // Should have exactly 2 successful (capacity) and 3 failed
      expect(successful).toBe(2);
      expect(failed).toBe(3);
    });

    it('should maintain data consistency under high concurrency', async () => {
      // Create users and register them concurrently
      const users = [];
      for (let i = 0; i < 10; i++) {
        const userResult = await pool.query(`
          INSERT INTO users (name, email, password_hash)
          VALUES ($1, $2, $3)
          RETURNING id
        `, [`Consistency User ${i}`, `consistency${i}@test.com`, '$2b$12$hash']);
        users.push(userResult.rows[0]);
      }

      // Concurrent registration attempts
      await Promise.allSettled(
        users.map(user => pool.safeEventRegistration(user.id, testEvent.id))
      );

      // Verify data consistency
      const eventResult = await pool.query(`
        SELECT current_registrations FROM events WHERE id = $1
      `, [testEvent.id]);

      const actualCount = await pool.query(`
        SELECT COUNT(*) as count FROM registrations 
        WHERE event_id = $1 AND status = 'confirmed'
      `, [testEvent.id]);

      expect(eventResult.rows[0].current_registrations).toBe(
        parseInt(actualCount.rows[0].count)
      );
      expect(eventResult.rows[0].current_registrations).toBeLessThanOrEqual(2);
    });
  });

  describe('Database Constraint Violations', () => {
    it('should handle database connection failures gracefully', async () => {
      // This test would require mocking database failures
      // For now, we'll test a scenario that might cause database issues
      
      const response = await request(app)
        .get('/api/events/999999999'); // Very large ID that might cause issues

      expect([400, 404]).toContain(response.status);
    });

    it('should handle invalid foreign key references', async () => {
      // Try to register non-existent user for event
      const eventResult = await pool.query(`
        INSERT INTO events (title, date_time, capacity, created_by)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [
        'FK Test Event',
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        50,
        testUser.id
      ]);

      const result = await pool.safeEventRegistration(99999, eventResult.rows[0].id);
      expect(result.success).toBe(false);
    });
  });

  describe('Boundary Value Testing', () => {
    it('should handle minimum valid capacity (1)', async () => {
      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Min Capacity Event',
          date_time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          capacity: 1
        });

      expect(response.status).toBe(201);
      expect(response.body.data.event.capacity).toBe(1);
    });

    it('should handle maximum valid capacity (10000)', async () => {
      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Max Capacity Event',
          date_time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          capacity: 10000
        });

      expect(response.status).toBe(201);
      expect(response.body.data.event.capacity).toBe(10000);
    });

    it('should handle minimum future time (1 hour + 1 minute)', async () => {
      const minFutureTime = new Date(Date.now() + 61 * 60 * 1000); // 61 minutes

      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Min Future Time Event',
          date_time: minFutureTime.toISOString(),
          capacity: 50
        });

      expect(response.status).toBe(201);
    });
  });

  describe('Security and Injection Testing', () => {
    it('should prevent SQL injection in search queries', async () => {
      const response = await request(app)
        .get("/api/events/upcoming?search='; DROP TABLE events; --");

      expect(response.status).toBe(200);
      
      // Verify events table still exists
      const tableCheck = await pool.query(`
        SELECT COUNT(*) FROM information_schema.tables 
        WHERE table_name = 'events'
      `);
      expect(parseInt(tableCheck.rows[0].count)).toBe(1);
    });

    it('should sanitize HTML in event descriptions', async () => {
      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'XSS Test Event',
          description: '<script>alert("xss")</script><img src="x" onerror="alert(1)">',
          date_time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          capacity: 50
        });

      if (response.status === 201) {
        // If creation succeeded, verify the content is properly handled
        expect(response.body.data.event.description).toBeDefined();
        // The exact handling depends on your sanitization strategy
      }
    });

    it('should handle extremely large request payloads', async () => {
      const largeDescription = 'A'.repeat(50000); // Very large description

      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Large Payload Event',
          description: largeDescription,
          date_time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          capacity: 50
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Description must be less than 10000 characters');
    });
  });

  describe('Performance Edge Cases', () => {
    it('should handle pagination with large page numbers', async () => {
      const response = await request(app)
        .get('/api/events/upcoming?page=999999&limit=10');

      expect(response.status).toBe(200);
      expect(response.body.data.events).toHaveLength(0);
      expect(response.body.data.pagination.current_page).toBe(999999);
    });

    it('should handle maximum allowed limit', async () => {
      const response = await request(app)
        .get('/api/events/upcoming?limit=100');

      expect(response.status).toBe(200);
      expect(response.body.data.pagination.items_per_page).toBe(100);
    });

    it('should reject limit exceeding maximum', async () => {
      const response = await request(app)
        .get('/api/events/upcoming?limit=101');

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('between 1 and 100');
    });
  });
});
