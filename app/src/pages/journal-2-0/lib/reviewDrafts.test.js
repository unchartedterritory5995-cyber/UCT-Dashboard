import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildDraftBlocks, reviewDraftsEnabled, fetchDailyDraft, fetchWeeklyDraft, fetchMonthlyDraft,
  draftWeeklyReview, draftMonthlyReview, draftDailyReview, mondayOfIso, todayDayIso, thisMonthIso,
} from './reviewDrafts'
import { latchNotebookFlags, __resetNotebookFlags } from './offline/notebookFlags'
import { STILL_SYNCING_MESSAGE } from './offline/noteHasUnsentWork'
import { openNotebookDb } from './offline/notebookDb'

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

function fixturePayload(overrides = {}) {
  return {
    period: 'weekly',
    range: { start: '2026-09-28', end: '2026-10-02' },
    tradeCount: 5,
    aggregates: AGGREGATES,
    discipline: DISCIPLINE,
    setupChanges: [
      { setup: 'Breakout', periodTradeCount: 3, periodAvgRStat: { n: 3, mean: -0.4, band: 'too_few', wording: 'too few to judge', range: null }, allTimeAvgR: 0.6, allTimeAvgRStat: {}, delta: -1.0 },
    ],
    bestTrade: { id: 'tb', tradeRef: 'id:tb', symbol: 'AAPL', side: 'Long', entryDate: '2026-09-29T14:30:00+00:00', exitDate: '2026-09-29T19:00:00+00:00', entryPrice: 100, exitPrice: 110, rMultiple: 2.0, pnlDollar: 500 },
    worstTrade: { id: 'tw', tradeRef: 'id:tw', symbol: 'TSLA', side: 'Long', entryDate: '2026-09-30T14:30:00+00:00', exitDate: '2026-09-30T19:00:00+00:00', entryPrice: 200, exitPrice: 190, rMultiple: -1.0, pnlDollar: -200 },
    links: {
      plans: [{ noteId: 'n1', noteTitle: 'NVDA plan', symbol: 'NVDA', tradeRef: 'id:t1' }],
      reviews: [{ noteId: 'n2', title: 'Last week’s review', updatedAt: '2026-09-21T00:00:00Z', tag: 'weekly-review' }],
      resurfaced: [],
    },
    leaks: [
      {
        kind: 'revenge_reentry', label: 'Revenge re-entries',
        sample: { n: 1, mean: -1.0, band: 'too_few', wording: 'too few to judge', range: null },
        dollarImpact: { netPnl: -101, avgR: -1.0, baselineAvgR: -0.2, baselineAvgNetPnlPerTrade: -24.69 },
        trades: [mkTrade()],
        detail: {},
      },
      {
        kind: 'unplanned_trades', label: 'Unplanned trades',
        sample: { n: 12, mean: -0.5, band: 'normal', wording: null, range: null },
        dollarImpact: { netPnl: -600, avgR: -0.5, baselineAvgR: -0.2, baselineAvgNetPnlPerTrade: -24.69 },
        trades: Array.from({ length: 12 }, (_, i) => mkTrade({ id: `u${i}`, tradeRef: `id:u${i}`, symbol: 'SPY', pnlDollar: -50 })),
        detail: {},
      },
    ],
    compassText: { text: 'You traded your plan well this week.', kind: 'weekly_review', createdAt: '2026-10-02T00:00:00Z' },
    baseline: { n: 5, avgR: -0.2, avgNetPnlPerTrade: -24.69 },
    sample: { tooFewBelow: 10, normalFrom: 25, rangeZ: 1.96, wording: { too_few: 'too few to judge', thin: 'thin sample', normal: null } },
    ...overrides,
  }
}

function flattenText(node, out = []) {
  if (!node) return out
  if (node.type === 'text' && typeof node.text === 'string') out.push(node.text)
  if (Array.isArray(node.content)) node.content.forEach((c) => flattenText(c, out))
  return out
}

