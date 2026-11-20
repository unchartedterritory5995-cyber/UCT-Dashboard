// UNEWS: UCT News, the live news wire, as a Terminal panel. Rails:
//   * the panel runs against the REAL shared pool (lib/tradeExchangeNewsStreamManager.js) with a
//     stand-in EventSource and stand-in routes, so "one stream for the whole tab" and "unmount
//     releases it" are measured on the pool itself, never on a mock of it;
//   * loading, a switched-off wire (one sentence, no Retry, no further request), signed out, a
//     stream that cannot open (the archive still shows, with Retry) and a failed day read (error
//     with Retry) are each their own state; none of them is an empty list;
//   * live headlines arrive at the top with their receipt time; scrolled down, they are held
//     behind "Show N new headlines" and the rows on screen do not change until asked;
//   * the type chips and the text filter are sent to the server and narrow the list;
//   * stepping to an earlier day, back, and loading earlier headlines of a long day;
//   * `NVDA UNEWS`: the all-history read for one stock, its "how far back" sentence in words, the
//     sentence that matching is automatic, and "Search earlier days";
//   * a ticker in a headline loads that stock (`$SYM`), keeping the headline's own words;
//   * the header source line, no polling loop or transport of the panel's own, phone layout,
//     no hard-coded color, axe.
// Every headline here is invented. No real ticker is used.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as pool from '../../../lib/tradeExchangeNewsStreamManager'
import { fakeNewsDay, fakeNewsDays } from '../../../testing/tradeExchangeNews/fakeNewsDay'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import { addDays, dayLabel, etDateKey, fmtStamp } from '../../charts/widgets/tradeExchangeNewsModel'
import { BY_CODE, FUNCTIONS, exampleFor, variantFor } from '../functions'
import { TICKER_INSTEAD, marketWideNote } from '../grammar'
import { resolvePanel } from '../TerminalShell'
import { PANEL_IMPORTERS } from '../panels'
import UctNewsPanel, { UCT_NEWS_CODE, UCT_NEWS_SOURCE, scrollParentOf } from './UctNewsPanel'
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
// Every instant is 16:00 UTC or a little after: late morning in New York, summer or winter, so
// each row sits inside one New York date whatever day the suite runs.
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
const json = (status, body) => ({ ok: status === 200, status, json: async () => body })
const fetchMock = vi.fn(async (url, opts) => {
  const u = String(url)
  if (u.startsWith(pool.RECENT_URL)) {
    if (server.recentGate) await server.recentGate
    if (server.recentStatus !== 200) return json(server.recentStatus, { reason: 'refused' })
    const items = server.archive.slice().sort((a, b) => a.seq - b.seq)
    return json(200, { epoch: EPOCH, first_seq: items[0]?.seq || 0, last_seq: items.at(-1)?.seq || 0, items,
      coverage: server.coverage, tickers_provisional: true })
  }
  if (u === pool.DAY_URL) {
    const body = JSON.parse(opts.body)
    server.dayCalls.push(body)
    if (server.dayGate) await server.dayGate
    if (server.dayStatus !== 200) return json(server.dayStatus, {})
    return json(200, fakeNewsDay(server.archive, body, { epoch: EPOCH, today: TODAY }))
  }
  if (u === pool.DAYS_URL) {
    server.daysCalls += 1
    return json(200, fakeNewsDays(server.archive.length ? server.archive : [H(0, TODAY, 0, 'x')], { today: TODAY, firstDayPartial: server.firstDayPartial }))
  }
  return json(404, {})
})
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  FakeES.all = []
  globalThis.EventSource = FakeES
  globalThis.fetch = fetchMock
  fetchMock.mockClear()
  Object.assign(server, { archive: ARCHIVE.slice(), recentStatus: 200, recentGate: null, dayStatus: 200, dayGate: null,
    dayCalls: [], daysCalls: 0, coverage: { complete: true, gaps: [] }, firstDayPartial: false })
  pool._resetForTests()
})
afterEach(() => { cleanup(); pool._resetForTests() })

