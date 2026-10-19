import { randomBytes } from 'crypto';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    fileParallelism: false,
    testTimeout: 20000,
    include: ['tests/**/*.test.ts'],
    // Random per run: the config module refuses to load without JWT_SECRET.
    // The suite's biometric fixtures encode the legacy 128-D SFace contract; pinning the engine here
    // keeps it independent of the developer's .env (which selects scrfd_adaface / 512-D).
    env: {
      JWT_SECRET: process.env.JWT_SECRET || randomBytes(48).toString('base64'),
      BIOMETRIC_ENGINE: 'legacy',
    },
  },
});
