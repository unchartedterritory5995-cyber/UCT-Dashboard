// app/src/components/chart/engine/runtime/__fixtures__/rsRatingSynthetic.js
//
// RS Rating (Fred6724, MPL-2.0, tradingview.com/script/pziQwiT2) -- its rating math over
// SYNTHETIC bars, and the same math by hand. Shared by the L4b rail (the history offsets,
// `l4bDynamicOffsetBound.test.js`) and the L4c rail (the rating labels drawn in a `?:` arm,
// `l4cArmDrawing.test.js`), so the two grade one script against one hand computation.
// `request.security` is lane L5: the two closes and the seed are variables the run holds,
// which is what an other-symbol request's value is.

export const N = 300
export const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + 10 * Math.sin(i / 7) + i * 0.05 + (i % 5) * 0.3
  return { t: 1700000000 + i * 86400, o: c - 0.5 + (i % 3) * 0.4, h: c + 1, l: c - 1, c, v: 1000 + (i % 13) * 10 }
})
export const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
export const C = BARS.map((b) => b.c)
export const O = BARS.map((b) => b.o)

/** The script's rating math, `n63 = ...` through the `-1` check (no plots). */
export const RS_RATING_MATH = Object.freeze([
  'n63      = bar_index < 63  ? bar_index:63',
  'n126     = bar_index < 126 ? bar_index:126',
  'n189     = bar_index < 189 ? bar_index:189',
  'n252     = bar_index < 252 ? bar_index:252',
  'var float closeDa = na',
  'closeDa := close',
  'var float spxCloseDa = na',
  'spxCloseDa := open * 0.5 + 60',
  'perfTicker63   = closeDa/closeDa[n63]',
  'perfTicker126  = closeDa/closeDa[n126]',
  'perfTicker189  = closeDa/closeDa[n189]',
  'perfTicker252  = closeDa/closeDa[n252]',
  'perfComp63     = spxCloseDa/spxCloseDa[n63]',
  'perfComp126    = spxCloseDa/spxCloseDa[n126]',
  'perfComp189    = spxCloseDa/spxCloseDa[n189]',
  'perfComp252    = spxCloseDa/spxCloseDa[n252]',
  'float rs_stock = 0.4*perfTicker63 + 0.2*perfTicker126 + 0.2*perfTicker189 + 0.2*perfTicker252',
  'float rs_ref   = 0.4*perfComp63   + 0.2*perfComp126   + 0.2*perfComp189   + 0.2*perfComp252',
  'float totalRsScore  = (rs_stock) / (rs_ref) * 100',
  'float totalRsRating = -1',
  'lvl = math.floor(bar_index / 5) % 7',
  'var float curveRsPerf = na',
  'curveRsPerf := lvl == 0 ? 112 : lvl == 1 ? 106 : lvl == 2 ? 103 : lvl == 3 ? 100 : lvl == 4 ? 97 : lvl == 5 ? 94 : 90',
  'delta  = ta.barssince(bar_index % 10 == 0)',
  'var float[] different_values = array.new_float(7)',
  'var int counter = 0',
  'float first = 0', 'float scnd  = 0', 'float thrd  = 0', 'float frth  = 0',
  'float ffth  = 0', 'float sxth  = 0', 'float svth  = 0',
  'for i = delta to 34+delta',
  '    close_value = nz(curveRsPerf[i])',
  '    if (not array.includes(different_values, close_value) and counter < 7 and close_value!=0)',
  '        array.set(different_values, counter, close_value)',
  '        counter := counter + 1',
  'first := array.get(different_values, 0)',
  'scnd  := array.get(different_values, 1)',
  'thrd  := array.get(different_values, 2)',
  'frth  := array.get(different_values, 3)',
  'ffth  := array.get(different_values, 4)',
  'sxth  := array.get(different_values, 5)',
  'svth  := array.get(different_values, 6)',
  'if(totalRsScore >= first)',
  '    totalRsRating := 99',
  'if(totalRsScore <= svth)',
  '    totalRsRating := 1',
  'f_attributePercentile(totalRsScore, tallerPerf, smallerPerf, rangeUp, rangeDn, weight) =>',
  '    sum = totalRsScore + (totalRsScore-smallerPerf)*weight',
  '    if(sum > tallerPerf - 1)',
  '        sum := tallerPerf - 1',
  '    k1 = smallerPerf/rangeDn',
  '    k2 = (tallerPerf-1)/rangeUp',
  '    k3 = (k1-k2)/(tallerPerf-1-smallerPerf)',
  '    RsRating = sum/(k1-k3*(totalRsScore-smallerPerf))',
  '    if (RsRating > rangeUp)',
  '        RsRating := rangeUp',
  '    if (RsRating < rangeDn)',
  '        RsRating := rangeDn',
  '    RsRating',
  'if (totalRsScore < first and totalRsScore >= scnd)',
  '    totalRsRating := f_attributePercentile(totalRsScore, first, scnd, 98, 90, 0.33)',
  'if (totalRsScore < scnd and totalRsScore >= thrd)',
  '    totalRsRating := f_attributePercentile(totalRsScore, scnd, thrd, 89, 70, 2.1)',
  'if (totalRsScore < thrd and totalRsScore >= frth)',
  '    totalRsRating := f_attributePercentile(totalRsScore, thrd, frth, 69, 50, 0)',
  'if (totalRsScore < frth and totalRsScore >= ffth)',
  '    totalRsRating := f_attributePercentile(totalRsScore, frth, ffth, 49, 30, 0)',
  'if (totalRsScore < ffth and totalRsScore >= sxth)',
  '    totalRsRating := f_attributePercentile(totalRsScore, ffth, sxth, 29, 10, 0)',
  'if (totalRsScore < sxth and totalRsScore >= svth)',
  '    totalRsRating := f_attributePercentile(totalRsScore, sxth, svth, 9, 2, 0)',
  'for i = 0 to 6',
  '    if (nz(array.get(different_values, i)) == 0)',
  '        totalRsRating := -1',
])

