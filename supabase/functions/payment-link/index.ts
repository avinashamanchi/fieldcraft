import {
  createSupabaseService,
  jsonResponse,
  parseJsonBody,
  requiredEnvironment,
  requireExactKeys,
  requirePro,
  requireRecentAal2,
  requireUuid,
} from "../_shared/service.ts";

type PublicInvoiceSummary = Readonly<{
  businessName: string;
  invoiceNumber: string;
  currency: "USD";
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  minimumCents: number;
  maximumCents: number;
}>;

type Dependencies = Readonly<{
  authenticate(authorization: string | null): Promise<{ userId: string }>;
  requireRecentAal2(authorization: string): Promise<void>;
  requirePro(authorization: string): Promise<void>;
  issue(
    userId: string,
    invoiceId: string,
  ): Promise<{ token: string; expiresAt: string }>;
  revoke(userId: string, invoiceId: string): Promise<void>;
  resolve(token: string): Promise<PublicInvoiceSummary>;
  publicBaseUrl: string;
}>;

const tokenPattern = /^[A-Za-z0-9_-]{32,128}$/;
const safeSummary = (value: PublicInvoiceSummary): PublicInvoiceSummary => {
  if (
    value.currency !== "USD" || value.businessName.length > 200 ||
    value.invoiceNumber.length > 100
  ) throw new Error("invalid-response");
  for (
    const amount of [
      value.totalCents,
      value.paidCents,
      value.balanceCents,
      value.minimumCents,
      value.maximumCents,
    ]
  ) {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 100_000_000) {
      throw new Error("invalid-response");
    }
  }
  if (
    value.paidCents + value.balanceCents !== value.totalCents ||
    value.maximumCents !== value.balanceCents
  ) throw new Error("invalid-response");
  return value;
};

export const createPaymentLinkHandler = (dependencies: Dependencies) =>
async (
  request: Request,
): Promise<Response> => {
  const requestId = crypto.randomUUID();
  try {
    if (request.method === "GET") {
      const token = new URL(request.url).searchParams.get("token") ?? "";
      if (!tokenPattern.test(token)) throw new Error("not-found");
      return jsonResponse(200, {
        requestId,
        ...safeSummary(await dependencies.resolve(token)),
        paymentMethods: "Apple Pay or card when available",
      });
    }
    if (request.method !== "POST") {
      return jsonResponse(405, { error: "method-not-allowed", requestId });
    }
    const authorization = request.headers.get("authorization");
    const identity = await dependencies.authenticate(authorization);
    if (!authorization) throw new Error("unauthorized");
    const body = await parseJsonBody(request, 1024);
    requireExactKeys(body, ["action", "invoiceId"]);
    const invoiceId = requireUuid(body.invoiceId);
    if (body.action !== "issue" && body.action !== "revoke") {
      throw new Error("invalid-request");
    }
    await dependencies.requireRecentAal2(authorization);
    await dependencies.requirePro(authorization);
    if (body.action === "revoke") {
      await dependencies.revoke(identity.userId, invoiceId);
      return jsonResponse(200, { requestId, status: "revoked" });
    }
    const issued = await dependencies.issue(identity.userId, invoiceId);
    if (
      !tokenPattern.test(issued.token) ||
      !Number.isFinite(Date.parse(issued.expiresAt))
    ) throw new Error("invalid-response");
    const url = new URL(dependencies.publicBaseUrl);
    url.searchParams.set("token", issued.token);
    return jsonResponse(200, {
      requestId,
      url: url.toString(),
      expiresAt: issued.expiresAt,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    const [status, error] = message === "unauthorized"
      ? [401, "unauthorized"]
      : message === "aal2-required"
      ? [403, "recent-aal2-required"]
      : message === "pro-required"
      ? [403, "pro-required"]
      : message === "not-found"
      ? [404, "not-found"]
      : message === "invalid-request"
      ? [400, "invalid-request"]
      : [503, "temporarily-unavailable"];
    return jsonResponse(status, { error, requestId });
  }
};

const randomToken = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(
    /\//g,
    "_",
  ).replace(/=+$/, "");
};
const sha256Hex = async (value: string): Promise<string> =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

export const createProductionPaymentLinkHandler = (
  environment: Record<string, string>,
  fetcher: typeof fetch = fetch,
) => {
  const service = createSupabaseService(environment, fetcher);
  const publicBaseUrl = new URL(
    requiredEnvironment(environment, "PAYMENT_PUBLIC_URL"),
  );
  if (
    publicBaseUrl.protocol !== "https:" || publicBaseUrl.username ||
    publicBaseUrl.password
  ) throw new Error("Payment public URL must use HTTPS");
  return createPaymentLinkHandler({
    authenticate: service.authenticate,
    requireRecentAal2: (authorization) =>
      requireRecentAal2(service, authorization),
    requirePro: (authorization) => requirePro(service, authorization),
    async issue(userId, invoiceId) {
      const token = randomToken();
      const result = await service.serviceRpc("fieldcraft_issue_payment_link", {
        p_user_id: userId,
        p_invoice_id: invoiceId,
        p_token_hash_hex: await sha256Hex(token),
      }) as { expiresAt?: unknown } | null;
      if (typeof result?.expiresAt !== "string") {
        throw new Error("invalid-response");
      }
      return { token, expiresAt: result.expiresAt };
    },
    revoke: async (userId, invoiceId) => {
      await service.serviceRpc("fieldcraft_revoke_payment_link", {
        p_user_id: userId,
        p_invoice_id: invoiceId,
      });
    },
    async resolve(token) {
      const result = await service.serviceRpc(
        "fieldcraft_resolve_payment_link",
        { p_token_hash_hex: await sha256Hex(token) },
      );
      if (
        typeof result !== "object" || result === null || Array.isArray(result)
      ) throw new Error("not-found");
      return result as PublicInvoiceSummary;
    },
    publicBaseUrl: publicBaseUrl.toString(),
  });
};

if (import.meta.main) {
  Deno.serve(createProductionPaymentLinkHandler(Deno.env.toObject()));
}
