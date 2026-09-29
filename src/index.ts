import { createApp } from './api/app';
import { config } from './config';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`[PRAVAHAx] Backend listening on port ${config.port} (env: ${config.appEnv})`);
  console.log(`[PRAVAHAx] Presentation timezone: ${config.timezone}`);
});

process.on('SIGTERM', () => {
  console.log('[PRAVAHAx] SIGTERM received, shutting down gracefully...');
  server.close(() => {
    process.exit(0);
  });
});
