import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createServerGap, GAP_WINDOW_MS, POLL_MS, GIVE_UP_MS } from './serverGap'
import ServerUpdatingBanner from '../components/ServerUpdatingBanner'

function harness(health) {
  let t = 0
  const timers = []
  const onBack = vi.fn()
  const gap = createServerGap({
    now: () => t,
    setTimer: (fn, ms) => timers.push({ fn, at: t + ms }),
    checkHealth: () => Promise.resolve(health()),
    onBack,
  })
  const run = async (ms) => {
    t += ms
    for (;;) {
      const i = timers.findIndex((x) => x.at <= t)
      if (i < 0) break
      const [x] = timers.splice(i, 1)
      await x.fn()
    }
  }
  return { gap, onBack, run, advance: (ms) => { t += ms } }
}

describe('the deploy gap is said once, and the page refills when the new pod answers', () => {
  it('two gateway errors within the window mean "updating"; one, or a 503/401, does not', () => {
    const h = harness(() => false)
    h.gap.report(502)
    expect(h.gap.getState()).toBe('ok')
    h.gap.report(503); h.gap.report(401); h.gap.report(undefined)
    expect(h.gap.getState()).toBe('ok')
    h.advance(GAP_WINDOW_MS + 1)
    h.gap.report(504)
    expect(h.gap.getState()).toBe('ok')     // the first 502 aged out
    h.gap.report(502)
    expect(h.gap.getState()).toBe('updating')
  })

  it('polls health, and on the first answer clears and revalidates everything, once', async () => {
    let up = false
    const h = harness(() => up)
    h.gap.report(502); h.gap.report(502)
    await h.run(POLL_MS)
    expect(h.gap.getState()).toBe('updating')
    expect(h.onBack).not.toHaveBeenCalled()
    up = true
    await h.run(POLL_MS)
    expect(h.gap.getState()).toBe('ok')
    expect(h.onBack).toHaveBeenCalledTimes(1)
  })

  it('gives up after the limit rather than showing the banner forever', async () => {
    const h = harness(() => false)
    h.gap.report(502); h.gap.report(502)
    for (let i = 0; i < GIVE_UP_MS / POLL_MS + 2; i++) await h.run(POLL_MS)
    expect(h.gap.getState()).toBe('ok')
    expect(h.onBack).not.toHaveBeenCalled()
  })

  it('the banner shows only while updating', () => {
    const h = harness(() => false)
    const { rerender } = render(<ServerUpdatingBanner gap={h.gap} />)
    expect(screen.queryByRole('status')).toBeNull()
    h.gap.report(502); h.gap.report(502)
    rerender(<ServerUpdatingBanner gap={h.gap} />)
    expect(screen.getByRole('status').textContent).toMatch(/Updating UCT/)
  })

  it('App wires every SWR error into the detector and revalidates all keys when the pod is back', async () => {
    const src = (await import('node:fs')).readFileSync((await import('node:path')).resolve(globalThis.process.cwd(), 'src/App.jsx'), 'utf8')
    expect(src).toMatch(/onError: \(err\) => appServerGap\(\)\.report\(err\?\.status\)/)
    expect(src).toMatch(/appServerGap\(\(\) => \{ swrMutateAll\(\(\) => true\) \}\)/)
    expect(src).toMatch(/<ServerUpdatingBanner \/>/)
  })
})
