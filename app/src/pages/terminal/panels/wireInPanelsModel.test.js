// The news wire inside MOVE, CN and NEWS: the pure half. Rails:
//   * the one-stock read is exactly the request `NVDA UCN` sends, asked for a few rows;
//   * rows are newest first with "Today" and a time on today's and a full date on any other;
//   * the lede says how many are from today, and says plainly when none is;
//   * none found says how far back the search reached; a refusal is the UCT News panel's own
//     sentence with no Retry; any other failure is "could not check" with Retry, never "none";
//   * the NEWS strip's states come from the shared pool's own state.
// Every headline here is invented. No real ticker is used.
import { describe, it, expect } from 'vitest'
import { addDays, dayRequest, etDateKey, fmtStamp } from '../../charts/widgets/tradeExchangeNewsModel'
import { formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { BY_CODE } from '../functions'
import { matchingSentence, offState, reachSentence } from './uctNewsModel'
import { readStockWire } from './useStockWire'
import {
  WIRE_CREDIT, WIRE_MARKET_COMMAND, WIRE_ROWS, WIRE_ROW_SOURCE, stockWireFailure, stockWireLede, stockWireNone, stockWireReadNote,
  stockWireRequest, stockWireResult, wireRow, wireStamp, wireStockCommand, wireStripView,
} from './wireInPanelsModel'

const NOW = Date.parse('2026-11-19T17:30:00Z')            // 12:30 PM in New York
const TODAY = etDateKey(NOW)
const D1 = addDays(TODAY, -1)
const D9 = addDays(TODAY, -9)
const at = (key, minute = 0) => Date.parse(`${key}T16:00:00Z`) + minute * 60_000
const H = (seq, key, minute, content, tickers = ['ZZQA'], extra = {}) => ({
  type: 'headline', seq, id: `id${seq}`, content, received_at_ms: at(key, minute), tickers, mentions: [], category: 'News', ...extra,
})

describe('the one-stock read', () => {
  it('is the request NVDA UCN sends, asked for a few rows', () => {
    expect(stockWireRequest('zzqa', 4)).toEqual({
      ...dayRequest({ linkedSym: 'ZZQA', hidePlaceholders: true }), history: true, limit: 4,
    })
    expect(stockWireRequest('ZZQA', 4)).toMatchObject({ symbol: 'ZZQA', history: true, hide_placeholders: true, query: '' })
  })

  it('each surface shows a few rows, and the row commands are functions the registry knows', () => {
    expect(WIRE_ROWS).toEqual({ MOVE: 4, CN: 3, NEWS: 3 })
    expect(wireStockCommand('zzqa')).toBe('ZZQA UCN')
    expect(wireStockCommand('')).toBe('')
    expect(BY_CODE.UCN.ticker).toBeTruthy()
    expect(BY_CODE[WIRE_MARKET_COMMAND].market).toBeTruthy()
    expect(WIRE_ROW_SOURCE).toBe('UCT News')
    expect(WIRE_CREDIT).toBe('UCT News, powered by Trade Exchange')
  })
})

describe('rows', () => {
  it("today's rows say Today and the time; any other day carries its full date", () => {
    const ms = at(TODAY, 5)
    expect(wireStamp(ms, TODAY)).toBe(`Today ${formatTimeEt(ms, { seconds: true, zoneSuffix: 'ET', absent: '' })}`)
    expect(wireStamp(ms, TODAY)).toMatch(/^Today \d{1,2}:05:00 [AP]M ET$/)
    expect(wireStamp(at(D1, 5), TODAY)).toBe(fmtStamp(at(D1, 5)))
    expect(wireStamp(at(D1, 5), TODAY)).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{1,2}:05:00 [AP]M ET$/)
    expect(wireStamp(0, TODAY)).toBe('time not recorded')
    expect(wireStamp(null, TODAY)).toBe('time not recorded')
  })

  it('a row keeps its type, and a headline with no type is Other', () => {
    expect(wireRow(H(1, TODAY, 1, 'INVENTED: a', ['ZZQA'], { category: 'Earnings' }), TODAY)).toMatchObject({ seq: 1, today: true, type: 'Earnings' })
    expect(wireRow(H(2, D1, 1, 'INVENTED: b', ['ZZQA'], { category: '' }), TODAY)).toMatchObject({ seq: 2, today: false, type: 'Other' })
  })

  it('the answer is drawn newest first, cut to the limit, and counts what is from today', () => {
    const body = { items: [H(3, D1, 2, 'INVENTED: c'), H(9, TODAY, 3, 'INVENTED: e'), H(7, TODAY, 1, 'INVENTED: d'), H(1, D9, 1, 'INVENTED: a')], has_older: true, searched_to: D9 }
    const res = stockWireResult('zzqa', body, 3, NOW)
    expect(res).toMatchObject({ sym: 'ZZQA', phase: 'rows', today: 2, hasOlder: true, readAt: NOW })
    expect(res.rows.map((r) => r.seq)).toEqual([9, 7, 3])
    expect(res.rows.map((r) => r.today)).toEqual([true, true, false])
  })

  it('the lede says how many are from today, and says plainly when none is', () => {
    const all = stockWireResult('ZZQA', { items: [H(9, TODAY, 3, 'INVENTED: e'), H(7, TODAY, 1, 'INVENTED: d')] }, 4, NOW)
    expect(stockWireLede('ZZQA', all)).toBe('The newest 2 headlines naming ZZQA, from today.')
    const one = stockWireResult('ZZQA', { items: [H(9, TODAY, 3, 'INVENTED: e')] }, 4, NOW)
    expect(stockWireLede('ZZQA', one)).toBe('The newest headline naming ZZQA, from today.')
    const mixed = stockWireResult('ZZQA', { items: [H(9, TODAY, 3, 'INVENTED: e'), H(3, D1, 2, 'INVENTED: c'), H(1, D9, 1, 'INVENTED: a')] }, 4, NOW)
    expect(stockWireLede('ZZQA', mixed)).toBe('The newest 3 headlines naming ZZQA: 1 from today, the rest earlier (each row carries its date).')
    const old = stockWireResult('ZZQA', { items: [H(3, D1, 2, 'INVENTED: c'), H(1, D9, 1, 'INVENTED: a')] }, 4, NOW)
    expect(stockWireLede('ZZQA', old)).toBe('No headline names ZZQA today. The most recent 2 are shown, each with its date.')
    const oldOne = stockWireResult('ZZQA', { items: [H(1, D9, 1, 'INVENTED: a')] }, 4, NOW)
    expect(stockWireLede('ZZQA', oldOne)).toBe('No headline names ZZQA today. The most recent one is shown, with its date.')
    expect(stockWireLede('ZZQA', { rows: [] })).toBe('')
  })

  it('the line under the rows says when it was read and that it does not update by itself', () => {
    const res = stockWireResult('ZZQA', { items: [H(9, TODAY, 3, 'INVENTED: e')] }, 4, NOW)
    expect(stockWireReadNote('ZZQA', res)).toBe('Read at 12:30 PM ET. This list does not update on its own; ZZQA UCN is live and holds the full history.')
    expect(stockWireReadNote('ZZQA', {})).toBe('This list does not update on its own; ZZQA UCN is live and holds the full history.')
  })
})

