"use client";

import { Mic, Square } from "lucide-react";
import { isIdle, STATE_META, TONE_RING, TONE_TEXT } from "@/lib/stateMeta";
import type { SessionState } from "@/lib/types";
import { Waveform } from "./Waveform";

/**
 * The microphone control and its state readout.
 *
 * When idle the button is filled with the primary colour: starting a session is
 * the page's single call to action, and an outline-only circle read as disabled
 * rather than inviting.
 */
export function VoiceDock({
  state,
  micLevel,
  agentLevel,
  fastInterrupt,
  onToggleFast,
  onStart,
  onStop,
  divided,
}: {
  state: SessionState;
  micLevel: number;
  agentLevel: number;
  fastInterrupt: boolean;
  onToggleFast: (v: boolean) => void;
  onStart: () => void;
  onStop: () => void;
  divided: boolean;   // False before the first line: nothing to divide from.
}) {
  const meta = STATE_META[state];
  const idle = isIdle(state);
  const agentTalking = state === "speaking";
  const listening = state === "listening";
  const Icon = meta.Icon;

  return (
    <div className={`flex shrink-0 flex-col items-center gap-2.5 px-4 py-4 ${
        divided ? "border-t border-line" : ""
      }`}>
      {/* Fixed height so the dock never shifts as the waveform changes. */}
      <div className="h-10 w-full max-w-[280px]">
        <Waveform
          level={agentTalking ? agentLevel : micLevel}
          active={listening || agentTalking}
          tone={agentTalking ? "brand" : "live"}
        />
      </div>

      <div className="flex flex-col items-center gap-2.5">
        {/* The orb. The wrapper is sized to the outermost ring rather than to
            the button, so the rings occupy real layout space - sized to the
            button they overhung it and struck the label below. The button
            keeps its own 80px hit area inside. */}
        <div
          className={`relative flex size-[7.75rem] items-center justify-center ${
            idle ? "" : "orb-live"
          }`}
        >
          <span className="orb-halo" aria-hidden="true" />
          <span className="orb-ring orb-ring-1" aria-hidden="true" />
          <span className="orb-ring orb-ring-2" aria-hidden="true" />

          <button
            type="button"
            onClick={idle ? onStart : onStop}
            aria-pressed={!idle}
            aria-label={idle ? "Start voice session" : "End voice session"}
            className={`group relative flex size-20 items-center justify-center rounded-full transition-all duration-200
              ${
                idle
                  ? "bg-brand text-brand-fg shadow-[0_10px_30px_-6px_var(--primary)] hover:bg-brand-hover"
                  : `border-2 bg-surface ${TONE_RING[meta.tone]}`
              }
              ${listening ? "animate-listening border-live" : ""}`}
          >
            {idle ? (
              <Mic className="size-7" aria-hidden="true" />
            ) : (
              <Square className="size-6 fill-ink text-ink" aria-hidden="true" />
            )}
          </button>
        </div>

        {/* The visible label IS the live region - a separate sr-only copy
            announced every state change twice. */}
        <div
          role="status"
          aria-live="polite"
          className="flex min-h-[40px] flex-col items-center gap-0.5 text-center"
        >
          <p className={`flex items-center gap-1.5 text-sm font-medium ${idle ? "text-ink" : TONE_TEXT[meta.tone]}`}>
            {!idle && (
              <Icon className={`size-4 ${meta.busy ? "animate-spin" : ""}`} aria-hidden="true" />
            )}
            {idle ? "Tap to speak" : meta.label}
          </p>
          {(meta.hint || idle) && (
            <p className="text-xs text-ink-muted">
              {idle ? "or press M" : meta.hint}
            </p>
          )}
        </div>
      </div>

      {/* Off by default: on speakers the mic hears the agent, and the agent
          would cut itself off mid-reply. */}
      <label className="flex min-h-[44px] cursor-pointer items-center gap-2 px-2 py-2 text-xs text-ink-muted">
        <input
          type="checkbox"
          checked={fastInterrupt}
          onChange={(e) => onToggleFast(e.target.checked)}
          className="size-4 accent-[var(--primary)]"
        />
        Fast interrupt (headphones only)
      </label>
    </div>
  );
}
