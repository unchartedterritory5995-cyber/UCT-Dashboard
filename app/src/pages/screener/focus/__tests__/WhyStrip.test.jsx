import { expect, test, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
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

// A ResizeObserver stand-in the test can fire.
const installRO = () => {
  const observers = []
  const prev = globalThis.ResizeObserver
  globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; this.els = [] } observe(el) { this.els.push(el); observers.push(this) } disconnect() { this.els = [] } }
  return { fire: () => observers.forEach(o => o.els.length && o.cb([])), count: () => observers.filter(o => o.els.length).length, restore: () => { globalThis.ResizeObserver = prev } }
}
test('1: a strip that mounts empty and gets items later is still re-measured on a resize', () => {
  const ro = installRO()
  let listW = 2000
  const cw = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () { return this.tagName === 'UL' ? listW : 0 })
  const ow = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () { return this.hasAttribute('data-why-item') ? 100 : 0 })
  restore = () => { cw.mockRestore(); ow.mockRestore(); ro.restore() }
  const { rerender } = render(<WhyStrip items={[]} more={0} onMore={() => {}} />)
  rerender(<WhyStrip items={five} more={0} onMore={() => {}} />)
  const list = () => screen.getByRole('list', { name: "Why it's here" })
  expect(list().querySelectorAll('[data-why-item]')).toHaveLength(5)
  expect(ro.count()).toBe(1)
  listW = 300
  act(() => { ro.fire() })
  expect(list().querySelectorAll('[data-why-item]')).toHaveLength(2)
  expect(screen.getByRole('button', { name: '+3 more' })).toBeInTheDocument()
})
test('2: a new `more` alone re-measures the fit', () => {
  restore = stubLayout(300, 100)
  const items = five
  const { rerender } = render(<WhyStrip items={items} more={0} onMore={() => {}} />)
  expect(screen.getByRole('button', { name: '+3 more' })).toBeInTheDocument()
  rerender(<WhyStrip items={items} more={4} onMore={() => {}} />)
  expect(screen.getByRole('button', { name: '+7 more' })).toBeInTheDocument()
  expect(screen.getByRole('list', { name: "Why it's here" }).querySelectorAll('[data-why-item]')).toHaveLength(2)
})
test('2: when `more` drops to 0 the room for the cue goes back to the items', () => {
  restore = stubLayout(330, 100)
  const three = five.slice(0, 3)
  const { rerender } = render(<WhyStrip items={three} more={2} onMore={() => {}} />)
  const list = () => screen.getByRole('list', { name: "Why it's here" })
  expect(list().querySelectorAll('[data-why-item]')).toHaveLength(2)
  expect(screen.getByRole('button', { name: '+3 more' })).toBeInTheDocument()
  rerender(<WhyStrip items={three} more={0} onMore={() => {}} />)
  expect(list().querySelectorAll('[data-why-item]')).toHaveLength(3)
  expect(screen.queryByRole('button', { name: /more/ })).toBeNull()
})
