import type { AiRoute } from "./contracts.ts";
import { readBoundedBody } from "./body.ts";

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
export const digestScope = async (
  secret: string,
  value: string,
): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
};

export type RateResult = { allowed: boolean; retryAfterSeconds: number };
export const consumeRateLimit = async (
  scopeDigest: string,
  route: AiRoute,
  limit: number,
  configuration: {
    supabaseUrl: string;
    serviceRoleKey: string;
    fetcher?: typeof fetch;
  },
): Promise<RateResult> => {
  const response = await (configuration.fetcher ?? fetch)(
    `${configuration.supabaseUrl}/rest/v1/rpc/consume_fieldcraft_ai_rate_limit`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${configuration.serviceRoleKey}`,
        apikey: configuration.serviceRoleKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_scope_digest: scopeDigest,
        p_route: route,
        p_limit: limit,
      }),
    },
  );
  if (!response.ok) throw new Error("rate-limit-unavailable");
  const body = JSON.parse(await readBoundedBody(response, 16 * 1024));
  const result = Array.isArray(body) ? body[0] : body;
  if (
    typeof result?.allowed !== "boolean" ||
    !Number.isSafeInteger(result?.retry_after_seconds)
  ) throw new Error("rate-limit-unavailable");
  return {
    allowed: result.allowed,
    retryAfterSeconds: result.retry_after_seconds,
  };
};
