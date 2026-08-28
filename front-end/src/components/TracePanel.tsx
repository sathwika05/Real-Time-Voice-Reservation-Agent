"use client";

import { CircleCheck, CircleX, Loader2, Terminal, X } from "lucide-react";
import type { TraceEntry } from "@/lib/types";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function Entry({ e }: { e: TraceEntry }) {
  const Icon = e.status === "running" ? Loader2 : e.status === "ok" ? CircleCheck : CircleX;
  const tone = e.status === "running" ? "text-ink-muted" : e.status === "ok" ? "text-ok" : "text-bad";

  return (
    <li className="border-b border-line px-4 py-3 last:border-b-0">
      <div className="flex items-center gap-2">
        <Icon
          className={`size-3.5 shrink-0 ${tone} ${e.status === "running" ? "animate-spin" : ""}`}
          aria-hidden="true"
        />
        <span className="font-mono text-[12.5px] text-ink">{e.name}</span>
        {e.latencyMs !== null && (
          <span className="ml-auto font-mono text-[11px] text-ink-muted">{e.latencyMs}ms</span>
        )}
      </div>

      <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-ink-muted">
        → {JSON.stringify(e.args)}
      </p>

      {e.result && (
        <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-ink-secondary">
          ← {JSON.stringify(e.result).slice(0, 220)}
          {JSON.stringify(e.result).length > 220 ? "…" : ""}
        </p>
      )}
    </li>
  );
}

/**
 * Sanitized tool-call trace.
 *
 * Collapsed by default so the default experience is the conversation alone.
 * Values arrive already redacted from the server - personal fields never reach
 * the browser, so a screen recording of this panel cannot leak them.
 */
export function TracePanel({
  entries,
  open,
  onClose,
}: {
  entries: TraceEntry[];
  open: boolean;
  onClose: () => void;
}) {
  const p50 = median(
    entries.filter((e) => e.latencyMs !== null).map((e) => e.latencyMs as number),
  );

  const body = (
    <>
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Terminal className="size-4 text-ink-muted" aria-hidden="true" />
        <h2 className="text-[13px] font-semibold text-ink">Engineering trace</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close engineering trace"
          className="ml-auto rounded-md p-1 text-ink-muted hover:bg-subtle lg:hidden"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="px-4 py-6 text-[13px] text-ink-muted">
          Tool calls will appear here as the agent works.
        </p>
      ) : (
        <>
          <ul className="flex-1 overflow-y-auto">
            {entries.map((e) => (
              <Entry key={e.id} e={e} />
            ))}
          </ul>
          <div className="border-t border-line px-4 py-2 text-[11px] text-ink-muted">
            {entries.length} call{entries.length === 1 ? "" : "s"}
            {p50 !== null && (
              <>
                {" · "}median <span className="font-mono">{p50}ms</span>
              </>
            )}
          </div>
        </>
      )}
    </>
  );

  return (
    <>
      {/* Desktop: an inline column, not a modal - it never traps focus. */}
      {open && (
        <aside
          id="engineering-trace"
          className="hidden w-[380px] shrink-0 flex-col border-l border-line bg-surface lg:flex"
        >
          {body}
        </aside>
      )}

      {/* Mobile: a drawer, so the conversation keeps the full screen by default. */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={onClose}
            aria-hidden="true"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Engineering trace"
            className="absolute inset-x-0 bottom-0 flex max-h-[60vh] flex-col rounded-t-xl border-t border-line bg-surface shadow-[var(--shadow-md)]"
          >
            {body}
          </aside>
        </div>
      )}
    </>
  );
}
