const request = require('supertest');
const app = require('../src/app');

describe('Health Check', () => {
  it('should return health status', async () => {
    const response = await request(app)
      .get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');
    expect(response.body.message).toContain('Event Management API is running');
    expect(response.body.timestamp).toBeDefined();
    expect(response.body.environment).toBeDefined();
  });

  it('should return 404 for undefined routes', async () => {
    const response = await request(app)
      .get('/nonexistent-route');

    expect(response.status).toBe(404);
    expect(response.body.status).toBe('error');
    expect(response.body.message).toContain('Can\'t find');
  });
});
