// The chart header's market clock is in EVERY chart widget, popped out or not. Its dot used to pulse
// with `animation: clockPulse 2.4s infinite`, which made every window produce a compositor frame at
// the display rate forever: with 12 popped widgets the GPU process spent 78% of its main thread in
// Present and held every window to 9-16 fps (desktop trace, 2026-11-10). Killing only that animation
// took 12 widgets from p95 34 ms / p99 84 ms to 17 / 18 ms.
//
// Two rails: the dot's live cue rides the clock's own once-a-second render (data-beat), and the
// stylesheet carries no endless animation on the dot.
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, act } from '@testing-library/react'
import { vi, test, expect, afterEach } from 'vitest'

vi.mock('../../../hooks/useMarketOpen', () => ({
  default: () => ({ isOpen: true, isExtended: false }),
}))

import ChartMarketClock from './ChartMarketClock'

afterEach(() => { vi.useRealTimers() })

const css = fs.readFileSync(path.resolve(globalThis.process.cwd(), 'src/pages/charts/ChartsWorkspace.module.css'), 'utf8')

// Every declaration block whose selector list mentions `cls` (comments stripped first).
function blocksFor(source, cls) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(clean))) {
    if (m[1].split(',').some((sel) => sel.includes(cls))) out.push({ selector: m[1].trim(), body: m[2] })
  }
  return out
}

test('the dot flips its beat with the seconds, on the render the time already causes', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-10T15:00:00Z'))
  const { container } = render(<ChartMarketClock />)
  screen.getByRole('timer')
  const dot = container.querySelector('[data-beat]')
  expect(dot).not.toBeNull()
  const first = dot.getAttribute('data-beat')
  act(() => { vi.advanceTimersByTime(1000) })
  const second = container.querySelector('[data-beat]').getAttribute('data-beat')
  act(() => { vi.advanceTimersByTime(1000) })
  const third = container.querySelector('[data-beat]').getAttribute('data-beat')
  expect(new Set([first, second, third])).toEqual(new Set(['0', '1']))
  expect(second).not.toBe(first)
  expect(third).toBe(first)
})

test('no rule for the clock dot runs an endless animation', () => {
  const blocks = blocksFor(css, 'clockDot')
  expect(blocks.length).toBeGreaterThan(0)
  for (const b of blocks) {
    expect(b.body, `${b.selector} must not animate forever`).not.toMatch(/animation[^;]*infinite/)
    expect(b.body, `${b.selector} must not animate at all`).not.toMatch(/animation\s*:/)
  }
})

test('the beat is a stepped change: no transition on the dot', () => {
  for (const b of blocksFor(css, 'clockDot')) {
    expect(b.body, `${b.selector}`).not.toMatch(/transition\s*:/)
  }
})
