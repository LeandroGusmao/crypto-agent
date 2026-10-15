import { parseUtcTimestamp } from './time.ts';

export function invalid(kind: string, detail: string): Error {
  return new Error(`Invalid ${kind}: ${detail}`);
}

export function requireText(kind: string, field: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid(kind, `${field} must be a non-empty string`);
  }
  return value;
}

// Returns the canonical form of a nonnegative integer unit string.
export function requireUnits(
  kind: string,
  field: string,
  value: unknown,
  { positive }: { positive: boolean },
): string {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw invalid(kind, `${field} must be an integer unit string`);
  }
  const units = BigInt(value);
  if (positive && units === 0n) throw invalid(kind, `${field} must be positive`);
  return units.toString();
}

export function requireOneOf<T extends string>(
  kind: string,
  field: string,
  value: unknown,
  allowed: readonly T[],
): T {
  if (!allowed.includes(value as T)) {
    throw invalid(kind, `${field} must be one of ${allowed.map((a) => `"${a}"`).join(', ')}`);
  }
  return value as T;
}

export function requireSide(kind: string, value: unknown): 'buy' | 'sell' {
  if (value !== 'buy' && value !== 'sell') throw invalid(kind, 'side must be "buy" or "sell"');
  return value;
}

// Returns the timestamp in canonical ISO form so equal instants compare and hash identically.
export function requireUtcTimestamp(kind: string, field: string, value: unknown): string {
  const ms = parseUtcTimestamp(value);
  if (ms === null) throw invalid(kind, `${field} must be an ISO 8601 UTC timestamp`);
  return new Date(ms).toISOString();
}
