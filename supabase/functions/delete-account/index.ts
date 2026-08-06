import { authenticate } from "../_shared/auth.ts";
import { readBoundedBody } from "../_shared/body.ts";

type Dependencies = {
  allowedOrigins: Set<string>;
  authenticateRequest(
    authorization: string | null,
  ): Promise<{ userId: string }>;
  deleteLogo(userId: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  log(entry: { requestId: string; status: number; publicCode: string }): void;
};

const json = (
  status: number,
  body: Record<string, unknown>,
  headers: HeadersInit = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers,
    },
  });

const corsHeaders = (
  request: Request,
  allowed: Set<string>,
): Record<string, string> => {
  const origin = request.headers.get("origin");
  return origin && allowed.has(origin)
    ? {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers":
        "authorization, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      Vary: "Origin",
    }
    : {};
};

export const createDeleteAccountHandler =
  (dependencies: Dependencies) =>
  async (
    request: Request,
  ): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const cors = corsHeaders(request, dependencies.allowedOrigins);
    let status = 200;
    let publicCode = "deleted";
    try {
      if (request.method === "OPTIONS") {
        status = 204;
        publicCode = "preflight";
        return new Response(null, { status, headers: cors });
      }
      if (request.method !== "POST") {
        status = 405;
        publicCode = "method-not-allowed";
        return json(status, { error: publicCode, requestId }, cors);
      }
      const identity = await dependencies.authenticateRequest(
        request.headers.get("authorization"),
      );
      let body: unknown;
      try {
        body = JSON.parse(await readBoundedBody(request, 1024));
      } catch {
        status = 400;
        publicCode = "invalid-request";
        return json(status, { error: publicCode, requestId }, cors);
      }
      if (
        typeof body !== "object" || body === null || Array.isArray(body) ||
        Object.keys(body).length !== 0
      ) {
        status = 400;
        publicCode = "invalid-request";
        return json(status, { error: publicCode, requestId }, cors);
      }
      await dependencies.deleteLogo(identity.userId);
      await dependencies.deleteUser(identity.userId);
      return json(200, { requestId, status: "deleted" }, cors);
    } catch (cause) {
      if (cause instanceof Error && cause.message === "unauthorized") {
        status = 401;
        publicCode = "unauthorized";
      } else {
        status = 503;
        publicCode = "temporarily-unavailable";
      }
      return json(status, { error: publicCode, requestId }, cors);
    } finally {
      dependencies.log({ requestId, status, publicCode });
    }
  };

const required = (environment: Record<string, string>, key: string): string => {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

export const createProductionDeleteAccountHandler = (
  environment: Record<string, string>,
) => {
  const supabaseUrl = required(environment, "SUPABASE_URL").replace(/\/$/, "");
  const publishableKey = environment.SUPABASE_ANON_KEY?.trim() ||
    required(environment, "SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = required(environment, "SUPABASE_SERVICE_ROLE_KEY");
  const adminHeaders = {
    Authorization: `Bearer ${serviceRoleKey}`,
    apikey: serviceRoleKey,
  };
  return createDeleteAccountHandler({
    allowedOrigins: new Set(
      (environment.DELETE_ACCOUNT_ALLOWED_ORIGINS ??
        "https://avinashamanchi.github.io").split(",").map((value) =>
          value.trim()
        ).filter(Boolean),
    ),
    authenticateRequest: (authorization) =>
      authenticate(authorization, { supabaseUrl, publishableKey }),
    async deleteLogo(userId) {
      const response = await fetch(
        `${supabaseUrl}/storage/v1/object/business-logos/${
          encodeURIComponent(userId)
        }/logo.jpg`,
        { method: "DELETE", headers: adminHeaders },
      );
      if (!response.ok && response.status !== 404) {
        throw new Error("storage-delete-failed");
      }
    },
    async deleteUser(userId) {
      const response = await fetch(
        `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
        { method: "DELETE", headers: adminHeaders },
      );
      if (!response.ok) throw new Error("account-delete-failed");
    },
    log: (entry) => console.info(JSON.stringify(entry)),
  });
};

if (import.meta.main) {
  Deno.serve(createProductionDeleteAccountHandler(Deno.env.toObject()));
}
