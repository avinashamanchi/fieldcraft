import { createStripeCheckoutHandler } from "./index.ts";

const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};

Deno.test("Checkout rejects sub-minimum and over-balance amounts before Stripe", async () => {
  let calls = 0;
  const handler = createStripeCheckoutHandler({
    resolveInvoice: () =>
      Promise.resolve({
        ownerId: "70000000-0000-4000-8000-000000000001",
        invoiceId: "70000000-0000-4000-8000-000000000002",
        number: "INV-1",
        balanceCents: 500,
        currency: "USD" as const,
        connectedAccountId: "acct_test",
        chargesEnabled: true,
      }),
    createCheckout: () => {
      calls += 1;
      return Promise.resolve({
        url: "https://checkout.stripe.com/c/pay/test",
        expiresAt: "2026-08-11T00:00:00.000Z",
      });
    },
  });
  for (const amountCents of [98, 501]) {
    const response = await handler(
      new Request("https://edge.example", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: "opaque-public-token-at-least-32-chars",
          amountCents,
        }),
      }),
    );
    assert(response.status === 400, `amount ${amountCents} accepted`);
  }
  assert(calls === 0, "Stripe called for invalid amount");
});
