// app/src/components/chart/engine/binder.extendedCtx.test.js
//
// ─── THE CHART'S OWN SESSION REACHES THE COMPUTE (2026-11-26) ───────────────────────────────────────────────────────
//
// StockChart hands `binder.sync` the chart's session (`extended: !!showExtended`), and the server lane reads it from the
// compute's ctx: `serverCompute.serverAskOf(tf, ctx.extended)` (an extended 4h chart's envelope is asked at 30m, not 60m),
// `benchmarkTailFor(..., { extended: ctx.extended })` (the benchmark's forming bar on the chart's own grid) and the
// live-tail signature (`nativeRegistry.computeSignature`). ⚰️ The binder never forwarded it: every compute it asked
// carried no `extended`, so an extended-hours chart's server RS line was asked and tailed on the REGULAR grid.
//   X1 a sync's `computeFor` ctx and `computeSignature` ctx carry the chart's session (true on an extended chart, false
//      on a regular one), and the server lane's ask follows it (extended 240 -> 30m base, regular 240 -> 60m)
//   X2 a row computed AHEAD (`binder.prepare`, neighbor frames) carries the same session
import { describe, it, expect, afterEach } from 'vitest'
import { createBinder } from './binder'
import { createFakeChart, makeBars } from './__tests__/fakeChart'
import * as nativeRegistry from './nativeRegistry'
import { serverAskOf } from './serverCompute'
import { __setNeighborFramesForTests } from '../neighborFrames'

const inst = (defId) => ({ instanceId: `legacy:${defId}`, defId, inputs: {}, hidden: false })
const bars = makeBars(300, 1_700_000_000)

function spyRegistry() {
  const ctxs = []
  const sigs = []
  const reg = {
    ...nativeRegistry,
    computeFor: (def, b, inputs, ctx) => { ctxs.push(ctx); return nativeRegistry.computeFor(def, b, inputs, ctx) },
    computeSignature: (def, inputs, ctx) => { sigs.push(ctx); return nativeRegistry.computeSignature(def, inputs, ctx) },
  }
  return { reg, ctxs, sigs }
}
const ctxFor = (registry, extra = {}) => ({
  enabled: true, registry, instances: [inst('rsi')], bars, sym: 'AAA', tf: '240',
  adjustTime: (t) => t, plan: { fresh: true }, applyData: (s, d) => s && d && s.setData(d),
  resolvePlacement: (i) => ({ paneIndex: 1, scaleId: i.defId }), ...extra,
})

afterEach(() => { __setNeighborFramesForTests(null) })

describe('the chart\'s own session rides every compute the binder asks', () => {
  it.each([[true, '30'], [false, '60']])('X1 extended=%s: the compute and signature ctx carry it, and a 240 server ask is based at %sm', (extended, base) => {
    const { reg, ctxs, sigs } = spyRegistry()
    const fake = createFakeChart()
    createBinder({ chart: fake.chart, LWC: fake.LWC }).sync(ctxFor(reg, { extended }))
    expect(ctxs.length).toBeGreaterThan(0)
    for (const c of ctxs) expect(c.extended).toBe(extended)
    expect(sigs.length).toBeGreaterThan(0)
    for (const c of sigs) expect(c.extended).toBe(extended)
    expect(serverAskOf(ctxs[0].tf, ctxs[0].extended).tf).toBe(base)
  })

  it('X2 a row prepared ahead (neighbor frames) is computed in the chart\'s session', () => {
    __setNeighborFramesForTests(true)
    const { reg, ctxs } = spyRegistry()
    const fake = createFakeChart()
    const b = createBinder({ chart: fake.chart, LWC: fake.LWC })
    b.sync(ctxFor(reg, { extended: true }))
    ctxs.length = 0
    for (const _ of b.prepare({ bars: makeBars(320, 1_690_000_000), sym: 'BBB' })) { /* drain */ }
    expect(ctxs.length).toBeGreaterThan(0)
    for (const c of ctxs) expect(c.extended).toBe(true)
  })
})
