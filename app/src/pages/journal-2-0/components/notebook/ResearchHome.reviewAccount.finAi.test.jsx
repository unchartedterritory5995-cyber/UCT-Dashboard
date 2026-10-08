// Finish program, lane AI-FE, K2 (client half). The keyed walk: Research Home's one-click
// weekly review asked `GET /api/j2/review-drafts/weekly?weekStart=...` with NO account id, so
// the server had no account to look a Compass review up for and the quote never showed. The
// Insights door already passes the member's selected account; the Home door passed nothing.
//
// Here: the Home box reads the SAME selected-account hook every Journal read uses, hands its
// id to all three drafts, and the request that leaves the browser carries it. With "All
// accounts" selected (id null) the parameter is left off, as before. With the switch off the
// accounts are not asked for at all.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { REVIEW_DRAFTS_FLAG } from '../../lib/reviewDraftsFlag'
import { contractBody } from '../../__fixtures__/contract'

const account = vi.hoisted(() => ({ id: 'acct-7', enabledArgs: [] }))
vi.mock('../../hooks/useJ2SelectedAccount', () => ({
  default: (enabled = true) => {
    account.enabledArgs.push(enabled)
    return { accountId: enabled ? account.id : null, account: null, accounts: [], setAccount: () => {} }
  },
}))

const calls = vi.hoisted(() => ({ daily: [], weekly: [], monthly: [] }))
vi.mock('../../lib/reviewDrafts', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    // the daily door opens the member's daily note and the offline store first: only its
    // arguments are read here. Weekly and monthly run for real, down to the request.
    draftDailyReview: vi.fn(async (args) => { calls.daily.push(args); return { note: { id: 'daily1' } } }),
    draftWeeklyReview: vi.fn(async (args) => { calls.weekly.push(args); return real.draftWeeklyReview(args) }),
    draftMonthlyReview: vi.fn(async (args) => { calls.monthly.push(args); return real.draftMonthlyReview(args) }),
  }
})

import { ReviewDraftsHomeBox } from './ResearchHome'

let urls = []
let posted = []
beforeEach(() => {
  account.id = 'acct-7'
  account.enabledArgs.length = 0
  calls.daily.length = 0; calls.weekly.length = 0; calls.monthly.length = 0
  urls = []
  posted = []
  global.fetch = vi.fn((url, opts) => {
    urls.push(String(url))
    if (String(url).startsWith('/api/j2/review-drafts/')) {
      const name = String(url).includes('/monthly') ? 'review-drafts.monthly' : 'review-drafts.weekly'
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(contractBody(name)) })
    }
    if (url === '/api/j2/notes' && opts?.method === 'POST') {
      posted.push(JSON.parse(opts.body))
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ note: { id: 'new1' } }) })
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
  })
})
afterEach(() => __resetNotebookFlags())

const draftUrls = () => urls.filter((u) => u.startsWith('/api/j2/review-drafts/'))

describe('Research Home review drafts: the request names the member’s account (K2)', () => {
  it('weekly: the request carries accountId, and the note opens', async () => {
    latchNotebookFlags({ [REVIEW_DRAFTS_FLAG]: true })
    const onOpenNote = vi.fn()
    render(<ReviewDraftsHomeBox onOpenNote={onOpenNote} />)
    fireEvent.click(screen.getByRole('button', { name: /This week's review/ }))
    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith({ id: 'new1' }))
    expect(draftUrls()).toHaveLength(1)
    const u = new URL(draftUrls()[0], 'http://x')
    expect(u.pathname).toBe('/api/j2/review-drafts/weekly')
    expect(u.searchParams.get('accountId')).toBe('acct-7')
    expect(u.searchParams.get('weekStart')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('monthly: the request carries accountId', async () => {
    latchNotebookFlags({ [REVIEW_DRAFTS_FLAG]: true })
    const onOpenNote = vi.fn()
    render(<ReviewDraftsHomeBox onOpenNote={onOpenNote} />)
    fireEvent.click(screen.getByRole('button', { name: /This month's review/ }))
    await waitFor(() => expect(onOpenNote).toHaveBeenCalled())
    const u = new URL(draftUrls()[0], 'http://x')
    expect(u.pathname).toBe('/api/j2/review-drafts/monthly')
    expect(u.searchParams.get('accountId')).toBe('acct-7')
  })

  it('daily: the door is handed the same account id', async () => {
    latchNotebookFlags({ [REVIEW_DRAFTS_FLAG]: true })
    const onOpenNote = vi.fn()
    render(<ReviewDraftsHomeBox onOpenNote={onOpenNote} />)
    fireEvent.click(screen.getByRole('button', { name: /Today's recap/ }))
    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith({ id: 'daily1' }))
    expect(calls.daily[0].accountId).toBe('acct-7')
    expect(calls.daily[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('control: with "All accounts" selected (no id) the parameter is left off', async () => {
    account.id = null
    latchNotebookFlags({ [REVIEW_DRAFTS_FLAG]: true })
    const onOpenNote = vi.fn()
    render(<ReviewDraftsHomeBox onOpenNote={onOpenNote} />)
    fireEvent.click(screen.getByRole('button', { name: /This week's review/ }))
    await waitFor(() => expect(onOpenNote).toHaveBeenCalled())
    expect(new URL(draftUrls()[0], 'http://x').searchParams.has('accountId')).toBe(false)
  })

  it('the server’s reason for a missing quote lands in the note that is created', async () => {
    const sentence = 'Compass has not written a review for this week yet, so there is no quote here.'
    global.fetch = vi.fn((url, opts) => {
      if (String(url).startsWith('/api/j2/review-drafts/')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(
          { ...contractBody('review-drafts.weekly'), compassText: null, compassOmitted: { reason: 'no_review', sentence } }) })
      }
      if (url === '/api/j2/notes' && opts?.method === 'POST') {
        posted.push(JSON.parse(opts.body))
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ note: { id: 'new1' } }) })
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
    })
    latchNotebookFlags({ [REVIEW_DRAFTS_FLAG]: true })
    const onOpenNote = vi.fn()
    render(<ReviewDraftsHomeBox onOpenNote={onOpenNote} />)
    fireEvent.click(screen.getByRole('button', { name: /This week's review/ }))
    await waitFor(() => expect(onOpenNote).toHaveBeenCalled())
    const body = JSON.stringify(posted[0].bodyJson)
    expect(body).toContain('What Compass said')
    expect(body).toContain(sentence)
    expect(body).not.toContain('askInsert')
  })

  it('switch off: nothing is drawn and the accounts are not asked for', () => {
    latchNotebookFlags({ [REVIEW_DRAFTS_FLAG]: false })
    const { container } = render(<ReviewDraftsHomeBox onOpenNote={vi.fn()} />)
    expect(container.textContent).toBe('')
    expect(account.enabledArgs.every((e) => e === false)).toBe(true)
    expect(account.enabledArgs.length).toBeGreaterThan(0)
  })
})
