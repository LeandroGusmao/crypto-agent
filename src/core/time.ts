const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

// Parses an ISO 8601 UTC timestamp ("Z" suffix) into epoch milliseconds, or null if invalid.
export function parseUtcTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !UTC_TIMESTAMP.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  // Date.parse rolls impossible dates such as February 30 forward; reject them instead.
  if (new Date(ms).toISOString().slice(0, 19) !== value.slice(0, 19)) return null;
  return ms;
}
