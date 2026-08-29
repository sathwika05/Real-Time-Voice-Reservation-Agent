import { Database, Mic, ShieldCheck, Waves } from "lucide-react";

const STEPS = [
  {
    Icon: Mic,
    title: "Speech to speech",
    body: "Amazon Nova Sonic over a bidirectional stream — audio in, audio out, with no transcribe-then-generate step in between. That is why replies begin in roughly 0.6s rather than the 2–3s a chained STT → LLM → TTS pipeline takes.",
  },
  {
    Icon: ShieldCheck,
    title: "Verification enforced in code",
    body: "The spoken date of birth is compared in Python, and the model only receives a boolean. Reservation tools refuse to run until it passes. Earlier, when the check lived in the system prompt, the model confirmed a wrong date of birth and a guest who did not exist.",
  },
  {
    Icon: Database,
    title: "Two-phase writes",
    body: "Changes are proposed and read back before anything is saved. The commit call requires the proposal's id, so the read-back cannot be skipped — the model has no id to commit with until it has proposed.",
  },
  {
    Icon: Waves,
    title: "Interruptible",
    body: "Speech output is paced to real time so queued audio stays server-side and can be discarded the moment the guest speaks. Optional local voice detection cuts playback without waiting for a network round trip.",
  },
];

export function HowItWorks() {
  return (
    // No background of its own: an opaque fill here painted over the fixed
    // backdrop and left a hard seam across the page once the field was
    // saturated enough to see.
    <section className="border-t border-line px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-[1200px]">
        <h2 className="text-[20px] font-semibold text-ink">How it works</h2>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">
          A real-time voice agent for hotel front-desk operations.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {STEPS.map(({ Icon, title, body }) => (
            <div key={title} className="rounded-lg border border-line bg-surface p-4">
              <h3 className="flex items-center gap-2 text-sm font-medium text-ink">
                <Icon className="size-4 text-brand" aria-hidden="true" />
                {title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-secondary">{body}</p>
            </div>
          ))}
        </div>

        <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3 rounded-lg border border-line bg-surface p-4">
          {[
            ["Median response", "0.626s"],
            ["Tool execution", "77–182ms"],
            ["Audio in / out", "16kHz / 24kHz"],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-ink-muted">{k}</dt>
              <dd className="font-mono text-sm text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
