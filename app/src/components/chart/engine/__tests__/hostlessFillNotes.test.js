// app/src/components/chart/engine/__tests__/hostlessFillNotes.test.js
//
// ─── ⭐⭐ THE BINDER SAYS SO WHEN A FILL HAS NO VISIBLE HOST ────────────────
//
// `binder.sync()` returns `{ok, bound, released}`. A fill is drawn by attaching a
// primitive to a SERIES, and a series exists only for a VISIBLE plot — `isFillHost`
// is the first visible binding of an instance (`binder.js`, the hosted-fill pass).
// So a definition that declares fills and has NO visible plot produces no binding
// at all, the hosted-fill loop never runs for it, and every band it declares is
// dropped **in silence**. `{ok: true, bound: 0, released: 0}` is what the caller
// sees, and that is indistinguishable from a definition that asked for nothing.
//
// ⛔ SILENCE IS A DEFECT. The channel is additive — `notes` — and every existing
// case must keep returning `[]`, asserted as a SET rather than a length so a case
// that starts emitting the wrong note cannot pass by emitting the right number of
// them.
//
// ⭐ WHY THIS IS REACHABLE AT ALL: `memberPaneDefinition` refuses an all-hidden
// document, so the MEMBER pane path cannot produce one. The BUILDER path can —
// it hands the binder whatever definition it holds — which is why the fixture
// below is built directly rather than through the pane door.
//
// ⚰️ AND THE NOTE'S SHAPE IS READ FROM THE DOCUMENT, NOT FROM THE RULING. The
// ruling drafted `{line, code, message}`. A definition's `plots[]` entry carries
// `{key, label, style, color, width, role, legend, hidden, fill}` and **no line** —
// the binder is handed a DEFINITION, not source text, so a `line` field could only
// ever be null or invented. The fill is identified here the way this document
// identifies it: by the plot `key` and its `fill.with`. Guessing a field name is
// the defect this programme has already paid for twice (`definition.fills`,
// `outputs[].compute`).
import { describe, it, expect } from 'vitest'
import { createBinder } from '../binder'
import { createFakeChart } from './fakeChart'

const BARS = Array.from({ length: 4 }, (_, i) => ({ t: 1700000000 + i * 60, c: 10 + i }))
const COLUMNS = { upper: [3, 4, 5, 6], lower: [1, 1, 1, 1], mid: [2, 2, 2, 2] }

/** Fills, and a VISIBLE plot to host them — the ordinary case. */
const hosted = (id) => ({
  id, schemaVersion: 2, label: id, inputs: [],
  plots: [
    { key: 'mid', label: 'Mid', style: 'line', legend: { decimals: 2 } },
    { key: 'upper', label: 'Upper', style: 'line', hidden: true, fill: { with: 'lower' } },
    { key: 'lower', label: 'Lower', style: 'line', hidden: true },
  ],
})

/** ⭐ THE FIXTURE: fills, and NOT ONE visible plot. */
const hostless = (id) => ({
  id, schemaVersion: 2, label: id, inputs: [],
  plots: [
    { key: 'upper', label: 'Upper', style: 'line', hidden: true, fill: { with: 'lower' } },
    { key: 'lower', label: 'Lower', style: 'line', hidden: true, fill: { with: 'mid' } },
    { key: 'mid', label: 'Mid', style: 'line', hidden: true },
  ],
})

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
  return { fake, run }
}
const inst = (defId, n = 1) => ({ instanceId: `inst:${defId}:${n}`, defId, inputs: {} })

describe('a fill with no visible host is REPORTED, not dropped in silence', () => {
  it('⛔⛔ NON-VACUITY — the fixture really declares fills and really has no visible plot', () => {
    // Without this the whole file could pass against a definition that simply has
    // nothing to say, which is the state it is meant to distinguish from.
    const d = hostless('u_hostless')
    const fills = d.plots.filter((p) => p.fill && typeof p.fill.with === 'string')
    expect(fills.length, 'the fixture declares no fills — nothing to report').toBe(2)
    expect(d.plots.some((p) => p.hidden !== true),
      'the fixture has a visible plot — it is not the hostless case').toBe(false)
  })

  it('⛔⛔ THE HOSTLESS CASE RETURNS A NOTE PER FILL, WITH ITS REASON', () => {
    const { run } = harness(new Map([['u_hostless', hostless('u_hostless')]]))
    const r = run([inst('u_hostless')])
    expect(r.ok).toBe(true)
    expect(Array.isArray(r.notes), 'sync returns no `notes` channel at all').toBe(true)
    expect(r.notes.length, 'one note per fill the pane cannot draw').toBe(2)
    for (const n of r.notes) {
      expect(n.code).toBe('binder:no-visible-host')
      expect(n.message).toBe('no visible host in this pane')
    }
    // ⭐ AND THE NOTES NAME WHICH BANDS, as a SET. A count alone is satisfied by
    // two notes about one fill.
    expect(new Set(r.notes.map((n) => `${n.key}->${n.with}`)))
      .toEqual(new Set(['upper->lower', 'lower->mid']))
  })

  it('⛔ CONTROL — the HOSTED case returns notes = [] (a set, never a length)', () => {
    const { run } = harness(new Map([['u_hosted', hosted('u_hosted')]]))
    const r = run([inst('u_hosted')])
    expect(r.ok).toBe(true)
    expect(r.notes, 'a drawable fill must not be reported as undrawable').toEqual([])
  })

  it('⛔ CONTROL — a definition with NO fills returns notes = []', () => {
    const plain = { id: 'u_plain', schemaVersion: 2, label: 'p', inputs: [],
      plots: [{ key: 'mid', label: 'Mid', style: 'line', legend: { decimals: 2 } }] }
    const { run } = harness(new Map([['u_plain', plain]]))
    expect(run([inst('u_plain')]).notes).toEqual([])
  })

  it('⛔⛔ CONTROL — {ok, bound, released} are BYTE-IDENTICAL either way', () => {
    // The channel is ADDITIVE. If adding it moved a count, it changed behaviour
    // rather than reporting it — and the hostless case must still bind nothing.
    const { run: runHosted } = harness(new Map([['u_hosted', hosted('u_hosted')]]))
    const h = runHosted([inst('u_hosted')])
    expect({ ok: h.ok, bound: h.bound, released: h.released })
      .toEqual({ ok: true, bound: 1, released: 0 })

    const { run: runHostless } = harness(new Map([['u_hostless', hostless('u_hostless')]]))
    const n = runHostless([inst('u_hostless')])
    expect({ ok: n.ok, bound: n.bound, released: n.released })
      .toEqual({ ok: true, bound: 0, released: 0 })
  })

  it('⛔ a disabled sync still answers the same shape', () => {
    // The early returns carry `{ok:false, bound:0, released:0}`; a consumer that
    // reads `.notes` must not get `undefined` on the path that runs when the
    // engine is off.
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    const r = binder.sync({ enabled: false, instances: [], registry: null, bars: BARS })
    expect(Array.isArray(r.notes), 'the disabled path has no notes channel').toBe(true)
    expect(r.notes).toEqual([])
  })
})
