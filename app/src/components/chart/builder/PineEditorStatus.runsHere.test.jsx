// The builder's status panel, joined with a REAL RUN on the chart the builder was opened over
// (`runsHere.js`, the same function the Create Indicator dock uses). A script that pastes clean and
// is refused by the run shows the RUN's refusal, not "Runs"; the status that is saved, gated on and
// recorded is not changed by it.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, waitFor, renderHook } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

vi.mock('../supportLoop/supportApi', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, logImportGaps: () => true, reportsConfig: () => Promise.resolve({ reportsEnabled: false, maxSourceBytes: 131072, maxNoteChars: 1000 }) }
})

import { ImportBox, PINE_DEBOUNCE_MS } from './PineBox'
import { shownStatus, useRunOnChart, usePineEditorStatus, SHOWN_STATE, PENDING_REASKS } from './PineEditorStatus'
import { RUN, MIN_BARS, STOPPED_HEADLINE, CHECKING_HEADLINE } from './runsHere'
import { LOST_DRAWINGS_HEADLINE } from './authoring/scriptAnswer'
import { PANEL_STATE } from './editorStatus'
import { inspectSource } from './PineBox'
import { recipeBars, recipeContext, RUN_STOP_PROBES } from '../supportLoop/assistantRecipes'
import { PITFALL_PROBES } from '../supportLoop/assistantPineReference'
import { __permitRuntimePaneForTests } from '../engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../engine/runtimeKill'

const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8').match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
const ON = () => {
  vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
  vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')
  // (a script is run on a chart only where member scripts are drawn at all: `runsHere.js` asks the gate first)
  vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_EDITOR_STATUS', '1')
}

const TOTAL = RUN_STOP_PROBES['running-total'].source
const LOST = PITFALL_PROBES['drawings-beside-plain-plots']
const chartOn = (history) => ({ bars: recipeBars('daily'), ctx: recipeContext('daily', history) })
const pasteAndSettle = async (text) => {
  fireEvent.change(screen.getByLabelText(/^(pine script|script or formula)$/i), { target: { value: text } })
  await act(async () => { await new Promise((r) => setTimeout(r, PINE_DEBOUNCE_MS + 50)) })
}
const headline = () => screen.getByTestId('pine-status-headline').textContent

beforeAll(() => { __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests() })
afterEach(() => { cleanup(); vi.unstubAllEnvs() })

describe('the panel beside a chart: "Runs" is a real run on that chart', () => {
  it('a script that pastes clean and is refused by the run shows the run\'s refusal, not "Runs"', async () => {
    ON()
    render(<ImportBox onPick={() => {}} engineChart={chartOn('offListing')} />)
    await pasteAndSettle(TOTAL)
    await waitFor(() => expect(headline()).toBe(STOPPED_HEADLINE), { timeout: 30_000 })
    expect(screen.getByTestId('pine-editor-status').getAttribute('data-state')).toBe(SHOWN_STATE.STOPPED_HERE)
    const stop = screen.getByTestId('pine-status-run-stop')
    expect(stop.getAttribute('data-guard')).toBe('runtime:warmup-never-converges')
    expect(stop.textContent).toMatch(/its values never came to agree/)
    expect(screen.getByTestId('pine-status-on-this-chart').textContent).toMatch(/The script itself can still be saved/)
  }, 60_000)

  it('CONTROL: the same script beside a chart from the listing runs; with no chart the panel is what it was', async () => {
    ON()
    render(<ImportBox onPick={() => {}} engineChart={chartOn('fromListing')} />)
    await pasteAndSettle(TOTAL)
    await waitFor(() => expect(headline()).toMatch(/^Runs on the chart/), { timeout: 30_000 })
    expect(screen.queryByTestId('pine-status-run-stop')).toBeNull()
    cleanup()
    render(<ImportBox onPick={() => {}} />)
    await pasteAndSettle(TOTAL)
    await screen.findByTestId('pine-editor-status')
    expect(headline()).toMatch(/^Runs on the chart/)
    expect(screen.queryByTestId('pine-status-on-this-chart')).toBeNull()
  }, 60_000)

  it('a script whose drawings the lane lost leads with that, in the engine\'s words, with or without a chart', async () => {
    ON()
    render(<ImportBox onPick={() => {}} />)
    await pasteAndSettle(LOST)
    await waitFor(() => expect(headline()).toBe(LOST_DRAWINGS_HEADLINE), { timeout: 30_000 })
    expect(screen.getByTestId('pine-editor-status').getAttribute('data-state')).toBe(SHOWN_STATE.DRAWINGS_LOST)
    expect(screen.getByTestId('pine-status-lost-drawings').textContent).toMatch(/drawing elements in this script/)
  }, 60_000)
})

