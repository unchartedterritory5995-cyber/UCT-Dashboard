import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildDraftBlocks, reviewDraftsEnabled, fetchDailyDraft, fetchWeeklyDraft, fetchMonthlyDraft,
  draftWeeklyReview, draftMonthlyReview, draftDailyReview, mondayOfIso, todayDayIso, thisMonthIso,
} from './reviewDrafts'
import { latchNotebookFlags, __resetNotebookFlags } from './offline/notebookFlags'
import { STILL_SYNCING_MESSAGE } from './offline/noteHasUnsentWork'
import { openNotebookDb } from './offline/notebookDb'
import { contract, contractBody, contractResponse } from '../__fixtures__/contract'

// `widgetSlotNode` (widgetEmbedCore.js) falls back to the symbol's LIVE workspace
// drawings whenever a caller does not pass its own `annotations` array. Mock the
// store so this file can prove the frozen review chart's explicit `annotations: []`
// is what keeps those drawings OUT -- a clean test environment's real store would
// return `[]` on its own and the guard's removal would go unnoticed otherwise.
vi.mock('../../../components/chart/drawingsStore', () => ({
  peekDrawings: () => [{ id: 'd1', type: 'trendline', points: [[0, 0], [1, 1]] }],
}))

// The unsent-work guard is the sibling door's ONE helper (lib/offline/noteHasUnsentWork.js).
// Only its answer is controlled here; the sentence and everything else are the real module's.
const guard = vi.hoisted(() => ({ answer: { unsent: false, why: 'clean' }, calls: [] }))
vi.mock('./offline/noteHasUnsentWork', async (importOriginal) => ({
  ...(await importOriginal()),
  noteHasUnsentWork: vi.fn(async (noteId, opts) => {
    guard.calls.push({ noteId, connect: opts?.connect })
    return guard.answer
  }),
}))

// ── fixtures: known n and dollars, mirroring the backend's own enriched-trade /
// finding shape (api/services/journal_two/leak_finder.py's `_finding`). ──────────────

function mkTrade(over = {}) {
  return {
    id: 't1', tradeRef: 'id:t1', symbol: 'NVDA', exitDate: '2026-09-28T19:00:00+00:00',
    pnlDollar: -101, rMultiple: -1.0, ...over,
  }
}

const AGGREGATES = {
  trade_count: 5, wins: 2, losses: 3, bes: 0, win_rate: 0.4, avg_r: -0.2,
  net_pnl_dollar: -123.45, profit_factor: 0.8,
}

const DISCIPLINE = {
  plannedCount: 4, unplannedCount: 1, needsPickCount: 0,
  planRate: { k: 4, n: 5, rate: 0.8, band: 'too_few', wording: 'too few to judge', range: null },
  entry: { k: 3, n: 4, rate: 0.75, band: 'too_few', wording: 'too few to judge', range: null },
  stop: { k: 4, n: 4, rate: 1, band: 'too_few', wording: 'too few to judge', range: null },
  size: { k: 4, n: 4, rate: 1, band: 'too_few', wording: 'too few to judge', range: null },
  targetHitRate: { k: 1, n: 3, rate: 0.33, band: 'too_few', wording: 'too few to judge', range: null },
}

// ── CONTRACT: the drafts are the REAL server's answers ────────────────────────────────────
// to GET /api/j2/review-drafts/{daily,weekly,monthly} (`__fixtures__/contract`, written by
// tools/notebook_contract_fixtures.py and held current by tests/test_notebook_contract_fixtures.py).
// One member, one account: a winner that was planned, a loss and its re-entry fifteen minutes
// later, a prior weekly review note, and twelve small unplanned losses earlier in the month.
//
// Nothing here types a draft, a finding or a trade by hand. The ONE override is the Compass
// quote: the recorded member has no stored Compass review, so `WITH_COMPASS` adds the three
// fields `review_drafts._compass_excerpt` returns.
const WEEKLY = () => contractBody('review-drafts.weekly')
const MONTHLY = () => contractBody('review-drafts.monthly')
const DAILY = () => contractBody('review-drafts.daily')
const WITH_COMPASS = { compassText: { text: 'You traded your plan well this week.', kind: 'weekly_review', createdAt: '2026-10-02T00:00:00Z' } }

function fixturePayload(overrides = {}) {
  return { ...WEEKLY(), ...overrides }
}
const leak = (payload, kind) => payload.leaks.find((f) => f.kind === kind)

function flattenText(node, out = []) {
  if (!node) return out
  if (node.type === 'text' && typeof node.text === 'string') out.push(node.text)
  if (Array.isArray(node.content)) node.content.forEach((c) => flattenText(c, out))
  return out
}

function allText(blocks) {
  return blocks.map((b) => flattenText(b).join('')).join(' | ')
}

