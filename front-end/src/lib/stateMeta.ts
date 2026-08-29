import {
  AlertTriangle,
  Check,
  Loader2,
  Mic,
  MicOff,
  Volume2,
  Wifi,
  WifiOff,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { SessionState } from "./types";

/**
 * Presentation for every interface state.
 *
 * Each carries an icon and a label as well as a colour, so state is never
 * communicated by colour alone - the requirement that matters most for
 * colour-blind users and in a screen recording.
 */
export interface StateMeta {
  label: string;       // Shown under the microphone.
  hint?: string;       // Optional second line, used for recovery instructions.
  Icon: LucideIcon;
  tone: "neutral" | "live" | "brand" | "ok" | "warn" | "bad";
  busy?: boolean;      // Spinner instead of a static icon.
}

/**
 * States with no session to end: nothing was started, or it is already over.
 *
 * Every other state - including connecting, reconnecting and requesting_mic -
 * has a socket or a permission prompt in flight that the user must be able to
 * abandon. Shared by the dock and the header so the two controls cannot
 * disagree about whether a session exists.
 */
const IDLE: SessionState[] = ["disconnected", "ended", "mic_denied"];

export function isIdle(state: SessionState): boolean {
  return IDLE.includes(state);
}

export const STATE_META: Record<SessionState, StateMeta> = {
  disconnected: { label: "Not connected", Icon: WifiOff, tone: "neutral" },
  connecting: { label: "Connecting…", Icon: Loader2, tone: "brand", busy: true },
  reconnecting: { label: "Reconnecting…", Icon: Loader2, tone: "warn", busy: true },
  requesting_mic: {
    label: "Waiting for microphone",
    hint: "Allow access in your browser to begin",
    Icon: Mic,
    tone: "brand",
    busy: true,
  },
  mic_denied: {
    label: "Microphone blocked",
    hint: "Enable microphone access for this site, then try again",
    Icon: MicOff,
    tone: "bad",
  },
  ready: { label: "Ready", Icon: Wifi, tone: "neutral" },
  listening: { label: "Listening", hint: "Speak naturally", Icon: Mic, tone: "live" },
  processing: { label: "Thinking…", Icon: Loader2, tone: "brand", busy: true },
  speaking: { label: "Agent speaking", hint: "Talk over it to interrupt", Icon: Volume2, tone: "brand" },
  executing_tool: { label: "Checking records…", Icon: Wrench, tone: "brand", busy: true },
  awaiting_confirmation: {
    label: "Waiting for your confirmation",
    hint: "Say yes to apply the change, or no to cancel",
    Icon: AlertTriangle,
    tone: "warn",
  },
  ended: { label: "Session ended", hint: "Start a new session to continue", Icon: Check, tone: "neutral" },
  error: { label: "Something went wrong", Icon: AlertTriangle, tone: "bad" },
};

/** Tone → Tailwind classes. Kept in one place so tones stay consistent. */
export const TONE_TEXT: Record<StateMeta["tone"], string> = {
  neutral: "text-ink-muted",
  live: "text-live",
  brand: "text-brand",
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-bad",
};

export const TONE_RING: Record<StateMeta["tone"], string> = {
  neutral: "border-line-interactive",
  live: "border-live",
  brand: "border-brand",
  ok: "border-ok",
  warn: "border-warn",
  bad: "border-bad",
};
