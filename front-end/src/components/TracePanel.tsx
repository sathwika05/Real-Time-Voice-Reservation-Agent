"use client";

import { X } from "lucide-react";
import { toolFields, toolTitle } from "@/lib/toolDisplay";
import type { TraceEntry } from "@/lib/types";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** One tool call as a labelled card rather than a JSON dump. */
function Card({ e }: { e: TraceEntry }) {
  const fields = toolFields(e.name, e.args, e.result, e.latencyMs);
  const status =
    e.status === "running" ? "Running" : e.status === "ok" ? "Success" : "Failed";
  const tone =
    e.status === "running" ? "text-ink-muted" : e.status === "ok" ? "text-ok" : "text-bad";

  return (
    <li className="rounded-lg border border-panel-line bg-panel-raised p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[12.5px] text-panel-ink">{toolTitle(e.name)}</span>
        <span className={`text-[12px] font-medium ${tone}`}>{status}</span>
      </div>

      <dl className="mt-2.5 flex flex-col gap-1.5">
        {fields.map((f) => (
          <div key={f.label} className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-[12px] text-panel-muted">{f.label}</dt>
            <dd className="truncate text-right font-mono text-[12px] text-panel-ink">{f.value}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

/**
 * What the panel will show, before it has anything to show.
 *
 * The three tools the agent can actually call, in the order the backend
 * enforces - identity first, and nothing else runs until it passes. Drawn as
 * the same cards the real entries use, so the trace fills these slots in
 * rather than replacing an unrelated message.
 */
const SEQUENCE: { name: string; body: string }[] = [
  {
    name: "check_guest_profile",
    body: "Matches the spoken name and date of birth against DynamoDB. The model receives only a boolean, and the reservation tools refuse to run until this passes.",
  },
  {
    name: "check_reservation_status",
    body: "Reads the upcoming reservation for a verified guest. Date of birth, email and phone are redacted server-side before anything reaches this panel.",
  },
  {
    name: "update_reservation",
    body: "Two calls, never one: a proposal that writes nothing and is read back to the guest, then a commit carrying that proposal's id.",
  },
];

function PendingSequence() {
  return (
    // The auto margin on the first child bottoms the sequence out, so this
    // column ends level with the conversation card's. Not justify-end: on a
    // scroll container that pushes overflow past the start edge where it
    // cannot be reached, whereas an auto margin collapses to 0 first.
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
      <p className="mb-0.5 mt-auto font-mono text-[10.5px] uppercase tracking-[0.12em] text-panel-muted">
        Awaiting first call
      </p>

      {SEQUENCE.map(({ name, body }, i) => (
        <div
          key={name}
          // Dashed and dimmed: these are slots, not results. A solid card here
          // would read as something that had already run.
          className="rounded-lg border border-dashed border-panel-line p-3"
        >
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[11px] text-panel-accent">{i + 1}</span>
            <span className="font-mono text-[12.5px] text-panel-ink/70">{name}</span>
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-panel-muted">{body}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * Sanitized tool-call trace.
 *
 * Collapsed by default, so the default experience is the conversation alone.
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
  const p50 = median(entries.filter((e) => e.latencyMs !== null).map((e) => e.latencyMs as number));

  const body = (
    <>
      <div className="flex items-start justify-between gap-2 px-4 pb-3 pt-4">
        <div>
          <h2 className="text-[15px] font-semibold text-panel-ink">Tool activity</h2>
          <p className="mt-1 text-[12.5px] leading-snug text-panel-muted">
            Every reply is grounded in a real backend call, shown here as it happens.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close tool activity"
          className="-mr-1 rounded-md p-1.5 text-panel-muted hover:bg-panel-raised lg:hidden"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      {entries.length === 0 ? (
        <PendingSequence />
      ) : (
        <ul className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 pb-4">
          {entries.map((e) => (
            <Card key={e.id} e={e} />
          ))}
        </ul>
      )}

      {/* The guarantees are part of the point, so they are stated rather than
          left for a reader to infer from the values. */}
      <div className="mt-auto border-t border-panel-line px-4 py-3 text-[11.5px] leading-relaxed text-panel-muted">
        Arguments validated before execution · Confirmation required before write · Date of birth,
        email and phone redacted server-side
        {p50 !== null && (
          <>
            {" · "}median <span className="font-mono text-panel-ink">{p50}ms</span>
          </>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* Desktop: a sibling card, not a modal - it never traps focus. */}
      {open && (
        <aside
          id="engineering-trace"
          className="hidden h-[calc(100dvh-9rem)] min-h-[520px] w-[340px] shrink-0 flex-col overflow-hidden rounded-[var(--radius-xl)] bg-panel shadow-[var(--shadow-md)] lg:flex"
        >
          {body}
        </aside>
      )}

      {/* Mobile: a drawer, so the conversation keeps the full screen by default. */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Tool activity"
            className="absolute inset-x-0 bottom-0 flex max-h-[65vh] flex-col rounded-t-[var(--radius-xl)] bg-panel shadow-[var(--shadow-md)]"
          >
            {body}
          </aside>
        </div>
      )}
    </>
  );
}
