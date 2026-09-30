import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export const config = {
  appEnv: process.env.APP_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:123456@localhost:5433/pravahax_db?schema=public',
  testDatabaseUrl: process.env.TEST_DATABASE_URL || 'postgresql://postgres:123456@localhost:5433/pravahax_test_db?schema=public',
  timezone: process.env.TIMEZONE || 'Asia/Kolkata',
  jwtSecret: process.env.JWT_SECRET || 'dev_secret_pravahax_attendance_movement_2026_key',
  recognition: {
    // Note: Provisional prototype thresholds. Production deployment requires on-site calibration.
    matchThreshold: parseFloat(process.env.RECOGNITION_MATCH_THRESHOLD || '0.60'),
    uncertainThreshold: parseFloat(process.env.RECOGNITION_UNCERTAIN_THRESHOLD || '0.40'),
    minMargin: parseFloat(process.env.RECOGNITION_MIN_MARGIN || '0.08'),
    maxFps: parseInt(process.env.RECOGNITION_MAX_FPS || '5', 10),
    cooldownMs: parseInt(process.env.RECOGNITION_COOLDOWN_MS || '8000', 10),
    historyLimit: parseInt(process.env.RECOGNITION_HISTORY_LIMIT || '100', 10),
  },
};

