// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.rt1RuntimeFallback.test.js
//
// ─── ⭐⭐ RT1 — THE RUNTIME LANE AS THE MEMBER DOOR'S GENERAL FALLBACK ────────
//
// Integrator ruling (2026-10-02): a script the host (columnar) lane refuses is
// offered to the per-bar runtime lane; if that lane builds it within its budgets
// and everything it would draw is exact, the member pane draws it from there;
// otherwise the member reads the HOST lane's refusal, verbatim. Behind the
// existing flag (`VITE_PINE_RUNTIME_PANE_ENABLED`), still dark.
//
// Every expectation below is read off a committed vendor capture or off the
// door's own flag-off answer — never typed.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../../nativeRegistry'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { loadCapture, gradeCapture } from './harness'
import { toProductBars } from './ourSide'
import {
  computeRuntimeColumns, runtimeColumnsFor, probeRuntimeProgram, setRuntimeRunner,
  onRuntimeColumnsLanded, RUNTIME_HISTORY_GUARD, RUNTIME_TIME_BUDGET_GUARD,
  RUNTIME_PANE_TIME_BUDGET_MS,
} from '../../runtime/runtimeColumns'
import { setRuntimeKillList, runtimeSourceHash, runtimeKillOf } from '../../runtimeKill'

const REPO = path.resolve(process.cwd(), '..')
const HARNESS = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness')
const FLAG = 'VITE_PINE_RUNTIME_PANE_ENABLED'
const OBJECTS = 'VITE_PINE_OBJECTS_ONLY_PANE_ENABLED'
const DEF_ID = 'u_member-pane-rt1'

const capture = (name) => {
  const loaded = loadCapture(path.join(HARNESS, name))
  if (!loaded.capture) throw new Error(`not a capture — ${loaded.reason}`)
  return loaded.capture
}
const ADX = 'adx-and-di-for-v4-rddt-1d-2026-09-27.json'
const QQE = 'qqe-signals-rddt-1d-2026-09-27.json'
const PPST = 'pivot-point-supertrend-rddt-1d-2026-09-27.json'
const YATA = 'cc-yata-rddt-1d-2026-09-27.json'

/** The vendor's column for a plot title, aligned to the capture's bars. */
const vendorColumn = (cap, title) => {
  const p = cap.study.plots.find((x) => x.title === title)
  const k = cap.plotValues.fields.indexOf(p.id)
  const byTime = new Map(cap.plotValues.rows.map((r) => [r[0], r[k]]))
  return cap.bars.rows.map((r) => byTime.get(r[0]))
}
const isNa = (v) => v === null || v === undefined || Number.isNaN(v)

afterEach(() => {
  registry.uninstallUserDefinition(DEF_ID)
  setRuntimeKillList([])
  setRuntimeRunner(null)
  vi.unstubAllEnvs()
})

describe('RT1 — routing: flag off is the door it always was', () => {
  it('⛔ FLAG OFF: a host refusal is answered exactly as before, with no runtime fields', () => {
    const cap = capture(ADX)
    vi.stubEnv(FLAG, '')
    const off = memberPaneDefinition({ source: cap.source.text, id: DEF_ID })
    expect(off.ok).toBe(false)
    expect(off.lane).toBeUndefined()
    expect(off.runtimeDeclined).toBeUndefined()
    // and no refused row carries what only the fallback asks for
    const refused = (off.translation.outputs || []).filter((o) => o && o.refusal)
    expect(refused.length).toBeGreaterThan(0)
    for (const o of refused) {
      expect(o.presentation).toBeUndefined()
      expect(Object.getOwnPropertyDescriptor(o, '_offsetWritten')).toBeUndefined()
    }
  })

  it('⭐⭐ FLAG ON: the runtime lane draws the refused script, and every vendor plot MATCHes', () => {
    const cap = capture(ADX)
    vi.stubEnv(OBJECTS, '1')
    vi.stubEnv(FLAG, '1')
    const on = memberPaneDefinition({ source: cap.source.text, id: DEF_ID })
    expect(on.ok, on.reason).toBe(true)
    expect(on.lane).toBe('runtime')
    expect(on.saveable).toBe(true)
    // ⭐ R-W for this lane: a FALLBACK document needs a listing-start series.
    expect(on.definition.meta.runtimeHistory).toBe('listing')
    expect(on.definition.meta.runtimeSourceHash).toBe(runtimeSourceHash(cap.source.text))
    // the refused rows carried the author's titles, read by the translator
    expect(on.rows.map((r) => r.label)).toEqual(cap.study.plots.map((p) => p.title))
    // ⭐ graded through the REAL door, on the capture's own bars
    const { verdict } = gradeCapture(cap)
    expect(verdict.verdict, verdict.reason).toBe('MATCH')
    const drawn = verdict.plots.filter((p) => p.verdict === 'MATCH')
    expect(drawn.length).toBe(cap.study.plots.length) // non-vacuity: all three compared
  })

  it('⭐ a script the runtime lane declines reads the HOST refusal verbatim, guard included', () => {
    const cap = capture(ADX)
    vi.stubEnv(FLAG, '')
    const off = memberPaneDefinition({ source: cap.source.text, id: DEF_ID })
    // The same script, made unroutable: it now carries a `varip`, which the
    // runtime lane refuses by name. (⚰️ RT2: this read another timeframe and
    // expected `runtime:repaint-unstated`; that class is now STATED, and an
    // unused weekly read no longer stops the script — `vendorHarness.rt2*`.)
    const src = `${cap.source.text}\nvarip int rt2Ticks = 0\n`
    const offB = memberPaneDefinition({ source: src, id: DEF_ID })
    vi.stubEnv(FLAG, '1')
    const onB = memberPaneDefinition({ source: src, id: DEF_ID })
    expect(onB.ok).toBe(false)
    expect(onB.reason).toBe(offB.reason)
    expect(onB.guard).toBe(offB.guard)
    expect(onB.runtimeDeclined && onB.runtimeDeclined.code).toBe('runtime:varip')
    expect(off.reason).toBeTruthy()
  })
})

