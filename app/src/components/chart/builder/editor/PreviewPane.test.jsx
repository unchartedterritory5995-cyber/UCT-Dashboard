// The preview is a TRANSIENT registry entry: installed while the sheet is open,
// uninstalled when the definition goes or the pane unmounts. ChartPane is mocked
// (as `pane/ChartPane.test.jsx` mocks StockChart) so the case is about WHAT the
// pane is handed — the registry entry and the instance — not about pixels.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import BuilderSheetDefault, { buildDefinition } from '../BuilderSheet'
import { evaluateFormula } from '../FormulaField'
import { BUILDER_INPUTS, BUILDER_INPUT_SCOPE } from '../builderInputs'
import * as registry from '../../engine/nativeRegistry'
import PreviewPane from './PreviewPane'
import { PREVIEW_DEF_ID } from './previewDefinition'

void BuilderSheetDefault

const { chartPaneSpy } = vi.hoisted(() => ({ chartPaneSpy: vi.fn() }))
vi.mock('../../pane/ChartPane', () => ({
  default: (props) => { chartPaneSpy(props); return <div data-testid="chart-pane-mock">{props.sym}</div> },
}))

afterEach(() => { cleanup(); chartPaneSpy.mockClear(); registry.uninstallUserDefinition(PREVIEW_DEF_ID) })

function draft(source) {
  const r = evaluateFormula(source, BUILDER_INPUT_SCOPE)
  if (!r.ok) return null
  return buildDefinition({
    defId: PREVIEW_DEF_ID, name: 'Preview', source: r.source, ast: r.ast,
    mode: r.verdict.mode, readback: r.readback, inputs: BUILDER_INPUTS,
  })
}

describe('the registry door the preview needs', () => {
  it('uninstallUserDefinition forgets ONE id and bumps the generation; a stranger is a no-op', () => {
    const before = registry.registryGeneration()
    const { installed, errors } = registry.installUserDefinitions([draft('sma(close, 20)')])
    expect(errors).toEqual([])
    expect(installed).toHaveLength(1)
    expect(registry.getDefinition(PREVIEW_DEF_ID)).toBeTruthy()
    expect(registry.uninstallUserDefinition(PREVIEW_DEF_ID)).toBe(true)
    expect(registry.getDefinition(PREVIEW_DEF_ID)).toBeNull()
    expect(registry.registryGeneration()).toBeGreaterThan(before)
    expect(registry.uninstallUserDefinition('u_never-installed')).toBe(false)
  })
})

describe('the pane', () => {
  it('given an evaluating draft it mounts ONE ChartPane whose instance names a registry entry with compute.source = the buffer', () => {
    render(<PreviewPane sym="NVDA" tf="D" settings={null} definition={draft('sma(close, 20)')} />)
    expect(screen.getByTestId('formula-preview')).toBeTruthy()
    expect(chartPaneSpy).toHaveBeenCalledTimes(1)
    const props = chartPaneSpy.mock.calls[0][0]
    expect(props.sym).toBe('NVDA')
    expect(props.tf).toBe('D')
    expect(props.density).toBe('mini')
    expect(props.showTfBar).toBe(false)
    expect(props.stored.indicatorInstances).toHaveLength(1)
    expect(props.stored.indicatorInstances[0].defId).toBe(PREVIEW_DEF_ID)
    expect(registry.getDefinition(PREVIEW_DEF_ID).compute.source).toBe('sma(close, 20)')
  })

  it('a refused draft mounts nothing and leaves nothing in the registry', () => {
    expect(draft('sma(close, 20')).toBeNull()
    render(<PreviewPane sym="NVDA" tf="D" settings={null} definition={null} />)
    expect(screen.queryByTestId('formula-preview')).toBeNull()
    expect(chartPaneSpy).not.toHaveBeenCalled()
    expect(registry.getDefinition(PREVIEW_DEF_ID)).toBeNull()
  })

  it('the draft is the ONLY instance on the preview, on the member\'s own canvas', () => {
    const settings = { background: '#010203', indicatorInstances: [{ instanceId: 'rsi:1', defId: 'rsi', inputs: {}, hidden: false }], indicators: { rsi: { enabled: true } } }
    render(<PreviewPane sym="NVDA" tf="D" settings={settings} definition={draft('close > open')} />)
    const { stored } = chartPaneSpy.mock.calls[0][0]
    expect(stored.background).toBe('#010203')
    expect(stored.indicatorInstances.map((i) => i.defId)).toEqual([PREVIEW_DEF_ID])
  })

  it('no symbol, or no timeframe, is inert — and installs nothing', () => {
    render(<PreviewPane sym={null} tf="D" settings={null} definition={draft('close > open')} />)
    expect(screen.queryByTestId('formula-preview')).toBeNull()
    expect(registry.getDefinition(PREVIEW_DEF_ID)).toBeNull()
  })

  it('the draft follows the buffer, and unmounting forgets it', () => {
    const { rerender, unmount } = render(<PreviewPane sym="NVDA" tf="D" settings={null} definition={draft('sma(close, 20)')} />)
    rerender(<PreviewPane sym="NVDA" tf="D" settings={null} definition={draft('ema(close, 9)')} />)
    expect(registry.getDefinition(PREVIEW_DEF_ID).compute.source).toBe('ema(close, 9)')
    unmount()
    expect(registry.getDefinition(PREVIEW_DEF_ID)).toBeNull()
  })
})

