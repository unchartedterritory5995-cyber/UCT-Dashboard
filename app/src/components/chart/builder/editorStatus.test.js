// The editor status panel's data, through the REAL doors: `inspectSource` (the report
// PasteBox holds: the screener lane, the one "Use this formula" saves from) and
// `memberPaneDefinition` (the chart door), so a change in either reader shows here
// rather than in a hand-made fixture. Every consumer row answers from the lane that
// consumer actually uses.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { inspectSource } from './PineBox'
import { paneFor } from './PineEditorStatus'
import {
  editorStatus, PANEL_STATE, SEVERITY, runsOn, stillWorksText, lineMarks, FAMILIES, UNKNOWN_FAMILY,
} from './editorStatus'
import { SCRIPT_ENGINE_VERSION } from '../engine/scriptEngineVersion'
import { parseFormula } from '../engine/ast/parse'

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
  fold: '//@version=5\nindicator("f")\nw = request.security(syminfo.tickerid, "W", ta.sma(close, 10))\nplot(w, "W")',
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

  it('"Runs fully" only when EVERY consumer runs: a number line says what does not', () => {
    const { status } = statusOf(SCRIPTS.rsi)
    const by = byId(status)
    expect(by.chart.ok).toBe(true)
    expect(by.alerts.ok).toBe(true)
    expect(by.screener.ok).toBe(false)
    expect(by.screener.why).toBe('A screen keeps the symbols where a yes/no is true; this output is not a yes/no.')
    expect(by.screener.subject).toBe('RSI')
    expect(status.state).toBe(PANEL_STATE.RUNS)
    expect(status.headline).toBe('Runs on the chart and in alerts; not in screens or scans')
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
    expect(status.headline).toMatch(/^Runs in alerts, screens and scans; the chart cannot draw it yet: ./)
    expect(stillWorksText(status.stillWorks)).toBe('What still works: Cross up in alerts, screens and scans.')
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
    const rows = runsOn({ ...pane, lane: 'runtime', definition: { plots: [{ key: 'value' }], compute: { kind: 'runtime' } } }, null, { report })
    const by = Object.fromEntries(rows.map((r) => [r.id, r]))
    expect(by.screener.ok).toBe(true)
    expect(by.screener.works).toEqual(['Up'])
    expect(by.alerts.ok).toBe(true)
  })

  it('a requirement tag the manifest refuses for alerts refuses the chart door\'s document there (roster from closedTable)', () => {
    const rows = runsOn({ ...pane, requirementTags: ['window_dependent'] }, null, { evaluate: yes })
    expect(rows.find((r) => r.id === 'chart').ok).toBe(true)
    const alerts = rows.find((r) => r.id === 'alerts')
    expect(alerts.ok).toBe(false)
    expect(alerts.why).toMatch(/`cum`/)
  })

  it('a saved version the script engine refused is held on every server lane, with the engine\'s reason', () => {
    const savedRow = {
      definition: { compute: { kind: 'ast' } },
      engine_status: { engine: SCRIPT_ENGINE_VERSION, status: 'refused', reason: 'the strategy call cannot be translated' },
      scan_refusal: { gate: 'withheld', detail: 'engine-refused: today\'s script engine refuses this script' },
    }
    const rows = runsOn(pane, savedRow, { evaluate: yes, report })
    expect(rows.find((r) => r.id === 'chart').ok).toBe(true)
    for (const id of ['alerts', 'screener', 'scans']) {
      const r = rows.find((x) => x.id === id)
      expect(r.ok).toBe(false)
      expect(r.family).toBe('held')
      expect(r.detail).toBe(savedRow.engine_status.reason)
    }
  })

  it('a version an OLDER engine refused, waiting for today\'s engine to translate its script again, is held too', () => {
    const stale = {
      def_id: 'u_aaaaaaaaaaaa', version: 2, pine_source: SRC,
      definition: { compute: { kind: 'ast' }, meta: { recurrenceOrigin: 'pine', engineVersion: SCRIPT_ENGINE_VERSION - 1 } },
    }
    const refused = { ...stale, engine_status: { engine: SCRIPT_ENGINE_VERSION - 1, status: 'refused', reason: 'an older engine refused it' } }
    const held = Object.fromEntries(runsOn(pane, refused, { evaluate: yes, report }).map((r) => [r.id, r]))
    for (const id of ['alerts', 'screener', 'scans']) {
      expect(held[id].family, id).toBe('held')
      expect(held[id].detail).toBe('an older engine refused it')
    }
    // control: the same stale version with no refusal recorded is not held
    const free = Object.fromEntries(runsOn(pane, stale, { evaluate: yes, report }).map((r) => [r.id, r]))
    expect(free.screener.family).not.toBe('held')
    expect(free.screener.ok).toBe(true)
  })

  it('the sweep\'s C45 `withheld` gate is not an engine hold: its sentence shows on screens only, verbatim', () => {
    const savedRow = {
      definition: { compute: { kind: 'ast' } }, pine_source: SRC,
      scan_refusal: { gate: 'withheld', detail: 'the sweep cannot answer this on any bar (time-clock:unreadable): it reads a period\'s time' },
    }
    const rows = runsOn(pane, savedRow, { evaluate: yes, report, inspectedSource: SRC })
    const by = Object.fromEntries(rows.map((r) => [r.id, r]))
    expect(by.chart.ok).toBe(true)
    expect(by.alerts.ok).toBe(true)
    expect(by.alerts.family).not.toBe('held')
    for (const id of ['screener', 'scans']) {
      expect(by[id].ok).toBe(false)
      expect(by[id].family).not.toBe('held')
      expect(by[id].why).toBe(savedRow.scan_refusal.detail)
    }
  })

  it('a served refusal answers ONLY while the editor holds that version\'s own script; edited text answers live', () => {
    const savedRow = { definition: { compute: { kind: 'ast' } }, pine_source: SRC, scan_refusal: { gate: 'yields', detail: 'the saved screen returns a number' } }
    const edited = `${SRC}\n// edited`
    const live = Object.fromEntries(runsOn(pane, savedRow, { evaluate: yes, report: inspectSource(edited, 'auto'), inspectedSource: edited }).map((r) => [r.id, r]))
    expect(live.screener.ok).toBe(true)
    expect(live.screener.why).not.toBe(savedRow.scan_refusal.detail)
    const same = Object.fromEntries(runsOn(pane, savedRow, { evaluate: yes, report, inspectedSource: SRC }).map((r) => [r.id, r]))
    expect(same.screener.why).toBe(savedRow.scan_refusal.detail)
    // a runtime document's own script is its `compute.source`
    const runtimeRow = { definition: { compute: { kind: 'runtime', source: SRC } }, scan_refusal: savedRow.scan_refusal }
    const rt = Object.fromEntries(runsOn(pane, runtimeRow, { evaluate: yes, report, inspectedSource: SRC }).map((r) => [r.id, r]))
    expect(rt.scans.why).toBe(savedRow.scan_refusal.detail)
    // a row that carries no script of its own (a formula document) describes no text in the editor
    const formulaRow = { definition: { compute: { kind: 'ast' } }, scan_refusal: savedRow.scan_refusal }
    const noScript = Object.fromEntries(runsOn(pane, formulaRow, { evaluate: yes, report }).map((r) => [r.id, r]))
    expect(noScript.screener.ok).toBe(true)
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
    const by = Object.fromEntries(runsOn(null, null, { report: rep }).map((r) => [r.id, r]))
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
    const by = Object.fromEntries(runsOn(null, null, { report: rep }).map((r) => [r.id, r]))
    expect(by.screener.ok).toBe(false)
    expect(by.alerts.ok).toBe(false)
    // control: the same report, ok, offers it
    const okBy = Object.fromEntries(runsOn(null, null, { report: { ...rep, ok: true } }).map((r) => [r.id, r]))
    expect(okBy.screener.works).toEqual(['Up'])
  })

  it('a hidden output is not offered (the box offers formula AND not hidden), nor one with no tree to type', () => {
    const rep = { ok: true, dialect: 'pine', outcome: { semantic: [] }, outputs: [
      { kind: 'plot', title: 'Anchor', line: 3, formula: 'close > open', ast: yesNo, hidden: true },
      { kind: 'plot', title: 'Bare', line: 4, formula: 'close > open' },
    ] }
    const by = Object.fromEntries(runsOn(null, null, { report: rep }).map((r) => [r.id, r]))
    expect(by.screener.ok).toBe(false)
    expect(by.alerts.ok).toBe(false)
  })

  it('a requirement tag on the saved document refuses it there, by the manifest\'s roster', () => {
    const tagged = parseFormula('cum(volume) > 0').ast
    expect(tagged && tagged.type, 'control: a real tree').toBeTruthy()
    const rep = { ok: true, dialect: 'pine', outcome: { semantic: [] },
      outputs: [{ kind: 'plot', title: 'Acc', line: 3, formula: 'cum(volume) > 0', ast: tagged }] }
    const by = Object.fromEntries(runsOn(null, null, { report: rep }).map((r) => [r.id, r]))
    for (const id of ['alerts', 'screener', 'scans']) {
      expect(by[id].ok, id).toBe(false)
      expect(by[id].why, id).toMatch(/`cum`/)
    }
  })
})
