import { createReminderWorkerHandler } from "./index.ts";

const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};

Deno.test("worker claims at most 100 and rechecks eligibility before send", async () => {
  const sent: string[] = [];
  const claimed = Array.from(
    { length: 120 },
    (_, index) => ({
      id: `delivery-${index}`,
      idempotencyKey: `reminder-${index}`,
      to: "customer@example.test",
      subject: "Invoice reminder",
      text: "A payment reminder",
      eligible: index !== 1,
    }),
  );
  const handler = createReminderWorkerHandler({
    authorize: (value) => value === "Bearer worker-secret",
    claim: (limit) => Promise.resolve(claimed.slice(0, limit)),
    recheck: (delivery) => Promise.resolve(delivery.eligible === true),
    send: (delivery) => {
      sent.push(delivery.id);
      return Promise.resolve({
        providerMessageId: `msg-${delivery.id}`,
        acceptedAt: "2026-08-10T12:00:00.000Z",
      });
    },
    accept: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
    release: () => Promise.resolve(),
  });
  const response = await handler(
    new Request("https://edge.example", {
      method: "POST",
      headers: { authorization: "Bearer worker-secret" },
    }),
  );
  const body = await response.json();
  assert(
    response.status === 200 && body.claimed === 100 && body.sent === 99 &&
      sent.length === 99,
    "bounded worker result",
  );
});
