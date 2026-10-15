import { expect, test, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

// jsdom lays nothing out: give the list a width and each item a width, as a browser would.
const stubLayout = (listW, itemW) => {
  const cw = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () { return this.tagName === 'UL' ? listW : 0 })
  const ow = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () { return this.hasAttribute('data-why-item') ? itemW : 0 })
  return () => { cw.mockRestore(); ow.mockRestore() }
}
let restore = null
afterEach(() => { restore?.(); restore = null })
const five = Array.from({ length: 5 }, (_, i) => ({ kind: 'check', label: `Rule ${i + 1}`, value: String(i) }))
test('1: items that do not fit on one line are counted into "+N more", which opens the full list', () => {
  restore = stubLayout(300, 100)
  const onMore = vi.fn()
  render(<WhyStrip items={five} more={0} onMore={onMore} />)
  const list = screen.getByRole('list', { name: "Why it's here" })
  expect(list.querySelectorAll('[data-why-item]')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: '+3 more' }))
  expect(onMore).toHaveBeenCalled()
})
test('1: the hidden count adds to the strip\'s own "more"', () => {
  restore = stubLayout(300, 100)
  render(<WhyStrip items={five} more={2} onMore={() => {}} />)
  expect(screen.getByRole('button', { name: '+5 more' })).toBeInTheDocument()
})
test('1: everything fits: no cue', () => {
  restore = stubLayout(2000, 100)
  render(<WhyStrip items={five} more={0} />)
  expect(screen.getByRole('list', { name: "Why it's here" }).querySelectorAll('[data-why-item]')).toHaveLength(5)
  expect(screen.queryByRole('button', { name: /more/ })).toBeNull()
})
test('1: every item is a no-wrap, no-shrink unit', () => {
  render(<WhyStrip items={five} more={0} />)
  for (const li of screen.getByRole('list', { name: "Why it's here" }).querySelectorAll('[data-why-item]')) expect(li.className).toMatch(/whyItem/)
})
