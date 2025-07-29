const request = require('supertest');
const app = require('../../src/app');
const testHelpers = require('../utils/testHelpers');

describe('Business Logic Constraints Edge Cases', () => {
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
    
    testUser = await testHelpers.createTestUser({
      name: 'Test User',
      email: 'test@example.com'
    });
    
    testUser2 = await testHelpers.createTestUser({
      name: 'Test User 2',
      email: 'test2@example.com'
    });
  });

  describe('Full Event Scenarios', () => {
    it('should handle event at exact capacity', async () => {
      const event = await testHelpers.createTestEvent({
        title: 'Capacity Test Event',
        capacity: 2
      }, testUser.id);

      // Fill to exact capacity
      const users = await testHelpers.createMultipleUsers(2);
      
      for (const user of users) {
        const response = await request(app)
          .post(`/api/events/${event.id}/register`)
          .set('Authorization', `Bearer ${user.token}`);
        
        expect(response.status).toBe(201);
      }

      // Verify event is full
      const eventDetails = await request(app)
        .get(`/api/events/${event.id}`);

      expect(eventDetails.body.data.event.is_full).toBe(true);
      expect(eventDetails.body.data.event.available_spots).toBe(0);

      // Try to register one more user
      const response = await request(app)
        .post(`/api/events/${event.id}/register`)
        .set('Authorization', `Bearer ${testUser2.token}`);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('maximum capacity');
    });

    it('should handle capacity of 1 (minimum capacity)', async () => {
      const event = await testHelpers.createTestEvent({
        title: 'Single Capacity Event',
        capacity: 1
      }, testUser.id);

      // First registration should succeed
      const response1 = await request(app)
        .post(`/api/events/${event.id}/register`)
        .set('Authorization', `Bearer ${testUser2.token}`);

      expect(response1.status).toBe(201);
      expect(response1.body.data.event.available_spots).toBe(0);

      // Second registration should fail
      const anotherUser = await testHelpers.createTestUser({
        name: 'Another User',
        email: 'another@test.com'
      });

      const response2 = await request(app)
        .post(`/api/events/${event.id}/register`)
        .set('Authorization', `Bearer ${anotherUser.token}`);

      expect(response2.status).toBe(400);
      expect(response2.body.message).toContain('maximum capacity');
    });

    it('should handle capacity of 10000 (maximum capacity)', async () => {
      const event = await testHelpers.createTestEvent({
        title: 'Maximum Capacity Event',
        capacity: 10000
      }, testUser.id);

      // Register one user
      const response = await request(app)
        .post(`/api/events/${event.id}/register`)
        .set('Authorization', `Bearer ${testUser2.token}`);

      expect(response.status).toBe(201);
      expect(response.body.data.event.available_spots).toBe(9999);
      expect(response.body.data.event.capacity).toBe(10000);
    });

    it('should handle registration when event becomes full during registration', async () => {
      const event = await testHelpers.createTestEvent({
        title: 'Race Condition Event',
        capacity: 1
      }, testUser.id);

      // Fill event to capacity using direct database operation
      await testHelpers.createRegistration(testUser2.id, event.id);

      // Try to register another user (should fail)
      const anotherUser = await testHelpers.createTestUser({
        name: 'Late User',
        email: 'late@test.com'
      });

      const response = await request(app)
        .post(`/api/events/${event.id}/register`)
        .set('Authorization', `Bearer ${anotherUser.token}`);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('maximum capacity');
    });
  });

  describe('Past Event Scenarios', () => {
    it('should prevent registration for events that just passed', async () => {
      const event = await testHelpers.createTestEvent({
        title: 'Just Passed Event',
        date_time: new Date(Date.now() - 1000), // 1 second ago
        capacity: 50
      }, testUser.id);

      const response = await request(app)
        .post(`/api/events/${event.id}/register`)
        .set('Authorization', `Bearer ${testUser2.token}`);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('past events');
    });

    it('should prevent cancellation for events that just started', async () => {
      const event = await testHelpers.createTestEvent({
        title: 'Just Started Event',
        date_time: new Date(Date.now() - 1000), // 1 second ago
        capacity: 50
      }, testUser.id);

      // Create registration directly in database (simulating past registration)
      await testHelpers.createRegistration(testUser2.id, event.id);

      const response = await request(app)
        .delete(`/api/events/${event.id}/register/${testUser2.id}`)
        .set('Authorization', `Bearer ${testUser2.token}`);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('past events');
    });

    it('should handle events scheduled far in the past', async () => {
      const event = await testHelpers.createTestEvent({
        title: 'Ancient Event',
        date_time: testHelpers.getPastDate(365), // 1 year ago
        capacity: 50
      }, testUser.id);

      const response = await request(app)
        .post(`/api/events/${event.id}/register`)
        .set('Authorization', `Bearer ${testUser2.token}`);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('past events');
    });

    it('should still allow viewing details of past events', async () => {
      const event = await testHelpers.createTestEvent({
        title: 'Past Event Details',
        date_time: testHelpers.getPastDate(1),
        capacity: 50
      }, testUser.id);

      const response = await request(app)
        .get(`/api/events/${event.id}`);

      expect(response.status).toBe(200);
      expect(response.body.data.event.has_started).toBe(true);
    });

    it('should still allow viewing stats of past events', async () => {
      const event = await testHelpers.createTestEvent({
        title: 'Past Event Stats',
        date_time: testHelpers.getPastDate(1),
        capacity: 50
      }, testUser.id);

      const response = await request(app)
        .get(`/api/events/${event.id}/stats`);

      expect(response.status).toBe(200);
      expect(response.body.data.statistics.is_event_soon).toBe(false);
    });
  });

  describe('Duplicate Registration Scenarios', () => {
    let event;

    beforeEach(async () => {
      event = await testHelpers.createTestEvent({
        title: 'Duplicate Test Event',
        capacity: 50
      }, testUser.id);
    });

    it('should prevent immediate duplicate registration', async () => {
      // First registration
      const response1 = await request(app)
        .post(`/api/events/${event.id}/register`)
        .set('Authorization', `Bearer ${testUser2.token}`);

      expect(response1.status).toBe(201);

      // Immediate duplicate attempt
      const response2 = await request(app)
        .post(`/api/events/${event.id}/register`)
        .set('Authorization', `Bearer ${testUser2.token}`);

      expect(response2.status).toBe(409);
      expect(response2.body.message).toContain('already registered');
    });

    it('should prevent duplicate registration after delay', async () => {
      // First registration
      await request(app)
        .post(`/api/events/${event.id}/register`)
        .set('Authorization', `Bearer ${testUser2.token}`);

      // Wait a bit (simulate delay)
      await new Promise(resolve => setTimeout(resolve, 100));

      // Second registration attempt
      const response = await request(app)
        .post(`/api/events/${event.id}/register`)
        .set('Authorization', `Bearer ${testUser2.token}`);

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('already registered');
    });

    it('should handle registration after cancellation', async () => {
      // Register
      await request(app)
        .post(`/api/events/${event.id}/register`)
        .set('Authorization', `Bearer ${testUser2.token}`);

      // Cancel
      await request(app)
        .delete(`/api/events/${event.id}/register/${testUser2.id}`)
        .set('Authorization', `Bearer ${testUser2.token}`);

      // Register again (should succeed)
      const response = await request(app)
        .post(`/api/events/${event.id}/register`)
        .set('Authorization', `Bearer ${testUser2.token}`);

      expect(response.status).toBe(201);
    });

    it('should handle multiple users with similar registration patterns', async () => {
      const users = await testHelpers.createMultipleUsers(3);

      // All users register simultaneously
      const registrationPromises = users.map(user =>
        request(app)
          .post(`/api/events/${event.id}/register`)
          .set('Authorization', `Bearer ${user.token}`)
      );

      const responses = await Promise.all(registrationPromises);

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(201);
      });

      // Try duplicate registrations
      const duplicatePromises = users.map(user =>
        request(app)
          .post(`/api/events/${event.id}/register`)
          .set('Authorization', `Bearer ${user.token}`)
      );

      const duplicateResponses = await Promise.all(duplicatePromises);

      // All should fail with conflict
      duplicateResponses.forEach(response => {
        expect(response.status).toBe(409);
      });
    });
  });

  describe('Boundary Value Testing', () => {
    it('should handle event scheduled exactly 1 hour in future', async () => {
      const exactlyOneHour = new Date(Date.now() + 60 * 60 * 1000 + 1000); // 1 hour + 1 second

      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          title: 'Boundary Time Event',
          date_time: exactlyOneHour.toISOString(),
          capacity: 50
        });

      expect(response.status).toBe(201);
    });

    it('should reject event scheduled less than 1 hour in future', async () => {
      const lessThanOneHour = new Date(Date.now() + 59 * 60 * 1000); // 59 minutes

      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          title: 'Too Soon Event',
          date_time: lessThanOneHour.toISOString(),
          capacity: 50
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('at least 1 hour in the future');
    });

    it('should handle event scheduled exactly 1 year in future', async () => {
      const exactlyOneYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000 - 1000); // 1 year - 1 second

      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          title: 'Far Future Event',
          date_time: exactlyOneYear.toISOString(),
          capacity: 50
        });

      expect(response.status).toBe(201);
    });

    it('should reject event scheduled more than 1 year in future', async () => {
      const moreThanOneYear = new Date(Date.now() + 366 * 24 * 60 * 60 * 1000); // Over 1 year

      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          title: 'Too Far Event',
          date_time: moreThanOneYear.toISOString(),
          capacity: 50
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('more than 1 year in the future');
    });

    it('should handle title with exactly 500 characters', async () => {
      const maxTitle = 'A'.repeat(500);

      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          title: maxTitle,
          date_time: testHelpers.getFutureDate(7).toISOString(),
          capacity: 50
        });

      expect(response.status).toBe(201);
      expect(response.body.data.event.title).toBe(maxTitle);
    });

    it('should reject title with 501 characters', async () => {
      const tooLongTitle = 'A'.repeat(501);

      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          title: tooLongTitle,
          date_time: testHelpers.getFutureDate(7).toISOString(),
          capacity: 50
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('between 1 and 500 characters');
    });

    it('should handle description with exactly 10000 characters', async () => {
      const maxDescription = 'A'.repeat(10000);

      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          title: 'Max Description Event',
          description: maxDescription,
          date_time: testHelpers.getFutureDate(7).toISOString(),
          capacity: 50
        });

      expect(response.status).toBe(201);
      expect(response.body.data.event.description).toBe(maxDescription);
    });

    it('should reject description with 10001 characters', async () => {
      const tooLongDescription = 'A'.repeat(10001);

      const response = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          title: 'Too Long Description Event',
          description: tooLongDescription,
          date_time: testHelpers.getFutureDate(7).toISOString(),
          capacity: 50
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('less than 10000 characters');
    });
  });

  describe('Data Consistency Edge Cases', () => {
    it('should maintain consistency when event is deleted with registrations', async () => {
      const event = await testHelpers.createTestEvent({
        title: 'To Be Deleted Event',
        capacity: 50
      }, testUser.id);

      // Register some users
      const users = await testHelpers.createMultipleUsers(3);
      for (const user of users) {
        await testHelpers.createRegistration(user.id, event.id);
      }

      // Delete event (cascade should remove registrations)
      await testHelpers.query('DELETE FROM events WHERE id = $1', [event.id]);

      // Verify registrations are also deleted
      const remainingRegistrations = await testHelpers.query(
        'SELECT * FROM registrations WHERE event_id = $1',
        [event.id]
      );

      expect(remainingRegistrations.rows).toHaveLength(0);
    });

    it('should maintain consistency when user is deleted with registrations', async () => {
      const event = await testHelpers.createTestEvent({
        title: 'User Deletion Test Event',
        capacity: 50
      }, testUser.id);

      // Register user
      await testHelpers.createRegistration(testUser2.id, event.id);

      // Delete user (cascade should remove registrations)
      await testHelpers.query('DELETE FROM users WHERE id = $1', [testUser2.id]);

      // Verify registrations are also deleted
      const remainingRegistrations = await testHelpers.query(
        'SELECT * FROM registrations WHERE user_id = $1',
        [testUser2.id]
      );

      expect(remainingRegistrations.rows).toHaveLength(0);

      // Verify event registration count is updated
      const consistency = await testHelpers.verifyDatabaseConsistency(event.id);
      expect(consistency.isConsistent).toBe(true);
    });
  });
});
