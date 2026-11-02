// agent-qa — SENTINEL DETECTION that cannot collide with timings, ids or hex (test-only: lives under __fixtures__ so reachable.test.js treats it as test infra; browser twin of
// tests/test_uct_agent_qa_sentinels.py).
//
// ⚰️ Measured on master f1342137b1 (gate run 41372562071): modelIsolation.test.jsx matched `13579` as a plain
// SUBSTRING of a JSON blob, while trace.js holds `t0: performance.now()`, e.g. 213579.83. A timing reported a leak.
//   * numeric sentinels are long NON-INTEGERS: no integer timing, count or id can equal one;
//   * a numeric sentinel matches only as an EXACT number value, or as a WHOLE TOKEN inside a string;
//   * a string sentinel carries letters (substring match: it is the member-visible label).
export const SENT_NUM = '987.654321'
export const SENT_INT = '13579.2468'
export const SENT_STR = 'ISO-SENTINEL-7y3'
export const SENTINELS = [SENT_NUM, SENT_INT, SENT_STR]

const NUMERIC = /^-?\d+(\.\d+)?$/
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const token = (s) => new RegExp(`(?<![0-9A-Za-z_.])${esc(s)}(?![0-9A-Za-z_]|\\.\\d)`)

function walk(v, nums, strs) {
  if (v == null || typeof v === 'boolean') return
  if (typeof v === 'number') { nums.push(v); return }
  if (typeof v === 'string') { strs.push(v); return }
  if (Array.isArray(v)) { v.forEach(x => walk(x, nums, strs)); return }
  if (typeof v === 'object') { for (const [k, x] of Object.entries(v)) { strs.push(k); walk(x, nums, strs) } return }
  strs.push(String(v))
}

/** The sentinels present in `obj` (any JSON-able value, or a string such as a request body). */
export function leaksOf(obj, sentinels = SENTINELS) {
  let plain
  try { plain = JSON.parse(JSON.stringify(obj ?? null)) } catch { plain = String(obj) }
  const nums = []; const strs = []
  walk(plain, nums, strs)
  return sentinels.filter(s => (NUMERIC.test(s)
    ? nums.some(n => n === Number(s)) || strs.some(t => token(s).test(t))
    : strs.some(t => t.includes(s))))
}
