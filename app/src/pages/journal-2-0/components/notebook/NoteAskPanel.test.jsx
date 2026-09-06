import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import NoteAskPanel, { jumpToNoteText } from './NoteAskPanel'

function sseBody(events) {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ev of events) c.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`))
      c.close()
    },
  })
}

function mockStreamFetch(events) {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, body: sseBody(events) })
}

async function openAndAsk(query = 'what did I say about margins') {
  render(<NoteAskPanel noteId="n1" getEditorDom={() => document.body} />)
  fireEvent.click(screen.getByRole('button', { name: /ask a question about this note/i }))
  fireEvent.change(screen.getByPlaceholderText(/what did i say about/i), { target: { value: query } })
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
}

describe('NoteAskPanel', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  afterEach(() => { delete global.fetch })

  it('is collapsed by default and expands on click', () => {
    render(<NoteAskPanel noteId="n1" getEditorDom={() => null} />)
    expect(screen.queryByPlaceholderText(/what did i say about/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /ask a question about this note/i }))
    expect(screen.getByPlaceholderText(/what did i say about/i)).toBeTruthy()
  })

  it('posts to the note-scoped ask endpoint and renders the streamed answer', async () => {
    mockStreamFetch([
      { type: 'delta', text: 'The note says ' },
      { type: 'delta', text: '"margins compressed" in Q3.' },
      { type: 'final', answer: 'The note says "margins compressed" in Q3.' },
    ])
    await openAndAsk()
    await waitFor(() => expect(screen.getByTestId('note-ask-answer').textContent).toContain('margins compressed'))
    const call = global.fetch.mock.calls[0]
    expect(call[0]).toBe('/api/j2/notes/n1/ask/stream')
    const body = JSON.parse(call[1].body)
    expect(body.query).toBe('what did I say about margins')
  })

  it('renders a quoted citation as a clickable chip', async () => {
    mockStreamFetch([{ type: 'final', answer: 'It says "margins compressed" here.' }])
    await openAndAsk()
    await waitFor(() => expect(screen.getByTestId('note-ask-answer').textContent).toContain('margins'))
    expect(screen.getByRole('button', { name: /jump to this in the note/i })).toBeTruthy()
  })

  it('clicking a citation chip calls jumpToNoteText against the editor DOM', async () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>Some text with margins compressed inside it.</p>'
    root.querySelector('p').scrollIntoView = vi.fn()  // jsdom has no real layout/scrollIntoView
    document.body.appendChild(root)
    mockStreamFetch([{ type: 'final', answer: 'It says "margins compressed" here.' }])
    render(<NoteAskPanel noteId="n1" getEditorDom={() => root} />)
    fireEvent.click(screen.getByRole('button', { name: /ask a question about this note/i }))
    fireEvent.change(screen.getByPlaceholderText(/what did i say about/i), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(screen.getByTestId('note-ask-answer').textContent).toContain('margins'))
    const chip = screen.getByRole('button', { name: /jump to this in the note/i })
    const p = root.querySelector('p')
    fireEvent.click(chip)
    expect(p.scrollIntoView).toHaveBeenCalled()
  })

  it('shows the 429 rate-limit message without crashing', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 429, json: async () => ({ detail: "You've hit today's Ask Current Note limit — it resets at midnight ET." }),
    })
    await openAndAsk()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/hit today's Ask Current Note limit/i))
  })

  it('shows the 402 paid-plan message', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 402, json: async () => ({}) })
    await openAndAsk()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/requires a paid plan/i))
  })

  it('does not submit an empty question', () => {
    render(<NoteAskPanel noteId="n1" getEditorDom={() => null} />)
    fireEvent.click(screen.getByRole('button', { name: /ask a question about this note/i }))
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()
  })

  it('closes via the close button', () => {
    render(<NoteAskPanel noteId="n1" getEditorDom={() => null} />)
    fireEvent.click(screen.getByRole('button', { name: /ask a question about this note/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByPlaceholderText(/what did i say about/i)).toBeNull()
  })
})

describe('jumpToNoteText', () => {
  it('scrolls to and flashes the element containing the phrase', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>Prices moved on margins compressed in Q3.</p>'
    document.body.appendChild(root)
    const p = root.querySelector('p')
    p.scrollIntoView = vi.fn()
    const found = jumpToNoteText(root, 'margins compressed')
    expect(found).toBe(true)
    expect(p.scrollIntoView).toHaveBeenCalled()
  })

  it('returns false when the phrase is not present', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>Nothing relevant here.</p>'
    document.body.appendChild(root)
    expect(jumpToNoteText(root, 'margins compressed')).toBe(false)
  })

  it('returns false for a null root or empty phrase', () => {
    expect(jumpToNoteText(null, 'x')).toBe(false)
    expect(jumpToNoteText(document.body, '')).toBe(false)
    expect(jumpToNoteText(document.body, '   ')).toBe(false)
  })
})
