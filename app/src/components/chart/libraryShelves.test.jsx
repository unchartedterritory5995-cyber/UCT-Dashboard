// THE LIBRARY SHEET'S LISTS AS ONE CHOICE (libraryShelves.js; Studio plan H2, mock-up B).
//
// The pure rules first, then the sheet itself: what "Showing" offers, what each choice leaves on
// screen, and what a shelf that shows nothing says.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from './engine/nativeRegistry'
import { mergeChartSettings } from './chartDefaults'
import {
  SHELF_ALL, SHELF_ON, SHELF_MINE, SHELF_HOUSE, SHELF_MEMBERS, categoryShelf, categoryOf, isListShelf,
  shelfHolds, shelfOptions, optionText, validShelf, emptyShelfText,
} from './libraryShelves'

vi.mock('../../hooks/useUserDefinitions', async (orig) => ({
  ...(await orig()),
  fetchDefinitionLibrary: vi.fn(async () => ({ ok: true, entries: [], next: null })),
}))

import IndicatorLibraryDialog from './IndicatorLibraryDialog'

afterEach(() => { cleanup(); registry.clearUserDefinitions() })

const R = (id, category, extra = {}) => ({ id, key: id, category, name: id, ...extra })
const ROWS = [
  R('ema', 'Trend'), R('sar', 'Trend'), R('rsi', 'Momentum'),
  R('u_1', 'My indicators', { userDefined: true }), R('u_2', 'Trend', { userDefined: true }),
]
const ON = new Set(['ema', 'u_1'])
const isOn = (row) => ON.has(row.id)

describe('the rules', () => {
  it('which row sits on which shelf', () => {
    const on = (shelf) => ROWS.filter((r) => shelfHolds(shelf, r, isOn)).map((r) => r.id)
    expect(on(SHELF_ALL)).toEqual(['ema', 'sar', 'rsi', 'u_1', 'u_2'])
    expect(on(SHELF_ON)).toEqual(['ema', 'u_1'])
    expect(on(SHELF_MINE)).toEqual(['u_1', 'u_2'])
    // a heading's shelf holds the catalogue's rows; the member's own have their own shelf
    expect(on(categoryShelf('Trend'))).toEqual(['ema', 'sar'])
    expect(on(SHELF_HOUSE)).toEqual([])                         // a list of its own, not catalogue rows
    expect(shelfHolds(SHELF_ALL, null, isOn)).toBe(false)
  })

  it('the choices: the five lists, then each heading that holds something, each with its count', () => {
    const opts = shelfOptions({ rows: ROWS, categories: ['Trend', 'Momentum', 'My indicators'], isOn })
    expect(opts.map((o) => [o.value, o.label, o.count])).toEqual([
      [SHELF_ALL, 'All indicators', 5],
      [SHELF_ON, 'On this chart', 2],
      [SHELF_MINE, 'Your indicators', 2],
      [SHELF_HOUSE, 'UCT indicators', null],
      [SHELF_MEMBERS, "Members' indicators", null],
      ['cat:Trend', 'Trend', 2],
      ['cat:Momentum', 'Momentum', 1],
    ])                                                         // "My indicators" holds only the member's: no second shelf
    expect(opts.map(optionText).slice(0, 4)).toEqual(['All indicators (5)', 'On this chart (2)', 'Your indicators (2)', 'UCT indicators'])
    expect(shelfOptions().map((o) => o.value)).toEqual([SHELF_ALL, SHELF_ON, SHELF_MINE, SHELF_HOUSE, SHELF_MEMBERS])
  })

  it('a shelf that is no longer offered falls back to everything, and the small helpers agree', () => {
    const opts = shelfOptions({ rows: ROWS, categories: ['Trend'], isOn })
    expect(validShelf('cat:Trend', opts)).toBe('cat:Trend')
    expect(validShelf('cat:Gone', opts)).toBe(SHELF_ALL)
    expect(validShelf(undefined, opts)).toBe(SHELF_ALL)
    expect([categoryOf('cat:Trend'), categoryOf(SHELF_ON), categoryOf(null)]).toEqual(['Trend', null, null])
    expect([isListShelf(SHELF_HOUSE), isListShelf(SHELF_MEMBERS), isListShelf(SHELF_ON)]).toEqual([true, true, false])
    expect(emptyShelfText(SHELF_ON)).toMatch(/^Nothing is on this chart yet/)
    expect(emptyShelfText(SHELF_MINE)).toMatch(/^You have not made an indicator yet/)
  })
})

