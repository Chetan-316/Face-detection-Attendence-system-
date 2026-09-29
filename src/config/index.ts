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
};
