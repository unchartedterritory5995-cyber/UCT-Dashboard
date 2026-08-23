// app/src/constants/quoteRotation.js — the day → index walk behind Quote of the Day.
//
// Pure arithmetic, deliberately free of the library import so plain Node can
// load it (tests/test_quote_of_the_day.py runs it to prove the Python mirror in
// api/services/quote_of_the_day.py picks the same index). Keep the two in step.

// Nominal stride (prime). Consecutive days land ~STRIDE entries apart, so the
// rotation reads as shuffled rather than walking the file top to bottom.
export const STRIDE = 131

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b))

// Calendar-day ordinal of the viewer's LOCAL date (days since 1970-01-01), so
// the quote flips at local midnight and every surface in one timezone agrees.
export function dayOrdinal(date = new Date()) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000)
}

// Largest stride ≤ STRIDE that is coprime with the pool size — a full cycle by
// construction: every entry surfaces exactly once before any repeats, whatever
// the pool size. (The legacy (YYYYMMDD × 97) % N seed was not a cycle: it
// reached 141 of 392 entries across a year of weekdays.)
export function strideFor(n) {
  let s = STRIDE
  while (n > 1 && gcd(s, n) !== 1) s -= 1
  return Math.max(s, 1)
}

export function pickIndex(ordinal, n) {
  if (!n) return -1
  const s = strideFor(n)
  return (((ordinal * s) % n) + n) % n
}