describe('the recorded drafts carry what these rails read (non-vacuity)', () => {
  it('a week with a planned winner, a re-entry after a loss, and a prior review', () => {
    const w = WEEKLY()
    expect(w).toMatchObject({ period: 'weekly', tradeCount: 4, range: { start: '2026-09-28', end: '2026-10-02' } })
    expect(w.aggregates).toMatchObject({ trade_count: 4, wins: 2, losses: 2, win_rate: 0.5, net_pnl_dollar: 100 })
    expect(w.links.plans.map((x) => [x.symbol, x.noteTitle])).toEqual([['RDWN', 'RDWN plan']])
    expect(w.links.reviews.map((x) => x.tag)).toEqual(['weekly-review'])
    expect(w.leaks.map((f) => [f.kind, f.sample.n, f.sample.band])).toEqual(
      [['revenge_reentry', 1, 'too_few'], ['weak_time_window', 2, 'too_few'], ['unplanned_trades', 3, 'too_few']])
    expect(w.compassText).toBeNull()
  })

  it('a month whose unplanned trades are enough to show plainly', () => {
    const f = leak(MONTHLY(), 'unplanned_trades')
    expect(f.sample).toMatchObject({ n: 16, band: 'thin' })
    expect(f.trades).toHaveLength(16)
  })
})

describe('buildDraftBlocks — structure', () => {
  it('renders the numbers section from the authority’s own aggregate fields, not recomputed', () => {
    const blocks = buildDraftBlocks(fixturePayload())
    const text = allText(blocks)
    expect(text).toContain('$100.00')            // net_pnl_dollar 100.0, verbatim
    expect(text).toContain('50%')                // win_rate 0.5
    expect(text).toContain('+0.63R')             // avg_r 0.625
    expect(text).toContain('1.14')               // profit_factor 1.1428...
    expect(text).toContain('2 / 2 / 0')          // wins / losses / breakeven
    // a losing month keeps its sign
    expect(allText(buildDraftBlocks(MONTHLY()))).toContain('-$600.00')
  })

  it('words the discipline record by its own sample (R3): too_few shows wording, no bare number', () => {
    const blocks = buildDraftBlocks(fixturePayload())
    const text = allText(blocks)
    expect(text).toContain('too few to judge')
    expect(text).toContain('Planned: 1 · Unplanned: 3 · Needs a pick: 0')
    expect(text).toContain('Plan rate: too few to judge')
    expect(text).not.toMatch(/Plan rate: \d/)     // one of four planned is never shown as "25%"
    // A thin sample shows its rate WITH its range (the month: 1 planned of 17).
    expect(MONTHLY().discipline.planRate).toMatchObject({ k: 1, n: 17, band: 'thin' })
    expect(allText(buildDraftBlocks(MONTHLY()))).toContain('Plan rate: 6% (thin sample, 95% range 1%–27%)')
  })

  it('renders setup changes with the period AND the all-time baseline side by side', () => {
    const blocks = buildDraftBlocks(fixturePayload())
    const text = allText(blocks)
    expect(text).toContain('Breakout')
    expect(text).toContain('+2.00R')   // Breakout's allTimeAvgR
    expect(text).toContain('-0.75R')   // Pullback's allTimeAvgR
    const changes = WEEKLY().setupChanges
    expect(changes.map((c) => [c.setup, c.periodTradeCount, c.allTimeAvgR])).toEqual([['Breakout', 2, 2], ['Pullback', 2, -0.75]])
  })

  it('links section lists the real plan/review notes as anchors, and says so plainly when empty', () => {
    const blocks = buildDraftBlocks(fixturePayload())
    const text = allText(blocks)
    expect(text).toContain('RDWN — RDWN plan')
    expect(text).toContain('Review of the week of Sep 14')
    expect(text).toContain('Nothing resurfaced this period.')
    // the plan link is a real link to the note the server named
    const [plan] = WEEKLY().links.plans
    expect(JSON.stringify(blocks)).toContain(plan.noteId)
    // a month with no earlier review says so plainly
    expect(MONTHLY().links.reviews).toEqual([])
    expect(allText(buildDraftBlocks(MONTHLY()))).toContain('No prior review notes found.')
  })

  it('a period with no trades is said plainly, section by section, with no number invented', () => {
    const empty = contractBody('review-drafts.weekly.empty')
    expect(empty).toMatchObject({ tradeCount: 0, bestTrade: null, worstTrade: null, leaks: [], setupChanges: [] })
    const blocks = buildDraftBlocks(empty)
    const text = allText(blocks)
    expect(text).toContain('No tagged setups this period.')
    expect(text).toContain('Plan rate: —')
    expect(text).not.toMatch(/NaN|undefined|null/)
    expect(blocks.some((b) => b.type === 'widgetEmbed')).toBe(false)
    expect(blocks.some((b) => b.type === 'toggle')).toBe(false)
  })

  it('charts best and worst trade as frozen widgetEmbed nodes, anchored to the exit', () => {
    const blocks = buildDraftBlocks(fixturePayload())
    const charts = blocks.filter((b) => b.type === 'widgetEmbed')
    expect(charts).toHaveLength(2)
    const { bestTrade, worstTrade } = WEEKLY()
    expect(charts.map((c) => c.attrs.params.symbol)).toEqual([bestTrade.symbol, worstTrade.symbol])
    expect(charts.map((c) => c.attrs.params.symbol)).toEqual(['RDWN', 'RDLS'])
    // anchored to each trade's own exit, to the second
    expect(charts.map((c) => c.attrs.params.to)).toEqual(
      [bestTrade.exitDate, worstTrade.exitDate].map((iso) => Math.floor(Date.parse(iso) / 1000)))
    // frozen, never the live/rolling window
    expect(charts.every((c) => c.attrs.mode === 'snapshot')).toBe(true)
    // no live-workspace drawings bleed into a frozen review chart
    expect(charts.every((c) => Array.isArray(c.attrs.annotations) && c.attrs.annotations.length === 0)).toBe(true)
  })

  it('quotes Compass only when the payload carries one, as a G-064 askInsert node (labelled AI)', () => {
    const withQuote = buildDraftBlocks(fixturePayload(WITH_COMPASS))
    expect(withQuote.some((b) => b.type === 'askInsert')).toBe(true)

    // what the server really sent for this member: no stored Compass review, so no quote
    expect(WEEKLY().compassText).toBeNull()
    const without = buildDraftBlocks(WEEKLY())
    expect(without.some((b) => b.type === 'askInsert')).toBe(false)
  })
})

