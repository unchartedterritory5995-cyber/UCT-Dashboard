/**
 * Notebook P1 (spec P1.2 / P1.7c): `builtin:note_kind` is a select over the member's kinds.
 * The "Add property" list OFFERS it only while the journal-styles switch is on; a note that
 * already holds one shows it either way -- the switch gates creating, never rendering.
 *
 * Simplify pass 2, Task 1 fix round 1: the member reads this property as "Note type". The server still names it
 * "Kind of note", so the REAL hooks run here over the server's payload (the network is the only stand-in): the
 * rename happens where the client reads the property, and its id and key are unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { JOURNAL_STYLES_FLAG } from '../../lib/journalStylesFlag'
import PropertiesSection from './PropertiesSection'

const state = { noteKindValue: null }

// The server's own words for the two properties (note_properties.py names this one "Kind of note").
const serverProps = () => [
  { id: 'builtin:thesis_status', name: 'Thesis Status', type: 'select', source: 'user_set', value: null,
    options: [{ id: 'watching', label: 'Watching', color: 'blue' }] },
  { id: 'builtin:note_kind', name: 'Kind of note', type: 'select', source: 'user_set', value: state.noteKindValue,
    options: [{ id: 'trade_plan', label: 'Trade plan', color: 'gray' }] },
]

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
  vi.stubGlobal('fetch', vi.fn(async (input) => {
    const url = String(input)
    const body = url.endsWith('/api/j2/notes/n1/properties') ? { properties: serverProps() }
      : url.endsWith('/api/j2/property-defs') ? { propertyDefs: serverProps().map(({ value, ...d }) => d) }
        : {}
    return { ok: true, status: 200, json: async () => body }
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Note type (builtin:note_kind) in the property section', () => {
  it('Add property offers Note type only while the switch is on', async () => {
    // switch OFF: the picker lists the other empty property, and not this one (CONTROL: it lists something)
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /add property/i }))
    expect(await screen.findByText('Thesis Status')).toBeTruthy()
    expect(screen.queryByText('Note type')).toBeNull()
    cleanup()
    // switch ON
    __resetNotebookFlags()
    latchNotebookFlags({ [JOURNAL_STYLES_FLAG]: true })
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /add property/i }))
    expect(await screen.findByText('Thesis Status')).toBeTruthy()
    expect(await screen.findByText('Note type')).toBeTruthy()
    expect(screen.queryByText('Kind of note')).toBeNull()
  })

  it('a note that already has a note type shows it, named "Note type", with the switch off', async () => {
    renderSection({ noteKindValue: 'trade_plan' })
    expect(await screen.findByText('Note type')).toBeTruthy()
    expect(screen.queryByText('Kind of note')).toBeNull()
    expect(document.querySelector('li[data-prop-row="builtin:note_kind"]')).toBeTruthy()
  })
})
