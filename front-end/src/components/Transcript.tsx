"use client";

import { useEffect, useRef } from "react";
import { CircleCheck, CircleX, Loader2 } from "lucide-react";
import type { ProposedChange, TimelineItem } from "@/lib/types";

/** One tool call, rendered compactly so a chain of three does not dominate. */
function ToolRow({ item }: { item: Extract<TimelineItem, { kind: "tool" }> }) {
  const Icon = item.status === "running" ? Loader2 : item.status === "ok" ? CircleCheck : CircleX;
  const tone =
    item.status === "running" ? "text-ink-muted" : item.status === "ok" ? "text-ok" : "text-bad";

  return (
    <div className="flex items-center gap-2 py-1 text-[13px]">
      <Icon
        className={`size-4 shrink-0 ${tone} ${item.status === "running" ? "animate-spin" : ""}`}
        aria-hidden="true"
      />
      <span className="font-mono text-[12.5px] text-ink-secondary">{item.name}</span>
      <span className="text-ink-muted">
        {item.status === "running"
          ? "running…"
          : item.status === "ok"
            ? "succeeded"
            : "failed"}
      </span>
      {item.latencyMs !== null && (
        <span className="ml-auto font-mono text-xs text-ink-muted">{item.latencyMs}ms</span>
      )}
    </div>
  );
}

function ChangeList({ changes }: { changes: ProposedChange[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {changes.map((c, i) => (
        <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-mono text-[12.5px] text-ink-secondary">{c.field}</span>
          {c.from ? (
            <>
              <span className="text-ink-muted line-through">{c.from}</span>
              <span aria-hidden="true" className="text-ink-muted">→</span>
              <span className="font-medium text-ink">{c.to}</span>
            </>
          ) : (
            <span className="font-medium text-ink">+ {c.to}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The change the guest has been read back but has not yet agreed to.
 * Rendering it as a card makes the confirm-before-write step visible rather
 * than something buried in the spoken reply.
 */
function ProposalCard({ item }: { item: Extract<TimelineItem, { kind: "proposal" }> }) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        item.resolved ? "border-line bg-subtle opacity-60" : "border-warn bg-warn-subtle"
      }`}
    >
      <p className="mb-2 text-[13px] font-medium text-ink">
        {item.resolved ? "Change applied" : "Proposed change — not saved yet"}
      </p>
      <ChangeList changes={item.changes} />
      {!item.resolved && (
        <p className="mt-3 text-xs text-ink-secondary">
          Say <span className="font-medium text-ink">yes</span> to apply this, or{" "}
          <span className="font-medium text-ink">no</span> to cancel. Nothing has been written.
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
    <div className="rounded-xl border border-ok bg-ok-subtle p-4 shadow-[var(--shadow-md)]">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
        <CircleCheck className="size-4 text-ok" aria-hidden="true" />
        Reservation updated
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {[
          ["Reservation", item.reservationId],
          ["Room", r.roomNumber],
          ["Type", r.roomType],
          ["Check-in", r.checkInDate],
          ["Check-out", r.checkOutDate],
          ["Payment", r.paymentStatus],
        ].map(([label, value]) =>
          value ? (
            <div key={label}>
              <dt className="text-xs text-ink-muted">{label}</dt>
              <dd className="font-mono text-[12.5px] text-ink">{value}</dd>
            </div>
          ) : null,
        )}
      </dl>
      <div className="mt-3 border-t border-ok/25 pt-3">
        <ChangeList changes={item.changes} />
      </div>
    </div>
  );
}

export function Transcript({ items }: { items: TimelineItem[] }) {
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items.length]);

  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-16 text-center">
        <div className="max-w-sm">
          <p className="text-sm font-medium text-ink">Start a session to begin</p>
          <p className="mt-2 text-sm text-ink-muted">
            Give your name and date of birth to verify, then ask about your reservation.
          </p>
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
      className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-6 sm:px-6"
    >
      {items.map((item) => {
        if (item.kind === "tool") return <ToolRow key={item.id} item={item} />;
        if (item.kind === "proposal") return <ProposalCard key={item.id} item={item} />;
        if (item.kind === "confirmation") return <ConfirmationCard key={item.id} item={item} />;

        const isUser = item.role === "user";
        return (
          <div
            key={item.id}
            className={`animate-row-enter flex ${isUser ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-[17px] leading-[1.55] ${
                isUser ? "bg-brand-subtle text-ink" : "bg-subtle text-ink"
              }`}
            >
              <span className="sr-only">{isUser ? "You said: " : "Agent said: "}</span>
              {item.text}
            </div>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}
