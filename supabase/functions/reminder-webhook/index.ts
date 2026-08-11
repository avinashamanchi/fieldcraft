import { readBoundedBody } from "../_shared/body.ts";
import {
  createSupabaseService,
  jsonResponse,
  requiredEnvironment,
} from "../_shared/service.ts";

const encoder = new TextEncoder();
const hmac = async (raw: string, secret: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return Array.from(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(raw))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
};
export const createReminderSignature = (
  raw: string,
  secret: string,
): Promise<string> => hmac(raw, secret);
const equal = (left: string, right: string): boolean => {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

export type ReminderProviderEvent = Readonly<{
  eventId: string;
  type: "delivered" | "bounced";
  providerMessageId: string;
  occurredAt: string;
}>;
type Dependencies = Readonly<{
  secret: string;
  apply(
    event: ReminderProviderEvent,
  ): Promise<"applied" | "duplicate" | "stale">;
}>;

const parseEvent = (raw: string): ReminderProviderEvent => {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("invalid-event");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid-event");
  }
  const event = value as Record<string, unknown>;
  if (Object.keys(event).sort().join(",") !== "id,messageId,occurredAt,type") {
    throw new Error("invalid-event");
  }
  if (
    typeof event.id !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(event.id)
  ) throw new Error("invalid-event");
  if (event.type !== "delivered" && event.type !== "bounced") {
    throw new Error("invalid-event");
  }
  if (
    typeof event.messageId !== "string" ||
    !/^[A-Za-z0-9_-]{1,255}$/.test(event.messageId)
  ) throw new Error("invalid-event");
  if (
    typeof event.occurredAt !== "string" ||
    !Number.isFinite(Date.parse(event.occurredAt))
  ) throw new Error("invalid-event");
  return {
    eventId: event.id,
    type: event.type,
    providerMessageId: event.messageId,
    occurredAt: new Date(event.occurredAt).toISOString(),
  };
};

export const createReminderWebhookHandler =
  (dependencies: Dependencies) =>
  async (
    request: Request,
  ): Promise<Response> => {
    const requestId = crypto.randomUUID();
    if (request.method !== "POST") {
      return jsonResponse(405, { error: "method-not-allowed", requestId });
    }
    let raw: string;
    try {
      raw = await readBoundedBody(request, 64 * 1024);
    } catch {
      return jsonResponse(413, { error: "invalid-request", requestId });
    }
    const supplied = request.headers.get("x-fieldcraft-signature") ?? "";
    if (!equal(supplied, await hmac(raw, dependencies.secret))) {
      return jsonResponse(400, { error: "invalid-signature", requestId });
    }
    try {
      return jsonResponse(200, {
        requestId,
        outcome: await dependencies.apply(parseEvent(raw)),
      });
    } catch {
      return jsonResponse(400, { error: "invalid-event", requestId });
    }
  };

export const createProductionReminderWebhookHandler = (
  environment: Record<string, string>,
  fetcher: typeof fetch = fetch,
) => {
  const service = createSupabaseService(environment, fetcher);
  return createReminderWebhookHandler({
    secret: requiredEnvironment(environment, "REMINDER_WEBHOOK_SECRET"),
    async apply(event) {
      const value = await service.serviceRpc(
        "fieldcraft_apply_reminder_event",
        {
          p_provider_event_id: event.eventId,
          p_provider_message_id: event.providerMessageId,
          p_status: event.type === "delivered" ? "Delivered" : "Bounced",
          p_occurred_at: event.occurredAt,
        },
      ) as { outcome?: unknown } | null;
      if (
        value?.outcome !== "applied" && value?.outcome !== "duplicate" &&
        value?.outcome !== "stale"
      ) throw new Error("invalid-database-response");
      return value.outcome;
    },
  });
};

if (import.meta.main) {
  Deno.serve(createProductionReminderWebhookHandler(Deno.env.toObject()));
}
