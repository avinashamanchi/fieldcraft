import { readBoundedBody } from "./body.ts";

const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const encoder = new TextEncoder();

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const hmac = async (secret: string, value: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
    ),
  );
};

const timingSafeEqualHex = (left: string, right: string): boolean => {
  if (
    !/^[0-9a-f]+$/i.test(left) || !/^[0-9a-f]+$/i.test(right) ||
    left.length !== right.length
  ) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

export const createStripeSignature = async (
  rawBody: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
): Promise<string> =>
  `t=${timestamp},v1=${await hmac(secret, `${timestamp}.${rawBody}`)}`;

export const verifyStripeSignature = async (
  rawBody: string,
  header: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): Promise<boolean> => {
  if (
    !header || !secret ||
    encoder.encode(rawBody).byteLength > MAX_PROVIDER_RESPONSE_BYTES
  ) return false;
  const fields = header.split(",").map((part) => part.trim().split("=", 2));
  const timestampText = fields.find(([key]) => key === "t")?.[1];
  const signatures = fields.filter(([key]) => key === "v1").map(([, value]) =>
    value
  );
  if (
    !timestampText || !/^\d{1,12}$/.test(timestampText) ||
    signatures.length === 0
  ) return false;
  const timestamp = Number(timestampText);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(nowSeconds - timestamp) > toleranceSeconds
  ) return false;
  const expected = await hmac(secret, `${timestamp}.${rawBody}`);
  return signatures.some((signature) =>
    timingSafeEqualHex(signature, expected)
  );
};

export type StripeRequestOptions = Readonly<{
  connectedAccountId?: string;
  idempotencyKey?: string;
  method?: "GET" | "POST" | "DELETE";
}>;

export type StripeTransport = Readonly<{
  request(
    path: string,
    parameters?: Record<string, string>,
    options?: StripeRequestOptions,
  ): Promise<Record<string, unknown>>;
}>;

const assertStripeId = (value: string, prefix: string): string => {
  if (!new RegExp(`^${prefix}_[A-Za-z0-9]{3,255}$`).test(value)) {
    throw new Error("invalid-provider-identity");
  }
  return value;
};

export const createStripeTransport = (
  configuration: Readonly<{
    secretKey: string;
    fetcher?: typeof fetch;
    endpoint?: string;
    timeoutMs?: number;
  }>,
): StripeTransport => {
  const endpoint = new URL(
    configuration.endpoint ?? "https://api.stripe.com/v1/",
  );
  if (
    endpoint.protocol !== "https:" || endpoint.username || endpoint.password ||
    endpoint.search || endpoint.hash
  ) {
    throw new Error("invalid-provider-endpoint");
  }
  if (!/^sk_(test|live)_[A-Za-z0-9_]{8,}$/.test(configuration.secretKey)) {
    throw new Error("invalid-provider-credential");
  }
  return {
    async request(path, parameters = {}, options = {}) {
      if (!/^[a-z0-9_/-]{1,255}$/i.test(path) || path.includes("..")) {
        throw new Error("invalid-provider-path");
      }
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        configuration.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      try {
        const method = options.method ?? "POST";
        const url = new URL(path.replace(/^\//, ""), endpoint);
        if (method === "GET") {
          for (const [key, value] of Object.entries(parameters)) {
            url.searchParams.set(key, value);
          }
        }
        const headers = new Headers({
          Authorization: `Bearer ${configuration.secretKey}`,
          "Stripe-Version": "2025-07-30.basil",
        });
        if (method !== "GET") {
          headers.set("Content-Type", "application/x-www-form-urlencoded");
        }
        if (options.connectedAccountId) {
          headers.set(
            "Stripe-Account",
            assertStripeId(options.connectedAccountId, "acct"),
          );
        }
        if (options.idempotencyKey) {
          if (!/^[A-Za-z0-9:_-]{1,255}$/.test(options.idempotencyKey)) {
            throw new Error("invalid-idempotency-key");
          }
          headers.set("Idempotency-Key", options.idempotencyKey);
        }
        const response = await (configuration.fetcher ?? fetch)(url, {
          method,
          signal: controller.signal,
          headers,
          ...(method === "GET"
            ? {}
            : { body: new URLSearchParams(parameters) }),
        });
        if (!response.ok) throw new Error(`provider-http-${response.status}`);
        let parsed: unknown;
        try {
          parsed = JSON.parse(
            await readBoundedBody(response, MAX_PROVIDER_RESPONSE_BYTES),
          );
        } catch {
          throw new Error("invalid-provider-response");
        }
        if (
          typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
        ) throw new Error("invalid-provider-response");
        return parsed as Record<string, unknown>;
      } catch (cause) {
        if (controller.signal.aborted) throw new Error("provider-timeout");
        throw cause;
      } finally {
        clearTimeout(timer);
      }
    },
  };
};

export const requireStripeId = assertStripeId;
