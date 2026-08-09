import { readBoundedBody } from "../_shared/body.ts";
import { type SafeLogEntry, writeSafeLog } from "../_shared/observability.ts";

const MAX_BODY_BYTES = 64 * 1024;
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EVENT_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const PRODUCTS = new Set([
  "fieldcraft_pro_monthly",
  "fieldcraft_pro_annual",
]);
const TYPES = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "PRODUCT_CHANGE",
  "CANCELLATION",
  "BILLING_ISSUE",
  "SUBSCRIPTION_PAUSED",
  "EXPIRATION",
  "REFUND",
  "REVOKE",
]);
const EVENT_FIELDS = new Set([
  "id",
  "type",
  "app_user_id",
  "original_app_user_id",
  "aliases",
  "app_id",
  "product_id",
  "entitlement_ids",
  "environment",
  "event_timestamp_ms",
  "expiration_at_ms",
  "purchased_at_ms",
  "store",
  "is_family_share",
  "country_code",
  "currency",
  "price",
  "price_in_purchased_currency",
  "period_type",
  "presented_offering_id",
  "transaction_id",
  "original_transaction_id",
  "entitlement_id",
  "cancel_reason",
  "expiration_reason",
  "tax_percentage",
  "commission_percentage",
  "subscriber_attributes",
  "experiments",
  "takehome_percentage",
  "offer_code",
  "renewal_number",
  "metadata",
  "discount_percentage",
  "discount_amount",
  "discount_identifier",
  "quantity",
  "grace_period_expiration_at_ms",
  "auto_resume_at_ms",
  "is_trial_conversion",
  "new_product_id",
]);

type JsonRecord = Record<string, unknown>;

export type NormalizedRevenueCatEvent = Readonly<{
  eventIdHash: string;
  ownerId: string;
  productId: "fieldcraft_pro_monthly" | "fieldcraft_pro_annual";
  environment: "SANDBOX" | "PRODUCTION";
  status:
    | "active"
    | "cancelled"
    | "billing_retry"
    | "grace_period"
    | "expired"
    | "revoked"
    | "refunded";
  providerActive: boolean;
  expiresAt: string;
  providerEventAt: string;
  eventType: string;
}>;

type Outcome = "applied" | "duplicate" | "stale";
type Dependencies = Readonly<{
  secret: string;
  appId: string;
  deadlineMs?: number;
  apply(
    value: NormalizedRevenueCatEvent,
    signal: AbortSignal,
  ): Promise<Outcome>;
  log?(entry: SafeLogEntry): void;
  now?: () => number;
}>;

class StrictJsonParser {
  private index = 0;

  constructor(private readonly source: string) {}

  parse(): unknown {
    const value = this.value();
    this.whitespace();
    if (this.index !== this.source.length) throw new Error("invalid-json");
    return value;
  }

  private value(): unknown {
    this.whitespace();
    const next = this.source[this.index];
    if (next === "{") return this.object();
    if (next === "[") return this.array();
    if (next === '"') return this.string();
    if (this.source.startsWith("true", this.index)) {
      this.index += 4;
      return true;
    }
    if (this.source.startsWith("false", this.index)) {
      this.index += 5;
      return false;
    }
    if (this.source.startsWith("null", this.index)) {
      this.index += 4;
      return null;
    }
    const match = this.source.slice(this.index).match(
      /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/,
    );
    if (!match) throw new Error("invalid-json");
    this.index += match[0].length;
    return Number(match[0]);
  }

  private object(): JsonRecord {
    this.index += 1;
    const result: JsonRecord = {};
    const keys = new Set<string>();
    this.whitespace();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return result;
    }
    while (true) {
      this.whitespace();
      if (this.source[this.index] !== '"') throw new Error("invalid-json");
      const key = this.string();
      if (keys.has(key)) throw new Error("duplicate-json-key");
      keys.add(key);
      this.whitespace();
      if (this.source[this.index] !== ":") throw new Error("invalid-json");
      this.index += 1;
      result[key] = this.value();
      this.whitespace();
      const separator = this.source[this.index];
      if (separator === "}") {
        this.index += 1;
        return result;
      }
      if (separator !== ",") throw new Error("invalid-json");
      this.index += 1;
    }
  }

  private array(): unknown[] {
    this.index += 1;
    const result: unknown[] = [];
    this.whitespace();
    if (this.source[this.index] === "]") {
      this.index += 1;
      return result;
    }
    while (true) {
      result.push(this.value());
      this.whitespace();
      const separator = this.source[this.index];
      if (separator === "]") {
        this.index += 1;
        return result;
      }
      if (separator !== ",") throw new Error("invalid-json");
      this.index += 1;
    }
  }

  private string(): string {
    const start = this.index;
    this.index += 1;
    let escaped = false;
    while (this.index < this.source.length) {
      const character = this.source[this.index];
      this.index += 1;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === '"') {
        return JSON.parse(this.source.slice(start, this.index));
      }
      if (character.charCodeAt(0) < 0x20) throw new Error("invalid-json");
    }
    throw new Error("invalid-json");
  }

  private whitespace(): void {
    while (/\s/.test(this.source[this.index] ?? "")) this.index += 1;
  }
}

