// A switch-abort is not a failure (2026-10-10): a pane whose fetch the member scanned past
// must be asked again at once, not held blank behind the 2 s+ error backoff.
import { describe, it, expect, beforeEach } from 'vitest'
import { SOURCE_STATUS, clearSecondaryBars, fetchSecondaryBars, ensureSecondaryBars } from '../secondaryBars'

describe('secondary bars · switch-abort', () => {
  beforeEach(() => clearSecondaryBars())

  it('a canceled fetch arms no backoff and the next ensure fetches again', async () => {
    const calls = []
    const canceling = (url) => {
      calls.push(url)
      const e = new Error('switch-aborted'); e.canceled = true
      return Promise.reject(e)
    }
    const entry = await fetchSecondaryBars('NYSE:NH', 'D', 400, canceling)
    expect(entry.status).toBe(SOURCE_STATUS.LOADING)
    const ok = (url) => { calls.push(url); return Promise.resolve({ bars: [{ t: '2026-10-09', o: 1, h: 1, l: 1, c: 1 }] }) }
    ensureSecondaryBars("NYSE:NH", "D", 400, ok)
    await Promise.resolve(); await Promise.resolve()
    expect(calls.length).toBe(2)                      // asked again immediately
  })
})
