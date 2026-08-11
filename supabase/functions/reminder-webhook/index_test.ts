import {
  createReminderSignature,
  createReminderWebhookHandler,
} from "./index.ts";

const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};

Deno.test("reminder webhook rejects unsigned bodies and deduplicates provider events", async () => {
  const raw = JSON.stringify({
    id: "email-event-1",
    type: "delivered",
    messageId: "msg-1",
    occurredAt: "2026-08-10T12:00:00.000Z",
  });
  const signature = await createReminderSignature(raw, "reminder-secret");
  const events: unknown[] = [];
  const handler = createReminderWebhookHandler({
    secret: "reminder-secret",
    apply: (event) => {
      events.push(event);
      return Promise.resolve(
        events.length === 1 ? "applied" as const : "duplicate" as const,
      );
    },
  });
  assert(
    (await handler(
      new Request("https://edge.example", { method: "POST", body: raw }),
    )).status === 400,
    "unsigned webhook accepted",
  );
  const response = await handler(
    new Request("https://edge.example", {
      method: "POST",
      headers: { "x-fieldcraft-signature": signature },
      body: raw,
    }),
  );
  assert(
    response.status === 200 && events.length === 1,
    "signed webhook not applied",
  );
});
