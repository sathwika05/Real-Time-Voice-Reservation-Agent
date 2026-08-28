"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(callback: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

/**
 * Tracks the reduced-motion preference.
 *
 * useSyncExternalStore rather than useEffect + setState: a media query is an
 * external store, and reading it this way avoids the cascading render that
 * setting state inside an effect causes. The server snapshot returns false so
 * markup matches on hydration.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