describe('the sheet', () => {
  const settings = mergeChartSettings(JSON.stringify({}))
  function mount(props = {}) {
    const writes = []
    render(<IndicatorLibraryDialog open onClose={() => {}} settings={settings} onChange={(n) => writes.push(n)}
      registry={registry} {...props} />)
    return { writes }
  }
  const shelf = () => screen.getByTestId('library-shelf')
  const show = async (value) => { await act(async () => { fireEvent.change(shelf(), { target: { value } }) }) }
  const headings = () => screen.queryAllByRole('heading', { level: 3 }).map((h) => h.textContent)
  const rowIds = () => [...document.querySelectorAll('li[data-def-id]')].map((li) => li.dataset.defId)

  it('"Showing" lists every list with its count, and opens on everything', () => {
    mount()
    expect(shelf().value).toBe(SHELF_ALL)
    const labels = within(shelf()).getAllByRole('option').map((o) => o.textContent)
    expect(labels[0]).toMatch(/^All indicators \(\d+\)$/)
    expect(labels[1]).toMatch(/^On this chart \(\d+\)$/)
    expect(labels[2]).toBe('Your indicators (0)')
    expect(labels.slice(3, 5)).toEqual(['UCT indicators', "Members' indicators"])
    expect(labels.length).toBeGreaterThan(6)                    // and the catalogue's own headings
    // the count on "All indicators" is the number of rows the sheet lists
    expect(Number(/\((\d+)\)/.exec(labels[0])[1])).toBe(rowIds().length)
  })

  it('a heading\'s shelf leaves exactly that heading; "On this chart" leaves what is on it', async () => {
    mount()
    const all = headings()
    expect(all.length).toBeGreaterThan(2)
    const pick = within(shelf()).getAllByRole('option').find((o) => o.value.startsWith('cat:'))
    await show(pick.value)
    expect(headings()).toEqual([pick.value.slice(4)])
    expect(rowIds().length).toBe(Number(/\((\d+)\)$/.exec(pick.textContent)[1]))
    await show(SHELF_ON)
    const onCount = Number(/\((\d+)\)$/.exec(within(shelf()).getByRole('option', { name: /^On this chart/ }).textContent)[1])
    expect(rowIds().length).toBe(onCount)
    for (const li of document.querySelectorAll('li[data-def-id]')) {
      expect(within(li).getByRole('button', { pressed: true })).toBeTruthy()   // every row here is on the chart
    }
    await show(SHELF_ALL)
    expect(headings()).toEqual(all)
  })

  it('a shelf that holds nothing says so; one that only fails the search offers the matches elsewhere', async () => {
    mount()
    await show(SHELF_MINE)
    expect(screen.getByTestId('library-shelf-empty').textContent).toMatch(/^You have not made an indicator yet/)
    expect(rowIds()).toEqual([])
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'rsi' } })
    const empty = screen.getByTestId('library-shelf-empty')
    expect(empty.textContent).toMatch(/^Nothing in Your indicators matches “rsi”\./)
    const more = within(empty).getByTestId('library-shelf-all')
    expect(more.textContent).toMatch(/^Show the \d+ match(es)? in all indicators$/)
    await act(async () => { fireEvent.click(more) })
    expect(shelf().value).toBe(SHELF_ALL)
    expect(screen.getByRole('searchbox').value).toBe('rsi')       // the search is kept: it is what they asked for
    expect(rowIds().length).toBeGreaterThan(0)
  })

  it('"UCT indicators" shows the house list in the same sheet, and the start doors stay above every list', async () => {
    mount({ onCreateIndicator: () => {}, onCreateFormula: () => {} })
    await show(SHELF_HOUSE)
    expect(screen.getByTestId('library-house-view')).toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toHaveAccessibleName('Search UCT indicators')
    expect(rowIds()).toEqual([])                                 // the catalogue is not under it
    expect(screen.getByTestId('library-describe')).toBeInTheDocument()
    expect(screen.getByTestId('library-new-formula')).toBeInTheDocument()
  })

  it('the control is a real select at the tap size, with 16 px text at the touch width (read from the stylesheet)', () => {
    mount()
    expect(shelf().tagName).toBe('SELECT')
    expect(screen.getByTestId('library-shelf-row').tagName).toBe('LABEL')    // "Showing" names it
    const css = fs.readFileSync(path.resolve(__dirname, './IndicatorLibraryDialog.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const rule = /\.shelfSelect\s*\{([^}]*)\}/.exec(css)
    expect(rule).not.toBeNull()
    expect(rule[1]).toMatch(/min-height:\s*var\(--tap-min, 44px\)/)
    expect(css).toMatch(/@media \(max-width: 1024px\) \{ \.shelfSelect \{ font-size: 16px; \} \}/)
  })
})
