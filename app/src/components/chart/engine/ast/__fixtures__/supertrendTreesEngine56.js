// app/src/components/chart/engine/ast/__fixtures__/supertrendTreesEngine56.js
//
// TEST FIXTURE: `ta.supertrend`'s expansion as engine 56 wrote it, copied VERBATIM from
// `git show 839617cdb2:app/src/components/chart/engine/ast/callExpansions.js` (origin/master at the
// engine-57 takeover merge): `supertrendTrees` and the helpers it reads, renamed only. Engine 57
// replaced the tree. `savedDocumentRoundTrip.test.js` rebuilds a saved script with this
// expansion (and `ta.stoch` on the house `stoch`) to prove engine 57's move is the one claimed.
// Never imported by product code.

const SUPERTREND_WARMUP = 200
const ACCUM_SELF = 'self'

const cNum = (value) => (value < 0
  ? { type: 'op', name: 'u-', args: [{ type: 'num', value: -value }] }
  : { type: 'num', value })
const cSeries = (name) => ({ type: 'series', name })
const cOp = (name, args) => ({ type: 'op', name, args })
const cCall = (name, args) => ({ type: 'call', name, args })

/** A whole-number literal window >= `min`, or NaN. */
function windowOf(node, min) {
  const n = node && node.type === 'num' ? Number(node.value) : NaN
  return Number.isFinite(n) && Number.isInteger(n) && n >= min ? n : NaN
}

function factorOf(node) {
  const f = node && node.type === 'num' ? Number(node.value) : NaN
  return Number.isFinite(f) && f > 0 ? f : NaN
}

export function supertrendTreesEngine56(factorNode, periodNode, warmup = SUPERTREND_WARMUP) {
  const f = factorOf(factorNode)
  const n = windowOf(periodNode, 1)
  if (!Number.isFinite(f) || !Number.isFinite(n)) return null
  const self = cSeries(ACCUM_SELF)
  const close = cSeries('close')
  const prevClose = { type: 'offset', value: 1, args: [close] }
  const hl2 = cOp('/', [cOp('+', [cSeries('high'), cSeries('low')]), cNum(2)])
  const atr = cCall('atrPine', [cSeries('high'), cSeries('low'), close, cNum(n)])
  const band = (sign) => cOp(sign, [hl2, cOp('*', [cNum(f), atr])])
  const up = band('+')
  const dn = band('-')
  const W = cNum(warmup)
  const upper = cCall('accum', [up, cOp('?:', [
    cOp('||', [cOp('<', [up, self]), cOp('>', [prevClose, self])]), up, self]), W])
  const lower = cCall('accum', [dn, cOp('?:', [
    cOp('||', [cOp('>', [dn, self]), cOp('<', [prevClose, self])]), dn, self]), W])
  const one = cNum(1)
  const minusOne = cNum(-1)
  const direction = cCall('accum', [one, cOp('?:', [
    cOp('==', [self, one]),
    cOp('?:', [cOp('>', [close, upper]), minusOne, one]),
    cOp('?:', [cOp('<', [close, lower]), one, minusOne]),
  ]), W])
  const unknown = cOp('||', [
    cCall('na', [{ type: 'offset', value: warmup, args: [upper] }]),
    cCall('na', [{ type: 'offset', value: warmup, args: [lower] }]),
  ])
  const na = cOp('/', [cNum(0), cNum(0)])
  return {
    value: cOp('?:', [unknown, na, cOp('?:', [cOp('==', [direction, minusOne]), lower, upper])]),
    direction: cOp('?:', [unknown, na, direction]),
  }
}
