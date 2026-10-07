/**
 * Finish program, lane KEYS3 (Q9): Ask from the keyboard.
 *
 * A member with the caret in a note was 11 keys from the Ask field (8 Tabs round the page to a
 * skip link, Enter, 2 Tabs, Enter), and after asking, focus was LOST: the question field is
 * disabled while the answer streams, and a browser drops focus from a disabled field to the
 * page. On a phone-sized screen the next Tab then started again at the sheet's Close button
 * (6 Tabs to Insert). 18 and 24 keys against a budget of 9.
 *
 *   - the command palette's "Ask about this note" asks for a door the NOTE's Ask panel answers;
 *   - when the answer ends and focus was lost, focus goes to the answer (never to the field: on
 *     a phone that would raise the keyboard over the answer). A member who moved keeps their place.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import AskPanel from './AskPanel'
import { NOTEBOOK_DOORS, openNotebookDoor } from '../../lib/notebookDoors'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

function sse(events) {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ev of events) c.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`))
      c.close()
    },
  })
}
const SOURCE = {
  n: 1, type: 'note', label: 'NVDA thesis', citation: 'exact', snippet: 's',
  navigation: { kind: 'note', note_id: 'n1' }, location: {}, payload: {}, stance: null, truncated: false,
}
const EVENTS = [
  { type: 'sources', scope: 'note', scopeLabel: 'This note', sources: [SOURCE], coverageNotice: null, independentSources: 1, noAnswer: false },
  { type: 'delta', text: 'Margins fell [1].' },
  { type: 'final', answer: 'Margins fell [1].', cited: [1], invalidCitations: [] },
]
const serveAnswer = () => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, body: sse(EVENTS), json: async () => ({}) })
}

beforeEach(() => {
  vi.restoreAllMocks()
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_ask_insert_on: true })    // Q9 inserts the answer
})

describe('the note door opens Ask (lane KEYS3)', () => {
  it('a note\'s Ask panel answers the door: it opens with the cursor in the question field', async () => {
    render(<AskPanel scope="note" target="n1" />)
    expect(screen.queryByRole('dialog')).toBeNull()
    let took
    act(() => { took = openNotebookDoor(NOTEBOOK_DOORS.ASK) })
    expect(took).toBe(true)
    await screen.findByRole('dialog', { name: /^Ask / })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox')))
  })

  it('CONTROL: the Notebook-wide Ask (not a note\'s) does not answer the note door', () => {
    render(<AskPanel scope="notebook" />)
    let took
    act(() => { took = openNotebookDoor(NOTEBOOK_DOORS.ASK) })
    expect(took).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('focus after the answer (lane KEYS3)', () => {
  async function askAndLoseFocus() {
    serveAnswer()
    render(<AskPanel scope="note" target="n1" autoOpen onInsert={() => true} />)
    const box = screen.getByRole('textbox')
    // the panel puts the cursor in its field two frames after it opens: let that land first
    await waitFor(() => expect(document.activeElement).toBe(box))
    fireEvent.change(box, { target: { value: 'margins?' } })
    // What a browser does when the focused field becomes disabled: focus falls to the page.
    // jsdom keeps focus on a disabled field (and will not blur one), so the fall is made here,
    // an instant before the Enter that disables it.
    act(() => { box.blur() })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(document.activeElement).toBe(document.body)
    return box
  }

  it('focus lost with the disabled field goes to the answer when it ends, and Insert is 3 stops on', async () => {
    await askAndLoseFocus()
    const answer = await screen.findByTestId('ask-answer')
    await screen.findByRole('button', { name: 'Insert into this note' })
    await waitFor(() => expect(document.activeElement).toBe(answer))
    expect(answer.tabIndex).toBe(-1)                          // focusable by script only
  })

  it('a member who moved somewhere during the wait keeps their place', async () => {
    await askAndLoseFocus()
    const close = screen.getByRole('button', { name: 'Close Ask' })
    close.focus()
    await screen.findByRole('button', { name: 'Insert into this note' })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(document.activeElement).toBe(close)
  })
})
