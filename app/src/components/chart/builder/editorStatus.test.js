// The editor status panel's data, through the REAL doors: `inspectSource` (the
// report PasteBox holds) and `memberPaneDefinition` (what a chart draws), so a
// change in either reader shows here rather than in a hand-made fixture.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { inspectSource } from './PineBox'
import { paneFor } from './PineEditorStatus'
import {
  editorStatus, PANEL_STATE, SEVERITY, runsOn, stillWorksText, FAMILIES, UNKNOWN_FAMILY,
} from './editorStatus'
import { SCRIPT_ENGINE_VERSION } from '../engine/scriptEngineVersion'

afterEach(() => { vi.unstubAllEnvs() })

const v6 = (...body) => ['//@version=6', 'indicator("probe")', 'up = close > open', ...body].join('\n')

const SCRIPTS = {
  runs: `//@version=6
indicator("RSI Swing")
len = input.int(14, "Length")
r = ta.rsi(close, len)
plot(r, "RSI")
plot(r > 70 ? 1 : 0, "OB")`,
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
}

const statusOf = (src) => {
  const report = inspectSource(src, 'auto')
  const pane = paneFor(report, src)
  return { report, pane, status: editorStatus({ report, pane }) }
}
const byId = (status) => Object.fromEntries(status.runsOn.map((r) => [r.id, r]))

describe('editorStatus through the real doors', () => {
  it('a script that translates whole runs fully, everywhere it can', () => {
    const { status } = statusOf(SCRIPTS.runs)
    expect(status.state).toBe(PANEL_STATE.RUNS)
    expect(status.headline).toBe('Runs fully')
    expect(status.lane).toBe('host')
    const by = byId(status)
    expect(by.chart.ok).toBe(true)
    expect(by.alerts.ok).toBe(true)
    // the 0/1 plot makes it a screen and a scan
    expect(by.screener.ok).toBe(true)
    expect(by.scans.ok).toBe(true)
    expect(stillWorksText(status.stillWorks)).toBe('What still works: 2 plots.')
  })

  it('an other-symbol intraday line is withheld, on ITS line, under the request family', () => {
    const { report, status } = statusOf(SCRIPTS.request)
    const w = status.items.filter((x) => x.severity === SEVERITY.WITHHELD)
    expect(w.length).toBeGreaterThan(0)
    const req = w.find((x) => x.family === 'request')
    expect(req).toBeTruthy()
    expect([5, 6]).toContain(req.line)
    // the engine sentence is carried verbatim
    const refused = report.outputs.find((o) => !o.formula)
    expect(req.reason).toBe(refused.refusal.message)
    if (status.state !== PANEL_STATE.NOT_YET) {
      expect(status.state).toBe(PANEL_STATE.RUNS_WITHHELD)
      expect(status.headline).toMatch(/^Runs, \d+ values? withheld \(not guessed\)$/)
    }
  })

  it('a strategy names its orders and backtest as withheld', () => {
    const { status } = statusOf(SCRIPTS.strategy)
    expect(status.items.some((x) => x.family === 'strategy' && x.severity === SEVERITY.WITHHELD)).toBe(true)
  })

  it('a strategy the report refuses is still drawn by the chart door: chart runs, screens say why', () => {
    const { report, pane, status } = statusOf(SCRIPTS.strategy)
    expect(report.ok).toBe(false)
    expect(report.refusal.guard).toBe('pine:declaration-strategy')
    expect(pane && pane.ok).toBe(true)
    const by = byId(status)
    expect(by.chart.ok).toBeTruthy()
    expect(status.state).not.toBe(PANEL_STATE.NOT_YET)
    // the report's refusal is a SCREENING fact, verbatim, on the screener and scans rows
    for (const id of ['screener', 'scans']) {
      expect(by[id].ok).toBe(false)
      expect(by[id].why).toBe(report.refusal.message)
    }
    // ...and never a withheld value
    expect(status.items.some((x) => x.guard === 'pine:declaration-strategy')).toBe(false)
    expect(stillWorksText(status.stillWorks)).toBe('What still works: 1 plot.')
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
    expect(stillWorksText(status.stillWorks)).toBe('What still works: its drawings.')
  })

  it('a paint-only overlay is drawn by the chart door, and its paint counts as a drawing', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const { report, status } = statusOf(SCRIPTS.paintOnly)
    expect(report.refusal.guard).toBe('pine:no-output')
    const by = byId(status)
    expect(by.chart.ok).toBe(true)
    expect(by.screener.why).toBe(report.refusal.message)
    expect(stillWorksText(status.stillWorks)).toBe('What still works: its drawings.')
  })

  it('a script with nothing runnable reads "Not yet: <family label>", the label as written', () => {
    const { status } = statusOf(SCRIPTS.nothing)
    expect(status.state).toBe(PANEL_STATE.NOT_YET)
    expect([...FAMILIES, UNKNOWN_FAMILY].map((f) => `Not yet: ${f.label}`)).toContain(status.headline)
    expect(status.runsOn.every((r) => !r.ok)).toBe(true)
    expect(stillWorksText(status.stillWorks)).toBe('Nothing else runs yet.')
  })

  it('an engine error is the engine-fault state, never a verdict about the script', () => {
    const status = editorStatus({ report: { ok: false, dialect: 'pine', outputs: [], error: 'boom', outcome: { verdict: 'error', missing: [], semantic: [] } } })
    expect(status.state).toBe(PANEL_STATE.ENGINE_ERROR)
    expect(status.headline).toMatch(/not your script/)
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
    expect(status.headline).toBe('Runs, with 1 note')
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
    expect(status.headline).toBe('Runs, with 1 note')
  })

  it('a paint the chart door withholds is ONE withheld value, on its line, not also a note', () => {
    const { pane, status } = statusOf(SCRIPTS.paintWithheld)
    const paint = pane.translation.presentation.paints.find((p) => p && p.withheld)
    const items = status.items.filter((x) => x.kind === 'paint')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ severity: SEVERITY.WITHHELD, name: '`barcolor`', line: 4, reason: paint.withheld.reason })
    expect(status.items.some((x) => x.kind === 'pane-note' && x.reason.includes(paint.withheld.reason))).toBe(false)
    expect(status.headline).toBe('Runs, 1 value withheld (not guessed)')
  })
})

