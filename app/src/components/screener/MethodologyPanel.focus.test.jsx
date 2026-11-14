// MethodologyPanel `focusColumns` (RS screens, unit U5): the Focus screener's "How the RS screens
// work" opens the panel AT a section. Without the prop the panel is what it was: it never scrolls.
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import MethodologyPanel from './MethodologyPanel'

const card = (column, label) => ({ column, label, one_line: 'one line', scale: 'scale', how: 'how', caveat: 'caveat' })
const METHODS = [card('uct_composite', 'UCT Composite'), card('rs_rank', 'RS Rank'), card('rs_rating_session', 'Ratings as of'), card('rs_rating_pos', 'RS Rating place')]
const okFetch = () => vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ methods: METHODS }) }))

let scrolled
const real = Element.prototype.scrollIntoView
beforeEach(() => { scrolled = []; Element.prototype.scrollIntoView = function scrollIntoView(opts) { scrolled.push([this.textContent, opts]) } })
afterEach(() => { Element.prototype.scrollIntoView = real })

test('without focusColumns the panel never scrolls', async () => {
  const { container } = render(<MethodologyPanel fetcher={okFetch()} />)
  await waitFor(() => expect(screen.getByText('RS Rating place')).toBeInTheDocument())
  expect(scrolled).toEqual([])
  // and the list markup carries nothing new
  expect([...container.querySelectorAll('li')].every(li => li.attributes.length === 0)).toBe(true)
})

test('with focusColumns the first matching card, in the document\'s own order, is brought to the top', async () => {
  render(<MethodologyPanel fetcher={okFetch()} focusColumns={['rs_rating_pos', 'rs_rating_session']} />)
  await waitFor(() => expect(scrolled).toHaveLength(1))
  expect(scrolled[0][0]).toMatch(/^Ratings as of/)
  expect(scrolled[0][1]).toEqual({ block: 'start' })
})

test('no card matches: the panel opens at the top', async () => {
  render(<MethodologyPanel fetcher={okFetch()} focusColumns={['rs_setup']} />)
  await waitFor(() => expect(screen.getByText('RS Rating place')).toBeInTheDocument())
  expect(scrolled).toEqual([])
})

test('a re-render with the same columns does not scroll again', async () => {
  const fetcher = okFetch()
  const { rerender } = render(<MethodologyPanel fetcher={fetcher} focusColumns={['rs_rating_pos']} />)
  await waitFor(() => expect(scrolled).toHaveLength(1))
  rerender(<MethodologyPanel fetcher={fetcher} focusColumns={['rs_rating_pos']} />)
  expect(scrolled).toHaveLength(1)
  expect(scrolled[0][0]).toMatch(/^RS Rating place/)
})

test('a browser without scrollIntoView still renders the panel', async () => {
  Element.prototype.scrollIntoView = undefined
  render(<MethodologyPanel fetcher={okFetch()} focusColumns={['rs_rating_pos']} />)
  await waitFor(() => expect(screen.getByText('RS Rating place')).toBeInTheDocument())
})
