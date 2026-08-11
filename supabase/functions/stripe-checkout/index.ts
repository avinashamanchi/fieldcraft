import { createStripeTransport, requireStripeId } from "../_shared/stripe.ts";
import {
  createSupabaseService,
  jsonResponse,
  parseJsonBody,
  requiredEnvironment,
} from "../_shared/service.ts";

type CheckoutInvoice = Readonly<{
  ownerId: string;
  invoiceId: string;
  number: string;
  balanceCents: number;
  currency: "USD";
  connectedAccountId: string;
  chargesEnabled: boolean;
  linkId?: string;
}>;
type Dependencies = Readonly<{
  resolveInvoice(token: string): Promise<CheckoutInvoice>;
  createCheckout(
    input: CheckoutInvoice & {
      amountCents: number;
      paymentId: string;
      idempotencyKey: string;
    },
  ): Promise<{ url: string; expiresAt: string }>;
}>;

const tokenPattern = /^[A-Za-z0-9_-]{32,128}$/;
const digest = async (value: string): Promise<Uint8Array> =>
  new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const deterministicUuid = async (value: string): Promise<string> => {
  const bytes = (await digest(value)).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const valueHex = hex(bytes);
  return `${valueHex.slice(0, 8)}-${valueHex.slice(8, 12)}-${
    valueHex.slice(12, 16)
  }-${valueHex.slice(16, 20)}-${valueHex.slice(20)}`;
};

export const createStripeCheckoutHandler =
  (dependencies: Dependencies) =>
  async (
    request: Request,
  ): Promise<Response> => {
    const requestId = crypto.randomUUID();
    try {
      if (request.method !== "POST") {
        return jsonResponse(405, { error: "method-not-allowed", requestId });
      }
      const body = await parseJsonBody(request, 2048);
      const keys = Object.keys(body).sort().join(",");
      if (
        keys !== "amountCents,token" && keys !== "amountCents,requestKey,token"
      ) throw new Error("invalid-request");
      const token = typeof body.token === "string" ? body.token : "";
      if (!tokenPattern.test(token)) throw new Error("not-found");
      const invoice = await dependencies.resolveInvoice(token);
      const amountCents = body.amountCents;
      if (
        !Number.isSafeInteger(amountCents) || Number(amountCents) < 99 ||
        Number(amountCents) > invoice.balanceCents
      ) throw new Error("invalid-amount");
      if (invoice.currency !== "USD" || !invoice.chargesEnabled) {
        throw new Error("payments-unavailable");
      }
      requireStripeId(invoice.connectedAccountId, "acct");
      const requestKey = body.requestKey === undefined
        ? "default"
        : body.requestKey;
      if (
        typeof requestKey !== "string" ||
        !/^[A-Za-z0-9_-]{1,80}$/.test(requestKey)
      ) throw new Error("invalid-request");
      const identity = `${
        invoice.linkId ?? invoice.invoiceId
      }:${amountCents}:${requestKey}`;
      const paymentId = await deterministicUuid(`payment:${identity}`);
      const idempotencyKey = `checkout:${hex(await digest(identity))}`;
      const checkout = await dependencies.createCheckout({
        ...invoice,
        amountCents: Number(amountCents),
        paymentId,
        idempotencyKey,
      });
      if (
        typeof checkout.url !== "string" ||
        !checkout.url.startsWith("https://checkout.stripe.com/") ||
        !Number.isFinite(Date.parse(checkout.expiresAt))
      ) throw new Error("invalid-response");
      return jsonResponse(200, {
        requestId,
        url: checkout.url,
        expiresAt: checkout.expiresAt,
        confirmation:
          "Payment is confirmed only after the provider webhook is received.",
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      const [status, error] =
        message === "invalid-request" || message === "invalid-amount"
          ? [400, message]
          : message === "not-found"
          ? [404, "not-found"]
          : message === "payments-unavailable"
          ? [409, "payments-unavailable"]
          : [503, "temporarily-unavailable"];
      return jsonResponse(status, { error, requestId });
    }
  };

export const createProductionStripeCheckoutHandler = (
  environment: Record<string, string>,
  fetcher: typeof fetch = fetch,
) => {
  const service = createSupabaseService(environment, fetcher);
  const stripe = createStripeTransport({
    secretKey: requiredEnvironment(environment, "STRIPE_SECRET_KEY"),
    fetcher,
  });
  const successUrl = new URL(
    requiredEnvironment(environment, "STRIPE_CHECKOUT_SUCCESS_URL"),
  );
  const cancelUrl = new URL(
    requiredEnvironment(environment, "STRIPE_CHECKOUT_CANCEL_URL"),
  );
  if (successUrl.protocol !== "https:" || cancelUrl.protocol !== "https:") {
    throw new Error("Checkout return URLs must use HTTPS");
  }
  return createStripeCheckoutHandler({
    async resolveInvoice(token) {
      const tokenHash = hex(await digest(token));
      const value = await service.serviceRpc(
        "fieldcraft_resolve_payment_link_checkout",
        { p_token_hash_hex: tokenHash },
      );
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("not-found");
      }
      return value as CheckoutInvoice;
    },
    async createCheckout(input) {
      const connectedAccountId = requireStripeId(
        input.connectedAccountId,
        "acct",
      );
      const result = await stripe.request("checkout/sessions", {
        mode: "payment",
        success_url: successUrl.toString(),
        cancel_url: cancelUrl.toString(),
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": String(input.amountCents),
        "line_items[0][price_data][product_data][name]":
          `Invoice ${input.number}`,
        "line_items[0][quantity]": "1",
        "payment_intent_data[metadata][fieldcraft_user_id]": input.ownerId,
        "payment_intent_data[metadata][fieldcraft_invoice_id]": input.invoiceId,
        "payment_intent_data[metadata][fieldcraft_payment_id]": input.paymentId,
        "metadata[fieldcraft_user_id]": input.ownerId,
        "metadata[fieldcraft_invoice_id]": input.invoiceId,
        "metadata[fieldcraft_payment_id]": input.paymentId,
      }, { connectedAccountId, idempotencyKey: input.idempotencyKey });
      if (
        typeof result.url !== "string" ||
        !Number.isSafeInteger(result.expires_at)
      ) throw new Error("invalid-provider-response");
      return {
        url: result.url,
        expiresAt: new Date(Number(result.expires_at) * 1000).toISOString(),
      };
    },
  });
};

if (import.meta.main) {
  Deno.serve(createProductionStripeCheckoutHandler(Deno.env.toObject()));
}
