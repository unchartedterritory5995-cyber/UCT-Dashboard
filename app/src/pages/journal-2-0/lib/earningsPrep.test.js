// Wave 13 lane 13C, phase 1 -- the prep note body and the one create door.
//
// What each block proves:
//   * BUILDABLE: the body opens in the REAL editor schema, full and all-missing (H14: one node
//     the editor cannot build and the note opens empty).
//   * SOURCE AND AS-OF ON EVERY VALUE: each value the server sent arrives with its source line.
//   * MISSING IS LABELLED: a source with nothing reads as a dash plus the server's own sentence,
//     and no number is invented in its place.
//   * CITED: the member's own notes are noteLink nodes carrying their ids; trades link to the
//     trade page.
//   * THE CLICK: createEarningsPrepNote drafts, then creates through POST /api/j2/notes with the
//     prep tags and the ticker; a refused draft (the daily cap) creates nothing.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./offline/settleNoteWrite', () => ({ settleNoteWrite: vi.fn(async () => {}) }))

import {
  buildPrepDoc, createEarningsPrepNote, prepTitle, MISSING_DASH, PREP_TAGS, earningsPrepEnabled,
} from './earningsPrep'
import { settleNoteWrite } from './offline/settleNoteWrite'
import { editorSchema } from './tiptap'
import { latchNotebookFlags, __resetNotebookFlags } from './offline/notebookFlags'

const cell = (value, source, asOf = '2026-10-01T21:00:00Z') => ({ value, source, asOf, missing: null })
const miss = (source, missing) => ({ value: null, source, asOf: null, missing })

const FULL = {
  symbol: 'NVDA',
  frozenAt: '2026-10-02T14:00:00Z',
  report: { date: cell('2026-10-05', 'UCT earnings calendar'), timing: cell('amc', 'UCT earnings calendar') },
  expectedMove: cell({ pct: 6.5, dollar: 12.4 }, 'Options-implied move, captured by UCT before the report'),
  street: {
    quarter: 'FY2027 Q3',
    eps: cell(1.31, 'UCT earnings data (consensus estimates and reported results)'),
    revenue: cell(54_000_000_000, 'UCT earnings data (consensus estimates and reported results)'),
    epsYearAgo: cell(0.81, 'UCT earnings data (consensus estimates and reported results)'),
    revenueYearAgo: cell(35_100_000_000, 'UCT earnings data (consensus estimates and reported results)'),
    epsGrowthPct: 61.7, revenueGrowthPct: 53.8,
  },
  reactions: cell([
    { quarter: 'FY2027 Q2', reportDate: '2026-08-26', epsBeat: true, epsSurprisePct: 4.2, revenueBeat: true, revenueSurprisePct: 1.1, reactionPct: -3.1, impliedPct: 6.9 },
    { quarter: 'FY2027 Q1', reportDate: '2026-05-27', epsBeat: false, epsSurprisePct: -1.3, revenueBeat: null, revenueSurprisePct: null, reactionPct: 2.4, impliedPct: null },
  ], 'UCT earnings data, reactions from UCT daily bars'),
  recap: cell({ quarter: 'Q2 2027', headline: 'Data center carried it', sentiment: 'positive',
    bullets: ['Blackwell ramp ahead of plan', 'Gross margin guided flat'], guidance: 'Raised' }, 'UCT call recap (stored)'),
  myNotes: cell([{ id: 'note-a', title: 'NVDA thesis', updatedAt: '2026-09-30T10:00:00Z' }], 'Your Notebook'),
  myTrades: cell([{ id: 'trade-1', side: 'Long', entryDate: '2026-08-01', exitDate: '2026-08-20', pnlPercent: 12.3, rMultiple: 2.1, result: 'Win' }], 'Your trade journal'),
  myPosition: cell([{ id: 'p1', symbol: 'NVDA', side: 'Long', shares: 100, entryPrice: 180, stopPrice: 170, entryDate: '2026-09-15' }], 'Your open positions'),
}

