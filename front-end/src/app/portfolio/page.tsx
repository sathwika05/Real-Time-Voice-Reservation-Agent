import type { Metadata } from "next";
import { Play } from "lucide-react";
import { HowItWorks } from "@/components/HowItWorks";
import { MeshBackdrop } from "@/components/MeshBackdrop";

export const metadata: Metadata = {
  title: "Real-Time Voice Reservation Agent",
  description:
    "A speech-to-speech hotel front-desk agent on Amazon Nova Sonic. Verifies identity, reads and modifies reservations in DynamoDB, and can be interrupted mid-sentence.",
};

/**
 * The demo recording.
 *
 * Left null the video slot renders a placeholder frame in the same surface
 * language as the rest of the page. Fill it in and the same slot becomes the
 * real player - nothing else on this page needs to change:
 *
 *   file  - drop demo.mp4 in front-end/public, then { kind: "file", src: "/demo.mp4" }
 *   embed - a YouTube or Loom share URL, then { kind: "embed", src: "https://..." }
 */
const DEMO_VIDEO: { kind: "file" | "embed"; src: string; poster?: string } | null = {
  kind: "file",
  src: "/demo.mp4",
  poster: "/demo-poster.jpg",
};

/**
 * One measure for the whole page. The navbar, the hero panel, the demo frame
 * and HowItWorks below all resolve to the same left and right edge, so the
 * shared component needs no change to sit on the same grid.
 *
 * 1248 rather than 1200 because HowItWorks carries its gutter on the OUTER
 * element and its max-width on the inner one, giving a 1200px content box
 * inside a 24px gutter. Padding inside a 1200px box instead yields 1152 and
 * the bottom of the page sits 24px wider than everything above it.
 */
const GITHUB_URL = "https://github.com/sathwika05/Real-Time-Voice-Reservation-Agent";

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

const SHELL = "mx-auto w-full max-w-[1248px] px-4 sm:px-6";

const STACK = [
  "Amazon Nova Sonic",
  "AWS Bedrock",
  "Python asyncio",
  "FastAPI",
  "Next.js",
  "DynamoDB",
];