describe('RT1 → RT3 — a `?:` whose test is `na` reads as false from v4; only what is unsettled is withheld', () => {
  // RT1 found the runtime `?:` answering `na` on an `na` test where TradingView
  // takes the other branch, and withheld every such script from the fallback.
  // ⭐ RT3: the runtime lane now reads an `na` condition as TradingView does
  // from v4 (`interpret.js::pineBool`, one rule for both lanes), so the two v4
  // captures below are drawn by the runtime run exactly as TradingView draws
  // them. H1 still serves both from the host lane first, so the runtime run is
  // graded here directly. What stays withheld is what is still unsettled — a
  // `?:` below v4, and a v4/v5 `or` / `not` over a value that can be `na`.
  it('⭐ qqe-signals: the runtime run now marks exactly TradingView\'s bars — bar 73 included', () => {
    const cap = capture(QQE)
    vi.stubEnv(FLAG, '1')
    const built = memberPaneDefinition({ source: cap.source.text, id: DEF_ID })
    expect(built.ok).toBe(true)
    expect(built.lane).toBeUndefined() // the host lane serves it first (H1)
    const probe = probeRuntimeProgram(cap.source.text)
    expect(probe.ok).toBe(true)
    expect(probe.naTests).toBe(0) // v4: the `?:` tests are settled now
    const shapes = probe.outputs.map((o, i) => (o.call === 'plotshape' ? i : -1)).filter((i) => i >= 0)
    for (const [ord, title] of [[0, 'QQE long'], [1, 'QQE short']]) {
      const cols = computeRuntimeColumns({ id: 'x', compute: { fn: 'x', source: cap.source.text, outputs: { v: shapes[ord] } } },
        toProductBars(cap), { tf: 'D', newestBarIsForming: false, historyFromListing: true })
      const vendor = vendorColumn(cap, title) // sparse capture: a bar it does not list is not drawn
      const differ = cols.v.map((v, i) => (isNa(v) !== isNa(vendor[i]) ? i : -1)).filter((i) => i >= 0)
      expect(differ, title).toEqual([])
      expect(cols.v.filter((v) => !isNa(v)).length, title).toBeGreaterThan(10) // non-vacuity
    }
    expect(isNa(vendorColumn(cap, 'QQE long')[73])).toBe(true) // the bar RT1 found: TradingView draws nothing there
  })

  it('⭐ pivot-point-supertrend: no unsettled condition is left, and the runtime `Buy` agrees with TradingView', () => {
    // ⚰️ RT1 measured this `Buy` differing on a bar and put it down to the `na`
    // test. It was the pivot tie (`vendorHarness.h1PivotTies`); the `na` test
    // (`ph ? ph : pl ? pl : na`, v4) is now read as TradingView reads it.
    const cap = capture(PPST)
    vi.stubEnv(FLAG, '1')
    const built = memberPaneDefinition({ source: cap.source.text, id: DEF_ID })
    expect(built.ok).toBe(true)
    expect(built.lane).toBeUndefined()
    const probe = probeRuntimeProgram(cap.source.text)
    expect(probe.naTests).toBe(0)
    const shapes = probe.outputs.map((o, i) => (o.call === 'plotshape' ? i : -1)).filter((i) => i >= 0)
    const buy = shapes[2] // the third plotshape is `Buy` (two pivot marks precede it)
    const cols = computeRuntimeColumns({ id: 'x', compute: { fn: 'x', source: cap.source.text, outputs: { v: buy } } },
      toProductBars(cap), { tf: 'D', newestBarIsForming: false, historyFromListing: true })
    const vendor = vendorColumn(cap, 'Buy')
    const differ = cols.v.filter((v, i) => !isNa(v) && !isNa(vendor[i])
      && Math.abs(v - vendor[i]) > 1e-6 * Math.abs(vendor[i]))
    expect(differ).toEqual([])
    expect(cols.v.filter((v) => !isNa(v)).length).toBeGreaterThan(3)
  })

  it('⭐ at the door: trend-targets-algoalpha (v6), withheld by RT1, is now drawn by the runtime lane', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), '..', 'corpus/committed/trend-targets-algoalpha__92ff5628d7.pine'), 'utf8')
    vi.stubEnv(OBJECTS, '1')
    vi.stubEnv(FLAG, '1')
    const built = memberPaneDefinition({ source: src, id: DEF_ID })
    expect(built.ok, built.reason).toBe(true)
    expect(built.lane).toBe('runtime')
    expect(built.runtimeDeclined).toBeUndefined()
    // the control: with the lane off the host lane refuses it, so it was the runtime lane that drew it
    vi.stubEnv(FLAG, '0')
    expect(memberPaneDefinition({ source: src, id: DEF_ID }).ok).toBe(false)
  })

  it('⭐ F1 — a v5 `or` / `not` over a value that can be `na` is now SERVED: CAP2 witnessed the rule (Q-NL-a/b)', () => {
    // cc-yata: a v5 script the host lane refuses, whose `or` / `not` read values
    // that can be `na`. It was declined (`runtime:na-test`) while the rule was
    // unwitnessed; `rt3-na-logic{,-v4}-rddt-1d-2026-10-02` show TradingView reading
    // the `na` operand as FALSE in v5 and v4, so the runtime lane reads each operand
    // as a condition and the script attaches.
    const cap = capture(YATA)
    vi.stubEnv(OBJECTS, '1')
    vi.stubEnv(FLAG, '')
    const off = memberPaneDefinition({ source: cap.source.text, id: DEF_ID })
    vi.stubEnv(FLAG, '1')
    const built = memberPaneDefinition({ source: cap.source.text, id: DEF_ID })
    expect(built.ok, built.reason).toBe(true)
    expect(built.lane).toBe('runtime')
    expect(probeRuntimeProgram(cap.source.text).naTests).toBe(0)
    // the control: with the lane off the host lane still refuses it
    expect(off.ok).toBe(false)
  })
})

