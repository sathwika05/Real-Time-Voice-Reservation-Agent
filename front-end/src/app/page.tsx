"use client";

import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Header } from "@/components/Header";
import { HowItWorks } from "@/components/HowItWorks";
import { ConversationHeader } from "@/components/ConversationHeader";
import { TracePanel } from "@/components/TracePanel";
import { Transcript } from "@/components/Transcript";
import { VoiceDock } from "@/components/VoiceDock";
import { useVoiceSession } from "@/lib/useVoiceSession";

export default function Page() {
  const s = useVoiceSession();
  const [traceOpen, setTraceOpen] = useState(false);

  // Keyboard shortcut for the microphone, suppressed while typing so it cannot
  // fire from a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ["INPUT", "TEXTAREA"].includes(el.tagName)) return;

      if (e.key.toLowerCase() === "m") {
        const idle = ["disconnected", "ended", "mic_denied"].includes(s.state);
        if (idle) {
          void s.start();
        } else {
          void s.stop();
        }
      }
      if (e.key === "Escape") setTraceOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s]);

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <Header
        traceOpen={traceOpen}
        onToggleTrace={() => setTraceOpen((v) => !v)}
        traceCount={s.trace.length}
      />

      {/* The workspace sits on the canvas as a defined surface rather than
          bleeding into it - canvas-on-canvas read as an unstyled wireframe. */}
      <main className="flex flex-1 items-start justify-center px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex w-full max-w-[1120px] items-stretch gap-4">
          <section className="flex min-h-[520px] flex-1 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-[var(--shadow-xs)]">
            <ConversationHeader
              state={s.state}
              guest={s.verifiedGuest}
              onRestart={() => {
                void s.stop().then(() => s.start());
              }}
              onEnd={() => void s.stop()}
            />

            {/* Assertive: the user needs an error now, not after the current
                announcement finishes. */}
            {s.error && (
              <div
                role="status"
                aria-live="assertive"
                className="flex items-start gap-2 border-b border-bad bg-bad-subtle px-5 py-3 text-sm text-ink"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden="true" />
                <span>{s.error}</span>
              </div>
            )}

            <Transcript items={s.timeline} />

            <VoiceDock
              state={s.state}
              micLevel={s.micLevel}
              agentLevel={s.agentLevel}
              fastInterrupt={s.fastInterrupt}
              onToggleFast={s.setFastInterrupt}
              onStart={() => void s.start()}
              onStop={() => void s.stop()}
            />
          </section>

          <TracePanel entries={s.trace} open={traceOpen} onClose={() => setTraceOpen(false)} />
        </div>
      </main>

      <HowItWorks />
    </div>
  );
}
