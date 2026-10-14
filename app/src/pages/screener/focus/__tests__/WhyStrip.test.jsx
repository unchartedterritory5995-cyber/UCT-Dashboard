import { expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import WhyStrip from '../WhyStrip'

test('a note with a missing value shows the open circle, never a tick', () => {
  render(<WhyStrip more={0} items={[{ kind: 'note', label: 'RS Rank ≥ 80', value: '—' }, { kind: 'check', label: 'Price ≥ 10', value: '956' }]} />)
  const li = screen.getByRole('list', { name: "Why it's here" }).querySelectorAll('li')
  expect(li[0]).toHaveTextContent('○')
  expect(li[0]).not.toHaveTextContent('✓')
  expect(li[0]).not.toHaveTextContent('Passes')
  expect(li[1]).toHaveTextContent('✓')
  expect(li[1]).toHaveTextContent('Passes')
})
