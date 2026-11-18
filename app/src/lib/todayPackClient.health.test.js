// ⛔ A DEAD TODAY-PACK MUST BE VISIBLE (2026-11-11). Its failures used to be swallowed by
// `.catch(() => _pack)`: a 401 here would silently turn every daily switch into a network
// wait, the same shape as the D/W/M pack's eleven silent days behind a 401.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ensureTodayPack, todayPackHealth, __resetForTest } from './todayPackClient'

const PACK = { d: '2026-11-11', bars: { AAPL: [1, 2, 0.5, 1.5, 10] } }

beforeEach(() => { __resetForTest() })
afterEach(() => { __resetForTest(); vi.restoreAllMocks() })

describe('today-pack health', () => {
  it('a 401 is counted, its status kept, and warned about ONCE', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 401, json: async () => ({}) }))
    await ensureTodayPack()
    await ensureTodayPack()
    const h = todayPackHealth()
    expect(h.fail).toBe(2)
    expect(h.lastStatus).toBe(401)
    expect(h.usable).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/401/)
    expect(window.__uctTodayPack.health().fail).toBe(2)
  })

  it('a network error is counted without a status', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('offline')))
    await ensureTodayPack()
    expect(todayPackHealth()).toMatchObject({ fail: 1, lastStatus: null, lastError: 'offline' })
  })

  it('a good load is counted and makes the pack usable', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => PACK }))
    await ensureTodayPack()
    expect(todayPackHealth()).toMatchObject({ ok: 1, fail: 0, lastStatus: 200, usable: true })
  })
})
