'use client';

import { useEffect } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Fires a one-shot beacon to record that a visitor landed on a tracked
 * marketplace link (`/p/<code>?s=<slug>`). Renders nothing. Best-effort —
 * a failed beacon never blocks the page.
 *
 * Why a client component? `fetch` from a server component runs on every
 * render including bot crawlers, which inflates click counts.
 */
export function ClickBeacon({ slug }: { slug: string }) {
  useEffect(() => {
    if (!slug) return;
    const safe = slug.replace(/[^A-Z0-9]/gi, '').slice(0, 16);
    if (!safe) return;
    // navigator.sendBeacon would be ideal but it requires POST; the API
    // endpoint is GET, so a fire-and-forget fetch works fine.
    fetch(`${API_BASE}/public/track/click/${safe}`, {
      method: 'GET',
      keepalive: true,
      cache: 'no-store',
      // Required so the API's anti-cheat dedup cookie (rfc_<slug>) is
      // sent and stored across cross-origin beacon hits.
      credentials: 'include',
    }).catch(() => {
      /* swallow — best-effort */
    });
  }, [slug]);

  return null;
}
