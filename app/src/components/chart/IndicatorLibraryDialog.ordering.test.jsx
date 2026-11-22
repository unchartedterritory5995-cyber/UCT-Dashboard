// app/src/components/chart/IndicatorLibraryDialog.ordering.test.jsx
//
// ─── THE LIBRARY RANKS INDICATORS FIRST, AND THE KEYBOARD CAN WALK IT (2026-11-08) ──
//
// ⚰️ MEASURED ON THE REAL SCREEN: typing "rsi" listed about a dozen DELISTED
// companies whose names contain the letters (Mattersight, Tarsier, …) ABOVE the
// indicators, because "RSI" is also a ticker and the exact-ticker hoist lifted the
// whole Symbols group over Momentum. The RSI row and the UCT Relative Strength
// signpost ended up at the bottom. The rows also had no visible focus ring, ↓ did
// not leave the search box, and the first Enter was sometimes lost while the late
// symbol reply re-laid the list out.
//
// What these cases hold:
//   1. indicator sections, then the hint row, then the symbol sections;
//   2. a delisted security is not offered at all (the data carries the flag);
//   3. with NO indicator match the exact-ticker hoist still leads (`QQQ`);
//   4. the late symbol reply does not move a focused indicator row;
//   5. ↓ / ↑ / Home / End walk the results, and ↑ from the first returns to the box;
//   6. Enter adds exactly once, a held (repeating) Enter adds nothing more;
//   7. the row's focus ring is the app's own, declared in the stylesheet.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import IndicatorLibraryDialog, { namesRow } from './IndicatorLibraryDialog'
import { mergeChartSettings } from './chartDefaults'
import * as engineRegistry from './engine/nativeRegistry'
import { isDelistedResult, securityResults } from './discoveryCatalog'
import { TECH_CATEGORY } from './technicalCategories'

const base = () => mergeChartSettings(null)

const RSI_TICKER = { ticker: 'RSI', name: 'Rush Street Interactive', type: 'stock', exchange: 'NYSE' }
const LIVE_NAME_MATCH = { ticker: 'XRSI', name: 'Xrsi Holdings', type: 'stock', exchange: 'NASDAQ' }
const DELISTED = [
  { ticker: 'MATR', name: 'Mattersight Corp', type: 'delisted', delisted: true, delisted_date: '2018-09-28' },
  { ticker: 'TARS', name: 'Tarsier Ltd', type: 'delisted', delisted: true },
]
const QQQ = { ticker: 'QQQ', name: 'Invesco QQQ Trust', type: 'etf', exchange: 'NASDAQ' }

/** A fetch whose ticker-search reply is handed back by the test, so the "late
 *  reply" can be timed against a focused row. Every other URL is a 404. */
function stubFetch(resultsFor) {
  const pending = []
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    if (u.startsWith('/api/ticker-search')) {
      const q = decodeURIComponent((u.match(/[?&]q=([^&]*)/) || [])[1] || '')
      return new Promise((resolve) => {
        const answer = () => resolve({ ok: true, status: 200, json: async () => ({ results: resultsFor(q) }) })
        pending.push(answer)
      })
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
  }))
  return {
    /** Answer every ticker-search request asked so far. */
    flush: () => { while (pending.length) pending.shift()() },
    asked: () => pending.length,
  }
}

function open(settings = base()) {
  const onChange = vi.fn()
  const utils = render(<IndicatorLibraryDialog open onClose={() => {}} settings={settings}
                                               onChange={onChange} registry={engineRegistry} />)
  return { onChange, ...utils }
}
const box = () => screen.getByRole('searchbox')
const type = (v) => fireEvent.change(box(), { target: { value: v } })
const headings = () => [...document.body.querySelectorAll('section > h3')].map((h) => h.textContent)
const sectionOf = (title) => [...document.body.querySelectorAll('section')]
  .find((s) => s.querySelector('h3')?.textContent === title) || null
