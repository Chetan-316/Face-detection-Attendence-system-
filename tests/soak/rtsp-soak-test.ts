import { RtspFrameSource } from '../../src/modules/cameras/frame-sources/rtsp-frame-source';

async function runParserStressTest() {
  console.log('=== Step 10.1: RTSP Parser / Process Stress Test (Unthrottled) ===');
  const source = new RtspFrameSource();

  await source.initialize({
    cameraId: 'cam-stress-test',
    rtspUrl: 'rtsp://synthetic-stress',
    testInputOverride: 'testsrc=size=640x480:rate=15',
    realtimePacing: false, // Unthrottled parser stress
    fps: 15,
    width: 640,
    height: 480,
    connectTimeoutMs: 6000,
  });

  const startTime = Date.now();
  await source.start();

  const pid = (source as any).ffmpegProcess?.pid;
  console.log(`[Stress Test] FFmpeg subprocess spawned (PID: ${pid})`);

  let frameCount = 0;
  const initialMem = process.memoryUsage().heapUsed;

  const unsubscribe = source.onFrame(() => {
    frameCount++;
  });

  // Run for 10 seconds continuous stress ingestion
  const DURATION_MS = 10000;
  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const latest = source.getLatestFrame();
      const currentPid = (source as any).ffmpegProcess?.pid;
      const memMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

      console.log(
        `[Stress Test] Elapsed: ${(elapsed / 1000).toFixed(1)}s | Frames: ${frameCount} | ` +
        `Latest Seq: ${latest?.sequence} | Heap: ${memMb}MB | PID: ${currentPid}`
      );

      if (elapsed >= DURATION_MS) {
        clearInterval(interval);
        resolve();
      }
    }, 2500);
  });

  unsubscribe();
  const finalMem = process.memoryUsage().heapUsed;
  const finalPid = (source as any).ffmpegProcess?.pid;

  await source.stop();
  const postStopPid = (source as any).ffmpegProcess?.pid;

  console.log('\n--- Parser Stress Test Summary ---');
  console.log(`Duration: ${(DURATION_MS / 1000).toFixed(1)}s`);
  console.log(`Frames Processed: ${frameCount} (High throughput parser stress)`);
  console.log(`PID Stability: Initial ${pid} === Final ${finalPid} (${pid === finalPid ? 'STABLE' : 'UNSTABLE'})`);
  console.log(`Process Shutdown: ${postStopPid === undefined ? 'CLEAN (Subprocess Terminated)' : 'LEAK'}`);
  console.log(`Heap Delta: ${((finalMem - initialMem) / 1024 / 1024).toFixed(2)} MB`);
}

async function runRealtimePacedSoakTest() {
  console.log('\n=== Step 10.1: RTSP Realtime 15 FPS Paced Soak Test (-re) ===');
  const source = new RtspFrameSource();

  await source.initialize({
    cameraId: 'cam-realtime-soak',
    rtspUrl: 'rtsp://synthetic-realtime',
    testInputOverride: 'testsrc=size=640x480:rate=15',
    realtimePacing: true, // Native 15 FPS paced (-re)
    fps: 15,
    width: 640,
    height: 480,
    connectTimeoutMs: 6000,
  });

  const startTime = Date.now();
  await source.start();

  const pid = (source as any).ffmpegProcess?.pid;
  console.log(`[Realtime Soak] FFmpeg subprocess spawned (PID: ${pid})`);

  let frameCount = 0;
  const initialMem = process.memoryUsage().heapUsed;

  const unsubscribe = source.onFrame(() => {
    frameCount++;
  });

  // Run for 15 seconds paced continuous ingestion
  const DURATION_MS = 15000;
  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const latest = source.getLatestFrame();
      const currentPid = (source as any).ffmpegProcess?.pid;
      const memMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      const measuredFps = ((frameCount / (elapsed / 1000))).toFixed(1);

      console.log(
        `[Realtime Soak] Elapsed: ${(elapsed / 1000).toFixed(1)}s | Frames: ${frameCount} (~${measuredFps} FPS) | ` +
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

  console.log('\n--- Realtime 15 FPS Soak Test Summary ---');
  console.log(`Duration: ${(DURATION_MS / 1000).toFixed(1)}s`);
  console.log(`Frames Ingested: ${frameCount} (~${(frameCount / (DURATION_MS / 1000)).toFixed(1)} FPS steady-state)`);
  console.log(`PID Stability: Initial ${pid} === Final ${finalPid} (${pid === finalPid ? 'STABLE' : 'UNSTABLE'})`);
  console.log(`Process Shutdown: ${postStopPid === undefined ? 'CLEAN (Subprocess Terminated)' : 'LEAK'}`);
  console.log(`Heap Delta: ${((finalMem - initialMem) / 1024 / 1024).toFixed(2)} MB`);
}

async function main() {
  await runParserStressTest();
  await runRealtimePacedSoakTest();
}

main().catch((err) => {
  console.error('[Soak Test Suite] Error:', err);
  process.exit(1);
});