describe('buildDraftBlocks — leaks: the reveal, and the dollars', () => {
  it('a finding below n=10 is BEHIND THE REVEAL (a collapsed toggle)', () => {
    const blocks = buildDraftBlocks(fixturePayload())
    const toggles = blocks.filter((b) => b.type === 'toggle')
    const revenge = toggles.find((t) => flattenText(t).join('').includes('Revenge re-entries'))
    expect(revenge).toBeTruthy()
    expect(revenge.attrs.open).toBe(false)
  })

  it('a finding at n>=10 is shown plainly (open)', () => {
    const blocks = buildDraftBlocks(MONTHLY())
    const toggles = blocks.filter((b) => b.type === 'toggle')
    const unplanned = toggles.find((t) => flattenText(t).join('').includes('Unplanned trades'))
    expect(unplanned).toBeTruthy()
    expect(unplanned.attrs.open).toBe(true)
    expect(flattenText(unplanned).join('')).toContain('thin sample (n=16)')
    // ...and the SAME finding in the week, with three trades, stays behind the reveal
    const weekly = buildDraftBlocks(WEEKLY()).filter((b) => b.type === 'toggle')
      .find((t) => flattenText(t).join('').includes('Unplanned trades'))
    expect(weekly.attrs.open).toBe(false)
    expect(flattenText(weekly).join('')).toContain('too few to judge (n=3)')
  })

  it('a finding’s rendered trade list sums to its own stated dollar figure', () => {
    const payload = MONTHLY()
    const finding = leak(payload, 'unplanned_trades') // 16 trades, net -1216 declared by the server
    const sum = finding.trades.reduce((s, t) => s + t.pnlDollar, 0)
    // the server's own invariant holds in what it sent...
    expect(sum).toBeCloseTo(finding.dollarImpact.netPnl, 2)
    expect(finding.dollarImpact.netPnl).toBe(-1216)
    // ...and the renderer must not alter the figure it was handed.
    const blocks = buildDraftBlocks(payload)
    const text = allText(blocks)
    expect(text).toContain('-$1216.00')
    // every finding of every recorded draft keeps that invariant
    for (const draft of [DAILY(), WEEKLY(), MONTHLY()]) {
      for (const f of draft.leaks) {
        expect(f.trades.reduce((s, t) => s + t.pnlDollar, 0), `${draft.period} ${f.kind}`).toBeCloseTo(f.dollarImpact.netPnl, 2)
        expect(f.trades).toHaveLength(f.sample.n)
      }
    }
  })

  it('no leaks → a plain "none found" callout, never an empty section', () => {
    const blocks = buildDraftBlocks(fixturePayload({ leaks: [] }))
    expect(blocks.some((b) => b.type === 'callout')).toBe(true)
    expect(blocks.some((b) => b.type === 'toggle')).toBe(false)
  })

  it('each leak’s toggle body links every cited trade to its trade page', () => {
    const blocks = buildDraftBlocks(fixturePayload())
    const toggles = blocks.filter((b) => b.type === 'toggle')
    const revenge = toggles.find((t) => flattenText(t).join('').includes('Revenge re-entries'))
    const json = JSON.stringify(revenge)
    const cited = leak(WEEKLY(), 'revenge_reentry').trades
    expect(cited.map((t) => t.id)).toEqual(['rd-reentry'])
    for (const t of cited) expect(json).toContain(`/journal-2-0/trade/${t.id}`)
  })
})

describe('mondayOfIso', () => {
  it('a Wednesday resolves to that week’s Monday', () => {
    expect(mondayOfIso(new Date('2026-10-01T12:00:00Z'))).toBe('2026-09-28') // a Thursday->Monday
  })
  it('a Sunday resolves to the PRIOR Monday (not the next)', () => {
    expect(mondayOfIso(new Date('2026-10-04T12:00:00Z'))).toBe('2026-09-28')
  })
  it('a Monday resolves to itself', () => {
    expect(mondayOfIso(new Date('2026-09-28T12:00:00Z'))).toBe('2026-09-28')
  })
})

describe('reviewDraftsEnabled — the flag gate', () => {
  afterEach(() => __resetNotebookFlags())

  it('reads false before any payload has latched', () => {
    expect(reviewDraftsEnabled()).toBe(false)
  })

  it('reads true once a payload latches the flag on', () => {
    latchNotebookFlags({ notebook_review_drafts_enabled: true })
    expect(reviewDraftsEnabled()).toBe(true)
  })
})

