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
import { contract, contractBody } from '../__fixtures__/contract'

// CONTRACT: both drafts are the REAL server's answers to POST /api/j2/earnings-prep/{symbol}/draft
// (`__fixtures__/contract`, written by tools/notebook_contract_fixtures.py and held current by
// tests/test_notebook_contract_fixtures.py): one with every source answering, one for a name no
// source knows. Nothing here types a draft, a cell or a "missing" sentence by hand.
const FULL = contractBody('earnings-prep.draft')
const EMPTY = contractBody('earnings-prep.draft.sources-missing')

/** Every cell of a draft: `{value, source, asOf, missing}`. */
function cells(draft) {
  return [draft.report.date, draft.report.timing, draft.expectedMove, draft.street.eps, draft.street.revenue,
    draft.street.epsYearAgo, draft.street.revenueYearAgo, draft.reactions, draft.recap, draft.myNotes,
    draft.myTrades, draft.myPosition]
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

  it('the recorded drafts are a full one and an all-missing one (non-vacuity)', () => {
    for (const c of cells(FULL)) {
      expect(Object.keys(c).sort()).toEqual(['asOf', 'missing', 'source', 'value'])
      expect(c.value).not.toBeNull()
      expect(c.missing).toBeNull()
    }
    for (const c of cells(EMPTY)) {
      expect(c.value).toBeNull()
      expect(c.missing.length).toBeGreaterThan(20)
    }
    expect([FULL.symbol, EMPTY.symbol]).toEqual(['EPNV', 'EPZZ'])
  })

  it('every value the server sent arrives with its source and as-of', () => {
    const text = flat(buildPrepDoc(FULL))
    const sources = [...new Set(cells(FULL).map((c) => c.source))]
    expect(sources.length).toBe(8)
    for (const src of sources) {
      expect(text).toMatch(new RegExp(`Source: ${src.replace(/[()]/g, '\\$&')}, as of `))
    }
    expect(text).toContain('Wed, Oct 7, 2026')
    expect(text).toContain('after the close')
    expect(text).toContain('±6.5% ($12.40)')
    // UNITS, read off the real draft: the move, the growth and the reactions arrive as PERCENTS
    // and are printed as they are; only a trade's own result is a fraction (the D2 case below).
    expect(FULL.expectedMove.value.pct).toBe(6.5)
    expect([FULL.street.epsGrowthPct, FULL.street.revenueGrowthPct]).toEqual([61.7, 53.8])
    expect(text).toContain('+61.7%')
    expect(text).toContain('+53.8%')
    expect(FULL.reactions.value[0]).toMatchObject({ reactionPct: -3.1, impliedPct: 6.9, epsSurprisePct: 4.2 })
    expect(text).toContain('−3.1%')
    expect(text).toContain('±6.9%')
    expect(text).not.toMatch(/6170|5380|±650|±0\.1%/)
    expect(text).toContain('$1.31')
    expect(text).toContain('$54.00B')
    expect(text).toContain('Beat +4.2%')
    expect(text).toContain('Miss −1.3%')
    expect(text).toContain('Data center carried it')
    expect(text).not.toContain('not available')
  })

  it('a source with nothing reads as a labelled dash, and no number is invented', () => {
    const text = flat(buildPrepDoc(EMPTY))
    const sentences = [...new Set(cells(EMPTY).map((c) => c.missing))]
    expect(sentences.length).toBe(10)                          // the server's own ten reasons
    for (const sentence of sentences) {
      expect(text).toContain(`${MISSING_DASH} not available: ${sentence}`)
    }
    // nothing numeric beyond the frozen-at stamp and the window's own prompts
    const body = text.split('\n').filter((l) => !l.startsWith('Drafted by UCT'))
    expect(body.join(' ')).not.toMatch(/\$\d|±\d|\d+(\.\d+)?%/)
  })

  it('the member\'s own notes are cited by id; trades link to the trade page', () => {
    const d = buildPrepDoc(FULL)
    const links = find(d, (n) => n.type === 'noteLink').map((n) => n.attrs.noteId)
    expect(links).toEqual(FULL.myNotes.value.map((n) => n.id))
    const hrefs = find(d, (n) => n.type === 'text' && n.marks?.some((m) => m.type === 'link')).map((n) => n.marks[0].attrs.href)
    expect(hrefs).toEqual(FULL.myTrades.value.map((t) => `/journal-2-0/trade/${t.id}`))
  })

  it('the open position is written with its real stop', () => {
    const [pos] = FULL.myPosition.value
    expect(pos).toMatchObject({ side: 'Long', shares: 100, entryPrice: 180, stopPrice: 170 })
    expect(flat(buildPrepDoc(FULL))).toContain('Long 100 shares, at $180.00, stop $170.00')
  })

  it('the trade line carries the R multiple and the result the server sent', () => {
    const [t] = FULL.myTrades.value
    expect(t).toMatchObject({ side: 'Long', rMultiple: 2.46, result: 'Win' })
    const line = flat(buildPrepDoc(FULL)).split('\n').find((l) => l.includes('2.5R'))
    expect(line).toContain('Long')
    expect(line).toContain('Win')
  })

  // D2 (docs/notebook/fin-tests.md), found by the contract conversion and fixed: the server sends
  // `pnlPercent` as a FRACTION (0.123), and the note used to append "%" without multiplying, so
  // a 12.3% trade read "+0.1%". Both old suites had typed 12.3 by hand.
  it('D2: a closed trade that made 12.3% is written as +12.3%', () => {
    const [t] = FULL.myTrades.value
    expect(t.pnlPercent).toBe(0.123)                           // what the server really sends
    const text = flat(buildPrepDoc(FULL))
    expect(text).not.toContain('+0.1%')
    expect(text).toContain('+12.3%')
  })

  it('a losing trade keeps its sign, and a flat one has none', () => {
    const [t] = FULL.myTrades.value
    const withResult = (pnlPercent) => flat(buildPrepDoc({ ...FULL, myTrades: { ...FULL.myTrades, value: [{ ...t, pnlPercent }] } }))
    expect(withResult(-0.0456)).toContain('-4.6%')
    expect(withResult(0)).toContain('0.0%')
    expect(withResult(0)).not.toContain('+0.0%')
  })

  it('a broker placeholder stop (stop == entry) is never written as a stop', () => {
    // One row overridden on the real draft: a broker import whose stored stop equals its entry.
    const [pos] = FULL.myPosition.value
    const d = buildPrepDoc({ ...FULL, myPosition: { ...FULL.myPosition, value: [{ ...pos, shares: 5, entryPrice: 50, stopPrice: 50 }] } })
    const text = flat(d)
    expect(text).toContain('Long 5 shares, at $50.00')
    expect(text).not.toContain('stop $50.00')
  })

  it('titles the note with the symbol and the report day', () => {
    expect(prepTitle(FULL)).toBe('Earnings Prep — EPNV (Wed, Oct 7)')
    expect(prepTitle(EMPTY)).toBe('Earnings Prep — EPZZ')
  })
})

