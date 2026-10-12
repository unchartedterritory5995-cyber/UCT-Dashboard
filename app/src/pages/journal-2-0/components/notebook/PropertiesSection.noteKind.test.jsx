/**
 * Notebook P1 (spec P1.2 / P1.7c): `builtin:note_kind` is a select over the member's kinds.
 * The "Add property" list OFFERS it only while the journal-styles switch is on; a note that
 * already holds a Kind of note shows it either way -- the switch gates creating, never rendering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { JOURNAL_STYLES_FLAG } from '../../lib/journalStylesFlag'

const state = vi.hoisted(() => ({ noteKindValue: null }))

const makeProps = () => [
  { id: 'builtin:thesis_status', name: 'Thesis Status', type: 'select', source: 'user_set', value: null,
    options: [{ id: 'watching', label: 'Watching', color: 'blue' }] },
  { id: 'builtin:note_kind', name: 'Kind of note', type: 'select', source: 'user_set', value: state.noteKindValue,
    options: [{ id: 'trade_plan', label: 'Trade plan', color: 'gray' }] },
]

vi.mock('../../hooks/useNoteProperties', () => ({
  default: () => ({ properties: makeProps(), isLoading: false, refresh: vi.fn(async () => ({})) }),
}))
vi.mock('../../hooks/useJ2PropertyDefs', () => ({
  default: () => ({ propertyDefs: makeProps(), create: vi.fn(), updateConfig: vi.fn(), refresh: vi.fn() }),
}))

import PropertiesSection from './PropertiesSection'

const renderSection = ({ noteKindValue = null } = {}) => {
  state.noteKindValue = noteKindValue
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PropertiesSection noteId="n1" updateNote={vi.fn()} />
    </SWRConfig>,
  )
}

beforeEach(() => {
  __resetNotebookFlags()
  state.noteKindValue = null
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Kind of note in the property section', () => {
  it('Add property offers Kind of note only while the switch is on', async () => {
    // switch OFF: the picker lists the other empty property, and not this one (CONTROL: it lists something)
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /add property/i }))
    expect(screen.getByText('Thesis Status')).toBeTruthy()
    expect(screen.queryByText('Kind of note')).toBeNull()
    cleanup()
    // switch ON
    __resetNotebookFlags()
    latchNotebookFlags({ [JOURNAL_STYLES_FLAG]: true })
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /add property/i }))
    expect(screen.getByText('Thesis Status')).toBeTruthy()
    expect(screen.getByText('Kind of note')).toBeTruthy()
  })

  it('a note that already has a Kind of note shows it with the switch off', async () => {
    renderSection({ noteKindValue: 'trade_plan' })
    expect(await screen.findByText('Kind of note')).toBeTruthy()
    expect(document.querySelector('li[data-prop-row="builtin:note_kind"]')).toBeTruthy()
  })
})
