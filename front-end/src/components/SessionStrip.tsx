"use client";

import { ShieldCheck, ShieldQuestion } from "lucide-react";

/**
 * Persistent answer to "does it know who I am?".
 *
 * Verification is enforced server-side, so this reflects real state rather
 * than something the model claimed.
 */
export function SessionStrip({ guest }: { guest: string | null }) {
  return (
    <div className="flex items-center gap-2 border-b border-line bg-subtle px-4 py-2 text-xs sm:px-6">
      {guest ? (
        <>
          <ShieldCheck className="size-3.5 text-ok" aria-hidden="true" />
          <span className="text-ink-secondary">Verified</span>
          <span className="font-mono text-[12px] text-ink">{guest}</span>
        </>
      ) : (
        <>
          <ShieldQuestion className="size-3.5 text-ink-muted" aria-hidden="true" />
          <span className="text-ink-muted">
            Not verified — reservation details are withheld until identity is confirmed
          </span>
        </>
      )}
    </div>
  );
}