describe('RT1 — R-W for the runtime lane: a fallback document needs a listing-start series', () => {
  it('⛔ off the listing it computes nothing, by name; on it, the vendor columns', () => {
    const cap = capture(ADX)
    vi.stubEnv(FLAG, '1')
    const built = memberPaneDefinition({ source: cap.source.text, id: DEF_ID })
    const { installed } = registry.installUserDefinitions([built.definition])
    const bars = toProductBars(cap)
    const off = registry.computeFor(installed[0], bars, undefined, { tf: 'D', newestBarIsForming: false })
    const errs = registry.columnErrors(off)
    expect(Object.keys(errs).length).toBe(built.rows.length)
    for (const e of Object.values(errs)) expect(e.guard).toBe(RUNTIME_HISTORY_GUARD)
    const on = registry.computeFor(installed[0], toProductBars(cap), undefined,
      { tf: 'D', newestBarIsForming: false, historyFromListing: true })
    expect(registry.columnErrors(on)).toEqual({})
    const vendor = vendorColumn(cap, 'ADX')
    const ours = on[built.rows.find((r) => r.label === 'ADX').key]
    const last = ours.length - 1
    expect(Math.abs(ours[last] - vendor[last])).toBeLessThan(1e-9 * Math.abs(vendor[last]))
  })
})

describe('RT1 — what a runtime row cannot carry is withheld by name, never drawn as a guess', () => {
  it('a shifted plot and a per-bar colour are withheld, named in the disclosures; the rest draws', () => {
    const cap = capture(ADX)
    vi.stubEnv(FLAG, '1')
    const src = `${cap.source.text}
plot(close, title="Shifted", offset=3)
plot(close, title="Tinted", color = close > open ? color.green : color.red)
`
    const built = memberPaneDefinition({ source: src, id: DEF_ID })
    expect(built.ok, built.reason).toBe(true)
    expect(built.withheld).toEqual(['Shifted', 'Tinted'])
    expect(built.rows.map((r) => r.label)).toEqual(cap.study.plots.map((p) => p.title))
    const notes = built.notes.map((n) => n.note).join(' | ')
    expect(notes).toMatch(/`Shifted` is not drawn: .*offset/)
    expect(notes).toMatch(/`Tinted` is not drawn: .*colour changes/)
  })
})

