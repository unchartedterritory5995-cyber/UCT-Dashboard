// app/src/components/chart/builder/BuilderSheet.scriptCounts.test.jsx
//
// ─── ⭐⭐ A PASTED SCRIPT THE MEMBER DOOR RUNS IS COUNTED AS ITSELF (2026-11-17) ─────────────────
//
// ⚰️ MEASURED ON PRODUCTION (as smoke@, read-only): pasting RS Rating left the sheet's tabs reading
// "Inputs 0" and "Plots 1": they counted the sheet's own empty formula, while what "Add this script
// to my chart" adds is the door's document, with 39 settings (TradingView's Inputs tab). A member read
// "this script has no settings". The tabs now count the door's document until the sheet takes the
// formula, and the Inputs panel says, in plain words, that
// its settings are changed on the chart after adding. ⛔ CONTROL: once the member takes "Use this
// formula", the sheet holds it and its own counts and editors stand, because those are edited here.
// Real sheet, ChartPane mocked (what it is handed, never pixels).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import BuilderSheet from './BuilderSheet'
import { startFrom } from '../../../testing/builder/builderStart.testkit.js'
import { AuthContext } from '../../../context/AuthContext'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList, runtimeSourceHash } from '../engine/runtimeKill'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from '../engine/runtimePaneGate'

vi.mock('../pane/ChartPane', () => ({ default: () => <div data-testid="mock-chart-pane" /> }))

const REPO = path.resolve(process.cwd(), '..')
const RS = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
// a script the FORMULA holds: one input, one plot, no drawings
const SMA = '//@version=5\nindicator("Avg")\nlen = input.int(20, "Length")\nplot(ta.sma(close, len), "Avg")\n'

const flush = async () => {
  await act(async () => { vi.advanceTimersByTime(1500) })
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}
function mount() {
  // the server's lists as production serves them: RS Rating's source is on the allowlist
  globalThis.fetch = vi.fn(async (url) => (String(url).includes('runtime-kill')
    ? { ok: true, status: 200, json: async () => ({ kill: [], allow: [runtimeSourceHash(RS)] }) }
    : { ok: true, status: 200, json: async () => ({ definitions: [] }) }))
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} sym="SPY" tf="D" settings={{}} onChange={vi.fn()} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}
async function paste(text) {
  startFrom('pine')
  fireEvent.change(screen.getByTestId('pine-box').querySelector('textarea'), { target: { value: text } })
  await flush()
  await flush()
}
const tab = (re) => screen.getAllByRole('tab').find((t) => re.test(t.textContent.trim()))
const count = (re) => Number((tab(re).textContent.match(/(\d+)\s*$/) || [])[1])

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  import.meta.env.VITE_PINE_MEMBER_PANE_ENABLED = '1'
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  setRuntimeKillList([])
})
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs()
  delete import.meta.env.VITE_PINE_MEMBER_PANE_ENABLED
  __resetRuntimePanePermission()
})

describe('⭐⭐ RS Rating pasted: the tabs count the script the door adds', () => {
  it('Inputs 39 (TradingView\'s Inputs tab), Plots = its drawn plots, never "Inputs 0 · Plots 1"', async () => {
    mount()
    await paste(RS)
    expect(screen.getByTestId('pine-member-pane-attach'), 'the door offers to add it').toBeTruthy()
    expect(count(/^Inputs/)).toBe(39)
    expect(count(/^Plots/)).toBeGreaterThan(1)
  })

  it('the Inputs panel says, in plain words, where its settings are changed (on the chart, after adding)', async () => {
    mount()
    await paste(RS)
    fireEvent.click(tab(/^Inputs/))
    const note = screen.getByTestId('script-settings-note')
    expect(screen.getByTestId('builder-inputs').hidden, "the sheet's own (empty) inputs editor is not offered for it").toBe(true)
    expect(note.textContent).toBe('This script has 39 settings. You change them on the chart, after you add it: open its settings from its name at the top of the chart.')
    expect(note.textContent).not.toMatch(/here|below|edit them/i)
    fireEvent.click(tab(/^Plots/))
    expect(screen.getByTestId('script-plots-note').textContent).toMatch(/^This script draws \d+ plots\. You change how they look on the chart/)
  })
})

describe('⛔ CONTROL — once the sheet takes the formula ("Use this formula"), its own counts and editors stand', () => {
  it('a one-input script: counted as the script while pasted; after "Use this formula", the sheet\'s own, with no note', async () => {
    mount()
    await paste(SMA)
    expect(count(/^Inputs/), "pasted: the script's one setting").toBe(1)
    expect(screen.getByTestId('script-settings-note').textContent).toMatch(/^This script has 1 setting\./)
    expect(screen.getByTestId('builder-inputs').hidden).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Use this formula' }))
    await flush()
    expect(screen.queryByTestId('script-settings-note'), 'the sheet holds it now').toBeNull()
    expect(screen.getByTestId('builder-inputs').hidden).toBe(false)
    expect(screen.getByTestId('builder-plots').hidden).toBe(false)
  })
})
