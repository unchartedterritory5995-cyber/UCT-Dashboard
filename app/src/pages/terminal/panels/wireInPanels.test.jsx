// The news wire (UCT News) inside MOVE, CN and NEWS. Rails:
//   * MOVE: "On the news wire" shows the newest headlines naming the stock (today first, an older
//     one with its date), each with its time, type and source; the last numbered row opens the
//     full history (`SYM UCN`) and is published through `onRows`; none found says how far back
//     the search reached; a failed read is "could not check" with Retry and never "none"; a
//     switched-off wire is one sentence with no Retry and no row; the read never delays MOVE;
//   * CN: the wire is its OWN labelled block above the company-news list, each row with its own
//     source label; the terminal panel only; one numbered row opens `SYM UCN`; a wire failure
//     leaves the list intact and a list failure leaves the wire intact;
//   * NEWS: "Latest on the news wire" leads the tape from the SHARED stream (one for the tab,
//     released on unmount), with a numbered row to `UNEWS`; the tape's states are unchanged;
//   * MOVE and CN make one request each and open no stream; nothing here polls or owns a
//     transport; no hard-coded colour; axe.
// The panels run against the REAL shared pool with a stand-in EventSource and stand-in routes.
// Every headline here is invented. No real ticker is used.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const hooks = vi.hoisted(() => ({ news: null }))
vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
vi.mock('../../research/hooks/useCompanyNews', () => ({ default: () => hooks.news }))
vi.mock('../../../components/provenance/AbsenceReceipt', () => ({ default: () => null }))

import jsonFetcher from '../../../utils/jsonFetcher'
import * as pool from '../../../lib/tradeExchangeNewsStreamManager'
import { fakeNewsDay } from '../../../testing/tradeExchangeNews/fakeNewsDay'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import { addDays, etDateKey, fmtStamp } from '../../charts/widgets/tradeExchangeNewsModel'
import NewsTab from '../../research/tabs/NewsTab'
import { SHARE_POLICY, shareClassOf } from '../share/shareRule'
import MovePanel, { moveRows } from './MovePanel'
import NewsPanel from './NewsPanel'
import UctNewsPanel from './UctNewsPanel'
import { matchingSentence } from './uctNewsModel'
import { WIRE_ROWS, stockWireRequest } from './wireInPanelsModel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (name) => fs.readFileSync(path.join(HERE, name), 'utf8')

class FakeES {
  static all = []
  constructor(url, opts) {
    this.url = url
    this.opts = opts
    this.readyState = 1
    this.listeners = {}
    this.closed = false
    FakeES.all.push(this)
  }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn) }
  emit(name, data) { for (const fn of this.listeners[name] || []) fn({ data: JSON.stringify(data) }) }
  close() { this.closed = true; this.readyState = 2 }
}
const lastES = () => FakeES.all[FakeES.all.length - 1]
const openStreams = () => FakeES.all.filter((es) => !es.closed)

const EPOCH = 'e1e1e1e1e1e1e1e1'
// 16:00 UTC or a little after: late morning in New York, summer or winter.
const TODAY = etDateKey(Date.now())
const D1 = addDays(TODAY, -1)
const D3 = addDays(TODAY, -3)
const at = (key, minute = 0) => Date.parse(`${key}T16:00:00Z`) + minute * 60_000
const H = (seq, key, minute, content, tickers = [], extra = {}) => ({
  type: 'headline', epoch: EPOCH, seq, id: `id${seq}`, source: 'TXNews1', content, received_at_ms: at(key, minute),
  tickers, mentions: [], category: 'News', repeat_count: 0, via: 'push', delayed: false, ...extra,
})

/** A small archive over three days. ZZQA and ZZQB are made-up tickers. */
const ARCHIVE = [
  H(1, D3, 1, 'INVENTED: $ZZQA opens a second plant', ['ZZQA']),
  H(2, D3, 2, 'INVENTED: grain stocks fall for a third week', [], { category: 'Macro' }),
  H(3, D3, 3, 'INVENTED: ZZQB names a finance chief', ['ZZQB']),
  H(4, D1, 1, 'INVENTED: central bank holds its rate', [], { category: 'Macro' }),
  H(5, D1, 2, 'INVENTED: $ZZQA raises its guidance for the year', ['ZZQA'], { category: 'Earnings' }),
  H(6, D1, 3, 'INVENTED: shipping index at a two year high', []),
  H(7, TODAY, 1, 'INVENTED: $ZZQB cuts guidance after a slow quarter', ['ZZQB'], { category: 'Earnings' }),
  H(8, TODAY, 2, 'INVENTED: payrolls print above forecasts', [], { category: 'Macro' }),
  H(9, TODAY, 3, 'INVENTED: $ZZQA wins a supply contract', ['ZZQA']),
  H(10, TODAY, 4, 'INVENTED: crude settles lower on the day', []),
]

