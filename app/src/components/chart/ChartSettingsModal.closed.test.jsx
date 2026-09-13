// app/src/components/chart/ChartSettingsModal.closed.test.jsx
//
// ─── A CLOSED MODAL SUBSCRIBES TO NOTHING ───────────────────────────────────
//
// ⛔⛔ THIS IS A RAIL ABOUT A COMPONENT THAT RENDERS NULL, and that is exactly why
// it is easy to get wrong twice. `ChartSettingsModal` guards with
// `if (!open) return null` — but React runs the whole function body first, so
// every hook above that line runs on every chart, open or not, forever.
//
// ⚰️ WHAT IT COST, MEASURED. The indicators consolidation moved
// `useUserDefinitions` / `useInstalledUserDefinitions` out of
// `IndicatorLibraryDialog` (which only MOUNTED while the library was open) into
// this component's body. Two consequences, neither visible from the chart:
//
//   1. Every chart in a nine-cell grid subscribed to the member's formulas for a
//      panel nobody had opened.
//   2. `useUserDefinitions` reads `useContext(AuthContext)` directly — deliberately,
//      because `useAuth` throws outside a provider and a chart renders on surfaces
//      that mount none. Two journal pages mount a real `ChartPane`, and their
//      `vi.mock` of that module omits the context OBJECT. Vitest THROWS on a
//      missing named export rather than answering undefined, so those pages
//      rendered BLANK and 39 assertions failed with the cause three components
//      away.
//
// The tempting repair was to complete those two mocks. `hub/rule12Paths.test.js`
// refuses it — they belong to the Notebook workstream — and it is right to: the
// defect was here, in a chart component with no business subscribing while
// closed. So the subscription moved into a child that the OPEN branch mounts.
//
// ⚠️ THE ASSERTION IS ON THE HOOK, NOT ON THE DOM. "Renders nothing" was already
// true and already tested; what regressed was what ran BEFORE the return. Only a
// spy on the module can see that.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

const H = vi.hoisted(() => ({ userDefs: 0, installed: 0 }))

vi.mock('../../hooks/useUserDefinitions', () => ({
  useUserDefinitions: () => { H.userDefs += 1; return { rows: [], isLoading: false, error: null, refresh: () => {} } },
  useInstalledUserDefinitions: () => {
    H.installed += 1
    return { installedIds: [], errors: [], generation: 0, isLoading: false, error: null }
  },
}))

// ⚠️ `usePreferences` IS NOT MOCKED, AND THE FIRST DRAFT MOCKED IT — with
// `{ default }` alone, which omitted its `parsePref` named export and threw the
// very error this file exists to prevent, inside the file that documents it. Left
// real: the templates row reads it and nothing here cares what it says.
const { default: ChartSettingsModal } = await import('./ChartSettingsModal')
const { mergeChartSettings } = await import('./chartDefaults')

const base = () => mergeChartSettings({})

beforeEach(() => { cleanup(); H.userDefs = 0; H.installed = 0 })

describe('a CLOSED Chart Settings modal runs no formula subscription', () => {
  it('⛔ neither hook is called while `open` is false', () => {
    render(<ChartSettingsModal open={false} settings={base()} onChange={vi.fn()} />)
    expect(H.userDefs, 'a closed modal subscribed to the member s formulas').toBe(0)
    expect(H.installed, 'a closed modal installed user definitions').toBe(0)
  })

  it('⛔ nor on a chart that mounts it closed and never opens it — the grid case', () => {
    // Nine cells, all closed. The number that matters is ZERO, not "one request
    // because SWR dedupes": the dedupe is what made the original defect invisible,
    // and `useContext(AuthContext)` runs per call whether or not a request does.
    for (let i = 0; i < 9; i++) {
      render(<ChartSettingsModal open={false} settings={base()} onChange={vi.fn()} />)
    }
    expect(H.userDefs).toBe(0)
    expect(H.installed).toBe(0)
  })

  it('⭐ and the CONTROL — opening it does subscribe', () => {
    // Without this, deleting the subscription outright would pass every case
    // above, and a member's own formulas would silently stop appearing.
    render(<ChartSettingsModal open scrollTo="ind:volume" settings={base()} onChange={vi.fn()} />)
    expect(H.userDefs, 'an OPEN modal no longer reads the member s formulas')
      .toBeGreaterThan(0)
    expect(H.installed, 'an OPEN modal no longer installs them').toBeGreaterThan(0)
  })

  it('⛔ and it does not settle into a render loop', () => {
    // ⚠️ SWR ANSWERS A FRESH `[]` ON EVERY RENDER until data lands, so lifting the
    // feed's result with a plain `setState({rows, errors})` changes identity every
    // time: re-render → effect → set → re-render, forever. `sameList` treats two
    // empty lists as one answer. A loop shows up here as a call count that keeps
    // climbing rather than settling in single digits.
    render(<ChartSettingsModal open scrollTo="ind:volume" settings={base()} onChange={vi.fn()} />)
    expect(H.userDefs, `the feed re-rendered ${H.userDefs} times — it is not settling`)
      .toBeLessThan(12)
  })
})
