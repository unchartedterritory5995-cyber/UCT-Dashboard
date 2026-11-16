// The editor status panel's data, through the REAL doors: `inspectSource` (the report
// PasteBox holds: the screener lane, the one "Use this formula" saves from) and
// `memberPaneDefinition` (the chart door), so a change in either reader shows here
// rather than in a hand-made fixture. Every consumer row answers from the lane that
// consumer actually uses.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectSource } from './PineBox'
import { paneFor } from './PineEditorStatus'
import {
  editorStatus, PANEL_STATE, SEVERITY, runsOn, stillWorksText, lineMarks, FAMILIES, UNKNOWN_FAMILY,
  savedVersion, DOOR_NOTHING_TO_DRAW, RUNTIME_UNDRAWN_NOTE,
} from './editorStatus'
import { SCRIPT_ENGINE_VERSION } from '../engine/scriptEngineVersion'
import { parseFormula } from '../engine/ast/parse'
import { evaluability, LANES } from '../engine/evaluability'
import { assessObjectLoss, objectLossNote } from '../engine/ast/objectLoss'

afterEach(() => { vi.unstubAllEnvs() })

const v5 = (...body) => ['//@version=5', 'indicator("probe")', ...body].join('\n')
const v6 = (...body) => ['//@version=6', 'indicator("probe")', 'up = close > open', ...body].join('\n')

const SCRIPTS = {
  runs: `//@version=6
indicator("RSI Swing")
len = input.int(14, "Length")
r = ta.rsi(close, len)
plot(r, "RSI")
plot(r > 70 ? 1 : 0, "OB")`,
  // a number line only: the chart and alerts run it, a screen needs a yes/no
  rsi: '//@version=6\nindicator("RSI")\nr = ta.rsi(close, 14)\nplot(r, "RSI")',
  request: `//@version=6
indicator("Mixed")
a = ta.sma(close, 10)
plot(a, "SMA")
s = request.security("SPY", "60", close)
plot(s, "SPY 60")
plot(close > a ? 1 : 0, "Above")`,
  strategy: `//@version=5
strategy("S")
if ta.crossover(close, ta.sma(close, 5))
    strategy.entry("L", strategy.long)
plot(ta.sma(close, 5))`,
  nothing: `//@version=6
indicator("x")
plot(foo.bar(close))`,
  // a table-only script whose object program is clean (no plot, no alert)
  objectsOnly: '//@version=6\nindicator("t", overlay = true)\nvar t = table.new(position.top_right, 1, 1)\n'
    + 'if barstate.islast\n    table.cell(t, 0, 0, str.tostring(close))\n',
  // a background-only overlay: the report's lane says `pine:no-output`
  paintOnly: '//@version=5\nindicator("bg", overlay=true)\nbgcolor(close > open ? color.new(color.green, 80) : na)',
  // C48: a plot that reads a call inside an `if` that may not run on every bar
  c48: v6('float v = na', 'if up', '    v := ta.sma(close, 3)', 'plot(v, "V")'),
  // H1: a colour whose rule reads the right side of a v6 `and`
  colourGate: v6('plot(close, "C", color = up and ta.rising(close, 2) ? color.green : color.red)'),
  // C29: a plot that folded the chart's own period
  period: '//@version=6\nindicator("x")\nplot(close * timeframe.multiplier, "M")\n',
  // a weekly read: the fold note reaches the report's outcome AND the pane's disclosures
  // ⭐ ENGINE 55 — the weekly look-ahead-off request carries no fold note any more (it is
  // `tf_merge`, TradingView's merge); the fold note left is a daily request read as the chart's own bars.
  fold: '//@version=5\nindicator("f")\nw = request.security(syminfo.tickerid, "D", ta.sma(close, 10))\nplot(w, "W")',
  // a paint withheld by the chart door (an `offset` that is `na`)
  paintWithheld: '//@version=5\nindicator("paints", overlay = true)\nplot(close, "c")\nbarcolor(color.red, offset = na)\n',
  // ⭐ the screener lane refuses these at the door (`pine:window-dependent`, a period
  // anchor); the chart door's host lane draws them
  obv: v5('plot(ta.cum(math.sign(ta.change(close)) * volume), "OBV")'),
  isfirst: v5('plot(barstate.isfirst ? 1 : 0, "First")'),
  timeW: v5('plot(time("W"), "Week")'),
  // an alert condition and nothing else: the chart door draws nothing (ruling D1)
  alertOnly: '//@version=5\nindicator("ac")\nalertcondition(ta.crossover(close, ta.sma(close, 20)), "Cross up")',
}

const statusOf = (src, extra = {}) => {
  const report = inspectSource(src, 'auto')
  const pane = paneFor(report, src)
  return { report, pane, status: editorStatus({ report, pane, inspectedSource: src, ...extra }) }
}
const byId = (status) => Object.fromEntries(status.runsOn.map((r) => [r.id, r]))
const withheldOf = (status) => status.items.filter((x) => x.severity === SEVERITY.WITHHELD)

