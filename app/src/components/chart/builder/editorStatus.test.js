// The editor status panel's data, through the REAL doors: `inspectSource` (the
// report PasteBox holds) and `memberPaneDefinition` (what a chart draws), so a
// change in either reader shows here rather than in a hand-made fixture.
import { describe, it, expect } from 'vitest'
import { inspectSource } from './PineBox'
import { paneFor } from './PineEditorStatus'
import { editorStatus, PANEL_STATE, SEVERITY, runsOn, stillWorksText } from './editorStatus'

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
}

const statusOf = (src) => {
  const report = inspectSource(src, 'auto')
  return { report, status: editorStatus({ report, pane: paneFor(report, src) }) }
}

describe('editorStatus through the real doors', () => {
  it('a script that translates whole runs fully, everywhere it can', () => {
    const { status } = statusOf(SCRIPTS.runs)
    expect(status.state).toBe(PANEL_STATE.RUNS)
    expect(status.headline).toBe('Runs fully')
    expect(status.lane).toBe('host')
    const by = Object.fromEntries(status.runsOn.map((r) => [r.id, r]))
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

  it('a script with nothing runnable reads "Not yet: needs ..."', () => {
    const { status } = statusOf(SCRIPTS.nothing)
    expect(status.state).toBe(PANEL_STATE.NOT_YET)
    expect(status.headline).toMatch(/^Not yet: needs /)
    expect(status.runsOn.every((r) => !r.ok)).toBe(true)
    expect(stillWorksText(status.stillWorks)).toBe('Nothing else runs yet.')
  })

  it('an engine error is the engine-fault state, never a verdict about the script', () => {
    const status = editorStatus({ report: { ok: false, dialect: 'pine', outputs: [], error: 'boom', outcome: { verdict: 'error', missing: [], semantic: [] } } })
    expect(status.state).toBe(PANEL_STATE.ENGINE_ERROR)
    expect(status.headline).toMatch(/not your script/)
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

  it('a saved version the script engine holds is held on every server lane, verbatim', () => {
    const savedRow = { scan_refusal: { gate: 'withheld', detail: 'engine-refused: version 3 refused this script' } }
    const rows = runsOn(pane, savedRow, { evaluate: yes })
    expect(rows.find((r) => r.id === 'chart').ok).toBe(true)
    for (const id of ['alerts', 'screener', 'scans']) {
      const r = rows.find((x) => x.id === id)
      expect(r.ok).toBe(false)
      expect(r.family).toBe('held')
      expect(r.detail).toBe(savedRow.scan_refusal.detail)
    }
  })

  it('no pane: nothing runs, and the chart row carries the pane\'s own reason', () => {
    const rows = runsOn({ ok: false, reason: 'this script declares nothing a chart can draw', guard: null })
    expect(rows.every((r) => r.ok === false)).toBe(true)
    expect(rows[0].why).toBe('this script declares nothing a chart can draw')
  })
})
