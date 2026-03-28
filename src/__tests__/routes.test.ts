import express from 'express';
import request from 'supertest';

// Mock heavy dependencies before importing the router
jest.mock('../scheduler', () => ({
  getSchedulerStats: jest.fn(),
}));
jest.mock('../services/RedisManager', () => ({
  redisManager: {
    healthCheck: jest.fn(),
  },
}));
jest.mock('../config', () => ({
  config: {
    schedulerSecret: 'test-scheduler-secret',
    webhooks: [
      { id: 'track-examination-expiry', type: 'track-examination-expiry', url: 'http://x/a', intervalSeconds: 300, enabled: true },
    ],
  },
}));

import { router } from '../routes';
import { getSchedulerStats } from '../scheduler';
import { redisManager } from '../services/RedisManager';

const app = express();
app.use(express.json());
app.use('/', router);

const ADMIN_SECRET = 'test-admin-secret'; // matches setup.ts

describe('GET /', () => {
  it('returns 200 with service info', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('IVDMS Distributed Scheduler');
  });
});

describe('GET /health', () => {
  it('returns 200 when Redis is healthy', async () => {
    (getSchedulerStats as jest.Mock).mockResolvedValueOnce({
      redis: { status: 'healthy' },
    });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
  });

  it('returns 503 when Redis is unhealthy', async () => {
    (getSchedulerStats as jest.Mock).mockResolvedValueOnce({
      redis: { status: 'unhealthy' },
    });
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unhealthy');
  });

  it('is accessible without auth (for health probes)', async () => {
    (getSchedulerStats as jest.Mock).mockResolvedValueOnce({
      redis: { status: 'healthy' },
    });
    const res = await request(app).get('/health');
    expect(res.status).not.toBe(401);
  });
});

describe('GET /redis/health', () => {
  it('returns 200 when Redis is healthy', async () => {
    (redisManager.healthCheck as jest.Mock).mockResolvedValueOnce({ status: 'healthy' });
    const res = await request(app).get('/redis/health');
    expect(res.status).toBe(200);
  });

  it('returns 503 when Redis is unhealthy', async () => {
    (redisManager.healthCheck as jest.Mock).mockResolvedValueOnce({ status: 'unhealthy' });
    const res = await request(app).get('/redis/health');
    expect(res.status).toBe(503);
  });
});

describe('GET /stats', () => {
  it('returns 401 without x-admin-secret', async () => {
    const res = await request(app).get('/stats');
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong x-admin-secret', async () => {
    const res = await request(app).get('/stats').set('x-admin-secret', 'wrong-secret');
    expect(res.status).toBe(401);
  });

  it('returns 200 with correct x-admin-secret', async () => {
    (getSchedulerStats as jest.Mock).mockResolvedValueOnce({ redis: { status: 'healthy' } });
    const res = await request(app).get('/stats').set('x-admin-secret', ADMIN_SECRET);
    expect(res.status).toBe(200);
  });
});

describe('GET /webhooks', () => {
  it('returns 401 without x-admin-secret', async () => {
    const res = await request(app).get('/webhooks');
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong x-admin-secret', async () => {
    const res = await request(app).get('/webhooks').set('x-admin-secret', 'wrong-secret');
    expect(res.status).toBe(401);
  });

  it('returns 200 with webhook list when authenticated', async () => {
    const res = await request(app).get('/webhooks').set('x-admin-secret', ADMIN_SECRET);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('webhooks');
    expect(Array.isArray(res.body.webhooks)).toBe(true);
  });

  it('does not expose timeoutMs in the webhook list', async () => {
    const res = await request(app).get('/webhooks').set('x-admin-secret', ADMIN_SECRET);
    for (const webhook of res.body.webhooks) {
      expect(webhook).not.toHaveProperty('timeoutMs');
    }
  });
});