describe('editorStatus through the real doors', () => {
  it('a script every consumer runs reads "Runs fully"', () => {
    const { status } = statusOf(SCRIPTS.runs)
    expect(status.state).toBe(PANEL_STATE.RUNS)
    expect(status.headline).toBe('Runs fully')
    expect(status.lane).toBe('host')
    const by = byId(status)
    for (const id of ['chart', 'alerts', 'screener', 'scans']) expect(by[id].ok, id).toBe(true)
    // the 0/1 plot is the screen and the scan
    expect(by.screener.works).toEqual(['OB'])
    expect(stillWorksText(status.stillWorks))
      .toBe('What still works: 2 plots on the chart; RSI and OB in alerts; OB in screens and scans.')
  })

  it('"Runs fully" only when EVERY consumer runs: a number line says what it needs', () => {
    const { status } = statusOf(SCRIPTS.rsi)
    const by = byId(status)
    expect(by.chart.ok).toBe(true)
    expect(by.alerts.ok).toBe(true)
    expect(by.screener.ok).toBe(false)
    expect(by.screener.why).toBe('A screen keeps the symbols where a yes/no is true; this output is not a yes/no.')
    expect(by.screener.subject).toBe('RSI')
    expect(status.state).toBe(PANEL_STATE.RUNS)
    // the box's threshold control makes a screen of a number: worded so, never "not in"
    expect(status.headline).toBe('Runs on the chart and in alerts; screens and scans need a threshold')
  })

  it('a strategy the report refuses is still drawn by the chart door: chart runs, screens say why', () => {
    const { report, pane, status } = statusOf(SCRIPTS.strategy)
    expect(report.ok).toBe(false)
    expect(report.refusal.guard).toBe('pine:declaration-strategy')
    expect(pane && pane.ok).toBe(true)
    const by = byId(status)
    expect(by.chart.ok).toBeTruthy()
    // the report's refusal is a SCREENING fact, verbatim, on the screener and scans rows
    for (const id of ['screener', 'scans']) {
      expect(by[id].ok).toBe(false)
      expect(by[id].why).toBe(report.refusal.message)
    }
    // ...never a withheld value; the orders and backtest are, from the chart door's notes
    expect(status.items.some((x) => x.guard === 'pine:declaration-strategy')).toBe(false)
    expect(status.items.some((x) => x.family === 'strategy' && x.severity === SEVERITY.WITHHELD)).toBe(true)
    // alerts read the chart door's own document (the Pine tab's attach)
    expect(by.alerts.ok).toBe(true)
    expect(stillWorksText(status.stillWorks)).toBe(`What still works: 1 plot on the chart; ${by.alerts.works[0]} in alerts.`)
  })

  it('a clean objects-only script is drawn by the chart door; nothing a screen or alert can read', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const { report, pane, status } = statusOf(SCRIPTS.objectsOnly)
    expect(report.refusal.guard).toBe('pine:objects-only')
    expect(pane && pane.ok).toBe(true)
    const by = byId(status)
    expect(by.chart.ok).toBe(true)
    // the hidden anchor row a table-only document carries answers for no consumer
    for (const id of ['alerts', 'screener', 'scans']) {
      expect(by[id].ok).toBe(false)
      expect(by[id].why).toBe(report.refusal.message)
    }
    expect(status.items.some((x) => x.guard === 'pine:objects-only')).toBe(false)
    expect(status.state).not.toBe(PANEL_STATE.NOT_YET)
    expect(stillWorksText(status.stillWorks)).toBe('What still works: its drawings on the chart.')
  })

  it('a paint-only overlay is drawn by the chart door, and its paint counts as a drawing', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const { report, status } = statusOf(SCRIPTS.paintOnly)
    expect(report.refusal.guard).toBe('pine:no-output')
    const by = byId(status)
    expect(by.chart.ok).toBe(true)
    expect(by.screener.why).toBe(report.refusal.message)
    expect(stillWorksText(status.stillWorks)).toBe('What still works: its drawings on the chart.')
  })

  it('a script with nothing runnable reads "Not yet: <family label>", the label as written', () => {
    const { status } = statusOf(SCRIPTS.nothing)
    expect(status.state).toBe(PANEL_STATE.NOT_YET)
    expect([...FAMILIES, UNKNOWN_FAMILY].map((f) => `Not yet: ${f.label}`)).toContain(status.headline)
    expect(status.runsOn.every((r) => !r.ok)).toBe(true)
    expect(stillWorksText(status.stillWorks)).toBe('Nothing else runs yet.')
    // the chart door's own refusal is the withheld value, on its line
    expect(withheldOf(status).map((x) => x.line)).toContain(3)
  })

  it('an engine error is the engine-fault state, never a verdict about the script', () => {
    const status = editorStatus({ report: { ok: false, dialect: 'pine', outputs: [], error: 'boom', outcome: { verdict: 'error', missing: [], semantic: [] } } })
    expect(status.state).toBe(PANEL_STATE.ENGINE_ERROR)
    expect(status.headline).toMatch(/not your script/)
  })
})

describe('a plot is withheld on the chart ONLY if the chart door withholds it', () => {
  // [what, script, the title the script gives the plot]
  const CASES = [['OBV, `ta.cum`', 'obv', 'OBV'], ['`barstate.isfirst`', 'isfirst', 'First'], ['`time("W")`, a period anchor', 'timeW', 'Week']]
  for (const [what, key, title] of CASES) {
    it(`${what}: the chart draws it; nothing withheld, no line mark; the screener names the refusal`, () => {
      const { report, pane, status } = statusOf(SCRIPTS[key])
      const refused = report.outputs.find((o) => o && !o.formula)
      expect(refused && refused.refusal, 'control: the screener lane refuses it').toBeTruthy()
      expect(pane && pane.ok, 'control: the chart door draws it').toBe(true)
      expect(withheldOf(status)).toEqual([])
      expect(lineMarks(status, SCRIPTS[key]).marks.filter((m) => m.severity === SEVERITY.WITHHELD)).toEqual([])
      const by = byId(status)
      expect(by.chart.ok).toBe(true)
      for (const id of ['screener', 'scans']) {
        expect(by[id].ok).toBe(false)
        // the engine's own sentence, named by the plot it refuses (a refused row carries
        // no title, so the chart door's translation of the same plot names it)
        expect(by[id].why).toBe(refused.refusal.message)
        expect(by[id].subject).toBe(title)
      }
      expect(status.headline).not.toMatch(/withheld/)
    })
  }

  it('OBV: the alert doors are refused too (the report offers nothing; the chart\'s document raises `window_dependent`)', () => {
    const { report, pane, status } = statusOf(SCRIPTS.obv)
    expect(pane.requirementTags).toContain('window_dependent')
    const by = byId(status)
    expect(by.alerts.ok).toBe(false)
    expect(by.alerts.why).toBe(report.refusal.message)
    expect(status.headline).toBe('Runs on the chart; not in alerts, screens or scans')
    expect(stillWorksText(status.stillWorks)).toBe('What still works: 1 plot on the chart.')
  })

  it('a screener-lane refusal of ONE plot the chart draws is named on the screen rows, not withheld', () => {
    const src = v5('plot(ta.cum(math.sign(ta.change(close)) * volume), "OBV")', 'plot(close > open ? 1 : 0, "Up")')
    const { report, pane, status } = statusOf(src)
    expect(pane.ok).toBe(true)
    const refused = report.outputs.find((o) => o && !o.formula)
    const by = byId(status)
    expect(withheldOf(status)).toEqual([])
    expect(by.screener.ok).toBe(true)
    expect(by.screener.works).toEqual(['Up'])
    for (const id of ['screener', 'scans']) {
      expect(by[id].refused).toEqual([{ name: 'OBV', guard: refused.refusal.guard, family: expect.any(String), why: refused.refusal.message }])
    }
  })
})

