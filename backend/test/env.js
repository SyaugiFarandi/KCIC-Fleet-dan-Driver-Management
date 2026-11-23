process.env.NODE_ENV ||= 'test';
process.env.DATABASE_URL ||=
  process.env.TEST_DATABASE_URL ||
  'postgresql://fleet:fleet_demo_password@localhost:5544/fleet_test?schema=public';
process.env.JWT_SECRET ||= 'test-secret';
process.env.BCRYPT_ROUNDS ||= '4';
