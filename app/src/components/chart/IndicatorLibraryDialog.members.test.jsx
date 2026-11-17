// Members' indicators from the library sheet: the path a phone and a tablet have.
//
// Measured on production 2026-11-16 at 820 and 390 px: the Indicators window (where the
// Members tab lives) is not offered at those sizes. This sheet is the indicators surface
// there, so it opens the same list itself.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor, within } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from './engine/nativeRegistry'
import { mergeChartSettings } from './chartDefaults'
import { buildDefinition } from './builder/BuilderSheet'
import { evaluateFormula } from './builder/FormulaField'
import { BUILDER_INPUTS, BUILDER_INPUT_SCOPE } from './builder/builderInputs'

const H = vi.hoisted(() => ({ library: null, install: null }))
vi.mock('../../hooks/useUserDefinitions', async (orig) => ({
  ...(await orig()),
  fetchDefinitionLibrary: vi.fn((...a) => H.library(...a)),
  installSharedDefinition: vi.fn((...a) => H.install(...a)),
}))

import IndicatorLibraryDialog from './IndicatorLibraryDialog'

const ENTRIES = [
  { token: 'sh_one', name: 'Tight Weekly Closes', shortName: 'TWC', description: 'Three weekly closes within one percent',
    repaint: 'non-repainting', placement: 'overlay', inputs: 2 },
  { token: 'sh_two', name: 'Up Down Volume', shortName: null, description: '', repaint: 'repaints', placement: 'pane', inputs: 0 },
]
const settings = mergeChartSettings(JSON.stringify({}))
function mount(props = {}) {
  const writes = []
  const onClose = vi.fn()
  render(<IndicatorLibraryDialog open onClose={onClose} settings={settings} onChange={(n) => writes.push(n)}
    registry={registry} {...props} />)
  return { writes, onClose }
}

afterEach(() => { cleanup(); registry.clearUserDefinitions(); H.library = null; H.install = null })

describe('the library sheet opens the members list', () => {
  it('offers "Members\' indicators" whatever is typed, and fetches nothing until it is pressed', () => {
    H.library = vi.fn(async () => ({ ok: true, entries: ENTRIES, next: null }))
    mount()
    const row = screen.getByTestId('library-members')
    expect(row).toHaveTextContent("Members' indicators")
    expect(row).toHaveTextContent(/other members chose to publish/i)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzz no such indicator' } })
    expect(screen.getByTestId('library-members')).toBeInTheDocument()
    expect(H.library).not.toHaveBeenCalled()
  })

  it('a press swaps the sheet to the list, with its own empty search box and a way back', async () => {
    H.library = async () => ({ ok: true, entries: ENTRIES, next: null })
    mount()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'rsi' } })
    await act(async () => { fireEvent.click(screen.getByTestId('library-members')) })
    expect(screen.getByTestId('library-members-view')).toBeInTheDocument()
    expect(screen.queryByTestId('library-members')).toBeNull()                 // the catalogue is not under it
    expect(screen.getByRole('searchbox').value).toBe('')                       // "rsi" was a catalogue search
    await waitFor(() => expect(screen.getAllByTestId('members-entry')).toHaveLength(2))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'volume' } })
    expect(screen.getAllByTestId('members-entry').map((r) => r.dataset.token)).toEqual(['sh_two'])
    await act(async () => { fireEvent.click(screen.getByTestId('library-members-back')) })
    expect(screen.queryByTestId('library-members-view')).toBeNull()
    expect(screen.getByTestId('library-members')).toBeInTheDocument()
    expect(screen.getByRole('searchbox').value).toBe('')
  })

  it('install, then "Put it on this chart": one settings write with the copy on it, and the sheet closes', async () => {
    const r = evaluateFormula('sma(close, 20)', BUILDER_INPUT_SCOPE)
    const def = buildDefinition({ defId: 'u_phonecopy0001', name: 'Tight Weekly Closes', source: r.source, ast: r.ast,
      mode: r.verdict.mode, readback: r.readback, inputs: BUILDER_INPUTS })
    H.library = async () => ({ ok: true, entries: ENTRIES, next: null })
    H.install = async () => { registry.installUserDefinitions([def]); return { ok: true, row: { def_id: def.id, version: 1 } } }
    const { writes, onClose } = mount()
    await act(async () => { fireEvent.click(screen.getByTestId('library-members')) })
    await waitFor(() => expect(screen.getAllByTestId('members-entry')).toHaveLength(2))
    const first = () => screen.getAllByTestId('members-entry')[0]
    await act(async () => { fireEvent.click(within(first()).getByTestId('members-install')) })
    expect(writes).toHaveLength(0)                                             // installing writes nothing to the chart
    await waitFor(() => expect(within(first()).getByTestId('members-put-on-chart').disabled).toBe(false))
    await act(async () => { fireEvent.click(within(first()).getByTestId('members-put-on-chart')) })
    expect(writes).toHaveLength(1)
    expect((writes[0].indicatorInstances || []).filter((i) => i.defId === def.id)).toHaveLength(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closed and reopened, the sheet is back on the catalogue', async () => {
    H.library = async () => ({ ok: true, entries: [], next: null })
    const { rerender } = render(<IndicatorLibraryDialog open onClose={() => {}} settings={settings} onChange={() => {}} registry={registry} />)
    await act(async () => { fireEvent.click(screen.getByTestId('library-members')) })
    expect(screen.getByTestId('library-members-view')).toBeInTheDocument()
    rerender(<IndicatorLibraryDialog open={false} onClose={() => {}} settings={settings} onChange={() => {}} registry={registry} />)
    rerender(<IndicatorLibraryDialog open onClose={() => {}} settings={settings} onChange={() => {}} registry={registry} />)
    expect(screen.queryByTestId('library-members-view')).toBeNull()
    expect(screen.getByTestId('library-members')).toBeInTheDocument()
  })
})

describe('the list\'s own stylesheet, for where no host supplies one (read from source)', () => {
  const css = fs.readFileSync(path.resolve(__dirname, './IndicatorMembersTab.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const jsx = fs.readFileSync(path.resolve(__dirname, './IndicatorMembersTab.jsx'), 'utf8')

  it('defines every class the component reads, so none is a silent no-op', () => {
    const used = [...new Set([...jsx.matchAll(/styles\.([A-Za-z]+)/g)].map((m) => m[1]))]
    expect(used.length).toBeGreaterThan(10)                                    // control: the reader found them
    for (const k of used) expect(css, `.${k} is read by the component and not defined`).toMatch(new RegExp(`\\.${k}\\b`))
  })

  it('the press target is at least the tap minimum, and every variable has a fallback', () => {
    const action = css.match(/\.resAction \{([^}]*)\}/)
    expect(action).not.toBeNull()
    expect(action[1]).toMatch(/min-height:\s*var\(--tap-min, 44px\)/)
    const bare = [...css.matchAll(/var\(--[a-z-]+\)/g)].map((m) => m[0])
    expect(bare, `variables with no fallback: ${bare.join(' ')}`).toEqual([])
  })
})