describe('every consumer row answers from its own lane', () => {
  it('alertcondition only: the chart door draws nothing, yet "Use this formula" saves a working alert and screen', () => {
    const { report, pane, status } = statusOf(SCRIPTS.alertOnly)
    expect(pane.ok, 'control: the chart door never carries an alertcondition').toBe(false)
    expect(report.ok, 'control: the report offers it as a column').toBe(true)
    const by = byId(status)
    expect(by.chart.ok).toBe(false)
    expect(by.chart.why).toBe(pane.reason)
    for (const id of ['alerts', 'screener', 'scans']) {
      expect(by[id].ok, id).toBe(true)
      expect(by[id].works, id).toEqual(['Cross up'])
    }
    expect(status.state).toBe(PANEL_STATE.RUNS_ELSEWHERE)
    // control: the chart door's own guard-less refusal, the literal the panel holds equal to it
    expect(pane.guard).toBeNull()
    expect(pane.reason).toBe(DOOR_NOTHING_TO_DRAW)
    // nothing is missing, so no "yet"
    expect(status.headline).toBe('Runs in alerts, screens and scans; nothing to draw on a chart')
    expect(stillWorksText(status.stillWorks)).toBe('What still works: Cross up in alerts, screens and scans.')
  })

  it('a chart door refusal with a guard, or a guard-less fault, keeps "the chart cannot draw it yet"', () => {
    const report = inspectSource(SCRIPTS.alertOnly, 'auto')
    const guarded = editorStatus({ report, pane: { ok: false, guard: 'pine:request', reason: 'another symbol at 60' } })
    expect(guarded.headline).toBe('Runs in alerts, screens and scans; the chart cannot draw it yet: Data from another symbol or timeframe')
    const fault = editorStatus({ report, pane: { ok: false, guard: null, reason: 'the document could not be built: boom' } })
    expect(fault.headline).toBe('Runs in alerts, screens and scans; the chart cannot draw it yet: the document could not be built: boom')
  })

  it('the request mockup (the flip precondition): "Above" is listed as working on the Screener', () => {
    const { status } = statusOf(SCRIPTS.request)
    const by = byId(status)
    for (const id of ['screener', 'scans']) {
      expect(by[id].ok, id).toBe(true)
      expect(by[id].works, id).toContain('Above')
    }
    expect(by.alerts.works).toContain('Above')
    expect(stillWorksText(status.stillWorks)).toMatch(/Above in screens and scans\.$/)
    expect(status.state).not.toBe(PANEL_STATE.NOT_YET)
  })

  it('the request mockup: the chart door\'s refusal is the withheld value, on its own line, verbatim', () => {
    const { pane, status } = statusOf(SCRIPTS.request)
    const doorRefused = (pane.translation.outputs || []).find((o) => o && !o.formula)
    expect(doorRefused, 'control: the chart door refuses the other-symbol plot').toBeTruthy()
    const req = withheldOf(status).find((x) => x.family === 'request')
    expect(req).toBeTruthy()
    expect(req.reason).toBe(doorRefused.refusal.message)
    expect([5, 6]).toContain(req.line)
  })
})

describe('what the chart bind may withhold on some charts (read from the pane document)', () => {
  it('C48: a plot reading a call inside an `if` may be withheld, on its plot line, with the gate\'s sentence', () => {
    const { pane, status } = statusOf(SCRIPTS.c48)
    const gate = pane.definition.meta.blockRuns.keys[0].gates[0]
    const may = status.items.filter((x) => x.severity === SEVERITY.MAY_WITHHOLD)
    expect(may).toHaveLength(1)
    expect(may[0]).toMatchObject({ kind: 'block-runs', family: 'block', guard: 'pine:block', name: 'V', line: 7, reason: gate.why })
    expect(status.state).toBe(PANEL_STATE.RUNS_WITH_NOTES)
    expect(status.headline).toBe('Runs on the chart and in alerts, with 1 note')
  })

  it('H1: a colour column\'s gate is named by the plot it colours', () => {
    const { pane, status } = statusOf(SCRIPTS.colourGate)
    const entry = pane.definition.meta.blockRuns.keys[0]
    const may = status.items.find((x) => x.kind === 'block-runs')
    expect(may).toMatchObject({ name: 'colour of C', line: 4, reason: entry.gates[0].why })
  })

  it('a hidden colour column never makes the script a screen', () => {
    const { status } = statusOf(SCRIPTS.colourGate)
    const by = byId(status)
    // the one visible plot is `close`, a number, not a yes/no
    expect(by.screener.ok).toBe(false)
    expect(by.scans.ok).toBe(false)
  })

  it('C29: a plot that folded the chart period may be withheld, with the period module\'s own sentence', () => {
    const { status } = statusOf(SCRIPTS.period)
    const may = status.items.find((x) => x.kind === 'period-reads')
    expect(may).toBeTruthy()
    expect(may).toMatchObject({ family: 'period', guard: 'bind:period-reads', name: 'M', line: 3 })
    expect(may.reason).toMatch(/translated at the `D` period and reads it \(`timeframe\.multiplier`\)/)
  })
})

describe('one fact, one item', () => {
  it('a fold note the report and the pane both carry is listed and counted once', () => {
    const { status } = statusOf(SCRIPTS.fold)
    const notes = status.items.filter((x) => x.severity === SEVERITY.NOTE)
    expect(notes).toHaveLength(1)
    expect(status.headline).toBe('Runs on the chart and in alerts, with 1 note')
  })

  it('a paint the chart door withholds is ONE withheld value, on its line, not also a note', () => {
    const { pane, status } = statusOf(SCRIPTS.paintWithheld)
    const paint = pane.translation.presentation.paints.find((p) => p && p.withheld)
    const items = status.items.filter((x) => x.kind === 'paint')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ severity: SEVERITY.WITHHELD, name: '`barcolor`', line: 4, reason: paint.withheld.reason })
    expect(status.items.some((x) => x.kind === 'pane-note' && x.reason.includes(paint.withheld.reason))).toBe(false)
    expect(status.headline).toBe('Runs on the chart and in alerts, 1 value withheld (not guessed)')
  })
})

