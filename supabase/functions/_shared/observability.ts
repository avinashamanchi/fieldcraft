const ALLOWED_FIELDS = new Set([
  "requestId",
  "status",
  "publicCode",
  "outcome",
  "latencyBucket",
]);

export type SafeLogEntry = Readonly<{
  requestId: string;
  status: number;
  publicCode: string;
  outcome?: "applied" | "duplicate" | "stale";
  latencyBucket: "<100ms" | "<1s" | "<10s" | ">=10s";
}>;

export const writeSafeLog = (
  entry: SafeLogEntry,
  writer: (line: string) => void = console.info,
): void => {
  const values = Object.entries(entry);
  if (values.some(([key]) => !ALLOWED_FIELDS.has(key))) {
    throw new Error("observability field is not allowlisted");
  }
  if (
    !/^[0-9a-f-]{36}$/i.test(entry.requestId) ||
    !Number.isInteger(entry.status) || entry.status < 100 ||
    entry.status > 599 ||
    !/^[a-z0-9-]{1,40}$/.test(entry.publicCode)
  ) throw new Error("observability value is invalid");
  writer(JSON.stringify(entry));
};
