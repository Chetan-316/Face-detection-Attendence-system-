import { useEffect, useState } from 'react';
import { camerasApi } from '../api/cameras.api';

// Resolves a camera preview URL carrying a short-lived stream token. Pass retryKey to request a fresh token.
export function usePreviewStreamUrl(cameraId: string | null | undefined, retryKey = 0): string {
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (!cameraId) {
      setUrl('');
      return;
    }

    let isActive = true;
    Promise.resolve()
      .then(() => camerasApi.getPreviewStreamUrl(cameraId))
      .then((next) => {
        if (isActive) setUrl(next);
      })
      .catch(() => {
        if (isActive) setUrl('');
      });

    return () => {
      isActive = false;
    };
  }, [cameraId, retryKey]);

  return url;
}