function renderPanel(props = {}, { run = vi.fn(), setFreshness = vi.fn(), code = null, scroll = true } = {}) {
  const body = <UctNewsPanel {...props} />
  const framed = code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider> : body
  const view = render(
    <PanelFreshnessContext.Provider value={setFreshness}>
      <PanelListContext.Provider value={{ open: vi.fn(), run, rerun: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
        {/* the shell's panel body is the element that scrolls */}
        {scroll ? <div data-testid="scroller" style={{ overflowY: 'auto', height: 200 }}>{framed}</div> : framed}
      </PanelListContext.Provider>
    </PanelFreshnessContext.Provider>,
  )
  return { run, setFreshness, ...view }
}
const rows = () => screen.queryAllByTestId('terminal-unews-row')
const seqs = () => rows().map((r) => Number(r.getAttribute('data-seq')))
const texts = () => rows().map((r) => r.firstElementChild.textContent)
const loaded = async () => { await screen.findByTestId('terminal-unews-list'); await act(flush) }
/** The stream says hello (the pool reads "live"), then sends headlines in order. */
const goLive = (...items) => act(() => {
  lastES().emit('hello', { epoch: EPOCH, reset: false, coverage: { complete: true, gaps: [] } })
  for (const it of items) lastES().emit('headline', it)
})
const scrollTo = (px) => {
  const el = screen.getByTestId('scroller')
  el.scrollTop = px
  fireEvent.scroll(el)
}
const lastDay = () => server.dayCalls.at(-1)
const reports = (setFreshness) => setFreshness.mock.calls.map(([r]) => r).filter(Boolean)

describe('UNEWS (the whole wire) and UCN (one stock) are two codes over this one panel', () => {
  it('both codes are free, UNEWS sits in Market and UCN in Security, and both render this panel', async () => {
    expect(UCT_NEWS_CODE).toBe('UNEWS')
    const wire = BY_CODE.UNEWS
    expect(wire.group).toBe('Market')
    expect(wire.market).toEqual({ panel: 'UctNews' })
    const stock = BY_CODE.UCN
    expect(stock.group).toBe('Security')
    expect(stock.ticker).toEqual({ panel: 'UctNews' })
    expect(FUNCTIONS.filter((f) => f.code === 'UNEWS')).toHaveLength(1)
    expect(FUNCTIONS.filter((f) => f.code === 'UCN')).toHaveLength(1)
    const mod = await PANEL_IMPORTERS.UctNews()
    expect(mod.default).toBe(UctNewsPanel)
    // a code must never be a real ticker
    const universe = JSON.parse(fs.readFileSync(path.resolve(HERE, '../../../../../api/data/cap_universe.json'), 'utf8'))
    const tickers = new Set((Array.isArray(universe) ? universe : universe.tickers || Object.keys(universe)).map((t) => String(t?.ticker || t).toUpperCase()))
    expect(tickers.size).toBeGreaterThan(1000)
    expect(tickers.has('UNEWS')).toBe(false)
    expect(tickers.has('UCN')).toBe(false)
  })

  // Seen on a real screen (2026-11-19): a board always has a linked security, and a code with a
  // security variant follows it. One dual code opened `UNEWS` as "SPY UNEWS", so the whole wire
  // (the main use) could not be reached by typing its own code.
  it('a bare UNEWS is the whole wire even when the board has a security loaded', () => {
    expect(BY_CODE.UNEWS.ticker).toBeUndefined()
    expect(BY_CODE.UCN.market).toBeUndefined()
    const syms = { A: 'SPY' }
    const wire = resolvePanel({ code: 'UNEWS', group: 'A', args: [] }, syms, {})
    expect(wire).toMatchObject({ state: 'ready', name: 'UctNews', sym: null })
    const stock = resolvePanel({ code: 'UCN', group: 'A', args: [] }, syms, {})
    expect(stock).toMatchObject({ state: 'ready', name: 'UctNews', sym: 'SPY' })
    expect(resolvePanel({ code: 'UCN', group: 'N', args: [] }, syms, {}).state).toBe('needs-ticker')
    expect(variantFor('UNEWS', false)).toMatchObject({ scope: 'market' })
    expect(variantFor('UCN', true)).toMatchObject({ scope: 'ticker' })
    expect(variantFor('UCN', false)).toMatchObject({ variant: null, reason: 'needs-ticker' })
  })

  it('NVDA UNEWS says the wire is market-wide and names the code that shows the stock', () => {
    expect(variantFor('UNEWS', true)).toMatchObject({ scope: 'market', ignoredTicker: true })
    expect(TICKER_INSTEAD.UNEWS).toBe('UCN')
    const said = marketWideNote('UNEWS', 'NVDA')
    expect(said).toBe('UNEWS is market-wide; NVDA is ignored. NVDA UCN opens news wire history for one stock.')
    // short enough that a panel header and the function rail show them whole
    expect(BY_CODE.UNEWS.label).toBe('UCT News (live news wire)')
    expect(BY_CODE.UCN.label.length).toBeLessThanOrEqual(32)
    expect(exampleFor(BY_CODE.UCN)).toBe('NVDA UCN')
    expect(exampleFor(BY_CODE.UNEWS)).toBe('UNEWS')
  })

  it('NEWS, CN and MOVE are left as they were', () => {
    expect(BY_CODE.NEWS.market).toEqual({ panel: 'MarketNews' })
    expect(BY_CODE.CN.ticker).toMatchObject({ panel: 'News' })
    expect(BY_CODE.MOVE.ticker).toMatchObject({ panel: 'Move' })
  })
})

describe('UNEWS states', () => {
  it('shows a loading skeleton until the feed answers', async () => {
    server.recentGate = new Promise(() => {})
    server.dayGate = new Promise(() => {})
    renderPanel()
    expect(screen.getByTestId('terminal-unews-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-unews-list')).toBeNull()
    expect(screen.queryByTestId('terminal-unews-empty')).toBeNull()
    expect(screen.getByTestId('terminal-unews-status').textContent).toBe('Connecting to the news stream.')
  })

  it('a switched-off wire is one plain sentence: no list, no Retry, no stream, and nothing asked again', async () => {
    server.recentStatus = 404
    const { setFreshness } = renderPanel()
    const off = await screen.findByTestId('terminal-unews-off')
    expect(off.getAttribute('data-kind')).toBe('locked')
    expect(off.textContent).toBe('The news wire is not switched on for this server.')
    expect(within(off).queryByRole('button')).toBeNull()
    expect(screen.queryByTestId('terminal-unews')).toBeNull()
    await act(flush)
    expect(FakeES.all).toHaveLength(0)
    // the day read left with the first paint, beside the feed's own first read; once the feed has
    // refused, nothing is asked again (no retry loop against a route that is switched off)
    const asked = fetchMock.mock.calls.length
    expect(server.dayCalls.length).toBeLessThanOrEqual(1)
    expect(server.daysCalls).toBeLessThanOrEqual(1)
    await act(() => new Promise((r) => setTimeout(r, 60)))
    expect(fetchMock.mock.calls.length).toBe(asked)
    expect(reports(setFreshness)).toEqual([])
  })

  it('signed out says so, and is not the switched-off sentence', async () => {
    server.recentStatus = 401
    renderPanel()
    const off = await screen.findByTestId('terminal-unews-off')
    expect(off.textContent).toContain('You are signed out')
    expect(off.textContent).not.toContain('not switched on')
    expect(FakeES.all).toHaveLength(0)
  })

  it('a stream that cannot open still shows the archive, says it is not live, and offers Retry', async () => {
    globalThis.EventSource = undefined
    renderPanel()
    await loaded()
    expect(seqs()).toEqual([10, 9, 8, 7])
    expect(screen.getByTestId('terminal-unews-status').textContent).toContain('Not live')
    const note = screen.getByTestId('terminal-unews-stream-failed')
    globalThis.EventSource = FakeES
    fireEvent.click(within(note).getByRole('button', { name: 'Retry' }))
    await act(flush)
    expect(openStreams()).toHaveLength(1)
    await goLive()
    expect(screen.queryByTestId('terminal-unews-stream-failed')).toBeNull()
    expect(screen.getByTestId('terminal-unews-status').textContent).toMatch(/^Live\./)
  })

  it('a failed day read is an error with Retry, never an empty list', async () => {
    server.archive = []
    server.dayStatus = 500
    renderPanel({}, { code: 'UNEWX' })
    const err = await screen.findByTestId('terminal-unews-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('UCT News could not be read just now.')
    expect(err.textContent).toContain('That is not the same as a quiet wire. Retry, or run UNEWX again.')
    expect(screen.queryByTestId('terminal-unews-empty')).toBeNull()
    server.archive = ARCHIVE.slice()
    server.dayStatus = 200
    fireEvent.click(within(err).getByRole('button', { name: 'Retry' }))
    await loaded()
    expect(seqs()).toEqual([10, 9, 8, 7])
  })

  it('a day read that fails while live rows are on screen keeps them and says the read failed', async () => {
    server.dayStatus = 500
    renderPanel()
    const note = await screen.findByTestId('terminal-unews-stale-read')
    expect(note.textContent).toContain('UCT News could not be read just now. Showing what was already loaded.')
    expect(seqs()).toEqual([10, 9, 8, 7])
    expect(screen.queryByTestId('terminal-unews-error')).toBeNull()
  })

  it('a quiet day is said as a quiet day', async () => {
    server.archive = []
    renderPanel()
    const empty = await screen.findByTestId('terminal-unews-empty')
    expect(empty.textContent).toContain('No headlines yet today.')
    expect(empty.textContent).toContain('New ones appear here the moment they arrive.')
    expect(within(empty).queryByRole('button')).toBeNull()
  })

  it('a recorded gap in the feed is said in words', async () => {
    server.coverage = { complete: false, gaps: [{ from_ms: at(TODAY, 1), to_ms: at(TODAY, 2), reason: 'receiver_down' }] }
    renderPanel()
    await loaded()
    expect(screen.getByTestId('terminal-unews-gap').textContent).toContain('Headlines may be missing between')
  })
})

describe('UNEWS live', () => {
  it('shows today, newest first, each row with the time UCT received it', async () => {
    const { setFreshness } = renderPanel()
    await loaded()
    expect(seqs()).toEqual([10, 9, 8, 7])
    expect(texts()[0]).toBe('INVENTED: crude settles lower on the day')
    for (const r of rows()) expect(r.textContent).toMatch(/\d{1,2}:\d{2}:\d{2} (AM|PM) ET/)
    expect(rows()[1].textContent).toContain('News')
    expect(rows()[3].textContent).toContain('Earnings')
    expect(screen.getByTestId('terminal-unews-count').textContent).toBe(`4 headlines on ${dayLabel(TODAY, TODAY)}.`)
    expect(screen.getByTestId('terminal-unews-day').textContent).toBe(`${dayLabel(TODAY, TODAY)} (today)`)
    expect(lastDay()).toMatchObject({ date: TODAY, query: '', categories: [], symbol: null, hide_placeholders: true, limit: 60 })
    expect(lastDay().history).toBeUndefined()
    // the header source line: the widget's own name and credit, dated by the newest headline
    const report = reports(setFreshness).at(-1)
    expect(report.source).toBe(UCT_NEWS_SOURCE)
    expect(report.observedAt).toBe(new Date(at(TODAY, 4)).toISOString())
    expect(screen.getByTestId('terminal-unews-method').textContent).toContain('UCT News, powered by Trade Exchange.')
    expect(screen.getByTestId('terminal-unews-method').textContent).toContain('picked out of each headline automatically')
  })

  it('a live headline arrives at the top and the count follows', async () => {
    renderPanel()
    await loaded()
    await goLive(H(11, TODAY, 5, 'INVENTED: $ZZQB halts a product line', ['ZZQB']))
    expect(seqs()).toEqual([11, 10, 9, 8, 7])
    expect(texts()[0]).toBe('INVENTED: $ZZQB halts a product line')
    expect(screen.getByTestId('terminal-unews-status').textContent).toBe('Live. New headlines appear at the top as they arrive.')
    expect(screen.getByTestId('terminal-unews-status').getAttribute('data-tone')).toBe('live')
    expect(screen.getByTestId('terminal-unews-count').textContent).toBe(`5 headlines on ${dayLabel(TODAY, TODAY)}.`)
    expect(screen.queryByTestId('terminal-unews-new')).toBeNull()
  })

  it('scrolled down, new headlines are held and the rows on screen do not change until asked', async () => {
    renderPanel()
    await loaded()
    scrollTo(160)
    const before = rows().map((r) => r.outerHTML)
    await goLive(H(11, TODAY, 5, 'INVENTED: first held headline'), H(12, TODAY, 6, 'INVENTED: second held headline'))
    expect(rows().map((r) => r.outerHTML)).toEqual(before)
    expect(seqs()).toEqual([10, 9, 8, 7])
    const btn = screen.getByTestId('terminal-unews-new')
    expect(btn.textContent).toBe('Show 2 new headlines')
    expect(screen.getByTestId('terminal-unews-held').textContent).toBe('2 new headlines held back while you read.')
    fireEvent.click(btn)
    expect(seqs()).toEqual([12, 11, 10, 9, 8, 7])
    expect(screen.getByTestId('scroller').scrollTop).toBe(0)
    expect(screen.queryByTestId('terminal-unews-new')).toBeNull()
    expect(screen.getByTestId('terminal-unews-held').textContent).toBe('')
  })

  it('scrolling back to the top shows what was held', async () => {
    renderPanel()
    await loaded()
    scrollTo(160)
    await goLive(H(11, TODAY, 5, 'INVENTED: held while reading'))
    expect(screen.getByTestId('terminal-unews-new').textContent).toBe('Show 1 new headline')
    scrollTo(0)
    expect(seqs()).toEqual([11, 10, 9, 8, 7])
    expect(screen.queryByTestId('terminal-unews-new')).toBeNull()
  })

  it('finds the element that scrolls: the nearest scrolling ancestor, else the page', async () => {
    const { unmount } = renderPanel()
    await loaded()
    expect(scrollParentOf(screen.getByTestId('terminal-unews'))).toBe(screen.getByTestId('scroller'))
    unmount()
    renderPanel({}, { scroll: false })
    await loaded()
    expect(scrollParentOf(screen.getByTestId('terminal-unews'))).toBe(document.scrollingElement || document.documentElement)
  })
})

describe('UNEWS filters', () => {
  it('a type chip is sent to the server and narrows the list; All types clears it', async () => {
    renderPanel()
    await loaded()
    const macro = screen.getByTestId('terminal-unews-type-Macro')
    expect(macro.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByTestId('terminal-unews-type-all').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(macro)
    await waitFor(() => expect(seqs()).toEqual([8]))
    expect(lastDay()).toMatchObject({ date: TODAY, categories: ['Macro'] })
    expect(macro.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('terminal-unews-type-all').getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByTestId('terminal-unews-count').textContent).toBe(`1 of 4 headlines on ${dayLabel(TODAY, TODAY)} matches the filters above.`)
    fireEvent.click(screen.getByTestId('terminal-unews-type-Earnings'))
    await waitFor(() => expect(seqs()).toEqual([8, 7]))
    expect(lastDay().categories).toEqual(['Macro', 'Earnings'])
    fireEvent.click(screen.getByTestId('terminal-unews-type-all'))
    await waitFor(() => expect(seqs()).toEqual([10, 9, 8, 7]))
    expect(lastDay().categories).toEqual([])
  })

  it('a typed word is sent to the server, narrows the list and is marked in the headline', async () => {
    renderPanel()
    await loaded()
    const box = screen.getByLabelText('Filter')
    expect(box.tagName).toBe('INPUT')
    fireEvent.change(box, { target: { value: '  guidance ' } })
    await waitFor(() => expect(seqs()).toEqual([7]))
    expect(lastDay()).toMatchObject({ date: TODAY, query: 'guidance' })
    expect([...rows()[0].querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['guidance'])
    expect(texts()[0]).toBe('INVENTED: $ZZQB cuts guidance after a slow quarter')
    fireEvent.change(box, { target: { value: '' } })
    await waitFor(() => expect(seqs()).toEqual([10, 9, 8, 7]))
  })

  it('a live headline that does not pass the filter never enters the list', async () => {
    renderPanel()
    await loaded()
    fireEvent.click(screen.getByTestId('terminal-unews-type-Macro'))
    await waitFor(() => expect(seqs()).toEqual([8]))
    await goLive(H(11, TODAY, 5, 'INVENTED: a company headline'), H(12, TODAY, 6, 'INVENTED: a macro headline', [], { category: 'Macro' }))
    expect(seqs()).toEqual([12, 8])
  })

  it('filters that match nothing say it is the filter, with one press to clear them', async () => {
    renderPanel()
    await loaded()
    fireEvent.change(screen.getByLabelText('Filter'), { target: { value: 'zzzz no such words' } })
    const empty = await screen.findByTestId('terminal-unews-empty')
    expect(empty.textContent).toContain(`No headline on ${dayLabel(TODAY, TODAY)} matches the filters above.`)
    expect(empty.textContent).toContain('That is the filter, not a quiet wire.')
    fireEvent.click(within(empty).getByRole('button', { name: 'Clear the filters' }))
    await waitFor(() => expect(seqs()).toEqual([10, 9, 8, 7]))
    expect(screen.getByLabelText('Filter').value).toBe('')
  })
})

describe('UNEWS earlier days', () => {
  it('steps back a day and forward again; an earlier day is not live', async () => {
    renderPanel()
    await loaded()
    expect(screen.getByTestId('terminal-unews-next').disabled).toBe(true)
    expect(screen.queryByTestId('terminal-unews-latest')).toBeNull()
    fireEvent.click(screen.getByTestId('terminal-unews-prev'))
    await waitFor(() => expect(seqs()).toEqual([6, 5, 4]))
    expect(lastDay()).toMatchObject({ date: D1 })
    expect(screen.getByTestId('terminal-unews').getAttribute('data-day')).toBe(D1)
    expect(screen.getByTestId('terminal-unews-day').textContent).toBe(dayLabel(D1, TODAY))
    expect(screen.getByTestId('terminal-unews-status').textContent)
      .toBe(`Showing ${dayLabel(D1, TODAY)}. New headlines are not added to an earlier day.`)
    // a headline that arrives now belongs to today: it never enters the earlier day
    await goLive(H(11, TODAY, 5, 'INVENTED: arrives while an earlier day is open'))
    expect(seqs()).toEqual([6, 5, 4])
    expect(screen.queryByTestId('terminal-unews-new')).toBeNull()
    expect(screen.getByTestId('terminal-unews-status').textContent).toContain('not added to an earlier day')
    fireEvent.click(screen.getByTestId('terminal-unews-next'))
    await waitFor(() => expect(seqs()).toEqual([11, 10, 9, 8, 7]))
    expect(screen.getByTestId('terminal-unews-status').textContent).toMatch(/^Live\./)
  })

  it('stops at the day the archive begins, says a day with nothing kept, and returns to today in one press', async () => {
    server.firstDayPartial = true
    renderPanel()
    await loaded()
    fireEvent.click(screen.getByTestId('terminal-unews-prev'))
    await waitFor(() => expect(seqs()).toEqual([6, 5, 4]))
    fireEvent.click(screen.getByTestId('terminal-unews-prev'))
    const empty = await screen.findByTestId('terminal-unews-empty')
    expect(empty.textContent).toContain(`No headlines were kept for ${dayLabel(addDays(TODAY, -2), TODAY)}.`)
    fireEvent.click(screen.getByTestId('terminal-unews-prev'))
    await waitFor(() => expect(seqs()).toEqual([3, 2, 1]))
    expect(screen.getByTestId('terminal-unews-prev').disabled).toBe(true)
    expect(screen.getByTestId('terminal-unews-end').textContent)
      .toBe(`Start of ${dayLabel(D3, TODAY)}. The UCT News archive began partway through this day.`)
    fireEvent.click(screen.getByTestId('terminal-unews-latest'))
    await waitFor(() => expect(seqs()).toEqual([10, 9, 8, 7]))
    expect(lastDay()).toMatchObject({ date: TODAY })
  })

  it('a long day loads its newest 60, says so, and loads earlier headlines on request', async () => {
    server.archive = Array.from({ length: 70 }, (_, i) => H(i + 1, TODAY, i, `INVENTED: headline number ${i + 1}`))
    renderPanel()
    await loaded()
    expect(rows()).toHaveLength(60)
    expect(seqs()[0]).toBe(70)
    expect(screen.getByTestId('terminal-unews-count').textContent)
      .toBe(`70 headlines on ${dayLabel(TODAY, TODAY)}. The newest 60 are loaded.`)
    expect(screen.getByTestId('terminal-unews-cut').textContent).toBe(`Earlier headlines of ${dayLabel(TODAY, TODAY)} are not loaded yet.`)
    expect(screen.queryByTestId('terminal-unews-end')).toBeNull()
    fireEvent.click(screen.getByTestId('terminal-unews-older'))
    await waitFor(() => expect(rows()).toHaveLength(70))
    expect(lastDay()).toMatchObject({ date: TODAY, direction: 'older' })
    expect(lastDay().cursor).toEqual([at(TODAY, 10), 11])
    expect(seqs().at(-1)).toBe(1)
    expect(screen.queryByTestId('terminal-unews-older')).toBeNull()
    expect(screen.getByTestId('terminal-unews-end').textContent).toBe(`Start of ${dayLabel(TODAY, TODAY)}.`)
  })

  it('loading earlier headlines while new ones are held keeps them held and counts only the new', async () => {
    server.archive = Array.from({ length: 70 }, (_, i) => H(i + 1, TODAY, i, `INVENTED: headline number ${i + 1}`))
    renderPanel()
    await loaded()
    scrollTo(400)
    await goLive(H(71, TODAY, 71, 'INVENTED: arrives while reading far down'))
    fireEvent.click(screen.getByTestId('terminal-unews-older'))
    await waitFor(() => expect(rows()).toHaveLength(70))
    expect(seqs()[0]).toBe(70)
    expect(screen.getByTestId('terminal-unews-new').textContent).toBe('Show 1 new headline')
  })
})

describe('NVDA UNEWS: one stock', () => {
  it('reads every archived day for the stock and says how far back it looked and that matching is automatic', async () => {
    renderPanel({ sym: 'ZZQA' })
    await loaded()
    expect(lastDay()).toMatchObject({ history: true, symbol: 'ZZQA', limit: 60 })
    expect(lastDay().date).toBeUndefined()
    expect(seqs()).toEqual([9, 5, 1])
    // days mix, so every row carries its date
    expect(rows().map((r) => within(r).getByTestId('terminal-unews-time').textContent)).toEqual([9, 5, 1].map((s) => fmtStamp(ARCHIVE[s - 1].received_at_ms)))
    const reach = screen.getByTestId('terminal-unews-reach').textContent
    expect(reach).toContain(`Searched every day UCT News has kept, back to ${dayLabel(D3, TODAY)}, when its archive began.`)
    expect(reach).toContain('Headlines are matched to ZZQA automatically, from the words of each headline.')
    expect(reach).toContain('a headline about it can be missed and one about something else can be matched by mistake')
    expect(screen.getByTestId('terminal-unews-count').textContent).toBe('3 headlines naming ZZQA found.')
    expect(screen.getByTestId('terminal-unews-end').textContent).toBe('That is every archived headline naming ZZQA.')
    expect(screen.getByTestId('terminal-unews').getAttribute('data-mode')).toBe('stock')
    // one stock has no day stepper: it is every day at once
    expect(screen.queryByTestId('terminal-unews-prev')).toBeNull()
    expect(screen.queryByTestId('terminal-unews-day')).toBeNull()
    expect(screen.getByRole('list', { name: 'UCT News headlines naming ZZQA, newest first' })).toBeTruthy()
  })

  it('a search that has further to go says where it stands, and "Search earlier days" continues it', async () => {
    // 70 headlines naming ZZQA: 40 today, 20 yesterday, 10 three days ago. The first step returns 60.
    const many = []
    for (let i = 0; i < 10; i++) many.push(H(many.length + 1, D3, i, `INVENTED: ZZQA note ${many.length + 1}`, ['ZZQA']))
    for (let i = 0; i < 20; i++) many.push(H(many.length + 1, D1, i, `INVENTED: ZZQA note ${many.length + 1}`, ['ZZQA']))
    for (let i = 0; i < 40; i++) many.push(H(many.length + 1, TODAY, i, `INVENTED: ZZQA note ${many.length + 1}`, ['ZZQA']))
    server.archive = many
    renderPanel({ sym: 'ZZQA' })
    await loaded()
    expect(rows()).toHaveLength(60)
    const reach = screen.getByTestId('terminal-unews-reach').textContent
    expect(reach).toContain(`Searched back to ${dayLabel(D1, TODAY)} so far. Earlier days have not been searched yet.`)
    expect(reach).not.toContain('Searched every day')
    expect(screen.getByTestId('terminal-unews-count').textContent).toBe('60 headlines naming ZZQA found so far.')
    expect(screen.getByTestId('terminal-unews-cut').textContent).toContain('searched a few days at a time')
    const older = screen.getByTestId('terminal-unews-older')
    expect(older.textContent).toBe('Search earlier days')
    fireEvent.click(older)
    await waitFor(() => expect(rows()).toHaveLength(70))
    expect(lastDay()).toMatchObject({ history: true, symbol: 'ZZQA' })
    expect(lastDay().cursor).toBeTruthy()
    expect(screen.getByTestId('terminal-unews-reach').textContent).toContain(`Searched every day UCT News has kept, back to ${dayLabel(D3, TODAY)}`)
    expect(screen.getByTestId('terminal-unews-count').textContent).toBe('70 headlines naming ZZQA found.')
  })

  it('a stock no archived headline names says so, with how far back it looked', async () => {
    renderPanel({ sym: 'ZZNO' })
    const empty = await screen.findByTestId('terminal-unews-empty')
    expect(empty.textContent).toBe('No archived headline names ZZNO.')
    expect(screen.getByTestId('terminal-unews-reach').textContent).toContain('Searched every day UCT News has kept')
    expect(screen.getByTestId('terminal-unews-reach').textContent).toContain('matched to ZZNO automatically')
  })

  it('a live headline naming the stock arrives at the top; one naming another stock does not', async () => {
    renderPanel({ sym: 'ZZQA' })
    await loaded()
    await goLive(H(11, TODAY, 5, 'INVENTED: $ZZQB halts a product line', ['ZZQB']), H(12, TODAY, 6, 'INVENTED: $ZZQA lifts its dividend', ['ZZQA']))
    expect(seqs()).toEqual([12, 9, 5, 1])
    expect(screen.getByTestId('terminal-unews-status').textContent).toMatch(/^Live\./)
  })

  it('the type chips and the text filter narrow the one-stock search too', async () => {
    renderPanel({ sym: 'ZZQA' })
    await loaded()
    fireEvent.click(screen.getByTestId('terminal-unews-type-Earnings'))
    await waitFor(() => expect(seqs()).toEqual([5]))
    expect(lastDay()).toMatchObject({ history: true, symbol: 'ZZQA', categories: ['Earnings'] })
    expect(screen.getByTestId('terminal-unews-count').textContent).toBe('1 headline naming ZZQA found, with the filters above.')
  })
})

describe('UNEWS tickers', () => {
  it('a ticker in a headline loads that stock and keeps the words of the headline', async () => {
    const { run } = renderPanel()
    await loaded()
    const row = rows().find((r) => r.getAttribute('data-seq') === '9')
    const btn = within(row).getByTestId('panel-symbol-ZZQA')
    expect(btn.textContent).toBe('$ZZQA')
    expect(row.firstElementChild.textContent).toBe('INVENTED: $ZZQA wins a supply contract')
    fireEvent.click(btn)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith('$ZZQA')
    // a headline that names no ticker has no button
    expect(within(rows()[0]).queryByRole('button')).toBeNull()
  })
})

describe('UNEWS shares the one stream and releases it', () => {
  it('two panels and a /charts widget share ONE history load and ONE stream', async () => {
    const widget = pool.subscribe(() => {})     // the /charts widget's hold on the same pool
    const a = renderPanel()
    const b = renderPanel({ sym: 'ZZQA' })
    await act(flush)
    await act(flush)
    expect(fetchMock.mock.calls.filter(([u]) => String(u).startsWith(pool.RECENT_URL))).toHaveLength(1)
    expect(FakeES.all).toHaveLength(1)
    expect(lastES().url).toBe(`${pool.STREAM_URL}?after=10&epoch=${EPOCH}`)
    a.unmount()
    b.unmount()
    // the widget still holds it: the panels leaving must not close its stream
    expect(openStreams()).toHaveLength(1)
    widget()
    expect(openStreams()).toHaveLength(0)
  })

  it('unmounting the last panel closes the stream and empties the pool', async () => {
    const a = renderPanel()
    await loaded()
    const b = renderPanel({ sym: 'ZZQA' })
    await act(flush)
    expect(openStreams()).toHaveLength(1)
    a.unmount()
    expect(openStreams()).toHaveLength(1)
    b.unmount()
    expect(openStreams()).toHaveLength(0)
    expect(FakeES.all).toHaveLength(1)
    expect(pool.getSnapshot().items).toEqual([])
  })

  it('the panel opens no transport and runs no polling loop of its own', () => {
    const src = read('UctNewsPanel.jsx').replace(/\/\/.*$/gm, '')
    expect(src).not.toMatch(/new EventSource|\bfetch\(|setInterval|useSWR|WebSocket/)
    expect(src).toMatch(/declareNeed\(\{ kind: 'trade-exchange-news'/)
    expect(src).toMatch(/useSyncExternalStore\(NEWS\.subscribe, NEWS\.read\)/)
    const model = read('uctNewsModel.js').replace(/\/\/.*$/gm, '')
    expect(model).not.toMatch(/new EventSource|\bfetch\(|setInterval|setTimeout/)
  })
})

describe('UNEWS look and reach', () => {
  it('fits a phone: the filter form stacks, nothing has a fixed width, and long words wrap whole', () => {
    const jsx = read('UctNewsPanel.jsx')
    expect(jsx).toMatch(/<form className=\{form\.form\}/)
    expect(jsx).not.toMatch(/<table|<input|<select/)
    const css = read('uctNewsPanel.module.css').replace(/\/\*[\s\S]*?\*\//g, '')
    const px = [...css.matchAll(/(?:^|[\s;{])(?:min-)?width:\s*(\d+)px/g)].map((m) => Number(m[1]))
    expect(px.every((n) => n <= 16), `fixed widths: ${px}`).toBe(true)
    expect(css).not.toMatch(/word-break:\s*break-all|overflow-wrap:\s*anywhere/)
    expect(css).toMatch(/\.text\s*\{[^}]*overflow-wrap:\s*break-word/)
    expect(css).toMatch(/@media \(max-width: 1024px\)\s*\{\s*\.newBtn\s*\{[^}]*min-height:\s*var\(--tap-min\)[^}]*max-width:\s*calc\(100% - /)
    // the held-headlines control takes no room in the list, so showing it moves no row
    expect(css).toMatch(/\.newAnchor\s*\{[^}]*position:\s*sticky[^}]*height:\s*0/)
  })

  it('paints no color of its own', () => {
    for (const f of ['UctNewsPanel.jsx', 'uctNewsModel.js', 'uctNewsPanel.module.css']) {
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, read(f)).map((h) => h.lit), f).toEqual([])
    }
  })

  it('is axe clean: the wire, one stock, held headlines, and the switched-off sentence', async () => {
    const market = renderPanel()
    await loaded()
    scrollTo(160)
    await goLive(H(11, TODAY, 5, 'INVENTED: held for the audit'))
    expect(screen.getByTestId('terminal-unews-new')).toBeTruthy()
    await expectNoAxeViolations(market.container)
    market.unmount()
    const stock = renderPanel({ sym: 'ZZQA' })
    await loaded()
    await expectNoAxeViolations(stock.container)
    stock.unmount()
    pool._resetForTests()
    server.recentStatus = 404
    const off = renderPanel()
    await screen.findByTestId('terminal-unews-off')
    await expectNoAxeViolations(off.container)
  })
})
