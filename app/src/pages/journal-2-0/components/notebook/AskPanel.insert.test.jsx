import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AskPanel from './AskPanel'
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
const head = (sources = [SOURCE]) => ({ type: 'sources', scope: 'note', scopeLabel: 'This note', sources, coverageNotice: null })

async function ask(props, events = [head(), { type: 'final', answer: 'Margins fell [1].' }]) {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), body: sse(events) })
  render(<AskPanel scope="note" target="n1" autoOpen {...props} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'margins?' } })
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
  await screen.findByTestId('ask-answer')
}

beforeEach(() => {
  vi.restoreAllMocks()
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_ask_insert_on: true })
})

describe('Insert is offered only when it is honest to', () => {
  it('flag off → no Insert', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_ask_insert_on: false })
    await ask({ onInsert: vi.fn() })
    expect(screen.queryByRole('button', { name: /Insert/ })).toBeNull()
  })

  it('flag never latched → no Insert', async () => {
    __resetNotebookFlags()
    await ask({ onInsert: vi.fn() })
    expect(screen.queryByRole('button', { name: /Insert/ })).toBeNull()
  })

  it('an answer with no citations → no Insert', async () => {
    await ask({ onInsert: vi.fn() }, [head(), { type: 'final', answer: 'I could not find that.' }])
    expect(screen.queryByRole('button', { name: /Insert/ })).toBeNull()
  })

  it('an error → no Insert', async () => {
    await ask({ onInsert: vi.fn() }, [head(), { type: 'delta', text: 'Margins [1]' }, { type: 'error', detail: 'boom' }])
    expect(screen.queryByRole('button', { name: /Insert/ })).toBeNull()
  })

  it('no host way to insert → no Insert', async () => {
    await ask({})
    expect(screen.queryByRole('button', { name: /Insert/ })).toBeNull()
  })

  // G-064 final fix wave (M8) — spec §3.1: "Not while streaming". The stream
  // below has DELIVERED a cited delta (so every other condition already holds)
  // but has not closed; only closing it may offer Insert.
  it('while the answer is still streaming → no Insert; once the stream closes → Insert', async () => {
    const enc = new TextEncoder()
    let ctl
    const body = new ReadableStream({ start(c) { ctl = c } })
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), body })
    render(<AskPanel scope="note" target="n1" autoOpen onInsert={vi.fn(() => true)} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'margins?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    ctl.enqueue(enc.encode(`data: ${JSON.stringify(head())}\n\n`))
    ctl.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'delta', text: 'Margins fell [1].' })}\n\n`))
    await waitFor(() => expect(screen.getByTestId('ask-answer')).toHaveTextContent('Margins fell'))
    expect(screen.getByTestId('ask-answer')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('button', { name: /Insert/ })).toBeNull()

    ctl.close()
    expect(await screen.findByRole('button', { name: 'Insert into this note' })).toBeEnabled()
  })
})

describe('inserting into the open note', () => {
  it('hands the host the block built from what was shown, then reads "Inserted"', async () => {
    const onInsert = vi.fn(() => true)
    await ask({ onInsert })
    fireEvent.click(screen.getByRole('button', { name: 'Insert into this note' }))
    const node = onInsert.mock.calls[0][0]
    expect(node.type).toBe('askInsert')
    expect(node.attrs.question).toBe('margins?')
    expect(node.attrs.scope).toBe('note')
    expect(node.content[0].content[1]).toMatchObject({ type: 'askCitation', attrs: { n: 1, label: 'NVDA thesis' } })
    expect(screen.getByRole('button', { name: 'Inserted' })).toBeDisabled()
  })

  it('a refused insert leaves the button as it was', async () => {
    await ask({ onInsert: vi.fn(() => false) })
    fireEvent.click(screen.getByRole('button', { name: 'Insert into this note' }))
    expect(screen.getByRole('button', { name: 'Insert into this note' })).toBeEnabled()
  })
})

describe('inserting when no note is open', () => {
  it('opens the picker', async () => {
    await ask({ onOpenNote: vi.fn() })
    fireEvent.click(screen.getByRole('button', { name: 'Insert into a note…' }))
    expect(screen.getByTestId('ask-insert-picker')).toBeInTheDocument()
  })
})