const server = {}
const json = (status, body) => ({ ok: status === 200, status, json: async () => body, headers: new Headers() })
const fetchMock = vi.fn(async (url, opts) => {
  const u = String(url)
  if (u.startsWith(pool.RECENT_URL)) {
    server.recentCalls += 1
    if (server.recentGate) await server.recentGate
    if (server.recentStatus !== 200) return json(server.recentStatus, { reason: 'refused' })
    const items = server.archive.slice().sort((a, b) => a.seq - b.seq)
    return json(200, { epoch: EPOCH, first_seq: items[0]?.seq || 0, last_seq: items.at(-1)?.seq || 0, items,
      coverage: { complete: true, gaps: [] }, tickers_provisional: true })
  }
  if (u === pool.DAY_URL) {
    const body = JSON.parse(opts.body)
    server.dayCalls.push(body)
    if (server.dayGate) await server.dayGate
    if (server.dayStatus !== 200) return json(server.dayStatus, {})
    return json(200, server.dayAnswer ? server.dayAnswer(body) : fakeNewsDay(server.archive, body, { epoch: EPOCH, today: TODAY }))
  }
  if (u.startsWith('/api/terminal/seen/')) return json(404, {})
  if (u.startsWith('/api/trade-exchange-news')) return json(404, {})
  return json(200, {})
})
const flush = () => new Promise((r) => setTimeout(r, 0))
const settle = async () => { await act(flush); await act(flush) }

beforeEach(() => {
  FakeES.all = []
  globalThis.EventSource = FakeES
  globalThis.fetch = fetchMock
  fetchMock.mockClear()
  jsonFetcher.mockReset()
  hooks.news = null
  Object.assign(server, { archive: ARCHIVE.slice(), recentStatus: 200, recentGate: null, recentCalls: 0,
    dayStatus: 200, dayGate: null, dayAnswer: null, dayCalls: [] })
  pool._resetForTests()
})
afterEach(() => { cleanup(); pool._resetForTests() })

const streamRequests = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith(pool.RECENT_URL) || String(u).startsWith(pool.STREAM_URL))

// ─────────────────────────────────────────── MOVE ───────────────────────────────────────────

const MOVE_BODY = {
  sym: 'ZZQA', intelligence: { status: 'ok', facts: [{ kind: 'analyst', label: 'INVENTED fact', as_of: '2026-10-01' }] },
  catalysts: [], catalyst_status: 'ok', since_last_visit: { first_visit: true, new: [] },
}
function renderMove(sym = 'ZZQA') {
  const onRows = vi.fn()
  const onRun = vi.fn()
  const view = render(<MovePanel sym={sym} onRows={onRows} onRun={onRun} />)
  return { onRows, onRun, ...view }
}
const moveWire = () => screen.getByTestId('terminal-move-wire')
const lastRows = (fn) => fn.mock.calls.at(-1)[0]

