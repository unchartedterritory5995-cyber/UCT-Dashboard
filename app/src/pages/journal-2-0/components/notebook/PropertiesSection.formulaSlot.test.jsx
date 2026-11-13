// Follow-up B, item 3c: the formula editor is held the way the rollup editor is (PropertiesSection.jsx's
// FormulaEditorSlot): with the chunk in hand it is drawn in the same act as the press (a `lazyChunk` in a Suspense held
// the reveal back about 300 ms, so a letter typed straight away could land elsewhere); it is warmed when the add form
// opens; a fetch that fails is said, never thrown, and asked for again on the next open.
import { Component, useState } from 'react'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

let notePropsResult = { properties: [], isLoading: false, refresh: async () => ({}) }
vi.mock('../../hooks/useNoteProperties', () => ({ default: () => notePropsResult }))
vi.mock('../../hooks/useJ2PropertyDefs', () => ({
  default: () => ({ propertyDefs: [], create: vi.fn(), updateConfig: vi.fn(async () => {}), refresh: vi.fn(async () => {}) }),
}))

import PropertiesSection, {
  FormulaEditorSlot, FORMULA_EDITOR_UNAVAILABLE, formulaEditorLoaders, formulaEditorModule,
} from './PropertiesSection'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'

const REAL = { ...formulaEditorLoaders }

class Boundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() { return this.state.error ? <p data-testid="boundary">{String(this.state.error)}</p> : this.props.children }
}

function Panel() {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)}>Edit</button>
      {open && <FormulaEditorSlot value="" onChange={() => {}} defs={[]} previewProps={{}} />}
    </div>
  )
}
// The editor's first thing on screen: the trader formulas (its text box is folded under "Write your own").
const formulaBox = () => screen.queryByRole('group', { name: 'Start from a trader formula' })

beforeEach(() => { formulaEditorModule.resetForTests(); __resetNotebookFlags() })
afterEach(() => { Object.assign(formulaEditorLoaders, REAL); formulaEditorModule.resetForTests(); __resetNotebookFlags() })

describe('the formula editor slot', () => {
  it('with the chunk in hand, Edit draws the real editor in the same act (no Suspense hold)', async () => {
    await formulaEditorModule.warm()
    render(<Panel />)
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Edit' })) })
    expect(formulaBox()).not.toBeNull()
  })

  it('a failed fetch is said, never thrown, and the next open asks again', async () => {
    formulaEditorLoaders.editor = () => Promise.reject(new Error('boom'))
    render(<Boundary><Panel /></Boundary>)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect((await screen.findByRole('alert')).textContent).toBe(FORMULA_EDITOR_UNAVAILABLE)
    expect(screen.queryByTestId('boundary')).toBeNull()
    formulaEditorLoaders.editor = REAL.editor
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(formulaBox()).not.toBeNull())
  })

  it('opening Add property warms it (formulas on), so "Add a formula" draws the editor at once', async () => {
    latchNotebookFlags({ notebook_formulas_enabled: true })
    const load = vi.fn(REAL.editor)
    formulaEditorLoaders.editor = load
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><PropertiesSection noteId="n1" updateNote={vi.fn()} /></SWRConfig>)
    expect(load).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Add property/ }))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    await act(async () => { await formulaEditorModule.warm() })   // the same fetch, already in flight
    expect(load).toHaveBeenCalledTimes(1)
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Add a formula' })) })
    expect(formulaBox()).not.toBeNull()
  })

  it('CONTROL: formulas off, opening Add property fetches nothing', async () => {
    latchNotebookFlags({ notebook_formulas_enabled: false })
    const load = vi.fn(REAL.editor)
    formulaEditorLoaders.editor = load
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><PropertiesSection noteId="n1" updateNote={vi.fn()} /></SWRConfig>)
    fireEvent.click(screen.getByRole('button', { name: /Add property/ }))
    await new Promise((r) => setTimeout(r, 30))
    expect(load).not.toHaveBeenCalled()
  })
})
