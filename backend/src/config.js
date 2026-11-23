import 'dotenv/config';

const env = process.env.NODE_ENV || 'development';

const cookieSecure =
  process.env.COOKIE_SECURE === undefined ? env === 'production' : process.env.COOKIE_SECURE === 'true';

const allowInsecureHttp = process.env.ALLOW_INSECURE_HTTP === 'true';

const WEAK_SECRETS = new Set([
  'local-demo-secret-change-me',
  'replace-this-demo-secret-before-deployment',
  'changeme',
  'change-me',
  'secret',
  'password',
]);

export const config = {
  env,
  isProduction: env === 'production',
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'local-demo-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  cookieSecure,
  allowInsecureHttp,
  corsOrigin:
    process.env.CORS_ORIGIN ||
    'http://localhost:5180,http://127.0.0.1:5180,http://localhost:5181,http://127.0.0.1:5181,http://localhost:8090,http://127.0.0.1:8090',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 10),
  metricsToken: process.env.METRICS_TOKEN || '',
  gpsIngestToken: process.env.GPS_INGEST_TOKEN || '',
  emailNotificationsEnabled: process.env.EMAIL_NOTIFICATIONS_ENABLED === 'true',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || '',
  },
  telegramNotificationsEnabled: process.env.TELEGRAM_NOTIFICATIONS_ENABLED === 'true',
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
    apiBase: process.env.TELEGRAM_API_BASE || 'https://api.telegram.org',
  },
  notificationRetryBaseMs: Math.max(50, Number(process.env.NOTIFICATION_RETRY_BASE_MS || 500)),
  isTest: env === 'test',
  gpsSimulatorEnabled: env !== 'test' && process.env.GPS_SIM_ENABLED !== 'false',
  gpsSimulatorIntervalMs: Math.max(3000, Number(process.env.GPS_SIM_INTERVAL_MS || 15000)),
};

function assertStrongJwtSecret() {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET wajib di-set pada environment production');
  }
  const secret = process.env.JWT_SECRET;
  const normalized = secret.trim().toLowerCase();
  if (secret.length < 32) {
    throw new Error('JWT_SECRET terlalu pendek: minimal 32 karakter');
  }
  if (WEAK_SECRETS.has(normalized) || normalized.includes('replace-this-demo') || normalized.includes('change-me')) {
    throw new Error('JWT_SECRET masih memakai nilai placeholder/demo dan tidak diizinkan pada production');
  }
  if (new Set(secret).size < 10) {
    throw new Error('JWT_SECRET tidak cukup acak: gunakan secret dari generator (mis. openssl rand -base64 48)');
  }
}

export function assertProductionConfig() {
  if (config.env !== 'production') {
    if (!process.env.JWT_SECRET && !config.isTest) {
      console.warn('[config] JWT_SECRET tidak di-set; memakai secret demo lokal (tidak untuk production).');
    }
    return;
  }
  assertStrongJwtSecret();
  if (config.corsOrigin.split(',').map((origin) => origin.trim()).includes('*')) {
    throw new Error('CORS_ORIGIN tidak boleh memakai wildcard pada environment production');
  }
  if (!config.cookieSecure) {
    if (!config.allowInsecureHttp) {
      throw new Error(
        'COOKIE_SECURE=false tidak diizinkan pada production. Gunakan HTTPS, atau set ALLOW_INSECURE_HTTP=true khusus demo HTTP lokal.'
      );
    }
    console.warn('[config] Mode demo HTTP: COOKIE_SECURE=false diizinkan karena ALLOW_INSECURE_HTTP=true.');
  }
  if (!config.metricsToken) {
    console.warn('[config] METRICS_TOKEN belum di-set; endpoint /api/metrics nonaktif pada production.');
  } else if (config.metricsToken.length < 16) {
    throw new Error('METRICS_TOKEN terlalu pendek: minimal 16 karakter');
  }
  if (config.gpsIngestToken && config.gpsIngestToken.length < 16) {
    throw new Error('GPS_INGEST_TOKEN terlalu pendek: minimal 16 karakter');
  }
  if (config.emailNotificationsEnabled && (!config.smtp.host || !config.smtp.from)) {
    throw new Error('EMAIL_NOTIFICATIONS_ENABLED=true membutuhkan SMTP_HOST dan EMAIL_FROM yang valid');
  }
  if (config.telegramNotificationsEnabled && (!config.telegram.botToken || !config.telegram.chatId)) {
    throw new Error('TELEGRAM_NOTIFICATIONS_ENABLED=true membutuhkan TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID');
  }
}
