import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { prisma } from './db.js';
import { asyncRoute } from './lib/http.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import vehicleRoutes from './routes/vehicles.js';
import driverRoutes from './routes/drivers.js';
import vendorRoutes from './routes/vendors.js';
import routeRoutes from './routes/routes.js';
import bookingRoutes from './routes/bookings.js';
import tripRoutes from './routes/trips.js';
import maintenanceRoutes from './routes/maintenance.js';
import gpsRoutes from './routes/gps.js';
import auditRoutes from './routes/audit.js';
import userRoutes from './routes/users.js';
import notificationRoutes from './routes/notifications.js';
import reportRoutes from './routes/reports.js';

export function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    cors({
      origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()),
    })
  );
  app.use(express.json({ limit: '1mb' }));

  if (config.env === 'development' && !config.isTest) {
    app.use((req, res, next) => {
      const started = Date.now();
      res.on('finish', () => {
        if (req.path.startsWith('/api')) {
          console.log(`${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - started}ms)`);
        }
      });
      next();
    });
  }

  app.get(
    '/api/health',
    asyncRoute(async (req, res) => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({ ok: true, service: 'KCIC Fleet & Driver Management API', environment: config.env, database: 'up', time: new Date().toISOString() });
      } catch {
        res.status(503).json({ ok: false, service: 'KCIC Fleet & Driver Management API', database: 'down' });
      }
    })
  );

  app.use('/api/auth', authRoutes);
  app.use('/api/dashboard', requireAuth, dashboardRoutes);
  app.use('/api/vehicles', requireAuth, vehicleRoutes);
  app.use('/api/drivers', requireAuth, driverRoutes);
  app.use('/api/vendors', requireAuth, vendorRoutes);
  app.use('/api/routes', requireAuth, routeRoutes);
  app.use('/api/bookings', requireAuth, bookingRoutes);
  app.use('/api/trips', requireAuth, tripRoutes);
  app.use('/api/maintenance', requireAuth, maintenanceRoutes);
  app.use('/api/gps', requireAuth, gpsRoutes);
  app.use('/api/audit', requireAuth, auditRoutes);
  app.use('/api/users', requireAuth, userRoutes);
  app.use('/api/notifications', requireAuth, notificationRoutes);
  app.use('/api/reports', requireAuth, reportRoutes);

  app.use('/api', notFound);
  app.use(errorHandler);
  return app;
}
