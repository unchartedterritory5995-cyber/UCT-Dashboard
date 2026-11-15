// Go-live wave 1, fix round 2 (first-open bytes): the rollup editor is a chunk of its own, drawn straight from a warmed
// slot (PropertiesSection.jsx's RollupEditorSlot). With the chunk in hand it is drawn in the same act as the press; a
// fetch that fails is said, never thrown, and asked for again on the next open.
import { Component, useState } from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

let notePropsResult = { properties: [], isLoading: false, refresh: async () => ({}) }
let defsResult = []
vi.mock('../../hooks/useNoteProperties', () => ({ default: () => notePropsResult }))
vi.mock('../../hooks/useJ2PropertyDefs', () => ({
  default: () => ({ propertyDefs: defsResult, create: vi.fn(), updateConfig: vi.fn(async () => {}), refresh: vi.fn(async () => {}) }),
}))

import PropertiesSection, { RollupEditorSlot, rollupEditorLoaders, rollupEditorModule, ROLLUP_EDITOR_UNAVAILABLE } from './PropertiesSection'
const ROLLUP_DEF = {
  id: 'ro1', name: 'Linked count', type: 'rollup', source: 'user_set', computed: true,
  config: { source: 'linked', aggregate: 'count' },
}
import { rollupReady as fromComputed } from '../../lib/formula/computed'
import { rollupReady as fromEditor } from './RollupEditor'

const REAL = { ...rollupEditorLoaders }

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
      {open && <RollupEditorSlot value={{}} onChange={() => {}} defs={[]} savedViews={[]} />}
    </div>
  )
}

beforeEach(() => { rollupEditorModule.resetForTests() })
afterEach(() => { Object.assign(rollupEditorLoaders, REAL); rollupEditorModule.resetForTests() })

describe('the rollup editor slot', () => {
  it('with the chunk in hand, Edit draws the real editor in the same act', async () => {
    await rollupEditorModule.warm()
    render(<Panel />)
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Edit' })) })
    expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0)
  })

  it('a failed fetch is said, never thrown, and the next open asks again', async () => {
    rollupEditorLoaders.editor = () => Promise.reject(new Error('boom'))
    render(<Boundary><Panel /></Boundary>)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect((await screen.findByRole('alert')).textContent).toBe(ROLLUP_EDITOR_UNAVAILABLE)
    expect(screen.queryByTestId('boundary')).toBeNull()
    rollupEditorLoaders.editor = REAL.editor
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0))
  })

  // Final fix (B3): an EXISTING complete rollup is ready before its editor is drawn; Save waits for the editor, so a
  // click aimed at it cannot land on what the late editor pushes under the pointer.
  it('an existing complete rollup: Save stays disabled until its editor is drawn', async () => {
    let resolve
    const held = new Promise((r) => { resolve = r })
    rollupEditorLoaders.editor = () => held
    defsResult = [ROLLUP_DEF]
    notePropsResult = {
      isLoading: false, refresh: vi.fn(async () => ({})),
      properties: [{ ...ROLLUP_DEF, value: 3, computedValue: { value: 3, kind: 'rollup' } }],
    }
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><PropertiesSection noteId="n1" updateNote={vi.fn()} /></SWRConfig>)
    fireEvent.click(screen.getByRole('button', { name: 'Edit rollup Linked count' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await act(async () => { resolve(await REAL.editor()) })
    expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('rollupReady is one function, read from computed.js', () => {
    expect(fromEditor).toBe(fromComputed)
    expect(fromComputed({ source: 'linked', aggregate: 'count' })).toBe(true)
    expect(fromComputed({ source: 'saved_view', aggregate: 'count' })).toBe(false)
  })

  it('PropertiesSection never imports the editor statically (it would ride the first open again)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, 'PropertiesSection.jsx'), 'utf8')
    expect(src).toMatch(/import\('\.\/RollupEditor'\)/)
    expect(src).not.toMatch(/^import [^;]*from '\.\/RollupEditor'/m)
  })
})
