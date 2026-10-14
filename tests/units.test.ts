import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnits, formatUnits } from '../src/core/units.ts';

test('preserves amounts above the safe integer range', () => {
  const amount = parseUnits('9007199254740993.123456', 6);
  assert.equal(amount, 9007199254740993123456n);
  assert.equal(formatUnits(amount, 6), '9007199254740993.123456');
});

test('rejects exponent notation, negative inputs, and excess precision', () => {
  for (const value of ['1e6', '-1', '1.0000001', 'NaN', '', 'Infinity']) {
    assert.throws(() => parseUnits(value, 6), /Invalid amount/);
  }
});

test('converts whole and fractional amounts to integer units', () => {
  assert.equal(parseUnits('1000', 6), 1000000000n);
  assert.equal(parseUnits('0.000001', 6), 1n);
  assert.equal(parseUnits('1.5', 9), 1500000000n);
  assert.equal(parseUnits('42', 0), 42n);
});

test('formats units without trailing fractional zeroes', () => {
  assert.equal(formatUnits(1000000000n, 6), '1000');
  assert.equal(formatUnits(1500000n, 6), '1.5');
  assert.equal(formatUnits(1n, 6), '0.000001');
  assert.equal(formatUnits(0n, 6), '0');
});

test('formats negative units for realized losses', () => {
  assert.equal(formatUnits(-1800000n, 6), '-1.8');
  assert.equal(formatUnits(-1n, 6), '-0.000001');
});

test('rejects unsupported decimal counts', () => {
  for (const decimals of [-1, 19, 1.5]) {
    assert.throws(() => parseUnits('1', decimals), /Invalid amount/);
    assert.throws(() => formatUnits(1n, decimals), /Invalid amount/);
  }
});
