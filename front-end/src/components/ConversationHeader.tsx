"use client";

import { AudioLines, LogOut, RotateCcw, ShieldCheck, ShieldQuestion } from "lucide-react";
import type { SessionState } from "@/lib/types";
import { isIdle, STATE_META, TONE_TEXT } from "@/lib/stateMeta";

const LIVE: SessionState[] = [
  "listening",
  "processing",
  "speaking",
  "executing_tool",
  "awaiting_confirmation",
];

/**
 * Branded header for the conversation card, with the session actions.
 *
 * Gives the workspace an identity and a clear way out, which a bare transcript
 * pane lacks.
 */
export function ConversationHeader({
  state,
  guest,
  stats,
  onRestart,
  onEnd,
}: {
  state: SessionState;
  guest: string | null;
  stats: { calls: number; median: number | null };
  onRestart: () => void;
  onEnd: () => void;
}) {
  const live = LIVE.includes(state);
  const meta = STATE_META[state];

  return (
    <div className="border-b border-line">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-fg">
          <AudioLines className="size-5" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          {/* Sans, like the headline below it. Mono stays for the things that
              are data - ids, latencies, field names - where the fixed width
              earns its keep. Used as a display face it made the card speak in
              two voices at once. */}
          <p className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Front desk</p>
          <p className="text-[13px] text-ink-muted">Voice reservations · Nova Sonic</p>
        </div>

        {/* Latency is this product's whole thesis, so the numbers are content,
            not a footnote. */}
        {stats.calls > 0 && (
          <dl className="hidden items-center gap-5 border-l border-line pl-5 sm:flex">
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">
                Median
              </dt>
              <dd className="font-mono text-[15px] text-ink">{stats.median}ms</dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">
                Calls
              </dt>
              <dd className="font-mono text-[15px] text-ink">{stats.calls}</dd>
            </div>
          </dl>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRestart}
            className="flex min-h-[40px] items-center gap-1.5 rounded-md border border-line px-3 text-[13px] text-ink-secondary transition-colors duration-160 hover:bg-subtle"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            New conversation
          </button>
          <button
            type="button"
            onClick={onEnd}
            // Not `!live`: that only covered the states where the agent is
            // actively conversing, so while connecting, reconnecting, waiting
            // on the mic prompt, or sitting in an error there was no way to
            // hang up - the dock's stop button worked but this one did not.
            disabled={isIdle(state)}
            className="flex min-h-[40px] items-center gap-1.5 rounded-md border border-line px-3 text-[13px] text-ink-secondary transition-colors duration-160 hover:bg-subtle disabled:opacity-40"
          >
            <LogOut className="size-3.5" aria-hidden="true" />
            End call
          </button>
        </div>
      </div>

      {/* One status row, not two. Connection and verification are both session
          facts and belong together; a separate strip repeated the same words.
          Status is a dot AND a word - never colour alone. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line px-5 py-2.5">
        <span
          className={`size-2 shrink-0 rounded-full ${live ? "bg-ok" : "bg-ink-muted"}`}
          aria-hidden="true"
        />
        <p className={`text-[13px] ${live ? "text-ink" : "text-ink-muted"}`}>
          {live ? "Connected" : "Not connected"}
          {/* Only append the state when it says something the connection word
              does not - otherwise it reads "Not connected · Not connected". */}
          {live && <span className={TONE_TEXT[meta.tone]}> · {meta.label}</span>}
        </p>

        <span className="ml-auto flex items-center gap-1.5 text-[12.5px]">
          {guest ? (
            <>
              <ShieldCheck className="size-3.5 text-ok" aria-hidden="true" />
              <span className="text-ink-secondary">Verified</span>
              <span className="font-mono text-ink">{guest}</span>
            </>
          ) : (
            <>
              <ShieldQuestion className="size-3.5 text-ink-muted" aria-hidden="true" />
              <span className="text-ink-muted">Not verified</span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
