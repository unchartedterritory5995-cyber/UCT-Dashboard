// 🔴 THE WIRE — AND ONLY THE SECOND BLOCK IS THE WHOLE OF IT.
//
// Every case here drives the preview THROUGH THE SHEET: remove the
// `<PreviewPane …/>` mount in `BuilderSheet` and they fail while `PreviewPane`
// stays perfectly correct. But `mount()` below hands `BuilderSheet` its OWN
// `sym`/`tf`, so the first `describe` never renders `ChartToolbar` at all and is
// blind to the hand-back that supplies them in production. MEASURED 2026-08-27:
// cutting `sym={currentSym}`/`tf={tf}` from `ChartToolbar.jsx` reddens EXACTLY
// ONE of these six cases — `🔴 THE PROP WIRE`, in the second block — and leaves
// all four of the first block GREEN. (Perturbed and restored byte-identical; the
// file belongs to another lane.)
//
// ⛔ THIS HEADER USED TO SAY "Every case", and the correction sat 95 lines below
// it. A reader trusts the header, so a correction the header contradicts is
// worse than no correction — the false sentence is the one that gets believed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import BuilderSheet from '../BuilderSheet'
import ChartToolbar from '../../ChartToolbar'
import { mergeChartSettings } from '../../chartDefaults'
import { FORMULA_DEBOUNCE_MS } from '../FormulaField'
import { AuthContext } from '../../../../context/AuthContext'
import * as registry from '../../engine/nativeRegistry'
import { PREVIEW_DEF_ID } from './previewDefinition'

const { chartPaneSpy } = vi.hoisted(() => ({ chartPaneSpy: vi.fn() }))
vi.mock('../../pane/ChartPane', () => ({
  default: (props) => { chartPaneSpy(props); return <div data-testid="chart-pane-mock">{props.sym}</div> },
}))

function stubFetch() {
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: [] }) }
    return { ok: true, status: 200, json: async () => ({ def_id: 'u_aaaaaaaaaaaa', version: 1, rev: 1 }) }
  })
}
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }) }
const noop = () => {}

function mount(props = {}) {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={noop} sym="NVDA" tf="D" {...props} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}
const field = () => screen.getByLabelText('Formula')
async function typeFormula(text) {
  fireEvent.change(field(), { target: { value: text } })
  await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 1) })
  await flush()
}

beforeEach(() => { vi.useFakeTimers(); stubFetch() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); chartPaneSpy.mockClear(); registry.uninstallUserDefinition(PREVIEW_DEF_ID) })