describe('runsOn', () => {
  const pane = { ok: true, lane: undefined, requirementTags: [], definition: { plots: [{ key: 'value' }] } }
  const yes = () => ({ status: 'supported' })
  const SRC = '//@version=5\nindicator("saved")\nplot(close > open ? 1 : 0, "Up")'
  const report = inspectSource(SRC, 'auto')

  it('a runtime-lane document runs on the chart; the alert lane refuses it in its own words', () => {
    const rows = runsOn({ ...pane, lane: 'runtime', definition: { plots: [{ key: 'value' }], compute: { kind: 'runtime' } } })
    const by = Object.fromEntries(rows.map((r) => [r.id, r]))
    expect(by.chart.ok).toBe(true)
    expect(by.alerts.ok).toBe(false)
    expect(by.alerts.why).toMatch(/admits only formulas/)
  })

  it('screens answer from the report lane, whatever lane draws the chart', () => {
    const rows = runsOn({ ...pane, lane: 'runtime', definition: { plots: [{ key: 'value' }], compute: { kind: 'runtime' } } }, { report })
    const by = Object.fromEntries(rows.map((r) => [r.id, r]))
    expect(by.screener.ok).toBe(true)
    expect(by.screener.works).toEqual(['Up'])
    expect(by.alerts.ok).toBe(true)
  })

  it('a requirement tag the manifest refuses for alerts refuses the chart door\'s document there (roster from closedTable)', () => {
    const rows = runsOn({ ...pane, requirementTags: ['window_dependent'] }, { evaluate: yes })
    expect(rows.find((r) => r.id === 'chart').ok).toBe(true)
    const alerts = rows.find((r) => r.id === 'alerts')
    expect(alerts.ok).toBe(false)
    expect(alerts.why).toMatch(/`cum`/)
  })

  // ⭐ THE SAVED VERSION IS ITS OWN LINE, NEVER A ROW (spec s2, s5): the rows always
  // answer for the text in the editor, through the real doors.
  const heldRow = {
    definition: { compute: { kind: 'ast' } }, pine_source: SRC,
    engine_status: { engine: SCRIPT_ENGINE_VERSION, status: 'refused', reason: 'the strategy call cannot be translated' },
    scan_refusal: { gate: 'withheld', detail: 'engine-refused: today\'s script engine refuses this script' },
  }

  it('a saved version the script engine refused: the rows stay live, the hold is the saved version\'s own line', () => {
    const { status } = statusOf(SRC, { savedRow: heldRow })
    const by = byId(status)
    for (const id of ['alerts', 'screener', 'scans']) {
      expect(by[id].family, id).not.toBe('held')
      expect(by[id].ok, id).toBe(true)
    }
    expect(by.screener.works).toEqual(['Up'])
    expect(status.saved).toMatchObject({ held: true, family: 'held', guard: 'engine:withheld', detail: heldRow.engine_status.reason })
  })

  it('the hold describes the saved version\'s script: for any other text in the editor it is not shown', () => {
    const edited = `${SRC}\n// edited`
    const { status } = statusOf(edited, { savedRow: heldRow })
    expect(status.saved).toBeNull()
    expect(byId(status).screener.ok).toBe(true)
  })

  it('a version an OLDER engine refused, waiting for today\'s engine to translate its script again, is held too', () => {
    const stale = {
      def_id: 'u_aaaaaaaaaaaa', version: 2, pine_source: SRC,
      definition: { compute: { kind: 'ast' }, meta: { recurrenceOrigin: 'pine', engineVersion: SCRIPT_ENGINE_VERSION - 1 } },
    }
    const refused = { ...stale, engine_status: { engine: SCRIPT_ENGINE_VERSION - 1, status: 'refused', reason: 'an older engine refused it' } }
    expect(savedVersion(refused, SRC)).toMatchObject({ held: true, detail: 'an older engine refused it' })
    // control: the same stale version with no refusal recorded is not held, and says nothing
    expect(savedVersion(stale, SRC)).toBeNull()
  })

  it('the sweep\'s C45 `withheld` gate is not an engine hold: the server\'s sentence is the saved version\'s line, verbatim', () => {
    const savedRow = {
      definition: { compute: { kind: 'ast' } }, pine_source: SRC,
      scan_refusal: { gate: 'withheld', detail: 'the sweep cannot answer this on any bar (time-clock:unreadable): it reads a period\'s time' },
    }
    const { status } = statusOf(SRC, { savedRow })
    expect(status.saved).toEqual({ held: false, scan: { gate: 'withheld', detail: savedRow.scan_refusal.detail } })
    const by = byId(status)
    for (const id of ['alerts', 'screener', 'scans']) {
      expect(by[id].family, id).not.toBe('held')
      expect(by[id].why, id).not.toBe(savedRow.scan_refusal.detail)
    }
  })

  it('a served refusal NEVER replaces the live report-lane answer; it is shown only while the editor holds that version\'s script', () => {
    const savedRow = { definition: { compute: { kind: 'ast' } }, pine_source: SRC, scan_refusal: { gate: 'yields', detail: 'the saved screen returns a number' } }
    const same = statusOf(SRC, { savedRow }).status
    expect(byId(same).screener.ok).toBe(true)
    expect(byId(same).screener.works).toEqual(['Up'])
    expect(same.saved.scan.detail).toBe(savedRow.scan_refusal.detail)
    // edited text: the served sentence describes a script that is not on screen
    const edited = `${SRC}\n// edited`
    expect(statusOf(edited, { savedRow }).status.saved).toBeNull()
    // a row that carries no script of its own (a formula document) describes no text in the editor
    expect(savedVersion({ definition: { compute: { kind: 'ast' } }, scan_refusal: savedRow.scan_refusal }, SRC)).toBeNull()
  })

  it('a runtime document\'s served refusal is always the `kind` gate: screens still answer from the report lane', () => {
    const kind = { gate: 'kind', detail: "compute.kind is 'runtime'; a scan is a tree this lane can walk, so only 'ast' is scannable." }
    const runtimeRow = { definition: { compute: { kind: 'runtime', source: SRC } }, scan_refusal: kind }
    const { status } = statusOf(SRC, { savedRow: runtimeRow })
    const by = byId(status)
    for (const id of ['screener', 'scans']) {
      expect(by[id].ok, id).toBe(true)
      expect(by[id].works, id).toEqual(['Up'])
    }
    // its own script is its `compute.source`, so the line is shown, labelled as the saved version
    expect(status.saved).toEqual({ held: false, scan: kind })
  })

  it('no pane: the chart and alerts carry the pane\'s own reason; screens answer from the report alone', () => {
    const rows = runsOn({ ok: false, reason: 'this script declares nothing a chart can draw', guard: null })
    expect(rows.every((r) => r.ok === false)).toBe(true)
    for (const id of ['chart', 'alerts']) expect(rows.find((r) => r.id === id).why).toBe('this script declares nothing a chart can draw')
  })

  it('"Not yet" names the chart door\'s own refusal before a screener-lane refusal', () => {
    const rep = {
      ok: true, dialect: 'pine', outcome: { verdict: 'partial', missing: [], semantic: [] }, ignored: [],
      outputs: [{ kind: 'plot', line: 3, formula: null, refusal: { guard: 'pine:builtin', message: 'no such built-in' } }],
    }
    const status = editorStatus({ report: rep, pane: { ok: false, guard: 'pine:request', reason: 'another symbol at 60' } })
    expect(status.state).toBe(PANEL_STATE.NOT_YET)
    expect(status.headline).toBe('Not yet: Data from another symbol or timeframe')
  })
})