const MISSING_SENTENCES = {
  date: 'No report date on the UCT calendar or in UCT\'s earnings data.',
  timing: 'The calendar has not said before or after the bell yet.',
  move: 'Not captured yet. UCT records the options-implied move the evening before the report.',
  est: 'No consensus estimate for the coming quarter in UCT\'s earnings data.',
  ago: 'No reported result for the same quarter a year ago in UCT\'s earnings data.',
  reactions: 'No reported quarters with an earnings-day reaction in UCT\'s earnings data.',
  recap: 'No stored call recap for NVDA.',
  notes: 'You have no notes on NVDA yet.',
  trades: 'You have no closed trades in NVDA in your journal.',
  position: 'You hold no open position in NVDA.',
}

const EMPTY = {
  symbol: 'NVDA',
  frozenAt: '2026-10-02T14:00:00Z',
  report: { date: miss('UCT earnings calendar', MISSING_SENTENCES.date), timing: miss('UCT earnings calendar', MISSING_SENTENCES.timing) },
  expectedMove: miss('Options-implied move, captured by UCT before the report', MISSING_SENTENCES.move),
  street: { quarter: null, eps: miss('UCT earnings data', MISSING_SENTENCES.est), revenue: miss('UCT earnings data', MISSING_SENTENCES.est),
    epsYearAgo: miss('UCT earnings data', MISSING_SENTENCES.ago), revenueYearAgo: miss('UCT earnings data', MISSING_SENTENCES.ago) },
  reactions: miss('UCT earnings data, reactions from UCT daily bars', MISSING_SENTENCES.reactions),
  recap: miss('UCT call recap (stored)', MISSING_SENTENCES.recap),
  myNotes: miss('Your Notebook', MISSING_SENTENCES.notes),
  myTrades: miss('Your trade journal', MISSING_SENTENCES.trades),
  myPosition: miss('Your open positions', MISSING_SENTENCES.position),
}

/** Every text node, plus a token per noteLink, in document order. */
function textOf(node, out = []) {
  if (!node) return out
  if (node.type === 'text') out.push(node.text)
  if (node.type === 'noteLink') out.push(`[[note:${node.attrs.noteId}]]`)
  for (const c of node.content || []) textOf(c, out)
  return out
}
const flat = (d) => textOf(d).join('\n')
function find(node, pred, out = []) {
  if (!node) return out
  if (pred(node)) out.push(node)
  for (const c of node.content || []) find(c, pred, out)
  return out
}

