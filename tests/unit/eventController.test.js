const request = require('supertest');
const app = require('../../src/app');
const testHelpers = require('../utils/testHelpers');

describe('Event API - 6 Required Endpoints', () => {
  let organizer;
  let attendee;

  beforeAll(async () => {
    await testHelpers.initialize();
  });

  afterAll(async () => {
    await testHelpers.cleanup();
  });

  beforeEach(async () => {
    await testHelpers.cleanDatabase();

    // Create test users
    organizer = await testHelpers.createTestUser({
      name: 'Event Organizer',
      email: 'organizer@test.com'
    });

    attendee = await testHelpers.createTestUser({
      name: 'Event Attendee',
      email: 'attendee@test.com'
    });
  });

  describe('1. POST /api/events - Create Event', () => {
    it('should create event with valid data', async () => {
      const eventData = {
        title: 'Tech Conference 2024',
        description: 'Annual technology conference',
        date_time: testHelpers.getFutureDate(7).toISOString(),
        location: 'Convention Center',
        capacity: 500
      };

      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${organizer.token}`)
        .send(eventData);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.event.title).toBe(eventData.title);
      expect(response.body.data.event.capacity).toBe(eventData.capacity);
    });

    it('should reject event with capacity over 1000', async () => {
      const eventData = {
        title: 'Large Event',
        date_time: testHelpers.getFutureDate(7).toISOString(),
        capacity: 1500
      };

      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${organizer.token}`)
        .send(eventData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

  });

  describe('2. GET /api/events/:id - Get Event Details', () => {
    let testEvent;

    beforeEach(async () => {
      testEvent = await testHelpers.createTestEvent({
        title: 'Test Event Details',
        capacity: 50
      }, organizer.id);
    });

    it('should get event details', async () => {
      const response = await request(app)
        .get(`/api/events/${testEvent.id}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.event.title).toBe(testEvent.title);
      expect(response.body.data.event.capacity).toBe(testEvent.capacity);
    });

    it('should return 404 for non-existent event', async () => {
      const response = await request(app)
        .get('/api/events/99999');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  describe('3. POST /api/events/:id/register - Register for Event', () => {
    let testEvent;

    beforeEach(async () => {
      testEvent = await testHelpers.createTestEvent({
        title: 'Registration Test Event',
        capacity: 5
      }, organizer.id);
    });

    it('should register user for event', async () => {
      const response = await request(app)
        .post(`/api/events/${testEvent.id}/register`)
        .set('Authorization', `Bearer ${attendee.token}`);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it('should prevent duplicate registration', async () => {
      // First registration
      await request(app)
        .post(`/api/events/${testEvent.id}/register`)
        .set('Authorization', `Bearer ${attendee.token}`);

      // Second registration attempt
      const response = await request(app)
        .post(`/api/events/${testEvent.id}/register`)
        .set('Authorization', `Bearer ${attendee.token}`);

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
    });
  });

  describe('4. DELETE /api/events/:id/register/:userId - Cancel Registration', () => {
    let testEvent;

    beforeEach(async () => {
      testEvent = await testHelpers.createTestEvent({
        title: 'Cancellation Test Event',
        capacity: 50
      }, organizer.id);

      await testHelpers.createRegistration(attendee.id, testEvent.id);
    });

    it('should cancel registration', async () => {
      const response = await request(app)
        .delete(`/api/events/${testEvent.id}/register/${attendee.id}`)
        .set('Authorization', `Bearer ${attendee.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 404 for non-existent registration', async () => {
      const response = await request(app)
        .delete(`/api/events/${testEvent.id}/register/${organizer.id}`)
        .set('Authorization', `Bearer ${organizer.token}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  describe('5. GET /api/events/upcoming - List Future Events', () => {
    beforeEach(async () => {
      // Create test events
      await testHelpers.createTestEvent({
        title: 'JavaScript Workshop',
        location: 'Tech Hub',
        capacity: 30,
        date_time: testHelpers.getFutureDate(1)
      }, organizer.id);

      await testHelpers.createTestEvent({
        title: 'Python Conference',
        location: 'Convention Center',
        capacity: 200,
        date_time: testHelpers.getFutureDate(3)
      }, organizer.id);
    });

    it('should list upcoming events sorted by date then location', async () => {
      const response = await request(app)
        .get('/api/events/upcoming');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.events).toHaveLength(2);

      // Should be sorted by date first
      const events = response.body.data.events;
      expect(new Date(events[0].date_time).getTime()).toBeLessThan(new Date(events[1].date_time).getTime());
    });
  });

  describe('6. GET /api/events/:id/stats - Get Event Statistics', () => {
    let testEvent;

    beforeEach(async () => {
      testEvent = await testHelpers.createTestEvent({
        title: 'Stats Test Event',
        capacity: 100
      }, organizer.id);

      // Create some registrations
      await testHelpers.createRegistration(attendee.id, testEvent.id);
    });

    it('should return event statistics', async () => {
      const response = await request(app)
        .get(`/api/events/${testEvent.id}/stats`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.statistics).toBeDefined();
      expect(response.body.data.statistics.total_registrations).toBe(1);
      expect(response.body.data.statistics.remaining_capacity).toBe(99);
      expect(response.body.data.statistics.percentage_used).toBe(1.0);
    });

    it('should return 404 for non-existent event', async () => {
      const response = await request(app)
        .get('/api/events/99999/stats');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });
});
