/**
 * Utility for RTSP URL credential redaction and camera config sanitization.
 * Prevents credentials from leaking into frontend responses, error objects, and logs.
 */

/**
 * Redacts credentials (username and/or password) from an RTSP URL or text containing RTSP URLs.
 * Example:
 * Input:  "rtsp://admin:Secret123!@192.168.1.50:554/live/ch0"
 * Output: "rtsp://***:***@192.168.1.50:554/live/ch0"
 */
export function redactRtspUrl(text?: string | null): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  // Regex matches rtsp://[user]:[pass]@ or rtsp://[user]@ or rtsps://...
  return text.replace(
    /(rtsp[s]?:\/\/)([^:@\s]+)(:[^@\s]+)?(@)/gi,
    (_match, protocol, user, pass, at) => {
      const maskedPass = pass ? ':***' : '';
      return `${protocol}***${maskedPass}${at}`;
    }
  );
}

/**
 * Constructs a fully authenticated RTSP URL for internal subprocess usage.
 * If credentials are provided separately, encodes and injects them.
 */
export function buildAuthenticatedRtspUrl(
  rawUrl: string,
  username?: string,
  password?: string
): string {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return '';
  }

  const trimmed = rawUrl.trim();
  if (!username && !password) {
    return trimmed;
  }

  try {
    // If URL already has credentials in url, check if override needed
    if (trimmed.includes('@')) {
      const match = trimmed.match(/^(rtsp[s]?:\/\/)(?:[^:@\s]+)(?::[^@\s]+)?@(.+)$/i);
      if (match) {
        const protocol = match[1];
        const rest = match[2];
        const userPart = encodeURIComponent(username || '');
        const passPart = password ? `:${encodeURIComponent(password)}` : '';
        return `${protocol}${userPart}${passPart}@${rest}`;
      }
    }

    const match = trimmed.match(/^(rtsp[s]?:\/\/)(.+)$/i);
    if (match) {
      const protocol = match[1];
      const rest = match[2];
      const userPart = encodeURIComponent(username || '');
      const passPart = password ? `:${encodeURIComponent(password)}` : '';
      return `${protocol}${userPart}${passPart}@${rest}`;
    }
  } catch {
    // Fallback to raw URL if parsing fails
  }

  return trimmed;
}

export interface SanitizedCameraConfig {
  sourceType?: string;
  rtspUrl?: string;
  host?: string;
  port?: number;
  path?: string;
  transport?: 'tcp' | 'udp';
  credentialsConfigured?: boolean;
  username?: string;
  fps?: number;
  width?: number;
  height?: number;
  quality?: number;
  deviceIndex?: number;
  movementAutomationEnabled?: boolean;
  [key: string]: any;
}

/**
 * Sanitizes configMetadata for client consumption or safe audit logging.
 * Strips password and masks any credentials in rtspUrl.
 */
export function sanitizeCameraConfig(config: Record<string, any> = {}): SanitizedCameraConfig {
  const sanitized: Record<string, any> = { ...config };

  const hasPassword = Boolean(
    sanitized.password ||
    (typeof sanitized.rtspUrl === 'string' && /:[^@\s]+@/.test(sanitized.rtspUrl))
  );

  // Remove raw password
  delete sanitized.password;

  // Mask RTSP URL if present
  if (typeof sanitized.rtspUrl === 'string') {
    const rawUrl = sanitized.rtspUrl;
    sanitized.rtspUrl = redactRtspUrl(rawUrl);

    // Extract host, port, path for safe structured presentation
    try {
      const urlPattern = /^(?:rtsp[s]?:\/\/)(?:[^@\s]+@)?([^:/\s]+)(?::(\d+))?(\/[^\s]*)?$/i;
      const match = rawUrl.match(urlPattern);
      if (match) {
        sanitized.host = match[1];
        sanitized.port = match[2] ? parseInt(match[2], 10) : 554;
        sanitized.path = match[3] || '/';
      }
    } catch {}
  }

  // Mask username if present (or keep safe reference if not exposing)
  if (sanitized.username) {
    sanitized.username = '***';
  }

  sanitized.credentialsConfigured = hasPassword;

  return sanitized;
}
