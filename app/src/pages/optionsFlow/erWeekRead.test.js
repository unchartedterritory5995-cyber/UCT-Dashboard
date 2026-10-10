// TERM-033: the ER-badge look-ahead week read names its failure.
//
//     cd app && npx vitest run src/pages/optionsFlow/erWeekRead.test.js
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readErWeek, ER_WEEK_FAILED, isErWeekFailed } from './erWeekRead'

const res = (status, body, { badJson = false } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: badJson ? () => Promise.reject(new SyntaxError('bad')) : () => Promise.resolve(body),
})

afterEach(() => vi.restoreAllMocks())

describe('readErWeek', () => {
  it('asks for exactly the week it was given and resolves the payload', async () => {
    const payload = { days: { '2026-10-19': { bmo: [{ sym: 'NVDA' }] } } }
    const f = vi.fn(() => Promise.resolve(res(200, payload)))
    await expect(readErWeek('2026-10-19', f)).resolves.toBe(payload)
    expect(f).toHaveBeenCalledWith('/api/calendar?week=2026-10-19')
  })

  it('a week with no reporters is a payload, NOT a failure', async () => {
    const out = await readErWeek('2026-10-19', () => Promise.resolve(res(200, { days: {} })))
    expect(isErWeekFailed(out)).toBe(false)
    expect(out).toEqual({ days: {} })
  })

  it.each([
    ['a non-OK status', () => Promise.resolve(res(503, null)), 'HTTP 503'],
    ['a network error', () => Promise.reject(new Error('offline')), 'network: offline'],
    ['an unreadable body', () => Promise.resolve(res(200, null, { badJson: true })), 'unreadable body'],
    ['an empty body', () => Promise.resolve(res(200, null)), 'empty body'],
  ])('%s resolves the named sentinel and says why', async (_label, f, why) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = await readErWeek('2026-10-26', f)
    expect(out).toBe(ER_WEEK_FAILED)
    expect(isErWeekFailed(out)).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('2026-10-26')
    expect(warn.mock.calls[0][0]).toContain(why)
  })

  it('the sentinel is frozen, truthy and carries no days, so the page loop adds no badges for it', () => {
    expect(Object.isFrozen(ER_WEEK_FAILED)).toBe(true)
    expect(Boolean(ER_WEEK_FAILED)).toBe(true)
    // The page's own flatten reads `(p && p.days) || {}`
    const map = {}
    for (const [dateStr] of Object.entries((ER_WEEK_FAILED && ER_WEEK_FAILED.days) || {})) map[dateStr] = 1
    expect(map).toEqual({})
  })
})
