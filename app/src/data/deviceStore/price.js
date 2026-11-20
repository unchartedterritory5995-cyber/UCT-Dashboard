// app/src/data/deviceStore/price.js — the server's price grain, mirrored bit for bit (2026-11-20).
//
// The server stores every bar price as `round(float(value), PRICE_DP)` with PRICE_DP = 4
// (api/services/bars_fetch.py::_px, at every site that writes a bar). The universe minute frames carry the
// vendor's price as received, so a device copy built from them held 5.565822 where /api/bars answers 5.5658
// (measured 2026-11-20: 6 of 2,530 stream minutes, every one exactly this). Mirroring the rounding makes a
// device-painted bar bit-identical to the server's.
//
// ⛔ PYTHON'S float round, NOT Math.round(x * 1e4) / 1e4 AND NOT toFixed. CPython's round(x, n) rounds the
// EXACT binary value of x to n decimals, ties to EVEN, then reads that decimal back as the nearest double:
//   • `x * 1e4` is itself rounded, so near a half it can land on the wrong side;
//   • Math.round and toFixed break an exact tie UPWARD, Python to the even neighbour. Exact ties at 4 places
//     are the doubles with fractional part j/32, j odd (0.03125, 1.15625, ...): round(0.03125, 4) == 0.0312.
// The common case (far from a half) is decided by the float product; only a product within the product's own
// rounding error of a half takes the exact path (BigInt, the double's mantissa times 10^4). The reading back
// is `n / 10^4`: both are exact doubles and IEEE division is correctly rounded, which is Python's strtod.
//
// The fixture __fixtures__/server_price.json is generated FROM bars_fetch._px itself and is pinned on both
// sides: tests/test_device_store_server_price.py (the server still rounds that way, PRICE_DP unchanged) and
// price.test.js (this mirror answers every case bit for bit).

/** Decimals the server keeps on a bar price: api/services/bars_fetch.py PRICE_DP (pinned by the Python rail). */
export const PRICE_DP = 4
const SCALE = 10 ** PRICE_DP
const SCALE_N = BigInt(SCALE)
const TWO52 = 2 ** 52
const _dv = new DataView(new ArrayBuffer(8))

/** round-half-even(ax * 10^PRICE_DP) over the EXACT value of a positive finite double, as a BigInt. */
function exactScaled(ax) {
  _dv.setFloat64(0, ax)
  const hi = _dv.getUint32(0)
  const lo = _dv.getUint32(4)
  const ex = (hi >>> 20) & 0x7ff
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo)
  let e
  if (ex === 0) e = -1074
  else { m |= 1n << 52n; e = ex - 1075 }
  const X = m * SCALE_N                       // ax * 10^DP == X * 2^e, exactly
  if (e >= 0) return X << BigInt(e)
  const sh = BigInt(-e)
  const q = X >> sh
  const r = X - (q << sh)
  const half = 1n << (sh - 1n)
  return r > half || (r === half && (q & 1n) === 1n) ? q + 1n : q
}

/** A price exactly as the server stores it: Python's round(float(x), PRICE_DP). Non-numbers, NaN, ±Infinity
 *  and ±0 come back unchanged, as round() returns them. */
export function serverPrice(x) {
  if (typeof x !== 'number' || !Number.isFinite(x) || x === 0) return x
  const ax = Math.abs(x)
  if (ax >= TWO52) return x                   // no fractional bits: round() returns it as it is
  const y = ax * SCALE
  let v
  if (y < TWO52) {
    const f = Math.floor(y)
    const d = y - f                           // exact for y < 2^52
    // |y - ax*10^DP| <= ulp(y)/2 <= y * 2^-53: outside that window of a half, y and the exact product round
    // to the same integer. The window is taken 4x wider than the bound.
    const n = Math.abs(d - 0.5) > y * 2 ** -51 ? (d < 0.5 ? f : f + 1) : Number(exactScaled(ax))
    v = n / SCALE
  } else {
    v = Number(`${exactScaled(ax)}e-${PRICE_DP}`)   // past 2^52 / 10^DP: a string the engine reads correctly rounded
  }
  return x < 0 ? -v : v
}
