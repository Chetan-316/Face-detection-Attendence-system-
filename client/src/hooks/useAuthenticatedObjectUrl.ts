import { useEffect, useState } from 'react';
import { getStoredToken } from '../api/client';

// <img> cannot send the Bearer header, so auth-protected images are fetched and exposed as blob URLs.
export function useAuthenticatedObjectUrl(url: string | null | undefined): string | undefined {
  const [objectUrl, setObjectUrl] = useState<string>();

  useEffect(() => {
    if (!url) {
      setObjectUrl(undefined);
      return;
    }

    let isActive = true;
    let created: string | undefined;
    const token = getStoredToken();

    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((response) => {
        if (!response.ok) throw new Error(`Image request failed with status ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        if (!isActive) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      })
      .catch(() => {
        if (isActive) setObjectUrl(undefined);
      });

    return () => {
      isActive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url]);

  return objectUrl;
}
