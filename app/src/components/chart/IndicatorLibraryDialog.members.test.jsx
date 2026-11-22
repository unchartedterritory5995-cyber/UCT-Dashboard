// Members' indicators from the library sheet: the path a phone and a tablet have.
//
// Measured on production 2026-11-16 at 820 and 390 px: the Indicators window (where the
// Members tab lives) is not offered at those sizes. This sheet is the indicators surface
// there, so it shows the same list itself: since 2026-11-17 as one of the choices of the sheet's
// "Showing" control (`libraryShelves.js`), where it used to be a door row with its own view.

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

/** Choose a list in the sheet's one "Showing" control (owner decision 2026-11-17, mock-up B). */
const show = async (value) => { await act(async () => { fireEvent.change(screen.getByTestId('library-shelf'), { target: { value } }) }) }
const shelf = () => screen.getByTestId('library-shelf')

describe('the library sheet shows the members list', () => {
  it('offers "Members\' indicators" in Showing whatever is typed, and fetches nothing until it is chosen', () => {
    H.library = vi.fn(async () => ({ ok: true, entries: ENTRIES, next: null }))
    mount()
    const option = within(shelf()).getByRole('option', { name: "Members' indicators" })
    expect(option.value).toBe('members')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzz no such indicator' } })
    expect(within(shelf()).getByRole('option', { name: "Members' indicators" })).toBeInTheDocument()
    expect(H.library).not.toHaveBeenCalled()
    // the two door rows this control replaced are gone: one way to a list, not two
    expect(screen.queryByTestId('library-members')).toBeNull()
    expect(screen.queryByTestId('library-house')).toBeNull()
  })

  it('choosing it shows the list in the SAME sheet, with an empty search box of its own; choosing another list leaves', async () => {
    H.library = async () => ({ ok: true, entries: ENTRIES, next: null })
    mount()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'rsi' } })
    await show('members')
    expect(screen.getByTestId('library-members-view')).toBeInTheDocument()
    expect(screen.getByRole('searchbox').value).toBe('')                       // "rsi" was a catalogue search
    expect(screen.getByRole('searchbox')).toHaveAccessibleName("Search members' indicators")
    expect(shelf().value).toBe('members')                                      // the control says where you are
    await waitFor(() => expect(screen.getAllByTestId('members-entry')).toHaveLength(2))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'volume' } })
    expect(screen.getAllByTestId('members-entry').map((r) => r.dataset.token)).toEqual(['sh_two'])
    await show('all')                                                          // no "back" first: one choice to any list
    expect(screen.queryByTestId('library-members-view')).toBeNull()
    expect(screen.getByRole('searchbox').value).toBe('')
    expect(screen.getByRole('searchbox')).toHaveAccessibleName('Search indicators')
  })

  it('install, then "Put it on this chart": one settings write with the copy on it, and the sheet closes', async () => {
    const r = evaluateFormula('sma(close, 20)', BUILDER_INPUT_SCOPE)
    const def = buildDefinition({ defId: 'u_phonecopy0001', name: 'Tight Weekly Closes', source: r.source, ast: r.ast,
      mode: r.verdict.mode, readback: r.readback, inputs: BUILDER_INPUTS })
    H.library = async () => ({ ok: true, entries: ENTRIES, next: null })
    H.install = async () => { registry.installUserDefinitions([def]); return { ok: true, row: { def_id: def.id, version: 1 } } }
    const { writes, onClose } = mount()
    await show('members')
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

  it('closed and reopened, the sheet is back on everything', async () => {
    H.library = async () => ({ ok: true, entries: [], next: null })
    const { rerender } = render(<IndicatorLibraryDialog open onClose={() => {}} settings={settings} onChange={() => {}} registry={registry} />)
    await show('members')
    expect(screen.getByTestId('library-members-view')).toBeInTheDocument()
    rerender(<IndicatorLibraryDialog open={false} onClose={() => {}} settings={settings} onChange={() => {}} registry={registry} />)
    rerender(<IndicatorLibraryDialog open onClose={() => {}} settings={settings} onChange={() => {}} registry={registry} />)
    expect(screen.queryByTestId('library-members-view')).toBeNull()
    expect(shelf().value).toBe('all')
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
