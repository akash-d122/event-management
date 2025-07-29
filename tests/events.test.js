const request = require('supertest');
const app = require('../src/app');
const {
  testUsers,
  testEvents,
  createTestUser,
  createTestUsers,
  createTestEvent,
  authenticatedRequest,
  expectError,
  expectSuccess,
  expectValidationError
} = require('./utils/testHelpers');

require('./setup');

describe('Events', () => {
  let users;

  beforeEach(async () => {
    users = await createTestUsers();
  });

  describe('GET /api/events', () => {
    beforeEach(async () => {
      await createTestEvent(testEvents.event1, users.user1.user.id);
      await createTestEvent(testEvents.event2, users.user2.user.id);
    });

    it('should get all events without authentication', async () => {
      const response = await request(app)
        .get('/api/events');

      expectSuccess(response);
      expect(response.body.results).toBe(2);
      expect(response.body.data.events).toHaveLength(2);
      expect(response.body.pagination).toBeDefined();
    });

    it('should get events with pagination', async () => {
      const response = await request(app)
        .get('/api/events?page=1&limit=1');

      expectSuccess(response);
      expect(response.body.results).toBe(1);
      expect(response.body.pagination.currentPage).toBe(1);
      expect(response.body.pagination.totalPages).toBe(2);
    });

    it('should search events by title', async () => {
      const response = await request(app)
        .get('/api/events?search=Test Event 1');

      expectSuccess(response);
      expect(response.body.results).toBe(1);
      expect(response.body.data.events[0].title).toContain('Test Event 1');
    });

    it('should sort events by start_date', async () => {
      const response = await request(app)
        .get('/api/events?sortBy=start_date&sortOrder=ASC');

      expectSuccess(response);
      expect(response.body.data.events).toHaveLength(2);
      // First event should have earlier start date
      expect(new Date(response.body.data.events[0].start_date))
        .toBeLessThan(new Date(response.body.data.events[1].start_date));
    });
  });

  describe('GET /api/events/:id', () => {
    let event;

    beforeEach(async () => {
      event = await createTestEvent(testEvents.event1, users.user1.user.id);
    });

    it('should get single event without authentication', async () => {
      const response = await request(app)
        .get(`/api/events/${event.id}`);

      expectSuccess(response);
      expect(response.body.data.event.id).toBe(event.id);
      expect(response.body.data.event.title).toBe(event.title);
    });

    it('should get event with additional info when authenticated', async () => {
      const response = await authenticatedRequest(users.user1.token)
        .get(`/api/events/${event.id}`);

      expectSuccess(response);
      expect(response.body.data.event.isUserRegistered).toBeDefined();
      expect(response.body.data.event.isOwner).toBe(true);
    });

    it('should return 404 for non-existent event', async () => {
      const response = await request(app)
        .get('/api/events/99999');

      expectError(response, 404, 'Event not found');
    });

    it('should return 400 for invalid event ID', async () => {
      const response = await request(app)
        .get('/api/events/invalid');

      expectValidationError(response, 'ID');
    });
  });

  describe('POST /api/events', () => {
    it('should create event with valid data', async () => {
      const response = await authenticatedRequest(users.user1.token)
        .post('/api/events')
        .send(testEvents.event1);

      expectSuccess(response, 201);
      expect(response.body.data.event.title).toBe(testEvents.event1.title);
      expect(response.body.data.event.created_by).toBe(users.user1.user.id);
    });

    it('should not create event without authentication', async () => {
      const response = await request(app)
        .post('/api/events')
        .send(testEvents.event1);

      expectError(response, 401, 'not logged in');
    });

    it('should not create event with invalid data', async () => {
      const response = await authenticatedRequest(users.user1.token)
        .post('/api/events')
        .send({
          ...testEvents.event1,
          title: '', // Invalid empty title
        });

      expectValidationError(response, 'title');
    });

    it('should not create event with past start date', async () => {
      const response = await authenticatedRequest(users.user1.token)
        .post('/api/events')
        .send({
          ...testEvents.event1,
          start_date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Yesterday
        });

      expectValidationError(response, 'future');
    });

    it('should not create event with end date before start date', async () => {
      const startDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const endDate = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(); // Earlier than start

      const response = await authenticatedRequest(users.user1.token)
        .post('/api/events')
        .send({
          ...testEvents.event1,
          start_date: startDate,
          end_date: endDate
        });

      expectValidationError(response, 'after start date');
    });
  });

  describe('PUT /api/events/:id', () => {
    let event;

    beforeEach(async () => {
      event = await createTestEvent(testEvents.event1, users.user1.user.id);
    });

    it('should update own event successfully', async () => {
      const updateData = {
        title: 'Updated Event Title',
        capacity: 100
      };

      const response = await authenticatedRequest(users.user1.token)
        .put(`/api/events/${event.id}`)
        .send(updateData);

      expectSuccess(response);
      expect(response.body.data.event.title).toBe(updateData.title);
      expect(response.body.data.event.capacity).toBe(updateData.capacity);
    });

    it('should not update other user\'s event', async () => {
      const response = await authenticatedRequest(users.user2.token)
        .put(`/api/events/${event.id}`)
        .send({ title: 'Hacked Title' });

      expectError(response, 403, 'only modify your own events');
    });

    it('should not update event without authentication', async () => {
      const response = await request(app)
        .put(`/api/events/${event.id}`)
        .send({ title: 'Updated Title' });

      expectError(response, 401, 'not logged in');
    });
  });

  describe('DELETE /api/events/:id', () => {
    let event;

    beforeEach(async () => {
      event = await createTestEvent(testEvents.event1, users.user1.user.id);
    });

    it('should delete own event successfully', async () => {
      const response = await authenticatedRequest(users.user1.token)
        .delete(`/api/events/${event.id}`);

      expect(response.status).toBe(204);
    });

    it('should not delete other user\'s event', async () => {
      const response = await authenticatedRequest(users.user2.token)
        .delete(`/api/events/${event.id}`);

      expectError(response, 403, 'only modify your own events');
    });

    it('should not delete event without authentication', async () => {
      const response = await request(app)
        .delete(`/api/events/${event.id}`);

      expectError(response, 401, 'not logged in');
    });
  });

  describe('POST /api/events/:id/register', () => {
    let event;

    beforeEach(async () => {
      event = await createTestEvent(testEvents.event1, users.user1.user.id);
    });

    it('should register for event successfully', async () => {
      const response = await authenticatedRequest(users.user2.token)
        .post(`/api/events/${event.id}/register`);

      expectSuccess(response, 201);
      expect(response.body.message).toContain('Successfully registered');
      expect(response.body.data.event.current_registrations).toBe(1);
    });

    it('should not register for same event twice', async () => {
      // First registration
      await authenticatedRequest(users.user2.token)
        .post(`/api/events/${event.id}/register`);

      // Second registration should fail
      const response = await authenticatedRequest(users.user2.token)
        .post(`/api/events/${event.id}/register`);

      expectError(response, 400, 'already registered');
    });

    it('should not register without authentication', async () => {
      const response = await request(app)
        .post(`/api/events/${event.id}/register`);

      expectError(response, 401, 'not logged in');
    });
  });

  describe('DELETE /api/events/:id/unregister', () => {
    let event;

    beforeEach(async () => {
      event = await createTestEvent(testEvents.event1, users.user1.user.id);
      // Register user2 for the event
      await authenticatedRequest(users.user2.token)
        .post(`/api/events/${event.id}/register`);
    });

    it('should unregister from event successfully', async () => {
      const response = await authenticatedRequest(users.user2.token)
        .delete(`/api/events/${event.id}/unregister`);

      expectSuccess(response);
      expect(response.body.message).toContain('Successfully unregistered');
      expect(response.body.data.event.current_registrations).toBe(0);
    });

    it('should not unregister if not registered', async () => {
      const response = await authenticatedRequest(users.admin.token)
        .delete(`/api/events/${event.id}/unregister`);

      expectError(response, 400, 'not registered');
    });

    it('should not unregister without authentication', async () => {
      const response = await request(app)
        .delete(`/api/events/${event.id}/unregister`);

      expectError(response, 401, 'not logged in');
    });
  });
});
