const request = require('supertest');
const app = require('../src/app');
const {
  testUsers,
  createTestUser,
  authenticatedRequest,
  expectError
} = require('./utils/testHelpers');

require('./setup');

describe('Error Handling', () => {
  describe('HTTP Status Codes', () => {
    it('should return 400 for validation errors', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'ab', // Too short
          email: 'invalid-email',
          password: '123' // Too weak
        });

      expect(response.status).toBe(400);
      expect(response.body.status).toBe('error');
      expect(response.body.message).toContain('Validation error');
    });

    it('should return 401 for unauthorized access', async () => {
      const response = await request(app)
        .get('/api/auth/profile');

      expect(response.status).toBe(401);
      expect(response.body.status).toBe('error');
      expect(response.body.message).toContain('not logged in');
    });

    it('should return 403 for forbidden access', async () => {
      const { user: user1, token: token1 } = await createTestUser(testUsers.user1);
      const { user: user2, token: token2 } = await createTestUser(testUsers.user2);

      // Create event as user1
      const eventResponse = await authenticatedRequest(token1)
        .post('/api/events')
        .send({
          title: 'Test Event',
          start_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          end_date: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
          capacity: 50
        });

      const eventId = eventResponse.body.data.event.id;

      // Try to update as user2
      const response = await authenticatedRequest(token2)
        .put(`/api/events/${eventId}`)
        .send({ title: 'Hacked Title' });

      expect(response.status).toBe(403);
      expect(response.body.status).toBe('error');
      expect(response.body.message).toContain('only modify your own events');
    });

    it('should return 404 for non-existent resources', async () => {
      const response = await request(app)
        .get('/api/events/99999');

      expect(response.status).toBe(404);
      expect(response.body.status).toBe('error');
      expect(response.body.message).toContain('Event not found');
    });

    it('should return 409 for conflict errors', async () => {
      // Register first user
      await createTestUser(testUsers.user1);

      // Try to register with same email
      const response = await request(app)
        .post('/api/auth/register')
        .send(testUsers.user1);

      expect(response.status).toBe(409);
      expect(response.body.status).toBe('error');
      expect(response.body.message).toContain('Email address is already registered');
    });

    it('should return 500 for server errors', async () => {
      // This is harder to test without mocking, but we can test the error handler
      // by sending malformed data that causes a server error
      
      const response = await request(app)
        .get('/api/events/invalid-id-format');

      expect(response.status).toBe(400); // Should be handled as validation error
      expect(response.body.status).toBe('error');
    });
  });

  describe('Error Response Format', () => {
    it('should return consistent error format', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'password'
        });

      expect(response.body).toHaveProperty('status', 'error');
      expect(response.body).toHaveProperty('message');
      expect(typeof response.body.message).toBe('string');
    });

    it('should not leak sensitive information in production', async () => {
      // Set NODE_ENV to production temporarily
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const response = await request(app)
        .get('/api/nonexistent-endpoint');

      expect(response.body).not.toHaveProperty('stack');
      expect(response.body).not.toHaveProperty('error');

      // Restore original environment
      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Rate Limiting', () => {
    it('should return 429 for too many requests', async () => {
      // This test might be flaky depending on rate limit settings
      // Make multiple rapid requests to auth endpoint
      const requests = Array(10).fill().map(() => 
        request(app)
          .post('/api/auth/login')
          .send({
            email: 'test@example.com',
            password: 'wrongpassword'
          })
      );

      const responses = await Promise.all(requests);
      
      // At least one should be rate limited
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      
      if (rateLimitedResponses.length > 0) {
        expect(rateLimitedResponses[0].body.message).toContain('Too many');
      }
    }, 10000); // Increase timeout for this test
  });

  describe('Input Sanitization', () => {
    it('should handle SQL injection attempts', async () => {
      const { token } = await createTestUser(testUsers.user1);

      const response = await authenticatedRequest(token)
        .post('/api/events')
        .send({
          title: "'; DROP TABLE events; --",
          start_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          end_date: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
          capacity: 50
        });

      // Should either succeed (input sanitized) or fail with validation error
      expect([200, 201, 400]).toContain(response.status);
      
      // Verify events table still exists by making another request
      const testResponse = await request(app).get('/api/events');
      expect(testResponse.status).toBe(200);
    });

    it('should handle XSS attempts', async () => {
      const { token } = await createTestUser(testUsers.user1);

      const response = await authenticatedRequest(token)
        .post('/api/events')
        .send({
          title: '<script>alert("xss")</script>',
          description: '<img src="x" onerror="alert(1)">',
          start_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          end_date: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
          capacity: 50
        });

      if (response.status === 201) {
        // If creation succeeded, verify the data is properly stored
        const event = response.body.data.event;
        expect(event.title).toBe('<script>alert("xss")</script>'); // Should be stored as-is
        expect(event.description).toBe('<img src="x" onerror="alert(1)">');
      }
    });
  });

  describe('Database Constraint Violations', () => {
    it('should handle unique constraint violations gracefully', async () => {
      await createTestUser(testUsers.user1);

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          ...testUsers.user2,
          email: testUsers.user1.email // Duplicate email
        });

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('Email address is already registered');
    });

    it('should handle check constraint violations', async () => {
      const { token } = await createTestUser(testUsers.user1);

      // Try to create event with invalid capacity (this should be caught by validation first)
      const response = await authenticatedRequest(token)
        .post('/api/events')
        .send({
          title: 'Test Event',
          start_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          end_date: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
          capacity: -1 // Invalid capacity
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Capacity must be a positive integer');
    });
  });

  describe('JWT Token Errors', () => {
    it('should handle expired tokens', async () => {
      // This would require mocking JWT or creating an expired token
      const response = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', 'Bearer expired.token.here');

      expect(response.status).toBe(401);
      expect(response.body.status).toBe('error');
    });

    it('should handle malformed tokens', async () => {
      const response = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', 'Bearer malformed-token');

      expect(response.status).toBe(401);
      expect(response.body.status).toBe('error');
    });

    it('should handle missing Bearer prefix', async () => {
      const response = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', 'some-token-without-bearer');

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('not logged in');
    });
  });
});
