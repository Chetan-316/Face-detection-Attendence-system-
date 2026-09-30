import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

let cachedFfmpegPath: string | null = null;
let cachedFfprobePath: string | null = null;

/**
 * Searches for FFmpeg and FFprobe binary locations across environment,
 * registry paths, WinGet packages, and standard fallback locations.
 */
export function getFfmpegPath(): string {
  if (cachedFfmpegPath && fs.existsSync(cachedFfmpegPath)) {
    return cachedFfmpegPath;
  }

  // 1. Explicit override via env var
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    cachedFfmpegPath = process.env.FFMPEG_PATH;
    return cachedFfmpegPath;
  }

  // 2. Check if already executable in current process PATH
  try {
    const isWindows = process.platform === 'win32';
    const checkCmd = isWindows ? 'where.exe ffmpeg' : 'which ffmpeg';
    const output = execSync(checkCmd, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .split(/\r?\n/)[0]
      .trim();

    if (output && fs.existsSync(output)) {
      cachedFfmpegPath = output;
      return cachedFfmpegPath;
    }
  } catch {}

  // 3. Check Windows WinGet standard installation directories
  const localAppData = process.env.LOCALAPPDATA || '';
  if (localAppData) {
    const wingetDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
    if (fs.existsSync(wingetDir)) {
      try {
        const entries = fs.readdirSync(wingetDir);
        for (const entry of entries) {
          if (entry.toLowerCase().includes('ffmpeg')) {
            const candidateBin = path.join(wingetDir, entry);
            // Search inside candidate
            const subEntries = fs.readdirSync(candidateBin);
            for (const sub of subEntries) {
              const exe = path.join(candidateBin, sub, 'bin', 'ffmpeg.exe');
              if (fs.existsSync(exe)) {
                cachedFfmpegPath = exe;
                return cachedFfmpegPath;
              }
            }
          }
        }
      } catch {}
    }
  }

  // 4. Check Common Fallback Directories on Windows
  const commonFallbacks = [
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe',
  ];

  for (const candidate of commonFallbacks) {
    if (fs.existsSync(candidate)) {
      cachedFfmpegPath = candidate;
      return cachedFfmpegPath;
    }
  }

  // Default to bare 'ffmpeg' if no absolute path found
  return 'ffmpeg';
}

export function getFfprobePath(): string {
  if (cachedFfprobePath && fs.existsSync(cachedFfprobePath)) {
    return cachedFfprobePath;
  }

  if (process.env.FFPROBE_PATH && fs.existsSync(process.env.FFPROBE_PATH)) {
    cachedFfprobePath = process.env.FFPROBE_PATH;
    return cachedFfprobePath;
  }

  // Derive from ffmpeg location if possible
  const ffmpeg = getFfmpegPath();
  if (ffmpeg !== 'ffmpeg' && path.isAbsolute(ffmpeg)) {
    const dir = path.dirname(ffmpeg);
    const probeExe = path.join(dir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    if (fs.existsSync(probeExe)) {
      cachedFfprobePath = probeExe;
      return cachedFfprobePath;
    }
  }

  try {
    const isWindows = process.platform === 'win32';
    const checkCmd = isWindows ? 'where.exe ffprobe' : 'which ffprobe';
    const output = execSync(checkCmd, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .split(/\r?\n/)[0]
      .trim();

    if (output && fs.existsSync(output)) {
      cachedFfprobePath = output;
      return cachedFfprobePath;
    }
  } catch {}

  return 'ffprobe';
}

export interface FfmpegDiagnostics {
  available: boolean;
  ffmpegPath: string;
  ffprobePath: string;
  ffmpegVersion?: string;
  ffprobeVersion?: string;
  error?: string;
}

/**
 * Validates whether FFmpeg is installed and accessible, returning detailed version metadata.
 */
export function checkFfmpegDiagnostic(): FfmpegDiagnostics {
  const ffmpegPath = getFfmpegPath();
  const ffprobePath = getFfprobePath();

  let ffmpegVersion: string | undefined;
  let ffprobeVersion: string | undefined;
  let error: string | undefined;

  try {
    const ffmpegOut = execSync(`"${ffmpegPath}" -version`, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 3000,
    }).toString();
    const firstLine = ffmpegOut.split('\n')[0].trim();
    ffmpegVersion = firstLine;
  } catch (err: any) {
    error = `FFmpeg not found or failed to execute at '${ffmpegPath}': ${err.message}`;
  }

  try {
    const ffprobeOut = execSync(`"${ffprobePath}" -version`, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 3000,
    }).toString();
    const firstLine = ffprobeOut.split('\n')[0].trim();
    ffprobeVersion = firstLine;
  } catch (err: any) {
    if (!error) {
      error = `FFprobe not found or failed to execute at '${ffprobePath}': ${err.message}`;
    }
  }

  return {
    available: Boolean(ffmpegVersion),
    ffmpegPath,
    ffprobePath,
    ffmpegVersion,
    ffprobeVersion,
    error,
  };
}
