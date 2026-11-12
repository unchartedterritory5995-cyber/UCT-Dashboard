// Go-live wave 1 (B): the review-draft behaviour Research home's ReviewDraftsHomeBox tests pinned, kept on the ONE door
// that still runs it (lib/reviewDraftRun.js, behind the notes list's New menu "Reviews" group). Moved from
// ResearchHome.reviewAccount.finAi.test.jsx (K2: the request names the member's account) and
// ResearchHome.reviewLanding.test.jsx (KEYS3 Q18: the note opens on its first collapsed block; S2 B12: a recap that
// made the day's note says where it went). The cases that tested only the home box's own markup went with it.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { contractBody } from '../__fixtures__/contract'

const calls = vi.hoisted(() => ({ daily: [] }))
vi.mock('./reviewDrafts', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    // The daily door opens the member's daily note and the offline store first: only its arguments are read here.
    // Weekly and monthly run for real, down to the request.
    draftDailyReview: vi.fn(async (args) => { calls.daily.push(args); return { note: { id: 'daily1' }, created: false } }),
  }
})

import { draftReview, reviewDraftFailedSentence, REVIEW_PERIODS } from './reviewDraftRun'
import { DAILY_FOLDER_NOTICE } from './dailyNote'

let urls = []
let posted = []
function serve(draftBody) {
  global.fetch = vi.fn((url, opts) => {
    urls.push(String(url))
    if (String(url).startsWith('/api/j2/review-drafts/')) {
      const name = String(url).includes('/monthly') ? 'review-drafts.monthly' : 'review-drafts.weekly'
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(draftBody ? draftBody(name) : contractBody(name)) })
    }
    if (url === '/api/j2/notes' && opts?.method === 'POST') {
      posted.push(JSON.parse(opts.body))
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ note: { id: 'new1' } }) })
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
  })
}
beforeEach(() => {
  calls.daily.length = 0
  urls = []
  posted = []
  serve()
})
const draftUrls = () => urls.filter((u) => u.startsWith('/api/j2/review-drafts/'))

describe('the request names the member\'s selected account (K2)', () => {
  it('weekly: the request carries accountId, and the note opens on its first collapsed block', async () => {
    const onOpenNote = vi.fn()
    await draftReview('weekly', { accountId: 'acct-7', onOpenNote })
    expect(onOpenNote).toHaveBeenCalledWith({ id: 'new1' }, null, { to: 'collapsed' })
    expect(draftUrls()).toHaveLength(1)
    const u = new URL(draftUrls()[0], 'http://x')
    expect(u.pathname).toBe('/api/j2/review-drafts/weekly')
    expect(u.searchParams.get('accountId')).toBe('acct-7')
    expect(u.searchParams.get('weekStart')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('monthly: the request carries accountId', async () => {
    await draftReview('monthly', { accountId: 'acct-7', onOpenNote: vi.fn() })
    const u = new URL(draftUrls()[0], 'http://x')
    expect(u.pathname).toBe('/api/j2/review-drafts/monthly')
    expect(u.searchParams.get('accountId')).toBe('acct-7')
  })

  it('daily: the door is handed the same account id and today\'s date, and lands on the collapsed block', async () => {
    const onOpenNote = vi.fn()
    await draftReview('daily', { accountId: 'acct-7', onOpenNote })
    expect(calls.daily[0].accountId).toBe('acct-7')
    expect(calls.daily[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(onOpenNote).toHaveBeenCalledWith({ id: 'daily1' }, null, { to: 'collapsed' })
  })

  it('control: "All accounts" (no id) leaves the parameter off', async () => {
    await draftReview('weekly', { accountId: null, onOpenNote: vi.fn() })
    expect(new URL(draftUrls()[0], 'http://x').searchParams.has('accountId')).toBe(false)
  })

  it('the server\'s reason for a missing quote lands in the note that is created', async () => {
    const sentence = 'Compass has not written a review for this week yet, so there is no quote here.'
    serve((name) => ({ ...contractBody(name), compassText: null, compassOmitted: { reason: 'no_review', sentence } }))
    await draftReview('weekly', { accountId: 'acct-7', onOpenNote: vi.fn() })
    const body = JSON.stringify(posted[0].bodyJson)
    expect(body).toContain('What Compass said')
    expect(body).toContain(sentence)
  })
})

describe("Today's recap says where a new note went (S2, B12)", () => {
  it('a recap that MADE the day\'s note says so', async () => {
    const { draftDailyReview } = await import('./reviewDrafts')
    draftDailyReview.mockResolvedValueOnce({ note: { id: 'rev-day' }, created: true })
    const onNotice = vi.fn()
    await draftReview('daily', { onOpenNote: vi.fn(), onNotice })
    expect(onNotice).toHaveBeenCalledWith(DAILY_FOLDER_NOTICE)
  })

  it('a recap added to a note that already existed says nothing more', async () => {
    const onNotice = vi.fn()
    await draftReview('daily', { onOpenNote: vi.fn(), onNotice })
    expect(onNotice).not.toHaveBeenCalled()
  })
})

describe('the words both doors show', () => {
  it('the three periods, in order', () => {
    expect(REVIEW_PERIODS.map((p) => p.label)).toEqual(["Today's recap", "This week's review", "This month's review"])
  })
  it('a failure says the door\'s own sentence when it wrote one, else a plain retry line', () => {
    expect(reviewDraftFailedSentence('weekly', { memberMessage: 'Still syncing.' })).toBe('Still syncing.')
    expect(reviewDraftFailedSentence('weekly', new Error('500'))).toBe('Could not draft the weekly review — try again.')
  })
})