export default function PortfolioPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <MeshBackdrop />

      <header className="shrink-0">
        <div className={SHELL}>
          <div className="flex h-16 items-center gap-3">
            <span className="text-[14px] font-semibold tracking-[-0.01em] text-ink">
              Voice Reservations
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 pb-16">
        {/* Hero ---------------------------------------------------------- */}
        {/* The hero owns the first screen: 4rem of header plus this equals one
            viewport, so the fold lands inside this section's own empty space and
            the next section starts below it - nothing peeks, nothing is cut.
            min-height, not height: on a short window the panel outgrows the
            screen and the section grows with it rather than trapping it. */}
        <section className={`${SHELL} flex min-h-[calc(100dvh-4rem)] flex-col justify-center py-6`}>
          {/* Frosted rather than opaque: the glow field has to stay legible
              through the panel, otherwise this is a white box on a gradient
              instead of a surface lit by it. */}
          <div className="rounded-[28px] border border-white/70 bg-white/50 px-6 py-12 text-center shadow-[var(--shadow-md)] backdrop-blur-xl sm:px-16 sm:py-[70px]">
            <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-secondary">
              Speech-to-speech agent
            </p>

            <h1 className="mx-auto mt-4 max-w-[16ch] text-[38px] font-semibold leading-[1.06] tracking-[-0.025em] text-ink sm:text-[56px]">
              Real-Time Voice Reservation Agent
            </h1>

            <p className="mx-auto mt-5 max-w-[62ch] text-[17px] leading-relaxed text-ink-secondary">
              A voice-driven hotel front-desk agent built on Amazon Nova Sonic. You speak to it like
              a receptionist: it verifies your identity, looks up your reservation in DynamoDB, and
              modifies it — and you can interrupt it mid-sentence.
            </p>

            {/* The one number worth leading with. Mono and brand-coloured so it
                reads as an instrument reading, not a marketing claim - the
                provenance line underneath is doing that work. */}
            <div className="mt-8 inline-flex items-center gap-4 rounded-2xl border border-line bg-surface/70 px-6 py-4 backdrop-blur-sm">
              <span className="font-mono text-[34px] leading-none tracking-[-0.02em] text-brand">
                0.626s
              </span>
              <span className="h-9 w-px bg-line" aria-hidden="true" />
              <span className="text-left">
                <span className="block font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                  Median response
                </span>
                {/* The median is over the 11 turn measurements. Naming the
                    conversations they came from read as a sample of six. */}
                <span className="mt-0.5 block text-[13px] text-ink-secondary">
                  11 turns
                </span>
              </span>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <a
                href="#demo"
                className="flex min-h-[44px] items-center gap-2 rounded-full bg-brand px-6 text-[14px] font-medium text-brand-fg transition-colors duration-160 hover:bg-brand-hover"
              >
                <Play className="size-4 translate-x-[1px]" aria-hidden="true" />
                Watch the demo
              </a>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="flex min-h-[44px] items-center gap-2 rounded-full border border-line bg-surface/70 px-6 text-[14px] text-ink-secondary backdrop-blur-sm transition-colors duration-160 hover:bg-surface"
              >
                <GitHubMark className="size-4" />
                View the source
              </a>
            </div>

            <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
              {STACK.map((item) => (
                <li key={item} className="text-[12px] text-ink-secondary">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Two claims that need room to breathe. Deliberately not cards - the
            page already has a panel above and a grid below, and a third card
            band here made it read as a stack of boxes. */}
        <section className={`${SHELL} mt-14`}>
          <div className="grid gap-x-12 gap-y-8 sm:grid-cols-2">
            <div>
              <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-secondary">
                Why speech-to-speech
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-secondary">
                Most voice agents chain three models — speech to text, a language model, then text to
                speech — and pay latency at every hop, typically two to three seconds before the
                caller hears anything. This one runs a single bidirectional stream: audio in, audio
                out, with no transcription step in the middle.
              </p>
            </div>
            <div>
              <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-secondary">
                One core, two transports
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-secondary">
                A terminal client on a local microphone, and a browser client over WebSockets with a
                live transcript and a sanitized tool-call trace. The core never imports an audio
                library — it exposes exactly two seams, audio in and audio out, which is why a second
                transport could be added without touching agent logic.
              </p>
            </div>
          </div>
        </section>

        {/* Demo ---------------------------------------------------------- */}
        <section id="demo" className={`${SHELL} mt-16 scroll-mt-8`} aria-labelledby="demo-heading">
          <div className="text-center">
            <h2 id="demo-heading" className="text-[22px] font-semibold text-ink">
              Demo
            </h2>
            <p className="mx-auto mt-2 max-w-[60ch] text-sm text-ink-secondary">
              A full conversation: identity check, reservation lookup, a date change read back before
              anything is written, and an interruption mid-sentence.
            </p>
          </div>

          {/* Full shell width, so its edges line up with the hero panel above
              and the HowItWorks cards below. */}
          <div className="mt-7 aspect-[2400/1602] w-full overflow-hidden rounded-[28px] border border-white/70 bg-white/50 shadow-[var(--shadow-md)] backdrop-blur-xl">
            {DEMO_VIDEO === null ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center">
                <span className="flex size-16 items-center justify-center rounded-full bg-brand-subtle">
                  <Play className="size-6 translate-x-[1px] text-brand" aria-hidden="true" />
                </span>
                <span className="text-sm font-medium text-ink">Demo video</span>
                <span className="max-w-[34ch] text-[13px] leading-relaxed text-ink-secondary">
                  Recording of a live session — walkthrough coming soon.
                </span>
              </div>
            ) : DEMO_VIDEO.kind === "file" ? (
              <video
                className="h-full w-full bg-panel"
                controls
                preload="metadata"
                poster={DEMO_VIDEO.poster}
              >
                <source src={DEMO_VIDEO.src} type="video/mp4" />
                Your browser does not support embedded video.
              </video>
            ) : (
              <iframe
                className="h-full w-full border-0 bg-panel"
                src={DEMO_VIDEO.src}
                title="Demo video: a full voice reservation conversation"
                allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            )}
          </div>
        </section>
      </main>

      <HowItWorks />
    </div>
  );
}
