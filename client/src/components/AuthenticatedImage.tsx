import React from 'react';
import { useAuthenticatedObjectUrl } from '../hooks/useAuthenticatedObjectUrl';

interface AuthenticatedImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string | null | undefined;
}

// Renders nothing when the image cannot be loaded, so surrounding fallback placeholders stay visible.
export const AuthenticatedImage: React.FC<AuthenticatedImageProps> = ({ src, ...imgProps }) => {
  const objectUrl = useAuthenticatedObjectUrl(src);

  if (!objectUrl) return null;

  return <img {...imgProps} src={objectUrl} />;
};