const record = (value: unknown): JsonRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid-request");
  }
  return value as JsonRecord;
};

const exactFields = (
  value: JsonRecord,
  required: readonly string[],
  allowed: ReadonlySet<string>,
) => {
  if (
    required.some((key) => !(key in value)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) throw new Error("invalid-request");
};

const text = (value: unknown, maximum: number): string => {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    throw new Error("invalid-request");
  }
  return value;
};

const boundedIdentity = (value: unknown): boolean => {
  if (typeof value !== "string" || value.length < 1 || value.length > 256) {
    return false;
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return false;
  }
  return true;
};

const millisecondTimestamp = (value: unknown): string => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("invalid-request");
  }
  const date = new Date(value as number);
  if (!Number.isFinite(date.getTime())) throw new Error("invalid-request");
  return date.toISOString();
};

const digestHex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};

const constantTimeSecret = async (
  authorization: string | null,
  expected: string,
): Promise<boolean> => {
  const supplied = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  const [left, right] = await Promise.all([
    digestHex(supplied),
    digestHex(expected),
  ]);
  let difference = supplied.length === expected.length ? 0 : 1;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

const statusFor = (eventType: string): NormalizedRevenueCatEvent["status"] => {
  if (
    ["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE"]
      .includes(eventType)
  ) {
    return "active";
  }
  if (eventType === "CANCELLATION") return "cancelled";
  if (eventType === "BILLING_ISSUE") return "billing_retry";
  if (eventType === "SUBSCRIPTION_PAUSED") return "grace_period";
  if (eventType === "EXPIRATION") return "expired";
  if (eventType === "REFUND") return "refunded";
  return "revoked";
};

const normalize = async (
  raw: unknown,
  expectedAppId: string,
): Promise<NormalizedRevenueCatEvent> => {
  const envelope = record(raw);
  exactFields(
    envelope,
    ["api_version", "event"],
    new Set([
      "api_version",
      "event",
    ]),
  );
  if (envelope.api_version !== "1.0") throw new Error("invalid-request");
  const event = record(envelope.event);
  exactFields(event, [
    "id",
    "type",
    "app_user_id",
    "original_app_user_id",
    "aliases",
    "app_id",
    "product_id",
    "entitlement_ids",
    "environment",
    "event_timestamp_ms",
    "expiration_at_ms",
  ], EVENT_FIELDS);
  const eventId = text(event.id, 128);
  const eventType = text(event.type, 40);
  const ownerId = text(event.app_user_id, 36);
  const originalOwnerId = text(event.original_app_user_id, 256);
  const appId = text(event.app_id, 120);
  const productId = text(event.product_id, 80);
  if (
    !EVENT_ID.test(eventId) || !TYPES.has(eventType) ||
    !UUID_V4.test(ownerId) || !boundedIdentity(originalOwnerId) ||
    appId !== expectedAppId ||
    !PRODUCTS.has(productId) ||
    !Array.isArray(event.aliases) || event.aliases.length > 32 ||
    event.aliases.some((alias) => !boundedIdentity(alias)) ||
    !Array.isArray(event.entitlement_ids) ||
    event.entitlement_ids.length !== 1 || event.entitlement_ids[0] !== "pro" ||
    (event.environment !== "SANDBOX" && event.environment !== "PRODUCTION")
  ) throw new Error("invalid-request");
  const status = statusFor(eventType);
  const expiresAt = millisecondTimestamp(event.expiration_at_ms);
  return {
    eventIdHash: await digestHex(eventId),
    ownerId,
    productId: productId as NormalizedRevenueCatEvent["productId"],
    environment: event.environment,
    status,
    providerActive: ["active", "cancelled", "billing_retry", "grace_period"]
      .includes(status),
    expiresAt,
    providerEventAt: millisecondTimestamp(event.event_timestamp_ms),
    eventType,
  };
};

const response = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

export const createRevenueCatWebhookHandler = (dependencies: Dependencies) => {
  const deadlineMs = dependencies.deadlineMs ?? 10_000;
  if (
    dependencies.secret.length < 32 || dependencies.secret.length > 256 ||
    !/^[A-Za-z0-9._~+/-]{1,120}$/.test(dependencies.appId) ||
    !Number.isFinite(deadlineMs) || deadlineMs <= 0 || deadlineMs > 10_000
  ) throw new Error("RevenueCat webhook configuration is invalid");
  return async (request: Request): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const started = (dependencies.now ?? Date.now)();
    const controller = new AbortController();
    const deadline = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => reject(new Error("deadline")),
        { once: true },
      );
    });
    const timeout = setTimeout(() => controller.abort(), deadlineMs);
    const withinDeadline = <T>(operation: Promise<T>): Promise<T> =>
      Promise.race([operation, deadline]);
    let status = 200;
    let publicCode = "ok";
    let outcome: Outcome | undefined;
    try {
      if (request.method !== "POST") {
        status = 405;
        publicCode = "method-not-allowed";
        return response(status, { error: publicCode, requestId });
      }
      if (
        !(await withinDeadline(constantTimeSecret(
          request.headers.get("authorization"),
          dependencies.secret,
        )))
      ) {
        status = 401;
        publicCode = "unauthorized";
        return response(status, { error: publicCode, requestId });
      }
      if (
        request.headers.get("content-type")?.split(";", 1)[0] !==
          "application/json"
      ) {
        throw new Error("invalid-request");
      }
      const declared = Number(request.headers.get("content-length") ?? 0);
      if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
        throw new Error("body-too-large");
      }
      let raw: string;
      try {
        raw = await withinDeadline(readBoundedBody(request, MAX_BODY_BYTES));
      } catch (cause) {
        if (
          cause instanceof Error &&
          (cause.message === "body-too-large" || cause.message === "deadline")
        ) throw cause;
        throw new Error("invalid-request");
      }
      const parsed = new StrictJsonParser(raw).parse();
      const normalized = await withinDeadline(
        normalize(parsed, dependencies.appId),
      );
      outcome = await withinDeadline(
        dependencies.apply(normalized, controller.signal),
      );
      if (!(["applied", "duplicate", "stale"] as const).includes(outcome)) {
        throw new Error("invalid-provider-response");
      }
      return response(200, { status: outcome, requestId });
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "internal";
      if (code === "body-too-large") {
        status = 413;
        publicCode = "request-too-large";
      } else if (
        ["invalid-request", "invalid-json", "duplicate-json-key"].includes(code)
      ) {
        status = 400;
        publicCode = "invalid-request";
      } else if (code === "deadline") {
        status = 504;
        publicCode = "upstream-timeout";
      } else {
        status = 503;
        publicCode = "temporarily-unavailable";
      }
      return response(status, { error: publicCode, requestId });
    } finally {
      clearTimeout(timeout);
      const latency = (dependencies.now ?? Date.now)() - started;
      const entry: SafeLogEntry = {
        requestId,
        status,
        publicCode,
        ...(outcome ? { outcome } : {}),
        latencyBucket: latency < 100
          ? "<100ms"
          : latency < 1000
          ? "<1s"
          : latency < 10_000
          ? "<10s"
          : ">=10s",
      };
      if (dependencies.log) dependencies.log(entry);
      else writeSafeLog(entry);
    }
  };
};

