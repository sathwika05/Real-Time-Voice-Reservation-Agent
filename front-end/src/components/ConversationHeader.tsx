"use client";

import { AudioLines, LogOut, RotateCcw, ShieldCheck, ShieldQuestion } from "lucide-react";
import type { SessionState } from "@/lib/types";
import { STATE_META, TONE_TEXT } from "@/lib/stateMeta";

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
  onRestart,
  onEnd,
}: {
  state: SessionState;
  guest: string | null;
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
          <p className="text-[15px] font-semibold leading-tight text-ink">Front Desk</p>
          <p className="text-[13px] text-ink-muted">Hotel reservation assistant</p>
        </div>

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
            disabled={!live}
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