describe('fetch* — the query shape', () => {
  let calledUrl = null
  beforeEach(() => {
    calledUrl = null
    global.fetch = vi.fn((url) => {
      calledUrl = url
      return Promise.resolve({ ok: true, json: () => Promise.resolve(fixturePayload()) })
    })
  })

  it('fetchDailyDraft sends day and accountId as query params', async () => {
    await fetchDailyDraft({ day: '2026-10-02', accountId: 'acc1' })
    expect(calledUrl).toBe('/api/j2/review-drafts/daily?day=2026-10-02&accountId=acc1')
  })

  it('each fetcher builds exactly the URL its recorded answer came from', async () => {
    await fetchDailyDraft({ day: '2026-09-30', accountId: 'acct-review' })
    expect(calledUrl).toBe(contract('review-drafts.daily')._contract.path)
    await fetchWeeklyDraft({ weekStart: '2026-09-28', accountId: 'acct-review' })
    expect(calledUrl).toBe(contract('review-drafts.weekly')._contract.path)
    await fetchMonthlyDraft({ month: '2026-09', accountId: 'acct-review' })
    expect(calledUrl).toBe(contract('review-drafts.monthly')._contract.path)
  })

  it('returns the draft exactly as the server sent it', async () => {
    global.fetch = vi.fn(async () => contractResponse('review-drafts.monthly'))
    expect(await fetchMonthlyDraft({ month: '2026-09' })).toEqual(MONTHLY())
  })

  it.each([
    ['a day that is not a date', 'review-drafts.daily.bad-day'],
    ['no day at all (the server answers with a LIST, not a sentence)', 'review-drafts.daily.missing-day'],
  ])('a refused read throws for %s, and never resolves to a draft', async (_label, name) => {
    expect(contract(name)._contract.status).toBe(422)
    global.fetch = vi.fn(async () => contractResponse(name))
    const failure = await fetchDailyDraft({ day: 'yesterday' }).then(() => null, (e) => e)
    expect(failure).toBeInstanceOf(Error)
    expect(String(failure.message)).not.toContain('[object Object]')
  })

  it('fetchWeeklyDraft omits accountId when absent', async () => {
    await fetchWeeklyDraft({ weekStart: '2026-09-28' })
    expect(calledUrl).toBe('/api/j2/review-drafts/weekly?weekStart=2026-09-28')
  })

  it('fetchMonthlyDraft hits the monthly route', async () => {
    await fetchMonthlyDraft({ month: '2026-09' })
    expect(calledUrl).toBe('/api/j2/review-drafts/monthly?month=2026-09')
  })

  it('a non-ok response throws rather than returning a falsy payload', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404 }))
    await expect(fetchDailyDraft({ day: '2026-10-02' })).rejects.toThrow()
  })
})

describe('draftWeeklyReview / draftMonthlyReview — land through the ONE create door', () => {
  let posted = null
  beforeEach(() => {
    posted = null
    global.fetch = vi.fn((url, opts) => {
      if (typeof url === 'string' && url.startsWith('/api/j2/review-drafts/')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(url.includes('/monthly') ? MONTHLY() : WEEKLY()) })
      }
      if (url === '/api/j2/notes' && opts?.method === 'POST') {
        posted = JSON.parse(opts.body)
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ note: { id: 'new1' } }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
  })

  it('weekly: creates a note tagged weekly-review, titled from the catalog’s own format', async () => {
    const { note } = await draftWeeklyReview({ weekStart: '2026-09-28' })
    expect(note.id).toBe('new1')
    expect(posted.tags).toEqual(['weekly-review'])
    expect(posted.title).toMatch(/Weekly Review/)
    expect(posted.bodyJson.type).toBe('doc')
    // the note that is created carries the server's numbers and the plan it linked
    const text = flattenText(posted.bodyJson).join(' | ')
    expect(text).toContain('$100.00')
    expect(text).toContain('RDWN plan')
  })

  it('monthly: creates a note tagged monthly-review', async () => {
    const { note } = await draftMonthlyReview({ month: '2026-09' })
    expect(note.id).toBe('new1')
    expect(posted.tags).toEqual(['monthly-review'])
    expect(posted.title).toMatch(/Monthly Review/)
    expect(flattenText(posted.bodyJson).join(' | ')).toContain('-$600.00')
  })
})

describe('draftDailyReview — appends to the member’s OWN daily note, never a second note', () => {
  let putBody = null
  let putUrl = null
  beforeEach(() => {
    putBody = null
    putUrl = null
    global.fetch = vi.fn((url, opts) => {
      if (typeof url === 'string' && url.startsWith('/api/j2/review-drafts/daily')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(DAILY()) })
      }
      if (url === '/api/j2/notes/daily' && opts?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            note: {
              id: 'daily1', updatedAt: '2026-10-02T12:00:00Z',
              bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Morning plan' }] }] },
            },
            created: false,
          }),
        })
      }
      if (typeof url === 'string' && url.startsWith('/api/j2/notes/daily1') && opts?.method === 'PUT') {
        putUrl = url
        putBody = JSON.parse(opts.body)
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ note: { id: 'daily1', updatedAt: '2026-10-02T18:00:00Z', bodyJson: putBody.bodyJson } }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
  })

  it('PUTs the daily note with the CAS baseline it was just read at', async () => {
    const { note } = await draftDailyReview({ day: '2026-10-02' })
    expect(note.id).toBe('daily1')
    expect(putUrl).toBe('/api/j2/notes/daily1')
    expect(putBody.baseUpdatedAt).toBe('2026-10-02T12:00:00Z')
  })

  it('preserves the note’s existing content and APPENDS the recap after it', async () => {
    await draftDailyReview({ day: '2026-10-02' })
    const texts = flattenText(putBody.bodyJson)
    const morningIdx = texts.findIndex((t) => t.includes('Morning plan'))
    const recapIdx = texts.findIndex((t) => t.includes('ecap — Oct 2'))
    expect(morningIdx).toBeGreaterThanOrEqual(0)
    expect(recapIdx).toBeGreaterThan(morningIdx)
  })
})

