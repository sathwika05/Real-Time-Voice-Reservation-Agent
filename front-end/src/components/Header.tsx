"use client";

import { PanelRight, Wifi, WifiOff } from "lucide-react";
import type { SessionState } from "@/lib/types";

const LIVE: SessionState[] = [
  "ready",
  "listening",
  "processing",
  "speaking",
  "executing_tool",
  "awaiting_confirmation",
];

export function Header({
  state,
  traceOpen,
  onToggleTrace,
  traceCount,
}: {
  state: SessionState;
  traceOpen: boolean;
  onToggleTrace: () => void;
  traceCount: number;
}) {
  const connected = LIVE.includes(state);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4 sm:px-6">
      <h1 className="text-[15px] font-semibold text-ink">Voice Reservations</h1>

      {/* Shape and word, not colour alone. */}
      <span
        className={`flex items-center gap-1.5 text-xs ${connected ? "text-ok" : "text-ink-muted"}`}
      >
        {connected ? (
          <Wifi className="size-3.5" aria-hidden="true" />
        ) : (
          <WifiOff className="size-3.5" aria-hidden="true" />
        )}
        {connected ? "Connected" : "Offline"}
      </span>

      <button
        type="button"
        onClick={onToggleTrace}
        aria-expanded={traceOpen}
        aria-controls="engineering-trace"
        // 44px minimum touch target. Visually compact within a 56px header, but
        // large enough to hit reliably on a phone.
        className="ml-auto flex min-h-[44px] items-center gap-1.5 rounded-md border border-line-interactive px-3 text-[13px] text-ink-secondary transition-colors duration-160 hover:bg-subtle"
      >
        <PanelRight className="size-3.5" aria-hidden="true" />
        Trace
        {traceCount > 0 && (
          <span className="font-mono text-[11px] text-ink-muted">{traceCount}</span>
        )}
      </button>
    </header>
  );
}
