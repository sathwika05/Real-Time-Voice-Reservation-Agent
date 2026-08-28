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
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4 sm:px-6">
      {/* Connection state lives on the conversation card, which owns the
          session. Repeating it here said the same thing twice. */}
      <h1 className="text-[15px] font-semibold text-ink">Voice Reservations</h1>

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