describe('runsOn', () => {
  const pane = { ok: true, lane: undefined, requirementTags: [], definition: { plots: [{ key: 'value' }] } }
  const yes = () => ({ status: 'supported' })

  it('a runtime-lane document runs on the chart only, and says why by name', () => {
    const rows = runsOn({ ...pane, lane: 'runtime' }, null, { evaluate: yes })
    expect(rows.map((r) => [r.id, r.ok])).toEqual([['chart', true], ['alerts', false], ['screener', false], ['scans', false]])
    expect(rows[1].why).toMatch(/server, which cannot run the bar-by-bar engine yet/)
  })

  it('a requirement tag the manifest refuses for a consumer refuses that consumer (roster from closedTable)', () => {
    const rows = runsOn({ ...pane, requirementTags: ['window_dependent'] }, null, { evaluate: yes })
    expect(rows.find((r) => r.id === 'chart').ok).toBe(true)
    for (const id of ['alerts', 'screener', 'scans']) {
      const r = rows.find((x) => x.id === id)
      expect(r.ok).toBe(false)
      expect(r.why).toMatch(/`cum`/)
    }
  })

  it('a saved version the script engine refused is held on every server lane, with the engine\'s reason', () => {
    const savedRow = {
      definition: { compute: { kind: 'ast' } },
      engine_status: { engine: SCRIPT_ENGINE_VERSION, status: 'refused', reason: 'the strategy call cannot be translated' },
      scan_refusal: { gate: 'withheld', detail: 'engine-refused: today\'s script engine refuses this script' },
    }
    const rows = runsOn(pane, savedRow, { evaluate: yes })
    expect(rows.find((r) => r.id === 'chart').ok).toBe(true)
    for (const id of ['alerts', 'screener', 'scans']) {
      const r = rows.find((x) => x.id === id)
      expect(r.ok).toBe(false)
      expect(r.family).toBe('held')
      expect(r.detail).toBe(savedRow.engine_status.reason)
    }
  })

  it('the sweep\'s C45 `withheld` gate is not an engine hold: its sentence shows on screens only, verbatim', () => {
    const savedRow = {
      definition: { compute: { kind: 'ast' } },
      scan_refusal: {
        gate: 'withheld',
        detail: 'the sweep cannot answer this on any bar (time-clock:unreadable): it reads a period\'s time',
      },
    }
    const rows = runsOn(pane, savedRow, { evaluate: yes })
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

  it('no pane: nothing runs, and every row carries the pane\'s own reason', () => {
    const rows = runsOn({ ok: false, reason: 'this script declares nothing a chart can draw', guard: null })
    expect(rows.every((r) => r.ok === false)).toBe(true)
    for (const r of rows) expect(r.why).toBe('this script declares nothing a chart can draw')
  })

  it('"Not yet" names the chart door\'s own refusal before a screener-lane refusal', () => {
    const report = {
      ok: true, dialect: 'pine', outcome: { verdict: 'partial', missing: [], semantic: [] }, ignored: [],
      outputs: [{ kind: 'plot', line: 3, formula: null, refusal: { guard: 'pine:builtin', message: 'no such built-in' } }],
    }
    const status = editorStatus({ report, pane: { ok: false, guard: 'pine:request', reason: 'another symbol at 60' } })
    expect(status.state).toBe(PANEL_STATE.NOT_YET)
    expect(status.headline).toBe('Not yet: Data from another symbol or timeframe')
  })
})
