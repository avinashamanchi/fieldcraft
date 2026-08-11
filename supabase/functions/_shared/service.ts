import { authenticate } from "./auth.ts";
import { readBoundedBody } from "./body.ts";

export const requiredEnvironment = (
  environment: Record<string, string>,
  key: string,
): string => {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

export const jsonResponse = (
  status: number,
  body: Record<string, unknown>,
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

export const parseJsonBody = async (
  request: Request,
  maximumBytes = 8 * 1024,
): Promise<Record<string, unknown>> => {
  let value: unknown;
  try {
    value = JSON.parse(await readBoundedBody(request, maximumBytes));
  } catch {
    throw new Error("invalid-request");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid-request");
  }
  return value as Record<string, unknown>;
};

export const createSupabaseService = (
  environment: Record<string, string>,
  fetcher: typeof fetch = fetch,
) => {
  const supabaseUrl = requiredEnvironment(environment, "SUPABASE_URL").replace(
    /\/$/,
    "",
  );
  const publishableKey = environment.SUPABASE_ANON_KEY?.trim() ||
    requiredEnvironment(environment, "SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = requiredEnvironment(
    environment,
    "SUPABASE_SERVICE_ROLE_KEY",
  );
  const callRpc = async (
    name: string,
    body: Record<string, unknown>,
    authorization: string,
    apiKey: string,
  ): Promise<unknown> => {
    if (!/^[a-z0-9_]{1,80}$/.test(name)) throw new Error("invalid-rpc");
    const response = await fetcher(`${supabaseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        Authorization: authorization,
        apikey: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      if (response.status === 401) throw new Error("unauthorized");
      if (response.status === 403) throw new Error("forbidden");
      throw new Error("database-unavailable");
    }
    const text = await readBoundedBody(response, 64 * 1024);
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      throw new Error("invalid-database-response");
    }
  };
  return {
    supabaseUrl,
    publishableKey,
    serviceAuthorization: `Bearer ${serviceRoleKey}`,
    authenticate: (authorization: string | null) =>
      authenticate(authorization, { supabaseUrl, publishableKey, fetcher }),
    userRpc: (
      name: string,
      body: Record<string, unknown>,
      authorization: string,
    ) => callRpc(name, body, authorization, publishableKey),
    serviceRpc: (name: string, body: Record<string, unknown>) =>
      callRpc(name, body, `Bearer ${serviceRoleKey}`, serviceRoleKey),
  };
};

export const requireExactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): void => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("invalid-request");
  }
};

export const requireUuid = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value)
  ) throw new Error("invalid-request");
  return value;
};

export const requireRecentAal2 = async (
  service: ReturnType<typeof createSupabaseService>,
  authorization: string,
): Promise<void> => {
  try {
    await service.userRpc("fieldcraft_require_aal2", {}, authorization);
  } catch (cause) {
    if (
      cause instanceof Error &&
      (cause.message === "unauthorized" || cause.message === "forbidden")
    ) throw new Error("aal2-required");
    throw cause;
  }
};

export const requirePro = async (
  service: ReturnType<typeof createSupabaseService>,
  authorization: string,
): Promise<void> => {
  let result: { active?: unknown } | null;
  try {
    result = await service.userRpc(
      "fieldcraft_require_pro",
      {},
      authorization,
    ) as { active?: unknown } | null;
  } catch (cause) {
    if (cause instanceof Error && cause.message === "forbidden") {
      throw new Error("pro-required");
    }
    throw cause;
  }
  if (result?.active !== true) throw new Error("pro-required");
};
