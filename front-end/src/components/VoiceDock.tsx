"use client";

import { Mic, Square } from "lucide-react";
import { STATE_META, TONE_RING, TONE_TEXT } from "@/lib/stateMeta";
import type { SessionState } from "@/lib/types";
import { Waveform } from "./Waveform";

/**
 * The microphone control and its state readout.
 *
 * Deliberately the most prominent element on the page: in a voice interface the
 * user's first question is always "is it listening?", and the answer must be
 * unmissable.
 */
export function VoiceDock({
  state,
  micLevel,
  agentLevel,
  fastInterrupt,
  onToggleFast,
  onStart,
  onStop,
}: {
  state: SessionState;
  micLevel: number;
  agentLevel: number;
  fastInterrupt: boolean;
  onToggleFast: (v: boolean) => void;
  onStart: () => void;
  onStop: () => void;
}) {
  const meta = STATE_META[state];
  const idle = state === "disconnected" || state === "ended" || state === "mic_denied";
  const agentTalking = state === "speaking";

  const Icon = meta.Icon;

  return (
    <div className="border-t border-line bg-surface px-4 pb-[env(safe-area-inset-bottom)] pt-4">
      <div className="mx-auto flex max-w-[720px] flex-col items-center gap-3">
        {/* Fixed height so the dock never shifts as the waveform changes. */}
        <div className="h-10 w-full max-w-[280px]">
          <Waveform
            level={agentTalking ? agentLevel : micLevel}
            active={state === "listening" || agentTalking}
            tone={agentTalking ? "brand" : "live"}
          />
        </div>

        <button
          type="button"
          onClick={idle ? onStart : onStop}
          aria-pressed={!idle}
          aria-label={idle ? "Start voice session" : "End voice session"}
          className={`flex size-16 items-center justify-center rounded-full border-2 transition-colors duration-160 sm:size-[72px]
            ${idle ? "bg-surface " + TONE_RING[meta.tone] : "bg-brand border-brand"}
            ${state === "listening" ? "animate-listening border-live" : ""}
            hover:opacity-90`}
        >
          {idle ? (
            <Mic className="size-6 text-ink" aria-hidden="true" />
          ) : (
            <Square className="size-5 fill-brand-fg text-brand-fg" aria-hidden="true" />
          )}
        </button>

        {/* The label is the accessible source of truth for state, which is why
            the waveform and the pulse can both be purely decorative. */}
        <div
          // The visible label IS the live region. Announcing from a separate
          // sr-only node duplicated every state change for screen readers.
          role="status"
          aria-live="polite"
          className="flex min-h-[44px] flex-col items-center gap-1 text-center"
        >
          <p className={`flex items-center gap-1 text-[13px] font-medium ${TONE_TEXT[meta.tone]}`}>
            <Icon className={`size-4 ${meta.busy ? "animate-spin" : ""}`} aria-hidden="true" />
            {meta.label}
          </p>
          {meta.hint && <p className="text-xs text-ink-muted">{meta.hint}</p>}
        </div>

        {/* The label carries the hit area: py-3 brings the whole control to
            44px tall even though the box itself is small. */}
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2 px-2 py-3 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={fastInterrupt}
            onChange={(e) => onToggleFast(e.target.checked)}
            className="size-5 accent-[var(--primary)]"
          />
          {/* Off by default: on speakers the mic hears the agent, and the agent
              would cut itself off mid-reply. */}
          Fast interrupt (headphones only)
        </label>
      </div>
    </div>
  );
}
