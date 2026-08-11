const ALLOWED_FIELDS = new Set([
  "requestId",
  "status",
  "publicCode",
  "outcome",
  "latencyBucket",
  "route",
  "deployment",
  "provider",
  "environment",
  "ownerDigest",
  "reason",
]);

export type SafeLogEntry = Readonly<{
  requestId: string;
  status: number;
  publicCode: string;
  outcome?: "applied" | "duplicate" | "stale";
  latencyBucket: "<100ms" | "<1s" | "<10s" | ">=10s";
  route?: string;
  deployment?: string;
  provider?: string;
  environment?: string;
  ownerDigest?: string;
  reason?: string;
}>;

const SAFE_LABEL = /^[A-Za-z0-9._:-]{1,80}$/;
const encoder = new TextEncoder();

export const digestOwnerId = async (
  ownerId: string,
  secret: string,
  keyVersion: number,
): Promise<{ ownerDigest: string; digestKeyVersion: number }> => {
  if (
    !/^[0-9a-f-]{36}$/i.test(ownerId) || secret.length < 32 ||
    !Number.isSafeInteger(keyVersion) || keyVersion < 1 ||
    keyVersion > 1_000_000
  ) throw new Error("observability digest configuration is invalid");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(ownerId)),
  );
  return {
    ownerDigest: Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
    digestKeyVersion: keyVersion,
  };
};

export const writeSafeLog = (
  entry: SafeLogEntry,
  writer: (line: string) => void = console.info,
): void => {
  const values = Object.entries(entry);
  if (values.some(([key]) => !ALLOWED_FIELDS.has(key))) {
    throw new Error("observability field is not allowlisted");
  }
  const labels = [
    entry.route,
    entry.deployment,
    entry.provider,
    entry.environment,
    entry.reason,
  ].filter((value): value is string => value !== undefined);
  if (
    !/^[0-9a-f-]{36}$/i.test(entry.requestId) ||
    !Number.isInteger(entry.status) || entry.status < 100 ||
    entry.status > 599 ||
    !/^[a-z0-9-]{1,40}$/.test(entry.publicCode) ||
    labels.some((value) => !SAFE_LABEL.test(value)) ||
    (entry.ownerDigest !== undefined &&
      !/^[0-9a-f]{64}$/.test(entry.ownerDigest))
  ) throw new Error("observability value is invalid");
  writer(JSON.stringify(entry));
};
