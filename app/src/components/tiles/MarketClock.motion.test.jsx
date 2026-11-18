// The Morning Wire market clock's dot used to pulse forever (`clockPulse 2s infinite`), the same
// pattern that saturated the GPU process from the Charts clock (2026-11-10). Its live cue now rides
// the clock's own once-a-second render, and its stylesheet carries no endless animation.
import fs from 'node:fs'
import path from 'node:path'
import { render, act } from '@testing-library/react'
import { vi, test, expect, afterEach } from 'vitest'

vi.mock('../../hooks/useMarketOpen', () => ({
  default: () => ({ isOpen: true, isExtended: false }),
}))

import MarketClock from './MarketClock'

afterEach(() => { vi.useRealTimers() })

const css = fs.readFileSync(path.resolve(globalThis.process.cwd(), 'src/components/tiles/MarketClock.module.css'), 'utf8')
const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')

test('the dot flips its beat with the seconds', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-10T15:00:00Z'))
  const { container } = render(<MarketClock />)
  const before = container.querySelector('[data-beat]').getAttribute('data-beat')
  act(() => { vi.advanceTimersByTime(1000) })
  expect(container.querySelector('[data-beat]').getAttribute('data-beat')).not.toBe(before)
})

test('the stylesheet runs no endless animation', () => {
  expect(clean).not.toMatch(/animation[^;{}]*infinite/)
})