// ── fin-data I1: the period is the EASTERN trading day, week and month ────────────────────
//
// A member reviews in the evening. At 8:30 PM Eastern the UTC date is already tomorrow, so a
// UTC "today" asks the server for a day with no trades and writes an empty recap. Every
// instant below is written as its UTC stamp with the Eastern wall time beside it. The winter
// cases matter: a hand-rolled "UTC minus 4 hours" passes every summer case and fails them.
describe('the review period is the Eastern day, week and month (I1)', () => {
  const CASES = [
    // [label, UTC instant, ET day, Monday of the ET week, ET month]
    ['8:30 PM ET on an ordinary Tuesday', '2026-10-07T00:30:00Z', '2026-10-06', '2026-10-05', '2026-10'],
    ['8:30 PM ET on a Sunday', '2026-10-05T00:30:00Z', '2026-10-04', '2026-09-28', '2026-10'],
    ['8:30 PM ET on the last evening of a month', '2026-10-01T00:30:00Z', '2026-09-30', '2026-09-28', '2026-09'],
    ['8:30 PM ET on the last evening of a year', '2027-01-01T01:30:00Z', '2026-12-31', '2026-12-28', '2026-12'],
    ['11:30 PM EST in winter (UTC minus 5)', '2026-01-16T04:30:00Z', '2026-01-15', '2026-01-12', '2026-01'],
    ['8:30 PM the Saturday before clocks go forward', '2026-03-08T01:30:00Z', '2026-03-07', '2026-03-02', '2026-03'],
    ['8:30 PM the Sunday clocks went forward', '2026-03-09T00:30:00Z', '2026-03-08', '2026-03-02', '2026-03'],
    ['11:30 PM the Saturday before clocks go back', '2026-11-01T03:30:00Z', '2026-10-31', '2026-10-26', '2026-10'],
    ['11:30 PM the Sunday clocks went back', '2026-11-02T04:30:00Z', '2026-11-01', '2026-10-26', '2026-11'],
    ['midday, where UTC and Eastern agree', '2026-10-06T16:00:00Z', '2026-10-06', '2026-10-05', '2026-10'],
  ]

  it.each(CASES)('%s', (_label, utc, day, monday, month) => {
    const now = new Date(utc)
    expect(todayDayIso(now)).toBe(day)
    expect(mondayOfIso(now)).toBe(monday)
    expect(thisMonthIso(now)).toBe(month)
  })

  it('control: the evening cases really do sit on a different UTC date', () => {
    // If this stops holding, the table above can no longer tell UTC from Eastern.
    const differing = CASES.filter(([, utc, day]) => utc.slice(0, 10) !== day)
    expect(differing.length).toBeGreaterThanOrEqual(8)
  })

  describe('with no argument, the helpers read the clock in Eastern time', () => {
    let urls = []
    beforeEach(() => {
      urls = []
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-01T00:30:00Z')) // Wed Sep 30, 8:30 PM ET
      global.fetch = vi.fn((url, opts) => {
        urls.push(url)
        if (url === '/api/j2/notes/daily') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ note: { id: 'd1', updatedAt: 'x', bodyJson: { type: 'doc', content: [] } } }) })
        }
        if (opts?.method === 'PUT') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ note: { id: 'd1', updatedAt: 'y' } }) })
        }
        if (opts?.method === 'POST') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ note: { id: 'n1', title: 't' } }) })
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(fixturePayload()) })
      })
    })
    afterEach(() => { vi.useRealTimers() })

    it('the three helpers', () => {
      expect(todayDayIso()).toBe('2026-09-30')
      expect(mondayOfIso()).toBe('2026-09-28')
      expect(thisMonthIso()).toBe('2026-09')
    })

    it('a draft asked for with no period asks the server for the Eastern one', async () => {
      await draftDailyReview()
      await draftWeeklyReview()
      await draftMonthlyReview()
      expect(urls).toContain('/api/j2/review-drafts/daily?day=2026-09-30')
      expect(urls).toContain('/api/j2/review-drafts/weekly?weekStart=2026-09-28')
      expect(urls).toContain('/api/j2/review-drafts/monthly?month=2026-09')
    })
  })
})