describe('MOVE: on the news wire', () => {
  beforeEach(() => { jsonFetcher.mockResolvedValue(MOVE_BODY) })

  it('shows the newest headlines naming the stock, today first, each with its time, type and source', async () => {
    const { onRows } = renderMove()
    await screen.findByTestId('terminal-move-wire-list')
    expect(screen.getByText('On the news wire')).toBeTruthy()
    const rows = within(moveWire()).getAllByTestId('terminal-move-wire-row')
    expect(rows.map((r) => Number(r.getAttribute('data-seq')))).toEqual([9, 5, 1])
    expect(rows.map((r) => r.getAttribute('data-today'))).toEqual(['true', 'false', 'false'])
    expect(rows[0].firstElementChild.textContent).toBe('INVENTED: $ZZQA wins a supply contract')
    const times = within(moveWire()).getAllByTestId('terminal-move-wire-time').map((n) => n.textContent)
    expect(times[0]).toMatch(/^Today \d{1,2}:03:00 [AP]M ET$/)
    expect(times[1]).toBe(fmtStamp(at(D1, 2)))
    expect(times[2]).toBe(fmtStamp(at(D3, 1)))
    expect(within(moveWire()).getAllByTestId('terminal-move-wire-type').map((n) => n.textContent)).toEqual(['News', 'Earnings', 'News'])
    expect(within(moveWire()).getAllByTestId('terminal-move-wire-source').map((n) => n.textContent)).toEqual(['UCT News', 'UCT News', 'UCT News'])
    expect(screen.getByTestId('terminal-move-wire-lede').textContent)
      .toBe('The newest 3 headlines naming ZZQA: 1 from today, the rest earlier (each row carries its date).')
    // the request is the one-stock read `ZZQA UCN` sends, asked for a few rows, once
    expect(server.dayCalls).toEqual([stockWireRequest('ZZQA', WIRE_ROWS.MOVE)])
    // matching is said once, in the UCT News panel's words
    const said = within(moveWire()).getAllByTestId('terminal-move-wire-matching')
    expect(said).toHaveLength(1)
    expect(said[0].textContent).toBe(matchingSentence('ZZQA'))
    expect(screen.getByTestId('terminal-move-wire-method').textContent).toContain('UCT News, powered by Trade Exchange.')
    expect(screen.getByTestId('terminal-move-wire-method').textContent).toContain('This list does not update on its own; ZZQA UCN is live')
    expect(lastRows(onRows)).toEqual(['ZZQA CN', 'ZZQA CATS', 'ZZQA GP', 'ZZQA DES', 'ZZQA UCN'])
  })

  it('the full history is ONE numbered row command, the last, so the rows above keep their numbers', async () => {
    const { onRows, onRun } = renderMove()
    await screen.findByTestId('terminal-move-wire-list')
    expect(moveRows('ZZQA')).toEqual(['ZZQA CN', 'ZZQA CATS', 'ZZQA GP', 'ZZQA DES', 'ZZQA UCN'])
    expect(moveRows('ZZQA', { wire: false })).toEqual(['ZZQA CN', 'ZZQA CATS', 'ZZQA GP', 'ZZQA DES'])
    expect(lastRows(onRows).filter((c) => c.endsWith(' UCN'))).toEqual(['ZZQA UCN'])
    expect(screen.getByTestId('terminal-move-wire-more').textContent)
      .toBe('Row 5 below (ZZQA UCN) opens the full news wire history, live.')
    fireEvent.click(screen.getByTestId('terminal-move-row-5'))
    expect(onRun).toHaveBeenCalledWith('ZZQA UCN')
    fireEvent.click(screen.getByTestId('terminal-move-row-1'))
    expect(onRun).toHaveBeenLastCalledWith('ZZQA CN')
  })

  it('with nothing today it shows the most recent ones, and says they are not from today', async () => {
    server.archive = ARCHIVE.filter((it) => etDateKey(it.received_at_ms) !== TODAY)
    renderMove()
    await screen.findByTestId('terminal-move-wire-list')
    expect(screen.getByTestId('terminal-move-wire-lede').textContent)
      .toBe('No headline names ZZQA today. The most recent 2 are shown, each with its date.')
    const times = within(moveWire()).getAllByTestId('terminal-move-wire-time').map((n) => n.textContent)
    expect(times).toEqual([fmtStamp(at(D1, 2)), fmtStamp(at(D3, 1))])
    expect(times.every((t) => !t.startsWith('Today'))).toBe(true)
  })

  it('shows a few rows only, however many the wire holds', async () => {
    server.archive = Array.from({ length: 9 }, (_, i) => H(20 + i, TODAY, i, `INVENTED: ZZQA item ${i}`, ['ZZQA']))
    renderMove()
    await screen.findByTestId('terminal-move-wire-list')
    expect(within(moveWire()).getAllByTestId('terminal-move-wire-row')).toHaveLength(WIRE_ROWS.MOVE)
    expect(screen.getByTestId('terminal-move-wire-lede').textContent).toBe('The newest 4 headlines naming ZZQA, from today.')
    expect(server.dayCalls[0].limit).toBe(4)
  })

  it('none found says how far back the search reached', async () => {
    server.dayAnswer = () => ({ history: true, items: [], has_older: false, reached_start: true, searched_to: D3 })
    const { onRows } = renderMove('ZZQC')
    const none = await screen.findByTestId('terminal-move-wire-none')
    expect(none.textContent).toContain('No archived headline names ZZQC.')
    expect(none.textContent).toContain('Searched every day UCT News has kept, back to the start of its archive.')
    expect(screen.queryByTestId('terminal-move-wire-list')).toBeNull()
    expect(screen.getByTestId('terminal-move-wire-matching').textContent).toBe(matchingSentence('ZZQC'))
    // the full history is still one row away: a new headline shows there the moment it arrives
    expect(lastRows(onRows)).toContain('ZZQC UCN')
  })

  it('a search with further to go says so, and never claims the whole archive', async () => {
    server.dayAnswer = () => ({ history: true, items: [], has_older: true, reached_start: false, searched_to: D3 })
    renderMove('ZZQC')
    const none = await screen.findByTestId('terminal-move-wire-none')
    expect(none.textContent).toContain('Earlier days have not been searched yet.')
    expect(none.textContent).toContain('ZZQC UCN can search the earlier days.')
    expect(none.textContent).not.toContain('back to the start of its archive')
  })

  it('a failed read is "could not check" with Retry, never "none", and the rest of MOVE is intact', async () => {
    server.dayStatus = 500
    const { onRows } = renderMove()
    const failed = await screen.findByTestId('terminal-move-wire-failed')
    expect(failed.getAttribute('data-kind')).toBe('error')
    expect(failed.textContent).toContain('UCT News could not be checked for ZZQA just now.')
    expect(failed.textContent).toContain('That is not the same as no headlines about ZZQA.')
    expect(screen.queryByTestId('terminal-move-wire-none')).toBeNull()
    expect(screen.queryByTestId('terminal-move-wire-list')).toBeNull()
    // MOVE itself is whole
    expect(screen.getByTestId('terminal-move')).toBeTruthy()
    expect(within(screen.getByTestId('terminal-move-facts')).getByRole('listitem').textContent).toContain('INVENTED fact')
    expect(screen.queryByTestId('terminal-move-error')).toBeNull()
    expect(lastRows(onRows)).toEqual(moveRows('ZZQA'))
    // Retry reads again, once
    server.dayStatus = 200
    fireEvent.click(within(failed).getByRole('button', { name: 'Retry UCT News for ZZQA' }))
    await screen.findByTestId('terminal-move-wire-list')
    expect(server.dayCalls).toHaveLength(2)
    expect(jsonFetcher).toHaveBeenCalledTimes(1)
  })

  it('a switched-off wire is one sentence: no Retry, no row command, nothing else changed', async () => {
    server.dayStatus = 404
    const { onRows } = renderMove()
    const off = await screen.findByTestId('terminal-move-wire-off')
    expect(off.textContent).toBe('The news wire is not switched on for this server.')
    expect(off.getAttribute('data-kind')).toBe('locked')
    expect(within(moveWire()).queryByRole('button')).toBeNull()
    expect(screen.queryByTestId('terminal-move-wire-more')).toBeNull()
    await waitFor(() => expect(lastRows(onRows)).toEqual(['ZZQA CN', 'ZZQA CATS', 'ZZQA GP', 'ZZQA DES']))
    expect(screen.queryByTestId('terminal-move-row-5')).toBeNull()
    expect(screen.getByTestId('terminal-move-row-4').textContent).toContain('ZZQA DES')
    expect(screen.getByTestId('terminal-move-facts')).toBeTruthy()
    await settle()
    expect(server.dayCalls).toHaveLength(1)        // it does not ask again
  })

  it('never delays MOVE: the panel is drawn while the wire is still being read', async () => {
    let release
    server.dayGate = new Promise((r) => { release = r })
    renderMove()
    await screen.findByTestId('terminal-move-facts')
    expect(screen.getByTestId('terminal-move-wire-loading').textContent).toBe('Checking UCT News for ZZQA.')
    expect(screen.getByTestId('terminal-move-row-5').textContent).toContain('ZZQA UCN')
    release()
    await screen.findByTestId('terminal-move-wire-list')
    expect(screen.queryByTestId('terminal-move-wire-loading')).toBeNull()
  })

  it("the wire does not open MOVE's own gate: a MOVE that is not switched on shows no wire section", async () => {
    jsonFetcher.mockReset()
    jsonFetcher.mockRejectedValue(Object.assign(new Error('x'), { status: 404 }))
    renderMove()
    expect((await screen.findByTestId('terminal-move-error')).textContent).toContain("isn't switched on yet")
    await settle()
    expect(screen.queryByTestId('terminal-move-wire')).toBeNull()
    expect(screen.queryByText('On the news wire')).toBeNull()
  })

  it('a stock change never shows the earlier stock headlines', async () => {
    const view = renderMove()
    await screen.findByTestId('terminal-move-wire-list')
    let release
    server.dayGate = new Promise((r) => { release = r })
    jsonFetcher.mockResolvedValue({ ...MOVE_BODY, sym: 'ZZQB' })
    view.rerender(<MovePanel sym="ZZQB" onRows={view.onRows} onRun={view.onRun} />)
    await screen.findByTestId('terminal-move-wire-loading')
    expect(screen.queryByTestId('terminal-move-wire-row')).toBeNull()
    release()
    await screen.findByTestId('terminal-move-wire-list')
    expect(within(moveWire()).getAllByTestId('terminal-move-wire-row').map((r) => Number(r.getAttribute('data-seq')))).toEqual([7, 3])
    expect(server.dayCalls.map((b) => b.symbol)).toEqual(['ZZQA', 'ZZQB'])
  })

  it('opens no stream and no history load of its own: one request, nothing else', async () => {
    renderMove()
    await screen.findByTestId('terminal-move-wire-list')
    await settle()
    expect(FakeES.all).toHaveLength(0)
    expect(streamRequests()).toEqual([])
    expect(server.dayCalls).toHaveLength(1)
    expect(pool.getSnapshot().status).toBe('idle')
  })

  it('has no accessibility violations, with rows and with a failed read', async () => {
    const a = renderMove()
    await screen.findByTestId('terminal-move-wire-list')
    await expectNoAxeViolations(a.container)
    cleanup()
    server.dayStatus = 500
    const b = renderMove()
    await screen.findByTestId('terminal-move-wire-failed')
    await expectNoAxeViolations(b.container)
  })
})

