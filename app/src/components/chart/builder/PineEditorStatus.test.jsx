// The editor status panel: the component, its touch Sheet, and its wire into the
// Pine tab's paste box behind VITE_PINE_EDITOR_STATUS.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'

const touch = vi.hoisted(() => ({ value: false }))
vi.mock('../../../hooks/useBreakpoint', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, useIsTouch: () => touch.value }
})
// ⭐ A translator throw on demand, through the REAL door: any source carrying the
// marker makes the member-input translation throw, exactly as a translator defect
// would. Every other source passes straight through to the real function.
const thrower = vi.hoisted(() => ({ marker: '__uct_translator_throws__' }))
vi.mock('./builderInputs', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    memberInputTranslation: (translate, source, ...rest) => {
      if (typeof source === 'string' && source.includes(thrower.marker)) throw new Error('translator exploded (test)')
      return real.memberInputTranslation(translate, source, ...rest)
    },
  }
})
const reports = vi.hoisted(() => ({ enabled: false }))
vi.mock('../supportLoop/supportApi', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    logImportGaps: () => true,
    reportsConfig: () => Promise.resolve({ reportsEnabled: reports.enabled, maxSourceBytes: 131072, maxNoteChars: 1000 }),
  }
})

import PineEditorStatus, { paneFor, CHECKING_TEXT, POLICY_TEXT } from './PineEditorStatus'
import { editorStatus } from './editorStatus'
import { inspectSource, ImportBox, PINE_DEBOUNCE_MS } from './PineBox'
import { SCRIPT_ENGINE_VERSION } from '../engine/scriptEngineVersion'

const REQUEST = `//@version=6
indicator("Mixed")
a = ta.sma(close, 10)
plot(a, "SMA")
s = request.security("SPY", "60", close)
plot(s, "SPY 60")
plot(close > a ? 1 : 0, "Above")`
const RUNS = `//@version=6
indicator("RSI")
r = ta.rsi(close, 14)
plot(r, "RSI")`
// every consumer runs it: the RSI line, and a 0/1 plot a screen can filter on
const EVERYWHERE = `//@version=6
indicator("RSI Swing")
r = ta.rsi(close, 14)
plot(r, "RSI")
plot(r > 70 ? 1 : 0, "OB")`
// the screener lane refuses `ta.cum` at the door; the chart door draws it
const OBV = `//@version=5
indicator("OBV")
plot(ta.cum(math.sign(ta.change(close)) * volume), "OBV")
plot(close > open ? 1 : 0, "Up")`

const statusFor = (src) => {
  const report = inspectSource(src, 'auto')
  return { report, status: editorStatus({ report, pane: paneFor(report, src), inspectedSource: src }) }
}
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }

beforeEach(() => { cleanup(); touch.value = false; reports.enabled = false })
afterEach(() => { vi.unstubAllEnvs() })