// ── fin-flags I5: no discipline section while plan grading is off ─────────────────────────
describe('buildDraftBlocks with plan grading off (discipline: null)', () => {
  it('leaves the Discipline record section out, and keeps every other section', () => {
    const texts = flattenText({ content: buildDraftBlocks(fixturePayload({ discipline: null })) })
    expect(texts.some((t) => t.includes('Discipline record'))).toBe(false)
    expect(texts.some((t) => t.includes('Plan rate'))).toBe(false)
    expect(texts.some((t) => t.includes('The numbers'))).toBe(true)
    expect(texts.some((t) => t.includes('Setup changes'))).toBe(true)
  })
  it('control: with a discipline payload the section is there', () => {
    const texts = flattenText({ content: buildDraftBlocks(fixturePayload()) })
    expect(texts.some((t) => t.includes('Discipline record'))).toBe(true)
  })
})

// ── fin-frontend I3: the daily draft never lands over words that have not reached the server ─
//
// The draft reads the daily note FROM THE SERVER, appends the recap and PUTs the whole body.
// When this browser still holds words for that note that the server has not seen (typed
// offline, or a save still queued), the server copy is missing them: the PUT lands a body
// without them and is then recorded as this tab's own write, so the queued words either
// overwrite the recap or are dropped. The sibling append door (lib/sendToJournal.js) asks
// `noteHasUnsentWork` first and refuses. This door now asks the same helper.
describe('draftDailyReview — refuses while the daily note has unsent work', () => {
  let puts = []
  let dailyOpens = 0
  beforeEach(() => {
    puts = []
    dailyOpens = 0
    guard.calls = []
    guard.answer = { unsent: false, why: 'clean' }
    global.fetch = vi.fn((url, opts) => {
      if (url === '/api/j2/notes/daily') {
        dailyOpens += 1
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ note: { id: 'daily1', updatedAt: 'u1', bodyJson: { type: 'doc', content: [] } } }) })
      }
      if (opts?.method === 'PUT') {
        puts.push(JSON.parse(opts.body))
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ note: { id: 'daily1', updatedAt: 'u2' } }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(fixturePayload({ period: 'daily' })) })
    })
  })
  afterEach(() => { guard.answer = { unsent: false, why: 'clean' } })

  it('with unsent work: no PUT, and the error carries the sibling door’s own sentence', async () => {
    guard.answer = { unsent: true, why: 'queued' }
    let thrown = null
    try { await draftDailyReview({ day: '2026-10-02' }) } catch (e) { thrown = e }
    expect(thrown).toBeTruthy()
    expect(thrown.message).toBe(STILL_SYNCING_MESSAGE)
    expect(thrown.memberMessage).toBe(STILL_SYNCING_MESSAGE)
    expect(puts).toEqual([])
  })

  it('a store that cannot be read defers too (the helper answers unsent for "unknown")', async () => {
    guard.answer = { unsent: true, why: 'unreadable' }
    await expect(draftDailyReview({ day: '2026-10-02' })).rejects.toThrow(STILL_SYNCING_MESSAGE)
    expect(puts).toEqual([])
  })

  it('asks about THE DAILY NOTE by its id string, through the plain store opener', async () => {
    await draftDailyReview({ day: '2026-10-02' })
    expect(guard.calls).toEqual([{ noteId: 'daily1', connect: openNotebookDb }])
    expect(typeof guard.calls[0].noteId).toBe('string')
  })

  it('control: with nothing unsent the recap lands, on the base the note was read at', async () => {
    await draftDailyReview({ day: '2026-10-02' })
    expect(puts).toHaveLength(1)
    expect(puts[0].baseUpdatedAt).toBe('u1')
  })

  it('the guard runs before the PUT, never after it', async () => {
    const order = []
    const realFetch = global.fetch
    global.fetch = vi.fn((url, opts) => {
      if (opts?.method === 'PUT') order.push('put')
      return realFetch(url, opts)
    })
    const { noteHasUnsentWork } = await import('./offline/noteHasUnsentWork')
    noteHasUnsentWork.mockImplementationOnce(async () => { order.push('guard'); return { unsent: false, why: 'clean' } })
    await draftDailyReview({ day: '2026-10-02' })
    expect(order).toEqual(['guard', 'put'])
  })
})

