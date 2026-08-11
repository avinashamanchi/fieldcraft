import { readBoundedBody } from "./body.ts";

export type ReminderDeliveryInput = Readonly<{
  idempotencyKey: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}>;

export interface ReminderDeliveryGateway {
  send(
    input: ReminderDeliveryInput,
  ): Promise<{ providerMessageId: string; acceptedAt: string }>;
}

const emailPattern = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;

export const createReminderDeliveryGateway = (
  configuration: Readonly<{
    endpoint: string;
    apiKey: string;
    from: string;
    fetcher?: typeof fetch;
    timeoutMs?: number;
    now?: () => string;
  }>,
): ReminderDeliveryGateway => {
  const endpoint = new URL(configuration.endpoint);
  if (
    endpoint.protocol !== "https:" || endpoint.username || endpoint.password ||
    endpoint.hash
  ) throw new Error("invalid-reminder-endpoint");
  if (
    !emailPattern.test(configuration.from) ||
    configuration.apiKey.trim().length < 16
  ) throw new Error("invalid-reminder-configuration");
  return {
    async send(input) {
      if (
        !/^[A-Za-z0-9:_-]{1,255}$/.test(input.idempotencyKey) ||
        !emailPattern.test(input.to)
      ) throw new Error("invalid-reminder-request");
      if (
        input.subject.length < 1 || input.subject.length > 200 ||
        input.text.length < 1 || input.text.length > 10_000
      ) throw new Error("invalid-reminder-request");
      if (input.replyTo && !emailPattern.test(input.replyTo)) {
        throw new Error("invalid-reminder-request");
      }
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        configuration.timeoutMs ?? 10_000,
      );
      try {
        const response = await (configuration.fetcher ?? fetch)(endpoint, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${configuration.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": input.idempotencyKey,
          },
          body: JSON.stringify({
            from: configuration.from,
            to: input.to,
            subject: input.subject,
            text: input.text,
            ...(input.replyTo ? { reply_to: input.replyTo } : {}),
          }),
        });
        if (!response.ok) throw new Error("reminder-provider-unavailable");
        let parsed: unknown;
        try {
          parsed = JSON.parse(await readBoundedBody(response, 64 * 1024));
        } catch {
          throw new Error("invalid-reminder-response");
        }
        const id = (parsed as { id?: unknown })?.id;
        if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(id)) {
          throw new Error("invalid-reminder-response");
        }
        return {
          providerMessageId: id,
          acceptedAt: configuration.now?.() ?? new Date().toISOString(),
        };
      } catch (cause) {
        if (controller.signal.aborted) {
          throw new Error("reminder-provider-timeout");
        }
        throw cause;
      } finally {
        clearTimeout(timer);
      }
    },
  };
};
