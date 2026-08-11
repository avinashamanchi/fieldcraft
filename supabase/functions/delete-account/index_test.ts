import {
  createDeleteAccountHandler,
  createProductionDeleteAccountHandler,
} from "./index.ts";
import {
  digestOwnerId,
  type SafeLogEntry,
  writeSafeLog,
} from "../_shared/observability.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const make = (overrides: Record<string, unknown> = {}) => {
  const deleted: string[] = [];
  const logs: unknown[] = [];
  const handler = createDeleteAccountHandler({
    allowedOrigins: new Set(["https://app.example"]),
    authenticateRequest: () =>
      Promise.resolve({
        userId: "70000000-0000-0000-0000-000000000014",
      }),
    requireRecentAal2: () => Promise.resolve(),
    invalidateOwnerWork: (id) => {
      deleted.push(`invalidate:${id}`);
      return Promise.resolve();
    },
    revokePaymentLinks: (id) => {
      deleted.push(`links:${id}`);
      return Promise.resolve();
    },
    cancelReminders: (id) => {
      deleted.push(`reminders:${id}`);
      return Promise.resolve();
    },
    disconnectProvider: (id) => {
      deleted.push(`provider:${id}`);
      return Promise.resolve();
    },
    deleteLogo: (id) => {
      deleted.push(`logo:${id}`);
      return Promise.resolve();
    },
    deleteUser: (id) => {
      deleted.push(`user:${id}`);
      return Promise.resolve();
    },
    log: (entry) => logs.push(entry),
    ...overrides,
  });
  return { handler, deleted, logs };
};

Deno.test("requires POST, authentication, and an exact empty request", async () => {
  const unauthorized = make({
    authenticateRequest: () => Promise.reject(new Error("unauthorized")),
  }).handler;
  assert(
    (await unauthorized(
      new Request("https://edge.example", { method: "POST", body: "{}" }),
    )).status === 401,
    "auth",
  );
  const { handler } = make();
  assert(
    (await handler(new Request("https://edge.example"))).status === 405,
    "method",
  );
  assert(
    (await handler(
      new Request("https://edge.example", {
        method: "POST",
        body: '{"userId":"other"}',
      }),
    )).status === 400,
    "body",
  );
});

Deno.test("deletes only the authenticated owner logo and auth user", async () => {
  const { handler, deleted, logs } = make();
  const response = await handler(
    new Request("https://edge.example", {
      method: "POST",
      headers: { authorization: "Bearer recent-aal2-token" },
      body: "{}",
    }),
  );
  const body = await response.json();
  assert(
    response.status === 200 && body.status === "deleted" &&
      typeof body.requestId === "string",
    "response",
  );
  assert(
    deleted.join(",") ===
      "invalidate:70000000-0000-0000-0000-000000000014,links:70000000-0000-0000-0000-000000000014,reminders:70000000-0000-0000-0000-000000000014,provider:70000000-0000-0000-0000-000000000014,logo:70000000-0000-0000-0000-000000000014,user:70000000-0000-0000-0000-000000000014",
    "identity",
  );
  assert(
    !JSON.stringify(logs).includes("70000000-0000-0000-0000-000000000014"),
    "user ID logged",
  );
});

Deno.test("invalidates owner work before revocation and never deletes auth after a required stage fails", async () => {
  const { handler, deleted } = make({
    revokePaymentLinks: () =>
      Promise.reject(new Error("provider-private-detail")),
  });
  const response = await handler(
    new Request("https://edge.example", {
      method: "POST",
      headers: { authorization: "Bearer recent-aal2-token" },
      body: "{}",
    }),
  );
  assert(
    response.status === 503,
    "required revocation failure did not block deletion",
  );
  assert(
    deleted[0]?.startsWith("invalidate:") &&
      !deleted.some((item) => item.startsWith("user:")),
    "unsafe deletion ordering",
  );
  assert(
    !(await response.text()).includes("provider-private-detail"),
    "private failure leaked",
  );
});

Deno.test("continues account deletion when best-effort provider unlinking fails", async () => {
  const { handler, deleted } = make({
    disconnectProvider: () => Promise.reject(new Error("provider-offline")),
  });
  const response = await handler(
    new Request("https://edge.example", {
      method: "POST",
      headers: { authorization: "Bearer recent-aal2-token" },
      body: "{}",
    }),
  );
  assert(response.status === 200, "provider outage blocked account deletion");
  assert(
    deleted.some((item) => item.startsWith("user:")),
    "auth user was not deleted",
  );
});

Deno.test("denies a direct request without server-verified recent AAL2 before deletion", async () => {
  const { handler, deleted } = make({
    requireRecentAal2: () => Promise.reject(new Error("aal2-required")),
  });
  const response = await handler(
    new Request("https://edge.example", {
      method: "POST",
      headers: { authorization: "Bearer aal1-or-stale-token" },
      body: "{}",
    }),
  );
  const body = await response.json();
  assert(response.status === 403, "recent AAL2 status");
  assert(body.error === "recent-aal2-required", "recent AAL2 public code");
  assert(deleted.length === 0, "delete ran before recent AAL2");
});

Deno.test("keeps failures content-free and refuses incomplete production configuration", async () => {
  const marker = "PRIVATE_DELETE_FAILURE";
  const { handler } = make({
    deleteLogo: () => Promise.reject(new Error(marker)),
  });
  const response = await handler(
    new Request("https://edge.example", {
      method: "POST",
      headers: { authorization: "Bearer recent-aal2-token" },
      body: "{}",
    }),
  );
  assert(
    response.status === 503 && !(await response.text()).includes(marker),
    "private error",
  );
  let configurationFailed = false;
  try {
    createProductionDeleteAccountHandler({});
  } catch {
    configurationFailed = true;
  }
  assert(configurationFailed, "configuration");
});