// ──────────────────────────────────────────── CN ────────────────────────────────────────────

const STORY = { id: 's1', kind: 'news', headline: 'INVENTED company story', publisher: 'Invented Publisher', url: 'https://x.example/1', published_at: '2026-10-07 10:00:00' }
const newsOk = () => ({ data: { sym: 'ZZQA', items: [STORY] }, isLoading: false, error: false, paywalled: false, mutate: vi.fn() })

function mountCn(el, { inPanel = true } = {}) {
  const api = { publishRows: vi.fn(), publish: vi.fn(), open: vi.fn(), openBoard: vi.fn(), codes: [], pageSize: 4, run: vi.fn(), rerun: vi.fn() }
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      {inPanel
        ? <PanelListContext.Provider value={api}><TerminalPanelContext.Provider value={{ code: 'CN', density: 'comfortable', inset: true }}>{el}</TerminalPanelContext.Provider></PanelListContext.Provider>
        : el}
    </SWRConfig>,
  )
  return { api, ...view }
}
const before = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('CN: the news wire block', () => {
  beforeEach(() => { hooks.news = newsOk() })

  it('is its own labelled block above the company-news list, and each row keeps its source label', async () => {
    mountCn(<NewsTab sym="ZZQA" />)
    const block = await screen.findByTestId('news-wire')
    await screen.findByTestId('news-wire-body-list')
    expect(screen.getByTestId('news-wire-title').textContent).toBe('News wire')
    expect(screen.getByText('Company news')).toBeTruthy()
    const list = screen.getByTestId('news-list')
    expect(before(block, list)).toBe(true)
    // two lists, never one: no wire row inside the company list, no company row inside the wire block
    expect(within(list).queryByTestId('news-wire-body-row')).toBeNull()
    expect(within(block).queryByText('INVENTED company story')).toBeNull()
    const rows = within(block).getAllByTestId('news-wire-body-row')
    expect(rows.map((r) => Number(r.getAttribute('data-seq')))).toEqual([9, 5, 1])
    expect(within(block).getAllByTestId('news-wire-body-source').map((n) => n.textContent)).toEqual(['UCT News', 'UCT News', 'UCT News'])
    expect(within(list).getByText('Invented Publisher')).toBeTruthy()
    expect(within(list).queryByText('UCT News')).toBeNull()
    expect(server.dayCalls).toEqual([stockWireRequest('ZZQA', WIRE_ROWS.CN)])
    const said = within(block).getAllByTestId('news-wire-body-matching')
    expect(said).toHaveLength(1)
    expect(said[0].textContent).toBe(matchingSentence('ZZQA'))
  })

  it('one numbered row opens the full history beside CN, by number or by click', async () => {
    const { api } = mountCn(<NewsTab sym="ZZQA" />)
    await screen.findByTestId('news-wire-body-list')
    expect(lastRows(api.publishRows)).toEqual(['ZZQA UCN'])
    const more = screen.getByTestId('news-wire-more')
    expect(more.textContent).toBe('1ZZQA UCNthe full news wire history for ZZQA, live')
    fireEvent.click(within(more).getByTestId('panel-command-ZZQA-UCN'))
    expect(api.open).toHaveBeenCalledWith('ZZQA UCN')
  })

  it('a ticker in a wire headline loads that stock, in the headline own words', async () => {
    const { api } = mountCn(<NewsTab sym="ZZQA" />)
    const block = await screen.findByTestId('news-wire')
    await screen.findByTestId('news-wire-body-list')
    fireEvent.click(within(block).getAllByTestId('panel-symbol-ZZQA')[0])
    expect(api.run).toHaveBeenCalledWith('$ZZQA')
  })

  it('the research page (no panel), MINE and a paywalled CN show no wire block and make no request', async () => {
    mountCn(<NewsTab sym="ZZQA" />, { inPanel: false })
    await screen.findByText('INVENTED company story')
    await settle()
    expect(screen.queryByTestId('news-wire')).toBeNull()
    cleanup()
    hooks.news = { data: null, isLoading: false, error: false, paywalled: true, mutate: vi.fn() }
    mountCn(<NewsTab sym="ZZQA" />)
    await screen.findByTestId('news-paywalled')
    await settle()
    expect(screen.queryByTestId('news-wire')).toBeNull()
    cleanup()
    hooks.news = newsOk()
    mountCn(<NewsTab sym="ZZQA" mine />)
    await settle()
    expect(screen.queryByTestId('news-wire')).toBeNull()
    expect(server.dayCalls).toEqual([])
    expect(FakeES.all).toHaveLength(0)
  })

  it('a wire failure leaves the company list intact, and is never "none"', async () => {
    server.dayStatus = 503
    const { api } = mountCn(<NewsTab sym="ZZQA" />)
    const failed = await screen.findByTestId('news-wire-body-failed')
    expect(failed.textContent).toContain('UCT News could not be checked for ZZQA just now.')
    expect(failed.textContent).toContain('That is not the same as no headlines about ZZQA.')
    expect(screen.queryByTestId('news-wire-body-none')).toBeNull()
    expect(within(screen.getByTestId('news-list')).getByText('INVENTED company story')).toBeTruthy()
    expect(lastRows(api.publishRows)).toEqual(['ZZQA UCN'])
    server.dayStatus = 200
    fireEvent.click(within(failed).getByRole('button', { name: 'Retry UCT News for ZZQA' }))
    await screen.findByTestId('news-wire-body-list')
    expect(server.dayCalls).toHaveLength(2)
  })

  it('a failed company-news read does not hide the wire, and keeps its own Retry', async () => {
    const mutate = vi.fn()
    hooks.news = { data: null, isLoading: false, error: true, paywalled: false, mutate }
    mountCn(<NewsTab sym="ZZQA" />)
    const err = await screen.findByTestId('news-error')
    await screen.findByTestId('news-wire-body-list')
    expect(before(screen.getByTestId('news-wire'), err)).toBe(true)
    expect(err.textContent).toContain("Couldn't load news for this ticker.")
    expect(screen.getAllByRole('button', { name: /^Retry/ })).toHaveLength(1)
    fireEvent.click(within(err).getByRole('button', { name: 'Retry' }))
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(server.dayCalls).toHaveLength(1)
  })

  it('a switched-off wire is one sentence, with no row command and no Retry', async () => {
    server.dayStatus = 404
    const { api } = mountCn(<NewsTab sym="ZZQA" />)
    const off = await screen.findByTestId('news-wire-body-off')
    expect(off.textContent).toBe('The news wire is not switched on for this server.')
    expect(within(screen.getByTestId('news-wire')).queryByRole('button')).toBeNull()
    expect(screen.queryByTestId('news-wire-more')).toBeNull()
    await waitFor(() => expect(lastRows(api.publishRows)).toEqual([]))
    expect(within(screen.getByTestId('news-list')).getByText('INVENTED company story')).toBeTruthy()
  })

  it('none found says how far back the search reached', async () => {
    server.dayAnswer = () => ({ history: true, items: [], has_older: false, reached_start: true, searched_to: D3 })
    mountCn(<NewsTab sym="ZZQC" />)
    const none = await screen.findByTestId('news-wire-body-none')
    expect(none.textContent).toContain('No archived headline names ZZQC.')
    expect(none.textContent).toContain('Searched every day UCT News has kept, back to the start of its archive.')
    expect(screen.getByTestId('news-wire-more')).toBeTruthy()
  })

  it('opens no stream: one request and nothing else', async () => {
    mountCn(<NewsTab sym="ZZQA" />)
    await screen.findByTestId('news-wire-body-list')
    await settle()
    expect(FakeES.all).toHaveLength(0)
    expect(streamRequests()).toEqual([])
    expect(server.dayCalls).toHaveLength(1)
  })

  it('has no accessibility violations', async () => {
    const { container } = mountCn(<NewsTab sym="ZZQA" />)
    await screen.findByTestId('news-wire-body-list')
    await expectNoAxeViolations(container)
  })
})

