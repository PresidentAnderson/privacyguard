const request = require('supertest');
const { app } = require('../src/app');

describe('PrivacyGuard API', () => {
  describe('Health Endpoints', () => {
    test('GET /health should return server status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'OK');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('environment');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('uptime');
    });

    test('GET /api/status should return service status', async () => {
      const response = await request(app)
        .get('/api/status')
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('api');
      expect(response.body).toHaveProperty('services');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('API Endpoints', () => {
    test('GET /api/platforms should return supported platforms', async () => {
      const response = await request(app)
        .get('/api/platforms')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('platforms');
      expect(Array.isArray(response.body.platforms)).toBe(true);
    });

    test('POST /api/auth/login should return placeholder response', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password123'
        })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('message');
    });

    test('POST /api/auth/register should return placeholder response', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'password123',
          name: 'Test User'
        })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('message');
    });
  });

  describe('Error Handling', () => {
    test('GET /nonexistent should return 404', async () => {
      const response = await request(app)
        .get('/nonexistent')
        .expect(404);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('message', 'Endpoint not found');
      expect(response.body).toHaveProperty('path', '/nonexistent');
    });
  });

  describe('Rate Limiting', () => {
    test('Should allow requests within rate limit', async () => {
      // Make multiple requests quickly
      const promises = Array(10).fill().map(() => 
        request(app).get('/health')
      );
      
      const responses = await Promise.all(promises);
      
      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });
  });
});