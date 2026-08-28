"use client";

import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";

const BARS = 24;

// Minimum bar height as a fraction of the track. Below roughly a fifth the
// bars read as a row of dots rather than a quiet waveform.
const MIN_SCALE = 0.2;

/**
 * Audio-reactive waveform.
 *
 * Driven by real RMS amplitude from the microphone or the playing speech, not
 * a decorative loop.
 *
 * The animation writes to the DOM directly from a rAF loop rather than through
 * React state. Setting state 60 times a second would re-render this component
 * on every frame for no benefit - the bars are the only thing changing, and
 * they change through transform alone.
 */
export function Waveform({
  level,
  active,
  tone,
}: {
  level: number;                 // 0..1 amplitude.
  active: boolean;               // Whether audio is currently flowing.
  tone: "live" | "brand";
}) {
  const reduced = usePrefersReducedMotion();
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const heights = useRef<number[]>(new Array(BARS).fill(0.06));
  const smoothed = useRef(0);

  // Mirror the latest props into a ref so the animation loop can read them
  // without being torn down and restarted on every amplitude change.
  const latest = useRef({ level, active });
  useEffect(() => {
    latest.current = { level, active };
  }, [level, active]);

  useEffect(() => {
    if (reduced) return;

    let frame = 0;
    const tick = () => {
      const { level: l, active: a } = latest.current;

      // Smooth towards the target: raw per-frame amplitude is far too jittery
      // to read as a waveform.
      const target = a ? Math.min(1, l * 3.2) : 0;
      smoothed.current += (target - smoothed.current) * 0.3;

      heights.current = [...heights.current.slice(1), Math.max(MIN_SCALE, smoothed.current)];

      for (let i = 0; i < BARS; i++) {
        const el = bars.current[i];
        // scaleY keeps this off the layout path. Animating height would reflow
        // the dock on every frame.
        if (el) el.style.transform = `scaleY(${heights.current[i]})`;
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduced]);

  const color = tone === "live" ? "bg-live" : "bg-brand";

  // Non-animated alternative: three discrete segments lit by volume, so the
  // same information survives with no movement at all.
  if (reduced) {
    const steps = active ? Math.ceil(Math.min(1, level * 3.2) * 3) : 0;
    return (
      <div className="flex h-10 items-center justify-center gap-2" aria-hidden="true">
        {[1, 2, 3].map((s) => (
          <span key={s} className={`h-2 w-8 rounded-sm ${s <= steps ? color : "bg-line"}`} />
        ))}
      </div>
    );
  }

  // At rest a single hairline is quieter and more clearly deliberate than a
  // row of stubby bars.
  if (!active) {
    return (
      <div className="flex h-10 items-center justify-center" aria-hidden="true">
        <span className="h-px w-40 rounded-full bg-line" />
      </div>
    );
  }

  return (
    // Decorative: the state label beside it carries the meaning for assistive tech.
    <div className="flex h-10 items-center justify-center gap-[2px]" aria-hidden="true">
      {Array.from({ length: BARS }, (_, i) => (
        <span
          key={i}
          ref={(el) => {
            bars.current[i] = el;
          }}
          className={`h-full w-[3px] rounded-full ${active ? color : "bg-line"}`}
          style={{ transform: `scaleY(${MIN_SCALE})` }}
        />
      ))}
    </div>
  );
}
