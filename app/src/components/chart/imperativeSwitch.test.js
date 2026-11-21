// The imperative switch's rollback switch (chart/imperativeSwitch.js): default OFF, '1' on, the server's
// chart-speed kill wins, read once per page load.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const KEY = 'uct.imperativeSwitch'
const load = async () => {
  vi.resetModules()
  return import('./imperativeSwitch')
}
const GONE = 'expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
const clearCookie = () => { document.cookie = `uct_chart_speed=; ${GONE}` }
const setCookie = (v) => { document.cookie = `uct_chart_speed=${v}; path=/` }

beforeEach(() => { localStorage.removeItem(KEY); clearCookie() })
afterEach(() => { localStorage.removeItem(KEY); clearCookie() })

describe('imperativeSwitchOn', () => {
  it('the key is the one the design names', async () => {
    expect((await load()).IMPERATIVE_SWITCH_KEY).toBe(KEY)
  })

  it('is OFF by default (nothing stored)', async () => {
    expect((await load()).imperativeSwitchOn()).toBe(false)
  })

  it.each([['1', true], ['0', false], ['true', false], ['', false], ['on', false]])('stored %j reads %j', async (stored, on) => {
    localStorage.setItem(KEY, stored)
    expect((await load()).imperativeSwitchOn()).toBe(on)
  })

  it('the server\'s chart-speed kill wins over a local 1', async () => {
    localStorage.setItem(KEY, '1')
    setCookie('0')
    expect(document.cookie).toContain('uct_chart_speed=0')   // the jar really holds it
    expect((await load()).imperativeSwitchOn()).toBe(false)
  })

  it('a chart-speed cookie that is not the kill leaves a local 1 on', async () => {
    localStorage.setItem(KEY, '1')
    setCookie('1')
    expect((await load()).imperativeSwitchOn()).toBe(true)
  })

  it('is read ONCE per page load: a later write changes nothing until the next load', async () => {
    const m = await load()
    expect(m.imperativeSwitchOn()).toBe(false)
    localStorage.setItem(KEY, '1')
    expect(m.imperativeSwitchOn()).toBe(false)
    expect((await load()).imperativeSwitchOn()).toBe(true)
  })

  it('an unreadable store is OFF, never a throw', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    try { expect((await load()).imperativeSwitchOn()).toBe(false) } finally { spy.mockRestore() }
  })
})
