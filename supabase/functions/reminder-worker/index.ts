import { createReminderDeliveryGateway } from "../_shared/reminderProvider.ts";
import {
  createSupabaseService,
  jsonResponse,
  requiredEnvironment,
} from "../_shared/service.ts";

export type ClaimedReminder = Readonly<{
  id: string;
  idempotencyKey: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  eligible?: boolean;
}>;
type Dependencies = Readonly<{
  authorize(authorization: string | null): boolean;
  claim(limit: number): Promise<ClaimedReminder[]>;
  recheck(delivery: ClaimedReminder): Promise<boolean>;
  send(
    delivery: ClaimedReminder,
  ): Promise<{ providerMessageId: string; acceptedAt: string }>;
  accept(
    delivery: ClaimedReminder,
    result: { providerMessageId: string; acceptedAt: string },
  ): Promise<void>;
  cancel(delivery: ClaimedReminder): Promise<void>;
  release(delivery: ClaimedReminder): Promise<void>;
}>;

export const createReminderWorkerHandler =
  (dependencies: Dependencies) =>
  async (
    request: Request,
  ): Promise<Response> => {
    const requestId = crypto.randomUUID();
    if (request.method !== "POST") {
      return jsonResponse(405, { error: "method-not-allowed", requestId });
    }
    if (!dependencies.authorize(request.headers.get("authorization"))) {
      return jsonResponse(401, { error: "unauthorized", requestId });
    }
    try {
      const claimed = (await dependencies.claim(100)).slice(0, 100);
      let sent = 0;
      let cancelled = 0;
      let released = 0;
      for (const delivery of claimed) {
        try {
          if (!await dependencies.recheck(delivery)) {
            await dependencies.cancel(delivery);
            cancelled += 1;
            continue;
          }
          const result = await dependencies.send(delivery);
          await dependencies.accept(delivery, result);
          sent += 1;
        } catch {
          await dependencies.release(delivery);
          released += 1;
        }
      }
      return jsonResponse(200, {
        requestId,
        claimed: claimed.length,
        sent,
        cancelled,
        released,
      });
    } catch {
      return jsonResponse(503, { error: "temporarily-unavailable", requestId });
    }
  };

const parseClaimed = (value: unknown): ClaimedReminder[] => {
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error("invalid-database-response");
  }
  return value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error("invalid-database-response");
    }
    const row = item as Record<string, unknown>;
    const required = [
      "id",
      "recipientEmail",
      "businessName",
      "invoiceNumber",
      "dueOccurrence",
    ] as const;
    if (required.some((key) => typeof row[key] !== "string")) {
      throw new Error("invalid-database-response");
    }
    const balance = row.balanceCents;
    if (!Number.isSafeInteger(balance) || Number(balance) < 1) {
      throw new Error("invalid-database-response");
    }
    const dueLabel = row.dueOccurrence === "three-days-before"
      ? "due soon"
      : row.dueOccurrence === "due"
      ? "due today"
      : "overdue";
    return {
      id: String(row.id),
      idempotencyKey: `reminder:${String(row.id)}`,
      to: String(row.recipientEmail),
      subject: `${String(row.businessName)} invoice ${
        String(row.invoiceNumber)
      } is ${dueLabel}`,
      text: `This is a reminder that invoice ${
        String(row.invoiceNumber)
      } has a remaining balance of $${
        (Number(balance) / 100).toFixed(2)
      } and is ${dueLabel}.`,
      ...(typeof row.replyTo === "string" ? { replyTo: row.replyTo } : {}),
    };
  });
};

export const createProductionReminderWorkerHandler = (
  environment: Record<string, string>,
  fetcher: typeof fetch = fetch,
) => {
  const service = createSupabaseService(environment, fetcher);
  const workerSecret = requiredEnvironment(
    environment,
    "REMINDER_WORKER_SECRET",
  );
  const gateway = createReminderDeliveryGateway({
    endpoint: requiredEnvironment(environment, "REMINDER_PROVIDER_ENDPOINT"),
    apiKey: requiredEnvironment(environment, "REMINDER_PROVIDER_API_KEY"),
    from: requiredEnvironment(environment, "REMINDER_FROM_EMAIL"),
    fetcher,
  });
  return createReminderWorkerHandler({
    authorize: (authorization) => authorization === `Bearer ${workerSecret}`,
    claim: async (limit) =>
      parseClaimed(
        await service.serviceRpc("fieldcraft_claim_reminders", {
          p_limit: limit,
        }),
      ),
    async recheck(delivery) {
      const value = await service.serviceRpc("fieldcraft_recheck_reminder", {
        p_delivery_id: delivery.id,
      }) as { eligible?: unknown } | null;
      return value?.eligible === true;
    },
    send: (delivery) => gateway.send(delivery),
    accept: async (delivery, result) => {
      await service.serviceRpc("fieldcraft_accept_reminder", {
        p_delivery_id: delivery.id,
        p_provider_message_id: result.providerMessageId,
        p_accepted_at: result.acceptedAt,
      });
    },
    cancel: async (delivery) => {
      await service.serviceRpc("fieldcraft_cancel_reminder", {
        p_delivery_id: delivery.id,
      });
    },
    release: async (delivery) => {
      await service.serviceRpc("fieldcraft_release_reminder", {
        p_delivery_id: delivery.id,
      });
    },
  });
};

if (import.meta.main) {
  Deno.serve(createProductionReminderWorkerHandler(Deno.env.toObject()));
}
