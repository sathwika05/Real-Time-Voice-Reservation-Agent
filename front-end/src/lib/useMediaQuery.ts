"use client";

import { useSyncExternalStore } from "react";

/**
 * Tracks a CSS media query.
 *
 * useSyncExternalStore rather than useEffect + setState: a media query is an
 * external store, and reading it this way avoids the cascading render that
 * setting state inside an effect causes. The server snapshot returns false so
 * markup matches on hydration.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