// ── fin-data M1: a recap for a PAST day goes into THAT day's note ──────────────────────────
//
// The older recap cards on the Compass tab pass their own day. The door fetched that day's
// numbers and then appended them to TODAY's daily note under "Today's recap".
describe('draftDailyReview — the note it writes is the note of the day it drafts', () => {
  let dailyBodies = []
  let putBody = null
  beforeEach(() => {
    dailyBodies = []
    putBody = null
    guard.answer = { unsent: false, why: 'clean' }
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-06T18:00:00Z')) // Tue Oct 6, 2 PM ET
    global.fetch = vi.fn((url, opts) => {
      if (url === '/api/j2/notes/daily') {
        const body = JSON.parse(opts.body)
        dailyBodies.push(body)
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ note: { id: `daily-${body.date}`, updatedAt: 'u1', bodyJson: { type: 'doc', content: [] } } }) })
      }
      if (opts?.method === 'PUT') {
        putBody = { url, ...JSON.parse(opts.body) }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ note: { id: url.split('/').pop(), updatedAt: 'u2' } }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(fixturePayload({ period: 'daily' })) })
    })
  })
  afterEach(() => { vi.useRealTimers() })

  it('a past day opens that day’s daily note and is not called "Today"', async () => {
    const { note } = await draftDailyReview({ day: '2026-10-02' })
    expect(dailyBodies).toEqual([{ date: '2026-10-02' }])
    expect(putBody.url).toBe('/api/j2/notes/daily-2026-10-02')
    expect(note.id).toBe('daily-2026-10-02')
    const texts = flattenText(putBody.bodyJson)
    expect(texts.some((t) => t.startsWith('Recap — Oct 2'))).toBe(true)
    expect(texts.some((t) => t.includes('Today'))).toBe(false)
  })

  it('today’s draft opens today’s note and keeps the "Today’s recap" heading', async () => {
    await draftDailyReview({ day: '2026-10-06' })
    expect(dailyBodies).toEqual([{ date: '2026-10-06' }])
    expect(flattenText(putBody.bodyJson).some((t) => t.startsWith("Today's recap — Oct 6"))).toBe(true)
  })

  it('with no day it is today in Eastern time, for the data AND the note', async () => {
    vi.setSystemTime(new Date('2026-10-07T00:30:00Z')) // still Tue Oct 6, 8:30 PM ET
    await draftDailyReview()
    expect(dailyBodies).toEqual([{ date: '2026-10-06' }])
    expect(global.fetch.mock.calls.some(([u]) => u === '/api/j2/review-drafts/daily?day=2026-10-06')).toBe(true)
  })
})

