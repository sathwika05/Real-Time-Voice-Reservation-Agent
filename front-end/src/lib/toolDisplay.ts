/**
 * Human-readable presentation for tool activity.
 *
 * The raw tool name and a JSON blob are accurate but unreadable. Both the
 * inline pill in the conversation and the cards in the trace panel need a
 * plain-language summary and a small set of labelled fields, so a viewer can
 * tell what the backend did without parsing JSON.
 */

export interface ToolField {
  label: string;
  value: string;
}

const str = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object") return null;
  return String(v);
};

/** One-line summary shown as a pill inside the conversation. */
export function toolSummary(
  name: string,
  ok: boolean,
  result: Record<string, unknown> | undefined,
): string {
  if (!ok) {
    const err = result?.error;
    return typeof err === "string" ? err : "Tool call failed";
  }

  switch (name) {
    case "checkGuestProfileTool":
      return result?.verified === true
        ? "Identity verified against DynamoDB"
        : "Identity could not be verified";
    case "checkReservationStatusTool":
      return result?.upcomingReservation
        ? "Reservation retrieved from DynamoDB"
        : "No upcoming reservation found";
    case "updateReservationTool":
      if (result?.mode === "proposal") return "Change prepared — nothing written yet";
      if (result?.mode === "committed") return "Reservation updated in DynamoDB";
      return "Reservation tool completed";
    default:
      return "Tool completed";
  }
}

/** Friendly tool label for the trace card heading. */
export function toolTitle(name: string): string {
  return (
    {
      checkGuestProfileTool: "check_guest_profile",
      checkReservationStatusTool: "check_reservation_status",
      updateReservationTool: "update_reservation",
    }[name] ?? name
  );
}

/**
 * The handful of fields worth showing for each tool.
 *
 * Everything here has already been redacted server-side, so nothing personal
 * can appear even if a field were added carelessly.
 */
export function toolFields(
  name: string,
  args: Record<string, unknown>,
  result: Record<string, unknown> | undefined,
  latencyMs: number | null,
): ToolField[] {
  const out: ToolField[] = [];
  const push = (label: string, value: string | null) => {
    if (value) out.push({ label, value });
  };

  if (name === "checkGuestProfileTool") {
    push("Guest", str(args.guestName));
    push("Verified", result ? String(result.verified === true) : null);
    push("Loyalty", str(result?.loyaltyTier));
  }

  if (name === "checkReservationStatusTool") {
    const res = result?.upcomingReservation as Record<string, unknown> | null | undefined;
    push("Guest", str(args.guestName));
    push("Reservation", str(res?.reservationId));
    push("Room", str(res?.roomType));
    if (res?.checkInDate && res?.checkOutDate) {
      push("Dates", `${str(res.checkInDate)} → ${str(res.checkOutDate)}`);
    }
  }

  if (name === "updateReservationTool") {
    push("Reservation", str(args.reservationId));
    push("Mode", str(args.mode ?? "propose"));

    const changes = (result?.changes ?? []) as { field: string; from: string | null; to: string }[];
    for (const c of changes) {
      push(c.field, c.from ? `${c.from} → ${c.to}` : `+ ${c.to}`);
    }

    push("Proposal", str(result?.proposalId));
    push("Written", result ? String(result.written === true) : null);
  }

  push("Latency", latencyMs === null ? null : `${latencyMs} ms`);
  return out;
}
