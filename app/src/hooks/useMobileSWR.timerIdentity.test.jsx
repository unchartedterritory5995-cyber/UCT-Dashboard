// useMobileSWR on a touch device doubles a function interval by wrapping it. SWR restarts its polling
// timer whenever the interval's identity changes, and this hook re-renders every 60 s (useMarketOpen).
// A wrapper rebuilt on each render therefore restarted any timer longer than 60 s forever, so it
// never fired. The wrapper must be stable, and the hook must add no commits of its own.
import { Profiler } from 'react'
import { render } from '@testing-library/react'
import { vi, beforeEach, afterEach, describe, test, expect } from 'vitest'

const seen = []
vi.mock('swr', () => ({ default: (_k, _f, opts) => { seen.push(opts); return {} } }))
vi.mock('./useMarketOpen', () => ({ default: () => ({ isOpen: false, isPremarket: false, isExtended: false }) }))

async function load({ touch }) {
  vi.resetModules()
  if (touch) window.ontouchstart = null
  else delete window.ontouchstart
  return (await import('./useMobileSWR')).default
}

beforeEach(() => { seen.length = 0 })
afterEach(() => { delete window.ontouchstart })

const stableInterval = vi.fn((d, scale = 1) => 100_000 / scale)

function harness(useMobileSWR, options) {
  return function Probe() {
    useMobileSWR('/x', null, options)
    return null
  }
}

describe('useMobileSWR on a touch device', () => {
  test('a stable function interval keeps one identity across renders', async () => {
    const useMobileSWR = await load({ touch: true })
    const Probe = harness(useMobileSWR, { refreshInterval: stableInterval })
    const { rerender } = render(<Probe />)
    rerender(<Probe />)
    rerender(<Probe />)
    expect(seen.length).toBe(3)
    expect(seen[1].refreshInterval).toBe(seen[0].refreshInterval)
    expect(seen[2].refreshInterval).toBe(seen[0].refreshInterval)
  })

  test('it doubles what the function returns and tells the function the factor', async () => {
    const useMobileSWR = await load({ touch: true })
    render(((P) => <P />)(harness(useMobileSWR, { refreshInterval: stableInterval })))
    expect(seen[0].refreshInterval({ a: 1 })).toBe(100_000)
    expect(stableInterval).toHaveBeenLastCalledWith({ a: 1 }, 2)
  })

  test('a numeric interval is still doubled', async () => {
    const useMobileSWR = await load({ touch: true })
    render(((P) => <P />)(harness(useMobileSWR, { refreshInterval: 30_000 })))
    expect(seen[0].refreshInterval).toBe(60_000)
  })

  test('mounting commits once: the memo adds no state and no follow-up render', async () => {
    const useMobileSWR = await load({ touch: true })
    const Probe = harness(useMobileSWR, { refreshInterval: stableInterval })
    const commits = []
    render(<Profiler id="p" onRender={(_id, phase) => commits.push(phase)}><Probe /></Profiler>)
    expect(commits).toEqual(['mount'])
  })
})

describe('useMobileSWR off touch', () => {
  test('the caller function is handed straight to SWR, as before', async () => {
    const useMobileSWR = await load({ touch: false })
    render(((P) => <P />)(harness(useMobileSWR, { refreshInterval: stableInterval })))
    expect(seen[0].refreshInterval).toBe(stableInterval)
  })
})