function allText(blocks) {
  return blocks.map((b) => flattenText(b).join('')).join(' | ')
}

describe('buildDraftBlocks — structure', () => {
  it('renders the numbers section from the authority’s own aggregate fields, not recomputed', () => {
    const blocks = buildDraftBlocks(fixturePayload())
    const text = allText(blocks)
    expect(text).toContain('-$123.45')          // net_pnl_dollar, verbatim
    expect(text).toContain('40%')                // win_rate 0.4
  })

  it('words the discipline record by its own sample (R3): too_few shows wording, no bare number', () => {
    const blocks = buildDraftBlocks(fixturePayload())
    const text = allText(blocks)
    expect(text).toContain('too few to judge')
  })

  it('renders setup changes with the period AND the all-time baseline side by side', () => {
    const blocks = buildDraftBlocks(fixturePayload())
    const text = allText(blocks)
    expect(text).toContain('Breakout')
    expect(text).toContain('+0.60R')   // allTimeAvgR
  })

  it('links section lists the real plan/review notes as anchors, and says so plainly when empty', () => {
    const blocks = buildDraftBlocks(fixturePayload())
    const text = allText(blocks)
    expect(text).toContain('NVDA plan')
    expect(text).toContain('Nothing resurfaced this period.')
  })

  it('charts best and worst trade as frozen widgetEmbed nodes, anchored to the exit', () => {
    const blocks = buildDraftBlocks(fixturePayload())
    const charts = blocks.filter((b) => b.type === 'widgetEmbed')
    expect(charts).toHaveLength(2)
    expect(charts.map((c) => c.attrs.params.symbol)).toEqual(['AAPL', 'TSLA'])
    // frozen, never the live/rolling window
    expect(charts.every((c) => c.attrs.mode === 'snapshot')).toBe(true)
    // no live-workspace drawings bleed into a frozen review chart
    expect(charts.every((c) => Array.isArray(c.attrs.annotations) && c.attrs.annotations.length === 0)).toBe(true)
  })

  it('quotes Compass only when the payload carries one, as a G-064 askInsert node (labelled AI)', () => {
    const withQuote = buildDraftBlocks(fixturePayload())
    expect(withQuote.some((b) => b.type === 'askInsert')).toBe(true)

    const without = buildDraftBlocks(fixturePayload({ compassText: null }))
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
    const blocks = buildDraftBlocks(fixturePayload())
    const toggles = blocks.filter((b) => b.type === 'toggle')
    const unplanned = toggles.find((t) => flattenText(t).join('').includes('Unplanned trades'))
    expect(unplanned).toBeTruthy()
    expect(unplanned.attrs.open).toBe(true)
  })

  it('a finding’s rendered trade list sums to its own stated dollar figure', () => {
    const payload = fixturePayload()
    const finding = payload.leaks[1] // 12 trades, net -600 declared
    const sum = finding.trades.reduce((s, t) => s + t.pnlDollar, 0)
    // the fixture itself is internally consistent (mirrors the backend invariant);
    // the renderer must not alter the figure it was handed.
    expect(sum).toBeCloseTo(finding.dollarImpact.netPnl, 2)
    const blocks = buildDraftBlocks(payload)
    const text = allText(blocks)
    expect(text).toContain('-$600.00')
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
    expect(json).toContain('/journal-2-0/trade/t1')
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
        return Promise.resolve({ ok: true, json: () => Promise.resolve(fixturePayload()) })
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
  })

  it('monthly: creates a note tagged monthly-review', async () => {
    const { note } = await draftMonthlyReview({ month: '2026-09' })
    expect(note.id).toBe('new1')
    expect(posted.tags).toEqual(['monthly-review'])
    expect(posted.title).toMatch(/Monthly Review/)
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
        return Promise.resolve({ ok: true, json: () => Promise.resolve(fixturePayload({ period: 'daily' })) })
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
