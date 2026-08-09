import { createRevenueCatWebhookHandler } from "./index.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const TEST_SECRET = "webhook-test-secret-at-least-32-bytes";
const bearer = (token = TEST_SECRET) => ["Bearer", token].join(" ");

const event = (overrides: Record<string, unknown> = {}) => ({
  api_version: "1.0",
  event: {
    id: "event-000000000000000000000001",
    type: "INITIAL_PURCHASE",
    app_user_id: "70000000-0000-4000-8000-000000000001",
    original_app_user_id: "70000000-0000-4000-8000-000000000001",
    aliases: [],
    app_id: "app_fieldcraft",
    product_id: "fieldcraft_pro_monthly",
    entitlement_ids: ["pro"],
    environment: "SANDBOX",
    event_timestamp_ms: 1786233600000,
    expiration_at_ms: 1788912000000,
    ...overrides,
  },
});

const request = (
  body: string,
  authorization = bearer(),
) =>
  new Request("https://edge.example/revenuecat-webhook", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body,
  });

Deno.test("rejects wrong authorization, oversized bodies, duplicate keys, and malformed owners", async () => {
  let calls = 0;
  const handler = createRevenueCatWebhookHandler({
    secret: TEST_SECRET,
    appId: "app_fieldcraft",
    apply: () => {
      calls += 1;
      return Promise.resolve("applied");
    },
  });
  assert(
    (await handler(
      request(JSON.stringify(event()), bearer("wrong-secret-value")),
    )).status === 401,
    "auth",
  );
  assert(
    (await handler(
      request(`{"api_version":"1.0","api_version":"1.0","event":{}}`),
    )).status === 400,
    "duplicate",
  );
  assert(
    (await handler(
      request(JSON.stringify(event({ app_user_id: "not-a-uuid" }))),
    )).status === 400,
    "owner",
  );
  assert(
    (await handler(
      request(JSON.stringify(event({ note: "x".repeat(66_000) }))),
    )).status === 413,
    "size",
  );
  assert(calls === 0, "invalid request reached SQL");
});

Deno.test("normalizes supported lifecycle events and returns only bounded outcomes", async () => {
  const applied: Record<string, unknown>[] = [];
  const handler = createRevenueCatWebhookHandler({
    secret: TEST_SECRET,
    appId: "app_fieldcraft",
    apply: (value) => {
      applied.push(value);
      return Promise.resolve("applied");
    },
  });
  const response = await handler(request(JSON.stringify(event())));
  assert(response.status === 200, "status");
  assert((await response.json()).status === "applied", "outcome");
  assert(applied.length === 1, "apply count");
  assert(
    applied[0].ownerId === "70000000-0000-4000-8000-000000000001",
    "owner",
  );
  assert(applied[0].status === "active", "transition");
  assert(
    !JSON.stringify(applied[0]).includes("webhook-test-secret"),
    "secret leak",
  );
});

Deno.test("maps refund, expiration, cancellation, billing retry, grace, and renewal exactly", async () => {
  const statuses: string[] = [];
  const handler = createRevenueCatWebhookHandler({
    secret: TEST_SECRET,
    appId: "app_fieldcraft",
    apply: (value) => {
      statuses.push(String(value.status));
      return Promise.resolve("applied");
    },
  });
  for (
    const [type, status] of [
      ["RENEWAL", "active"],
      ["CANCELLATION", "cancelled"],
      ["BILLING_ISSUE", "billing_retry"],
      ["SUBSCRIPTION_PAUSED", "grace_period"],
      ["EXPIRATION", "expired"],
      ["REFUND", "refunded"],
    ] as const
  ) {
    const response = await handler(request(JSON.stringify(event({ type }))));
    assert(response.status === 200, `${type} status`);
    assert(statuses.at(-1) === status, `${type} mapping`);
  }
});

Deno.test("accepts bounded RevenueCat aliases and current lifecycle fields but rejects transfer events", async () => {
  let calls = 0;
  const handler = createRevenueCatWebhookHandler({
    secret: TEST_SECRET,
    appId: "app_fieldcraft",
    apply: () => {
      calls += 1;
      return Promise.resolve("applied");
    },
  });
  const lifecycle = event({
    aliases: ["$RCAnonymousID:abcdef0123456789"],
    original_app_user_id: "$RCAnonymousID:abcdef0123456789",
    country_code: "US",
    currency: "USD",
    price: 8.99,
    price_in_purchased_currency: 8.99,
    offer_code: null,
    renewal_number: 2,
    metadata: {},
    discount_percentage: null,
    discount_amount: null,
    discount_identifier: null,
    grace_period_expiration_at_ms: null,
    auto_resume_at_ms: null,
    is_trial_conversion: false,
    new_product_id: null,
    experiments: [],
  });
  assert(
    (await handler(request(JSON.stringify(lifecycle)))).status === 200,
    "lifecycle aliases",
  );
  assert(
    (await handler(request(JSON.stringify(event({ type: "TRANSFER" })))))
      .status === 400,
    "transfer",
  );
  assert(calls === 1, "unsupported transfer reached SQL");
});

Deno.test("applies the ten-second cap to slow request bodies as well as SQL", async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      setTimeout(() => {
        controller.enqueue(encoder.encode(JSON.stringify(event())));
        controller.close();
      }, 40);
    },
  });
  const handler = createRevenueCatWebhookHandler({
    secret: TEST_SECRET,
    appId: "app_fieldcraft",
    deadlineMs: 5,
    apply: () => Promise.resolve("applied"),
  });
  const slow = new Request("https://edge.example/revenuecat-webhook", {
    method: "POST",
    headers: {
      authorization: bearer(),
      "content-type": "application/json",
    },
    body,
  });
  assert((await handler(slow)).status === 504, "whole-request deadline");
});