describe('createEarningsPrepNote -- the click', () => {
  beforeEach(() => { settleNoteWrite.mockClear() })

  const respond = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })

  it('drafts, then creates through POST /api/j2/notes with the prep tags and the ticker', async () => {
    const calls = []
    global.fetch = vi.fn((url, init = {}) => {
      calls.push([url, init.method || 'GET', init.body ? JSON.parse(init.body) : null])
      if (url === '/api/j2/earnings-prep/EPNV/draft') return respond(200, FULL)
      if (url === '/api/j2/notes') return respond(200, { note: { id: 'new-note', updatedAt: 'r1' } })
      return respond(404, {})
    })
    const note = await createEarningsPrepNote({ symbol: 'EPNV' })
    expect(note.id).toBe('new-note')
    expect(calls.map(([u, m]) => `${m} ${u}`)).toEqual(['POST /api/j2/earnings-prep/EPNV/draft', 'POST /api/j2/notes'])
    const body = calls[1][2]
    expect(body.tags).toEqual([...PREP_TAGS])
    expect(body.ticker).toBe('EPNV')
    expect(body.title).toBe('Earnings Prep — EPNV (Wed, Oct 7)')
    expect(body.bodyJson.type).toBe('doc')
    expect(settleNoteWrite).toHaveBeenCalledWith('new-note', expect.objectContaining({ id: 'new-note' }))
  })

  it('a refused draft (the daily cap) creates NOTHING and carries the server sentence', async () => {
    const refusal = contract('earnings-prep.draft.daily-cap')
    const sentence = refusal.body.detail
    expect(sentence).toBe("You've drafted 20 earnings prep notes today, the daily limit. It resets at midnight Eastern.")
    global.fetch = vi.fn((url) => (url.endsWith('/draft') ? respond(refusal._contract.status, refusal.body) : respond(200, { note: { id: 'x' } })))
    await expect(createEarningsPrepNote({ symbol: 'EPNV' })).rejects.toMatchObject({ status: 429, message: sentence })
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
