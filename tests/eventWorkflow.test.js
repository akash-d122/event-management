const request = require('supertest');
const app = require('../src/app');
const { databaseManager } = require('../database/config/database');

describe('Complete Event Management Workflow', () => {
  let pool;
  let organizer;
  let attendee1;
  let attendee2;
  let organizerToken;
  let attendee1Token;
  let attendee2Token;
  let createdEvent;

  beforeAll(async () => {
    await databaseManager.initialize();
    pool = databaseManager.getPool();
    
    await pool.query('TRUNCATE TABLE registrations, events, users RESTART IDENTITY CASCADE');
    
    // Create test users
    const organizerResult = await pool.query(`
      INSERT INTO users (name, email, password_hash, is_active)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, email
    `, ['Event Organizer', 'organizer@example.com', '$2b$12$hashedpassword', true]);
    
    const attendee1Result = await pool.query(`
      INSERT INTO users (name, email, password_hash, is_active)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, email
    `, ['Attendee One', 'attendee1@example.com', '$2b$12$hashedpassword', true]);
    
    const attendee2Result = await pool.query(`
      INSERT INTO users (name, email, password_hash, is_active)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, email
    `, ['Attendee Two', 'attendee2@example.com', '$2b$12$hashedpassword', true]);
    
    organizer = organizerResult.rows[0];
    attendee1 = attendee1Result.rows[0];
    attendee2 = attendee2Result.rows[0];
    
    organizerToken = 'mock-jwt-organizer';
    attendee1Token = 'mock-jwt-attendee1';
    attendee2Token = 'mock-jwt-attendee2';
  });

  afterAll(async () => {
    await pool.query('TRUNCATE TABLE registrations, events, users RESTART IDENTITY CASCADE');
    await databaseManager.close();
  });

  describe('Complete Event Lifecycle', () => {
    it('should complete full event management workflow', async () => {
      // Step 1: Organizer creates an event
      console.log('Step 1: Creating event...');
      const createEventResponse = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          title: 'Tech Conference 2024',
          description: 'Annual technology conference featuring the latest innovations',
          date_time: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
          location: 'Convention Center, Downtown',
          capacity: 3 // Small capacity for testing
        });

      expect(createEventResponse.status).toBe(201);
      expect(createEventResponse.body.success).toBe(true);
      createdEvent = createEventResponse.body.data.event;
      
      console.log(`✅ Event created with ID: ${createdEvent.id}`);

      // Step 2: Check upcoming events list
      console.log('Step 2: Checking upcoming events...');
      const upcomingEventsResponse = await request(app)
        .get('/api/events/upcoming');

      expect(upcomingEventsResponse.status).toBe(200);
      expect(upcomingEventsResponse.body.data.events).toHaveLength(1);
      expect(upcomingEventsResponse.body.data.events[0].title).toBe('Tech Conference 2024');
      
      console.log('✅ Event appears in upcoming events list');

      // Step 3: Get detailed event information
      console.log('Step 3: Getting event details...');
      const eventDetailsResponse = await request(app)
        .get(`/api/events/${createdEvent.id}`)
        .set('Authorization', `Bearer ${organizerToken}`);

      expect(eventDetailsResponse.status).toBe(200);
      expect(eventDetailsResponse.body.data.event.user_permissions.can_edit).toBe(true);
      expect(eventDetailsResponse.body.data.event.available_spots).toBe(3);
      
      console.log('✅ Event details retrieved successfully');

      // Step 4: First attendee registers
      console.log('Step 4: First attendee registering...');
      const registration1Response = await request(app)
        .post(`/api/events/${createdEvent.id}/register`)
        .set('Authorization', `Bearer ${attendee1Token}`);

      expect(registration1Response.status).toBe(201);
      expect(registration1Response.body.data.event.available_spots).toBe(2);
      
      console.log('✅ First attendee registered successfully');

      // Step 5: Second attendee registers
      console.log('Step 5: Second attendee registering...');
      const registration2Response = await request(app)
        .post(`/api/events/${createdEvent.id}/register`)
        .set('Authorization', `Bearer ${attendee2Token}`);

      expect(registration2Response.status).toBe(201);
      expect(registration2Response.body.data.event.available_spots).toBe(1);
      
      console.log('✅ Second attendee registered successfully');

      // Step 6: Check event statistics
      console.log('Step 6: Checking event statistics...');
      const statsResponse = await request(app)
        .get(`/api/events/${createdEvent.id}/stats`);

      expect(statsResponse.status).toBe(200);
      expect(statsResponse.body.data.statistics.confirmed_registrations).toBe(2);
      expect(statsResponse.body.data.statistics.registration_rate_percentage).toBeCloseTo(66.67, 1);
      expect(statsResponse.body.data.recent_registrations).toHaveLength(2);
      
      console.log('✅ Event statistics retrieved successfully');

      // Step 7: Organizer views event details with registered users
      console.log('Step 7: Organizer viewing registered users...');
      const organizerViewResponse = await request(app)
        .get(`/api/events/${createdEvent.id}`)
        .set('Authorization', `Bearer ${organizerToken}`);

      expect(organizerViewResponse.status).toBe(200);
      expect(organizerViewResponse.body.data.registered_users).toHaveLength(2);
      expect(organizerViewResponse.body.data.registered_users[0].name).toBeDefined();
      
      console.log('✅ Organizer can view registered users');

      // Step 8: First attendee cancels registration
      console.log('Step 8: First attendee cancelling registration...');
      const cancellationResponse = await request(app)
        .delete(`/api/events/${createdEvent.id}/register/${attendee1.id}`)
        .set('Authorization', `Bearer ${attendee1Token}`);

      expect(cancellationResponse.status).toBe(200);
      expect(cancellationResponse.body.message).toContain('cancelled successfully');
      
      console.log('✅ First attendee cancelled registration');

      // Step 9: Verify updated statistics
      console.log('Step 9: Verifying updated statistics...');
      const updatedStatsResponse = await request(app)
        .get(`/api/events/${createdEvent.id}/stats`);

      expect(updatedStatsResponse.status).toBe(200);
      expect(updatedStatsResponse.body.data.statistics.confirmed_registrations).toBe(1);
      expect(updatedStatsResponse.body.data.statistics.registration_rate_percentage).toBeCloseTo(33.33, 1);
      
      console.log('✅ Statistics updated correctly after cancellation');

      // Step 10: Search for the event
      console.log('Step 10: Searching for events...');
      const searchResponse = await request(app)
        .get('/api/events/upcoming?search=Tech Conference');

      expect(searchResponse.status).toBe(200);
      expect(searchResponse.body.data.events).toHaveLength(1);
      expect(searchResponse.body.data.events[0].title).toBe('Tech Conference 2024');
      
      console.log('✅ Event found in search results');

      // Step 11: Filter events by location
      console.log('Step 11: Filtering events by location...');
      const locationFilterResponse = await request(app)
        .get('/api/events/upcoming?location=Convention Center');

      expect(locationFilterResponse.status).toBe(200);
      expect(locationFilterResponse.body.data.events).toHaveLength(1);
      
      console.log('✅ Event found in location filter');

      // Step 12: Test capacity limits
      console.log('Step 12: Testing capacity limits...');
      
      // Create additional users to fill capacity
      const additionalUsers = [];
      for (let i = 0; i < 3; i++) {
        const userResult = await pool.query(`
          INSERT INTO users (name, email, password_hash)
          VALUES ($1, $2, $3)
          RETURNING id
        `, [`Additional User ${i}`, `additional${i}@test.com`, '$2b$12$hash']);
        additionalUsers.push(userResult.rows[0]);
      }

      // Register users until capacity is reached
      let registrationCount = 1; // attendee2 is still registered
      for (const user of additionalUsers) {
        const regResponse = await pool.safeEventRegistration(user.id, createdEvent.id);
        if (regResponse.success) {
          registrationCount++;
        }
        if (registrationCount >= 3) break; // Capacity reached
      }

      // Try to register one more user (should fail)
      const overCapacityResult = await pool.safeEventRegistration(
        additionalUsers[additionalUsers.length - 1].id, 
        createdEvent.id
      );
      
      expect(overCapacityResult.success).toBe(false);
      expect(overCapacityResult.error_message).toContain('capacity');
      
      console.log('✅ Capacity limits enforced correctly');

      // Step 13: Final statistics check
      console.log('Step 13: Final statistics check...');
      const finalStatsResponse = await request(app)
        .get(`/api/events/${createdEvent.id}/stats`);

      expect(finalStatsResponse.status).toBe(200);
      expect(finalStatsResponse.body.data.statistics.confirmed_registrations).toBe(3);
      expect(finalStatsResponse.body.data.statistics.registration_rate_percentage).toBe(100);
      expect(finalStatsResponse.body.data.statistics.capacity_utilization.percentage_full).toBe(100);
      
      console.log('✅ Final statistics are correct');
      console.log('🎉 Complete workflow test passed!');
    });
  });

  describe('Error Handling in Workflow', () => {
    it('should handle workflow interruptions gracefully', async () => {
      // Create event
      const eventResponse = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          title: 'Error Test Event',
          date_time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          capacity: 2
        });

      const eventId = eventResponse.body.data.event.id;

      // Register user
      await request(app)
        .post(`/api/events/${eventId}/register`)
        .set('Authorization', `Bearer ${attendee1Token}`);

      // Try to register same user again (should fail)
      const duplicateResponse = await request(app)
        .post(`/api/events/${eventId}/register`)
        .set('Authorization', `Bearer ${attendee1Token}`);

      expect(duplicateResponse.status).toBe(409);
      expect(duplicateResponse.body.message).toContain('already registered');

      // Try to cancel non-existent registration
      const invalidCancelResponse = await request(app)
        .delete(`/api/events/${eventId}/register/${attendee2.id}`)
        .set('Authorization', `Bearer ${attendee2Token}`);

      expect(invalidCancelResponse.status).toBe(404);

      // Verify event statistics are still consistent
      const statsResponse = await request(app)
        .get(`/api/events/${eventId}/stats`);

      expect(statsResponse.status).toBe(200);
      expect(statsResponse.body.data.statistics.confirmed_registrations).toBe(1);
    });
  });

  describe('Performance Under Load', () => {
    it('should handle multiple concurrent operations', async () => {
      // Create event
      const eventResponse = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          title: 'Load Test Event',
          date_time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          capacity: 10
        });

      const eventId = eventResponse.body.data.event.id;

      // Create multiple users
      const users = [];
      for (let i = 0; i < 15; i++) {
        const userResult = await pool.query(`
          INSERT INTO users (name, email, password_hash)
          VALUES ($1, $2, $3)
          RETURNING id
        `, [`Load User ${i}`, `load${i}@test.com`, '$2b$12$hash']);
        users.push(userResult.rows[0]);
      }

      // Concurrent registration attempts
      const startTime = Date.now();
      const registrationPromises = users.map(user => 
        pool.safeEventRegistration(user.id, eventId)
      );

      const results = await Promise.allSettled(registrationPromises);
      const endTime = Date.now();

      // Analyze results
      const successful = results.filter(r => 
        r.status === 'fulfilled' && r.value.success
      ).length;

      const failed = results.filter(r => 
        r.status === 'fulfilled' && !r.value.success
      ).length;

      // Verify correct behavior
      expect(successful).toBe(10); // Capacity limit
      expect(failed).toBe(5); // Overflow
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds

      // Verify data consistency
      const finalStats = await request(app)
        .get(`/api/events/${eventId}/stats`);

      expect(finalStats.body.data.statistics.confirmed_registrations).toBe(10);
    });
  });
});
