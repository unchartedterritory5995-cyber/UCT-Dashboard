/* FuturesStrip polls through useMobileSWR, and the RATE is what proves it.
 *
 * ⛔ A test that asserted "the file imports useMobileSWR" would pass on a file
 * that imported it and never called it. This counts the /api/snapshot requests
 * the tile actually issues over a fixed window, on the two client shapes where
 * the hooks differ — so reverting to bare `useSWR` goes RED on a number.
 *
 * ⚠️ AND ONE THING THIS FILE DELIBERATELY DOES NOT CLAIM: bare `useSWR` already
 * skipped its poll on a hidden tab (SWR's `refreshWhenHidden` defaults to false),
 * so "no requests while hidden" is TRUE OF BOTH HOOKS and asserting it here
 * would be a gate that cannot fail. The measured difference is the mobile
 * interval, and that is what is asserted.
 */
import { render, cleanup, act } from '@testing-library/react'
import { vi, test, expect, beforeEach, afterEach } from 'vitest'

vi.mock('../../utils/prefetchBars', () => ({
  prefetchAllTimeframes: vi.fn(), prefetchBars: vi.fn(),
  prefetchBar: vi.fn(), default: vi.fn(),
}))
vi.mock('../StockChart', () => ({ default: () => <div /> }))

const WINDOW_MS = 60_000
const INTERVAL_MS = 10_000
let calls = 0

beforeEach(() => {
  calls = 0
  global.fetch = vi.fn((url) => {
    if (String(url).includes('/api/snapshot')) calls += 1
    return Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ futures: {}, etfs: {} }),
    })
  })
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => { vi.useRealTimers(); cleanup() })

/** `isMobile` inside useMobileSWR is evaluated at MODULE LOAD, so the client
 *  shape has to be set before the import — hence resetModules + dynamic import. */
async function pollsIn60s({ touch }) {
  vi.resetModules()
  if (touch) window.ontouchstart = null
  else delete window.ontouchstart
  const { default: FuturesStrip } = await import('./FuturesStrip')
  calls = 0
  render(<FuturesStrip />)
  await act(async () => { await Promise.resolve() })
  await act(async () => { await vi.advanceTimersByTimeAsync(WINDOW_MS) })
  const n = calls
  cleanup()
  return n
}

test('a TOUCH client polls /api/snapshot at HALF the desktop rate', async () => {
  const desktop = await pollsIn60s({ touch: false })
  const touch = await pollsIn60s({ touch: true })

  // The control first: the desktop arm must actually be polling, or "half of
  // it" is half of nothing and the assertion below proves nothing.
  expect(desktop).toBeGreaterThanOrEqual(WINDOW_MS / INTERVAL_MS)

  // …and the touch arm runs on the doubled interval useMobileSWR applies.
  // Bare `useSWR` cannot produce this — it has one interval for every client.
  expect(touch).toBeLessThanOrEqual(Math.ceil(desktop / 2) + 1)
  expect(touch).toBeGreaterThan(0)
})
