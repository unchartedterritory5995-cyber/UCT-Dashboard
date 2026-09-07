// app/src/components/chart/engine/__tests__/fillBinding.test.js
//
// ─── ⭐⭐ C1-B: THE FILL'S LIFECYCLE ON A POOLED SERIES ──────────────────────
//
// The geometry is tested in `fillPrimitive.test.js`. This is the other half, and
// it is the half that leaks: a primitive is attached to a SERIES, and this
// engine's series outlive their tenants by design (that is what pooling IS).
//
// ⛔ TWO FAILURES, BOTH SILENT, BOTH TESTED HERE:
//   1. ATTACHING EVERY PASS. `attachPrimitive` has no "already attached" check,
//      so a re-attach per frame stacks one primitive per repaint — and unlike a
//      leaked price line there is no handle anybody counts. The chart simply
//      gets slower and darker.
//   2. NOT DETACHING ON A RE-TENANT. A pooled series keeps what is attached to
//      it, so the PREVIOUS indicator's band goes on painting over the new one's
//      numbers. This is `guideHandles`' problem exactly, one primitive along.
import { describe, it, expect } from 'vitest'
import { createBinder } from '../binder'
import { createFakeChart } from './fakeChart'

const BARS = Array.from({ length: 4 }, (_, i) => ({ t: 1700000000 + i * 60, c: 10 + i }))

const banded = (id) => ({
  id, schemaVersion: 2, label: id, inputs: [],
  plots: [
    { key: 'upper', label: 'Upper', style: 'line', legend: { decimals: 2 },
      fill: { with: 'lower' }, color: '#2962FF' },
    { key: 'lower', label: 'Lower', style: 'line', legend: { decimals: 2 } },
  ],
})

const plain = (id) => ({
  id, schemaVersion: 2, label: id, inputs: [],
  plots: [{ key: 'upper', label: 'Upper', style: 'line', legend: { decimals: 2 } }],
})

const COLUMNS = { upper: [3, 4, 5, 6], lower: [1, 1, 1, 1] }

function harness(defs) {
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const registry = {
    getDefinition: (id) => defs.get(id) || null,
    computeFor: () => COLUMNS,
    hasAnyFinite: (col) => Array.isArray(col) && col.some(Number.isFinite),
    columnKeys: (d) => (d.plots || []).map((p) => p.key),
  }
  const run = (instances) => binder.sync({
    enabled: true,
    instances,
    registry,
    bars: BARS,
    adjustTime: (t) => t,
    plan: { fresh: true },
    applyData: (series, data) => series.setData(data),
    resolvePlacement: () => ({ paneIndex: 1, scaleId: 's', scaleOptions: {} }),
  })
  const count = (m) => fake.calls.filter((c) => c.method === m).length
  return { fake, run, count }
}

const inst = (defId, n = 1) => ({ instanceId: `inst:${defId}:${n}`, defId, inputs: {} })

describe('a fill attaches once and follows its tenant', () => {
  it('⭐ a plot declaring `fill.with` attaches exactly one primitive', () => {
    const defs = new Map([['u_band', banded('u_band')]])
    const { run, count } = harness(defs)
    run([inst('u_band')])
    expect(count('attachPrimitive')).toBe(1)
    expect(count('detachPrimitive')).toBe(0)
  })

  it('⛔⛔ A SECOND PASS REUSES IT — it does not attach again', () => {
    const defs = new Map([['u_band', banded('u_band')]])
    const { run, count } = harness(defs)
    run([inst('u_band')])
    run([inst('u_band')])
    run([inst('u_band')])
    expect(count('attachPrimitive')).toBe(1)
  })

  it('⛔ a plot with NO fill attaches nothing — the mutation control', () => {
    const defs = new Map([['u_plain', plain('u_plain')]])
    const { run, count } = harness(defs)
    run([inst('u_plain')])
    expect(count('attachPrimitive')).toBe(0)
  })

  it('⛔⛔ THE BAND DOES NOT FOLLOW THE SERIES TO ITS NEXT TENANT', () => {
    // The banded indicator leaves; a plain one takes the pooled series. If the
    // primitive stayed attached, the new indicator would be drawn inside the old
    // one's band.
    const defs = new Map([['u_band', banded('u_band')], ['u_plain', plain('u_plain')]])
    const { run, count } = harness(defs)
    run([inst('u_band')])
    expect(count('attachPrimitive')).toBe(1)
    run([inst('u_plain')])
    expect(count('detachPrimitive')).toBe(1)
  })

  it('⛔ a fill naming a column that does not exist attaches nothing', () => {
    // Fail closed: an unresolvable `fill.with` draws no band rather than a band
    // between the plot and whatever happens to be lying around.
    const ghost = {
      ...banded('u_ghost'),
      plots: [{ ...banded('u_ghost').plots[0], fill: { with: 'nowhere' } }, banded('u_ghost').plots[1]],
    }
    const defs = new Map([['u_ghost', ghost]])
    const { run, count } = harness(defs)
    run([inst('u_ghost')])
    expect(count('attachPrimitive')).toBe(0)
  })
})
