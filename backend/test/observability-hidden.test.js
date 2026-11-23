import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './helpers.js';

test('metrics endpoint is hidden when METRICS_TOKEN is not configured', async () => {
  const res = await request(app).get('/api/metrics');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'Endpoint tidak ditemukan');
});