/** The script, by hand: Pine's semantics bar by bar (comparisons with `na` are false). */
export function rsByHand() {
  const SPX = O.map((o) => o * 0.5 + 60)
  const LEVELS = [112, 106, 103, 100, 97, 94, 90]
  const seed = Array.from({ length: N }, (_, b) => LEVELS[Math.floor(b / 5) % 7])
  const perf = (a, b, n) => a[b] / a[b - Math.min(b, n)]
  const values = new Array(7).fill(NaN)
  let counter = 0
  const ge = (a, b) => !Number.isNaN(a) && !Number.isNaN(b) && a >= b
  const lt = (a, b) => !Number.isNaN(a) && !Number.isNaN(b) && a < b
  const pct = (s, taller, smaller, up, dn, w) => {
    let sum = s + (s - smaller) * w
    if (sum > taller - 1) sum = taller - 1
    const k1 = smaller / dn
    const k2 = (taller - 1) / up
    const k3 = (k1 - k2) / (taller - 1 - smaller)
    let r = sum / (k1 - k3 * (s - smaller))
    if (r > up) r = up
    if (r < dn) r = dn
    return r
  }
  const rating = []
  const score = []
  for (let b = 0; b < N; b += 1) {
    const rsS = 0.4 * perf(C, b, 63) + 0.2 * perf(C, b, 126) + 0.2 * perf(C, b, 189) + 0.2 * perf(C, b, 252)
    const rsR = 0.4 * perf(SPX, b, 63) + 0.2 * perf(SPX, b, 126) + 0.2 * perf(SPX, b, 189) + 0.2 * perf(SPX, b, 252)
    const s = rsS / rsR * 100
    const delta = b % 10
    for (let i = delta; i <= 34 + delta; i += 1) {
      const v = b - i >= 0 ? seed[b - i] : 0
      if (!values.includes(v) && counter < 7 && v !== 0) { values[counter] = v; counter += 1 }
    }
    const [first, scnd, thrd, frth, ffth, sxth, svth] = values
    let r = -1
    if (ge(s, first)) r = 99
    if (ge(svth, s)) r = 1
    if (lt(s, first) && ge(s, scnd)) r = pct(s, first, scnd, 98, 90, 0.33)
    if (lt(s, scnd) && ge(s, thrd)) r = pct(s, scnd, thrd, 89, 70, 2.1)
    if (lt(s, thrd) && ge(s, frth)) r = pct(s, thrd, frth, 69, 50, 0)
    if (lt(s, frth) && ge(s, ffth)) r = pct(s, frth, ffth, 49, 30, 0)
    if (lt(s, ffth) && ge(s, sxth)) r = pct(s, ffth, sxth, 29, 10, 0)
    if (lt(s, sxth) && ge(s, svth)) r = pct(s, sxth, svth, 9, 2, 0)
    if (values.some((v) => Number.isNaN(v) || v === 0)) r = -1
    rating.push(r)
    score.push(s)
  }
  return { rating, score, values }
}
