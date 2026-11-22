// Audit 2026-11-05, spec S9 (detail #49): a fresh template note's earnings block said "Today's earnings list has not
// been loaded yet. Capture again in a few minutes." The member is never asked to retry now: a gap that fills itself,
// captured TODAY, is read again in the background while the note is open and editable, and the first full answer fills
// the block. ⛔ A snapshot from an earlier day is never refreshed (IR-S11), and a block with no snapshot reads nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import PrepEarningsBlock from './PrepEarningsBlock'
import { FILLING_WORDS, FINAL_WORDS, RETRY_MAX, RETRY_MS, fillsItself } from './PrepCapture'
import { contractBody } from '../../../__fixtures__/contract'

const NOW = new Date('2026-11-05T14:00:00Z')      // 9:00 AM in New York
const gap = (o = {}) => ({ part: 'earnings', capturedAt: '2026-11-05T13:55:00Z', missing: 'no_earnings_yet',
  detail: "Today's earnings list has not been loaded yet. Capture again in a few minutes.", ...o })
// Read on the snapshot's own day (fix round 1: a read from another day never lands).
const full = () => ({ ...contractBody('trader-blocks.prep.earnings.mine'), part: 'earnings', capturedAt: new Date().toISOString() })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  globalThis.fetch = vi.fn()
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

const answer = (body) => vi.fn(async () => ({ ok: true, status: 200, json: async () => body }))

describe('a gap that fills itself (S9)', () => {
  it('says it is loading, offers nothing to press, and fills the block from a background read', async () => {
    const body = full()
    globalThis.fetch = answer(body)
    const setParams = vi.fn(() => true)
    render(<PrepEarningsBlock params={{ snapshot: gap() }} setParams={setParams} editable />)
    // An older note froze the retry sentence; the block says the new words instead, and never "Capture again".
    expect(screen.getByText(FILLING_WORDS.no_earnings_yet)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/capture again/i)
    expect(screen.queryByRole('button')).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()                   // nothing on mount
    await act(async () => { await vi.advanceTimersByTimeAsync(RETRY_MS) })
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/j2/trader-blocks/prep/earnings', expect.anything())
    expect(setParams).toHaveBeenCalledWith({ snapshot: body })
  })

  it('keeps reading quietly while the list is still missing, then stops after RETRY_MAX and offers Capture again', async () => {
    globalThis.fetch = answer(gap({ capturedAt: '2026-11-05T14:00:00Z' }))
    const setParams = vi.fn(() => true)
    render(<PrepEarningsBlock params={{ snapshot: gap() }} setParams={setParams} editable />)
    for (let i = 0; i < RETRY_MAX + 3; i += 1) await act(async () => { await vi.advanceTimersByTimeAsync(RETRY_MS) })
    expect(globalThis.fetch).toHaveBeenCalledTimes(RETRY_MAX)
    expect(setParams).not.toHaveBeenCalled()                           // a still-missing answer never lands
    expect(screen.getByRole('button', { name: 'Capture again' })).toBeTruthy()
    // Fix round 1 (review finding 7a): once nothing will fill it, the block never promises a fill.
    expect(screen.getByText(FINAL_WORDS.no_earnings_yet)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/fills in/)
  })

  it('a chain that crosses midnight (New York) stops: the next day\'s list never lands in yesterday\'s snapshot', async () => {
    vi.setSystemTime(new Date('2026-11-06T04:59:45Z'))                // 23:59:45 on Nov 5 in New York
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200,
      json: async () => ({ ...full(), capturedAt: new Date().toISOString() }) }))
    const setParams = vi.fn(() => true)
    render(<PrepEarningsBlock params={{ snapshot: gap({ capturedAt: '2026-11-06T04:50:00Z' }) }} setParams={setParams} editable />)
    expect(screen.getByText(FILLING_WORDS.no_earnings_yet)).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(RETRY_MS) })  // first read falls at 00:00:15 Nov 6
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(setParams).not.toHaveBeenCalled()
    expect(screen.getByText(FINAL_WORDS.no_earnings_yet)).toBeTruthy()
  })

  it('CONTROL: a snapshot from an earlier day is never refreshed (that note must not show today\'s data)', async () => {
    globalThis.fetch = answer(full())
    const old = gap({ capturedAt: '2026-11-04T13:55:00Z' })
    expect(fillsItself(old, NOW)).toBe(false)
    render(<PrepEarningsBlock params={{ snapshot: old }} setParams={vi.fn()} editable />)
    await act(async () => { await vi.advanceTimersByTimeAsync(RETRY_MS * 3) })
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Capture again' })).toBeTruthy()
    // Fix round 1 (review finding 7b): an earlier day's gap reads in the past tense, never "fills in".
    expect(screen.getByText(FINAL_WORDS.no_earnings_yet)).toBeTruthy()
  })

  it('CONTROL: a reader (not editable) reads nothing', async () => {
    globalThis.fetch = answer(full())
    render(<PrepEarningsBlock params={{ snapshot: gap() }} setParams={vi.fn()} editable={false} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(RETRY_MS * 3) })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('a gap that never fills (no names) is not retried', () => {
    expect(fillsItself(gap({ missing: 'no_names' }), NOW)).toBe(false)
    expect(fillsItself(gap(), NOW)).toBe(true)
  })
})