const required = (environment: Record<string, string>, key: string): string => {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

export const createProductionRevenueCatWebhookHandler = (
  environment: Record<string, string>,
  fetcher: typeof fetch = fetch,
) => {
  const secret = required(environment, "REVENUECAT_WEBHOOK_SECRET");
  const appId = required(environment, "REVENUECAT_APP_ID");
  const supabaseUrl = required(environment, "SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = required(environment, "SUPABASE_SERVICE_ROLE_KEY");
  return createRevenueCatWebhookHandler({
    secret,
    appId,
    async apply(value, signal) {
      const result = await fetcher(
        `${supabaseUrl}/rest/v1/rpc/apply_revenuecat_event`,
        {
          method: "POST",
          redirect: "error",
          signal,
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            apikey: serviceRoleKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            p_event_id_hash: value.eventIdHash,
            p_user_id: value.ownerId,
            p_product_id: value.productId,
            p_environment: value.environment,
            p_status: value.status,
            p_provider_active: value.providerActive,
            p_expires_at: value.expiresAt,
            p_provider_event_at: value.providerEventAt,
            p_event_type: value.eventType,
          }),
        },
      );
      if (!result.ok) throw new Error("provider-failure");
      let outcome: unknown;
      try {
        outcome = JSON.parse(await readBoundedBody(result, 1024));
      } catch {
        throw new Error("provider-failure");
      }
      if (
        outcome !== "applied" && outcome !== "duplicate" && outcome !== "stale"
      ) {
        throw new Error("provider-failure");
      }
      return outcome;
    },
  });
};

if (import.meta.main) {
  Deno.serve(createProductionRevenueCatWebhookHandler(Deno.env.toObject()));
}
