const request = require('supertest');
const app = require('../../src/app');
const testHelpers = require('../utils/testHelpers');

describe('User Registration Flow Integration Tests', () => {
  let organizer;
  let attendee1;
  let attendee2;
  let attendee3;

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
    
    attendee1 = await testHelpers.createTestUser({
      name: 'Attendee One',
      email: 'attendee1@test.com'
    });
    
    attendee2 = await testHelpers.createTestUser({
      name: 'Attendee Two',
      email: 'attendee2@test.com'
    });
    
    attendee3 = await testHelpers.createTestUser({
      name: 'Attendee Three',
      email: 'attendee3@test.com'
    });
  });

  describe('Complete Registration Workflow', () => {
    it('should handle complete event lifecycle with registrations', async () => {
      // Step 1: Organizer creates an event
      const createEventResponse = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${organizer.token}`)
        .send({
          title: 'Integration Test Conference',
          description: 'A comprehensive test of the registration flow',
          date_time: testHelpers.getFutureDate(14).toISOString(),
          location: 'Test Convention Center',
          capacity: 3
        });

      expect(createEventResponse.status).toBe(201);
      const eventId = createEventResponse.body.data.event.id;

      // Step 2: Verify event appears in upcoming events
      const upcomingResponse = await request(app)
        .get('/api/events/upcoming');

      expect(upcomingResponse.status).toBe(200);
      expect(upcomingResponse.body.data.events).toHaveLength(1);
      expect(upcomingResponse.body.data.events[0].id).toBe(eventId);

      // Step 3: First attendee registers
      const registration1Response = await request(app)
        .post(`/api/events/${eventId}/register`)
        .set('Authorization', `Bearer ${attendee1.token}`);

      expect(registration1Response.status).toBe(201);
      expect(registration1Response.body.data.event.available_spots).toBe(2);

      // Step 4: Second attendee registers
      const registration2Response = await request(app)
        .post(`/api/events/${eventId}/register`)
        .set('Authorization', `Bearer ${attendee2.token}`);

      expect(registration2Response.status).toBe(201);
      expect(registration2Response.body.data.event.available_spots).toBe(1);

      // Step 5: Third attendee registers (fills capacity)
      const registration3Response = await request(app)
        .post(`/api/events/${eventId}/register`)
        .set('Authorization', `Bearer ${attendee3.token}`);

      expect(registration3Response.status).toBe(201);
      expect(registration3Response.body.data.event.available_spots).toBe(0);

      // Step 6: Verify event is now full
      const eventDetailsResponse = await request(app)
        .get(`/api/events/${eventId}`);

      expect(eventDetailsResponse.status).toBe(200);
      expect(eventDetailsResponse.body.data.event.is_full).toBe(true);
      expect(eventDetailsResponse.body.data.event.current_registrations).toBe(3);

      // Step 7: Fourth attendee tries to register (should fail)
      const fourthUser = await testHelpers.createTestUser({
        name: 'Fourth User',
        email: 'fourth@test.com'
      });

      const failedRegistrationResponse = await request(app)
        .post(`/api/events/${eventId}/register`)
        .set('Authorization', `Bearer ${fourthUser.token}`);

      expect(failedRegistrationResponse.status).toBe(400);
      expect(failedRegistrationResponse.body.message).toContain('maximum capacity');

      // Step 8: Check event statistics
      const statsResponse = await request(app)
        .get(`/api/events/${eventId}/stats`);

      expect(statsResponse.status).toBe(200);
      expect(statsResponse.body.data.statistics.confirmed_registrations).toBe(3);
      expect(statsResponse.body.data.statistics.registration_rate_percentage).toBe(100);

      // Step 9: First attendee cancels registration
      const cancellationResponse = await request(app)
        .delete(`/api/events/${eventId}/register/${attendee1.id}`)
        .set('Authorization', `Bearer ${attendee1.token}`);

      expect(cancellationResponse.status).toBe(200);

      // Step 10: Verify spot is now available
      const updatedEventResponse = await request(app)
        .get(`/api/events/${eventId}`);

      expect(updatedEventResponse.status).toBe(200);
      expect(updatedEventResponse.body.data.event.available_spots).toBe(1);
      expect(updatedEventResponse.body.data.event.is_full).toBe(false);

      // Step 11: Fourth attendee can now register
      const successfulRegistrationResponse = await request(app)
        .post(`/api/events/${eventId}/register`)
        .set('Authorization', `Bearer ${fourthUser.token}`);

      expect(successfulRegistrationResponse.status).toBe(201);

      // Step 12: Verify final state
      const finalStatsResponse = await request(app)
        .get(`/api/events/${eventId}/stats`);

      expect(finalStatsResponse.status).toBe(200);
      expect(finalStatsResponse.body.data.statistics.confirmed_registrations).toBe(3);
      expect(finalStatsResponse.body.data.statistics.cancelled_registrations).toBe(0); // Cancelled registration was deleted
    });

    it('should handle registration reactivation flow', async () => {
      // Create event
      const event = await testHelpers.createTestEvent({
        title: 'Reactivation Test Event',
        capacity: 5
      }, organizer.id);

      // User registers
      const initialRegistration = await request(app)
        .post(`/api/events/${event.id}/register`)
        .set('Authorization', `Bearer ${attendee1.token}`);

      expect(initialRegistration.status).toBe(201);

      // User cancels registration
      const cancellation = await request(app)
        .delete(`/api/events/${event.id}/register/${attendee1.id}`)
        .set('Authorization', `Bearer ${attendee1.token}`);

      expect(cancellation.status).toBe(200);

      // User registers again (should work)
      const reregistration = await request(app)
        .post(`/api/events/${event.id}/register`)
        .set('Authorization', `Bearer ${attendee1.token}`);

      expect(reregistration.status).toBe(201);

      // Verify user is registered
      const eventDetails = await request(app)
        .get(`/api/events/${event.id}`)
        .set('Authorization', `Bearer ${attendee1.token}`);

      expect(eventDetails.body.data.event.user_permissions.is_registered).toBe(true);
    });

    it('should maintain data consistency across operations', async () => {
      // Create event
      const event = await testHelpers.createTestEvent({
        title: 'Consistency Test Event',
        capacity: 10
      }, organizer.id);

      // Register multiple users
      const users = await testHelpers.createMultipleUsers(5);
      
      for (const user of users) {
        const response = await request(app)
          .post(`/api/events/${event.id}/register`)
          .set('Authorization', `Bearer ${user.token}`);
        
        expect(response.status).toBe(201);
      }

      // Verify database consistency
      const consistency = await testHelpers.verifyDatabaseConsistency(event.id);
      expect(consistency.isConsistent).toBe(true);
      expect(consistency.actualCount).toBe(5);

      // Cancel some registrations
      for (let i = 0; i < 2; i++) {
        const response = await request(app)
          .delete(`/api/events/${event.id}/register/${users[i].id}`)
          .set('Authorization', `Bearer ${users[i].token}`);
        
        expect(response.status).toBe(200);
      }

      // Verify consistency after cancellations
      const finalConsistency = await testHelpers.verifyDatabaseConsistency(event.id);
      expect(finalConsistency.isConsistent).toBe(true);
      expect(finalConsistency.actualCount).toBe(3);
    });
  });

  describe('Cross-User Interactions', () => {
    let event;

    beforeEach(async () => {
      event = await testHelpers.createTestEvent({
        title: 'Cross-User Test Event',
        capacity: 5
      }, organizer.id);
    });

    it('should handle organizer viewing their event with registrations', async () => {
      // Register some users
      await request(app)
        .post(`/api/events/${event.id}/register`)
        .set('Authorization', `Bearer ${attendee1.token}`);

      await request(app)
        .post(`/api/events/${event.id}/register`)
        .set('Authorization', `Bearer ${attendee2.token}`);

      // Organizer views event details
      const response = await request(app)
        .get(`/api/events/${event.id}`)
        .set('Authorization', `Bearer ${organizer.token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.event.user_permissions.can_edit).toBe(true);
      expect(response.body.data.event.user_permissions.can_register).toBe(false);
      expect(Array.isArray(response.body.data.registered_users)).toBe(true);
      expect(response.body.data.registered_users).toHaveLength(2);
    });

    it('should handle registered user viewing event details', async () => {
      // Register user
      await request(app)
        .post(`/api/events/${event.id}/register`)
        .set('Authorization', `Bearer ${attendee1.token}`);

      // Registered user views event details
      const response = await request(app)
        .get(`/api/events/${event.id}`)
        .set('Authorization', `Bearer ${attendee1.token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.event.user_permissions.can_edit).toBe(false);
      expect(response.body.data.event.user_permissions.can_register).toBe(false);
      expect(response.body.data.event.user_permissions.is_registered).toBe(true);
      expect(Array.isArray(response.body.data.registered_users)).toBe(true);
    });

    it('should handle non-registered user viewing event details', async () => {
      // Register another user
      await request(app)
        .post(`/api/events/${event.id}/register`)
        .set('Authorization', `Bearer ${attendee1.token}`);

      // Non-registered user views event details
      const response = await request(app)
        .get(`/api/events/${event.id}`)
        .set('Authorization', `Bearer ${attendee2.token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.event.user_permissions.can_edit).toBe(false);
      expect(response.body.data.event.user_permissions.can_register).toBe(true);
      expect(response.body.data.event.user_permissions.is_registered).toBe(false);
      expect(response.body.data.registered_users).toHaveProperty('count');
      expect(response.body.data.registered_users.details).toBe('Login to view registered users');
    });

    it('should prevent users from cancelling others\' registrations', async () => {
      // Register attendee1
      await request(app)
        .post(`/api/events/${event.id}/register`)
        .set('Authorization', `Bearer ${attendee1.token}`);

      // Attendee2 tries to cancel attendee1's registration
      const response = await request(app)
        .delete(`/api/events/${event.id}/register/${attendee1.id}`)
        .set('Authorization', `Bearer ${attendee2.token}`);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('only cancel your own');
    });
  });

  describe('Error Recovery and Edge Cases', () => {
    it('should handle network interruption simulation', async () => {
      const event = await testHelpers.createTestEvent({
        title: 'Network Test Event',
        capacity: 2
      }, organizer.id);

      // Simulate partial registration (user created but registration fails)
      const user = await testHelpers.createTestUser({
        name: 'Network Test User',
        email: 'network@test.com'
      });

      // First registration succeeds
      const response1 = await request(app)
        .post(`/api/events/${event.id}/register`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response1.status).toBe(201);

      // Attempt duplicate registration (should fail gracefully)
      const response2 = await request(app)
        .post(`/api/events/${event.id}/register`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response2.status).toBe(409);

      // Verify data consistency
      const consistency = await testHelpers.verifyDatabaseConsistency(event.id);
      expect(consistency.isConsistent).toBe(true);
      expect(consistency.actualCount).toBe(1);
    });

    it('should handle rapid sequential operations', async () => {
      const event = await testHelpers.createTestEvent({
        title: 'Sequential Test Event',
        capacity: 3
      }, organizer.id);

      const user = await testHelpers.createTestUser({
        name: 'Sequential User',
        email: 'sequential@test.com'
      });

      // Rapid register -> cancel -> register sequence
      const register1 = await request(app)
        .post(`/api/events/${event.id}/register`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(register1.status).toBe(201);

      const cancel = await request(app)
        .delete(`/api/events/${event.id}/register/${user.id}`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(cancel.status).toBe(200);

      const register2 = await request(app)
        .post(`/api/events/${event.id}/register`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(register2.status).toBe(201);

      // Verify final state
      const eventDetails = await request(app)
        .get(`/api/events/${event.id}`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(eventDetails.body.data.event.user_permissions.is_registered).toBe(true);
    });
  });
});
