import { authenticate } from "../_shared/auth.ts";
import { readBoundedBody } from "../_shared/body.ts";
import { createSupabaseService } from "../_shared/service.ts";
import { createStripeTransport, requireStripeId } from "../_shared/stripe.ts";

type Dependencies = {
  allowedOrigins: Set<string>;
  authenticateRequest(
    authorization: string | null,
  ): Promise<{ userId: string }>;
  requireRecentAal2(authorization: string): Promise<void>;
  invalidateOwnerWork(userId: string): Promise<void>;
  revokePaymentLinks(userId: string): Promise<void>;
  cancelReminders(userId: string): Promise<void>;
  disconnectProvider(userId: string): Promise<void>;
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
      const authorization = request.headers.get("authorization");
      const identity = await dependencies.authenticateRequest(authorization);
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
      if (!authorization) throw new Error("unauthorized");
      await dependencies.requireRecentAal2(authorization);
      await dependencies.invalidateOwnerWork(identity.userId);
      await dependencies.revokePaymentLinks(identity.userId);
      await dependencies.cancelReminders(identity.userId);
      try {
        await dependencies.disconnectProvider(identity.userId);
      } catch {
        // Provider unlinking is deliberately best effort. Required local/cloud
        // revocation has already completed and auth deletion must remain usable
        // during a provider outage.
      }
      await dependencies.deleteLogo(identity.userId);
      await dependencies.deleteUser(identity.userId);
      return json(200, { requestId, status: "deleted" }, cors);
    } catch (cause) {
      if (cause instanceof Error && cause.message === "unauthorized") {
        status = 401;
        publicCode = "unauthorized";
      } else if (cause instanceof Error && cause.message === "aal2-required") {
        status = 403;
        publicCode = "recent-aal2-required";
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
  fetcher: typeof fetch = fetch,
) => {
  const supabaseUrl = required(environment, "SUPABASE_URL").replace(/\/$/, "");
  const publishableKey = environment.SUPABASE_ANON_KEY?.trim() ||
    required(environment, "SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = required(environment, "SUPABASE_SERVICE_ROLE_KEY");
  const service = createSupabaseService(environment, fetcher);
  const stripeKey = environment.STRIPE_SECRET_KEY?.trim();
  const stripe = stripeKey
    ? createStripeTransport({ secretKey: stripeKey, fetcher })
    : null;
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
      authenticate(authorization, { supabaseUrl, publishableKey, fetcher }),
    async requireRecentAal2(authorization) {
      const response = await fetcher(
        `${supabaseUrl}/rest/v1/rpc/fieldcraft_require_aal2`,
        {
          method: "POST",
          headers: {
            Authorization: authorization,
            apikey: publishableKey,
            "Content-Type": "application/json",
          },
          body: "{}",
        },
      );
      if (response.status === 401 || response.status === 403) {
        throw new Error("aal2-required");
      }
      if (!response.ok) throw new Error("aal2-check-failed");
    },
    async invalidateOwnerWork(userId) {
      await service.serviceRpc("fieldcraft_invalidate_owner_work", {
        p_user_id: userId,
      });
    },
    async revokePaymentLinks(userId) {
      await service.serviceRpc("fieldcraft_revoke_owner_payment_links", {
        p_user_id: userId,
      });
    },
    async cancelReminders(userId) {
      await service.serviceRpc("fieldcraft_cancel_owner_reminders", {
        p_user_id: userId,
      });
    },
    async disconnectProvider(userId) {
      if (!stripe) return;
      const value = await service.serviceRpc("fieldcraft_get_stripe_account", {
        p_user_id: userId,
      });
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return;
      }
      const connectedAccountId = (value as Record<string, unknown>)
        .connectedAccountId;
      if (typeof connectedAccountId !== "string") return;
      const accountId = requireStripeId(connectedAccountId, "acct");
      await stripe.request(`accounts/${accountId}`, {}, {
        method: "DELETE",
        idempotencyKey: `fieldcraft-account-delete:${userId}`,
      });
      await service.serviceRpc("fieldcraft_delete_stripe_account", {
        p_user_id: userId,
        p_connected_account_id: accountId,
      });
    },
    async deleteLogo(userId) {
      const response = await fetcher(
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
      const response = await fetcher(
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