describe('the status itself is the SCRIPT\'s, and is not changed by a chart', () => {
  it('state, headline and items are the paste status; the run rides beside them', async () => {
    ON()
    const report = inspectSource(TOTAL, 'pine')
    const { result } = renderHook(() => usePineEditorStatus({ enabled: true, report, inspectedSource: TOTAL, chart: chartOn('offListing') }))
    await waitFor(() => expect(result.current.run && result.current.run.state).toBe(RUN.STOPPED), { timeout: 30_000 })
    const plain = renderHook(() => usePineEditorStatus({ enabled: true, report, inspectedSource: TOTAL })).result.current
    expect(result.current.state).toBe(plain.state)                   // what gates the buttons
    expect(result.current.headline).toBe(plain.headline)             // what is recorded beside a saved version
    expect(result.current.items).toEqual(plain.items)
    expect([PANEL_STATE.RUNS, PANEL_STATE.RUNS_WITH_NOTES]).toContain(plain.state)
    expect('run' in plain).toBe(false)
  }, 60_000)

  it('what the panel leads with', () => {
    const base = { state: PANEL_STATE.RUNS_WITH_NOTES, headline: 'Runs on the chart, with 1 note', items: [] }
    const stopped = { state: RUN.STOPPED, stops: [{ guard: 'g', sentence: 's' }], unchecked: [], notes: [] }
    expect(shownStatus(base)).toEqual({ headline: base.headline, state: base.state, run: null })
    expect(shownStatus({ ...base, run: stopped })).toEqual({ headline: STOPPED_HEADLINE, state: SHOWN_STATE.STOPPED_HERE, run: stopped })
    expect(shownStatus({ ...base, lostDrawings: 'lost' }).headline).toBe(LOST_DRAWINGS_HEADLINE)
    expect(shownStatus({ ...base, run: stopped, lostDrawings: 'lost' }).headline).toBe(STOPPED_HEADLINE)     // a stop outranks a loss
    const pending = { state: RUN.PENDING, stops: [], unchecked: [], notes: [] }
    expect(shownStatus({ ...base, run: pending })).toEqual({ headline: CHECKING_HEADLINE, state: PANEL_STATE.CHECKING, run: pending })
    const ran = { state: RUN.RAN, stops: [], unchecked: [], notes: ['n'] }
    expect(shownStatus({ ...base, run: ran }).headline).toBe(base.headline)
    // ⛔ a chart never makes a refused script look better, or changes what a refusal says
    for (const state of [PANEL_STATE.NOT_YET, PANEL_STATE.ENGINE_ERROR, PANEL_STATE.RUNS_ELSEWHERE]) {
      const refused = { state, headline: 'Not yet: Inputs', items: [] }
      for (const run of [stopped, pending, ran]) expect(shownStatus({ ...refused, run, lostDrawings: 'lost' }).headline).toBe('Not yet: Inputs')
    }
    expect(shownStatus(null)).toEqual({ headline: '', state: null, run: null })
  })
})

describe('the run is asked for after first paint, once per script per chart, and never per bar', () => {
  const pane = { ok: true, definition: { id: 'x' } }
  const ran = { state: RUN.RAN, stops: [], unchecked: [], notes: [] }

  it('PENDING until the engine answers; nothing runs before the chart has painted', async () => {
    let fire = null
    const run = vi.fn(async () => ran)
    const { result } = renderHook(() => useRunOnChart(pane, chartOn('offListing'), { run, after: (fn) => { fire = fn } }))
    await waitFor(() => expect(result.current && result.current.state).toBe(RUN.PENDING))
    expect(run).not.toHaveBeenCalled()                              // waiting for the first paint
    await act(async () => { fire() })
    await waitFor(() => expect(result.current.state).toBe(RUN.RAN))
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('a new bar (a new bars array, the same chart) does not run it again; another symbol or another script does', async () => {
    const run = vi.fn(async () => ran)
    const first = chartOn('offListing')
    const { result, rerender } = renderHook(({ p, c }) => useRunOnChart(p, c, { run, after: (fn) => fn() }), { initialProps: { p: pane, c: first } })
    await waitFor(() => expect(result.current && result.current.state).toBe(RUN.RAN))
    rerender({ p: pane, c: { bars: [...first.bars], ctx: { ...first.ctx } } })
    await act(async () => { await Promise.resolve() })
    expect(run).toHaveBeenCalledTimes(1)
    rerender({ p: pane, c: { bars: first.bars, ctx: { ...first.ctx, sym: 'OTHER' } } })
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2))
    rerender({ p: { ok: true, definition: { id: 'y' } }, c: { bars: first.bars, ctx: { ...first.ctx, sym: 'OTHER' } } })
    await waitFor(() => expect(run).toHaveBeenCalledTimes(3))
    // and it runs on the bars of the moment, not the bars of the first render
    expect(run.mock.calls[2][1].ctx.sym).toBe('OTHER')
  })

  it('nothing to run on is no run at all: no chart, a chart still loading, a script the chart does not take', () => {
    const run = vi.fn(async () => ran)
    const opts = { run, after: (fn) => fn() }
    expect(renderHook(() => useRunOnChart(pane, null, opts)).result.current).toBe(null)
    expect(renderHook(() => useRunOnChart(pane, { bars: recipeBars('daily').slice(0, MIN_BARS - 1), ctx: recipeContext('daily', 'offListing') }, opts)).result.current).toBe(null)
    expect(renderHook(() => useRunOnChart({ ok: false }, chartOn('offListing'), opts)).result.current).toBe(null)
    expect(renderHook(() => useRunOnChart(null, chartOn('offListing'), opts)).result.current).toBe(null)
    expect(run).not.toHaveBeenCalled()
  })

  it('a run that fails is no verdict (the panel says what the status says), never a stop it invented', async () => {
    const run = vi.fn(async () => { throw new Error('boom') })
    const { result } = renderHook(() => useRunOnChart(pane, chartOn('offListing'), { run, after: (fn) => fn() }))
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current).toBe(null))
  })
})

