// W2-C1 — the Agent on /journal: notes read; a note CREATED through the Notebook's one creation path; Undo = Trash.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

import AgentPanel from './AgentPanel'
import { buildJournalPageHost, noteBody } from './hosts/pageHosts'

const NOTES = [
  { id: 'n1', title: 'NVDA earnings prep', ticker: 'NVDA', updatedAt: '2026-11-01T14:00:00Z' },
  { id: 'n2', title: 'Weekly review', ticker: null, updatedAt: '2026-10-31T20:00:00Z' },
]
function makePage() {
  const page = { notes: [...NOTES], created: [], trashed: [], refreshed: 0 }
  const host = buildJournalPageHost({
    notes: () => page.notes,
    refresh: () => { page.refreshed += 1 },
    location: () => '/journal/notebook',
    navigate: () => {},
    // the Notebook's own creation path, stubbed at its seam: the server's row comes back
    create: async ({ title, bodyJson, ticker }) => {
      const note = { id: `n${page.notes.length + 1}`, title, ticker: ticker || null, updatedAt: '2026-11-03T01:00:00Z' }
      page.created.push({ title, bodyJson, ticker: ticker || null })
      page.notes = [note, ...page.notes]
      return note
    },
    request: async (url, init) => {
      if (init?.method === 'DELETE') {
        const id = decodeURIComponent(url.split('/').pop())
        page.trashed.push(id)
        page.notes = page.notes.filter(n => n.id !== id)
        return { ok: true }
      }
      return { ok: false }
    },
  })
  return { page, host }
}

let turns
let turnBodies
beforeEach(() => {
  turns = []
  turnBodies = []
  try { localStorage.clear() } catch { /* */ }
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
  globalThis.fetch = vi.fn(async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null
    if (url === '/api/agent/turn') { turnBodies.push(body); const next = turns.shift(); return json({ conversationId: 'ac_1', turnId: 1, envelope: typeof next === 'function' ? next(body) : next, usage: { citations: [] } }) }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (String(url).startsWith('/api/agent/conversations')) return json({ conversations: [] })
    return json({})
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const env = (disposition, ops = [], reply = '') => ({ disposition, reply, question: null, ops, unsupported_category: null })
const type = (text) => {
  const box = screen.getByLabelText('Message UCT Agent')
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
}
const mount = (host) => render(<AgentPanel host={host} surface="journal" onClose={() => {}} />)

describe('UCT Agent on /journal (W2-C1)', () => {
  it('READ: "list my notes" answers from the page\'s list — no model call', async () => {
    const { host } = makePage()
    mount(host)
    type('list my notes')
    await screen.findAllByText(/Your recent notes \(2\)/)
    expect(screen.getAllByText(/NVDA earnings prep \[NVDA\] — 2026-11-01/).length).toBeGreaterThan(0)
    expect(turnBodies).toHaveLength(0)
    await screen.findByText('Online')
    type('show my notes on NVDA')
    await screen.findAllByText(/Your notes on NVDA \(1 of 2 loaded\)/)
  })

  it('WRITE: "add a note: …" creates it through the Notebook\'s creation path (title, TipTap body), receipts, and Undo trashes exactly that note', async () => {
    const { page, host } = makePage()
    mount(host)
    type('add a note about NVDA: watching for a reclaim of the 20 EMA into earnings')
    const receipt = await screen.findByTestId('agent-receipt')
    expect(receipt.textContent).toContain('Added note “watching for a reclaim of the 20 EMA into earnings” (NVDA) to your Notebook')
    expect(page.created).toHaveLength(1)
    expect(page.created[0]).toMatchObject({ title: 'watching for a reclaim of the 20 EMA into earnings', ticker: 'NVDA' })
    expect(page.created[0].bodyJson).toEqual(noteBody('watching for a reclaim of the 20 EMA into earnings'))
    expect(page.refreshed).toBeGreaterThan(0)
    expect(turnBodies).toHaveLength(0)
    type('undo that')
    await screen.findByText(/Moved “watching for a reclaim of the 20 EMA into earnings” to Trash/)
    expect(page.trashed).toEqual(['n3'])
    expect(page.notes.map(n => n.id)).toEqual(['n1', 'n2'])
  })

  it('MODEL: an empty note is refused; the manifest offers notes only (no trade, position or chart capability)', async () => {
    const { page, host } = makePage()
    mount(host)
    turns.push((body) => env('apply', [{ action: 'journal.createNote', target: body.context.journal[0].ref, args: { title: 'Idea', text: '   ', symbol: null } }]))
    type('write that down for me')
    await screen.findByText(/What should the note say\?/)
    expect(page.created).toHaveLength(0)
    const names = turnBodies[0].capabilities.map(c => c.name)
    expect(names).toEqual(expect.arrayContaining(['journal.listNotes', 'journal.createNote', 'stock.profile', 'news.latest', 'app.open']))
    expect(names.some(n => /trade|position|account/i.test(n))).toBe(false)
    expect(names.some(n => n.startsWith('chart.') || n.startsWith('widget.') || n === 'screener.openSaved')).toBe(false)
    expect(turnBodies[0].context.surface).toBe('journal')
    expect(turnBodies[0].context.journal[0]).toMatchObject({ notes: 2, recent: ['NVDA earnings prep [NVDA]', 'Weekly review'] })
  })

  it('MODEL WRITE: a note the model planned is created with its own words and a sensible receipt', async () => {
    const { page, host } = makePage()
    mount(host)
    turns.push((body) => env('apply', [{ action: 'journal.createNote', target: body.context.journal[0].ref, args: { title: 'Semis watch', text: 'AMD and SMCI report this week.\nWatch the open.', symbol: null } }]))
    type('make a note that AMD and SMCI report this week, watch the open')
    const receipt = await screen.findByTestId('agent-receipt')
    expect(receipt.textContent).toContain('Added note “Semis watch” to your Notebook')
    expect(page.created[0].bodyJson.content).toHaveLength(2)
    await waitFor(() => expect(page.notes[0].title).toBe('Semis watch'))
  })
})
