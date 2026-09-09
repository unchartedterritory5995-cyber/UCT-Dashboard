import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AskPanel from './AskPanel'

// ─────────────────────────────────────────────────────────────────────────
// WAVE K SLICE 6 — the one Ask surface.
//
// What matters once four features become one component:
//   - the scope that was searched is legible, in words
//   - only handles the server actually sent become citations
//   - a refusal reads like an answer, not an error
//   - a coverage limitation is shown when it exists and NEVER otherwise
//   - untrusted source labels and answer text stay inert
// ─────────────────────────────────────────────────────────────────────────

function sse(events) {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ev of events) c.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`))
      c.close()
    },
  })
}

function mockStream(events, { status = 200 } = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status === 200, status, body: sse(events),
    json: async () => ({ detail: 'nope' }),
  })
}

const SOURCE = {
  n: 1, type: 'note', label: 'NVDA thesis', citation: 'exact',
  snippet: 'margins compressed in Q3',
  navigation: { kind: 'note', note_id: 'n1' },
  location: { from: 1, to: 25, fingerprint: 'abc:12' },
  payload: {}, stance: null, truncated: false,
}

function head(extra = {}) {
  return {
    type: 'sources', scope: 'note', scopeLabel: 'This note',
    sources: [SOURCE], coverageNotice: null, independentSources: 1,
    noAnswer: false, ...extra,
  }
}

async function ask(props = {}, events = [head(), { type: 'delta', text: 'Margins fell [1].' }, { type: 'final', answer: 'Margins fell [1].', cited: [1], invalidCitations: [] }]) {
  mockStream(events)
  render(<AskPanel scope="note" target="n1" autoOpen {...props} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'margins?' } })
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
  await screen.findByTestId('ask-answer')
}

beforeEach(() => { vi.restoreAllMocks() })

describe('the scope that was searched is always legible', () => {
  it('shows the scope in words, not an icon tooltip', async () => {
    await ask()
    expect(screen.getByTestId('ask-scope').textContent).toContain('Asking: This note')
  })

  it('uses the label the SERVER reports, not one the UI guessed', async () => {
    // A scope shown on screen and a scope actually searched must not be able
    // to drift apart, so the label travels with the answer.
    await ask({ scope: 'security', target: 'NVDA' },
              [head({ scopeLabel: 'NVDA research' }),
               { type: 'final', answer: 'ok', cited: [], invalidCitations: [] }])
    expect(screen.getByTestId('ask-scope').textContent).toContain('NVDA research')
  })

  it('labels the dialog by scope for screen readers', async () => {
    await ask()
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Ask This note')
  })

  it('the question input is labelled', async () => {
    await ask()
    expect(screen.getByLabelText(/your question about/i)).toBeTruthy()
  })
})

describe('only handles the server sent become citations', () => {
  it('renders a valid handle as a clickable source chip', async () => {
    await ask()
    const chip = screen.getByRole('button', { name: 'Source 1: NVDA thesis' })
    expect(chip.textContent).toBe('[1]')
  })

  it('an invented handle stays literal text', async () => {
    // ⛔ The model citing a source that was never sent must never look like a
    // source (§23).
    await ask({}, [head(),
                   { type: 'final', answer: 'As stated [9].', cited: [], invalidCitations: [9] }])
    expect(screen.queryByRole('button', { name: /^Source 9/ })).toBeNull()
    expect(screen.getByTestId('ask-answer').textContent).toContain('[9]')
  })

  it('a quoted phrase is no longer a citation', async () => {
    // The Wave 2 contract, deliberately dead: punctuation decided what a
    // citation was, and whether it resolved was never asked.
    await ask({}, [head(),
                   { type: 'final', answer: 'It says "margins compressed" here.', cited: [], invalidCitations: [] }])
    // No handle means no citation and no Sources section at all.
    expect(screen.queryAllByRole('button', { name: /^Source/ }).length).toBe(0)
    expect(screen.queryByTestId('ask-sources')).toBeNull()
    expect(screen.getByTestId('ask-answer').textContent)
      .toContain('"margins compressed"')
  })

  it('clicking a note citation resolves it against the LIVE editor doc', async () => {
    const onNavigate = vi.fn()
    const doc = {
      content: { size: 30 },
      textBetween: (a, b) => (a === 1 && b === 25 ? 'margins compressed in Q3' : ''),
      descendants: () => {},
    }
    await ask({ getEditorDoc: () => doc, onNavigate })
    fireEvent.click(screen.getByRole('button', { name: 'Source 1: NVDA thesis' }))
    expect(onNavigate).toHaveBeenCalled()
    const [source, resolved] = onNavigate.mock.calls[0]
    expect(source.n).toBe(1)
    expect(resolved.state).toBe('valid_exact')
  })

  it('a citation into an edited note degrades rather than jumping wrong', async () => {
    const onNavigate = vi.fn()
    const doc = {
      content: { size: 30 },
      textBetween: () => 'something else entirely',
      descendants: () => {},
    }
    await ask({ getEditorDoc: () => doc, onNavigate })
    fireEvent.click(screen.getByRole('button', { name: 'Source 1: NVDA thesis' }))
    expect(onNavigate.mock.calls[0][1].state).toBe('degraded')
  })
})

describe('sources are listed, ranking internals are not', () => {
  it('lists each cited source once', async () => {
    await ask({}, [head(),
                   { type: 'final', answer: '[1] and again [1].', cited: [1], invalidCitations: [] }])
    const list = screen.getByTestId('ask-sources')
    expect(list.textContent).toContain('NVDA thesis')
    expect(list.querySelectorAll('button').length).toBe(1)
  })

  it('says in WORDS when a citation cannot open the exact passage', async () => {
    // Never colour alone (§33).
    await ask({}, [head({ sources: [{ ...SOURCE, citation: 'page_only' }] }),
                   { type: 'final', answer: 'see [1]', cited: [1], invalidCitations: [] }])
    expect(screen.getByTestId('ask-sources').textContent).toContain('page only')
  })

  it('an uncited answer shows no Sources section', async () => {
    await ask({}, [head(),
                   { type: 'final', answer: 'No citations here.', cited: [], invalidCitations: [] }])
    expect(screen.queryByTestId('ask-sources')).toBeNull()
  })
})

describe('a refusal reads like an answer', () => {
  it('renders the deterministic refusal as normal text', async () => {
    mockStream([head({ noAnswer: true, sources: [] }),
                { type: 'delta', text: "I couldn't find that in this note." },
                { type: 'final', answer: "I couldn't find that in this note.", cited: [], invalidCitations: [] }])
    render(<AskPanel scope="note" target="n1" autoOpen />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'zebras?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    const out = await screen.findByTestId('ask-answer')
    expect(out.textContent).toBe("I couldn't find that in this note.")
    expect(screen.queryByRole('alert')).toBeNull()  // not an error state
  })
})

describe('coverage is shown only when it matters', () => {
  it('shows a limitation the server reported', async () => {
    await ask({}, [head({ coverageNotice: "2 attached documents couldn't be searched yet." }),
                   { type: 'final', answer: 'ok', cited: [], invalidCitations: [] }])
    expect(screen.getByTestId('ask-coverage').textContent).toContain("couldn't be searched")
  })

  it('shows nothing when coverage is complete', async () => {
    await ask()
    expect(screen.queryByTestId('ask-coverage')).toBeNull()
  })
})

describe('untrusted content stays inert', () => {
  it('a hostile source label renders as text, in the accessible name too', async () => {
    const label = '<img src=x onerror=alert(1)>.pdf'
    await ask({}, [head({ sources: [{ ...SOURCE, label }] }),
                   { type: 'final', answer: 'see [1]', cited: [1], invalidCitations: [] }])
    const list = screen.getByTestId('ask-sources')
    expect(list.querySelector('img')).toBeNull()
    expect(list.textContent).toContain(label)
    expect(screen.getByRole('button', { name: `Source 1: ${label}` })).toBeTruthy()
  })

  it('an injection payload in the answer renders as text', async () => {
    await ask({}, [head(),
                   { type: 'final', answer: 'The doc says "<script>alert(1)</script>".', cited: [], invalidCitations: [] }])
    const out = screen.getByTestId('ask-answer')
    expect(out.querySelector('script')).toBeNull()
    expect(out.textContent).toContain('<script>alert(1)</script>')
  })
})

describe('errors and limits', () => {
  it('a rate limit is reported as a limit, not a crash', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 429, json: async () => ({ detail: 'daily limit reached' }),
    })
    render(<AskPanel scope="note" target="n1" autoOpen />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect((await screen.findByRole('alert')).textContent).toBe('daily limit reached')
  })

  it('a mid-stream error surfaces and does not leave a half answer as done', async () => {
    mockStream([head(), { type: 'delta', text: 'partial' },
                { type: 'error', detail: 'Something went wrong answering that.' }])
    render(<AskPanel scope="note" target="n1" autoOpen />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect((await screen.findByRole('alert')).textContent).toContain('went wrong')
  })
})

describe('a scope change starts a new thread', () => {
  it('clears the answer when the target changes', async () => {
    // ⛔ Carrying a thread across corpora would let a follow-up be answered
    // from a corpus the member never asked about.
    mockStream([head(), { type: 'final', answer: 'Margins fell [1].', cited: [1], invalidCitations: [] }])
    const { rerender } = render(<AskPanel scope="note" target="n1" autoOpen />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'margins?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await screen.findByTestId('ask-answer')

    rerender(<AskPanel scope="note" target="n2" autoOpen />)
    await waitFor(() => expect(screen.queryByTestId('ask-answer')).toBeNull())
    expect(screen.queryByTestId('ask-sources')).toBeNull()
  })

  it('drops the follow-up thread when the scope changes', async () => {
    mockStream([head(), { type: 'final', answer: 'first', cited: [], invalidCitations: [] }])
    const { rerender } = render(<AskPanel scope="note" target="n1" autoOpen />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'margins?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await screen.findByTestId('ask-answer')

    rerender(<AskPanel scope="notebook" target={null} autoOpen />)
    mockStream([head({ scope: 'notebook', scopeLabel: 'My Notebook' }),
                { type: 'final', answer: 'second', cited: [], invalidCitations: [] }])
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'and the risks?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.history).toEqual([])
  })

  it('sends the scope and target the caller asked for', async () => {
    await ask({ scope: 'document', target: 'doc-7' },
              [head({ scope: 'document', scopeLabel: 'This document' }),
               { type: 'final', answer: 'ok', cited: [], invalidCitations: [] }])
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.scope).toBe('document')
    expect(body.target).toBe('doc-7')
  })
})

describe('follow-up history', () => {
  it('sends the previous question and answer as bounded history', async () => {
    await ask()
    mockStream([head(), { type: 'final', answer: 'second', cited: [], invalidCitations: [] }])
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'and the risks?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.history.length).toBe(1)
    expect(body.history[0].q).toBe('margins?')
  })
})
