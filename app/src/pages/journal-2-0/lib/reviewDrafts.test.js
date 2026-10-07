import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildDraftBlocks, reviewDraftsEnabled, fetchDailyDraft, fetchWeeklyDraft, fetchMonthlyDraft,
  draftWeeklyReview, draftMonthlyReview, draftDailyReview, mondayOfIso,
} from './reviewDrafts'
import { latchNotebookFlags, __resetNotebookFlags } from './offline/notebookFlags'
import { contract, contractBody, contractResponse } from '../__fixtures__/contract'

// `widgetSlotNode` (widgetEmbedCore.js) falls back to the symbol's LIVE workspace
// drawings whenever a caller does not pass its own `annotations` array. Mock the
// store so this file can prove the frozen review chart's explicit `annotations: []`
// is what keeps those drawings OUT -- a clean test environment's real store would
// return `[]` on its own and the guard's removal would go unnoticed otherwise.
vi.mock('../../../components/chart/drawingsStore', () => ({
  peekDrawings: () => [{ id: 'd1', type: 'trendline', points: [[0, 0], [1, 1]] }],
}))

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
    const recapIdx = texts.findIndex((t) => t.includes("Today's recap"))
    expect(morningIdx).toBeGreaterThanOrEqual(0)
    expect(recapIdx).toBeGreaterThan(morningIdx)
  })
})
