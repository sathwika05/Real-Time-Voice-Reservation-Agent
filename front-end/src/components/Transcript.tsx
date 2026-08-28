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
    <div className="flex justify-center">
      <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] ${tone}`}>
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
      className={`rounded-lg border p-4 ${
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
    <div className="rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow-sm)]">
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

export function Transcript({ items }: { items: TimelineItem[] }) {
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items.length]);

  // The empty state carries the journey: it tells a first-time visitor what to
  // say, which is the one thing a voice interface cannot show them.
  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col justify-center px-6 py-10">
        <div className="mx-auto w-full max-w-sm">
          <p className="text-[15px] font-semibold text-ink">Ready when you are</p>
          <p className="mt-1 text-sm text-ink-muted">
            Speak naturally — the agent will guide you through each step.
          </p>

          <ol className="mt-5 flex flex-col gap-3">
            {[
              ["Verify", "Give your name, then your date of birth"],
              ["Look up", "Ask about your upcoming reservation"],
              ["Change", "Request a new room type or check-out date"],
              ["Confirm", "The change is read back before anything is saved"],
            ].map(([title, body], i) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-subtle font-mono text-[11px] text-brand">
                  {i + 1}
                </span>
                <span className="text-sm leading-snug">
                  <span className="font-medium text-ink">{title}</span>
                  <span className="text-ink-muted"> — {body}</span>
                </span>
              </li>
            ))}
          </ol>
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
      className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-6"
    >
      {items.map((item) => {
        if (item.kind === "tool") return <ToolPill key={item.id} item={item} />;
        if (item.kind === "proposal") return <ProposalCard key={item.id} item={item} />;
        if (item.kind === "confirmation") return <ConfirmationCard key={item.id} item={item} />;

        const isUser = item.role === "user";
        return (
          <div
            key={item.id}
            className={`animate-row-enter flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}
          >
            <span className="px-1 text-xs text-ink-muted">{isUser ? "You" : "Agent"}</span>
            <div
              className={`max-w-[82%] px-4 py-2.5 text-[15px] leading-[1.5] ${
                isUser
                  ? "rounded-2xl rounded-br-md bg-brand text-brand-fg"
                  : "rounded-2xl rounded-bl-md bg-subtle text-ink"
              }`}
            >
              {item.text}
            </div>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}
