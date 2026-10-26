// Notebook widgets Task 20 (wave 6): the /recap and /screen rows (lib/notebookWidgetsFetch.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  loadPicks, pickRows, shortDay, screenName, BARE_ROWS, TRADES_URL, SCREENS_URL, loadTrades, tradeLabel,
  dedicatedSnapshotKind,
} from './notebookWidgetsFetch'

const trade = (i, extra = {}) => ({ id: `t${i}`, symbol: 'nvda', side: 'Long', exitDate: `2026-10-${String(10 + i).padStart(2, '0')}`, ...extra })
const screenRow = (id, name, scannable = true) => ({ def_id: id, scannable, definition: { meta: { name } } })
const DOC = {
  trades: Array.from({ length: 8 }, (_, i) => trade(i)),
  screens: [screenRow('u:1', 'Tight flags'), screenRow('u:2', 'Gappers'), screenRow('u:3', 'Base breakouts'),
    screenRow('u:4', 'Pullbacks'), screenRow('u:5', 'Leaders'), screenRow('u:6', 'Laggards')],
}
const insert = vi.fn((kind, params) => ({ kind: kind.id, params }))

let fetchSpy
beforeEach(() => { insert.mockClear() })
afterEach(() => vi.unstubAllGlobals())

describe('pickRows', () => {
  it('a bare / offers at most five of each, under their kinds\' groups', () => {
    const rows = pickRows('', DOC, insert)
    expect(rows.filter((r) => r.cmd === 'recap')).toHaveLength(BARE_ROWS)
    expect(rows.filter((r) => r.cmd === 'screen')).toHaveLength(BARE_ROWS)
    expect(new Set(rows.filter((r) => r.cmd === 'recap').map((r) => r.group))).toEqual(new Set(['review']))
    expect(new Set(rows.filter((r) => r.cmd === 'screen').map((r) => r.group))).toEqual(new Set(['open']))
  })

  it('/recap lists every loaded trade as "Recap — SYM side, Mon D", inserting a Trade recap with its tradeId', () => {
    const rows = pickRows('recap', DOC, insert)
    expect(rows).toHaveLength(8)
    expect(rows[0].title).toBe('Recap — NVDA long, Oct 10')
    expect(rows[0].command).toEqual({ kind: 'tradeRecap', params: { tradeId: 't0' } })
    expect(rows.every((r) => r.cmd === 'recap')).toBe(true)
  })

  it('/screen lists the saved screens as "Screen — <name>", inserting My screen today with its definitionId', () => {
    const rows = pickRows('screen', DOC, insert)
    expect(rows.map((r) => r.title)).toEqual(['Screen — Tight flags', 'Screen — Gappers', 'Screen — Base breakouts',
      'Screen — Pullbacks', 'Screen — Leaders', 'Screen — Laggards'])
    expect(rows[1].command).toEqual({ kind: 'myScreenToday', params: { definitionId: 'u:2' } })
  })

  it('a prefix completes, an argument narrows, anything else offers nothing', () => {
    expect(pickRows('rec', DOC, insert).every((r) => r.cmd === 'recap')).toBe(true)
    expect(pickRows('scr', DOC, insert)).toHaveLength(6)
    expect(pickRows('screen laggards', DOC, insert).map((r) => r.title)).toEqual(['Screen — Laggards'])
    expect(pickRows('recap amd', DOC, insert)).toEqual([])
    expect(pickRows('recapx', DOC, insert)).toEqual([])
    expect(pickRows('rec nvda', DOC, insert)).toEqual([])            // prefix + args never matches
    expect(pickRows('screens', DOC, insert)).toEqual([])
  })

  it('two trades with the same words get distinct titles (a title is the menu row key)', () => {
    const doc = { trades: [trade(1, { id: 'a' }), trade(1, { id: 'b' })], screens: [] }
    expect(pickRows('recap', doc, insert).map((r) => r.title)).toEqual(['Recap — NVDA long, Oct 11', 'Recap — NVDA long, Oct 11 (2)'])
  })
})