describe('the runtime lane withholds what ITS document does not draw', () => {
  // the shape `memberPaneDefinition.js::runtimeLaneDefinition` returns
  const runtimePane = () => ({
    ok: true, lane: 'runtime', requirementTags: [], withheld: ['Fast'],
    definition: {
      plots: [{ key: 'value', label: 'Slow' }], compute: { kind: 'runtime' },
      paints: [{ kind: 'barcolor', line: 4, colorMode: 'column:value_2' }],
    },
    translation: {
      outputs: [{ kind: 'plot', title: 'Slow', line: 3, formula: 'x' }, { kind: 'plot', title: 'Fast', line: 6, formula: null }],
      presentation: {
        paints: [
          // the host lane withheld its colour; the run computes it, and the document draws it
          { kind: 'barcolor', line: 4, withheld: { code: 'paint:colour', reason: 'its colour changes bar by bar' } },
          // the host lane withheld it for its offset, and so does the runtime document
          { kind: 'bgcolor', line: 5, withheld: { code: 'paint:offset', reason: 'its offset is not a number' } },
        ],
      },
    },
    notes: [
      { name: 'Drawn bar by bar', note: 'This script is drawn by running it bar by bar.' },
      { name: 'Fast', note: '`Fast` is not drawn: it is drawn away from its own bar. Nothing is drawn for it rather than a guess.' },
      { name: '`bgcolor` (line 5)', note: '`bgcolor` (line 5) is not drawn: its offset is not a number, as the run sees it.' },
    ],
  })

  it('a paint the runtime document draws is not withheld; one it does not is, in the document\'s own words', () => {
    const items = editorStatus({ report: { ok: true, dialect: 'pine', outputs: [], outcome: { semantic: [] } }, pane: runtimePane() }).items
    const paints = items.filter((x) => x.kind === 'paint')
    expect(paints).toHaveLength(1)
    expect(paints[0]).toMatchObject({ severity: SEVERITY.WITHHELD, name: '`bgcolor`', line: 5,
      reason: '`bgcolor` (line 5) is not drawn: its offset is not a number, as the run sees it.' })
  })

  it('a row the runtime document does not draw is a withheld value on its line, its disclosure not repeated', () => {
    const items = editorStatus({ report: { ok: true, dialect: 'pine', outputs: [], outcome: { semantic: [] } }, pane: runtimePane() }).items
    const row = items.find((x) => x.name === 'Fast')
    expect(row).toMatchObject({ severity: SEVERITY.WITHHELD, line: 6 })
    expect(row.reason).toMatch(/^`Fast` is not drawn: /)
    expect(items.filter((x) => x.reason === row.reason)).toHaveLength(1)
  })
})

describe('the report lane names what it cannot use', () => {
  it('a translated output the formula lane cannot evaluate is named, never a yes', () => {
    const rep = {
      ok: true, dialect: 'pine', outcome: { semantic: [] },
      outputs: [{ kind: 'plot', title: 'Gap', line: 3, formula: 'gap(close)', ast: { type: 'call', name: 'gap', args: [] },
        downstream: { ok: false, guard: 'resolve:function', error: 'unknown function "gap"' } }],
    }
    const by = Object.fromEntries(runsOn(null, { report: rep }).map((r) => [r.id, r]))
    expect(by.screener.ok).toBe(false)
    expect(by.screener.refused).toEqual([{ name: 'Gap', guard: 'resolve:function', family: 'unknown', why: 'unknown function "gap"' }])
    expect(by.alerts.ok).toBe(false)
  })
})

describe('stillWorksText', () => {
  it('one clause per list, the consumers that share a list share the clause', () => {
    expect(stillWorksText({ plots: 1, drawings: true, alerts: ['A', 'B'], screener: ['B'], scans: ['B'] }))
      .toBe('What still works: 1 plot and its drawings on the chart; A and B in alerts; B in screens and scans.')
    expect(stillWorksText({ plots: 0, drawings: false, alerts: ['X'], screener: ['X'], scans: ['X'] }))
      .toBe('What still works: X in alerts, screens and scans.')
    expect(stillWorksText({ plots: 0, drawings: false, alerts: ['A', 'B', 'C', 'D', 'E'], screener: [], scans: [] }))
      .toBe('What still works: A, B, C and 2 more in alerts.')
    expect(stillWorksText(null)).toBe('Nothing else runs yet.')
  })
})

describe('the chart door\'s own refusals and drawings', () => {
  it('the chart door refuses two plots: each is a withheld value on its own line, not only the first', () => {
    const src = ['//@version=6', 'indicator("two")', 'plot(foo.bar(close), "A")', 'plot(baz.qux(close), "B")'].join('\n')
    const { pane, status } = statusOf(src)
    const refused = (pane.translation.outputs || []).filter((o) => o && !o.formula)
    expect(refused, 'control: the chart door refuses both plots').toHaveLength(2)
    expect(withheldOf(status).map((x) => x.line).sort()).toEqual([3, 4])
  })

  it('a drawing program that lost a removal is ONE withheld value, from the chart door, its note not repeated', () => {
    const src = ['//@version=6', 'indicator("withheld", overlay = true)', 'var label lb = label.new(bar_index, high, "x")',
      'if weird_unreadable_fn(close)', '    label.delete(lb)', 'plot(close)'].join('\n')
    const { pane, status } = statusOf(src)
    expect(pane.ok, 'control: the chart door draws the plot and withholds the drawing').toBe(true)
    const lost = status.items.filter((x) => x.guard === 'pine:object-removal-lost')
    expect(lost).toHaveLength(1)
    expect(lost[0]).toMatchObject({ severity: SEVERITY.WITHHELD, kind: 'part', family: 'drawing' })
    expect(status.items.filter((x) => x.reason === lost[0].reason)).toHaveLength(1)
  })

  it('a runtime document owns the facts about its drawings: the host program\'s lost removal is not a withheld part', () => {
    const translation = {
      outputs: [], notes: [], presentation: {}, objects: { ops: [{ k: 'create', family: 'label' }] },
      objectDiagnostics: { attemptedOps: 1, droppedOps: 0, unsupported: ['label.delete'] },
    }
    const host = { ok: true, requirementTags: [], definition: { plots: [{ key: 'value' }] }, notes: [], translation }
    const runtime = { ...host, lane: 'runtime', definition: { plots: [{ key: 'value' }], compute: { kind: 'runtime' } } }
    const report = { ok: true, dialect: 'pine', outputs: [], outcome: { semantic: [] } }
    // control: the same translation behind the host lane is a withheld part
    expect(editorStatus({ report, pane: host }).items.some((x) => x.guard === 'pine:object-removal-lost')).toBe(true)
    expect(editorStatus({ report, pane: runtime }).items.some((x) => x.guard === 'pine:object-removal-lost')).toBe(false)
  })

  it('a runtime document that SAYS it holds the host drawing program back for a lost removal: ONE withheld part', () => {
    const src = ['//@version=6', 'indicator("withheld", overlay = true)', 'var label lb = label.new(bar_index, high, "x")',
      'if weird_unreadable_fn(close)', '    label.delete(lb)', 'plot(close)'].join('\n')
    const { report, pane: host, status } = statusOf(src)
    expect(status.items.some((x) => x.guard === 'pine:object-removal-lost'), 'control: the host lane withholds the program').toBe(true)
    // the disclosure `runtimeLaneDefinition` writes when it keeps the host program back
    // (`objectLossNote(objectsGate.loss, {withheld: !objectsGate.draw})`), over the same translation
    const note = objectLossNote(assessObjectLoss(host.translation), { withheld: true })
    expect(note && note.note, 'control: the translation lost a removal').toBeTruthy()
    const runtime = { ...host, lane: 'runtime', withheld: [], definition: { ...host.definition, compute: { kind: 'runtime' } },
      notes: [note, { name: 'Drawn bar by bar', note: 'This script is drawn by running it bar by bar.' }] }
    const items = editorStatus({ report, pane: runtime }).items
    const parts = items.filter((x) => x.guard === 'pine:object-removal-lost')
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ severity: SEVERITY.WITHHELD, kind: 'part', family: 'drawing', reason: note.note })
    // one fact, one item: the disclosure is not listed again as a note
    expect(items.filter((x) => x.reason === note.note)).toHaveLength(1)
  })

  it('a dirty objects-only program is refused for its lost removal: that is the item, not the screening fact', () => {
    const pane = {
      ok: false, reason: 'its drawings delete things this chart cannot read', guard: 'pine:object-removal-lost',
      translation: { outputs: [], refusal: { guard: 'pine:objects-only', message: 'nothing to filter a scan on' } },
    }
    const items = editorStatus({ report: { ok: false, dialect: 'pine', outputs: [], outcome: { semantic: [] } }, pane }).items
    expect(items.map((x) => [x.kind, x.guard, x.reason])).toEqual([
      ['chart', 'pine:object-removal-lost', 'its drawings delete things this chart cannot read'],
    ])
  })
})