describe('PineEditorStatus', () => {
  it('desktop: headline is a polite status, four consumer rows, the engine line and the policy', async () => {
    const { report, status } = statusFor(RUNS)
    render(<PineEditorStatus status={status} report={report} inspectedSource={RUNS} currentText={RUNS} />)
    await flush()
    const head = screen.getByTestId('pine-status-headline')
    expect(head.getAttribute('role')).toBe('status')
    // ⛔ not "Runs fully": a number line is no screen yet; the box's threshold control can
    // make it one, and the headline and the two screen rows say so
    expect(head.textContent).toBe('Runs on the chart and in alerts; screens and scans need a threshold')
    const rows = within(screen.getByTestId('pine-status-runs-on')).getAllByRole('listitem')
    expect(rows.map((r) => r.getAttribute('data-consumer'))).toEqual(['chart', 'alerts', 'screener', 'scans'])
    const need = screen.getAllByTestId('pine-status-threshold')
    expect(need).toHaveLength(2)
    for (const n of need) expect(n.textContent).toMatch(/^Needs a threshold: give RSI a comparison/)
    expect(screen.getByTestId('pine-status-engine').textContent).toBe('Engine: host (fast path)')
    expect(screen.getByText(POLICY_TEXT)).toBeTruthy()
  })

  it('"Runs fully" only when every consumer row runs', async () => {
    const { report, status } = statusFor(EVERYWHERE)
    render(<PineEditorStatus status={status} report={report} inspectedSource={EVERYWHERE} currentText={EVERYWHERE} />)
    await flush()
    expect(screen.getByTestId('pine-status-headline').textContent).toBe('Runs fully')
    const rows = within(screen.getByTestId('pine-status-runs-on')).getAllByRole('listitem')
    expect(rows.map((r) => r.getAttribute('data-ok'))).toEqual(['true', 'true', 'true', 'true'])
  })

  it('a screener-lane refusal of a plot the chart draws: named on the screen rows, no line, no "Tell us"', async () => {
    reports.enabled = true
    const { report, status } = statusFor(OBV)
    render(<PineEditorStatus status={status} report={report} inspectedSource={OBV} currentText={OBV} />)
    await flush()
    expect(screen.queryByTestId('pine-status-item')).toBeNull()
    expect(screen.queryByTestId('pine-status-tell-us')).toBeNull()
    const refused = report.outputs.find((o) => !o.formula)
    const lists = screen.getAllByTestId('pine-status-refused')
    expect(lists).toHaveLength(2)
    for (const l of lists) expect(l.textContent).toContain(`OBV: ${refused.refusal.message}`)
  })

  it('the chart draws nothing but alerts and screens run: the headline says where, never "Not yet"', async () => {
    const src = '//@version=5\nindicator("ac")\nalertcondition(ta.crossover(close, ta.sma(close, 20)), "Cross up")'
    const { report, status } = statusFor(src)
    render(<PineEditorStatus status={status} report={report} inspectedSource={src} currentText={src} />)
    await flush()
    const head = screen.getByTestId('pine-status-headline')
    expect(head.getAttribute('data-state')).toBe('runs-elsewhere')
    // the chart door's own "nothing a chart can draw": nothing is missing, so no "yet"
    expect(head.textContent).toBe('Runs in alerts, screens and scans; nothing to draw on a chart')
    expect(screen.getByTestId('pine-status-still').textContent).toBe('What still works: Cross up in alerts, screens and scans.')
  })

  it('a saved version\'s own facts are their own line, beside rows that answer for the editor\'s text', async () => {
    const src = '//@version=5\nindicator("saved")\nplot(close > open ? 1 : 0, "Up")'
    const report = inspectSource(src, 'auto')
    const kind = "compute.kind is 'runtime'; a scan is a tree this lane can walk, so only 'ast' is scannable."
    const savedRow = { definition: { compute: { kind: 'runtime', source: src } }, scan_refusal: { gate: 'kind', detail: kind } }
    const status = editorStatus({ report, pane: paneFor(report, src), savedRow, inspectedSource: src })
    render(<PineEditorStatus status={status} report={report} inspectedSource={src} currentText={src} />)
    await flush()
    expect(screen.getByTestId('pine-status-saved-scan').textContent).toBe(`Saved version, in screens and scans: ${kind}`)
    const rows = within(screen.getByTestId('pine-status-runs-on')).getAllByRole('listitem')
    const screener = rows.find((r) => r.getAttribute('data-consumer') === 'screener')
    expect(screener.getAttribute('data-ok')).toBe('true')
    expect(screener.textContent).not.toContain(kind)
  })

  it('a held saved version: the hold is the saved version\'s line, with the engine\'s reason under Details', async () => {
    const src = '//@version=5\nindicator("saved")\nplot(close > open ? 1 : 0, "Up")'
    const report = inspectSource(src, 'auto')
    const savedRow = {
      definition: { compute: { kind: 'ast' } }, pine_source: src,
      engine_status: { engine: SCRIPT_ENGINE_VERSION, status: 'refused', reason: 'the strategy call cannot be translated' },
    }
    const status = editorStatus({ report, pane: paneFor(report, src), savedRow, inspectedSource: src })
    render(<PineEditorStatus status={status} report={report} inspectedSource={src} currentText={src} />)
    await flush()
    expect(screen.getByTestId('pine-status-saved-held').textContent).toMatch(/^Saved version: Held by the script engine\. /)
    expect(screen.getByTestId('pine-status-saved').textContent).toContain('the strategy call cannot be translated')
  })

  it('a withheld line is a real button named for its line, and it moves the editor there', async () => {
    const { report, status } = statusFor(REQUEST)
    const onGoToLine = vi.fn()
    render(<PineEditorStatus status={status} report={report} inspectedSource={REQUEST} currentText={REQUEST} onGoToLine={onGoToLine} />)
    await flush()
    const item = screen.getAllByTestId('pine-status-item').find((el) => el.getAttribute('data-family') === 'request')
    const btn = within(item).getByRole('button', { name: /^Go to line \d+$/ })
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.getAttribute('type')).toBe('button')
    fireEvent.click(btn)
    expect(onGoToLine).toHaveBeenCalledWith(Number(item.getAttribute('data-line')))
    // the CHART DOOR's own sentence, verbatim, under Details
    const refused = paneFor(report, REQUEST).translation.outputs.find((o) => !o.formula)
    expect(within(item).getByTestId('pine-status-reason').textContent).toBe(refused.refusal.message)
  })

  it('while the editor is ahead of the report it says it is checking, and shows no stale verdict', async () => {
    const { report, status } = statusFor(RUNS)
    render(<PineEditorStatus status={status} report={report} inspectedSource={RUNS} currentText={`${RUNS}\n`} />)
    await flush()
    expect(screen.getByTestId('pine-status-headline').textContent).toBe(CHECKING_TEXT)
    expect(screen.queryByTestId('pine-status-runs-on')).toBeNull()
  })

  it('touch: one summary row, Details opens the full panel in a Sheet', async () => {
    touch.value = true
    const { report, status } = statusFor(REQUEST)
    render(<PineEditorStatus status={status} report={report} inspectedSource={REQUEST} currentText={REQUEST} />)
    await flush()
    expect(screen.queryByTestId('pine-status-runs-on')).toBeNull()
    const open = screen.getByTestId('pine-status-open-sheet')
    expect(open.getAttribute('aria-haspopup')).toBe('dialog')
    fireEvent.click(open)
    await flush()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByTestId('pine-status-runs-on')).toBeTruthy()
  })

  it('touch: a Line N tapped in the Sheet closes it and leaves focus in the editor, not on Details', async () => {
    touch.value = true
    const { report, status } = statusFor(REQUEST)
    const editor = document.createElement('textarea')
    document.body.appendChild(editor)
    try {
      const onGoToLine = vi.fn(() => editor.focus())
      render(<PineEditorStatus status={status} report={report} inspectedSource={REQUEST} currentText={REQUEST} onGoToLine={onGoToLine} />)
      await flush()
      const open = screen.getByTestId('pine-status-open-sheet')
      open.focus()
      fireEvent.click(open)
      await flush()
      const btn = within(screen.getByRole('dialog')).getAllByRole('button', { name: /^Go to line \d+$/ })[0]
      fireEvent.click(btn)
      await flush()
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(onGoToLine).toHaveBeenCalledTimes(1)
      expect(document.activeElement).toBe(editor)
    } finally {
      editor.remove()
    }
  })

  it('"Tell us you need this" appears only when the report door is on and something is withheld', async () => {
    const { report, status } = statusFor(REQUEST)
    const { unmount } = render(<PineEditorStatus status={status} report={report} inspectedSource={REQUEST} currentText={REQUEST} />)
    await flush()
    expect(screen.queryByTestId('pine-status-tell-us')).toBeNull()
    unmount()
    reports.enabled = true
    render(<PineEditorStatus status={status} report={report} inspectedSource={REQUEST} currentText={REQUEST} />)
    await flush()
    expect(screen.getByTestId('pine-status-tell-us').getAttribute('type')).toBe('button')
  })
})