// ── fin-data M2: a second click on a draft door never makes a second draft ─────────────────
describe('the draft doors are idempotent', () => {
  let state
  beforeEach(() => {
    guard.answer = { unsent: false, why: 'clean' }
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-06T18:00:00Z'))
    state = { daily: { type: 'doc', content: [] }, stamp: 1, notes: [], puts: 0, creates: 0, draftFetches: 0, listUrls: [] }
    global.fetch = vi.fn((url, opts) => {
      const ok = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
      if (url === '/api/j2/notes/daily') {
        return ok({ note: { id: 'daily1', updatedAt: `u${state.stamp}`, bodyJson: state.daily } })
      }
      if (typeof url === 'string' && url.startsWith('/api/j2/notes/daily1') && opts?.method === 'PUT') {
        state.puts += 1
        state.daily = JSON.parse(opts.body).bodyJson
        state.stamp += 1
        return ok({ note: { id: 'daily1', updatedAt: `u${state.stamp}`, bodyJson: state.daily } })
      }
      if (url === '/api/j2/notes' && opts?.method === 'POST') {
        state.creates += 1
        const body = JSON.parse(opts.body)
        const note = { id: `n${state.creates}`, title: body.title, tags: body.tags }
        state.notes.push(note)
        return ok({ note })
      }
      if (typeof url === 'string' && url.startsWith('/api/j2/notes?')) {
        state.listUrls.push(url)
        const tag = new URL(url, 'http://x').searchParams.get('tag')
        return ok({ notes: state.notes.filter((n) => (n.tags || []).includes(tag)), total: 0 })
      }
      if (typeof url === 'string' && url.startsWith('/api/j2/review-drafts/')) {
        state.draftFetches += 1
        return ok(fixturePayload())
      }
      return ok({})
    })
  })
  afterEach(() => { vi.useRealTimers() })

  const headings = (docNode) => (docNode.content || [])
    .filter((n) => n.type === 'heading').map((n) => flattenText(n).join(''))

  it('daily: the second click appends nothing and answers the same note', async () => {
    const first = await draftDailyReview({ day: '2026-10-06' })
    const second = await draftDailyReview({ day: '2026-10-06' })
    expect(state.puts).toBe(1)
    expect(headings(state.daily).filter((t) => t.startsWith("Today's recap"))).toHaveLength(1)
    expect(second.note.id).toBe(first.note.id)
    expect(second.existing).toBe(true)
    expect(first.existing).toBeFalsy()
    expect(state.draftFetches).toBe(1) // nothing is fetched for a draft that will not be written
  })

  it('daily: the member’s own heading that merely resembles a recap does not block the draft', async () => {
    state.daily = { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Recap of my week' }] }] }
    await draftDailyReview({ day: '2026-10-06' })
    expect(state.puts).toBe(1)
  })

  it('weekly: the second click opens the first draft instead of creating another', async () => {
    const first = await draftWeeklyReview({ weekStart: '2026-10-05' })
    const second = await draftWeeklyReview({ weekStart: '2026-10-05' })
    expect(state.creates).toBe(1)
    expect(second.note.id).toBe(first.note.id)
    expect(second.existing).toBe(true)
    expect(state.listUrls.every((u) => u.includes('tag=weekly-review'))).toBe(true)
  })

  it('weekly: a different week is a different draft', async () => {
    await draftWeeklyReview({ weekStart: '2026-10-05' })
    await draftWeeklyReview({ weekStart: '2026-09-28' })
    expect(state.creates).toBe(2)
  })

  it('monthly: the second click opens the first draft', async () => {
    const first = await draftMonthlyReview({ month: '2026-09' })
    const second = await draftMonthlyReview({ month: '2026-09' })
    expect(state.creates).toBe(1)
    expect(second.note.id).toBe(first.note.id)
  })

  it('a failed look-up never blocks a draft: it is created', async () => {
    const inner = global.fetch
    global.fetch = vi.fn((url, opts) => (typeof url === 'string' && url.startsWith('/api/j2/notes?')
      ? Promise.resolve({ ok: false, status: 500 }) : inner(url, opts)))
    await draftWeeklyReview({ weekStart: '2026-10-05' })
    expect(state.creates).toBe(1)
  })
})

// ── fin-data M6: leaks say what was left out, and what was not worse than average ──────────
describe('buildDraftBlocks — leak honesty', () => {
  const finding = (over = {}) => ({
    kind: 'unplanned_trades', label: 'Unplanned trades', vsBaseline: 'worse', excludedNoR: 0, excludedNetPnl: 0,
    sample: { n: 12, mean: -0.5, band: 'thin', wording: 'thin sample', range: [-0.9, -0.1] },
    dollarImpact: { netPnl: -600, avgR: -0.5, baselineAvgR: -0.2, baselineAvgNetPnlPerTrade: -24.69 },
    trades: Array.from({ length: 12 }, (_, i) => mkTrade({ id: `u${i}`, pnlDollar: -50, rMultiple: -0.5 })),
    detail: {}, ...over,
  })

  it('says how many trades have no R value and were left out of every finding', () => {
    const text = allText(buildDraftBlocks(fixturePayload({ leakCoverage: { trades: 9, withR: 5, withoutR: 4 } })))
    expect(text).toContain('4 of 9 trades have no R value')
  })

  it('says so even when no leak was found, so "none found" is not read as "all clear"', () => {
    const text = allText(buildDraftBlocks(fixturePayload({ leaks: [], leakCoverage: { trades: 3, withR: 0, withoutR: 3 } })))
    expect(text).toContain('3 of 3 trades have no R value')
  })

  it('says nothing about R when every trade has one', () => {
    const text = allText(buildDraftBlocks(fixturePayload({ leakCoverage: { trades: 5, withR: 5, withoutR: 0 } })))
    expect(text).not.toContain('no R value')
  })

  it('a finding names the trades it left out for having no R, and their dollars', () => {
    const text = allText(buildDraftBlocks(fixturePayload({ leaks: [finding({ excludedNoR: 2, excludedNetPnl: -290 })] })))
    expect(text).toContain('2 more trades fit this but have no R value')
    expect(text).toContain('-$290.00')
  })

  it('a finding that was NOT worse than the period average is listed apart from the leaks', () => {
    const blocks = buildDraftBlocks(fixturePayload({
      leaks: [finding(), finding({ kind: 'regime_at_entry', label: 'Regime at entry', vsBaseline: 'not_worse' })],
    }))
    const texts = blocks.map((b) => flattenText(b).join(''))
    const leaksAt = texts.findIndex((t) => t === 'Leaks')
    const apartAt = texts.findIndex((t) => t.startsWith('Checked, and not worse than your average'))
    const unplannedAt = texts.findIndex((t) => t.includes('Unplanned trades'))
    const regimeAt = texts.findIndex((t) => t.includes('Regime at entry'))
    expect(leaksAt).toBeGreaterThanOrEqual(0)
    expect(apartAt).toBeGreaterThan(unplannedAt)
    expect(regimeAt).toBeGreaterThan(apartAt)
  })

  it('when nothing was worse, it says no leaks and still lists what it checked', () => {
    const blocks = buildDraftBlocks(fixturePayload({ leaks: [finding({ vsBaseline: 'not_worse' })] }))
    expect(blocks.some((b) => b.type === 'callout')).toBe(true)
    expect(allText(blocks)).toContain('Checked, and not worse than your average')
  })

  it('a payload from before this field treats every finding as a leak, as it always did', () => {
    const f = finding(); delete f.vsBaseline
    const text = allText(buildDraftBlocks(fixturePayload({ leaks: [f] })))
    expect(text).not.toContain('Checked, and not worse')
  })
})

// ── round 2: a Compass quote about a different set of trades is not shown as the same period ─
describe('buildDraftBlocks — the Compass quote and its period', () => {
  const OMITTED = {
    draftOnly: 1, compassOnly: 0,
    sentence: 'Compass reviewed this week from Monday 00:00 to Saturday 00:00 UTC. This note covers Monday to Friday in Eastern time. 1 trade is in one and not the other, so the Compass review is not quoted here.',
  }

  it('says why the quote is left out, in the server’s own sentence, and shows no quote', () => {
    const blocks = buildDraftBlocks(fixturePayload({ compassText: null, compassOmitted: OMITTED }))
    const text = allText(blocks)
    expect(text).toContain('What Compass said')
    expect(text).toContain(OMITTED.sentence)
    expect(JSON.stringify(blocks)).not.toContain('askInsert')
  })

  it('with a quote and nothing omitted it renders the quote as before', () => {
    const blocks = buildDraftBlocks(fixturePayload({
      compassText: { text: 'A steady week.', kind: 'weekly_review', createdAt: 'x' }, compassOmitted: null }))
    expect(allText(blocks)).not.toContain('not quoted here')
    expect(JSON.stringify(blocks)).toContain('A steady week.')
  })

  it('with neither there is no Compass section at all', () => {
    const text = allText(buildDraftBlocks(fixturePayload({ compassText: null, compassOmitted: null })))
    expect(text).not.toContain('What Compass said')
  })
})