describe('the report lane offers what "Use this formula" offers', () => {
  const yesNo = parseFormula('close > open').ast

  it('nothing while the report is not ok (the box offers no column), whatever its outputs hold', () => {
    expect(yesNo && yesNo.type, 'control: a real tree').toBeTruthy()
    const rep = { ok: false, dialect: 'pine', refusal: null, outcome: { semantic: [] },
      outputs: [{ kind: 'plot', title: 'Up', line: 3, formula: 'close > open', ast: yesNo }] }
    const by = Object.fromEntries(runsOn(null, { report: rep }).map((r) => [r.id, r]))
    expect(by.screener.ok).toBe(false)
    expect(by.alerts.ok).toBe(false)
    // control: the same report, ok, offers it
    const okBy = Object.fromEntries(runsOn(null, { report: { ...rep, ok: true } }).map((r) => [r.id, r]))
    expect(okBy.screener.works).toEqual(['Up'])
  })

  it('a hidden output is not offered (the box offers formula AND not hidden), nor one with no tree to type', () => {
    const rep = { ok: true, dialect: 'pine', outcome: { semantic: [] }, outputs: [
      { kind: 'plot', title: 'Anchor', line: 3, formula: 'close > open', ast: yesNo, hidden: true },
      { kind: 'plot', title: 'Bare', line: 4, formula: 'close > open' },
    ] }
    const by = Object.fromEntries(runsOn(null, { report: rep }).map((r) => [r.id, r]))
    expect(by.screener.ok).toBe(false)
    expect(by.alerts.ok).toBe(false)
  })

  it('a requirement tag on the saved document refuses it there, by the manifest\'s roster', () => {
    const tagged = parseFormula('cum(volume) > 0').ast
    expect(tagged && tagged.type, 'control: a real tree').toBeTruthy()
    const rep = { ok: true, dialect: 'pine', outcome: { semantic: [] },
      outputs: [{ kind: 'plot', title: 'Acc', line: 3, formula: 'cum(volume) > 0', ast: tagged }] }
    const by = Object.fromEntries(runsOn(null, { report: rep }).map((r) => [r.id, r]))
    for (const id of ['alerts', 'screener', 'scans']) {
      expect(by[id].ok, id).toBe(false)
      expect(by[id].why, id).toMatch(/`cum`/)
    }
  })
})

describe('the chart row is the chart door\'s OWN verdict, never re-asked with a context the door did not use', () => {
  const OTHER = [
    ['`AMEX:SPY`', '//@version=5\nindicator("c26", overlay=true)\nplot(request.security("AMEX:SPY", timeframe.period, close), "spy")'],
    // C29: the bare spelling is served too (vendorHarness.c26OtherSymbol.test.js)
    ['bare `SPY`', '//@version=5\nindicator("c26", overlay=true)\nplot(request.security("SPY", timeframe.period, close), "spy")'],
  ]
  for (const [what, src] of OTHER) {
    it(`${what}: the chart door draws the other-symbol plot, so the chart reads OK`, () => {
      const { pane, status } = statusOf(src)
      expect(pane.ok, 'control: the chart door draws it').toBe(true)
      // control: asked again with an EMPTY binding context, the chart lane refuses it, so
      // this rail can see a re-asked chart row
      const key = pane.definition.plots.find((p) => !p.hidden).key
      expect(evaluability(pane.definition, key, LANES.CHART, {}).status).toBe('refused')
      const by = byId(status)
      expect(by.chart.ok).toBe(true)
      expect(by.chart.count).toBe(1)
      expect(status.state).not.toBe(PANEL_STATE.RUNS_ELSEWHERE)
      expect(status.headline).not.toMatch(/chart cannot draw/)
      expect(JSON.stringify(status)).not.toMatch(/not a listing our bar store holds|names no exchange/)
    })
  }

  it('a mixed script: the other-symbol plot and the chart\'s own plots are all drawn', () => {
    const src = '//@version=5\nindicator("mix", overlay=true)\nplot(request.security("AMEX:SPY", timeframe.period, close), "spy")\n'
      + 'plot(close, "c")\nplot(close > open ? 1 : 0, "Up")'
    const { pane, status } = statusOf(src)
    expect(pane.ok, 'control').toBe(true)
    const by = byId(status)
    expect(by.chart.ok).toBe(true)
    expect(by.chart.count).toBe(3)
    expect(stillWorksText(status.stillWorks)).toMatch(/^What still works: 3 plots on the chart;/)
    expect(by.screener.works).toContain('Up')
  })

  it('a script the chart door refuses: the chart row is the door\'s own refusal, verbatim', () => {
    const { pane, status } = statusOf(SCRIPTS.request)
    expect(pane.ok, 'control: the chart door refuses it').toBe(false)
    const by = byId(status)
    expect(by.chart.ok).toBe(false)
    expect(by.chart.why).toBe(pane.reason)
  })

  it('an ok pane is a drawn chart even with no visible plot: never [--], never "Not supported yet"', () => {
    const report = inspectSource(SCRIPTS.alertOnly, 'auto')
    // the door said yes; what it draws beyond plots is the door's business
    const pane = { ok: true, requirementTags: [], notes: [], definition: { plots: [{ key: 'value', hidden: true }] } }
    const status = editorStatus({ report, pane })
    expect(byId(status).chart.ok).toBe(true)
    expect(status.state).not.toBe(PANEL_STATE.RUNS_ELSEWHERE)
    expect(status.headline).not.toMatch(new RegExp(UNKNOWN_FAMILY.label))
  })
})

