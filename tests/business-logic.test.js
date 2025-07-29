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

describe('Business Logic Tests', () => {
  let users;

  beforeEach(async () => {
    users = await createTestUsers();
  });

  describe('Event Capacity Management', () => {
    it('should enforce capacity limit of 1000', async () => {
      const response = await authenticatedRequest(users.user1.token)
        .post('/api/events')
        .send({
          ...testEvents.event1,
          capacity: 1001
        });

      expectValidationError(response, 'Capacity must be a positive integer between 1 and 1000');
    });

    it('should not allow capacity of 0', async () => {
      const response = await authenticatedRequest(users.user1.token)
        .post('/api/events')
        .send({
          ...testEvents.event1,
          capacity: 0
        });

      expectValidationError(response, 'Capacity must be a positive integer between 1 and 1000');
    });

    it('should not allow negative capacity', async () => {
      const response = await authenticatedRequest(users.user1.token)
        .post('/api/events')
        .send({
          ...testEvents.event1,
          capacity: -5
        });

      expectValidationError(response, 'Capacity must be a positive integer between 1 and 1000');
    });

    it('should prevent reducing capacity below current registrations', async () => {
      // Create event with capacity 10
      const event = await createTestEvent({
        ...testEvents.event1,
        capacity: 10
      }, users.user1.user.id);

      // Register 5 users
      for (let i = 0; i < 5; i++) {
        const user = await createTestUser({
          ...testUsers.user1,
          email: `test${i}@example.com`,
          username: `testuser${i}`
        });
        
        await authenticatedRequest(user.token)
          .post(`/api/events/${event.id}/register`);
      }

      // Try to reduce capacity to 3 (should fail)
      const response = await authenticatedRequest(users.user1.token)
        .put(`/api/events/${event.id}`)
        .send({ capacity: 3 });

      expectError(response, 400, 'Cannot reduce capacity below current registrations');
    });
  });

  describe('Event Registration Business Rules', () => {
    let event;

    beforeEach(async () => {
      event = await createTestEvent({
        ...testEvents.event1,
        capacity: 2
      }, users.user1.user.id);
    });

    it('should prevent duplicate registrations', async () => {
      // First registration
      await authenticatedRequest(users.user2.token)
        .post(`/api/events/${event.id}/register`);

      // Second registration should fail
      const response = await authenticatedRequest(users.user2.token)
        .post(`/api/events/${event.id}/register`);

      expectError(response, 409, 'User is already registered for this event');
    });

    it('should prevent registration when event is at capacity', async () => {
      // Fill the event to capacity
      await authenticatedRequest(users.user2.token)
        .post(`/api/events/${event.id}/register`);
      
      await authenticatedRequest(users.admin.token)
        .post(`/api/events/${event.id}/register`);

      // Try to register another user
      const newUser = await createTestUser({
        ...testUsers.user1,
        email: 'overflow@example.com',
        username: 'overflow'
      });

      const response = await authenticatedRequest(newUser.token)
        .post(`/api/events/${event.id}/register`);

      expectError(response, 400, 'Event is at full capacity');
    });

    it('should prevent registration for past events', async () => {
      // Create past event
      const pastEvent = await createTestEvent({
        ...testEvents.event1,
        start_date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Yesterday
        end_date: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString()
      }, users.user1.user.id);

      const response = await authenticatedRequest(users.user2.token)
        .post(`/api/events/${pastEvent.id}/register`);

      expectError(response, 400, 'Cannot register for an event that has already started');
    });

    it('should prevent unregistration for past events', async () => {
      // Register user first
      await authenticatedRequest(users.user2.token)
        .post(`/api/events/${event.id}/register`);

      // Create past event and try to unregister
      const pastEvent = await createTestEvent({
        ...testEvents.event1,
        start_date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        end_date: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString()
      }, users.user1.user.id);

      // Register for past event (this should work for testing)
      // In real scenario, this wouldn't be possible
      
      const response = await authenticatedRequest(users.user2.token)
        .delete(`/api/events/${pastEvent.id}/unregister`);

      expectError(response, 400, 'Cannot unregister from an event that has already started');
    });

    it('should prevent unregistration if not registered', async () => {
      const response = await authenticatedRequest(users.user2.token)
        .delete(`/api/events/${event.id}/unregister`);

      expectError(response, 400, 'User is not registered for this event');
    });
  });

  describe('Date Validation', () => {
    it('should prevent creating events with end date before start date', async () => {
      const response = await authenticatedRequest(users.user1.token)
        .post('/api/events')
        .send({
          ...testEvents.event1,
          start_date: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
          end_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // Earlier than start
        });

      expectValidationError(response, 'End date must be after start date');
    });

    it('should prevent creating events in the past', async () => {
      const response = await authenticatedRequest(users.user1.token)
        .post('/api/events')
        .send({
          ...testEvents.event1,
          start_date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Yesterday
          end_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        });

      expectValidationError(response, 'Start date must be in the future');
    });
  });

  describe('Authorization Rules', () => {
    let event;

    beforeEach(async () => {
      event = await createTestEvent(testEvents.event1, users.user1.user.id);
    });

    it('should only allow event owner to update event', async () => {
      const response = await authenticatedRequest(users.user2.token)
        .put(`/api/events/${event.id}`)
        .send({ title: 'Hacked Title' });

      expectError(response, 403, 'You can only modify your own events');
    });

    it('should only allow event owner to delete event', async () => {
      const response = await authenticatedRequest(users.user2.token)
        .delete(`/api/events/${event.id}`);

      expectError(response, 403, 'You can only modify your own events');
    });

    it('should only allow event owner to view registrations', async () => {
      const response = await authenticatedRequest(users.user2.token)
        .get(`/api/events/${event.id}/registrations`);

      expectError(response, 403, 'You can only view registrations for your own events');
    });
  });

  describe('Input Validation Edge Cases', () => {
    it('should handle extremely long event titles', async () => {
      const longTitle = 'A'.repeat(256); // Exceeds 255 char limit

      const response = await authenticatedRequest(users.user1.token)
        .post('/api/events')
        .send({
          ...testEvents.event1,
          title: longTitle
        });

      expectValidationError(response, 'title');
    });

    it('should handle extremely long descriptions', async () => {
      const longDescription = 'A'.repeat(5001); // Exceeds 5000 char limit

      const response = await authenticatedRequest(users.user1.token)
        .post('/api/events')
        .send({
          ...testEvents.event1,
          description: longDescription
        });

      expectValidationError(response, 'Description must be less than 5000 characters');
    });

    it('should handle invalid date formats', async () => {
      const response = await authenticatedRequest(users.user1.token)
        .post('/api/events')
        .send({
          ...testEvents.event1,
          start_date: 'invalid-date'
        });

      expectValidationError(response, 'Start date must be a valid ISO 8601 date');
    });
  });

  describe('Concurrent Registration Scenarios', () => {
    it('should handle concurrent registrations gracefully', async () => {
      const event = await createTestEvent({
        ...testEvents.event1,
        capacity: 1 // Only one spot
      }, users.user1.user.id);

      // Create multiple users
      const user1 = await createTestUser({
        ...testUsers.user1,
        email: 'concurrent1@example.com',
        username: 'concurrent1'
      });

      const user2 = await createTestUser({
        ...testUsers.user1,
        email: 'concurrent2@example.com',
        username: 'concurrent2'
      });

      // Try to register both users simultaneously
      const [response1, response2] = await Promise.allSettled([
        authenticatedRequest(user1.token).post(`/api/events/${event.id}/register`),
        authenticatedRequest(user2.token).post(`/api/events/${event.id}/register`)
      ]);

      // One should succeed, one should fail
      const responses = [response1, response2].map(r => r.value || r.reason);
      const successCount = responses.filter(r => r.status === 201).length;
      const failureCount = responses.filter(r => r.status === 400).length;

      expect(successCount).toBe(1);
      expect(failureCount).toBe(1);
    });
  });
});
