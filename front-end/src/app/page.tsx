"use client";

import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Header } from "@/components/Header";
import { HowItWorks } from "@/components/HowItWorks";
import { SessionStrip } from "@/components/SessionStrip";
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
    <div className="flex min-h-dvh flex-col">
      <Header
        state={s.state}
        traceOpen={traceOpen}
        onToggleTrace={() => setTraceOpen((v) => !v)}
        traceCount={s.trace.length}
      />

      <div className="flex min-h-0 flex-1">
        <main className="flex min-h-0 flex-1 flex-col">
          <SessionStrip guest={s.verifiedGuest} />

          {/* Errors are assertive: the user needs them now, not after the
              current announcement finishes. */}
          {s.error && (
            <div
              role="status"
              aria-live="assertive"
              className="flex items-start gap-2 border-b border-bad bg-bad-subtle px-4 py-3 text-sm text-ink sm:px-6"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden="true" />
              <span>{s.error}</span>
            </div>
          )}

          <div className="mx-auto flex min-h-0 w-full max-w-[720px] flex-1 flex-col">
            <Transcript items={s.timeline} />
          </div>

          <VoiceDock
            state={s.state}
            micLevel={s.micLevel}
            agentLevel={s.agentLevel}
            fastInterrupt={s.fastInterrupt}
            onToggleFast={s.setFastInterrupt}
            onStart={() => void s.start()}
            onStop={() => void s.stop()}
          />
        </main>

        <div id="engineering-trace">
          <TracePanel entries={s.trace} open={traceOpen} onClose={() => setTraceOpen(false)} />
        </div>
      </div>

      <HowItWorks />
    </div>
  );
}
