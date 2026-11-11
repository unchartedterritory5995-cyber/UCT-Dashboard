// app/src/components/chart/IndicatorLibraryDialog.searchHint.test.jsx
//
// ─── UCT RS Phase 4, unit 4-03 · the library's search hint row ──────────────
//
// A definition may declare `meta.searchHint`; when the member's WHOLE search
// equals one of its queries, the library prints one muted row under the results:
// the definition's line and one Add button that uses the row's own toggle.
//
// ⛔ EXACT COMPARISON. `IndicatorLibraryDialog.test.jsx` (the "+ Add another"
// block) already warns that a pattern over names matches both RSI and the RS line.
// So "rs" and "rsi divergence" must show nothing, and neither must "relative
// strength", which as a substring or a regex matches both definitions' names.
//
// The engine is tested against a probe (`__tests__/tourProbe.fixture.js`), over
// the shipped catalogue with its own teaching taken off: unit 4-04's hint on
// `rsLine` is railed in `__tests__/rsTeaching.test.js`.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen, fireEvent, within } from '@testing-library/react'
import IndicatorLibraryDialog from './IndicatorLibraryDialog'
import { mergeChartSettings } from './chartDefaults'
import { definitionVisibility, setIndicatorEnabled } from './engine/instanceControls'
import { ENGINE_OWNED } from './engine/flipState'
import * as engineRegistry from './engine/nativeRegistry'
import {
  withTourProbe, withoutShippedTeaching, tourProbeDefinition, TOUR_PROBE_ID, TOUR_PROBE_NAME, HINT_LINE,
} from './__tests__/tourProbe.fixture'

const base = () => mergeChartSettings(null)
const REG = withTourProbe(engineRegistry)

function open(settings = base(), registry = REG) {
  const onChange = vi.fn()
  const utils = render(<IndicatorLibraryDialog open onClose={() => {}} settings={settings}
                                               onChange={onChange} registry={registry} />)
  return { onChange, ...utils }
}
const type = (v) => fireEvent.change(screen.getByRole('searchbox'), { target: { value: v } })
const hintRow = () => screen.queryByTestId('library-search-hint')

describe('the search hint — an exact whole-query match, never a substring', () => {
  it('shows for "rsi" and for "relative strength index", in any case and spacing', () => {
    open()
    for (const q of ['rsi', 'relative strength index', '  RSI ', 'Relative   Strength Index']) {
      type(q)
      const row = hintRow()
      expect(row, `no hint for ${JSON.stringify(q)}`).toBeTruthy()
      expect(row.dataset.defId).toBe(TOUR_PROBE_ID)
      expect(within(row).getByText(HINT_LINE)).toBeTruthy()
      // the label comes from the DEFINITION's name, never a hard-coded indicator
      expect(within(row).getByRole('button', { name: `Add ${TOUR_PROBE_NAME}` })).toBeTruthy()
    }
  })

  it('does NOT show for "rs", "rsi divergence", "relative strength", "r", or an empty box', () => {
    open()
    for (const q of ['rs', 'rsi divergence', 'relative strength', 'r', '', 'rsi2']) {
      type(q)
      expect(hintRow(), `a hint showed for ${JSON.stringify(q)}`).toBeNull()
    }
  })

  it('sits UNDER the matching results: the RSI row is still listed, above it', () => {
    open()
    type('rsi')
    const rsiRow = document.querySelector('li[data-def-id="rsi"]')
    expect(rsiRow, 'the RSI result is gone — the hint must add a row, not replace results').toBeTruthy()
    // DOCUMENT_POSITION_FOLLOWING: the hint comes after the result
    expect(rsiRow.compareDocumentPosition(hintRow()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('pressing the button adds the definition ONCE, through the row\'s own toggle', () => {
    const { onChange, rerender } = open()
    type('rsi')
    fireEvent.click(screen.getByRole('button', { name: `Add ${TOUR_PROBE_NAME}` }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0]
    expect(definitionVisibility(next, TOUR_PROBE_ID, ENGINE_OWNED)).toMatchObject({ state: 'shown', live: 1 })
    // …and once it is on, the hint offers no second Add (a toggle on a SHOWN row would hide it)
    rerender(<IndicatorLibraryDialog open onClose={() => {}} settings={next} onChange={onChange} registry={REG} />)
    expect(within(hintRow()).queryByRole('button')).toBeNull()
    expect(within(hintRow()).getByTestId('library-search-hint-on').textContent)
      .toBe(`${TOUR_PROBE_NAME} is already on this chart.`)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('a HIDDEN instance is offered as "Show", which is what the toggle does', () => {
    const on = setIndicatorEnabled(base(), TOUR_PROBE_ID, true, REG)
    const hidden = setIndicatorEnabled(on, TOUR_PROBE_ID, false, REG)
    expect(definitionVisibility(hidden, TOUR_PROBE_ID, ENGINE_OWNED).state).toBe('hidden')
    const { onChange } = open(hidden)
    type('rsi')
    fireEvent.click(within(hintRow()).getByRole('button', { name: `Show ${TOUR_PROBE_NAME}` }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(definitionVisibility(onChange.mock.calls[0][0], TOUR_PROBE_ID, ENGINE_OWNED)).toMatchObject({ state: 'shown', live: 1 })
  })

  it('a declared cta replaces the button label', () => {
    const reg = withTourProbe(engineRegistry, tourProbeDefinition({
      searchHint: { queries: ['rsi'], line: HINT_LINE, cta: 'Try it' },
    }))
    open(base(), reg)
    type('rsi')
    expect(within(hintRow()).getByRole('button', { name: 'Try it' })).toBeTruthy()
  })

  it('two definitions declaring one query still print ONE row', () => {
    const second = { ...tourProbeDefinition(), id: 'tourProbe2', meta: { ...tourProbeDefinition().meta, name: 'Second probe', shortName: 'TP2' } }
    open(base(), withTourProbe(engineRegistry, tourProbeDefinition(), second))
    type('rsi')
    expect(screen.getAllByTestId('library-search-hint')).toHaveLength(1)
  })

  it('CONTROL: with no definition declaring a hint, "rsi" prints no hint row', () => {
    open(base(), withoutShippedTeaching(engineRegistry))
    type('rsi')
    expect(hintRow()).toBeNull()
    expect(document.querySelector('li[data-def-id="rsi"]')).toBeTruthy()
  })
})

describe('the hint is the LIBRARY\'s, and the engine names no indicator', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const read = (rel) => fs.readFileSync(path.join(here, rel), 'utf8')

  it('the settings tab\'s search keeps plain matching — it reads no search hint', () => {
    expect(read('ChartSettingsIndicators.jsx')).not.toMatch(/searchHint|normalizeHintQuery/)
  })

  it('the dialog and the tours hook name no definition id', () => {
    for (const f of ['IndicatorLibraryDialog.jsx', 'useIndicatorTours.js']) {
      expect(read(f), f).not.toMatch(/['"]rsLine['"]|UCT Relative Strength/)
    }
  })
})
