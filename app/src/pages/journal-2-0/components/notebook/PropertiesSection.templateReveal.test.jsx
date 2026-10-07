/**
 * Wave 12, lane 12B-2: a note just made from the Position Tracker shows the template's
 * definitions while they are still EMPTY. The section hides an empty property by design,
 * so without the reveal a fresh tracker would show only "Add property". The reveal is per
 * note: another note's empty properties stay hidden.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { __resetTemplateReveals, rememberTemplateReveal } from '../../lib/templatePropertyDefs'

const PROPS = [
  { id: 'e1', name: 'Entry', type: 'number', source: 'user_set', value: null },
  { id: 's1', name: 'Stop', type: 'number', source: 'user_set', value: null },
  { id: 'q1', name: 'Mood', type: 'text', source: 'user_set', value: null },
]

vi.mock('../../hooks/useNoteProperties', () => ({
  default: () => ({ properties: PROPS, isLoading: false, refresh: vi.fn(async () => ({})) }),
}))
vi.mock('../../hooks/useJ2PropertyDefs', () => ({
  default: () => ({ propertyDefs: PROPS, create: vi.fn(), updateConfig: vi.fn(), refresh: vi.fn() }),
}))

import PropertiesSection from './PropertiesSection'

const renderFor = (noteId) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <PropertiesSection noteId={noteId} updateNote={vi.fn()} />
  </SWRConfig>,
)

beforeEach(() => {
  __resetNotebookFlags()
  __resetTemplateReveals()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })))
})
afterEach(() => vi.unstubAllGlobals())

describe('12B-2 -- the template reveal', () => {
  it('a note made from the template shows its empty definitions, and only those', () => {
    rememberTemplateReveal('fresh', ['e1', 's1'])
    renderFor('fresh')
    const rows = [...document.querySelectorAll('li[data-prop-row]')].map((li) => li.getAttribute('data-prop-row'))
    expect(rows).toEqual(['e1', 's1'])
  })

  it('CONTROL: any other note keeps empty properties hidden behind "Add property"', () => {
    rememberTemplateReveal('fresh', ['e1', 's1'])
    renderFor('other')
    expect(document.querySelectorAll('li[data-prop-row]')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Add property' })).toBeTruthy()
  })
})
