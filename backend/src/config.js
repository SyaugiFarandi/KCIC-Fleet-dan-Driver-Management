import 'dotenv/config';

const env = process.env.NODE_ENV || 'development';

export const config = {
  env,
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'local-demo-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  corsOrigin:
    process.env.CORS_ORIGIN ||
    'http://localhost:5180,http://127.0.0.1:5180,http://localhost:5181,http://127.0.0.1:5181,http://localhost:8090,http://127.0.0.1:8090',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 10),
  isTest: env === 'test',
  gpsSimulatorEnabled: env !== 'test' && process.env.GPS_SIM_ENABLED !== 'false',
  gpsSimulatorIntervalMs: Math.max(3000, Number(process.env.GPS_SIM_INTERVAL_MS || 15000)),
};

export function assertProductionConfig() {
  if (config.env === 'production' && !process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET wajib di-set pada environment production');
  }
}
