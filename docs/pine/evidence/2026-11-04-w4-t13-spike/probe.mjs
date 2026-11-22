// W4-T13 spike probe: can a runtime-document candle row reach LWC's CandlestickSeries?
// Run from repo root: node docs/pine/evidence/2026-11-04-w4-t13-spike/probe.mjs
import { presentedPlot } from '../../../../app/src/components/chart/engine/presentation.js'
import { poolKey } from '../../../../app/src/components/chart/engine/pool.js'

const plot = { key: 'value', style: 'line' }
const inst = { presentation: { plots: { value: { style: 'candles' } } } }
const show = (label, ctx) => {
  const p = presentedPlot(plot, inst, ctx)
  console.log(label, '-> def style', p.style, '-> pool key', poolKey(p))
}
// What a runtime row gets today: capability is derived from a SYMBOL source (binder.js:1941-1950);
// a runtime row declares no symbol source, so ohlcCapable is false.
show('member asks candles, ohlcCapable=false (runtime row today)', { ohlcCapable: false })
show('member asks candles, ohlcCapable=true  (symbol passthrough)', { ohlcCapable: true })
// The author-vocabulary route: a row DECLARED style candles
const declared = { key: 'value', style: 'candles' }
console.log('declared style candles, no instance override ->', poolKey(presentedPlot(declared, {}, { ohlcCapable: false })))