describe('the Pine tab\'s attach is a screen route too (the chart door\'s host document)', () => {
  const ATTACH = '//@version=5\nstrategy("X")\nplotshape(ta.crossover(close, ta.sma(close, 20)), "Long")'

  it('strategy + plotshape: the report offers nothing, the attach route stores a screen', () => {
    const { report, pane, status } = statusOf(ATTACH)
    expect(report.ok, 'control: the report lane refuses a strategy').toBe(false)
    expect(pane.ok && pane.definition.compute.kind, 'control: a host document').toBe('ast')
    const by = byId(status)
    for (const id of ['screener', 'scans']) {
      expect(by[id].ok, id).toBe(true)
      expect(by[id].works, id).toEqual(['Long'])
    }
    expect(stillWorksText(status.stillWorks)).toMatch(/Long in alerts, screens and scans\.$/)
  })

  it('the server screens the document\'s SCAN plot alone: a number first and a condition second is no screen', () => {
    const src = '//@version=5\nstrategy("X")\nplot(ta.sma(close, 20), "SMA")\nplotshape(ta.crossover(close, ta.sma(close, 20)), "Long")'
    const { pane, status } = statusOf(src)
    const keys = pane.definition.plots.filter((p) => !p.hidden).map((p) => p.key)
    // control: the scan plot is the number, and the second row IS a condition the scan lane takes
    expect(pane.definition.compute.scanPlot).toBe(keys[0])
    expect(evaluability(pane.definition, keys[1], LANES.SCAN, {}).status).toBe('supported')
    expect(byId(status).screener.ok).toBe(false)
  })

  const condTree = parseFormula('close > open').ast
  const numTree = parseFormula('close').ast
  const hostPane = (over = {}) => ({
    ok: true, lane: undefined, requirementTags: [], notes: [], translation: { outputs: [] },
    definition: {
      compute: { kind: 'ast', ast: condTree, trees: { value: condTree, out2: numTree }, scanPlot: 'value' },
      plots: [{ key: 'value', label: 'Up' }, { key: 'out2', label: 'C' }],
    },
    ...over,
  })
  const none = { ok: true, dialect: 'pine', outputs: [], outcome: { semantic: [] } }

  it('control: a shown condition scan plot is a screen through the attach route alone', () => {
    expect(condTree && condTree.type, 'control: a real tree').toBeTruthy()
    const by = Object.fromEntries(runsOn(hostPane(), { report: none }).map((r) => [r.id, r]))
    expect(by.screener.ok).toBe(true)
    expect(by.screener.works).toEqual(['Up'])
  })

  it('a HIDDEN scan plot answers for no consumer', () => {
    const p = hostPane()
    p.definition.plots[0].hidden = true
    const by = Object.fromEntries(runsOn(p, { report: none }).map((r) => [r.id, r]))
    expect(by.screener.ok).toBe(false)
  })

  it('a requirement tag the manifest refuses for screens refuses the attach route there', () => {
    const by = Object.fromEntries(runsOn(hostPane({ requirementTags: ['window_dependent'] }), { report: none }).map((r) => [r.id, r]))
    for (const id of ['screener', 'scans']) {
      expect(by[id].ok, id).toBe(false)
      expect(by[id].why, id).toMatch(/history is loaded/)
    }
  })

  it('a runtime document is no screen through the attach route (the server\'s `kind` gate), and lends no reason', () => {
    const rt = { ok: true, lane: 'runtime', requirementTags: [], notes: [], definition: { plots: [{ key: 'value', label: 'V' }], compute: { kind: 'runtime' } } }
    const by = Object.fromEntries(runsOn(rt, { report: none, evaluate: () => ({ status: 'supported' }) }).map((r) => [r.id, r]))
    expect(by.screener.ok).toBe(false)
    expect(by.screener.why).toBeNull()
  })
})

describe('a number the box\'s threshold control can make a screen of reads "needs a threshold"', () => {
  it('RSI: [--] on screens (the evaluability sentence stands), worded as needing a threshold', () => {
    const { status } = statusOf(SCRIPTS.rsi)
    const by = byId(status)
    for (const id of ['screener', 'scans']) {
      expect(by[id].ok, id).toBe(false)
      expect(by[id].threshold, id).toEqual(['RSI'])
      expect(by[id].thresholdWhy, id).toBe('Needs a threshold: give RSI a comparison (the control above Use this formula) to make it a screen.')
      expect(by[id].why, id).toBe('A screen keeps the symbols where a yes/no is true; this output is not a yes/no.')
    }
  })

  it('control: no threshold where the box offers no column (a refused report), or a tag refuses the screen', () => {
    expect(byId(statusOf(SCRIPTS.strategy).status).screener.threshold).toBeUndefined()
    const tagged = parseFormula('cum(volume)').ast
    expect(tagged && tagged.type, 'control: a real tree').toBeTruthy()
    const rep = { ok: true, dialect: 'pine', outcome: { semantic: [] },
      outputs: [{ kind: 'plot', title: 'Acc', line: 3, formula: 'cum(volume)', ast: tagged }] }
    const by = Object.fromEntries(runsOn(null, { report: rep }).map((r) => [r.id, r]))
    expect(by.screener.ok).toBe(false)
    expect(by.screener.threshold).toBeUndefined()
    expect(by.screener.why).toMatch(/`cum`/)
  })
})

describe('a runtime document that draws only its own objects (RT5)', () => {
  const RT5 = '//@version=6\nindicator("t", overlay = true)\nvar float acc = 0\nacc += close\nif bar_index % 50 == 0\n'
    + '    label.new(bar_index, close, str.tostring(acc, "#"))\n'

  it('the chart reads OK and "What still works" names its drawings', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const { pane, status } = statusOf(RT5)
    expect(pane.lane, 'control: the runtime lane draws it').toBe('runtime')
    expect(pane.definition.compute.objects, 'control: its own run makes the drawings').toBe(true)
    expect(byId(status).chart.ok).toBeTruthy()
    expect(status.stillWorks.drawings).toBe(true)
    expect(stillWorksText(status.stillWorks)).toMatch(/^What still works: its drawings on the chart/)
  })
})

