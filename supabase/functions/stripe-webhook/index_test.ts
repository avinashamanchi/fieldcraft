import { createStripeWebhookHandler } from "./index.ts";
import { createStripeSignature } from "../_shared/stripe.ts";

const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};

Deno.test("Stripe webhook verifies the raw bytes and forwards one canonical event", async () => {
  const raw = JSON.stringify({
    id: "evt_1",
    type: "checkout.session.completed",
    created: 1786420000,
    data: {
      object: {
        id: "cs_1",
        payment_intent: "pi_1",
        amount_total: 500,
        currency: "usd",
        metadata: {
          user_id: "70000000-0000-4000-8000-000000000001",
          payment_id: "70000000-0000-4000-8000-000000000003",
          invoice_id: "70000000-0000-4000-8000-000000000002",
        },
      },
    },
  });
  const signature = await createStripeSignature(raw, "whsec_test", 1786420000);
  const applied: unknown[] = [];
  const handler = createStripeWebhookHandler({
    secret: "whsec_test",
    nowSeconds: () => 1786420001,
    applyEvent: (event) => {
      applied.push(event);
      return Promise.resolve("applied" as const);
    },
  });
  const bad = await handler(
    new Request("https://edge.example", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=bad" },
      body: raw,
    }),
  );
  assert(bad.status === 400 && applied.length === 0, "bad signature accepted");
  const good = await handler(
    new Request("https://edge.example", {
      method: "POST",
      headers: { "stripe-signature": signature },
      body: raw,
    }),
  );
  assert(
    good.status === 200 && applied.length === 1,
    "signed event not applied exactly once",
  );
});
