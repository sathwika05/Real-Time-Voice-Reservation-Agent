"use client";

import { PanelRight } from "lucide-react";

export function Header({
  traceOpen,
  onToggleTrace,
  traceCount,
}: {
  traceOpen: boolean;
  onToggleTrace: () => void;
  traceCount: number;
}) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-3 px-5 sm:px-8">
      {/* Connection state lives on the conversation card, which owns the
          session. Repeating it here said the same thing twice. */}
      <h1 className="text-[14px] font-semibold tracking-[-0.01em] text-ink">Voice Reservations</h1>

      <button
        type="button"
        onClick={onToggleTrace}
        aria-expanded={traceOpen}
        aria-controls="engineering-trace"
        // 44px minimum touch target. Visually compact within a 56px header, but
        // large enough to hit reliably on a phone.
        className="ml-auto flex min-h-[44px] items-center gap-1.5 rounded-full border border-line bg-surface/70 px-4 text-[13px] text-ink-secondary backdrop-blur-sm transition-colors duration-160 hover:bg-surface"
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
