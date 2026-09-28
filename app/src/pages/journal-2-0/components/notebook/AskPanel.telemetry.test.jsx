import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AskPanel from './AskPanel'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

// ⭐ Wave 10 follow-up F3, fix round 2 (controller ruling 2): study task T7 ("ask
// the notebook, insert the answer") is counted by `ask_used`, and until this file
// no rail proved a call site fires it. This drives the REAL AskPanel with a
// mocked stream and reads what was POSTed to /api/j2/telemetry, the same way the
// noteBatch / bulk-bar rails read theirs:
//   - an answered ask sends exactly ONE ask_used (AskPanel.jsx:235), with the
//     scope word, inserted=false and a latency -- never the question text;
//   - no ask, no event (the control); a failed or empty answer sends none;
//   - two asks send two; an insert sends one more with inserted=true (:292).

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
const head = () => ({ type: 'sources', scope: 'note', scopeLabel: 'This note', sources: [SOURCE], coverageNotice: null })
const ANSWERED = [head(), { type: 'final', answer: 'Margins fell [1].' }]

// Every call gets a FRESH stream (a stream can be read once), so a second ask works.
function mockFetch(events = ANSWERED) {
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), body: sse(events) }))
  return global.fetch
}

const sent = (fetchFn) => fetchFn.mock.calls
  .filter(([u]) => u === '/api/j2/telemetry')
  .map(([, init]) => JSON.parse(init.body))
const askUsed = (fetchFn) => sent(fetchFn).filter((b) => b.event === 'ask_used')

function askOnce(question = 'what did I say about margins?') {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: question } })
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
}

beforeEach(() => {
  vi.restoreAllMocks()
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_ask_insert_on: true })
})

describe('ask_used — the Ask door counts itself once per answered ask (T7)', () => {
  it('control: the panel opened and a question typed, but no ask -> no event', async () => {
    const fetchFn = mockFetch()
    render(<AskPanel scope="note" target="n1" autoOpen />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'margins?' } })
    await new Promise((r) => setTimeout(r, 20))
    expect(sent(fetchFn)).toEqual([])
  })

  it('an answered ask sends exactly ONE ask_used, with the scope, inserted=false and a latency', async () => {
    const fetchFn = mockFetch()
    render(<AskPanel scope="note" target="n1" autoOpen />)
    askOnce()
    await screen.findByTestId('ask-answer')
    await waitFor(() => expect(askUsed(fetchFn)).toHaveLength(1))
    const [body] = askUsed(fetchFn)
    expect(body.props).toEqual({ scope: 'note', inserted: false, ms: expect.any(Number) })
    // Never the question, the answer or an id.
    expect(JSON.stringify(sent(fetchFn))).not.toMatch(/margins|NVDA|n1/i)
  })

  it('two asks send two ask_used -- one each', async () => {
    const fetchFn = mockFetch()
    render(<AskPanel scope="note" target="n1" autoOpen />)
    askOnce('first question')
    await waitFor(() => expect(askUsed(fetchFn)).toHaveLength(1))
    askOnce('second question')
    await waitFor(() => expect(askUsed(fetchFn)).toHaveLength(2))
    await new Promise((r) => setTimeout(r, 20))
    expect(askUsed(fetchFn)).toHaveLength(2)
  })

  it('a failed answer sends none', async () => {
    const fetchFn = mockFetch([head(), { type: 'delta', text: 'Margins [1]' }, { type: 'error', detail: 'boom' }])
    render(<AskPanel scope="note" target="n1" autoOpen />)
    askOnce()
    await screen.findByText('boom')
    expect(askUsed(fetchFn)).toEqual([])
  })

  it('an empty answer sends none', async () => {
    const fetchFn = mockFetch([head(), { type: 'final', answer: '' }])
    render(<AskPanel scope="note" target="n1" autoOpen />)
    askOnce()
    await screen.findByText('No answer came back.')
    expect(askUsed(fetchFn)).toEqual([])
  })

  it('inserting the answer sends one more ask_used with inserted=true', async () => {
    const fetchFn = mockFetch()
    render(<AskPanel scope="note" target="n1" autoOpen onInsert={vi.fn(() => true)} />)
    askOnce()
    const insert = await screen.findByRole('button', { name: 'Insert into this note' })
    expect(askUsed(fetchFn)).toHaveLength(1)
    fireEvent.click(insert)
    await waitFor(() => expect(askUsed(fetchFn)).toHaveLength(2))
    expect(askUsed(fetchFn)[1].props).toEqual({ scope: 'note', inserted: true, ms: expect.any(Number) })
  })
})
