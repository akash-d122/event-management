const request = require('supertest');
const app = require('../../src/app');
const testHelpers = require('../utils/testHelpers');

describe('Event Controller Unit Tests', () => {
  let testUser;
  let testUser2;

  beforeAll(async () => {
    await testHelpers.initialize();
  });

  afterAll(async () => {
    await testHelpers.cleanup();
  });

  beforeEach(async () => {
    await testHelpers.cleanDatabase();
    
    // Create test users
    testUser = await testHelpers.createTestUser({
      name: 'Event Organizer',
      email: 'organizer@test.com'
    });
    
    testUser2 = await testHelpers.createTestUser({
      name: 'Event Attendee',
      email: 'attendee@test.com'
    });
  });

  describe('POST /api/events - Create Event', () => {
    const validEventData = {
      title: 'Tech Conference 2024',
      description: 'Annual technology conference',
      date_time: testHelpers.getFutureDate(7).toISOString(),
      location: 'Convention Center',
      capacity: 500
    };

    it('should create event with valid data', async () => {
      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send(validEventData);

      testHelpers.expectSuccessResponse(response, 201);
      expect(response.body.message).toBe('Event created successfully');
      
      const event = response.body.data.event;
      testHelpers.expectValidEvent(event);
      expect(event.title).toBe(validEventData.title);
      expect(event.capacity).toBe(validEventData.capacity);
      expect(event.current_registrations).toBe(0);
      expect(event.available_spots).toBe(500);
      expect(event.is_full).toBe(false);
      expect(event.time_until_event).toHaveProperty('days');
    });

    it('should reject event with invalid capacity (too high)', async () => {
      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          ...validEventData,
          capacity: 15000
        });

      testHelpers.expectErrorResponse(response, 400, 'between 1 and 10000');
    });

    it('should reject event with invalid capacity (zero)', async () => {
      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          ...validEventData,
          capacity: 0
        });

      testHelpers.expectErrorResponse(response, 400, 'between 1 and 10000');
    });

    it('should reject event with invalid capacity (negative)', async () => {
      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          ...validEventData,
          capacity: -5
        });

      testHelpers.expectErrorResponse(response, 400, 'between 1 and 10000');
    });

    it('should reject event with past date', async () => {
      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          ...validEventData,
          date_time: testHelpers.getPastDate(1).toISOString()
        });

      testHelpers.expectErrorResponse(response, 400, 'at least 1 hour in the future');
    });

    it('should reject event with date too close to now', async () => {
      const tooSoon = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes from now

      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          ...validEventData,
          date_time: tooSoon.toISOString()
        });

      testHelpers.expectErrorResponse(response, 400, 'at least 1 hour in the future');
    });

    it('should reject event with date too far in future', async () => {
      const tooFar = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000); // Over 1 year

      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          ...validEventData,
          date_time: tooFar.toISOString()
        });

      testHelpers.expectErrorResponse(response, 400, 'more than 1 year in the future');
    });

    it('should reject event without authentication', async () => {
      const response = await request(app)
        .post('/api/events')
        .send(validEventData);

      expect(response.status).toBe(401);
    });

    it('should reject event with invalid title (too long)', async () => {
      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          ...validEventData,
          title: 'A'.repeat(501)
        });

      testHelpers.expectErrorResponse(response, 400, 'between 1 and 500 characters');
    });

    it('should reject event with invalid title (empty)', async () => {
      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          ...validEventData,
          title: ''
        });

      testHelpers.expectErrorResponse(response, 400, 'between 1 and 500 characters');
    });

    it('should reject event with invalid title (special characters)', async () => {
      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          ...validEventData,
          title: 'Event<script>alert("xss")</script>'
        });

      testHelpers.expectErrorResponse(response, 400, 'invalid characters');
    });

    it('should handle optional fields correctly', async () => {
      const minimalEvent = {
        title: 'Minimal Event',
        date_time: testHelpers.getFutureDate(7).toISOString(),
        capacity: 50
      };

      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send(minimalEvent);

      testHelpers.expectSuccessResponse(response, 201);
      
      const event = response.body.data.event;
      expect(event.title).toBe(minimalEvent.title);
      expect(event.description).toBeNull();
      expect(event.location).toBeNull();
    });

    it('should prevent conflicting events (same user, overlapping time)', async () => {
      // Create first event
      await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send(validEventData);

      // Try to create overlapping event (30 minutes later)
      const overlappingTime = new Date(new Date(validEventData.date_time).getTime() + 30 * 60 * 1000);

      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          ...validEventData,
          title: 'Conflicting Event',
          date_time: overlappingTime.toISOString()
        });

      testHelpers.expectErrorResponse(response, 409, 'within 1 hour');
    });

    it('should allow different users to create events at same time', async () => {
      // User 1 creates event
      await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send(validEventData);

      // User 2 creates event at same time
      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUser2.token}`)
        .send({
          ...validEventData,
          title: 'Different User Event'
        });

      testHelpers.expectSuccessResponse(response, 201);
    });

    it('should validate description length', async () => {
      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          ...validEventData,
          description: 'A'.repeat(10001) // Exceeds 10000 char limit
        });

      testHelpers.expectErrorResponse(response, 400, 'less than 10000 characters');
    });

    it('should validate location length', async () => {
      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          ...validEventData,
          location: 'A'.repeat(501) // Exceeds 500 char limit
        });

      testHelpers.expectErrorResponse(response, 400, 'less than 500 characters');
    });
  });

  describe('GET /api/events/:id - Get Event Details', () => {
    let testEvent;

    beforeEach(async () => {
      testEvent = await testHelpers.createTestEvent({
        title: 'Test Event Details',
        description: 'Event for testing details endpoint',
        capacity: 50
      }, testUser.id);
    });

    it('should get event details without authentication', async () => {
      const response = await request(app)
        .get(`/api/events/${testEvent.id}`);

      testHelpers.expectSuccessResponse(response, 200);
      
      const event = response.body.data.event;
      testHelpers.expectValidEvent(event);
      expect(event.title).toBe(testEvent.title);
      expect(event.capacity).toBe(testEvent.capacity);
      
      // Should have limited user info for public access
      expect(response.body.data.registered_users).toHaveProperty('count');
      expect(response.body.data.registered_users.details).toBe('Login to view registered users');
    });

    it('should get enhanced details with authentication as owner', async () => {
      const response = await request(app)
        .get(`/api/events/${testEvent.id}`)
        .set('Authorization', `Bearer ${testUser.token}`);

      testHelpers.expectSuccessResponse(response, 200);
      
      const event = response.body.data.event;
      expect(event.user_permissions.can_edit).toBe(true);
      expect(event.user_permissions.can_register).toBe(false); // Owner can't register for own event
      expect(event.user_permissions.is_registered).toBe(false);
      
      // Owner should see full registered users list
      expect(Array.isArray(response.body.data.registered_users)).toBe(true);
      expect(response.body.data.statistics).toBeDefined();
    });

    it('should get details with authentication as non-owner', async () => {
      const response = await request(app)
        .get(`/api/events/${testEvent.id}`)
        .set('Authorization', `Bearer ${testUser2.token}`);

      testHelpers.expectSuccessResponse(response, 200);
      
      const event = response.body.data.event;
      expect(event.user_permissions.can_edit).toBe(false);
      expect(event.user_permissions.can_register).toBe(true);
      expect(event.user_permissions.is_registered).toBe(false);
    });

    it('should return 404 for non-existent event', async () => {
      const response = await request(app)
        .get('/api/events/99999');

      testHelpers.expectErrorResponse(response, 404, 'Event not found');
    });

    it('should return 400 for invalid event ID', async () => {
      const response = await request(app)
        .get('/api/events/invalid');

      testHelpers.expectErrorResponse(response, 400);
    });

    it('should show registration status for registered user', async () => {
      // Register user for event
      await testHelpers.createRegistration(testUser2.id, testEvent.id);

      const response = await request(app)
        .get(`/api/events/${testEvent.id}`)
        .set('Authorization', `Bearer ${testUser2.token}`);

      testHelpers.expectSuccessResponse(response, 200);
      
      const event = response.body.data.event;
      expect(event.user_permissions.is_registered).toBe(true);
      expect(event.user_permissions.can_register).toBe(false);
      
      // Registered user should see full list
      expect(Array.isArray(response.body.data.registered_users)).toBe(true);
    });

    it('should include creator information', async () => {
      const response = await request(app)
        .get(`/api/events/${testEvent.id}`);

      testHelpers.expectSuccessResponse(response, 200);
      
      const event = response.body.data.event;
      expect(event.creator_name).toBe(testUser.name);
      expect(event.creator_email).toBe(testUser.email);
    });

    it('should calculate time until event correctly', async () => {
      const response = await request(app)
        .get(`/api/events/${testEvent.id}`);

      testHelpers.expectSuccessResponse(response, 200);
      
      const event = response.body.data.event;
      expect(event.time_until_event).toHaveProperty('days');
      expect(event.time_until_event).toHaveProperty('hours');
      expect(event.time_until_event).toHaveProperty('minutes');
      expect(event.time_until_event).toHaveProperty('milliseconds');
      expect(event.has_started).toBe(false);
    });
  });

  describe('POST /api/events/:id/register - Register for Event', () => {
    let testEvent;

    beforeEach(async () => {
      testEvent = await testHelpers.createTestEvent({
        title: 'Registration Test Event',
        capacity: 5
      }, testUser.id);
    });

    it('should register user for event successfully', async () => {
      const response = await request(app)
        .post(`/api/events/${testEvent.id}/register`)
        .set('Authorization', `Bearer ${testUser2.token}`);

      testHelpers.expectSuccessResponse(response, 201);
      expect(response.body.message).toContain('Successfully registered');

      const registration = response.body.data.registration;
      testHelpers.expectValidRegistration(registration);
      expect(registration.user_id).toBe(testUser2.id);
      expect(registration.event_id).toBe(testEvent.id);
      expect(registration.status).toBe('confirmed');

      const event = response.body.data.event;
      expect(event.available_spots).toBe(4);
    });

    it('should prevent duplicate registration', async () => {
      // First registration
      await request(app)
        .post(`/api/events/${testEvent.id}/register`)
        .set('Authorization', `Bearer ${testUser2.token}`);

      // Second registration attempt
      const response = await request(app)
        .post(`/api/events/${testEvent.id}/register`)
        .set('Authorization', `Bearer ${testUser2.token}`);

      testHelpers.expectErrorResponse(response, 409, 'already registered');
    });

    it('should prevent registration when event is at capacity', async () => {
      // Fill event to capacity
      await testHelpers.fillEventToCapacity(testEvent.id);

      const response = await request(app)
        .post(`/api/events/${testEvent.id}/register`)
        .set('Authorization', `Bearer ${testUser2.token}`);

      testHelpers.expectErrorResponse(response, 400, 'maximum capacity');
    });

    it('should prevent registration for past events', async () => {
      // Create past event
      const pastEvent = await testHelpers.createTestEvent({
        title: 'Past Event',
        date_time: testHelpers.getPastDate(1),
        capacity: 50
      }, testUser.id);

      const response = await request(app)
        .post(`/api/events/${pastEvent.id}/register`)
        .set('Authorization', `Bearer ${testUser2.token}`);

      testHelpers.expectErrorResponse(response, 400, 'past events');
    });

    it('should prevent registration for non-existent event', async () => {
      const response = await request(app)
        .post('/api/events/99999/register')
        .set('Authorization', `Bearer ${testUser2.token}`);

      testHelpers.expectErrorResponse(response, 404, 'Event not found');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post(`/api/events/${testEvent.id}/register`);

      expect(response.status).toBe(401);
    });

    it('should handle reactivation of cancelled registration', async () => {
      // Create cancelled registration
      await testHelpers.createRegistration(testUser2.id, testEvent.id, 'cancelled');

      const response = await request(app)
        .post(`/api/events/${testEvent.id}/register`)
        .set('Authorization', `Bearer ${testUser2.token}`);

      testHelpers.expectSuccessResponse(response, 200);
      expect(response.body.message).toContain('reactivated');
    });

    it('should prevent registration for inactive events', async () => {
      // Deactivate event
      await testHelpers.query('UPDATE events SET is_active = false WHERE id = $1', [testEvent.id]);

      const response = await request(app)
        .post(`/api/events/${testEvent.id}/register`)
        .set('Authorization', `Bearer ${testUser2.token}`);

      testHelpers.expectErrorResponse(response, 404, 'Event not found');
    });

    it('should handle admin registering other users', async () => {
      // This would require admin role implementation
      // For now, test with user_id in body
      const response = await request(app)
        .post(`/api/events/${testEvent.id}/register`)
        .set('Authorization', `Bearer ${testUser2.token}`)
        .send({ user_id: testUser2.id });

      testHelpers.expectSuccessResponse(response, 201);
    });
  });

  describe('DELETE /api/events/:id/register/:userId - Cancel Registration', () => {
    let testEvent;

    beforeEach(async () => {
      testEvent = await testHelpers.createTestEvent({
        title: 'Cancellation Test Event',
        capacity: 50
      }, testUser.id);

      await testHelpers.createRegistration(testUser2.id, testEvent.id);
    });

    it('should cancel own registration successfully', async () => {
      const response = await request(app)
        .delete(`/api/events/${testEvent.id}/register/${testUser2.id}`)
        .set('Authorization', `Bearer ${testUser2.token}`);

      testHelpers.expectSuccessResponse(response, 200);
      expect(response.body.message).toContain('cancelled successfully');

      // Verify registration is removed
      const checkResult = await testHelpers.query(
        'SELECT * FROM registrations WHERE user_id = $1 AND event_id = $2',
        [testUser2.id, testEvent.id]
      );
      expect(checkResult.rows).toHaveLength(0);
    });

    it('should prevent cancelling other user\'s registration', async () => {
      const response = await request(app)
        .delete(`/api/events/${testEvent.id}/register/${testUser2.id}`)
        .set('Authorization', `Bearer ${testUser.token}`); // Different user

      testHelpers.expectErrorResponse(response, 400, 'only cancel your own');
    });

    it('should return 404 for non-existent registration', async () => {
      const response = await request(app)
        .delete(`/api/events/${testEvent.id}/register/${testUser.id}`) // Not registered
        .set('Authorization', `Bearer ${testUser.token}`);

      testHelpers.expectErrorResponse(response, 404);
    });

    it('should prevent cancellation for past events', async () => {
      // Create past event with registration
      const pastEvent = await testHelpers.createTestEvent({
        title: 'Past Event',
        date_time: testHelpers.getPastDate(1),
        capacity: 50
      }, testUser.id);

      await testHelpers.createRegistration(testUser2.id, pastEvent.id);

      const response = await request(app)
        .delete(`/api/events/${pastEvent.id}/register/${testUser2.id}`)
        .set('Authorization', `Bearer ${testUser2.token}`);

      testHelpers.expectErrorResponse(response, 400, 'past events');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .delete(`/api/events/${testEvent.id}/register/${testUser2.id}`);

      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent event', async () => {
      const response = await request(app)
        .delete(`/api/events/99999/register/${testUser2.id}`)
        .set('Authorization', `Bearer ${testUser2.token}`);

      testHelpers.expectErrorResponse(response, 404, 'Event not found');
    });

    it('should handle invalid user ID format', async () => {
      const response = await request(app)
        .delete(`/api/events/${testEvent.id}/register/invalid`)
        .set('Authorization', `Bearer ${testUser2.token}`);

      testHelpers.expectErrorResponse(response, 400);
    });
  });

  describe('GET /api/events/upcoming - List Future Events', () => {
    beforeEach(async () => {
      // Create multiple test events
      await testHelpers.createMultipleEvents(5, {
        capacity: 100
      }, testUser.id);

      // Create events with different properties for filtering
      await testHelpers.createTestEvent({
        title: 'JavaScript Workshop',
        location: 'Tech Hub',
        capacity: 30,
        date_time: testHelpers.getFutureDate(1)
      }, testUser.id);

      await testHelpers.createTestEvent({
        title: 'Python Conference',
        location: 'Convention Center',
        capacity: 200,
        date_time: testHelpers.getFutureDate(3)
      }, testUser.id);
    });

    it('should list upcoming events with default pagination', async () => {
      const response = await request(app)
        .get('/api/events/upcoming');

      testHelpers.expectSuccessResponse(response, 200);
      expect(response.body.data.events).toHaveLength(7); // 5 + 2 created above
      expect(response.body.data.pagination).toHaveValidPagination();
      expect(response.body.data.pagination.current_page).toBe(1);
      expect(response.body.data.pagination.total_items).toBe(7);
    });

    it('should support search functionality', async () => {
      const response = await request(app)
        .get('/api/events/upcoming?search=JavaScript');

      testHelpers.expectSuccessResponse(response, 200);
      expect(response.body.data.events).toHaveLength(1);
      expect(response.body.data.events[0].title).toContain('JavaScript');
    });

    it('should support location filtering', async () => {
      const response = await request(app)
        .get('/api/events/upcoming?location=Tech Hub');

      testHelpers.expectSuccessResponse(response, 200);
      expect(response.body.data.events).toHaveLength(1);
      expect(response.body.data.events[0].location).toBe('Tech Hub');
    });

    it('should support capacity filtering', async () => {
      const response = await request(app)
        .get('/api/events/upcoming?min_capacity=150');

      testHelpers.expectSuccessResponse(response, 200);
      expect(response.body.data.events).toHaveLength(1);
      expect(response.body.data.events[0].capacity).toBeGreaterThanOrEqual(150);
    });

    it('should support custom sorting', async () => {
      const response = await request(app)
        .get('/api/events/upcoming?sort_by=capacity&sort_order=DESC');

      testHelpers.expectSuccessResponse(response, 200);
      const events = response.body.data.events;
      expect(events[0].capacity).toBeGreaterThanOrEqual(events[1].capacity);
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/api/events/upcoming?page=1&limit=3');

      testHelpers.expectSuccessResponse(response, 200);
      expect(response.body.data.events).toHaveLength(3);
      expect(response.body.data.pagination.current_page).toBe(1);
      expect(response.body.data.pagination.has_next_page).toBe(true);
    });

    it('should validate query parameters', async () => {
      const response = await request(app)
        .get('/api/events/upcoming?limit=101'); // Exceeds max

      testHelpers.expectErrorResponse(response, 400, 'between 1 and 100');
    });

    it('should handle date range filtering', async () => {
      const dateFrom = testHelpers.getFutureDate(2).toISOString();
      const dateTo = testHelpers.getFutureDate(4).toISOString();

      const response = await request(app)
        .get(`/api/events/upcoming?date_from=${dateFrom}&date_to=${dateTo}`);

      testHelpers.expectSuccessResponse(response, 200);
      // Should include Python Conference (day 3)
      expect(response.body.data.events.length).toBeGreaterThan(0);
    });

    it('should return empty results for no matches', async () => {
      const response = await request(app)
        .get('/api/events/upcoming?search=NonExistentEvent');

      testHelpers.expectSuccessResponse(response, 200);
      expect(response.body.data.events).toHaveLength(0);
      expect(response.body.data.pagination.total_items).toBe(0);
    });

    it('should include time calculations for each event', async () => {
      const response = await request(app)
        .get('/api/events/upcoming?limit=1');

      testHelpers.expectSuccessResponse(response, 200);
      const event = response.body.data.events[0];
      expect(event.time_until_event).toHaveProperty('days');
      expect(event.available_spots).toBeDefined();
      expect(event.is_full).toBeDefined();
    });
  });

  describe('GET /api/events/:id/stats - Get Event Statistics', () => {
    let testEvent;

    beforeEach(async () => {
      testEvent = await testHelpers.createTestEvent({
        title: 'Stats Test Event',
        capacity: 100
      }, testUser.id);

      // Create some registrations with different timestamps
      const users = await testHelpers.createMultipleUsers(5);
      for (let i = 0; i < users.length; i++) {
        await testHelpers.createRegistration(users[i].id, testEvent.id);
      }

      // Create some cancelled registrations
      const cancelledUser = await testHelpers.createTestUser({
        name: 'Cancelled User',
        email: 'cancelled@test.com'
      });
      await testHelpers.createRegistration(cancelledUser.id, testEvent.id, 'cancelled');
    });

    it('should return comprehensive event statistics', async () => {
      const response = await request(app)
        .get(`/api/events/${testEvent.id}/stats`);

      testHelpers.expectSuccessResponse(response, 200);

      const data = response.body.data;
      expect(data.event.id).toBe(testEvent.id);
      expect(data.statistics).toBeDefined();
      expect(data.statistics.confirmed_registrations).toBe(5);
      expect(data.statistics.cancelled_registrations).toBe(1);
      expect(data.statistics.registration_rate_percentage).toBe(5.0);
      expect(data.statistics.capacity_utilization).toBeDefined();
      expect(data.registration_timeline).toBeDefined();
      expect(data.status_breakdown).toBeDefined();
      expect(data.recent_registrations).toBeDefined();
      expect(data.generated_at).toBeDefined();
    });

    it('should return 404 for non-existent event', async () => {
      const response = await request(app)
        .get('/api/events/99999/stats');

      testHelpers.expectErrorResponse(response, 404, 'Event not found');
    });

    it('should include time calculations', async () => {
      const response = await request(app)
        .get(`/api/events/${testEvent.id}/stats`);

      testHelpers.expectSuccessResponse(response, 200);

      const stats = response.body.data.statistics;
      expect(stats.time_until_event).toBeDefined();
      expect(stats.is_event_soon).toBeDefined();
      expect(stats.capacity_utilization.percentage_full).toBe(5.0);
    });

    it('should work without authentication', async () => {
      const response = await request(app)
        .get(`/api/events/${testEvent.id}/stats`);

      testHelpers.expectSuccessResponse(response, 200);
    });

    it('should handle events with no registrations', async () => {
      const emptyEvent = await testHelpers.createTestEvent({
        title: 'Empty Event',
        capacity: 50
      }, testUser.id);

      const response = await request(app)
        .get(`/api/events/${emptyEvent.id}/stats`);

      testHelpers.expectSuccessResponse(response, 200);

      const stats = response.body.data.statistics;
      expect(stats.confirmed_registrations).toBe(0);
      expect(stats.registration_rate_percentage).toBe(0);
      expect(stats.capacity_utilization.percentage_full).toBe(0);
    });

    it('should include registration timeline', async () => {
      const response = await request(app)
        .get(`/api/events/${testEvent.id}/stats`);

      testHelpers.expectSuccessResponse(response, 200);

      const timeline = response.body.data.registration_timeline;
      expect(Array.isArray(timeline)).toBe(true);
      // Should have at least one entry for the registrations we created
      expect(timeline.length).toBeGreaterThan(0);
    });

    it('should include status breakdown', async () => {
      const response = await request(app)
        .get(`/api/events/${testEvent.id}/stats`);

      testHelpers.expectSuccessResponse(response, 200);

      const breakdown = response.body.data.status_breakdown;
      expect(Array.isArray(breakdown)).toBe(true);

      const confirmedEntry = breakdown.find(entry => entry.status === 'confirmed');
      const cancelledEntry = breakdown.find(entry => entry.status === 'cancelled');

      expect(confirmedEntry.count).toBe(5);
      expect(cancelledEntry.count).toBe(1);
    });
  });
});
