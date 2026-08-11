import { createStripeTransport, requireStripeId } from "../_shared/stripe.ts";
import {
  createSupabaseService,
  jsonResponse,
  parseJsonBody,
  requiredEnvironment,
  requireExactKeys,
  requirePro,
  requireRecentAal2,
} from "../_shared/service.ts";

type ConnectStatus = Readonly<
  {
    state: "not-connected" | "pending" | "restricted" | "complete";
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
  }
>;
type Dependencies = Readonly<{
  authenticate(authorization: string | null): Promise<{ userId: string }>;
  requireRecentAal2(authorization: string): Promise<void>;
  requirePro(authorization: string): Promise<void>;
  createOnboarding(userId: string): Promise<{ url: string; expiresAt: string }>;
  readStatus(userId: string): Promise<ConnectStatus>;
  disconnect(userId: string): Promise<void>;
}>;

const mapError = (cause: unknown): [number, string] => {
  const message = cause instanceof Error ? cause.message : "";
  if (message === "unauthorized") return [401, "unauthorized"];
  if (message === "aal2-required") return [403, "recent-aal2-required"];
  if (message === "pro-required") return [403, "pro-required"];
  if (message === "invalid-request") return [400, "invalid-request"];
  return [503, "temporarily-unavailable"];
};

export const createStripeConnectHandler =
  (dependencies: Dependencies) =>
  async (
    request: Request,
  ): Promise<Response> => {
    const requestId = crypto.randomUUID();
    try {
      if (request.method !== "POST") {
        return jsonResponse(405, { error: "method-not-allowed", requestId });
      }
      const authorization = request.headers.get("authorization");
      const identity = await dependencies.authenticate(authorization);
      if (!authorization) throw new Error("unauthorized");
      const body = await parseJsonBody(request, 1024);
      requireExactKeys(body, ["action"]);
      if (!["onboard", "status", "disconnect"].includes(String(body.action))) {
        throw new Error("invalid-request");
      }
      await dependencies.requireRecentAal2(authorization);
      await dependencies.requirePro(authorization);
      if (body.action === "onboard") {
        return jsonResponse(200, {
          requestId,
          ...(await dependencies.createOnboarding(identity.userId)),
        });
      }
      if (body.action === "disconnect") {
        await dependencies.disconnect(identity.userId);
        return jsonResponse(200, { requestId, status: "disconnected" });
      }
      return jsonResponse(200, {
        requestId,
        ...(await dependencies.readStatus(identity.userId)),
      });
    } catch (cause) {
      const [status, error] = mapError(cause);
      return jsonResponse(status, { error, requestId });
    }
  };

export const createProductionStripeConnectHandler = (
  environment: Record<string, string>,
  fetcher: typeof fetch = fetch,
) => {
  const service = createSupabaseService(environment, fetcher);
  const stripe = createStripeTransport({
    secretKey: requiredEnvironment(environment, "STRIPE_SECRET_KEY"),
    fetcher,
  });
  const returnUrl = new URL(
    requiredEnvironment(environment, "STRIPE_CONNECT_RETURN_URL"),
  );
  const refreshUrl = new URL(
    requiredEnvironment(environment, "STRIPE_CONNECT_REFRESH_URL"),
  );
  if (returnUrl.protocol !== "https:" || refreshUrl.protocol !== "https:") {
    throw new Error("Stripe Connect return URLs must use HTTPS");
  }

  const readAccount = async (
    userId: string,
  ): Promise<Record<string, unknown> | null> => {
    const value = await service.serviceRpc("fieldcraft_get_stripe_account", {
      p_user_id: userId,
    });
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  };
  return createStripeConnectHandler({
    authenticate: service.authenticate,
    requireRecentAal2: (authorization) =>
      requireRecentAal2(service, authorization),
    requirePro: (authorization) => requirePro(service, authorization),
    async createOnboarding(userId) {
      const account = await readAccount(userId);
      let accountId = typeof account?.connectedAccountId === "string"
        ? requireStripeId(account.connectedAccountId, "acct")
        : null;
      if (!accountId) {
        const created = await stripe.request("accounts", {
          type: "express",
          "capabilities[card_payments][requested]": "true",
          "capabilities[transfers][requested]": "true",
          "metadata[fieldcraft_user_id]": userId,
        }, { idempotencyKey: `fieldcraft-connect:${userId}` });
        accountId = requireStripeId(String(created.id), "acct");
        await service.serviceRpc("fieldcraft_upsert_stripe_account", {
          p_user_id: userId,
          p_connected_account_id: accountId,
          p_charges_enabled: false,
          p_payouts_enabled: false,
          p_requirements_state: "pending",
        });
      }
      const link = await stripe.request("account_links", {
        account: accountId,
        type: "account_onboarding",
        return_url: returnUrl.toString(),
        refresh_url: refreshUrl.toString(),
      }, {
        idempotencyKey: `fieldcraft-connect-link:${userId}:${
          Math.floor(Date.now() / 300_000)
        }`,
      });
      if (
        typeof link.url !== "string" ||
        !link.url.startsWith("https://connect.stripe.com/") ||
        !Number.isSafeInteger(link.expires_at)
      ) throw new Error("invalid-provider-response");
      return {
        url: link.url,
        expiresAt: new Date(Number(link.expires_at) * 1000).toISOString(),
      };
    },
    async readStatus(userId) {
      const account = await readAccount(userId);
      if (!account || typeof account.connectedAccountId !== "string") {
        return {
          state: "not-connected",
          chargesEnabled: false,
          payoutsEnabled: false,
        };
      }
      const accountId = requireStripeId(account.connectedAccountId, "acct");
      const remote = await stripe.request(`accounts/${accountId}`, {}, {
        method: "GET",
      });
      const chargesEnabled = remote.charges_enabled === true;
      const payoutsEnabled = remote.payouts_enabled === true;
      const state: ConnectStatus["state"] = chargesEnabled && payoutsEnabled
        ? "complete"
        : remote.details_submitted === true
        ? "restricted"
        : "pending";
      await service.serviceRpc("fieldcraft_upsert_stripe_account", {
        p_user_id: userId,
        p_connected_account_id: accountId,
        p_charges_enabled: chargesEnabled,
        p_payouts_enabled: payoutsEnabled,
        p_requirements_state: state,
      });
      return { state, chargesEnabled, payoutsEnabled };
    },
    async disconnect(userId) {
      const account = await readAccount(userId);
      if (!account || typeof account.connectedAccountId !== "string") return;
      const accountId = requireStripeId(account.connectedAccountId, "acct");
      await stripe.request(`accounts/${accountId}`, {}, {
        method: "DELETE",
        idempotencyKey: `fieldcraft-connect-delete:${userId}`,
      });
      await service.serviceRpc("fieldcraft_delete_stripe_account", {
        p_user_id: userId,
        p_connected_account_id: accountId,
      });
    },
  });
};

if (import.meta.main) {
  Deno.serve(createProductionStripeConnectHandler(Deno.env.toObject()));
}