describe('the wire into the Pine tab (VITE_PINE_EDITOR_STATUS)', () => {
  const pasteAndSettle = async (text) => {
    fireEvent.change(screen.getByLabelText(/^(pine script|script or formula)$/i), { target: { value: text } })
    await act(async () => { await new Promise((r) => setTimeout(r, PINE_DEBOUNCE_MS + 50)) })
  }

  it('off (the default): no panel', async () => {
    render(<ImportBox onPick={() => {}} />)
    await pasteAndSettle(RUNS)
    await screen.findByTestId('import-outcome')
    expect(screen.queryByTestId('pine-editor-status')).toBeNull()
  })

  it('on: the panel renders under the editor for a Pine paste, and not for a formula', async () => {
    vi.stubEnv('VITE_PINE_EDITOR_STATUS', '1')
    render(<ImportBox onPick={() => {}} />)
    await pasteAndSettle(RUNS)
    await screen.findByTestId('import-outcome')
    expect(screen.getByTestId('pine-editor-status').getAttribute('data-state')).toBe('runs')
    await pasteAndSettle('sma(close, 20) > close')
    await screen.findByTestId('import-outcome')
    expect(screen.queryByTestId('pine-editor-status')).toBeNull()
  })

  it('on: a translator throw on a Pine paste shows the engine-fault state (the auto door stamps it formula)', async () => {
    vi.stubEnv('VITE_PINE_EDITOR_STATUS', '1')
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(<ImportBox onPick={() => {}} />)
      await pasteAndSettle(`//@version=6\nindicator("x")\n// ${thrower.marker}\nplot(close)`)
      const panel = await screen.findByTestId('pine-editor-status')
      expect(panel.getAttribute('data-state')).toBe('engine-error')
      expect(screen.getByTestId('pine-status-headline').textContent).toMatch(/not your script/)
    } finally {
      quiet.mockRestore()
    }
  })

  it('the door marks only a PINE paste\'s fault, and changes nothing else on the report', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const pine = inspectSource(`//@version=6\nindicator("x")\n// ${thrower.marker}\nplot(close)`, 'auto')
      expect(pine.error).toBeTruthy()
      expect(pine.dialect).toBe('formula')
      expect(pine.faultDialect).toBe('pine')
      const clean = inspectSource(RUNS, 'auto')
      expect('faultDialect' in clean).toBe(false)
    } finally {
      quiet.mockRestore()
    }
  })

  it('on: only the literal "1" opens it', async () => {
    vi.stubEnv('VITE_PINE_EDITOR_STATUS', 'true')
    render(<ImportBox onPick={() => {}} />)
    await pasteAndSettle(RUNS)
    await screen.findByTestId('import-outcome')
    expect(screen.queryByTestId('pine-editor-status')).toBeNull()
  })
})
