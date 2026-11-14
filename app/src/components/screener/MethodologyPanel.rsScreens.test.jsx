// MethodologyPanel and the RS screens' own page (unit U6, 2026-11-14). The server serves
// `rs_screens` beside the column methods while RS_SCREENS_ENABLED is on; until U6 nothing drew
// it, so the door "How the RS screens work" opened on a column card instead of the page written
// for it. The document below is the SERVER'S (tests/fixtures/rs_screens_served.json, pinned by
// tests/test_rs_screens_u6_golden.py against methodology.all_methods), never a typed copy.
import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import MethodologyPanel from './MethodologyPanel'
import { SERVED, RS_STARTERS } from '../../pages/screener/focus/__tests__/rsScreensFixture'

const DOC = SERVED.method
const card = (column, label) => ({ column, label, one_line: 'one line', scale: 'scale', how: 'how', caveat: 'caveat' })
const METHODS = [card('uct_composite', 'UCT Composite'), card('rs_rating_pos', 'RS Rating place')]
const fetchOf = body => vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(body) }))
const page = () => screen.getByTestId('rs-screens-method')

let scrolled
const real = Element.prototype.scrollIntoView
beforeEach(() => { scrolled = []; Element.prototype.scrollIntoView = function scrollIntoView(opts) { scrolled.push([this, opts]) } })
afterEach(() => { Element.prototype.scrollIntoView = real })

test('the served page is the shape this panel draws', () => {
  // If the server renames a key, this says which, before a member sees a page with a hole in it.
  expect(Object.keys(DOC).sort()).toEqual(['floor', 'honesty', 'label', 'rating_note', 'ratings_as_of', 'screens', 'setup'])
  for (const s of DOC.screens) expect(Object.keys(s).sort()).toEqual(['caveat', 'controls', 'id', 'name', 'rule'])
  expect(Object.keys(DOC.setup).sort()).toEqual(['atr', 'blank', 'flags', 'labels', 'near', 'order', 'tight'])
  for (const x of DOC.setup.labels) expect(Object.keys(x).sort()).toEqual(['key', 'label', 'rule', 'source'])
  for (const x of DOC.setup.flags) expect(Object.keys(x).sort()).toEqual(['key', 'label', 'rule'])
  // the page describes exactly the five screens the picker lists, by the same names
  expect(DOC.screens.map(s => [s.id, s.name])).toEqual(RS_STARTERS.map(s => [s.id, s.name]))
})

test('every sentence the server wrote is on the page, verbatim', async () => {
  render(<MethodologyPanel fetcher={fetchOf({ methods: METHODS, rs_screens: DOC })} />)
  await waitFor(() => expect(page()).toBeInTheDocument())
  const p = within(page())
  expect(p.getByRole('heading', { level: 3, name: DOC.label })).toBeInTheDocument()
  expect(p.getByText(DOC.floor)).toBeInTheDocument()
  for (const s of DOC.screens) {
    expect(p.getByRole('heading', { level: 4, name: s.name })).toBeInTheDocument()
    expect(p.getByText(s.rule)).toBeInTheDocument()
    expect(p.getByText(s.controls)).toBeInTheDocument()
    expect(page().textContent).toContain(s.caveat)
  }
  for (const x of [...DOC.setup.labels, DOC.setup.tight, ...DOC.setup.flags]) {
    expect(p.getByText(x.label, { selector: 'dt' })).toBeInTheDocument()
    expect(page().textContent).toContain(x.rule)
    if (x.source) expect(page().textContent).toContain(x.source)
  }
  for (const words of [DOC.setup.order, DOC.setup.atr, DOC.setup.near, DOC.setup.blank, DOC.ratings_as_of, DOC.rating_note]) {
    expect(p.getByText(words)).toBeInTheDocument()
  }
  expect(page().textContent).toContain(DOC.honesty)
  // the column cards are still there, above it
  expect(screen.getByText('UCT Composite')).toBeInTheDocument()
  expect(scrolled).toEqual([])
})

test('a payload without the page (the flag is off) draws exactly what it drew before', async () => {
  const { container } = render(<MethodologyPanel fetcher={fetchOf({ methods: METHODS })} focusSection="rs_screens" />)
  await waitFor(() => expect(screen.getByText('RS Rating place')).toBeInTheDocument())
  expect(screen.queryByTestId('rs-screens-method')).toBeNull()
  expect(container.querySelector('section')).toBeNull()
  expect(scrolled).toEqual([])
})

test('"How the RS screens work" opens AT the page; without one it falls back to the first RS column card', async () => {
  const { unmount } = render(<MethodologyPanel fetcher={fetchOf({ methods: METHODS, rs_screens: DOC })} focusSection="rs_screens" focusColumns={['rs_rating_pos']} />)
  await waitFor(() => expect(scrolled).toHaveLength(1))
  expect(scrolled[0][0]).toBe(page())
  expect(scrolled[0][1]).toEqual({ block: 'start' })
  unmount()
  scrolled = []
  render(<MethodologyPanel fetcher={fetchOf({ methods: METHODS })} focusSection="rs_screens" focusColumns={['rs_rating_pos']} />)
  await waitFor(() => expect(scrolled).toHaveLength(1))
  expect(scrolled[0][0].textContent).toMatch(/^RS Rating place/)
})

test('a part the payload does not carry is left out, never a heading over nothing', async () => {
  const partial = { label: DOC.label, screens: [DOC.screens[0], { id: 'x', name: 'No rule' }], setup: { labels: [], flags: [] } }
  render(<MethodologyPanel fetcher={fetchOf({ methods: METHODS, rs_screens: partial })} />)
  await waitFor(() => expect(page()).toBeInTheDocument())
  const heads = within(page()).getAllByRole('heading', { level: 4 }).map(h => h.textContent)
  expect(heads).toEqual([DOC.screens[0].name])
  expect(page().querySelector('dl')).toBeNull()
  // and something that is not the document at all draws nothing
  const { container } = render(<MethodologyPanel fetcher={fetchOf({ methods: METHODS, rs_screens: 'soon' })} />)
  await waitFor(() => expect(within(container).getByText('RS Rating place')).toBeInTheDocument())
  expect(within(container).queryByTestId('rs-screens-method')).toBeNull()
})