describe('the prep note body', () => {
  const schema = editorSchema()

  it('builds in the REAL editor schema, full and all-missing', () => {
    for (const d of [FULL, EMPTY, {}]) {
      const node = schema.nodeFromJSON(buildPrepDoc(d))
      node.check()
    }
  })

  it('CONTROL: the schema check can fail (an empty text node is refused)', () => {
    expect(() => schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }] })).toThrow()
  })

  it('every value the server sent arrives with its source and as-of', () => {
    const text = flat(buildPrepDoc(FULL))
    for (const src of ['UCT earnings calendar', 'Options-implied move, captured by UCT before the report',
      'UCT earnings data (consensus estimates and reported results)', 'UCT earnings data, reactions from UCT daily bars',
      'UCT call recap (stored)', 'Your Notebook', 'Your trade journal', 'Your open positions']) {
      expect(text).toMatch(new RegExp(`Source: ${src.replace(/[()]/g, '\\$&')}, as of `))
    }
    expect(text).toContain('Mon, Oct 5, 2026')
    expect(text).toContain('after the close')
    expect(text).toContain('±6.5% ($12.40)')
    expect(text).toContain('$1.31')
    expect(text).toContain('$54.00B')
    expect(text).toContain('Beat +4.2%')
    expect(text).toContain('Miss −1.3%')
    expect(text).toContain('Data center carried it')
    expect(text).not.toContain('not available')
  })

  it('a source with nothing reads as a labelled dash, and no number is invented', () => {
    const text = flat(buildPrepDoc(EMPTY))
    for (const sentence of Object.values(MISSING_SENTENCES)) {
      expect(text).toContain(`${MISSING_DASH} not available: ${sentence}`)
    }
    // nothing numeric beyond the frozen-at stamp and the window's own prompts
    const body = text.split('\n').filter((l) => !l.startsWith('Drafted by UCT'))
    expect(body.join(' ')).not.toMatch(/\$\d|±\d|\d+(\.\d+)?%/)
  })

  it('the member\'s own notes are cited by id; trades link to the trade page', () => {
    const d = buildPrepDoc(FULL)
    const links = find(d, (n) => n.type === 'noteLink').map((n) => n.attrs.noteId)
    expect(links).toEqual(['note-a'])
    const hrefs = find(d, (n) => n.type === 'text' && n.marks?.some((m) => m.type === 'link')).map((n) => n.marks[0].attrs.href)
    expect(hrefs).toEqual(['/journal-2-0/trade/trade-1'])
  })

  it('a broker placeholder stop (stop == entry) is never written as a stop', () => {
    const d = buildPrepDoc({ ...FULL, myPosition: cell([{ id: 'p', side: 'Long', shares: 5, entryPrice: 50, stopPrice: 50 }], 'Your open positions') })
    const text = flat(d)
    expect(text).toContain('Long 5 shares, at $50.00')
    expect(text).not.toContain('stop $50.00')
  })

  it('titles the note with the symbol and the report day', () => {
    expect(prepTitle(FULL)).toBe('Earnings Prep — NVDA (Mon, Oct 5)')
    expect(prepTitle(EMPTY)).toBe('Earnings Prep — NVDA')
  })
})

describe('createEarningsPrepNote -- the click', () => {
  beforeEach(() => { settleNoteWrite.mockClear() })

  const respond = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })

  it('drafts, then creates through POST /api/j2/notes with the prep tags and the ticker', async () => {
    const calls = []
    global.fetch = vi.fn((url, init = {}) => {
      calls.push([url, init.method || 'GET', init.body ? JSON.parse(init.body) : null])
      if (url === '/api/j2/earnings-prep/NVDA/draft') return respond(200, FULL)
      if (url === '/api/j2/notes') return respond(200, { note: { id: 'new-note', updatedAt: 'r1' } })
      return respond(404, {})
    })
    const note = await createEarningsPrepNote({ symbol: 'NVDA' })
    expect(note.id).toBe('new-note')
    expect(calls.map(([u, m]) => `${m} ${u}`)).toEqual(['POST /api/j2/earnings-prep/NVDA/draft', 'POST /api/j2/notes'])
    const body = calls[1][2]
    expect(body.tags).toEqual([...PREP_TAGS])
    expect(body.ticker).toBe('NVDA')
    expect(body.title).toBe('Earnings Prep — NVDA (Mon, Oct 5)')
    expect(body.bodyJson.type).toBe('doc')
    expect(settleNoteWrite).toHaveBeenCalledWith('new-note', expect.objectContaining({ id: 'new-note' }))
  })

  it('a refused draft (the daily cap) creates NOTHING and carries the server sentence', async () => {
    const sentence = "You've drafted 20 earnings prep notes today, the daily limit. It resets at midnight Eastern."
    global.fetch = vi.fn((url) => (url.endsWith('/draft') ? respond(429, { detail: sentence }) : respond(200, { note: { id: 'x' } })))
    await expect(createEarningsPrepNote({ symbol: 'NVDA' })).rejects.toMatchObject({ status: 429, message: sentence })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(settleNoteWrite).not.toHaveBeenCalled()
  })
})

describe('the gate', () => {
  it('reads the latched flag, and nothing latched is OFF', () => {
    __resetNotebookFlags()
    expect(earningsPrepEnabled()).toBe(false)
    latchNotebookFlags({ notebook_earnings_prep_enabled: true })
    expect(earningsPrepEnabled()).toBe(true)
    __resetNotebookFlags()
  })
})