describe('the live preview is reachable from the sheet', () => {
  it('an evaluating formula puts ONE preview on screen, on the sheet\'s symbol, holding the buffer', async () => {
    mount()
    await flush()
    expect(screen.queryByTestId('formula-preview')).toBeNull()
    await typeFormula('sma(close, 20)')
    expect(screen.getByTestId('formula-preview')).toBeTruthy()
    expect(chartPaneSpy.mock.calls.at(-1)[0].sym).toBe('NVDA')
    expect(chartPaneSpy.mock.calls.at(-1)[0].tf).toBe('D')
    expect(registry.getDefinition(PREVIEW_DEF_ID).compute.source).toBe('sma(close, 20)')
  })

  it('a refusal takes the preview down and the registry entry with it', async () => {
    mount()
    await flush()
    await typeFormula('sma(close, 20)')
    await typeFormula('sma(close, 20')
    expect(screen.queryByTestId('formula-preview')).toBeNull()
    expect(registry.getDefinition(PREVIEW_DEF_ID)).toBeNull()
  })

  it('⛔ THE CONTROL — a sheet opened with no symbol shows no preview and installs nothing', async () => {
    mount({ sym: null, tf: null })
    await flush()
    await typeFormula('sma(close, 20)')
    expect(screen.queryByTestId('formula-preview')).toBeNull()
    expect(registry.getDefinition(PREVIEW_DEF_ID)).toBeNull()
  })

  // ⛔ THE TITLE NAMES WHAT THE FIXTURE CAN DISTINGUISH. It used to say the draft
  // "USES" the input while asserting only that the input is DECLARED — and
  // `previewDefinition` spreads `[...BUILDER_INPUTS, ...memberInputs]`
  // unconditionally, so a declared-but-unused `period` satisfies that assertion
  // just as well. The source assertion below is what carries the other half: the
  // formula the registry holds NAMES `period`, and it could only install at all
  // because `validateAstLane` resolved that name from the document's own
  // declared inputs rather than reading it as an unknown series.
  it('a member input the draft NAMES rides onto the preview definition — declared there, and named by the source the registry holds', async () => {
    mount()
    await flush()
    await act(async () => { fireEvent.click(screen.getByTestId('add-input')) })
    await act(async () => { fireEvent.change(screen.getByLabelText('Input 1 name'), { target: { value: 'period' } }) })
    // ⚠️ `sma(close, period)` CANNOT BE THE FIXTURE HERE, and the reason is the
    // engine's, not this test's: the closed table refuses a non-literal window
    // ("a window must be a whole-number literal"), so a member input can be a
    // scalar OPERAND but never a lookback. The claim under test is unchanged —
    // a member input the draft NAMES is declared on the preview document.
    await typeFormula('sma(close, 20) + period')
    const def = registry.getDefinition(PREVIEW_DEF_ID)
    expect(def).toBeTruthy()
    expect(def.inputs.map((i) => i.key)).toContain('period')
    // ⭐ THE HALF THE DECLARATION CANNOT PROVE: the draft the registry is holding
    // is the one that names the knob. Drop `period` from the formula and this
    // moves while the `inputs` assertion above stays green.
    expect(def.compute.source).toBe('sma(close, 20) + period')
  })
})

// ─── THE OTHER HALF OF THE WIRE ─────────────────────────────────────────────
//
// ⚠️ THE BLOCK ABOVE HANDS `BuilderSheet` ITS OWN `sym`/`tf`, so it is blind to
// the hand-back that actually supplies them. Delete `sym={currentSym}` and
// `tf={tf}` from ChartToolbar's `<BuilderSheet>` and every case above stays
// GREEN while a real member's preview silently never draws — which is the
// "built, tested, green and unreachable" shape this branch keeps finding. So
// these two drive the sheet through the toolbar that opens it, and nothing on
// the path is mocked but the chart itself.
describe('ChartToolbar is what hands the sheet the chart it was opened over', () => {
  function mountToolbar(props = {}) {
    return render(
      <AuthContext.Provider value={{ isPaid: true, user: { id: 7 }, loading: false }}>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
          <ChartToolbar
            activeTool="cursor"
            setActiveTool={noop}
            chartSettings={mergeChartSettings(null)}
            onUpdateSettings={noop}
            currentSym="NVDA"
            tf="D"
            {...props}
          />
        </SWRConfig>
      </AuthContext.Provider>,
    )
  }

  // The member's real route in: Indicators → "none of these — write one".
  async function openBuilder() {
    fireEvent.click(screen.getByRole('button', { name: /Indicators/ }))
    await flush()
    fireEvent.click(screen.getByTestId('library-new-formula'))
    await flush()
  }

  it('🔴 THE PROP WIRE — a formula typed in the sheet the TOOLBAR opened previews on the TOOLBAR\'s symbol and timeframe', async () => {
    mountToolbar()
    await openBuilder()
    await typeFormula('sma(close, 20)')
    expect(screen.getByTestId('formula-preview')).toBeTruthy()
    const props = chartPaneSpy.mock.calls.at(-1)[0]
    expect(props.sym).toBe('NVDA')
    expect(props.tf).toBe('D')
  })

  it('⛔ THE CONTROL — the same toolbar with no symbol opens the same sheet, and the preview stays inert', async () => {
    mountToolbar({ currentSym: null, tf: null })
    await openBuilder()
    await typeFormula('sma(close, 20)')
    expect(screen.queryByTestId('formula-preview')).toBeNull()
    expect(registry.getDefinition(PREVIEW_DEF_ID)).toBeNull()
  })
})