// ─── WHY IT IS INERT, NOT MERELY THAT IT IS ────────────────────────────────
//
// ⛔⛔ `null` IS THE SAME OBSERVABLE FOR THREE DIFFERENT REASONS: a refused
// draft, an unknown symbol/timeframe, and a registry that refused the install.
// A pane that had been broken outright — an import typo, a `return null` left
// at the top, a `styles.preview` that throws — would satisfy every "renders
// nothing" case above and read as CORRECTLY INERT. So each reason is cut ONE
// AT A TIME, on the SAME fixture, and the pane is then made to RENDER by
// restoring only the thing that was missing. What moves is the discriminator.
describe('the reason it is inert, isolated', () => {
  const good = () => draft('sma(close, 20)')

  it('the DEFINITION is the reason: same sym/tf, null draft is inert — hand it the draft and the SAME mount renders', () => {
    const { rerender } = render(<PreviewPane sym="NVDA" tf="D" settings={null} definition={null} />)
    expect(screen.queryByTestId('formula-preview')).toBeNull()
    expect(registry.listUserDefinitions().map((d) => d.id)).not.toContain(PREVIEW_DEF_ID)

    rerender(<PreviewPane sym="NVDA" tf="D" settings={null} definition={good()} />)
    expect(screen.getByTestId('formula-preview')).toBeTruthy()
    expect(registry.listUserDefinitions().map((d) => d.id)).toContain(PREVIEW_DEF_ID)
  })

  it('the SYMBOL is the reason: same draft, no sym is inert — give it a sym and the SAME mount renders', () => {
    const def = good()
    const { rerender } = render(<PreviewPane sym={null} tf="D" settings={null} definition={def} />)
    expect(screen.queryByTestId('formula-preview')).toBeNull()
    expect(registry.listUserDefinitions().map((d) => d.id)).not.toContain(PREVIEW_DEF_ID)

    rerender(<PreviewPane sym="NVDA" tf="D" settings={null} definition={def} />)
    expect(screen.getByTestId('formula-preview')).toBeTruthy()
    expect(chartPaneSpy.mock.calls.at(-1)[0].sym).toBe('NVDA')
  })

  it('the TIMEFRAME is the reason: same draft, no tf is inert — give it a tf and the SAME mount renders', () => {
    const def = good()
    const { rerender } = render(<PreviewPane sym="NVDA" tf={null} settings={null} definition={def} />)
    expect(screen.queryByTestId('formula-preview')).toBeNull()
    expect(registry.listUserDefinitions().map((d) => d.id)).not.toContain(PREVIEW_DEF_ID)

    rerender(<PreviewPane sym="NVDA" tf="D" settings={null} definition={def} />)
    expect(screen.getByTestId('formula-preview')).toBeTruthy()
    expect(chartPaneSpy.mock.calls.at(-1)[0].tf).toBe('D')
  })

  it('a draft that goes BACK to refused takes the entry out of the registry LISTING, not just out of getDefinition', () => {
    const { rerender } = render(<PreviewPane sym="NVDA" tf="D" settings={null} definition={good()} />)
    expect(registry.listUserDefinitions().map((d) => d.id)).toContain(PREVIEW_DEF_ID)

    // The member types one more character and the formula stops parsing.
    rerender(<PreviewPane sym="NVDA" tf="D" settings={null} definition={null} />)
    expect(screen.queryByTestId('formula-preview')).toBeNull()
    // ⭐ THE LISTING, not `getDefinition` — a leaked preview entry would ride
    // `listUserDefinitions()` onto the member's real chart even if some other
    // lookup happened to miss it.
    expect(registry.listUserDefinitions().map((d) => d.id)).not.toContain(PREVIEW_DEF_ID)
  })

  it('unmounting leaves the registry LISTING exactly as it was found — a preview never outlives its sheet', () => {
    const before = registry.listUserDefinitions().map((d) => d.id)
    const { unmount } = render(<PreviewPane sym="NVDA" tf="D" settings={null} definition={good()} />)
    expect(registry.listUserDefinitions().map((d) => d.id)).toContain(PREVIEW_DEF_ID)
    unmount()
    expect(registry.listUserDefinitions().map((d) => d.id)).toEqual(before)
  })
})
