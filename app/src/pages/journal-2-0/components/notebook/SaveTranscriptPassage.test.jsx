// Wave 13 lane 13G-1 -- the transcript-passage sheet and its two doors.
//
// What each block proves (behaviour, asserted by RENDERED TEXT and by the request on the wire):
//   * the doors render nothing while notebook_transcript_capture_enabled is off;
//   * the workspace door: held quarters -> numbered turns -> a picked turn prefills the passage
//     with the turn's WORDS (never the speaker lead) -> Save sends exactly the note, symbol,
//     quarter, turn and passage, lands the note's revision, and says how it is cited;
//   * a quarter UCT does not hold says so, and a refusal is shown as the server worded it;
//   * the editor door: the slash event opens the sheet; a save puts ONE node at the caret.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('../../lib/offline/settleNoteWrite', () => ({ settleNoteWrite: vi.fn(async () => 'rev') }))
vi.mock('../../lib/noteCreation', () => ({
  createNoteViaApi: vi.fn(async ({ title }) => ({ id: 'n-new', title })),
}))

import { settleNoteWrite } from '../../lib/offline/settleNoteWrite'
import { createNoteViaApi } from '../../lib/noteCreation'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import { TRANSCRIPT_EVENT } from '../../lib/researchCapture'
import { SaveTranscriptButton, TranscriptInsertHost } from './TranscriptDoors'

const QUARTERS = { symbol: 'NVDA', source: 'FMP transcript', quarters: [
  { quarter: '2026Q2', year: 2026, q: 2, callDate: '2026-08-27', held: 'store' },
  { quarter: '2026Q1', year: 2026, q: 1, callDate: null, held: 'cache' },
] }
const TRANSCRIPT = {
  symbol: 'NVDA', quarter: '2026Q2', year: 2026, q: 2, callDate: '2026-08-27', held: 'store',
  source: 'FMP transcript',
  turns: [
    { turn: 1, speaker: 'Operator', text: 'Operator: Welcome to the call.' },
    { turn: 2, speaker: 'Colette Kress', text: 'Colette Kress: Revenue was a record and gross margin was 72.4%.' },
  ],
}
const SAVED = {
  excerpt: { id: 'ex1', documentName: 'NVDA earnings call FY2026 Q2 · 2026-08-27 · FMP transcript', pageNumber: 2 },
  note: { id: 'n1', updatedAt: '2026-10-03T00:00:01Z' }, deduped: false, turn: 2, speaker: 'Colette Kress',
  quarter: '2026Q2', callDate: '2026-08-27', source: 'FMP transcript',
}

function installFetch(routes) {
  const calls = []
  global.fetch = vi.fn(async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null })
    const hit = routes.find(([re, method]) => re.test(url) && (!method || method === (init.method || 'GET')))
    const [status, body] = hit ? hit[2] : [404, { detail: 'no route' }]
    return { ok: status < 300, status, json: async () => body }
  })
  return calls
}

const wrap = (ui) => render(<SWRConfig value={{ provider: () => new Map() }}>{ui}</SWRConfig>)

const NOTES = [{ id: 'n1', title: 'NVDA thesis' }, { id: 'n2', title: 'Semis' }]

