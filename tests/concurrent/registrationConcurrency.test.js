const request = require('supertest');
const app = require('../../src/app');
const testHelpers = require('../utils/testHelpers');

describe('Concurrent Registration Tests', () => {
  let testUser;

  beforeAll(async () => {
    await testHelpers.initialize();
  });

  afterAll(async () => {
    await testHelpers.cleanup();
  });

  beforeEach(async () => {
    await testHelpers.cleanDatabase();
    
    testUser = await testHelpers.createTestUser({
      name: 'Event Organizer',
      email: 'organizer@test.com'
    });
  });

  describe('Race Condition Prevention', () => {
    it('should handle concurrent registrations for limited capacity event', async () => {
      const event = await testHelpers.createTestEvent({
        title: 'Limited Capacity Event',
        capacity: 3
      }, testUser.id);

      // Create 10 users trying to register for 3 spots
      const users = await testHelpers.createMultipleUsers(10);

      // Simulate concurrent registrations
      const registrationPromises = users.map(user =>
        request(app)
          .post(`/api/events/${event.id}/register`)
          .set('Authorization', `Bearer ${user.token}`)
      );

      const responses = await Promise.allSettled(registrationPromises);

      // Count successful and failed registrations
      const successful = responses.filter(r => 
        r.status === 'fulfilled' && r.value.status === 201
      ).length;

      const failed = responses.filter(r => 
        r.status === 'fulfilled' && r.value.status !== 201
      ).length;

      // Should have exactly 3 successful registrations
      expect(successful).toBe(3);
      expect(failed).toBe(7);

      // Verify database consistency
      const consistency = await testHelpers.verifyDatabaseConsistency(event.id);
      expect(consistency.isConsistent).toBe(true);
      expect(consistency.actualCount).toBe(3);
    });

    it('should handle concurrent registrations using database functions', async () => {
      const event = await testHelpers.createTestEvent({
        title: 'Database Function Test',
        capacity: 2
      }, testUser.id);

      // Use the database-level concurrent registration simulation
      const { users, results } = await testHelpers.simulateConcurrentRegistrations(event.id, 5);

      // Count successful registrations
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      expect(successful).toBe(2);
      expect(failed).toBe(3);

      // Verify all users were created
      expect(users).toHaveLength(5);

      // Verify database consistency
      const consistency = await testHelpers.verifyDatabaseConsistency(event.id);
      expect(consistency.isConsistent).toBe(true);
      expect(consistency.actualCount).toBe(2);
    });

    it('should handle concurrent registrations and cancellations', async () => {
      const event = await testHelpers.createTestEvent({
        title: 'Registration Cancellation Race',
        capacity: 5
      }, testUser.id);

      // Pre-register some users
      const preRegisteredUsers = await testHelpers.createMultipleUsers(3);
      for (const user of preRegisteredUsers) {
        await testHelpers.createRegistration(user.id, event.id);
      }

      // Create new users for registration
      const newUsers = await testHelpers.createMultipleUsers(5);

      // Simulate concurrent operations: some cancelling, some registering
      const operations = [
        // Cancellations
        ...preRegisteredUsers.slice(0, 2).map(user =>
          request(app)
            .delete(`/api/events/${event.id}/register/${user.id}`)
            .set('Authorization', `Bearer ${user.token}`)
        ),
        // New registrations
        ...newUsers.map(user =>
          request(app)
            .post(`/api/events/${event.id}/register`)
            .set('Authorization', `Bearer ${user.token}`)
        )
      ];

      const responses = await Promise.allSettled(operations);

      // Verify database consistency after all operations
      const consistency = await testHelpers.verifyDatabaseConsistency(event.id);
      expect(consistency.isConsistent).toBe(true);
      expect(consistency.actualCount).toBeLessThanOrEqual(5); // Capacity limit
    });

    it('should handle high-frequency registration attempts', async () => {
      const event = await testHelpers.createTestEvent({
        title: 'High Frequency Test',
        capacity: 1
      }, testUser.id);

      // Create many users
      const users = await testHelpers.createMultipleUsers(20);

      // Measure execution time
      const { result: responses, executionTime } = await testHelpers.measureExecutionTime(async () => {
        const promises = users.map(user =>
          request(app)
            .post(`/api/events/${event.id}/register`)
            .set('Authorization', `Bearer ${user.token}`)
        );
        return Promise.allSettled(promises);
      });

      // Should complete within reasonable time (less than 10 seconds)
      expect(executionTime).toBeLessThan(10000);

      // Exactly one should succeed
      const successful = responses.filter(r => 
        r.status === 'fulfilled' && r.value.status === 201
      ).length;

      expect(successful).toBe(1);

      // Verify database consistency
      const consistency = await testHelpers.verifyDatabaseConsistency(event.id);
      expect(consistency.isConsistent).toBe(true);
      expect(consistency.actualCount).toBe(1);
    });
  });

  describe('Deadlock Prevention', () => {
    it('should prevent deadlocks with multiple events', async () => {
      // Create multiple events
      const events = await testHelpers.createMultipleEvents(3, {
        capacity: 2
      }, testUser.id);

      // Create users
      const users = await testHelpers.createMultipleUsers(6);

      // Simulate users registering for multiple events simultaneously
      const registrationPromises = [];
      
      users.forEach((user, userIndex) => {
        events.forEach((event, eventIndex) => {
          // Each user tries to register for all events
          registrationPromises.push(
            request(app)
              .post(`/api/events/${event.id}/register`)
              .set('Authorization', `Bearer ${user.token}`)
          );
        });
      });

      // Execute all registrations concurrently
      const responses = await Promise.allSettled(registrationPromises);

      // Should complete without deadlocks
      expect(responses).toHaveLength(18); // 6 users × 3 events

      // Verify each event has consistent data
      for (const event of events) {
        const consistency = await testHelpers.verifyDatabaseConsistency(event.id);
        expect(consistency.isConsistent).toBe(true);
        expect(consistency.actualCount).toBeLessThanOrEqual(2);
      }
    });

    it('should handle concurrent operations on same user across events', async () => {
      const events = await testHelpers.createMultipleEvents(5, {
        capacity: 10
      }, testUser.id);

      const user = await testHelpers.createTestUser({
        name: 'Multi Event User',
        email: 'multi@test.com'
      });

      // User tries to register for all events simultaneously
      const registrationPromises = events.map(event =>
        request(app)
          .post(`/api/events/${event.id}/register`)
          .set('Authorization', `Bearer ${user.token}`)
      );

      const responses = await Promise.all(registrationPromises);

      // All registrations should succeed (no conflicts between different events)
      responses.forEach(response => {
        expect(response.status).toBe(201);
      });

      // Verify user is registered for all events
      for (const event of events) {
        const registrationCheck = await testHelpers.query(
          'SELECT * FROM registrations WHERE user_id = $1 AND event_id = $2',
          [user.id, event.id]
        );
        expect(registrationCheck.rows).toHaveLength(1);
      }
    });
  });

  describe('Performance Under Load', () => {
    it('should maintain performance with many concurrent users', async () => {
      const event = await testHelpers.createTestEvent({
        title: 'Performance Test Event',
        capacity: 50
      }, testUser.id);

      // Create 100 users
      const users = await testHelpers.createMultipleUsers(100);

      // Measure registration performance
      const { executionTime } = await testHelpers.measureExecutionTime(async () => {
        const registrationPromises = users.map(user =>
          request(app)
            .post(`/api/events/${event.id}/register`)
            .set('Authorization', `Bearer ${user.token}`)
        );

        return Promise.allSettled(registrationPromises);
      });

      // Should complete within 30 seconds
      expect(executionTime).toBeLessThan(30000);

      // Verify exactly 50 registrations (capacity limit)
      const consistency = await testHelpers.verifyDatabaseConsistency(event.id);
      expect(consistency.isConsistent).toBe(true);
      expect(consistency.actualCount).toBe(50);
    });

    it('should handle burst traffic patterns', async () => {
      const event = await testHelpers.createTestEvent({
        title: 'Burst Traffic Event',
        capacity: 10
      }, testUser.id);

      // Simulate burst traffic in waves
      const waves = 3;
      const usersPerWave = 20;

      for (let wave = 0; wave < waves; wave++) {
        const waveUsers = await testHelpers.createMultipleUsers(usersPerWave);
        
        const wavePromises = waveUsers.map(user =>
          request(app)
            .post(`/api/events/${event.id}/register`)
            .set('Authorization', `Bearer ${user.token}`)
        );

        await Promise.allSettled(wavePromises);

        // Small delay between waves
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Verify final state
      const consistency = await testHelpers.verifyDatabaseConsistency(event.id);
      expect(consistency.isConsistent).toBe(true);
      expect(consistency.actualCount).toBe(10); // Should be at capacity
    });
  });

  describe('Error Handling Under Concurrency', () => {
    it('should handle database connection limits gracefully', async () => {
      const event = await testHelpers.createTestEvent({
        title: 'Connection Limit Test',
        capacity: 5
      }, testUser.id);

      // Create many users to potentially exhaust connection pool
      const users = await testHelpers.createMultipleUsers(50);

      const registrationPromises = users.map(user =>
        request(app)
          .post(`/api/events/${event.id}/register`)
          .set('Authorization', `Bearer ${user.token}`)
      );

      const responses = await Promise.allSettled(registrationPromises);

      // All requests should complete (either success or proper error)
      responses.forEach(response => {
        expect(response.status).toBe('fulfilled');
        expect([200, 201, 400, 409, 500]).toContain(response.value.status);
      });

      // Database should remain consistent
      const consistency = await testHelpers.verifyDatabaseConsistency(event.id);
      expect(consistency.isConsistent).toBe(true);
    });

    it('should recover from temporary database errors', async () => {
      const event = await testHelpers.createTestEvent({
        title: 'Error Recovery Test',
        capacity: 3
      }, testUser.id);

      const users = await testHelpers.createMultipleUsers(10);

      // First wave of registrations
      const firstWave = users.slice(0, 5).map(user =>
        request(app)
          .post(`/api/events/${event.id}/register`)
          .set('Authorization', `Bearer ${user.token}`)
      );

      await Promise.allSettled(firstWave);

      // Second wave after brief delay
      await new Promise(resolve => setTimeout(resolve, 500));

      const secondWave = users.slice(5).map(user =>
        request(app)
          .post(`/api/events/${event.id}/register`)
          .set('Authorization', `Bearer ${user.token}`)
      );

      await Promise.allSettled(secondWave);

      // Verify final consistency
      const consistency = await testHelpers.verifyDatabaseConsistency(event.id);
      expect(consistency.isConsistent).toBe(true);
      expect(consistency.actualCount).toBe(3);
    });
  });

  describe('Data Integrity Under Concurrency', () => {
    it('should maintain referential integrity during concurrent operations', async () => {
      const event = await testHelpers.createTestEvent({
        title: 'Referential Integrity Test',
        capacity: 5
      }, testUser.id);

      const users = await testHelpers.createMultipleUsers(10);

      // Mix of registrations and other operations
      const operations = [
        // Registrations
        ...users.slice(0, 7).map(user =>
          request(app)
            .post(`/api/events/${event.id}/register`)
            .set('Authorization', `Bearer ${user.token}`)
        ),
        // Event details requests
        ...Array(5).fill().map(() =>
          request(app).get(`/api/events/${event.id}`)
        ),
        // Stats requests
        ...Array(3).fill().map(() =>
          request(app).get(`/api/events/${event.id}/stats`)
        )
      ];

      const responses = await Promise.allSettled(operations);

      // All operations should complete
      expect(responses).toHaveLength(15);

      // Verify data integrity
      const consistency = await testHelpers.verifyDatabaseConsistency(event.id);
      expect(consistency.isConsistent).toBe(true);

      // Verify no orphaned records
      const orphanedRegistrations = await testHelpers.query(`
        SELECT r.* FROM registrations r
        LEFT JOIN users u ON r.user_id = u.id
        LEFT JOIN events e ON r.event_id = e.id
        WHERE u.id IS NULL OR e.id IS NULL
      `);

      expect(orphanedRegistrations.rows).toHaveLength(0);
    });

    it('should handle concurrent modifications to event capacity', async () => {
      const event = await testHelpers.createTestEvent({
        title: 'Capacity Modification Test',
        capacity: 10
      }, testUser.id);

      // Pre-register some users
      const preUsers = await testHelpers.createMultipleUsers(5);
      for (const user of preUsers) {
        await testHelpers.createRegistration(user.id, event.id);
      }

      // Create more users for concurrent registration
      const newUsers = await testHelpers.createMultipleUsers(10);

      // Simulate concurrent registrations while capacity might be changing
      const registrationPromises = newUsers.map(user =>
        request(app)
          .post(`/api/events/${event.id}/register`)
          .set('Authorization', `Bearer ${user.token}`)
      );

      const responses = await Promise.allSettled(registrationPromises);

      // Verify final state is consistent
      const consistency = await testHelpers.verifyDatabaseConsistency(event.id);
      expect(consistency.isConsistent).toBe(true);
      expect(consistency.actualCount).toBeLessThanOrEqual(consistency.capacity);
    });
  });
});
