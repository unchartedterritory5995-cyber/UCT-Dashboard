// Study — the nine-rung ring (D17): nine segments grouped 3-3-3, 2px stroke,
// gold for a lit rung, the count read off the rendered attribute.
import { render } from '@testing-library/react'
import { test, expect } from 'vitest'
import ProgressRing, { rungAngles } from './ProgressRing'

const LIT = /(^|_)lit(_|$)/
const UNLIT = /(^|_)unlit(_|$)/

test('draws nine segments and lights exactly `done` of them, gold first', () => {
  const { container } = render(<ProgressRing size={56} done={4} />)
  const paths = container.querySelectorAll('path')
  expect(paths).toHaveLength(9)
  const lit = [...paths].filter((p) => LIT.test(p.getAttribute('class') || ''))
  const unlit = [...paths].filter((p) => UNLIT.test(p.getAttribute('class') || ''))
  expect(lit).toHaveLength(4)
  expect(unlit).toHaveLength(5)
  // the lit rungs are the FIRST four — progress fills clockwise from the top
  expect([...paths].slice(0, 4).every((p) => LIT.test(p.getAttribute('class')))).toBe(true)
  expect(paths[0].getAttribute('stroke-width')).toBe('2')
})

test('is an image named by its rung count, and the count is clamped to 0..9', () => {
  const { getByRole, rerender } = render(<ProgressRing done={3} />)
  expect(getByRole('img', { name: '3 of 9 rungs' })).toBeTruthy()
  expect(getByRole('img').getAttribute('data-rungs')).toBe('3')
  rerender(<ProgressRing done={14} />)
  expect(getByRole('img', { name: '9 of 9 rungs' })).toBeTruthy()
  rerender(<ProgressRing done={-2} />)
  expect(getByRole('img', { name: '0 of 9 rungs' })).toBeTruthy()
  rerender(<ProgressRing done={undefined} />)
  expect(getByRole('img', { name: '0 of 9 rungs' })).toBeTruthy()
})

test('the segments are grouped 3-3-3: the gap after rungs 3 and 6 is wider than inside a level', () => {
  const a = rungAngles()
  expect(a).toHaveLength(9)
  const gap = (i) => Number((a[i + 1][0] - a[i][1]).toFixed(6))
  const inside = [gap(0), gap(1), gap(3), gap(4), gap(6), gap(7)]
  const between = [gap(2), gap(5)]
  expect(new Set(inside).size).toBe(1)
  expect(between.every((g) => g > inside[0])).toBe(true)
  // closes the circle: the last rung ends one level-gap short of 360
  expect(a[8][1] + between[0]).toBeCloseTo(360, 6)
})

test('sizes to the caller (24 / 40 / 56) and renders children in the centre', () => {
  const { getByRole, getByText } = render(<ProgressRing size={24} done={1}>x</ProgressRing>)
  const ring = getByRole('img')
  expect(ring.style.width).toBe('24px')
  expect(ring.querySelector('svg').getAttribute('viewBox')).toBe('0 0 24 24')
  expect(getByText('x')).toBeTruthy()
})
