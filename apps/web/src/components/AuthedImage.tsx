'use client';

import { useEffect, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Renders an <img> for a server-protected file. Fetches with the JWT and
 * exposes the result as an object URL. Cleans up the URL on unmount.
 */
export function AuthedImage({
  fileId,
  alt,
  className,
  onClick,
}: {
  fileId: string;
  alt?: string;
  className?: string;
  onClick?: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    (async () => {
      try {
        const token = window.localStorage.getItem('rentflow_token');
        const res = await fetch(`${API_BASE}/files/${fileId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (active) setSrc(objectUrl);
      } catch {
        if (active) setError(true);
      }
    })();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId]);

  if (error) {
    return (
      <div
        className={`flex items-center justify-center bg-offwhite text-xs text-gray-medium ${className ?? ''}`}
      >
        ✗ load failed
      </div>
    );
  }
  if (!src) {
    return (
      <div
        className={`flex items-center justify-center bg-offwhite text-xs text-gray-medium ${className ?? ''}`}
      >
        loading…
      </div>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt ?? ''} onClick={onClick} className={className} />;
}