const navItems = () => [...document.body.querySelectorAll('[data-library-nav="true"]')]
const primaryIn = (defId) => document.body.querySelector(`li[data-def-id="${defId}"] [data-result-primary="true"]`)
const hint = () => screen.queryByTestId('library-search-hint')

/** Let the 150 ms debounce fire, then answer the request it made. */
async function answerSearch(net) {
  await waitFor(() => expect(net.asked(), 'the symbol search never asked the server').toBeGreaterThan(0))
  await act(async () => { net.flush() })
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('"rsi": the indicators and the hint come first, symbols after', () => {
  it('orders Momentum (RSI) → hint → Symbols, and the ticker RSI is still offered', async () => {
    const net = stubFetch(() => [RSI_TICKER, ...DELISTED, LIVE_NAME_MATCH])
    open()
    type('rsi')
    await answerSearch(net)
    await waitFor(() => expect(sectionOf('Symbols'), 'the symbol results never arrived').toBeTruthy())

    const hs = headings()
    const sym = hs.indexOf('Symbols')
    const mom = hs.indexOf(TECH_CATEGORY.MOMENTUM)
    expect(mom, `no Momentum section for "rsi": ${hs.join(' | ')}`).toBeGreaterThanOrEqual(0)
    expect(mom, `Symbols is above Momentum again: ${hs.join(' | ')}`).toBeLessThan(sym)
    // every heading before Symbols is an indicator heading — nothing discovered leads
    expect(sym, `Symbols is not the last heading: ${hs.join(' | ')}`).toBe(hs.length - 1)

    // the hint row (the shipped RS signpost) sits under the indicators and above the symbols
    expect(hint(), 'the RS search hint is gone for "rsi"').toBeTruthy()
    const rsiRow = document.body.querySelector('li[data-def-id="rsi"]')
    expect(rsiRow.compareDocumentPosition(hint()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(hint().compareDocumentPosition(sectionOf('Symbols')) & Node.DOCUMENT_POSITION_FOLLOWING,
      'the hint row is below the symbol results').toBeTruthy()

    // the exact ticker is still the first symbol row; the name match comes after it
    const symIds = [...sectionOf('Symbols').querySelectorAll('li')].map((li) => li.dataset.defId)
    expect(symIds).toEqual(['RSI', 'XRSI'])
  })

  it('offers no delisted security at all', async () => {
    const net = stubFetch(() => [RSI_TICKER, ...DELISTED, LIVE_NAME_MATCH])
    open()
    type('rsi')
    await answerSearch(net)
    await waitFor(() => expect(sectionOf('Symbols')).toBeTruthy())
    for (const d of DELISTED) {
      expect(document.body.querySelector(`li[data-def-id="${d.ticker}"]`),
        `${d.name} is offered in the indicator library — clicking it does nothing`).toBeNull()
    }
    expect(document.body.textContent).not.toMatch(/Mattersight|Tarsier/)
  })

  it('CONTROL: with no indicator match the exact ticker still leads (QQQ)', async () => {
    const net = stubFetch(() => [QQQ])
    open()
    type('qqq')
    await answerSearch(net)
    await waitFor(() => expect(sectionOf('Symbols')).toBeTruthy())
    expect(headings()[0], `QQQ is not the first section: ${headings().join(' | ')}`).toBe('Symbols')
  })

  it('the late symbol reply does not move a focused indicator row', async () => {
    const net = stubFetch(() => [RSI_TICKER, LIVE_NAME_MATCH])
    open()
    type('rsi')
    const btn = primaryIn('rsi')
    expect(btn, 'no RSI result before the reply').toBeTruthy()
    btn.focus()
    expect(document.activeElement).toBe(btn)
    const before = headings()
    await answerSearch(net)
    await waitFor(() => expect(sectionOf('Symbols')).toBeTruthy())
    expect(primaryIn('rsi'), 'the RSI row was re-created by the reply').toBe(btn)
    expect(btn.isConnected).toBe(true)
    expect(document.activeElement, 'focus left the RSI row when the symbols landed').toBe(btn)
    // the indicator headings kept their order; Symbols was appended after them
    expect(headings().slice(0, before.length)).toEqual(before)
  })
})

describe('"rs": the indicator the query NAMES leads (UCT RS, not RSI)', () => {
  it('Relative Strength is the first heading and UCT RS its first row', async () => {
    const net = stubFetch(() => [])
    open()
    type('rs')
    await answerSearch(net)
    const hs = headings()
    expect(hs[0], `"rs" does not lead with Relative Strength: ${hs.join(' | ')}`).toBe(TECH_CATEGORY.RELATIVE_STRENGTH)
    const first = sectionOf(TECH_CATEGORY.RELATIVE_STRENGTH).querySelector('li')
    expect(first.dataset.defId).toBe('rsLine')
    // the first ↓ from the box lands on it
    fireEvent.keyDown(box(), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(primaryIn('rsLine'))
  })

  it('CONTROL: "rsi" still leads with Momentum (RSI names itself), and a partial word reorders nothing', async () => {
    const net = stubFetch(() => [])
    open()
    type('rsi')
    await answerSearch(net)
    expect(headings()[0]).toBe(TECH_CATEGORY.MOMENTUM)
    expect(sectionOf(TECH_CATEGORY.MOMENTUM).querySelector('li').dataset.defId).toBe('rsi')
  })

  it('namesRow: an exact id, short name or short-name word, never a prefix', () => {
    const rs = { id: 'rsLine', shortName: 'UCT RS' }
    expect(namesRow(rs, 'rs')).toBe(true)
    expect(namesRow(rs, ' RS ')).toBe(true)
    expect(namesRow(rs, 'uct rs')).toBe(true)
    expect(namesRow(rs, 'rsline')).toBe(true)
    expect(namesRow(rs, 'r')).toBe(false)
    expect(namesRow(rs, 'rsi')).toBe(false)
    expect(namesRow(rs, '')).toBe(false)
  })
})

describe('↓ / ↑ / Home / End walk the results', () => {
  it('↓ leaves the box for the first result, walks on, and ↑ comes back to the box', () => {
    stubFetch(() => [])
    open()
    type('rsi')
    const items = navItems()
    expect(items.length, 'too few results for "rsi" to walk').toBeGreaterThan(2)
    box().focus()
    fireEvent.keyDown(box(), { key: 'ArrowDown' })
    expect(document.activeElement, '↓ did not move from the search box').toBe(items[0])
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(document.activeElement, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(document.activeElement, { key: 'ArrowUp' })
    expect(document.activeElement, '↑ from the first result did not return to the box').toBe(box())
  })

  it('End lands on the last item (the hint button), Home on the first; ↓ at the end stays', () => {
    stubFetch(() => [])
    open()
    type('rsi')
    const items = navItems()
    items[0].focus()
    fireEvent.keyDown(items[0], { key: 'End' })
    const last = items[items.length - 1]
    expect(document.activeElement).toBe(last)
    expect(last.dataset.testid, 'the hint button is not in the walk').toBe('library-search-hint-add')
    fireEvent.keyDown(last, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(last)
    fireEvent.keyDown(last, { key: 'Home' })
    expect(document.activeElement).toBe(items[0])
  })

  it('a step scrolls the whole ROW into view (it wears the ring), not just its title button, and never centres', () => {
    // ⚰️ Measured on the real screen: scrolling only the title button left the
    // lower half of the row and its ring clipped, and the browser's own focus
    // scroll then centred the next row (a ~400 px jump).
    stubFetch(() => [])
    open()
    type('rsi')
    const items = navItems()
    const scrolled = []
    const focusOpts = []
    const proto = window.HTMLElement.prototype
    const hadScroll = Object.prototype.hasOwnProperty.call(proto, 'scrollIntoView')
    const prevScroll = proto.scrollIntoView
    const prevFocus = proto.focus
    proto.scrollIntoView = function (opts) { scrolled.push([this, opts]) }
    proto.focus = function (opts) { focusOpts.push(opts); return prevFocus.call(this, opts) }
    try {
      box().focus()
      focusOpts.length = 0
      fireEvent.keyDown(box(), { key: 'ArrowDown' })
      expect(document.activeElement).toBe(items[0])
      expect(focusOpts[0], 'focus() let the browser scroll (it centres a hidden node)').toEqual({ preventScroll: true })
      const [el, opts] = scrolled[scrolled.length - 1]
      expect(el.tagName, 'scrolled the title button, not the row that wears the ring').toBe('LI')
      expect(el.contains(items[0])).toBe(true)
      expect(opts).toEqual({ block: 'nearest' })
      fireEvent.keyDown(items[0], { key: 'End' })
      const hint = scrolled[scrolled.length - 1][0]
      expect(hint.dataset.testid, 'the hint button did not bring its whole hint row into view').toBe('library-search-hint')
    } finally {
      if (hadScroll) proto.scrollIntoView = prevScroll
      else delete proto.scrollIntoView
      proto.focus = prevFocus
    }
  })

  it('the arrows do nothing in the box except ↓ (the caret keeps Home / End / ↑)', () => {
    stubFetch(() => [])
    open()
    type('rsi')
    box().focus()
    for (const key of ['ArrowUp', 'Home', 'End']) {
      fireEvent.keyDown(box(), { key })
      expect(document.activeElement, `${key} moved focus out of the box`).toBe(box())
    }
  })
})

describe('Enter on a result adds it exactly once', () => {
  it('one Enter → one write; a repeating Enter writes nothing more', () => {
    stubFetch(() => [])
    const { onChange } = open()
    type('rsi')
    const btn = primaryIn('rsi')
    btn.focus()
    const ev = fireEvent.keyDown(btn, { key: 'Enter' })
    expect(ev, 'Enter was not cancelled — the native click would add a second time').toBe(false)
    expect(onChange).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(btn, { key: 'Enter', repeat: true })
    expect(onChange, 'a held Enter toggled the row again').toHaveBeenCalledTimes(1)
  })

  it('CONTROL: a click (Space, pointer) still adds through the row', () => {
    stubFetch(() => [])
    const { onChange } = open()
    type('rsi')
    fireEvent.click(primaryIn('rsi'))
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})

describe('the focus ring and the badge size are in the stylesheet', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const css = fs.readFileSync(path.join(here, 'IndicatorLibraryDialog.module.css'), 'utf8').replace(/\s+/g, ' ')

  it('a row with a keyboard-focused title button wears the app ring (2 px --ut-gold)', () => {
    expect(css).toMatch(/\.row:has\(\.primary:focus-visible\) \{ outline: 2px solid var\(--ut-gold\);/)
  })

  it('no text on this surface is under 11 px', () => {
    const sizes = [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]))
    expect(sizes.length).toBeGreaterThan(5)
    expect(sizes.filter((n) => n < 11), 'a font-size under 11 px is back').toEqual([])
  })
})

describe('isDelistedResult reads the flag securityResults wrote', () => {
  it('flags a delisted row by type or by flag, and nothing else', () => {
    const [a, b, live] = securityResults([
      { ticker: 'MATR', name: 'Mattersight', type: 'delisted', delisted: true },
      { ticker: 'OLDCO', name: 'Old Co', type: 'stock', delisted: true, delisted_date: '2001-01-01' },
      { ticker: 'AAPL', name: 'Apple Inc.', type: 'stock' },
    ])
    expect(isDelistedResult(a)).toBe(true)
    expect(isDelistedResult(b)).toBe(true)
    expect(isDelistedResult(live)).toBe(false)
    expect(isDelistedResult(null)).toBe(false)
    expect(isDelistedResult({ kind: 'breadth', category: 'delisted' })).toBe(false)
  })
})