describe('RT1 — the per-script kill switch (server list, delivered two ways)', () => {
  it('⛔ a listed source hash falls back to the host refusal; a listed definition id too', () => {
    const cap = capture(ADX)
    vi.stubEnv(FLAG, '')
    const off = memberPaneDefinition({ source: cap.source.text, id: DEF_ID })
    vi.stubEnv(FLAG, '1')
    setRuntimeKillList([runtimeSourceHash(cap.source.text).slice(0, 16)])
    const killed = memberPaneDefinition({ source: cap.source.text, id: DEF_ID })
    expect(killed.ok).toBe(false)
    expect(killed.reason).toBe(off.reason)
    expect(killed.runtimeDeclined.code).toBe('runtime:killed')
    setRuntimeKillList(['u_0123456789ab'])
    expect(runtimeKillOf({ defId: 'u_0123456789ab' })).toMatch(/kill list/)
    expect(runtimeKillOf({ defId: 'u_0123456789ac' })).toBeNull()
    setRuntimeKillList(['not-an-entry', 'abc']) // malformed entries are ignored
    expect(runtimeKillOf({ source: cap.source.text })).toBeNull()
  })

  it('⛔ the install door refuses a SERVED kill stamp, and keeps nothing installed', () => {
    const cap = capture(ADX)
    vi.stubEnv(FLAG, '1')
    const built = memberPaneDefinition({ source: cap.source.text, id: DEF_ID })
    const stamped = { ...built.definition, meta: { ...built.definition.meta, runtimeKilled: 'on the list' } }
    const { installed, errors } = registry.installUserDefinitions([stamped])
    expect(installed).toEqual([])
    expect(errors.join(' ')).toMatch(/on the list.*kept/)
    // control: the same document unstamped installs
    const ok = registry.installUserDefinitions([built.definition])
    expect(ok.installed.length).toBe(1)
  })
})

describe('RT1 — the time budget and the off-thread run', () => {
  const tinySource = '//@version=5\nindicator("t")\nvar float s = 0.0\ns := s + close\nplot(s)\n'
  const tinyDef = { id: 'x', compute: { fn: 'x', source: tinySource, outputs: { v: 0 } } }
  const bars = Array.from({ length: 50 }, (_, i) => ({ t: 1e9 + i * 86400, o: 1, h: 2, l: 0.5, c: 1 + i, v: 10 }))

  it('⛔ a run past its budget stops BY NAME, naming the bar it reached', () => {
    let clock = 0
    const now = () => { clock += 10; return clock }
    let stopped = null
    try { computeRuntimeColumns(tinyDef, bars, { tf: 'D' }, { budgetMs: 100, now }) } catch (err) { stopped = err }
    expect(stopped).toBeTruthy()
    expect(stopped.guard).toBe(RUNTIME_TIME_BUDGET_GUARD)
    expect(stopped.message).toMatch(/took more than 100 ms .*reached bar \d+ of 50/)
    // control: under budget it draws
    expect(computeRuntimeColumns(tinyDef, bars, { tf: 'D' }, { budgetMs: RUNTIME_PANE_TIME_BUDGET_MS }).v.length).toBe(50)
  })

  it('⭐ off the main thread: the paint draws nothing, the landing repaints, the next paint reads it', () => {
    const jobs = []
    setRuntimeRunner((def, rows, ctx, done) => jobs.push({ def, rows, ctx, done }))
    const landed = []
    const stop = onRuntimeColumnsLanded((key) => landed.push(key))
    try {
      const rows = bars.slice()
      expect(runtimeColumnsFor(tinyDef, rows, undefined, { tf: 'D' })).toEqual({})
      expect(runtimeColumnsFor(tinyDef, rows, undefined, { tf: 'D' })).toEqual({})
      expect(jobs.length).toBe(1) // a run is never started twice for one key
      const cols = computeRuntimeColumns(jobs[0].def, jobs[0].rows, jobs[0].ctx)
      jobs[0].done(null, cols)
      expect(landed.length).toBe(1)
      expect(runtimeColumnsFor(tinyDef, rows, undefined, { tf: 'D' }).v.length).toBe(50)
    } finally { stop() }
  })
})
