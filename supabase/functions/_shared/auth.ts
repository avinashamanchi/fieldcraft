import { readBoundedBody } from "./body.ts";

export const authenticate = async (
  authorization: string | null,
  configuration: {
    supabaseUrl: string;
    publishableKey: string;
    fetcher?: typeof fetch;
  },
): Promise<{ userId: string; token: string }> => {
  if (!authorization || !/^Bearer [^\s]{16,8192}$/.test(authorization)) {
    throw new Error("unauthorized");
  }
  const response = await (configuration.fetcher ?? fetch)(
    `${configuration.supabaseUrl}/auth/v1/user`,
    {
      headers: {
        Authorization: authorization,
        apikey: configuration.publishableKey,
      },
    },
  );
  if (!response.ok) throw new Error("unauthorized");
  let value: unknown;
  try {
    value = JSON.parse(await readBoundedBody(response, 64 * 1024));
  } catch {
    throw new Error("unauthorized");
  }
  const userId = (value as { id?: unknown })?.id;
  if (typeof userId !== "string" || !/^[0-9a-f-]{36}$/i.test(userId)) {
    throw new Error("unauthorized");
  }
  return { userId, token: authorization.slice(7) };
};