describe('none found', () => {
  it('says how far back the search reached, in the UCT News panel own words', () => {
    const done = stockWireResult('ZZQA', { items: [], has_older: false, searched_to: D9 }, 4, NOW)
    expect(done).toMatchObject({ phase: 'none', rows: [], today: 0, hasOlder: false })
    expect(done.reach).toBe(reachSentence({ hasOlder: false, todayKey: TODAY }))
    expect(stockWireNone('ZZQA', done)).toEqual({
      title: 'No archived headline names ZZQA.',
      hint: 'Searched every day UCT News has kept, back to the start of its archive. A new one shows in ZZQA UCN the moment it arrives.',
    })
  })

  it('a search with further to go says where it stands and where to continue it', () => {
    const part = stockWireResult('ZZQA', { items: [], has_older: true, searched_to: D9 }, 4, NOW)
    expect(part.reach).toBe(reachSentence({ hasOlder: true, searchedTo: D9, todayKey: TODAY }))
    expect(part.reach).toContain('Earlier days have not been searched yet.')
    expect(stockWireNone('ZZQA', part).hint).toBe(`${part.reach} ZZQA UCN can search the earlier days.`)
    const first = stockWireResult('ZZQA', { items: [], has_older: true, searched_to: null }, 4, NOW)
    expect(first.reach).toBe('The search has not finished its first step yet. Earlier days have not been searched.')
  })

  it('a body with no list is none found, never a crash', () => {
    expect(stockWireResult('ZZQA', null, 4, NOW)).toMatchObject({ phase: 'none', rows: [] })
    expect(stockWireResult('ZZQA', { items: 'x' }, 4, NOW)).toMatchObject({ phase: 'none', rows: [] })
  })
})