// ─────────────────────────────────────────── NEWS ───────────────────────────────────────────

const TAPE = [
  { headline: 'INVENTED tape story one', source: 'Invented Source', url: 'https://x.example/t1', time: '2026-10-09 08:15:00', category: 'MACRO', tickers: [] },
  { headline: 'INVENTED tape story two', source: 'Invented Source', url: 'https://x.example/t2', time: '2026-10-09 09:40:00', category: 'EARN', tickers: ['ZZQB'] },
]
function renderNews(extra = null) {
  const api = { open: vi.fn(), run: vi.fn(), rerun: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PanelFreshnessContext.Provider value={vi.fn()}>
        <PanelListContext.Provider value={api}>
          <NewsPanel />
          {extra}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { api, ...view }
}
const strip = () => screen.getByTestId('terminal-news-wire')
const stripSeqs = () => within(strip()).queryAllByTestId('terminal-news-wire-row').map((r) => Number(r.getAttribute('data-seq')))

describe('NEWS: latest on the news wire', () => {
  beforeEach(() => { jsonFetcher.mockResolvedValue(TAPE) })

  it('leads the tape with the newest few headlines from the shared stream', async () => {
    const { api } = renderNews()
    await screen.findByTestId('terminal-news-wire-list')
    const tape = await screen.findByTestId('terminal-news-list')
    expect(within(strip()).getByText('Latest on the news wire')).toBeTruthy()
    expect(before(strip(), tape)).toBe(true)
    expect(stripSeqs()).toEqual([10, 9, 8])
    const first = within(strip()).getAllByTestId('terminal-news-wire-row')[0]
    expect(first.firstElementChild.textContent).toBe('INVENTED: crude settles lower on the day')
    expect(first.textContent).toMatch(/Today \d{1,2}:04:00 [AP]M ET/)
    expect(first.textContent).toContain('UCT News')
    expect(screen.getByTestId('terminal-news-wire-method').textContent).toContain('UCT News, powered by Trade Exchange.')
    // the tape itself is unchanged: its own rows, its own source line
    expect(within(tape).getAllByTestId('terminal-news-row')).toHaveLength(2)
    expect(within(tape).queryByTestId('terminal-news-wire-row')).toBeNull()
    expect(screen.getByTestId('terminal-news-method')).toBeTruthy()
    // one numbered row opens the whole wire
    expect(lastRows(api.publishRows)).toEqual(['UNEWS'])
    fireEvent.click(within(strip()).getByTestId('panel-command-UNEWS'))
    expect(api.open).toHaveBeenCalledWith('UNEWS')
  })

  it('strip headlines are the provider text: a ticker in one is not a button there', async () => {
    renderNews()
    await screen.findByTestId('terminal-news-wire-list')
    expect(stripSeqs()).toContain(9)
    expect(within(strip()).queryByTestId('panel-symbol-ZZQA')).toBeNull()
    expect(within(strip()).getAllByRole('button').map((b) => b.textContent)).toEqual(['UNEWS'])
  })

  it('a live headline arrives at the top of the strip', async () => {
    renderNews()
    await screen.findByTestId('terminal-news-wire-list')
    act(() => { lastES().emit('hello', { type: 'hello', epoch: EPOCH, seq: 10 }) })
    expect(screen.queryByTestId('terminal-news-wire-status')).toBeNull()
    act(() => { lastES().emit('headline', H(11, TODAY, 6, 'INVENTED: rail volumes rise for a second month')) })
    expect(stripSeqs()).toEqual([11, 10, 9])
  })

  it('uses the ONE stream the tab already has, and releases it when the last reader closes', async () => {
    const view = renderNews(<UctNewsPanel />)
    await screen.findByTestId('terminal-news-wire-list')
    await screen.findByTestId('terminal-unews-list')
    await settle()
    expect(FakeES.all).toHaveLength(1)
    expect(openStreams()).toHaveLength(1)
    expect(server.recentCalls).toBe(1)
    view.unmount()
    expect(openStreams()).toHaveLength(0)
    expect(pool.getSnapshot().status).toBe('idle')
  })

  it('alone it opens one stream, and closing the panel closes it', async () => {
    const view = renderNews()
    await screen.findByTestId('terminal-news-wire-list')
    expect(FakeES.all).toHaveLength(1)
    view.unmount()
    expect(openStreams()).toHaveLength(0)
  })

  it('a connection that is not live is said under the rows', async () => {
    renderNews()
    await screen.findByTestId('terminal-news-wire-list')
    act(() => { lastES().emit('hello', { type: 'hello', epoch: EPOCH, seq: 10 }) })
    expect(screen.queryByTestId('terminal-news-wire-status')).toBeNull()        // live: nothing to say
    act(() => { lastES().onerror() })
    expect((await screen.findByTestId('terminal-news-wire-status')).textContent).toMatch(/^Reconnecting\./)
    expect(stripSeqs()).toEqual([10, 9, 8])
  })

  it('a switched-off wire is one sentence, with no row command, and the tape is intact', async () => {
    server.recentStatus = 404
    const { api } = renderNews()
    const off = await screen.findByTestId('terminal-news-wire-off')
    expect(off.textContent).toBe('The news wire is not switched on for this server.')
    expect(within(strip()).queryByRole('button')).toBeNull()
    expect(screen.queryByTestId('terminal-news-wire-more')).toBeNull()
    await waitFor(() => expect(lastRows(api.publishRows)).toEqual([]))
    expect(within(await screen.findByTestId('terminal-news-list')).getAllByTestId('terminal-news-row')).toHaveLength(2)
    await settle()
    expect(server.recentCalls).toBe(1)
    expect(FakeES.all).toHaveLength(0)
  })

  it('a wire that cannot be read is "could not be read" with Retry, never a quiet wire; the tape is intact', async () => {
    server.recentStatus = 500
    renderNews()
    const failed = await screen.findByTestId('terminal-news-wire-failed')
    expect(failed.textContent).toContain('UCT News could not be read just now.')
    expect(failed.textContent).toContain('That is not the same as a quiet wire.')
    expect(screen.queryByTestId('terminal-news-wire-none')).toBeNull()
    expect(within(await screen.findByTestId('terminal-news-list')).getAllByTestId('terminal-news-row')).toHaveLength(2)
    expect(screen.getByTestId('terminal-news-wire-more')).toBeTruthy()
    expect(server.recentCalls).toBe(1)
    server.recentStatus = 200
    fireEvent.click(within(failed).getByRole('button', { name: 'Retry UCT News' }))
    expect(server.recentCalls).toBe(2)              // Retry reads now, not at the next scheduled try
    await screen.findByTestId('terminal-news-wire-list')
    expect(stripSeqs()).toEqual([10, 9, 8])
  })

  it('a failed tape and a failed wire are two Retry buttons with two names', async () => {
    server.recentStatus = 500
    jsonFetcher.mockReset()
    jsonFetcher.mockRejectedValue(Object.assign(new Error('x'), { status: 500 }))
    renderNews()
    await screen.findByTestId('terminal-news-error')
    await screen.findByTestId('terminal-news-wire-failed')
    expect(screen.getAllByRole('button', { name: /Retry/ }).map((b) => b.getAttribute('aria-label') || b.textContent))
      .toEqual(['Retry UCT News', 'Retry'])
  })

  it('a tape the plan does not include shows no strip, and the strip gives the stream back', async () => {
    jsonFetcher.mockReset()
    jsonFetcher.mockRejectedValue(Object.assign(new Error('p'), { status: 402 }))
    renderNews()
    expect((await screen.findByTestId('terminal-news-error')).textContent).toContain('paid plan')
    await settle()
    expect(screen.queryByTestId('terminal-news-wire')).toBeNull()
    expect(screen.queryByText('Latest on the news wire')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(openStreams()).toHaveLength(0)
    expect(pool.getSnapshot().status).toBe('idle')
  })

  it('a wire that loaded and holds nothing says so, and is not an error', async () => {
    server.archive = []
    renderNews()
    const none = await screen.findByTestId('terminal-news-wire-none')
    expect(none.textContent).toContain('UCT News holds no headline yet.')
    expect(screen.queryByTestId('terminal-news-wire-failed')).toBeNull()
  })

  it('while the wire is being read the strip says so and the tape is already drawn', async () => {
    let release
    server.recentGate = new Promise((r) => { release = r })
    renderNews()
    await screen.findByTestId('terminal-news-list')
    expect(screen.getByTestId('terminal-news-wire-loading').textContent).toBe('Reading UCT News.')
    release()
    await screen.findByTestId('terminal-news-wire-list')
  })

  it("the tape's own states are unchanged, and the strip stays above each of them", async () => {
    jsonFetcher.mockReset()
    jsonFetcher.mockRejectedValue(Object.assign(new Error('x'), { status: 500 }))
    renderNews()
    const err = await screen.findByTestId('terminal-news-error')
    await screen.findByTestId('terminal-news-wire-list')
    expect(before(strip(), err)).toBe(true)
    expect(err.textContent).toContain('That is not the same as a quiet tape.')
    cleanup(); pool._resetForTests()
    jsonFetcher.mockReset()
    jsonFetcher.mockResolvedValue([])
    renderNews()
    const empty = await screen.findByTestId('terminal-news-empty')
    await screen.findByTestId('terminal-news-wire-list')
    expect(before(strip(), empty)).toBe(true)
    cleanup(); pool._resetForTests()
    jsonFetcher.mockReset()
    jsonFetcher.mockResolvedValue([{ headline: 'News unavailable', error: 'keys unset', tickers: [] }])
    renderNews()
    expect(await screen.findByTestId('terminal-news-unavailable')).toBeTruthy()
    expect(await screen.findByTestId('terminal-news-wire-list')).toBeTruthy()
  })

  it('has no accessibility violations', async () => {
    const { container } = renderNews()
    await screen.findByTestId('terminal-news-wire-list')
    await screen.findByTestId('terminal-news-list')
    await expectNoAxeViolations(container)
  })
})

// ───────────────────────────────────── the files themselves ─────────────────────────────────

const NEW_FILES = ['wireInPanelsModel.js', 'useStockWire.js', 'StockWire.jsx', 'CompanyNewsWire.jsx', 'WireStrip.jsx', 'wireInPanels.module.css']
const code = (name) => read(name).split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

describe('what the new files may and may not do', () => {
  it('none owns a transport or a polling loop, and none reads a route by hand', () => {
    for (const name of NEW_FILES.filter((n) => !n.endsWith('.css'))) {
      const text = code(name)
      expect(text, name).not.toMatch(/new\s+EventSource|new\s+WebSocket|setInterval|requestAnimationFrame|\bfetch\(/)
      expect(text, name).not.toMatch(/['"`]\/api\//)
    }
    // the one-stock read is the shared client's own; the strip reads the pool through a declared need
    expect(code('useStockWire.js')).toMatch(/fetchDay as poolFetchDay/)
    expect(code('useStockWire.js')).not.toMatch(/subscribe|declareNeed/)
    expect(code('WireStrip.jsx')).toMatch(/declareNeed\(\{ kind: 'trade-exchange-news', delivery: DELIVERY\.EVERY_MESSAGE_MATTERS \}\)/)
    expect(code('StockWire.jsx')).not.toMatch(/declareNeed|subscribe|fetchDay/)
    expect(code('CompanyNewsWire.jsx')).not.toMatch(/declareNeed|subscribe|fetchDay/)
  })

  it('no hard-coded colour and nothing that animates', () => {
    for (const name of NEW_FILES) {
      expect(colourLiteralsIn(name, read(name)), name).toEqual([])
      expect(read(name), name).not.toMatch(/animation|@keyframes|transition/)
    }
  })

  it('the stylesheet sets no fixed width, wraps long words, and gives Retry a touch target', () => {
    const css = read('wireInPanels.module.css')
    expect(css).not.toMatch(/(?:^|[\s;{])(?:min-)?width:\s*\d+px/m)
    expect(css).not.toMatch(/overflow-x|white-space:\s*nowrap[^}]*\}\s*\.text/)
    expect(css).toMatch(/\.text\s*\{[^}]*overflow-wrap:\s*break-word/)
    expect(css).toMatch(/@media \(max-width: 1024px\)\s*\{\s*\.retry\s*\{[^}]*min-height:\s*var\(--tap-min\)/)
  })

  it('the wire is not shared: MOVE, CN and NEWS stay in the class that is never shared', () => {
    expect(['MOVE', 'CN', 'NEWS'].map((c) => shareClassOf(c))).toEqual(['vendor', 'vendor', 'vendor'])
    expect(SHARE_POLICY.vendor).toMatchObject({ image: false, file: false })
    expect(['UNEWS', 'UCN'].map((c) => SHARE_POLICY[shareClassOf(c)].image)).toEqual([false, false])
  })
})
