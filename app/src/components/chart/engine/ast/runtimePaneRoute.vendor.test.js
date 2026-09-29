// app/src/components/chart/engine/ast/runtimePaneRoute.vendor.test.js
//
// ─── ⭐⭐ WHAT THE COLUMNAR LANE CANNOT REPRESENT ROUTES TO THE RUNTIME LANE ──
//
// Owner principle (PR #241, 2026-09-28): our chart draws exactly what TradingView
// draws for the same script at its defaults; a script TradingView draws is never
// refused and never drawn wrong; what the columnar lane cannot represent routes to
// the per-bar runtime lane.
//
// The case is the RDDT 1D capture of `inside-bar-range-mother-candle-…`, whose two
// latches each read the other before setting their own. The columnar lane refuses
// it by name (`pine:state`, `route: 'runtime'` — `insideBarVarReadOrder.vendor
// .test.js`); this file drives the MEMBER DOOR end to end:
//
//   memberPaneDefinition → installUserDefinitions → computeFor
//
// exactly as `MemberPane.jsx` and the binder do, and holds the columns the chart
// would draw against the vendor's, bar for bar.
//
// ⛔ THE ROUTE IS GATED (`VITE_PINE_RUNTIME_PANE_ENABLED`, OFF by default, unset
// in production). Off, the door answers exactly the refusal it always did — the
// first deploy carrying this changes nothing a member sees. Both states are
// driven here.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition.js'
import * as registry from '../nativeRegistry.js'
import { runtimeRouteOf } from './paneGate.js'
import { translatePine } from './pine.js'

const REPO = path.resolve(process.cwd(), '..')
const CAPTURE = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness',
  'inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat-rddt-1d-2026-09-28.json')
const cap = JSON.parse(fs.readFileSync(CAPTURE, 'utf8'))
const SOURCE = cap.source.text
const bars = cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const vendorCol = (id) => {
  const k = cap.plotValues.fields.indexOf(id)
  const byTime = new Map(cap.plotValues.rows.map((r) => [r[0], r[k]]))
  return bars.map((b) => byTime.get(b.t))
}
const VENDOR_UP = vendorCol('plot_1')
const VENDOR_DOWN = vendorCol('plot_2')
const mark = (v) => (v === 1 ? 1 : 0)
const disagreements = (ours, vendor) => ours.reduce((n, v, i) => n + (mark(v) === vendor[i] ? 0 : 1), 0)
const DEF_ID = 'u_member-pane-runtime-route'
const FLAG = 'VITE_PINE_RUNTIME_PANE_ENABLED'

afterEach(() => {
  registry.uninstallUserDefinition(DEF_ID)
  vi.unstubAllEnvs()
})

describe('⭐⭐ a script the columnar lane refuses for a structural reason routes to the runtime lane', () => {
  it('the host translation names the route, and only for that reason', () => {
    const t = translatePine(SOURCE, { strict: true, paramManifest: true })
    expect(runtimeRouteOf(t)).toBe(true)
    // ⛔ CONTROL: a refusal of any other kind is not routable.
    const other = translatePine('//@version=5\nindicator("x")\nplot(ta.nosuchfn(close))', { strict: true })
    expect(other.ok).toBe(false)
    expect(runtimeRouteOf(other)).toBe(false)
    // …and a script the host lane draws is not routed either.
    const fine = translatePine('//@version=5\nindicator("x")\nplot(ta.sma(close, 5))', { strict: true })
    expect(fine.ok).toBe(true)
    expect(runtimeRouteOf(fine)).toBe(false)
  })

  it('⛔ GATE OFF (production today): the door refuses exactly as before, naming the latches', () => {
    vi.stubEnv(FLAG, '')
    const built = memberPaneDefinition({ source: SOURCE, id: DEF_ID })
    expect(built.ok).toBe(false)
    expect(built.guard).toBe('pine:state')
    expect(built.reason).toMatch(/carry each other/)
    expect(built.lane).toBeUndefined()
  })

  it('⛔ GATE OFF: the install door refuses a runtime document, whoever minted it', () => {
    vi.stubEnv(FLAG, '1')
    const built = memberPaneDefinition({ source: SOURCE, id: DEF_ID })
    expect(built.ok).toBe(true)
    vi.stubEnv(FLAG, '')
    const { installed, errors } = registry.installUserDefinitions([built.definition])
    expect(installed).toEqual([])
    expect(errors.join(' ')).toMatch(/runtime/)
  })

  it('⭐⭐ GATE ON: the door mints a runtime document that draws both vendor columns on all 632 bars', () => {
    vi.stubEnv(FLAG, '1')
    const built = memberPaneDefinition({ source: SOURCE, id: DEF_ID })
    expect(built.ok, built.reason).toBe(true)
    expect(built.lane).toBe('runtime')
    // ⛔ A PREVIEW: the server's store takes `ast` alone, so it is not offered as a save.
    expect(built.saveable).toBe(false)
    expect(built.definition.compute.kind).toBe('runtime')
    expect(built.definition.compute.source).toBe(SOURCE)
    expect(built.rows.map((r) => r.output)).toEqual([0, 1])
    expect(built.notes.some((n) => /bar by bar/.test(n.note))).toBe(true)

    const { installed, errors } = registry.installUserDefinitions([built.definition])
    expect(errors).toEqual([])
    expect(installed.length).toBe(1)
    const def = installed[0]
    const cols = registry.computeFor(def, bars, undefined,
      { tf: 'D', newestBarIsForming: cap.newestBarIsForming ?? null })
    expect(registry.columnErrors(cols)).toEqual({})
    const [up, down] = built.rows.map((r) => cols[r.key])
    expect(up.length).toBe(632)
    expect(disagreements(up, VENDOR_UP)).toBe(0)
    expect(disagreements(down, VENDOR_DOWN)).toBe(0)
    // ⛔ NON-VACUITY: the vendor draws 42 and 34 marks, and so do we.
    expect(up.filter((v) => mark(v) === 1).length).toBe(42)
    expect(down.filter((v) => mark(v) === 1).length).toBe(34)
  })

  it('⛔ GATE ON: a script the runtime lane cannot build keeps the host refusal, with the reason it was not routed', () => {
    vi.stubEnv(FLAG, '1')
    // Coupled latches plus a read of another timeframe: the host refusal is the
    // coupled one, the route is declined because the repaint verdict cannot be
    // stated without the linter.
    const src = `${SOURCE}\nhtf = request.security(syminfo.tickerid, "W", close)\n`
    const built = memberPaneDefinition({ source: src, id: DEF_ID })
    expect(built.ok).toBe(false)
    expect(built.reason).toMatch(/declined/)
  })
})
