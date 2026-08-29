"use client";

import { useEffect, useRef } from "react";
import { CircleCheck, CircleX, Database, Loader2 } from "lucide-react";
import { toolSummary } from "@/lib/toolDisplay";
import type { ProposedChange, TimelineItem } from "@/lib/types";

/**
 * Tool activity as an inline pill.
 *
 * Human-readable rather than a raw tool name: the conversation should read as a
 * conversation, with the engineering detail available in the trace panel for
 * anyone who wants it.
 */
function ToolPill({ item }: { item: Extract<TimelineItem, { kind: "tool" }> }) {
  const running = item.status === "running";
  const ok = item.status === "ok";
  const Icon = running ? Loader2 : ok ? (item.name === "updateReservationTool" ? CircleCheck : Database) : CircleX;

  const tone = running
    ? "bg-subtle text-ink-muted"
    : ok
      ? "bg-ok-subtle text-ok"
      : "bg-bad-subtle text-bad";

  return (
    <div className="flex">
      <span className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 font-mono text-[12px] ${tone}`}>
        <Icon className={`size-3.5 shrink-0 ${running ? "animate-spin" : ""}`} aria-hidden="true" />
        {running ? `Running ${item.name}…` : toolSummary(item.name, ok, item.result)}
        {item.latencyMs !== null && (
          <span className="font-mono text-[11px] opacity-70">{item.latencyMs}ms</span>
        )}
      </span>
    </div>
  );
}

function ChangeList({ changes }: { changes: ProposedChange[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {changes.map((c, i) => (
        <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-mono text-[12.5px] text-ink-secondary">{c.field}</span>
          {c.from ? (
            <>
              <span className="text-ink-muted line-through">{c.from}</span>
              <span aria-hidden="true" className="text-ink-muted">→</span>
              <span className="font-semibold text-ink">{c.to}</span>
            </>
          ) : (
            <span className="font-semibold text-ink">+ {c.to}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The change read back to the guest, before anything has been written. */
function ProposalCard({ item }: { item: Extract<TimelineItem, { kind: "proposal" }> }) {
  return (
    <div
      className={`max-w-[34rem] rounded-lg border p-4 ${
        item.resolved ? "border-line bg-subtle opacity-55" : "border-warn bg-warn-subtle"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-ink">
          {item.resolved ? "Change applied" : "Proposed change"}
        </p>
        {!item.resolved && (
          <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-medium text-warn">
            Not saved yet
          </span>
        )}
      </div>
      <ChangeList changes={item.changes} />
      {!item.resolved && (
        <p className="mt-3 text-xs text-ink-secondary">
          Say <span className="font-semibold text-ink">yes</span> to apply this, or{" "}
          <span className="font-semibold text-ink">no</span> to cancel.
        </p>
      )}
      <p className="mt-2 font-mono text-[11px] text-ink-muted">{item.proposalId}</p>
    </div>
  );
}

/** The end of the journey: what was actually written. */
function ConfirmationCard({ item }: { item: Extract<TimelineItem, { kind: "confirmation" }> }) {
  const r = item.reservation as Record<string, string>;
  return (
    <div className="max-w-[34rem] rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow-sm)]">
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-line pb-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <CircleCheck className="size-4 text-ok" aria-hidden="true" />
          Reservation updated
        </p>
        <span className="font-mono text-[13px] font-medium text-brand">{item.reservationId}</span>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        {[
          ["Room", r.roomNumber],
          ["Type", r.roomType],
          ["Check-in", r.checkInDate],
          ["Check-out", r.checkOutDate],
          ["Payment", r.paymentStatus],
        ].map(([label, value]) =>
          value ? (
            <div key={label} className="flex items-baseline justify-between gap-2">
              <dt className="text-xs text-ink-muted">{label}</dt>
              <dd className="font-mono text-[12.5px] text-ink">{value}</dd>
            </div>
          ) : null,
        )}
      </dl>
    </div>
  );
}

/**
 * What the left edge says about one event: its rail colour, and the word in
 * the gutter beside it.
 *
 * Speaker colour follows the reference - violet for the agent, coral for the
 * person. The cyan --live stays reserved for connection state, which is a
 * different axis from who is talking.
 */
function rowMeta(item: TimelineItem): {
  tone: string;
  label: string;
  labelTone: string;
  labelPad: string;
} {
  if (item.kind === "message")
    return item.role === "user"
      ? { tone: "rail-user", label: "Guest", labelTone: "text-accent", labelPad: "sm:pt-[9px]" }
      : { tone: "rail-agent", label: "Agent", labelTone: "text-brand", labelPad: "sm:pt-[9px]" };

  if (item.kind === "tool")
    return {
      tone: item.status === "ok" ? "rail-ok" : item.status === "error" ? "rail-bad" : "",
      label: "Tool",
      labelTone: "text-ink-muted",
      labelPad: "sm:pt-[5px]",
    };

  if (item.kind === "proposal")
    return item.resolved
      ? { tone: "rail-ok", label: "Applied", labelTone: "text-ink-muted", labelPad: "sm:pt-[15px]" }
      : { tone: "rail-warn", label: "Review", labelTone: "text-warn", labelPad: "sm:pt-[15px]" };

  return { tone: "rail-ok", label: "Saved", labelTone: "text-ok", labelPad: "sm:pt-[15px]" };
}

/**
 * One entry: rail segment, gutter label, content.
 *
 * The rail is a continuous spine down the left of the conversation with a
 * segment per event. Reading it top-to-bottom is reading the session: who
 * spoke, what ran, what succeeded. The gutter carries the same information in
 * words, so the meaning does not rest on colour alone.
 *
 * Below sm the gutter would eat the width the message needs, so the label
 * stacks above the content instead of sitting beside it. One markup, two
 * layouts - the inner div is a block on small screens and a grid above them.
 */
function Row({
  tone,
  label,
  labelTone,
  labelPad = "",
  children,
}: {
  tone: string;
  label: string;
  labelTone: string;
  labelPad?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="animate-row-enter grid grid-cols-[4px_1fr] gap-3 sm:gap-4">
      <span className={`rail ${tone}`} aria-hidden="true" />
      <div className="min-w-0 sm:grid sm:grid-cols-[54px_1fr] sm:gap-4">
        <span
          className={`mb-1 block font-mono text-[10.5px] uppercase leading-[1.7] tracking-[0.1em] sm:mb-0 ${labelPad} ${labelTone}`}
        >
          {label}
        </span>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

function renderItem(item: TimelineItem) {
  if (item.kind === "tool") return <ToolPill item={item} />;
  if (item.kind === "proposal") return <ProposalCard item={item} />;
  if (item.kind === "confirmation") return <ConfirmationCard item={item} />;

  // Speech as a bubble. The role already sits in the gutter, so the two sides
  // are told apart by fill and measure rather than by repeating the name: the
  // guest speaks in short turns and gets the narrower, tinted bubble.
  const isUser = item.role === "user";
  return (
    <div
      className={`w-fit rounded-2xl px-4 py-2.5 text-[15px] leading-[1.55] ${
        isUser
          ? "max-w-[26rem] rounded-tl-md bg-accent-subtle font-medium text-ink"
          : "max-w-[34rem] rounded-tl-md border border-line bg-subtle text-ink-secondary"
      }`}
    >
      {item.text}
    </div>
  );
}

export function Transcript({ items }: { items: TimelineItem[] }) {
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;

    // Scroll the transcript container itself rather than calling
    // scrollIntoView on a sentinel: scrollIntoView walks up and scrolls every
    // scrollable ancestor, which dragged the whole page down on each new line.
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [items.length]);

  // The empty state doubles as a key: it lays the four steps out on the same
  // rail the conversation will use, so the colour language is already learned
  // by the time the first line arrives. Order is load-bearing here - identity
  // must be verified before anything can be looked up or changed.
  if (items.length === 0) {
    return (
      // Auto margin rather than justify-center: on a scroll container,
      // centring with justify-content pushes overflow past the start edge
      // where it cannot be scrolled back to. An auto margin collapses to 0
      // once free space runs out, so tall content scrolls instead of clipping.
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-5">
        {/* Bottom-anchored, not centred: with nothing else in the panel, a
            centred headline left a hole between itself and the dock. Pushed
            down, it reads as one column with the orb - and the remaining
            space collects under the status bar, where space is expected. */}
        <div className="mx-auto mt-auto w-full max-w-lg text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
            Session
          </p>
          {/* The whole empty state. Everything that used to sit under this -
              a rule, a line of instruction, a four-step key - is gone: the
              dock below already says "Tap to speak", and the rail teaches
              itself once the first lines arrive. */}
          <h2 className="mt-2 text-[30px] font-semibold leading-[1.08] tracking-[-0.02em] text-ink">
            Ready when
            <br />
            you are
          </h2>
        </div>
      </div>
    );
  }

  return (
    <div
      // Only final lines are appended, so a screen reader is not flooded with
      // partial transcripts as the guest speaks.
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Conversation transcript"
      ref={scroller}
      className="rail-track flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-6"
    >
      {items.map((item) => (
        <Row key={item.id} {...rowMeta(item)}>
          {renderItem(item)}
        </Row>
      ))}
    </div>
  );
}
