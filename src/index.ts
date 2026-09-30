import { createApp } from './api/app';
import { config } from './config';
import { prisma } from './database/client';
import { LifecycleManager } from './common/lifecycle';
import { defaultCameraService } from './modules/cameras/camera.service';
import { defaultPythonWorkerClient } from './modules/biometrics/python-worker-client';

async function bootstrap() {
  const lifecycle = new LifecycleManager(prisma, {
    cameraService: defaultCameraService,
    workerClient: defaultPythonWorkerClient,
  });

  // 1. Verify production environment safety guards
  lifecycle.validateEnvironment();

  // 2. Verify critical database availability before starting server (Req 4, 5)
  await lifecycle.verifyDatabaseStartup();

  // 3. Create express application
  const app = createApp(prisma);

  // 4. Start HTTP listener
  const server = app.listen(config.port, () => {
    console.log(`[PRAVAHAx] Backend listening on port ${config.port} (env: ${config.appEnv})`);
    console.log(`[PRAVAHAx] Presentation timezone: ${config.timezone}`);
    console.log('[PRAVAHAx] System ready for operations.');
  });

  lifecycle.setServer(server);
  lifecycle.registerSignalHandlers();
}

bootstrap().catch((err) => {
  console.error('[PRAVAHAx] Fatal initialization error during startup:', err);
  process.exit(1);
});

