import { readBoundedBody } from "../_shared/body.ts";
import {
  createSupabaseService,
  jsonResponse,
  requiredEnvironment,
} from "../_shared/service.ts";
import { verifyStripeSignature } from "../_shared/stripe.ts";

export type CanonicalStripeEvent = Readonly<{
  eventId: string;
  userId: string;
  paymentId: string;
  invoiceId: string;
  amountCents: number;
  currency: "USD";
  status:
    | "Pending"
    | "Succeeded"
    | "Failed"
    | "Partially Refunded"
    | "Refunded"
    | "Disputed";
  refundedCents: number;
  providerPaymentIntentId?: string;
  providerChargeId?: string;
  providerEventAt: string;
}>;
type Dependencies = Readonly<{
  secret: string;
  nowSeconds?: () => number;
  applyEvent(
    event: CanonicalStripeEvent,
  ): Promise<"applied" | "duplicate" | "stale">;
}>;

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid-event");
  }
  return value as Record<string, unknown>;
};
const string = (value: unknown): string => {
  if (typeof value !== "string" || value.length < 1 || value.length > 255) {
    throw new Error("invalid-event");
  }
  return value;
};
const integer = (value: unknown): number => {
  if (
    !Number.isSafeInteger(value) || Number(value) < 0 ||
    Number(value) > 100_000_000
  ) throw new Error("invalid-event");
  return Number(value);
};
const uuid = (value: unknown): string => {
  const parsed = string(value);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(parsed)
  ) throw new Error("invalid-event");
  return parsed;
};
const metadataValue = (
  metadata: Record<string, unknown>,
  canonical: string,
  testAlias: string,
): string => uuid(metadata[canonical] ?? metadata[testAlias]);

const canonicalize = (value: unknown): CanonicalStripeEvent | null => {
  const event = record(value);
  const eventId = string(event.id);
  if (!/^evt_[A-Za-z0-9_]{1,250}$/.test(eventId)) {
    throw new Error("invalid-event");
  }
  const type = string(event.type);
  if (
    !Number.isSafeInteger(event.created) || Number(event.created) < 1 ||
    Number(event.created) > 10_000_000_000
  ) throw new Error("invalid-event");
  const created = Number(event.created);
  const object = record(record(record(event.data).object));
  if (
    ![
      "checkout.session.completed",
      "payment_intent.succeeded",
      "payment_intent.payment_failed",
      "charge.refunded",
      "charge.dispute.created",
    ].includes(type)
  ) return null;
  const metadata = record(object.metadata);
  const userId = metadataValue(metadata, "fieldcraft_user_id", "user_id");
  const paymentId = metadataValue(
    metadata,
    "fieldcraft_payment_id",
    "payment_id",
  );
  const invoiceId = metadataValue(
    metadata,
    "fieldcraft_invoice_id",
    "invoice_id",
  );
  const currency = string(object.currency).toLowerCase();
  if (currency !== "usd") throw new Error("invalid-event");
  const amountCents = integer(object.amount_total ?? object.amount);
  const refundedCents = type === "charge.refunded"
    ? integer(object.amount_refunded)
    : 0;
  const status: CanonicalStripeEvent["status"] =
    type === "checkout.session.completed" || type === "payment_intent.succeeded"
      ? "Succeeded"
      : type === "payment_intent.payment_failed"
      ? "Failed"
      : type === "charge.dispute.created"
      ? "Disputed"
      : refundedCents === amountCents
      ? "Refunded"
      : "Partially Refunded";
  if (
    type === "charge.refunded" &&
    (refundedCents < 1 || refundedCents > amountCents)
  ) throw new Error("invalid-event");
  const paymentIntent = object.payment_intent ??
    (type.startsWith("payment_intent.") ? object.id : undefined);
  const chargeId = type.startsWith("charge.") ? object.id : undefined;
  return {
    eventId,
    userId,
    paymentId,
    invoiceId,
    amountCents,
    currency: "USD",
    status,
    refundedCents,
    ...(typeof paymentIntent === "string"
      ? { providerPaymentIntentId: string(paymentIntent) }
      : {}),
    ...(typeof chargeId === "string"
      ? { providerChargeId: string(chargeId) }
      : {}),
    providerEventAt: new Date(created * 1000).toISOString(),
  };
};

export const createStripeWebhookHandler =
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
    if (
      !await verifyStripeSignature(
        raw,
        request.headers.get("stripe-signature"),
        dependencies.secret,
        dependencies.nowSeconds?.(),
      )
    ) {
      return jsonResponse(400, { error: "invalid-signature", requestId });
    }
    try {
      const event = canonicalize(JSON.parse(raw));
      if (!event) return jsonResponse(200, { requestId, outcome: "ignored" });
      return jsonResponse(200, {
        requestId,
        outcome: await dependencies.applyEvent(event),
      });
    } catch {
      return jsonResponse(400, { error: "invalid-event", requestId });
    }
  };

export const createProductionStripeWebhookHandler = (
  environment: Record<string, string>,
  fetcher: typeof fetch = fetch,
) => {
  const service = createSupabaseService(environment, fetcher);
  return createStripeWebhookHandler({
    secret: requiredEnvironment(environment, "STRIPE_WEBHOOK_SECRET"),
    async applyEvent(event) {
      const value = await service.serviceRpc("apply_provider_payment_event", {
        p_provider_event_id: event.eventId,
        p_payload: {
          userId: event.userId,
          paymentId: event.paymentId,
          invoiceId: event.invoiceId,
          amountCents: event.amountCents,
          currency: event.currency,
          status: event.status,
          refundedCents: event.refundedCents,
          providerEventAt: event.providerEventAt,
          ...(event.providerPaymentIntentId
            ? { providerPaymentIntentId: event.providerPaymentIntentId }
            : {}),
          ...(event.providerChargeId
            ? { providerChargeId: event.providerChargeId }
            : {}),
        },
      }) as { outcome?: unknown } | null;
      if (
        value?.outcome !== "applied" && value?.outcome !== "duplicate" &&
        value?.outcome !== "stale"
      ) throw new Error("invalid-database-response");
      return value.outcome;
    },
  });
};

if (import.meta.main) {
  Deno.serve(createProductionStripeWebhookHandler(Deno.env.toObject()));
}
