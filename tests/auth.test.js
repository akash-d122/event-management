const request = require('supertest');
const app = require('../src/app');
const {
  testUsers,
  createTestUser,
  authenticatedRequest,
  expectError,
  expectSuccess,
  expectValidationError
} = require('./utils/testHelpers');

require('./setup');

describe('Authentication', () => {
  describe('POST /api/auth/register', () => {
    it('should register a new user successfully', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send(testUsers.user1);

      expectSuccess(response, 201);
      expect(response.body.token).toBeDefined();
      expect(response.body.data.user.email).toBe(testUsers.user1.email);
      expect(response.body.data.user.username).toBe(testUsers.user1.username);
      expect(response.body.data.user.password_hash).toBeUndefined();
    });

    it('should not register user with invalid email', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          ...testUsers.user1,
          email: 'invalid-email'
        });

      expectValidationError(response, 'email');
    });

    it('should not register user with weak password', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          ...testUsers.user1,
          password: '123'
        });

      expectValidationError(response, 'Password');
    });

    it('should not register user with duplicate email', async () => {
      await createTestUser(testUsers.user1);

      const response = await request(app)
        .post('/api/auth/register')
        .send(testUsers.user1);

      expectError(response, 400, 'Email already exists');
    });

    it('should not register user with duplicate username', async () => {
      await createTestUser(testUsers.user1);

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          ...testUsers.user2,
          username: testUsers.user1.username
        });

      expectError(response, 400, 'Username already exists');
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await createTestUser(testUsers.user1);
    });

    it('should login user with correct credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUsers.user1.email,
          password: testUsers.user1.password
        });

      expectSuccess(response);
      expect(response.body.token).toBeDefined();
      expect(response.body.data.user.email).toBe(testUsers.user1.email);
      expect(response.body.data.user.password_hash).toBeUndefined();
    });

    it('should not login with incorrect email', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'wrong@example.com',
          password: testUsers.user1.password
        });

      expectError(response, 401, 'Invalid email or password');
    });

    it('should not login with incorrect password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUsers.user1.email,
          password: 'wrongpassword'
        });

      expectError(response, 401, 'Invalid email or password');
    });

    it('should not login with invalid email format', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'invalid-email',
          password: testUsers.user1.password
        });

      expectValidationError(response, 'email');
    });
  });

  describe('GET /api/auth/profile', () => {
    it('should get user profile with valid token', async () => {
      const { token } = await createTestUser(testUsers.user1);

      const response = await authenticatedRequest(token)
        .get('/api/auth/profile');

      expectSuccess(response);
      expect(response.body.data.user.email).toBe(testUsers.user1.email);
      expect(response.body.data.user.password_hash).toBeUndefined();
    });

    it('should not get profile without token', async () => {
      const response = await request(app)
        .get('/api/auth/profile');

      expectError(response, 401, 'not logged in');
    });

    it('should not get profile with invalid token', async () => {
      const response = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', 'Bearer invalid-token');

      expectError(response, 401);
    });
  });

  describe('PUT /api/auth/profile', () => {
    it('should update user profile successfully', async () => {
      const { token } = await createTestUser(testUsers.user1);

      const updateData = {
        first_name: 'Updated',
        last_name: 'Name'
      };

      const response = await authenticatedRequest(token)
        .put('/api/auth/profile')
        .send(updateData);

      expectSuccess(response);
      expect(response.body.data.user.first_name).toBe(updateData.first_name);
      expect(response.body.data.user.last_name).toBe(updateData.last_name);
    });

    it('should not update profile with invalid data', async () => {
      const { token } = await createTestUser(testUsers.user1);

      const response = await authenticatedRequest(token)
        .put('/api/auth/profile')
        .send({
          email: 'invalid-email'
        });

      expectValidationError(response, 'email');
    });

    it('should not allow password update through profile endpoint', async () => {
      const { token } = await createTestUser(testUsers.user1);

      const response = await authenticatedRequest(token)
        .put('/api/auth/profile')
        .send({
          password: 'newpassword'
        });

      expectError(response, 400, 'not for password updates');
    });
  });
});
