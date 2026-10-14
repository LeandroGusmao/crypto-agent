const MAX_DECIMALS = 18;

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw new Error('Invalid amount');
  }
}

// Converts a nonnegative decimal string into exact integer units.
export function parseUnits(value: string, decimals: number): bigint {
  assertDecimals(decimals);
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error('Invalid amount');
  }
  const [whole = '', fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error('Invalid amount');
  return BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, '0') || '0');
}

// Renders integer units as a decimal string; negative values are allowed for losses.
export function formatUnits(value: bigint, decimals: number): string {
  assertDecimals(decimals);
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = absolute / base;
  const fraction = (absolute % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}
