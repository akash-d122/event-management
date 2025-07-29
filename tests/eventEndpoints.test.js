const request = require('supertest');
const app = require('../src/app');
const { databaseManager } = require('../database/config/database');

describe('Event Management API Endpoints', () => {
  let pool;
  let testUser;
  let testUser2;
  let authToken;
  let authToken2;

  beforeAll(async () => {
    // Initialize database
    await databaseManager.initialize();
    pool = databaseManager.getPool();
    
    // Clean up existing test data
    await pool.query('TRUNCATE TABLE registrations, events, users RESTART IDENTITY CASCADE');
    
    // Create test users
    const user1Result = await pool.query(`
      INSERT INTO users (name, email, password_hash, is_active)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, email
    `, ['Test User 1', 'test1@example.com', '$2b$12$hashedpassword', true]);
    
    const user2Result = await pool.query(`
      INSERT INTO users (name, email, password_hash, is_active)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, email
    `, ['Test User 2', 'test2@example.com', '$2b$12$hashedpassword', true]);
    
    testUser = user1Result.rows[0];
    testUser2 = user2Result.rows[0];
    
    // Mock authentication tokens (in real app, these would be JWT tokens)
    authToken = 'mock-jwt-token-user1';
    authToken2 = 'mock-jwt-token-user2';
  });

  afterAll(async () => {
    await pool.query('TRUNCATE TABLE registrations, events, users RESTART IDENTITY CASCADE');
    await databaseManager.close();
  });

  beforeEach(async () => {
    // Clean up events and registrations before each test
    await pool.query('TRUNCATE TABLE registrations, events RESTART IDENTITY CASCADE');
  });

  describe('POST /api/events - Create Event', () => {
    const validEventData = {
      title: 'Test Conference 2024',
      description: 'A test conference for developers',
      date_time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
      location: 'Convention Center',
      capacity: 100
    };

    it('should create event with valid data', async () => {
      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send(validEventData);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.event.title).toBe(validEventData.title);
      expect(response.body.data.event.capacity).toBe(validEventData.capacity);
      expect(response.body.data.event.current_registrations).toBe(0);
      expect(response.body.data.event.available_spots).toBe(100);
    });

    it('should reject event with invalid capacity', async () => {
      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          ...validEventData,
          capacity: 15000 // Exceeds maximum
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Capacity must be between 1 and 10000');
    });

    it('should reject event with past date', async () => {
      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          ...validEventData,
          date_time: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() // Yesterday
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('at least 1 hour in the future');
    });

    it('should reject event without authentication', async () => {
      const response = await request(app)
        .post('/api/events')
        .send(validEventData);

      expect(response.status).toBe(401);
    });

    it('should prevent conflicting events (same user, overlapping time)', async () => {
      // Create first event
      await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send(validEventData);

      // Try to create overlapping event
      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          ...validEventData,
          title: 'Conflicting Event',
          date_time: new Date(new Date(validEventData.date_time).getTime() + 30 * 60 * 1000).toISOString() // 30 minutes later
        });

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('within 1 hour');
    });
  });

  describe('GET /api/events/:id - Get Event Details', () => {
    let testEvent;

    beforeEach(async () => {
      // Create test event
      const eventResult = await pool.query(`
        INSERT INTO events (title, description, date_time, location, capacity, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [
        'Test Event',
        'Test Description',
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        'Test Location',
        50,
        testUser.id
      ]);
      testEvent = eventResult.rows[0];
    });

    it('should get event details without authentication', async () => {
      const response = await request(app)
        .get(`/api/events/${testEvent.id}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.event.title).toBe('Test Event');
      expect(response.body.data.event.capacity).toBe(50);
      expect(response.body.data.registered_users).toHaveProperty('count');
    });

    it('should get enhanced details with authentication', async () => {
      const response = await request(app)
        .get(`/api/events/${testEvent.id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.event.user_permissions).toBeDefined();
      expect(response.body.data.event.user_permissions.can_edit).toBe(true);
      expect(response.body.data.statistics).toBeDefined();
    });

    it('should return 404 for non-existent event', async () => {
      const response = await request(app)
        .get('/api/events/99999');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });

    it('should return 400 for invalid event ID', async () => {
      const response = await request(app)
        .get('/api/events/invalid');

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/events/:id/register - Register for Event', () => {
    let testEvent;

    beforeEach(async () => {
      // Create test event
      const eventResult = await pool.query(`
        INSERT INTO events (title, date_time, capacity, created_by)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [
        'Registration Test Event',
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        5,
        testUser.id
      ]);
      testEvent = eventResult.rows[0];
    });

    it('should register user for event successfully', async () => {
      const response = await request(app)
        .post(`/api/events/${testEvent.id}/register`)
        .set('Authorization', `Bearer ${authToken2}`);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Successfully registered');
      expect(response.body.data.registration.user_id).toBe(testUser2.id);
      expect(response.body.data.event.available_spots).toBe(4);
    });

    it('should prevent duplicate registration', async () => {
      // First registration
      await request(app)
        .post(`/api/events/${testEvent.id}/register`)
        .set('Authorization', `Bearer ${authToken2}`);

      // Second registration attempt
      const response = await request(app)
        .post(`/api/events/${testEvent.id}/register`)
        .set('Authorization', `Bearer ${authToken2}`);

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('already registered');
    });

    it('should prevent registration when event is at capacity', async () => {
      // Fill event to capacity
      for (let i = 0; i < 5; i++) {
        const userResult = await pool.query(`
          INSERT INTO users (name, email, password_hash)
          VALUES ($1, $2, $3)
          RETURNING id
        `, [`User ${i}`, `user${i}@test.com`, '$2b$12$hash']);
        
        await pool.query(`
          INSERT INTO registrations (user_id, event_id, status)
          VALUES ($1, $2, 'confirmed')
        `, [userResult.rows[0].id, testEvent.id]);
      }

      const response = await request(app)
        .post(`/api/events/${testEvent.id}/register`)
        .set('Authorization', `Bearer ${authToken2}`);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('maximum capacity');
    });

    it('should prevent registration for past events', async () => {
      // Create past event
      const pastEventResult = await pool.query(`
        INSERT INTO events (title, date_time, capacity, created_by)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [
        'Past Event',
        new Date(Date.now() - 24 * 60 * 60 * 1000), // Yesterday
        50,
        testUser.id
      ]);

      const response = await request(app)
        .post(`/api/events/${pastEventResult.rows[0].id}/register`)
        .set('Authorization', `Bearer ${authToken2}`);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('past events');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post(`/api/events/${testEvent.id}/register`);

      expect(response.status).toBe(401);
    });
  });

  describe('DELETE /api/events/:id/register/:userId - Cancel Registration', () => {
    let testEvent;
    let registration;

    beforeEach(async () => {
      // Create test event
      const eventResult = await pool.query(`
        INSERT INTO events (title, date_time, capacity, created_by)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [
        'Cancellation Test Event',
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        50,
        testUser.id
      ]);
      testEvent = eventResult.rows[0];

      // Create registration
      const regResult = await pool.query(`
        INSERT INTO registrations (user_id, event_id, status)
        VALUES ($1, $2, 'confirmed')
        RETURNING *
      `, [testUser2.id, testEvent.id]);
      registration = regResult.rows[0];
    });

    it('should cancel own registration successfully', async () => {
      const response = await request(app)
        .delete(`/api/events/${testEvent.id}/register/${testUser2.id}`)
        .set('Authorization', `Bearer ${authToken2}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('cancelled successfully');
    });

    it('should prevent cancelling other user\'s registration', async () => {
      const response = await request(app)
        .delete(`/api/events/${testEvent.id}/register/${testUser2.id}`)
        .set('Authorization', `Bearer ${authToken}`); // Different user

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('only cancel your own');
    });

    it('should return 404 for non-existent registration', async () => {
      const response = await request(app)
        .delete(`/api/events/${testEvent.id}/register/${testUser.id}`) // Not registered
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
    });

    it('should prevent cancellation for past events', async () => {
      // Create past event with registration
      const pastEventResult = await pool.query(`
        INSERT INTO events (title, date_time, capacity, created_by)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [
        'Past Event',
        new Date(Date.now() - 24 * 60 * 60 * 1000),
        50,
        testUser.id
      ]);

      await pool.query(`
        INSERT INTO registrations (user_id, event_id, status)
        VALUES ($1, $2, 'confirmed')
      `, [testUser2.id, pastEventResult.rows[0].id]);

      const response = await request(app)
        .delete(`/api/events/${pastEventResult.rows[0].id}/register/${testUser2.id}`)
        .set('Authorization', `Bearer ${authToken2}`);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('past events');
    });
  });

  describe('GET /api/events/upcoming - List Future Events', () => {
    beforeEach(async () => {
      // Create multiple test events
      const events = [
        {
          title: 'JavaScript Workshop',
          date_time: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
          location: 'Tech Hub',
          capacity: 30
        },
        {
          title: 'Python Conference',
          date_time: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          location: 'Convention Center',
          capacity: 200
        },
        {
          title: 'React Meetup',
          date_time: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
          location: 'Startup Office',
          capacity: 50
        }
      ];

      for (const event of events) {
        await pool.query(`
          INSERT INTO events (title, date_time, location, capacity, created_by)
          VALUES ($1, $2, $3, $4, $5)
        `, [event.title, event.date_time, event.location, event.capacity, testUser.id]);
      }
    });

    it('should list upcoming events with default pagination', async () => {
      const response = await request(app)
        .get('/api/events/upcoming');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.events).toHaveLength(3);
      expect(response.body.data.pagination.current_page).toBe(1);
      expect(response.body.data.pagination.total_items).toBe(3);
    });

    it('should support search functionality', async () => {
      const response = await request(app)
        .get('/api/events/upcoming?search=JavaScript');

      expect(response.status).toBe(200);
      expect(response.body.data.events).toHaveLength(1);
      expect(response.body.data.events[0].title).toContain('JavaScript');
    });

    it('should support location filtering', async () => {
      const response = await request(app)
        .get('/api/events/upcoming?location=Tech Hub');

      expect(response.status).toBe(200);
      expect(response.body.data.events).toHaveLength(1);
      expect(response.body.data.events[0].location).toBe('Tech Hub');
    });

    it('should support capacity filtering', async () => {
      const response = await request(app)
        .get('/api/events/upcoming?min_capacity=100');

      expect(response.status).toBe(200);
      expect(response.body.data.events).toHaveLength(1);
      expect(response.body.data.events[0].capacity).toBeGreaterThanOrEqual(100);
    });

    it('should support custom sorting', async () => {
      const response = await request(app)
        .get('/api/events/upcoming?sort_by=capacity&sort_order=DESC');

      expect(response.status).toBe(200);
      const events = response.body.data.events;
      expect(events[0].capacity).toBeGreaterThanOrEqual(events[1].capacity);
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/api/events/upcoming?page=1&limit=2');

      expect(response.status).toBe(200);
      expect(response.body.data.events).toHaveLength(2);
      expect(response.body.data.pagination.current_page).toBe(1);
      expect(response.body.data.pagination.has_next_page).toBe(true);
    });
  });

  describe('GET /api/events/:id/stats - Get Event Statistics', () => {
    let testEvent;

    beforeEach(async () => {
      // Create test event
      const eventResult = await pool.query(`
        INSERT INTO events (title, date_time, capacity, created_by)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [
        'Stats Test Event',
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        100,
        testUser.id
      ]);
      testEvent = eventResult.rows[0];

      // Create some registrations
      for (let i = 0; i < 3; i++) {
        const userResult = await pool.query(`
          INSERT INTO users (name, email, password_hash)
          VALUES ($1, $2, $3)
          RETURNING id
        `, [`Stats User ${i}`, `stats${i}@test.com`, '$2b$12$hash']);

        await pool.query(`
          INSERT INTO registrations (user_id, event_id, status, registered_at)
          VALUES ($1, $2, 'confirmed', $3)
        `, [userResult.rows[0].id, testEvent.id, new Date(Date.now() - i * 60 * 60 * 1000)]);
      }
    });

    it('should return comprehensive event statistics', async () => {
      const response = await request(app)
        .get(`/api/events/${testEvent.id}/stats`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.event.id).toBe(testEvent.id);
      expect(response.body.data.statistics).toBeDefined();
      expect(response.body.data.statistics.confirmed_registrations).toBe(3);
      expect(response.body.data.statistics.registration_rate_percentage).toBeDefined();
      expect(response.body.data.registration_timeline).toBeDefined();
      expect(response.body.data.status_breakdown).toBeDefined();
      expect(response.body.data.recent_registrations).toBeDefined();
    });

    it('should return 404 for non-existent event', async () => {
      const response = await request(app)
        .get('/api/events/99999/stats');

      expect(response.status).toBe(404);
    });

    it('should include time calculations', async () => {
      const response = await request(app)
        .get(`/api/events/${testEvent.id}/stats`);

      expect(response.body.data.statistics.time_until_event).toBeDefined();
      expect(response.body.data.statistics.is_event_soon).toBeDefined();
      expect(response.body.data.statistics.capacity_utilization).toBeDefined();
    });
  });
});