describe('a read that did not answer', () => {
  it('a switched-off wire is the UCT News panel one sentence, with no Retry', () => {
    expect(stockWireFailure('ZZQA', { status: 404 })).toEqual({
      sym: 'ZZQA', phase: 'off', title: 'The news wire is not switched on for this server.', retry: false,
    })
    expect(stockWireFailure('ZZQA', { status: 404 }).title).toBe(offState('not_enabled').title)
    expect(stockWireFailure('ZZQA', { status: 401 })).toMatchObject({ phase: 'off', title: offState('signed_out').title, retry: false })
    expect(stockWireFailure('ZZQA', { status: 403 })).toMatchObject({ phase: 'off', title: offState('admin_only').title, retry: false })
  })

  it('anything else could not be checked, says that is not "no headlines", and offers Retry', () => {
    for (const err of [{ status: 500 }, { status: 503 }, { status: 429 }, new TypeError('network'), null]) {
      expect(stockWireFailure('zzqa', err)).toEqual({
        sym: 'ZZQA', phase: 'failed', title: 'UCT News could not be checked for ZZQA just now.',
        hint: 'That is not the same as no headlines about ZZQA.', retry: true,
      })
    }
    expect(stockWireFailure('ZZQA', { timedOut: true }, 30000).title).toBe('UCT News did not answer within 30 seconds.')
  })

  it('the read never rejects: an answer, a refusal, a failure and a hung request are each a state', async () => {
    const calls = []
    const ok = await readStockWire('zzqa', 4, { fetchDay: async (body) => { calls.push(body); return { items: [H(9, TODAY, 3, 'INVENTED: e')] } }, now: () => NOW })
    expect(ok).toMatchObject({ sym: 'ZZQA', phase: 'rows', today: 1, readAt: NOW })
    expect(calls).toEqual([stockWireRequest('ZZQA', 4)])
    const off = await readStockWire('ZZQA', 4, { fetchDay: async () => { throw Object.assign(new Error('x'), { status: 404 }) } })
    expect(off.phase).toBe('off')
    const down = await readStockWire('ZZQA', 4, { fetchDay: async () => { throw Object.assign(new Error('x'), { status: 500 }) } })
    expect(down.phase).toBe('failed')
    const thrown = await readStockWire('ZZQA', 4, { fetchDay: () => { throw new TypeError('no fetch here') } })
    expect(thrown.phase).toBe('failed')
    const hung = await readStockWire('ZZQA', 4, { fetchDay: () => new Promise(() => {}), deadlineMs: 20 })
    expect(hung).toMatchObject({ phase: 'failed', retry: true })
    expect(hung.title).toBe('UCT News did not answer within 0 seconds.')
  })
})

describe('the NEWS strip', () => {
  const ITEMS = [H(1, D1, 1, 'INVENTED: a', []), H(2, TODAY, 1, 'INVENTED: b', []), H(3, TODAY, 2, 'INVENTED: c', [], { placeholder: 'graphic' }),
    H(4, TODAY, 3, 'INVENTED: d', []), H(5, TODAY, 4, 'INVENTED: e', [])]
  const feed = (over) => ({ status: 'live', items: ITEMS, epoch: 'e1', reason: null, ...over })

  it('shows the newest few of the shared pool, newest first, without picture-only rows', () => {
    const v = wireStripView(feed(), 3, NOW)
    expect(v).toMatchObject({ phase: 'rows', note: null, command: true })
    expect(v.rows.map((r) => r.seq)).toEqual([5, 4, 2])
    expect(wireStripView(feed(), undefined, NOW).rows).toHaveLength(WIRE_ROWS.NEWS)
  })

  it('rows with a connection that is not live say so in the UCT News panel words', () => {
    expect(wireStripView(feed({ status: 'reconnecting' }), 3, NOW).note).toBe('Reconnecting. Headlines missed meanwhile are added in order when the stream returns.')
    expect(wireStripView(feed({ status: 'failed' }), 3, NOW).note).toBe('Not live: the news stream could not be opened in this browser.')
  })

  it('a refusal is one sentence with no Retry and no row command', () => {
    expect(wireStripView({ status: 'unavailable', reason: 'not_enabled', items: [] })).toEqual({
      phase: 'off', rows: [], title: 'The news wire is not switched on for this server.', retry: false, command: false,
    })
    expect(wireStripView({ status: 'unavailable', reason: 'signed_out', items: [] })).toMatchObject({ phase: 'off', retry: false, command: false })
    expect(wireStripView({ status: 'unavailable', reason: 'error', items: [] })).toMatchObject({
      phase: 'failed', title: 'UCT News could not be read just now.', retry: true, command: true,
    })
  })

  it('before the first answer it is loading; a failed first load could not be read, never a quiet wire', () => {
    expect(wireStripView({ status: 'idle', items: [], epoch: null })).toMatchObject({ phase: 'loading', command: true })
    expect(wireStripView({ status: 'connecting', items: [], epoch: null })).toMatchObject({ phase: 'loading' })
    expect(wireStripView({ status: 'reconnecting', reason: 'error', items: [], epoch: null })).toMatchObject({
      phase: 'failed', title: 'UCT News could not be read just now.', hint: 'That is not the same as a quiet wire. This strip keeps trying.', retry: true,
    })
    expect(wireStripView({ status: 'reconnecting', reason: 'not_started', items: [], epoch: null }).title)
      .toBe('UCT News is starting on the server, so its latest headlines cannot be shown yet.')
  })

  it('a wire that loaded and holds nothing says so', () => {
    expect(wireStripView({ status: 'live', items: [], epoch: 'e1' })).toMatchObject({ phase: 'none', title: 'UCT News holds no headline yet.', note: null })
  })
})

describe('the words every one-stock surface shows once', () => {
  it('are the UCT News panel own sentence', () => {
    expect(matchingSentence('ZZQA')).toContain('Headlines are matched to ZZQA automatically')
  })
})
