/**
 * Wave 11 (lane 11B): formula + rollup properties in the note's Properties section.
 *   * ⛔ FLAG OFF: the type picker offers exactly the old eight types and the
 *     section makes no saved-views request;
 *   * FLAG ON: Formula and Rollup are offered; creating either sends its config;
 *   * a computed row is read-only, says WHY it is empty, and edits in place
 *     (Save sends the config; Escape closes and keeps focus).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

let notePropsResult
let defsResult
const createDefSpy = vi.fn(async (name, type) => ({ id: `new-${name}`, name, type }))
const updateConfigSpy = vi.fn(async () => {})
const refreshDefsSpy = vi.fn(async () => {})

vi.mock('../../hooks/useNoteProperties', () => ({ default: () => notePropsResult }))
vi.mock('../../hooks/useJ2PropertyDefs', () => ({
  default: () => ({
    propertyDefs: defsResult, create: createDefSpy, updateConfig: updateConfigSpy, refresh: refreshDefsSpy,
  }),
}))

import PropertiesSection from './PropertiesSection'

const NUMBERS = [
  { id: 'e1', name: 'Entry', type: 'number', source: 'user_set' },
  { id: 's1', name: 'Stop', type: 'number', source: 'user_set' },
  { id: 'x1', name: 'Exit', type: 'number', source: 'user_set' },
]
const R_DEF = {
  id: 'r1', name: 'R', type: 'formula', source: 'user_set', computed: true,
  config: { expression: '({@x1} - {@e1}) / ({@e1} - {@s1})' },
}
const fetchSpy = vi.fn(async (url) => ({
  ok: true,
  json: async () => (String(url).includes('saved-views') ? { savedViews: [{ id: 'v1', name: 'Closed trades' }] } : {}),
}))

function renderSection() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PropertiesSection noteId="n1" updateNote={vi.fn()} />
    </SWRConfig>,
  )
}

async function openNewPropertyForm(user) {
  await user.click(screen.getByRole('button', { name: 'Add property' }))
  await user.click(screen.getByRole('button', { name: '+ New property…' }))
}

beforeEach(() => {
  createDefSpy.mockClear()
  updateConfigSpy.mockClear()
  fetchSpy.mockClear()
  vi.stubGlobal('fetch', fetchSpy)
  defsResult = [...NUMBERS]
  notePropsResult = { properties: [], isLoading: false, refresh: vi.fn(async () => ({})) }
  __resetNotebookFlags()
})
afterEach(() => {
  vi.unstubAllGlobals()
  __resetNotebookFlags()
})

describe('⛔ flag OFF — nothing about the section changes', () => {
  beforeEach(() => latchNotebookFlags({ notebook_formulas_enabled: false }))

  it('the type picker offers exactly the old types, and no saved-views request is made', async () => {
    const user = userEvent.setup()
    renderSection()
    await openNewPropertyForm(user)
    const types = within(screen.getByRole('combobox', { name: 'Property type' }))
      .getAllByRole('option').map((o) => o.textContent)
    expect(types).toEqual(['Text', 'Number', 'Select', 'Multi-select', 'Date', 'Checkbox', 'URL', 'Relation'])
    expect(fetchSpy.mock.calls.some(([u]) => String(u).includes('saved-views'))).toBe(false)
  })
})

describe('flag ON', () => {
  beforeEach(() => latchNotebookFlags({ notebook_formulas_enabled: true }))

  it('offers Formula and Rollup after the ordinary types', async () => {
    const user = userEvent.setup()
    renderSection()
    await openNewPropertyForm(user)
    const types = within(screen.getByRole('combobox', { name: 'Property type' }))
      .getAllByRole('option').map((o) => o.textContent)
    expect(types.slice(-2)).toEqual(['Formula', 'Rollup'])
  })

  it('creates a formula from a starter, stored with property ids; Create waits for a valid formula', async () => {
    const user = userEvent.setup()
    renderSection()
    await openNewPropertyForm(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Property type' }), 'formula')
    const create = screen.getByRole('button', { name: 'Create' })
    expect(create.disabled).toBe(true)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Start from a trader formula' }), 'r_multiple')
    expect(screen.getByRole('textbox', { name: 'Property name' }).value).toBe('R-multiple')
    expect(create.disabled).toBe(false)
    await user.click(create)
    await waitFor(() => expect(createDefSpy).toHaveBeenCalled())
    expect(createDefSpy).toHaveBeenCalledWith('R-multiple', 'formula', undefined,
      { expression: '({@x1} - {@e1}) / ({@e1} - {@s1})' })
  })

  it('a formula that does not read correctly keeps Create disabled and says why', async () => {
    const user = userEvent.setup()
    renderSection()
    await openNewPropertyForm(user)
    await user.type(screen.getByRole('textbox', { name: 'Property name' }), 'Bad')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Property type' }), 'formula')
    await user.type(screen.getByRole('textbox', { name: 'Formula' }), '{{Entry} +')
    expect(screen.getByRole('button', { name: 'Create' }).disabled).toBe(true)
    expect(screen.getByText(/ends too soon/)).toBeTruthy()
  })

  it('creates a rollup: average of R across the notes this note links to', async () => {
    defsResult = [...NUMBERS, R_DEF]
    const user = userEvent.setup()
    renderSection()
    await openNewPropertyForm(user)
    await user.type(screen.getByRole('textbox', { name: 'Property name' }), 'Avg R')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Property type' }), 'rollup')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Summarise' }), 'links_from_this')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Calculate' }), 'avg')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Of the property' }), 'r1')
    expect(screen.getByText('Average of R across notes this note links to')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(createDefSpy).toHaveBeenCalled())
    expect(createDefSpy).toHaveBeenCalledWith('Avg R', 'rollup', undefined,
      { source: 'links_from_this', aggregate: 'avg', propertyId: 'r1' })
  })

  it('a rollup over a saved view lists the member saved views', async () => {
    const user = userEvent.setup()
    renderSection()
    await openNewPropertyForm(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Property type' }), 'rollup')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Summarise' }), 'saved_view')
    const view = await screen.findByRole('combobox', { name: 'Saved view' })
    await waitFor(() => expect(within(view).getAllByRole('option').map((o) => o.textContent)).toContain('Closed trades'))
  })

  it('a computed row shows its value read-only, and an empty one says why (in text, not only on hover)', () => {
    defsResult = [...NUMBERS, R_DEF]
    notePropsResult = {
      isLoading: false, refresh: vi.fn(),
      properties: [
        { ...NUMBERS[0], value: 100 },
        { ...R_DEF, value: null, computedValue: { value: null, reason: 'Division by zero', kind: 'formula' } },
      ],
    }
    renderSection()
    expect(screen.getByText('R')).toBeTruthy()
    expect(screen.getByText('No value: Division by zero')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/)
    expect(screen.getByRole('button', { name: 'Edit formula R' })).toBeTruthy()
  })

  it('edits a formula in place by name; Save sends ids; a server refusal is shown as text', async () => {
    defsResult = [...NUMBERS, R_DEF]
    notePropsResult = {
      isLoading: false, refresh: vi.fn(async () => ({})),
      properties: [{ ...NUMBERS[0], value: 100 }, { ...R_DEF, value: 2, computedValue: { value: 2, kind: 'formula' } }],
    }
    const user = userEvent.setup()
    renderSection()
    await user.click(screen.getByRole('button', { name: 'Edit formula R' }))
    const box = screen.getByRole('textbox', { name: 'Formula' })
    expect(box.value).toBe('({Exit} - {Entry}) / ({Entry} - {Stop})')
    await user.clear(box)
    await user.type(box, 'abs({{Entry} - {{Stop})')
    updateConfigSpy.mockRejectedValueOnce(new Error('Circular reference: R -> Risk -> R.'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Circular reference: R -> Risk -> R.')
    expect(updateConfigSpy).toHaveBeenCalledWith('r1', { expression: 'abs({@e1} - {@s1})' })
  })

  it('KEYBOARD: Escape closes the in-place editor and focus lands back on its row', async () => {
    defsResult = [...NUMBERS, R_DEF]
    notePropsResult = {
      isLoading: false, refresh: vi.fn(async () => ({})),
      properties: [{ ...NUMBERS[0], value: 100 }, { ...R_DEF, value: 2, computedValue: { value: 2, kind: 'formula' } }],
    }
    const user = userEvent.setup()
    renderSection()
    const edit = screen.getByRole('button', { name: 'Edit formula R' })
    edit.focus()
    await user.keyboard('{Enter}')
    expect(edit.getAttribute('aria-expanded')).toBe('true')
    screen.getByRole('textbox', { name: 'Formula' }).focus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('textbox', { name: 'Formula' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit formula R' })))
  })

  it('a formula row appears once an input it reads has a value, without adding it by hand', () => {
    defsResult = [...NUMBERS, R_DEF]
    notePropsResult = {
      isLoading: false, refresh: vi.fn(),
      properties: [
        { ...NUMBERS[0], value: 100 }, { ...NUMBERS[1], value: null }, { ...NUMBERS[2], value: null },
        { ...R_DEF, value: null, computedValue: { value: null, reason: 'Exit is empty', kind: 'formula' } },
      ],
    }
    renderSection()
    expect(screen.getByText('No value: Exit is empty')).toBeTruthy()
  })

  it('...and stays out of a note that has none of its inputs', () => {
    defsResult = [...NUMBERS, R_DEF]
    notePropsResult = {
      isLoading: false, refresh: vi.fn(),
      properties: [
        { ...NUMBERS[0], value: null },
        { ...R_DEF, value: null, computedValue: { value: null, reason: 'Entry is empty', kind: 'formula' } },
      ],
    }
    renderSection()
    expect(screen.queryByText('R')).toBeNull()
  })
})
