import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

/**
 * Notebook P1 (Task 14): "Save this note's setup as a style" in the note menu. The editor's pending words
 * go first (onBeforeTemplate); a refusal to flush stops everything; with the switch off the button is
 * absent. The network is mocked at lane B's client module boundary (createJournalStyle + the list).
 */
const createJournalStyle = vi.fn()
const fetchJournalStyles = vi.fn()
vi.mock('../../lib/journalStyles', async (importOriginal) => ({
  ...(await importOriginal()),
  createJournalStyle: (...a) => createJournalStyle(...a),
  fetchJournalStyles: (...a) => fetchJournalStyles(...a),
}))

import NoteMenuActions from './NoteMenuActions'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { BUILTIN_NOTE_KINDS } from '../../lib/noteKinds'

const LIST = { kinds: BUILTIN_NOTE_KINDS.map((k) => ({ ...k, builtin: true })), styles: [], blockKinds: [] }
const NOTE = { id: 'n1', title: 'NVDA plan', kindId: 'trade_plan' }
const BTN = { name: "Save this note's setup as a style" }

function renderMenu(props = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NoteMenuActions note={NOTE} onBeforeTemplate={async () => true} {...props} />
    </SWRConfig>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchJournalStyles.mockResolvedValue(LIST)
  createJournalStyle.mockImplementation(async (body) => ({ style: { id: 's9', name: body.name } }))
  latchNotebookFlags({ notebook_journal_styles_enabled: true })
})
afterEach(() => __resetNotebookFlags())

describe('Save this note\'s setup as a style', () => {
  it('sends the editor\'s words first, names it, and creates the style from the note', async () => {
    const order = []
    const onBeforeTemplate = vi.fn(async () => { order.push('flush'); return true })
    createJournalStyle.mockImplementation(async (body) => { order.push('create'); return { style: { id: 's9', name: body.name } } })
    renderMenu({ onBeforeTemplate })
    fireEvent.click(screen.getByRole('button', BTN))
    const name = await screen.findByRole('textbox', { name: 'Style name' })
    expect(name).toHaveValue('NVDA plan')
    const kind = await screen.findByRole('combobox', { name: 'Kind of note' })
    await waitFor(() => expect(kind).toHaveValue('trade_plan'))
    fireEvent.change(name, { target: { value: 'My trade plan' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save style' }))
    expect(await screen.findByText('Saved as the style “My trade plan”.')).toBeInTheDocument()
    expect(createJournalStyle).toHaveBeenCalledWith({ fromNoteId: 'n1', name: 'My trade plan', kindId: 'trade_plan' })
    expect(order[0]).toBe('flush')
    expect(order.at(-1)).toBe('create')
  })

  it('when words are still unsent it says so, shows no form and creates nothing', async () => {
    renderMenu({ onBeforeTemplate: async () => false })
    fireEvent.click(screen.getByRole('button', BTN))
    expect(await screen.findByText('Some words are still saving. Try again in a moment.')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Style name' })).toBeNull()
    expect(createJournalStyle).not.toHaveBeenCalled()
  })

  it('words that go unsent while the member is naming it stop the save', async () => {
    const flush = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    renderMenu({ onBeforeTemplate: flush })
    fireEvent.click(screen.getByRole('button', BTN))
    await screen.findByRole('textbox', { name: 'Style name' })
    fireEvent.click(screen.getByRole('button', { name: 'Save style' }))
    expect(await screen.findByText('Some words are still saving. Try again in a moment.')).toBeInTheDocument()
    expect(createJournalStyle).not.toHaveBeenCalled()
  })

  it('a refused create says nothing was saved', async () => {
    createJournalStyle.mockRejectedValue(Object.assign(new Error('Journal styles require a paid plan'), { status: 402 }))
    renderMenu()
    fireEvent.click(screen.getByRole('button', BTN))
    await screen.findByRole('textbox', { name: 'Style name' })
    fireEvent.click(screen.getByRole('button', { name: 'Save style' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Journal styles require a paid plan')
  })

  it('Cancel closes the form without creating anything', async () => {
    renderMenu()
    fireEvent.click(screen.getByRole('button', BTN))
    await screen.findByRole('textbox', { name: 'Style name' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Style name' })).toBeNull())
    expect(createJournalStyle).not.toHaveBeenCalled()
  })

  it('with the switch off the button is absent (and the list is never read)', () => {
    __resetNotebookFlags()
    renderMenu()
    expect(screen.queryByRole('button', BTN)).toBeNull()
    expect(screen.getByRole('button', { name: /Save as template/ })).toBeInTheDocument()
    expect(fetchJournalStyles).not.toHaveBeenCalled()
  })
})