describe('SaveTranscriptPassage', () => {
  beforeEach(() => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_transcript_capture_enabled: true })
    settleNoteWrite.mockClear()
    createNoteViaApi.mockClear()
  })
  afterEach(() => __resetNotebookFlags())

  it('renders nothing while the gate is off', () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_transcript_capture_enabled: false })
    const { container } = wrap(<SaveTranscriptButton symbol="NVDA" notes={NOTES} />)
    expect(container.innerHTML).toBe('')
  })

  it('picks a held call and a turn, saves the trimmed passage, and says how it is cited', async () => {
    const calls = installFetch([
      [/\/transcripts\/NVDA\/quarters$/, 'GET', [200, QUARTERS]],
      [/\/transcripts\/NVDA\/2026Q2$/, 'GET', [200, TRANSCRIPT]],
      [/\/transcripts\/save$/, 'POST', [200, SAVED]],
    ])
    wrap(<SaveTranscriptButton symbol="NVDA" notes={NOTES} />)
    fireEvent.click(screen.getByRole('button', { name: /Save from a transcript/ }))
    await screen.findByText('Revenue was a record and gross margin was 72.4%.')
    expect(screen.getByRole('combobox', { name: 'Call quarter' }).value).toBe('2026Q2')
    expect(screen.getByText(/call of 2026-08-27/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Quote from turn 2' }))
    const box = screen.getByLabelText(/Passage from turn 2 \(Colette Kress\)/)
    // The turn's words, never the "Speaker: " lead.
    expect(box.value).toBe('Revenue was a record and gross margin was 72.4%.')
    fireEvent.change(box, { target: { value: 'gross margin was 72.4%' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save passage' }))

    const done = await screen.findByText(/Cited as/)
    expect(done.closest('[role="status"]').textContent).toBe(
      'Saved to “NVDA thesis”. Cited as NVDA earnings call FY2026 Q2 · 2026-08-27 · FMP transcript · turn 2 (Colette Kress).')
    const save = calls.find((c) => c.method === 'POST')
    expect(save.body).toEqual({ noteId: 'n1', symbol: 'NVDA', quarter: '2026Q2', turn: 2, passage: 'gross margin was 72.4%' })
    expect(settleNoteWrite).toHaveBeenCalledWith('n1', SAVED)
  })

  // Lane FIN-A11Y (review R4, M-16): the find box narrows the turns silently. A polite status,
  // mounted before anything is typed, says how many turns are left.
  it('the find box says how many turns mention the word, in a status that was already there', async () => {
    installFetch([
      [/\/transcripts\/NVDA\/quarters$/, 'GET', [200, QUARTERS]],
      [/\/transcripts\/NVDA\/2026Q2$/, 'GET', [200, TRANSCRIPT]],
    ])
    wrap(<SaveTranscriptButton symbol="NVDA" notes={NOTES} />)
    fireEvent.click(screen.getByRole('button', { name: /Save from a transcript/ }))
    await screen.findByText('Revenue was a record and gross margin was 72.4%.')
    const count = document.querySelector('[data-transcript-count]')
    expect(count).toHaveAttribute('role', 'status')
    expect(count).toHaveTextContent('')
    const find = screen.getByRole('searchbox')
    fireEvent.change(find, { target: { value: 'margin' } })
    await waitFor(() => expect(count).toHaveTextContent('1 turn mentions “margin”.'))
    expect(screen.getAllByRole('button', { name: /Quote from turn/ })).toHaveLength(1)
    fireEvent.change(find, { target: { value: 'zzzz' } })
    await waitFor(() => expect(count).toHaveTextContent('0 turns mention “zzzz”.'))
    fireEvent.change(find, { target: { value: '' } })
    await waitFor(() => expect(count).toHaveTextContent(''))
    expect(document.querySelector('[data-transcript-count]')).toBe(count)
  })

  it('saves into a new note when the member picks one', async () => {
    const calls = installFetch([
      [/\/quarters$/, 'GET', [200, QUARTERS]],
      [/\/2026Q2$/, 'GET', [200, TRANSCRIPT]],
      [/\/save$/, 'POST', [200, { ...SAVED, note: { id: 'n-new', updatedAt: 'x' } }]],
    ])
    wrap(<SaveTranscriptButton symbol="NVDA" notes={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /Save from a transcript/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Quote from turn 2' }))
    expect(screen.getByRole('combobox', { name: 'Destination note' }).value).toBe('__new__')
    fireEvent.click(screen.getByRole('button', { name: 'Save passage' }))
    await screen.findByText(/Cited as/)
    expect(createNoteViaApi).toHaveBeenCalledWith({ title: 'NVDA FY2026 Q2 call', ticker: 'NVDA' })
    expect(calls.find((c) => c.method === 'POST').body.noteId).toBe('n-new')
  })

  it('a door handed no notes (the calendar panel) asks for the member\'s notes on the ticker and opens on the quarter it was given', async () => {
    const calls = installFetch([
      [/\/api\/j2\/notes\?ticker=NVDA&limit=50$/, 'GET', [200, { notes: [{ id: 'n9', title: 'NVDA call notes' }] }]],
      [/\/quarters$/, 'GET', [200, QUARTERS]],
      [/\/transcripts\/NVDA\/2026Q1$/, 'GET', [200, { ...TRANSCRIPT, quarter: '2026Q1', callDate: null }]],
      [/\/save$/, 'POST', [200, SAVED]],
    ])
    wrap(<SaveTranscriptButton symbol="NVDA" quarter="2026Q1" />)
    fireEvent.click(screen.getByRole('button', { name: /Save from a transcript/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Quote from turn 2' }))
    expect(screen.getByRole('combobox', { name: 'Call quarter' }).value).toBe('2026Q1')
    expect(screen.getByText(/call date not stored/)).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Destination note' }).value).toBe('n9'))
    fireEvent.click(screen.getByRole('button', { name: 'Save passage' }))
    await screen.findByText(/Cited as/)
    expect(calls.find((c) => c.method === 'POST').body).toMatchObject({ noteId: 'n9', quarter: '2026Q1' })
  })

  it('says so when UCT holds no transcript', async () => {
    installFetch([[/\/quarters$/, 'GET', [200, { ...QUARTERS, quarters: [] }]]])
    wrap(<SaveTranscriptButton symbol="NVDA" notes={NOTES} />)
    fireEvent.click(screen.getByRole('button', { name: /Save from a transcript/ }))
    expect((await screen.findByRole('note')).textContent).toMatch(/does not hold a NVDA call transcript yet/)
  })

  it('a quote the server refuses is shown as the server worded it, and nothing is landed', async () => {
    installFetch([
      [/\/quarters$/, 'GET', [200, QUARTERS]],
      [/\/2026Q2$/, 'GET', [200, TRANSCRIPT]],
      [/\/save$/, 'POST', [422, { detail: 'That passage is not in turn 2 of the NVDA 2026Q2 transcript UCT holds.' }]],
    ])
    wrap(<SaveTranscriptButton symbol="NVDA" notes={NOTES} />)
    fireEvent.click(screen.getByRole('button', { name: /Save from a transcript/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Quote from turn 2' }))
    fireEvent.change(screen.getByLabelText(/Passage from turn 2/), { target: { value: 'margin was 99%' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save passage' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That passage is not in turn 2 of the NVDA 2026Q2 transcript UCT holds.')
    expect(settleNoteWrite).not.toHaveBeenCalled()
  })
})

function fakeEditor(existingIds = []) {
  const dom = document.createElement('div')
  const listeners = {}
  const inserted = []
  const editor = {
    isDestroyed: false,
    view: { dom },
    on: (ev, fn) => { (listeners[ev] ||= []).push(fn) },
    off: () => {},
    state: {
      selection: { to: 7 },
      doc: { descendants: (fn) => existingIds.forEach((id) => fn({ type: { name: 'documentExcerpt' }, attrs: { excerptId: id } })) },
    },
    chain: () => {
      const c = { focus: () => c, insertContentAt: (pos, node) => { inserted.push({ pos, node }); return c }, run: () => true }
      return c
    },
  }
  return { editor, dom, inserted }
}

describe('TranscriptInsertHost (the /transcript insert)', () => {
  beforeEach(() => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_transcript_capture_enabled: true })
  })
  afterEach(() => __resetNotebookFlags())

  async function saveThroughHost(editorParts) {
    installFetch([
      [/\/quarters$/, 'GET', [200, QUARTERS]],
      [/\/2026Q2$/, 'GET', [200, TRANSCRIPT]],
      [/\/save$/, 'POST', [200, SAVED]],
    ])
    wrap(<TranscriptInsertHost editor={editorParts.editor} noteId="n1" ticker="NVDA" />)
    expect(screen.queryByRole('dialog')).toBeNull()
    await act(async () => { editorParts.dom.dispatchEvent(new CustomEvent(TRANSCRIPT_EVENT, { bubbles: true })) })
    fireEvent.click(await screen.findByRole('button', { name: 'Quote from turn 2' }))
    // The open note IS the destination: no picker.
    expect(screen.queryByRole('combobox', { name: 'Destination note' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save passage' }))
    await screen.findByText(/Cited as/)
  }

  it('opens on the slash event and puts the excerpt node at the caret', async () => {
    const parts = fakeEditor()
    await saveThroughHost(parts)
    expect(parts.inserted).toEqual([{ pos: 7, node: { type: 'documentExcerpt', attrs: { excerptId: 'ex1' } } }])
  })

  it('never puts a second node for an excerpt the note already shows', async () => {
    const parts = fakeEditor(['ex1'])
    await saveThroughHost(parts)
    expect(parts.inserted).toEqual([])
  })

  it('renders nothing and listens to nothing while the gate is off', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_transcript_capture_enabled: false })
    const parts = fakeEditor()
    global.fetch = vi.fn()
    const { container } = wrap(<TranscriptInsertHost editor={parts.editor} noteId="n1" ticker="NVDA" />)
    await act(async () => { parts.dom.dispatchEvent(new CustomEvent(TRANSCRIPT_EVENT, { bubbles: true })) })
    expect(container.innerHTML).toBe('')
    await waitFor(() => expect(global.fetch).not.toHaveBeenCalled())
  })
})

// Finish program, lane KEYS3 (Q19): the transcript sheet on a keyboard.
// It opened with focus on the sheet, and the turn a member wants was behind Close, the call
// select, the find box and every turn before it (each turn its own Tab stop: a real call has
// fifty or more). 12 keys against a budget of 9.
//   - the turns are ONE Tab stop: Down and Up move turn to turn, Home and End to the ends;
//   - when the call has loaded, focus lands on the first turn's "Quote" button. Not the find
//     box: on a phone that would raise the keyboard over the call. It is one Shift+Tab back.
describe('SaveTranscriptPassage: the turns are one stop and focus lands on them (lane KEYS3)', () => {
  beforeEach(() => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_transcript_capture_enabled: true })
  })
  afterEach(() => __resetNotebookFlags())
  const LONG = { ...TRANSCRIPT, turns: [
    ...TRANSCRIPT.turns,
    { turn: 3, speaker: 'Analyst', text: 'Analyst: What about supply?' },
    { turn: 4, speaker: 'Jensen Huang', text: 'Jensen Huang: Supply is improving.' },
  ] }
  const openSheet = async () => {
    installFetch([
      [/\/transcripts\/NVDA\/quarters$/, 'GET', [200, QUARTERS]],
      [/\/transcripts\/NVDA\/2026Q2$/, 'GET', [200, LONG]],
    ])
    wrap(<SaveTranscriptButton symbol="NVDA" notes={NOTES} />)
    fireEvent.click(screen.getByRole('button', { name: /Save from a transcript/ }))
    await screen.findByText('Supply is improving.')
  }
  const quote = (n) => screen.getByRole('button', { name: `Quote from turn ${n}` })
  const key = (k) => fireEvent.keyDown(document.activeElement, { key: k })

  it('exactly one turn is in the Tab order, however many turns the call has', async () => {
    await openSheet()
    const buttons = [1, 2, 3, 4].map(quote)
    expect(buttons.filter((b) => b.tabIndex === 0)).toEqual([quote(1)])
    expect(buttons.filter((b) => b.tabIndex === -1)).toHaveLength(3)
  })

  it('when the call has loaded, focus is on the first turn\'s Quote button', async () => {
    await openSheet()
    await waitFor(() => expect(document.activeElement).toBe(quote(1)))
  })

  it('Down, End, Up and Home move turn to turn, and Enter still quotes the turn', async () => {
    await openSheet()
    await waitFor(() => expect(document.activeElement).toBe(quote(1)))
    key('ArrowDown')
    expect(document.activeElement).toBe(quote(2))
    key('End')
    expect(document.activeElement).toBe(quote(4))
    key('ArrowUp')
    expect(document.activeElement).toBe(quote(3))
    key('Home')
    expect(document.activeElement).toBe(quote(1))
    key('ArrowDown')
    fireEvent.click(document.activeElement)
    expect(screen.getByLabelText(/Passage from turn 2 \(Colette Kress\)/).value)
      .toBe('Revenue was a record and gross margin was 72.4%.')
  })

  it('a member who is already somewhere in the sheet when the call arrives keeps their place', async () => {
    let release
    const held = new Promise((r) => { release = r })
    global.fetch = vi.fn(async (url) => {
      if (/\/quarters$/.test(url)) return { ok: true, status: 200, json: async () => QUARTERS }
      await held
      return { ok: true, status: 200, json: async () => LONG }
    })
    wrap(<SaveTranscriptButton symbol="NVDA" notes={NOTES} />)
    fireEvent.click(screen.getByRole('button', { name: /Save from a transcript/ }))
    const select = await screen.findByRole('combobox', { name: 'Call quarter' })
    select.focus()
    await act(async () => { release() })
    await screen.findByText('Supply is improving.')
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(document.activeElement).toBe(select)
  })
})
