import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import { config } from './config.js';
import { prisma } from './db.js';
import { asyncRoute } from './lib/http.js';
import { logger } from './lib/logger.js';
import { observeHttp, renderMetrics } from './lib/metrics.js';
import { gpsSimulatorStatus } from './lib/gpsSimulator.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import vehicleRoutes from './routes/vehicles.js';
import driverRoutes from './routes/drivers.js';
import vendorRoutes from './routes/vendors.js';
import routeRoutes from './routes/routes.js';
import bookingRoutes from './routes/bookings.js';
import emergencyRoutes from './routes/emergency.js';
import tripRoutes from './routes/trips.js';
import maintenanceRoutes from './routes/maintenance.js';
import gpsRoutes from './routes/gps.js';
import gpsIngestRoutes from './routes/gpsIngest.js';
import auditRoutes from './routes/audit.js';
import userRoutes from './routes/users.js';
import notificationRoutes from './routes/notifications.js';
import reportRoutes from './routes/reports.js';
import fuelRoutes from './routes/fuel.js';
import inspectionRoutes from './routes/inspections.js';
import defectRoutes from './routes/defects.js';
import slaRoutes from './routes/sla.js';
import intelligenceRoutes from './routes/intelligence.js';
import assistantRoutes from './routes/assistant.js';

export function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    const incoming = req.get('x-request-id');
    const requestId = incoming && /^[A-Za-z0-9._-]{8,128}$/.test(incoming) ? incoming : crypto.randomUUID();
    req.id = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  });
  app.use((req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      observeHttp({ method: req.method, status: res.statusCode, durationMs });
      if (!config.isTest) {
        const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
        logger[level]('http_request', {
          requestId: req.id,
          method: req.method,
          path: `${req.baseUrl || ''}${req.path}`,
          status: res.statusCode,
          durationMs: Math.round(durationMs),
          userId: req.user?.id ?? null,
        });
      }
    });
    next();
  });
  app.use(
    cors({
      origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()),
      credentials: true,
    })
  );
  app.use(express.json({ limit: '1mb' }));

  app.get(
    '/api/health',
    asyncRoute(async (req, res) => {
      const started = Date.now();
      let database = 'up';
      let latencyMs = null;
      try {
        await prisma.$queryRaw`SELECT 1`;
        latencyMs = Date.now() - started;
      } catch (err) {
        database = 'down';
        logger.error('health_database_check_failed', { requestId: req.id, error: err.message });
      }
      const simulator = gpsSimulatorStatus();
      const payload = {
        ok: database === 'up',
        service: 'KCIC Fleet & Driver Management API',
        environment: config.env,
        database,
        time: new Date().toISOString(),
        checks: {
          database: { status: database, latencyMs },
          gpsSimulator: {
            status: simulator.enabled ? (simulator.lastError ? 'error' : 'running') : 'disabled',
            mode: 'DEMO_SIMULATOR',
            intervalMs: simulator.intervalMs,
            lastTickAgeSeconds: simulator.lastTickAgeSeconds,
            lastError: simulator.lastError,
          },
        },
        uptimeSeconds: Math.round(process.uptime()),
      };
      res.status(database === 'up' ? 200 : 503).json(payload);
    })
  );

  app.get('/api/metrics', (req, res) => {
    if (!config.metricsToken) {
      res.status(404).json({ error: 'Endpoint tidak ditemukan' });
      return;
    }
    const provided = req.get('x-metrics-token') || '';
    const a = Buffer.from(provided);
    const b = Buffer.from(config.metricsToken);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      res.status(401).json({ error: 'Token metrik tidak valid' });
      return;
    }
    res.type('text/plain; version=0.0.4').send(renderMetrics());
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/dashboard', requireAuth, dashboardRoutes);
  app.use('/api/vehicles', requireAuth, vehicleRoutes);
  app.use('/api/drivers', requireAuth, driverRoutes);
  app.use('/api/vendors', requireAuth, vendorRoutes);
  app.use('/api/routes', requireAuth, routeRoutes);
  app.use('/api/bookings', requireAuth, bookingRoutes);
  app.use('/api/emergency', requireAuth, emergencyRoutes);
  app.use('/api/trips', requireAuth, tripRoutes);
  app.use('/api/maintenance', requireAuth, maintenanceRoutes);
  app.use('/api/gps/ingest', gpsIngestRoutes);
  app.use('/api/gps', requireAuth, gpsRoutes);
  app.use('/api/audit', requireAuth, auditRoutes);
  app.use('/api/users', requireAuth, userRoutes);
  app.use('/api/notifications', requireAuth, notificationRoutes);
  app.use('/api/reports', requireAuth, reportRoutes);
  app.use('/api/fuel', requireAuth, fuelRoutes);
  app.use('/api/inspections', requireAuth, inspectionRoutes);
  app.use('/api/defects', requireAuth, defectRoutes);
  app.use('/api/sla', requireAuth, slaRoutes);
  app.use('/api/intelligence', requireAuth, intelligenceRoutes);
  app.use('/api/assistant', requireAuth, assistantRoutes);

  app.use('/api', notFound);
  app.use(errorHandler);
  return app;
}
