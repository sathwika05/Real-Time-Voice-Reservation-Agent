/**
 * The event contract between the Python agent and this UI.
 *
 * These mirror what backend/hotel_agent.py emits through emit_ui_event() and
 * server.py forwards as WebSocket text frames. Audio travels on the same
 * socket as binary frames, so frame type alone distinguishes them.
 */

/** Events the server sends us. */
export type ServerEvent =
  | { type: "ready" }
  | { type: "session_ended" }
  | { type: "barge_in" }
  | { type: "transcript"; role: "user" | "assistant"; text: string; final: boolean }
  | { type: "state"; value: AgentStateValue; reason?: string; tool?: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | {
      type: "tool_result";
      id: string;
      name: string;
      ok: boolean;
      latencyMs: number | null;
      result: Record<string, unknown>;
    }
  | { type: "proposal"; proposalId: string; reservationId: string; changes: ProposedChange[] }
  | { type: "error"; code?: string; message: string };

/** Agent-side states reported by the backend. */
export type AgentStateValue = "listening" | "processing" | "speaking" | "executing_tool";

/** One field-level change in a two-phase reservation update. */
export interface ProposedChange {
  field: string;
  from: string | null;
  to: string;
}

/**
 * The full interface state. Wider than AgentStateValue because it also covers
 * connection and permission conditions the backend knows nothing about.
 */
export type SessionState =
  | "disconnected"
  | "connecting"
  | "reconnecting"
  | "requesting_mic"
  | "mic_denied"
  | "ready"
  | "listening"
  | "processing"
  | "speaking"
  | "executing_tool"
  | "awaiting_confirmation"
  | "ended"
  | "error";

/**
 * One entry in the conversation. Messages, tool activity, and proposals share
 * a single ordered list so they interleave exactly as they occurred - a tool
 * call belongs between the question that triggered it and the answer.
 */
export type TimelineItem =
  | { kind: "message"; id: string; role: "user" | "assistant"; text: string; ts: number }
  | {
      kind: "tool";
      id: string;
      name: string;
      args: Record<string, unknown>;
      status: "running" | "ok" | "error";
      latencyMs: number | null;
      result?: Record<string, unknown>;
      ts: number;
    }
  | {
      kind: "proposal";
      id: string;
      proposalId: string;
      reservationId: string;
      changes: ProposedChange[];
      resolved: boolean;
      ts: number;
    }
  | {
      kind: "confirmation";
      id: string;
      reservationId: string;
      changes: ProposedChange[];
      reservation: Record<string, unknown>;
      ts: number;
    };

/** A tool entry as shown in the engineering trace. */
export interface TraceEntry {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "ok" | "error";
  latencyMs: number | null;
  result?: Record<string, unknown>;
  ts: number;
}