// ─── review fixes (2026-11-19) ────────────────────────────────────────────────────────
describe('a run still pending when its wait ended is asked for again', () => {
  const pane = { ok: true, definition: { id: 'x' } }
  const pending = { state: RUN.PENDING, stops: [], unchecked: [], waiting: [], notes: [] }
  const ran = { state: RUN.RAN, stops: [], unchecked: [], waiting: [], notes: [] }

  it('the panel does not stay on "still being checked": the run that lands is read', async () => {
    const answers = [pending, pending, ran]
    const run = vi.fn(async () => answers.shift())
    const { result } = renderHook(() => useRunOnChart(pane, chartOn('offListing'), { run, after: (fn) => fn(), reaskMs: 5 }))
    await waitFor(() => expect(result.current && result.current.state).toBe(RUN.RAN))
    expect(run).toHaveBeenCalledTimes(3)
    // and once it has landed it is not asked for again
    await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('never more than the bound, and not at all after the panel is gone', async () => {
    const run = vi.fn(async () => pending)
    const { result, unmount } = renderHook(() => useRunOnChart(pane, chartOn('offListing'), { run, after: (fn) => fn(), reaskMs: 2 }))
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1 + PENDING_REASKS))
    await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
    expect(run).toHaveBeenCalledTimes(1 + PENDING_REASKS)
    expect(result.current.state).toBe(RUN.PENDING)
    // a slow re-ask that would fire after the panel closed never does
    const slow = vi.fn(async () => pending)
    const second = renderHook(() => useRunOnChart(pane, chartOn('offListing'), { run: slow, after: (fn) => fn(), reaskMs: 300 }))
    await waitFor(() => expect(slow).toHaveBeenCalledTimes(1))
    second.unmount()
    await act(async () => { await new Promise((r) => setTimeout(r, 450)) })
    expect(slow).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('a script that waits for the bar is run again when the bar has finished', async () => {
    const run = vi.fn(async () => ran)
    const first = chartOn('offListing')
    const forming = { bars: first.bars, ctx: { ...first.ctx, newestBarIsForming: true } }
    const { rerender } = renderHook(({ c }) => useRunOnChart(pane, c, { run, after: (fn) => fn() }), { initialProps: { c: forming } })
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    rerender({ c: { bars: first.bars, ctx: { ...first.ctx, newestBarIsForming: false } } })
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2))
    expect(run.mock.calls[1][1].ctx.newestBarIsForming).toBe(false)
    // CONTROL: the same state of the bar again does not
    rerender({ c: { bars: [...first.bars], ctx: { ...first.ctx, newestBarIsForming: false } } })
    await act(async () => { await Promise.resolve() })
    expect(run).toHaveBeenCalledTimes(2)
  })
})

describe('what leads when a run waits for the bar', () => {
  const waiting = [{ guard: 'pane:forming-ungraded', sentence: 'the bar is forming' }]
  it('waiting leads over "its drawings are not all drawn": nothing of it is drawn yet', () => {
    const shown = shownStatus({ state: PANEL_STATE.RUNS, headline: 'Runs', lostDrawings: 'its drawings are lost',
      run: { state: RUN.RAN, stops: [], unchecked: [], waiting, notes: [] } })
    expect(shown.state).toBe(SHOWN_STATE.WAITS_FOR_THE_BAR)
    // CONTROL: with nothing waiting, the lost drawings lead as before; and a stop leads over both
    expect(shownStatus({ state: PANEL_STATE.RUNS, headline: 'Runs', lostDrawings: 'x', run: { state: RUN.RAN, stops: [], unchecked: [], waiting: [], notes: [] } }).state)
      .toBe(SHOWN_STATE.DRAWINGS_LOST)
    expect(shownStatus({ state: PANEL_STATE.RUNS, headline: 'Runs', lostDrawings: 'x', run: { state: RUN.STOPPED, stops: [{ guard: 'g', sentence: 's' }], unchecked: [], waiting, notes: [] } }).state)
      .toBe(SHOWN_STATE.STOPPED_HERE)
  })
})
