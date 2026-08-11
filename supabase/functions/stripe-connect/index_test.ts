import { createStripeConnectHandler } from "./index.ts";

const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};

Deno.test("Stripe Connect denies AAL1 and never calls the provider", async () => {
  let providerCalls = 0;
  const handler = createStripeConnectHandler({
    authenticate: () =>
      Promise.resolve({ userId: "70000000-0000-4000-8000-000000000001" }),
    requireRecentAal2: () => Promise.reject(new Error("aal2-required")),
    requirePro: () => Promise.resolve(),
    createOnboarding: () => {
      providerCalls += 1;
      return Promise.resolve({
        url: "https://connect.stripe.com/setup/s/test",
        expiresAt: "2026-08-11T00:00:00.000Z",
      });
    },
    readStatus: () =>
      Promise.resolve({
        state: "not-connected" as const,
        chargesEnabled: false,
        payoutsEnabled: false,
      }),
    disconnect: () => Promise.resolve(),
  });
  const response = await handler(
    new Request("https://edge.example", {
      method: "POST",
      headers: {
        authorization: "Bearer test",
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "onboard" }),
    }),
  );
  assert(response.status === 403, "AAL1 must be denied");
  assert(providerCalls === 0, "provider called before AAL2");
});
