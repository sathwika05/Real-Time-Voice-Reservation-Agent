"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MicCapture, SpeechPlayer } from "./audio";
import type {
  ProposedChange,
  ServerEvent,
  SessionState,
  TimelineItem,
  TraceEntry,
} from "./types";

const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://127.0.0.1:8010/ws";

let seq = 0;
const nextId = () => `i${++seq}`;

/**
 * The single source of truth for a voice session.
 *
 * Both the conversation and the engineering trace render from this one hook.
 * That is deliberate: driving them from separate subscriptions is how they
 * drift out of sync, and a trace showing a tool still running while the
 * transcript shows it finished reads as a broken product.
 */
export function useVoiceSession() {
  const [state, setState] = useState<SessionState>("disconnected");
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [agentLevel, setAgentLevel] = useState(0);
  const [verifiedGuest, setVerifiedGuest] = useState<string | null>(null);
  const [fastInterrupt, setFastInterrupt] = useState(false);

  const socket = useRef<WebSocket | null>(null);
  const mic = useRef<MicCapture | null>(null);
  const player = useRef<SpeechPlayer | null>(null);
  const fastRef = useRef(fastInterrupt);
  const running = useRef(false);

  useEffect(() => {
    fastRef.current = fastInterrupt;
  }, [fastInterrupt]);

  /** Poll the player's amplitude for the agent-side waveform. */
  useEffect(() => {
    const id = setInterval(() => setAgentLevel(player.current?.level ?? 0), 60);
    return () => clearInterval(id);
  }, []);

  const append = useCallback((item: TimelineItem) => {
    setTimeline((prev) => {
      // Nova Sonic emits assistant text twice - once speculative, once final.
      // Dropping an identical consecutive assistant line keeps the transcript
      // readable without suppressing genuine repetition later in a conversation.
      const last = prev[prev.length - 1];
      if (
        item.kind === "message" &&
        last?.kind === "message" &&
        last.role === item.role &&
        last.text === item.text
      ) {
        return prev;
      }
      return [...prev, item];
    });
  }, []);

  const handleEvent = useCallback(
    (event: ServerEvent) => {
      switch (event.type) {
        case "ready":
          setState("listening");
          break;

        case "session_ended":
          setState("ended");
          break;

        case "barge_in":
          player.current?.flush();     // Server says the guest cut in.
          setState("listening");
          break;

        case "transcript":
          append({
            kind: "message",
            id: nextId(),
            role: event.role,
            text: event.text,
            ts: Date.now(),
          });
          break;

        case "state":
          // A pending proposal outranks backend chatter: the interface should
          // keep asking for confirmation until the guest answers.
          setState((prev) => (prev === "awaiting_confirmation" ? prev : event.value));
          break;

        case "tool_call": {
          const entry: TraceEntry = {
            id: event.id,
            name: event.name,
            args: event.args,
            status: "running",
            latencyMs: null,
            ts: Date.now(),
          };
          setTrace((prev) => [...prev, entry]);
          append({ ...entry, kind: "tool" });
          break;
        }

        case "tool_result": {
          const status = event.ok ? "ok" : "error";

          // Update in place rather than appending, so a tool appears once and
          // transitions from running to its outcome.
          const patch = <T extends { id: string }>(rows: T[]) =>
            rows.map((r) =>
              r.id === event.id
                ? { ...r, status, latencyMs: event.latencyMs, result: event.result }
                : r,
            );
          setTrace((prev) => patch(prev) as TraceEntry[]);
          setTimeline((prev) =>
            prev.map((i) =>
              i.kind === "tool" && i.id === event.id
                ? { ...i, status, latencyMs: event.latencyMs, result: event.result }
                : i,
            ),
          );

          if (event.ok && event.name === "checkGuestProfileTool") {
            const g = event.result?.guestName;
            if (event.result?.verified === true && typeof g === "string") {
              setVerifiedGuest(g);
            }
          }

          // A successful commit is the end of the journey - surface the
          // updated booking as a confirmation card.
          if (event.ok && event.result?.mode === "committed") {
            append({
              kind: "confirmation",
              id: nextId(),
              reservationId: String(event.result.reservationId ?? ""),
              changes: (event.result.changes ?? []) as ProposedChange[],
              reservation: (event.result.updatedReservation ?? {}) as Record<string, unknown>,
              ts: Date.now(),
            });
            setTimeline((prev) =>
              prev.map((i) => (i.kind === "proposal" ? { ...i, resolved: true } : i)),
            );
          }
          break;
        }

        case "proposal":
          append({
            kind: "proposal",
            id: nextId(),
            proposalId: event.proposalId,
            reservationId: event.reservationId,
            changes: event.changes,
            resolved: false,
            ts: Date.now(),
          });
          setState("awaiting_confirmation");
          break;

        case "error":
          setError(event.message);
          setState("error");
          break;
      }
    },
    [append],
  );

  const stop = useCallback(async () => {
    running.current = false;
    socket.current?.close();
    socket.current = null;
    await mic.current?.stop();
    mic.current = null;
    await player.current?.close();
    player.current = null;
    setMicLevel(0);
    setState((prev) => (prev === "ended" || prev === "error" ? prev : "disconnected"));
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setTimeline([]);
    setTrace([]);
    setVerifiedGuest(null);
    setState("requesting_mic");

    player.current = new SpeechPlayer();

    // Microphone first. Opening the socket before permission is granted would
    // start Nova Sonic's idle timer during the permission prompt.
    try {
      mic.current = new MicCapture(
        (pcm) => {
          if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(pcm);
        },
        () => {
          // Local speech detection. Only trusted on headphones - on speakers
          // the microphone also hears the agent and it would silence itself.
          if (fastRef.current && player.current?.isPlaying) {
            player.current.flush();
            setState("listening");
          }
        },
        (rms) => setMicLevel(rms),
      );
      await mic.current.start();
    } catch {
      setState("mic_denied");
      return;
    }

    setState("connecting");
    const ws = new WebSocket(WS_URL);
    ws.binaryType = "arraybuffer";
    socket.current = ws;
    running.current = true;

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          handleEvent(JSON.parse(event.data) as ServerEvent);
        } catch {
          // A frame we cannot parse is not worth tearing the session down for.
        }
        return;
      }
      player.current?.play(event.data as ArrayBuffer);
    };

    ws.onerror = () => {
      setError("Could not reach the voice server. Is it running on port 8010?");
      setState("error");
    };

    ws.onclose = () => {
      if (running.current) setState("ended");   // Closed by the server, not by us.
    };
  }, [handleEvent]);

  useEffect(() => {
    return () => {
      void stop();          // Release the microphone if the page unmounts.
    };
  }, [stop]);

  return {
    state,
    timeline,
    trace,
    error,
    micLevel,
    agentLevel,
    verifiedGuest,
    fastInterrupt,
    setFastInterrupt,
    start,
    stop,
  };
}
