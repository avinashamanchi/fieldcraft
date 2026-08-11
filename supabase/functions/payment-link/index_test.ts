import { createPaymentLinkHandler } from "./index.ts";

const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};

Deno.test("payment links return only bounded customer-safe fields and revoke idempotently", async () => {
  let revoked = 0;
  const handler = createPaymentLinkHandler({
    authenticate: () =>
      Promise.resolve({ userId: "70000000-0000-4000-8000-000000000001" }),
    requireRecentAal2: () => Promise.resolve(),
    requirePro: () => Promise.resolve(),
    issue: () =>
      Promise.resolve({
        token: "opaque-public-token-at-least-32-chars",
        expiresAt: "2026-08-11T00:00:00.000Z",
      }),
    revoke: () => {
      revoked += 1;
      return Promise.resolve();
    },
    resolve: () =>
      Promise.resolve({
        businessName: "Avi Services",
        invoiceNumber: "INV-1",
        currency: "USD" as const,
        totalCents: 1000,
        paidCents: 200,
        balanceCents: 800,
        minimumCents: 99,
        maximumCents: 800,
      }),
    publicBaseUrl: "https://pay.example.com",
  });
  const publicResponse = await handler(
    new Request(
      "https://edge.example?token=opaque-public-token-at-least-32-chars",
    ),
  );
  const body = await publicResponse.json();
  assert(
    publicResponse.status === 200 && body.balanceCents === 800,
    "public summary missing",
  );
  assert(!JSON.stringify(body).includes("70000000"), "owner ID leaked");
  for (let index = 0; index < 2; index += 1) {
    await handler(
      new Request("https://edge.example", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "revoke",
          invoiceId: "70000000-0000-4000-8000-000000000002",
        }),
      }),
    );
  }
  assert(revoked === 2, "revoke handler is not retryable");
});
