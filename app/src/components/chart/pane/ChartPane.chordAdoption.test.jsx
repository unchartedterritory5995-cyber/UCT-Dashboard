// S2 CP3 — ChartPane.jsx (the ORIGINAL Shift+F flag-ticker implementation, per its
// own comment and the comments in the three surfaces that copied its shape) now
// reads the DECLARED chord table (`chords.js`) instead of spelling the modifier
// set out inline.
//
// ⛔ THE LEGACY EXPRESSION IS REPRODUCED VERBATIM BELOW, FROM THE PRE-CP3 DIFF. If it
// is ever "tidied", this test stops comparing anything real — copied as a single
// unformatted line and left ugly on purpose (same convention as chords.identity.test.js).
//
// ⚠️ `!e.repeat` is NOT part of this comparison — it stayed in the handler (a property
// of the TOGGLE binding, not the chord's identity), same reasoning as CP2's own test.
import { describe, it, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chordById, matchesChord } from '../../../pages/command/chords.js'

const HERE = dirname(fileURLToPath(import.meta.url))

const SHIFT_F = chordById('SHIFT_F')

// ChartPane.jsx, as it read before CP3:
const legacy = (e) =>
  e.shiftKey && (e.key === 'F' || e.key === 'f') && !e.ctrlKey && !e.altKey && !e.metaKey

const BOOL = [false, true]
const KEYS = ['F', 'f', 'G', 'g', 'Shift', 'Enter', '', 'FF', 'ArrowUp', '1']

function* matrix() {
  for (const key of KEYS)
    for (const shiftKey of BOOL)
      for (const ctrlKey of BOOL)
        for (const altKey of BOOL)
          for (const metaKey of BOOL) yield { key, shiftKey, ctrlKey, altKey, metaKey }
}

describe('S2 CP3 — the table matches the expression ChartPane.jsx replaced, everywhere', () => {
  it('agrees with the legacy guard on the entire modifier matrix', () => {
    const disagreements = []
    for (const e of matrix()) {
      if (matchesChord(e, SHIFT_F) !== legacy(e)) disagreements.push(e)
    }
    expect(disagreements, `inputs where the table and the old expression disagree: ${JSON.stringify(disagreements)}`).toEqual([])
  })

  it('the matrix is big enough to mean something (non-vacuity)', () => {
    const all = [...matrix()]
    expect(all.length).toBe(KEYS.length * 16)
    const trues = all.filter(legacy).length
    expect(trues).toBeGreaterThan(0)
    expect(trues).toBeLessThan(all.length)
  })
})

// ⛔ A behavioural proof that ChartPane.jsx actually WIRES the table, not just that
// the table happens to agree with an expression nobody reads any more. CP2 shipped
// without this class of test (GridChartCell.test.jsx never fires Shift+F); this is
// the tighter bar for CP3.
describe('S2 CP3 — ChartPane.jsx is a real, wired reader of chords.js', () => {
  it('imports matchesChord/chordById from chords.js — never a fresh local copy', () => {
    const src = readFileSync(join(HERE, 'ChartPane.jsx'), 'utf-8')
    expect(src).toMatch(/from\s+['"]\.\.\/\.\.\/\.\.\/pages\/command\/chords\.js['"]/)
    // The inline modifier-spelling this replaced must be gone from the handler —
    // a regression that reintroduces it alongside the import would pass a naive
    // "does it import chords.js" check while quietly ignoring the table.
    expect(src).not.toMatch(/e\.key === 'F' \|\| e\.key === 'f'/)
  })
})

const { toggleSpy } = vi.hoisted(() => ({ toggleSpy: vi.fn() }))
vi.mock('../../StockChart', () => ({
  default: (props) => <div><span data-testid="chart-sym">{props.sym}</span></div>,
}))
vi.mock('../SymbolSearch', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    default: forwardRef((_props, ref) => {
      useImperativeHandle(ref, () => ({ openWith: () => {} }))
      return null
    }),
  }
})
vi.mock('../ChartSettingsModal', () => ({ default: () => null }))
vi.mock('../../../pages/charts/widgets/ChartMarketClock', () => ({ default: () => null }))
vi.mock('../../../pages/charts/widgets/ChartDayGain', () => ({ default: () => null }))
vi.mock('../../../pages/charts/widgets/TimeframeMenu', () => ({ default: () => null }))
vi.mock('../../../hooks/useFlagged', () => ({
  useFlagged: () => ({ isFlagged: () => false, toggle: toggleSpy }),
}))
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({ default: () => ({ data: null, isLoading: false }) }))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {}, loading: false }) }))
vi.mock('../../../hooks/useThemeIndexBars', () => ({
  default: () => ({ isIndex: false, bars: null, name: null, sector: null, loading: false }),
}))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../../../hooks/useMarketOpen', () => ({
  default: () => ({ isOpen: false, isPremarket: false, isExtended: false }),
}))
vi.mock('../../../utils/extSession', () => ({ getExtSessionCached: () => ({ session: 'post' }) }))

const ChartPane = (await import('./ChartPane')).default

beforeEach(() => { toggleSpy.mockClear() })

function focusablePane(container) {
  return container.querySelector('[tabindex="0"]')
}

test('Shift+F on the pane flags the ticker and shows the toast (real DOM, real handler)', () => {
  const { container } = render(<ChartPane sym="NVDA" tf="D" onSymbolChange={() => {}} onTfChange={() => {}} />)
  const pane = focusablePane(container)
  expect(pane).toBeTruthy()
  fireEvent.keyDown(pane, { key: 'F', shiftKey: true })
  expect(toggleSpy).toHaveBeenCalledWith('NVDA')
  expect(screen.getByText(/added to Flagged/)).toBeTruthy()
})

test('Ctrl+Shift+F (the platform accelerator, F-S2-1) does NOT flag', () => {
  const { container } = render(<ChartPane sym="NVDA" tf="D" onSymbolChange={() => {}} onTfChange={() => {}} />)
  const pane = focusablePane(container)
  fireEvent.keyDown(pane, { key: 'F', shiftKey: true, ctrlKey: true })
  expect(toggleSpy).not.toHaveBeenCalled()
})

test('a held Shift+F (repeat) does not re-fire the toggle', () => {
  const { container } = render(<ChartPane sym="NVDA" tf="D" onSymbolChange={() => {}} onTfChange={() => {}} />)
  const pane = focusablePane(container)
  fireEvent.keyDown(pane, { key: 'F', shiftKey: true })
  fireEvent.keyDown(pane, { key: 'F', shiftKey: true, repeat: true })
  expect(toggleSpy).toHaveBeenCalledTimes(1)
})
