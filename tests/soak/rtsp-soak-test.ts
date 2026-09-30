import { RtspFrameSource } from '../../src/modules/cameras/frame-sources/rtsp-frame-source';

async function runSoakTest() {
  console.log('=== Step 10: RTSP Stream Ingestion Soak Test ===');
  const source = new RtspFrameSource();

  await source.initialize({
    cameraId: 'cam-soak-test',
    rtspUrl: 'rtsp://synthetic-soak',
    testInputOverride: 'testsrc=size=640x480:rate=15',
    fps: 15,
    width: 640,
    height: 480,
    connectTimeoutMs: 6000,
  });

  const startTime = Date.now();
  await source.start();

  const pid = (source as any).ffmpegProcess?.pid;
  console.log(`[Soak Test] FFmpeg subprocess spawned (PID: ${pid})`);

  let frameCount = 0;
  const initialMem = process.memoryUsage().heapUsed;

  const unsubscribe = source.onFrame(() => {
    frameCount++;
  });

  // Run for 15 seconds continuous ingestion
  const DURATION_MS = 15000;
  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const latest = source.getLatestFrame();
      const currentPid = (source as any).ffmpegProcess?.pid;
      const memMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

      console.log(
        `[Soak Test] Elapsed: ${(elapsed / 1000).toFixed(1)}s | Frames: ${frameCount} | ` +
        `Latest Seq: ${latest?.sequence} | Heap: ${memMb}MB | PID: ${currentPid}`
      );

      if (elapsed >= DURATION_MS) {
        clearInterval(interval);
        resolve();
      }
    }, 3000);
  });

  unsubscribe();
  const finalMem = process.memoryUsage().heapUsed;
  const finalPid = (source as any).ffmpegProcess?.pid;

  await source.stop();
  const postStopPid = (source as any).ffmpegProcess?.pid;

  console.log('\n=== Soak Test Summary ===');
  console.log(`Duration: ${(DURATION_MS / 1000).toFixed(1)}s`);
  console.log(`Frames Ingested: ${frameCount}`);
  console.log(`PID Stability: Initial ${pid} === Final ${finalPid} (${pid === finalPid ? 'STABLE' : 'UNSTABLE'})`);
  console.log(`Process Shutdown: ${postStopPid === undefined ? 'CLEAN (Subprocess Terminated)' : 'LEAK'}`);
  console.log(`Heap Delta: ${((finalMem - initialMem) / 1024 / 1024).toFixed(2)} MB`);
}

runSoakTest().catch((err) => {
  console.error('[Soak Test] Error:', err);
  process.exit(1);
});