describe('Task 10.21: /actual, Plan vs actual over the same trades', () => {
  it('only when asked for (wave 10), never on a bare /, each inserting the dedicated kind with that trade', () => {
    expect(pickRows('actual', DOC, insert).some((r) => r.cmd === 'actual')).toBe(false)          // the gate
    expect(pickRows('', DOC, insert, { actual: true }).some((r) => r.cmd === 'actual')).toBe(false)
    const rows = pickRows('actual', DOC, insert, { actual: true })
    expect(rows).toHaveLength(8)
    expect(rows[0].title).toBe('Plan vs actual — NVDA long, Oct 10')
    expect(rows[0].group).toBe('review')
    expect(rows[0].command).toEqual({ kind: 'myPlanVsActual', params: { settings: { tradeId: 't0' } } })
    expect(typeof insert.mock.calls.at(-1)[0].capture).toBe('function')                      // its POST door
    expect(pickRows('actual amd', DOC, insert, { actual: true })).toEqual([])
    expect(tradeLabel(trade(1))).toBe('NVDA long, Oct 11')
    expect(dedicatedSnapshotKind('tradeRecap')).toBeNull()                                     // not a dedicated kind
  })

  it('loadTrades: the trades alone, a failed read rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ trades: [trade(1), { id: '' }] }) })))
    expect(await loadTrades()).toEqual([trade(1)])
    expect(fetch).toHaveBeenCalledWith(TRADES_URL, { credentials: 'include' })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    await expect(loadTrades()).rejects.toThrow()
  })
})

describe('shortDay and screenName', () => {
  it('reads a bare day as it is, and a UTC timestamp on the ET calendar', () => {
    expect(shortDay('2026-10-14')).toBe('Oct 14')
    expect(shortDay('2026-10-15T02:00:00+00:00')).toBe('Oct 14')     // 10 PM ET on the 14th
    expect(shortDay('')).toBe('')
  })

  // Fix F4 (D3, walk 2026-10-21): a manual date-only exit typed 2026-10-15 is stored at UTC midnight. The
  // /recap row said "Oct 14"; a date-only value is a calendar date and is never shifted.
  it('reads a DATE-ONLY entry (exact UTC midnight) as the day the member typed, in every spelling', () => {
    expect(shortDay('2026-10-15T00:00:00Z')).toBe('Oct 15')
    expect(shortDay('2026-10-15T00:00:00+00:00')).toBe('Oct 15')
    expect(shortDay('2026-10-15T00:00:00.000Z')).toBe('Oct 15')
    expect(shortDay('2026-10-15T00:00:00')).toBe('Oct 15')            // naive: read as UTC, as the server does
    // ...while a real time one minute past midnight UTC is still 8:01 PM ET on the 14th.
    expect(shortDay('2026-10-15T00:01:00Z')).toBe('Oct 14')
  })

  it('the /recap pick row titles a manual trade by the day it was typed', () => {
    const rows = pickRows('recap', { trades: [trade(0, { symbol: 'MSFT', exitDate: '2026-10-15T00:00:00Z' })], screens: [] },
      () => () => {})
    expect(rows.map((r) => r.title)).toEqual(['Recap — MSFT long, Oct 15'])
  })

  it('a screen with no name falls back to its id', () => {
    expect(screenName({ def_id: 'u:9', definition: { meta: {} } })).toBe('u:9')
  })
})

describe('loadPicks', () => {
  it('reads the trades route and the definitions route, keeping only scannable screens', async () => {
    fetchSpy = vi.fn(async (url) => ({
      ok: true,
      json: async () => (url === TRADES_URL
        ? { trades: [trade(1), { symbol: 'NO-ID' }] }
        : { definitions: [screenRow('u:1', 'Tight flags'), screenRow('u:2', 'An indicator', false)] }),
    }))
    vi.stubGlobal('fetch', fetchSpy)
    const doc = await loadPicks()
    expect(fetchSpy.mock.calls.map((c) => c[0]).sort()).toEqual([SCREENS_URL, TRADES_URL].sort())
    expect(TRADES_URL).toBe('/api/j2/trades?limit=10')
    expect(doc.trades.map((t) => t.id)).toEqual(['t1'])
    expect(doc.screens.map((r) => r.def_id)).toEqual(['u:1'])
  })

  it('one failed read leaves its list empty; both failing rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => (url === TRADES_URL
      ? { ok: false, status: 500, json: async () => ({}) }
      : { ok: true, json: async () => ({ definitions: [screenRow('u:1', 'Flags')] }) })))
    const doc = await loadPicks()
    expect(doc.trades).toEqual([])
    expect(doc.screens).toHaveLength(1)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network') }))
    await expect(loadPicks()).rejects.toThrow()
  })
})