Deno.test("production verifies recent AAL2 with the caller token and distinguishes provider failure", async () => {
  const urls: string[] = [];
  const authorizations: string[] = [];
  let rpcStatus = 500;
  const fetcher: typeof fetch = (input, init) => {
    const url = String(input);
    urls.push(url);
    authorizations.push(new Headers(init?.headers).get("authorization") ?? "");
    if (url.endsWith("/auth/v1/user")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: "70000000-0000-0000-0000-000000000014",
          }),
          { status: 200 },
        ),
      );
    }
    if (url.endsWith("/rest/v1/rpc/fieldcraft_require_aal2")) {
      return Promise.resolve(new Response(null, { status: rpcStatus }));
    }
    throw new Error(`unexpected production request: ${url}`);
  };
  const environment = {
    SUPABASE_URL: "https://project-ref.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_public-test-key",
    ["SUPABASE_" + "SERVICE_ROLE_KEY"]: "service-role-test-key",
  };
  const authorization = ["Bear", "er caller-token-at-least-sixteen-characters"]
    .join("");

  let handler = createProductionDeleteAccountHandler(environment, fetcher);
  let response = await handler(
    new Request("https://edge.example", {
      method: "POST",
      headers: { authorization },
      body: "{}",
    }),
  );
  assert(
    response.status === 503,
    "provider failure must not masquerade as step-up",
  );
  assert(
    urls.join(",") ===
      "https://project-ref.supabase.co/auth/v1/user,https://project-ref.supabase.co/rest/v1/rpc/fieldcraft_require_aal2",
    "auth and recent-AAL2 request ordering",
  );
  assert(
    authorizations.every((value) => value === authorization),
    "caller token forwarding",
  );

  urls.length = 0;
  authorizations.length = 0;
  rpcStatus = 403;
  handler = createProductionDeleteAccountHandler(environment, fetcher);
  response = await handler(
    new Request("https://edge.example", {
      method: "POST",
      headers: { authorization },
      body: "{}",
    }),
  );
  assert(response.status === 403, "AAL denial must request step-up");
});

Deno.test("production coordinates required revocation RPCs before storage and auth deletion", async () => {
  const requests: string[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push(`${method}:${new URL(url).pathname}`);
    if (url.endsWith("/auth/v1/user")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: "70000000-0000-0000-0000-000000000014",
          }),
          { status: 200 },
        ),
      );
    }
    if (url.endsWith("/rest/v1/rpc/fieldcraft_require_aal2")) {
      return Promise.resolve(new Response("null", { status: 200 }));
    }
    if (url.includes("/rest/v1/rpc/fieldcraft_")) {
      return Promise.resolve(new Response("null", { status: 200 }));
    }
    if (url.includes("/storage/v1/object/business-logos/")) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }
    if (url.includes("/auth/v1/admin/users/")) {
      return Promise.resolve(new Response(null, { status: 200 }));
    }
    throw new Error(`unexpected request: ${url}`);
  };
  const handler = createProductionDeleteAccountHandler({
    SUPABASE_URL: "https://project-ref.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_public-test-key",
    ["SUPABASE_" + "SERVICE_ROLE_KEY"]: "service-role-test-key",
  }, fetcher);
  const response = await handler(
    new Request("https://edge.example", {
      method: "POST",
      headers: { authorization: "Bearer recent-aal2-token" },
      body: "{}",
    }),
  );
  assert(response.status === 200, "production deletion failed");
  assert(
    requests.join(",") === [
      "GET:/auth/v1/user",
      "POST:/rest/v1/rpc/fieldcraft_require_aal2",
      "POST:/rest/v1/rpc/fieldcraft_invalidate_owner_work",
      "POST:/rest/v1/rpc/fieldcraft_revoke_owner_payment_links",
      "POST:/rest/v1/rpc/fieldcraft_cancel_owner_reminders",
      "DELETE:/storage/v1/object/business-logos/70000000-0000-0000-0000-000000000014/logo.jpg",
      "DELETE:/auth/v1/admin/users/70000000-0000-0000-0000-000000000014",
    ].join(","),
    `production ordering was ${requests.join(",")}`,
  );
});

Deno.test("operational owner digests rotate without exposing owner identity", async () => {
  const secret = "test-observability-secret-at-least-32-bytes";
  const owner = "70000000-0000-4000-8000-000000000014";
  const first = await digestOwnerId(owner, secret, 1);
  const replay = await digestOwnerId(owner, secret, 1);
  const rotated = await digestOwnerId(
    owner,
    "rotated-observability-secret-at-least-32-bytes",
    2,
  );
  assert(
    JSON.stringify(first) === JSON.stringify(replay),
    "digest was unstable",
  );
  assert(
    first.ownerDigest !== rotated.ownerDigest &&
      !JSON.stringify(first).includes(owner),
    "digest did not rotate safely",
  );
  let rejected = false;
  try {
    writeSafeLog({
      requestId: crypto.randomUUID(),
      status: 200,
      publicCode: "ok",
      latencyBucket: "<100ms",
      email: "private@example.test",
    } as SafeLogEntry, () => {});
  } catch {
    rejected = true;
  }
  assert(rejected, "non-allowlisted log field was accepted");
});