describe('the runtime lane\'s own disclosure of the calls it never draws is a withheld value per call', () => {
  // a real chart-door translation with a fill between two plots (the host lane carries the band)
  const FILL = '//@version=6\nindicator("f")\np1 = plot(ta.sma(close, 10), "A")\np2 = plot(ta.sma(close, 20), "B")\n'
    + 'fill(p1, p2, color = color.new(color.blue, 80))'
  const said = (what) => ({ name: RUNTIME_UNDRAWN_NOTE,
    note: `This script also writes ${what}, which a script drawn bar by bar does not draw here yet. Its lines are drawn; those are not.` })
  const runtimeOf = (host, notes) => ({ ...host, lane: 'runtime', withheld: [],
    definition: { ...host.definition, compute: { kind: 'runtime' } }, notes })

  it('the name and the phrases are the door\'s own (memberPaneDefinition.js)', () => {
    const door = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'memberPane', 'memberPaneDefinition.js'), 'utf8')
    expect(door).toContain(`name: '${RUNTIME_UNDRAWN_NOTE}'`)
    // train (EDITOR-E2 x W4-T13): W4-T13 draws plotcandle / plotbar from the run, so the door no longer
    // lists them in RUNTIME_UNDRAWN_KINDS. editorStatus.js keeps reading the 'candles' / 'bars' phrases
    // because a runtime document saved before that engine still carries the old note until re-translated.
    for (const phrase of ["fill: 'a fill between two plots'", "hline: 'a horizontal line'"]) {
      expect(door, phrase).toContain(phrase)
    }
  })

  it('a fill the runtime document says it does not draw: ONE withheld value on the fill\'s line, its words', () => {
    const { report, pane: host } = statusOf(FILL)
    expect(host.ok, 'control: the chart door reads the script').toBe(true)
    const fillLine = (host.translation.notes || []).find((n) => n && n.code === 'pine:chart-only' && n.message.startsWith('`fill`'))
    expect(fillLine && fillLine.line, 'control: the translation locates the fill').toBe(5)
    const note = said('a fill between two plots')
    const status = editorStatus({ report, pane: runtimeOf(host, [{ name: 'Drawn bar by bar', note: 'drawn bar by bar.' }, note]) })
    const undrawn = status.items.filter((x) => x.kind === 'undrawn')
    expect(undrawn).toHaveLength(1)
    expect(undrawn[0]).toMatchObject({ severity: SEVERITY.WITHHELD, name: '`fill`', line: 5, reason: note.note, family: 'presentation' })
    // one fact, one item: the disclosure is not also a note
    expect(status.items.filter((x) => x.reason === note.note)).toHaveLength(1)
    expect(lineMarks(status, FILL).marks.find((m) => m.line === 5)).toMatchObject({ severity: SEVERITY.WITHHELD })
    expect(byId(status).chart.ok).toBe('partial')
  })

  const runtimeOn = () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  }

  it('real door: a runtime document that does not draw its fill: ONE withheld value on the fill\'s line, in its words', () => {
    runtimeOn()
    const src = '//@version=6\nindicator("r")\nvar float acc = 0\nacc += close\np1 = plot(acc, "Acc")\np2 = plot(acc * 0.9, "Lo")\n'
      + 'fill(p1, p2, color = color.new(color.blue, 80))'
    const { pane, status } = statusOf(src)
    expect(pane.lane, 'control: the runtime lane draws it').toBe('runtime')
    const own = pane.notes.find((n) => n.name === RUNTIME_UNDRAWN_NOTE)
    expect(own && own.note, 'control: the document says it does not draw the fill').toMatch(/a fill between two plots/)
    const fills = status.items.filter((x) => x.name === '`fill`')
    expect(fills).toHaveLength(1)
    expect(fills[0]).toMatchObject({ severity: SEVERITY.WITHHELD, line: 7, reason: own.note, family: 'presentation' })
    expect(status.items.some((x) => x.kind === 'pane-note' && x.reason === own.note)).toBe(false)
  })

  it('real door: a level the chart door never draws, on either lane, is a withheld value on its line, the door\'s own note', () => {
    const host = statusOf('//@version=6\nindicator("h")\nplot(ta.rsi(close, 14), "RSI")\nhline(70, "OB")').status
    const levels = host.items.filter((x) => x.name === '`hline`')
    expect(levels).toHaveLength(1)
    expect(levels[0]).toMatchObject({ severity: SEVERITY.WITHHELD, line: 4, guard: 'pine:chart-only' })
    expect(levels[0].reason).toMatch(/^`hline` is not drawn on this chart/)
    expect(host.headline).toBe('Runs on the chart and in alerts, 1 value withheld (not guessed)')
    // the runtime lane: its document carries no level either, and says nothing of one
    runtimeOn()
    const { pane, status } = statusOf('//@version=6\nindicator("r")\nvar float acc = 0\nacc += close\nplot(acc, "Acc")\nhline(50, "Mid")')
    expect(pane.lane, 'control: the runtime lane draws it').toBe('runtime')
    expect(status.items.filter((x) => x.name === '`hline`').map((x) => x.line)).toEqual([6])
  })

  it('real door: a band between two levels is not carried; a band between two plots is (control)', () => {
    const src = '//@version=6\nindicator("b")\nplot(ta.rsi(close, 14), "RSI")\nh1 = hline(70)\nh2 = hline(30)\nfill(h1, h2)'
    const undrawn = statusOf(src).status.items.filter((x) => x.kind === 'undrawn')
      .map((x) => [x.name, x.line]).sort((a, b) => a[1] - b[1])
    expect(undrawn).toEqual([['`hline`', 4], ['`hline`', 5], ['`fill`', 6]])
    // control: the band between two plots IS carried, so nothing is withheld for it
    expect(statusOf(FILL).status.items.some((x) => x.kind === 'undrawn')).toBe(false)
  })

  it('control: no disclosure, nothing withheld; a kind it names that the translation cannot locate is one item for the script', () => {
    const { report, pane: host } = statusOf(FILL)
    expect(editorStatus({ report, pane: runtimeOf(host, []) }).items.some((x) => x.kind === 'undrawn')).toBe(false)
    const candles = editorStatus({ report, pane: runtimeOf(host, [said('candles')]) }).items.filter((x) => x.kind === 'undrawn')
    expect(candles.map((x) => [x.name, x.line])).toEqual([['`plotcandle`', null]])
  })
})
