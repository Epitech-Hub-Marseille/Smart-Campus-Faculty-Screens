/** Payload builders for the messages this device sends. Kept small and typed so a typo cannot reach the wire. */
export const ackPayload = (ref: string) => ({ ref });

export const statePayload = (state: Record<string, unknown>, telemetry?: Record<string, unknown>) => ({ state, ...(telemetry && { telemetry }) });

/** The schema allows 200 characters of reason: a longer one would make the whole `nack` invalid and lose the answer. */
export const nackPayload = (ref: string, reason: string) => ({ ref, reason: reason.slice(0, 200) });
