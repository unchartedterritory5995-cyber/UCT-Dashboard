// app/src/components/chart/SourceField.test.jsx
//
// ─── THE CONTROL FOR AN INPUT OF TYPE `source` ──────────────────────────────
//
// ⭐⭐ THE CLAIM THAT MATTERS IS "A DECLARED INPUT HAS A REAL EDITOR". `enumerationSites`
// asserts every declared input is reachable from the generated dialog, and it
// reads the field DESCRIPTOR — not the DOM. So teaching `fieldFromInput` alone
// would have turned that rail green while the tab still drew a label with no
// control beside it. This file is the other half: the descriptor is honoured by
// something a member can actually operate.
//
// ⛔ AND WHAT IT WRITES IS CANONICAL. `symbolSource()` is the one writer of
// `sym:<TICKER>:<field>`; a control that invented its own shape would be a second
// source language, and the binder parses only the first.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import SourceField from './SourceField'
import ChartSettingsModal from './ChartSettingsModal'
import * as registry from './engine/nativeRegistry'
import { mergeChartSettings } from './chartDefaults'
import { fieldFromInput } from './indicatorRegistry'
import { addInstance } from './engine/instanceControls'
import { symbolSource } from './engine/sourceRef'

afterEach(() => cleanup())

const FIELD = { key: 'source', label: 'Source', type: 'source' }

/** A settings blob holding one direct series, and that instance's id. */
function withSeries(source = 'close') {
  let cs = addInstance(mergeChartSettings({}), 'dataSeries', registry)
  const id = cs.indicatorInstances[cs.indicatorInstances.length - 1].instanceId
  cs = {
    ...cs,
    indicatorInstances: cs.indicatorInstances.map((i) =>
      (i.instanceId === id ? { ...i, inputs: { ...(i.inputs || {}), source } } : i)),
  }
  return { cs, id }
}

/** A discovery endpoint that answers without a network. */
const searchFetcher = (rows) => vi.fn(() => Promise.resolve({
  ok: true, json: () => Promise.resolve({ results: rows }),
}))

const show = (cs, id, value, onPick, fetcher) => render(
  <SourceField
    row={{ instanceId: id, label: 'QQQ' }}
    field={FIELD}
    value={value}
    settings={cs}
    registry={registry}
    onPick={onPick}
    fetcher={fetcher}
  />,
)

describe('the declaration-to-control seam', () => {
  it('⭐⭐ `type: source` YIELDS A FIELD DESCRIPTOR, not null', () => {
    // It returned `null` for as long as nothing shipped a source input — honest
    // then, a lie the moment a member-facing definition declared one.
    expect(fieldFromInput({ key: 'source', label: 'Source', type: 'source' }))
      .toEqual({ key: 'source', label: 'Source', type: 'source' })
  })

  it('⛔ …and it carries NO options — that is the difference from an enum', () => {
    // An enum's choices are declared and identical on every chart. A source's
    // depend on what else is on THIS chart, so the control builds them live.
    const f = fieldFromInput({ key: 'source', label: 'Source', type: 'source' })
    expect(f.options).toBeUndefined()
  })

  it('⛔ the definition this exists for really does declare one', () => {
    const def = registry.getDefinition('dataSeries')
    expect((def.inputs || []).some((i) => i.type === 'source')).toBe(true)
  })
})

describe('the source control', () => {
  it('⭐ renders a real, operable control', () => {
    const { cs, id } = withSeries()
    show(cs, id, 'close', () => {})
    const sel = screen.getByRole('combobox')
    expect(sel).toBeTruthy()
    expect(sel.disabled).toBe(false)
    // Price fields are offered, so the control is not an empty shell.
    expect(within(sel).getByRole('option', { name: 'Close' })).toBeTruthy()
  })

  it('⭐⭐ A STORED SYMBOL IS REPRESENTABLE — never "unavailable" over a good value', () => {
    // ⚰️ THE DEFECT THIS PINS: `sourceOptions` emits its Symbol group only for the
    // value it is SHOWN, so a caller that omits the current value makes every
    // symbol source read "Source unavailable" over a perfectly good
    // `sym:SPY:close` — and the next change event then writes whichever option
    // the browser fell back to, silently re-pointing the member's instrument.
    const { cs, id } = withSeries(symbolSource('SPY', 'close'))
    show(cs, id, symbolSource('SPY', 'close'), () => {})
    const sel = screen.getByRole('combobox')
    expect(sel.value).toBe('sym:SPY:close')
    expect(screen.queryByText('Source unavailable')).toBeNull()
  })

  it('⛔ A SOURCE THAT NO LONGER PARSES STILL SHOWS, as unavailable', () => {
    // A severed source must not be snapped back to Close: that would change what
    // the instance COMPUTES without the member asking.
    const { cs, id } = withSeries('!@inst:gone::value')
    show(cs, id, '!@inst:gone::value', () => {})
    expect(screen.getByText('Source unavailable')).toBeTruthy()
  })

  it('⭐ picking a price field writes that field, canonically', () => {
    const { cs, id } = withSeries()
    const picks = []
    show(cs, id, 'close', (v) => picks.push(v))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'volume' } })
    expect(picks).toEqual(['volume'])
  })

  it('⛔ THE SENTINEL IS NEVER WRITTEN — "Search symbol…" is a door, not a value', () => {
    const { cs, id } = withSeries()
    const picks = []
    show(cs, id, 'close', (v) => picks.push(v))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '__search__' } })
    // It opened the search instead of storing the sentinel.
    expect(picks).toEqual([])
    expect(screen.getByLabelText('Search symbol')).toBeTruthy()
  })

  it('⭐⭐ SEARCHING AND PICKING WRITES A CANONICAL SYMBOL SOURCE', async () => {
    const { cs, id } = withSeries()
    const picks = []
    const fetcher = searchFetcher([{ ticker: 'SPY', name: 'SPDR S&P 500', type: 'etf' }])
    show(cs, id, 'close', (v) => picks.push(v), fetcher)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '__search__' } })
    fireEvent.change(screen.getByLabelText('Search symbol'), { target: { value: 'SPY' } })
    const hit = await screen.findByRole('button', { name: /SPY/ })
    fireEvent.click(hit)
    // ⛔ THE STORED SHAPE, not a ticker and not a label. `symbolSource` is the one
    // writer of this string and the binder parses only this string.
    expect(picks).toEqual([symbolSource('SPY', 'close')])
    expect(picks[0]).toBe('sym:SPY:close')
  })

  it('⭐ THE EXACT TICKER IS THE FIRST RESULT, so Enter takes what was typed', async () => {
    const { cs, id } = withSeries()
    const picks = []
    // The server answers with a near-match first; the exact ticker must win.
    const fetcher = searchFetcher([
      { ticker: 'SPYG', name: 'SPDR Growth', type: 'etf' },
      { ticker: 'SPY', name: 'SPDR S&P 500', type: 'etf' },
    ])
    show(cs, id, 'close', (v) => picks.push(v), fetcher)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '__search__' } })
    const box = screen.getByLabelText('Search symbol')
    fireEvent.change(box, { target: { value: 'SPY' } })
    await waitFor(() => expect(screen.getAllByRole('button').length).toBeGreaterThan(0))
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(picks).toEqual(['sym:SPY:close'])
  })

  it('⛔ the search closes without writing when it is dismissed', () => {
    const { cs, id } = withSeries()
    const picks = []
    show(cs, id, 'close', (v) => picks.push(v))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '__search__' } })
    fireEvent.keyDown(screen.getByLabelText('Search symbol'), { key: 'Escape' })
    expect(screen.queryByLabelText('Search symbol')).toBeNull()
    expect(picks).toEqual([])
  })

  it('⛔ NO NETWORK UNTIL THE MEMBER ASKS — a closed picker fetches nothing', () => {
    const { cs, id } = withSeries()
    const fetcher = searchFetcher([])
    show(cs, id, 'close', () => {}, fetcher)
    expect(fetcher).not.toHaveBeenCalled()
  })
})

// ─── THE TAB ACTUALLY DRAWS IT ──────────────────────────────────────────────
//
// ⚰️⚰️ THIS SECTION EXISTS BECAUSE A BITE CHECK CAME BACK GREEN. Every case above
// renders `SourceField` DIRECTLY, and `enumerationSites` reads the field
// DESCRIPTOR — so deleting the renderer from `ChartSettingsIndicators` entirely
// (`{f.type === 'source' && …}` → `{false && …}`) left the whole suite passing.
// That is exactly the state the commit message claims is impossible: a declared
// input with a control that exists on paper and nowhere on screen. The rail
// below is the one that fails for it, and it fails through the REAL modal.

/** A row's fields live behind its expander, so the row has to be OPEN before any
 *  control exists to find. Opened by the row whose block carries the direct
 *  series, never by position. */
function openTheSeriesRow() {
  const rows = [...document.body.querySelectorAll('[data-row-id]')]
  const target = rows.find((r) => /qqq|series/i.test(
    (r.querySelector('[aria-expanded]')?.textContent || '')))
    || rows[rows.length - 1]
  const btn = target && target.querySelector('[aria-expanded]')
  if (btn) fireEvent.click(btn)
}

describe('the Indicators tab draws the control, not just the descriptor', () => {
  it('⭐⭐ a direct series row carries an operable Source control', () => {
    const { cs } = withSeries(symbolSource('QQQ', 'close'))
    render(<ChartSettingsModal open settings={cs} onChange={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
    openTheSeriesRow()

    // ⛔ FOUND BY ITS ACCESSIBLE NAME, which is how a member finds it too. A
    // label with no control beside it has no combobox to match.
    const sel = screen.getAllByRole('combobox')
      .find((c) => /source/i.test(c.getAttribute('aria-label') || ''))
    expect(sel, 'the Indicators tab renders no control for the declared source input').toBeTruthy()

    // …and it is showing the stored instrument rather than falling back.
    expect(sel.value).toBe('sym:QQQ:close')
  })

  it('⭐⭐ THE ROW IS NAMED FROM ITS SOURCE, not "Data Series" four times', () => {
    // ⚰️ MEASURED IN A BROWSER 2026-09-14, on the pane harness, and it is the
    // half of the naming defect the chip fix did not cover: a chart holding two
    // QQQ series and one SPY listed FOUR rows all reading "Data Series", while
    // the legend beside them correctly read `QQQ`. Two naming surfaces, and they
    // are not the same function.
    let cs = addInstance(mergeChartSettings({}), 'dataSeries', registry)
    cs = addInstance(cs, 'dataSeries', registry)
    const ids = cs.indicatorInstances.filter((i) => i.defId === 'dataSeries').map((i) => i.instanceId)
    const srcs = ['sym:QQQ:close', 'sym:SPY:close']
    cs = {
      ...cs,
      indicatorInstances: cs.indicatorInstances.map((i) => {
        const at = ids.indexOf(i.instanceId)
        return at < 0 ? i : { ...i, inputs: { ...(i.inputs || {}), source: srcs[at] } }
      }),
    }
    render(<ChartSettingsModal open settings={cs} onChange={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
    // ⛔ THE NAME ELEMENT, NOT THE BUTTON'S TEXT. `actName` is the expander
    // BUTTON and it wraps both the name (`actLabel`) and the definition's
    // shortName badge, so its `textContent` reads `QQQSeries` — two correct
    // things concatenated, not a name. The badge is right to keep: it says WHAT
    // KIND of row this is, while the label says WHICH ONE.
    const names = [...document.body.querySelectorAll('[data-row-id]')]
      .map((r) => (r.querySelector('[class*="actLabel"]')?.textContent || '').trim())
      .filter(Boolean)
    expect(names).toContain('QQQ')
    expect(names).toContain('SPY')
    expect(names.filter((n) => /Data Series/.test(n)),
      'a direct series row is still wearing the catalogue noun').toEqual([])
  })

  it('⛔ …and an ORDINARY definition keeps its catalogue noun', () => {
    // The gate is `meta.labelFrom`, not a definition id. RSI must be unaffected.
    const cs = addInstance(mergeChartSettings({}), 'rsi', registry)
    render(<ChartSettingsModal open settings={cs} onChange={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
    const names = [...document.body.querySelectorAll('[data-row-id]')]
      .map((r) => (r.querySelector('[class*="actLabel"]')?.textContent || '').trim())
    expect(names.some((n) => /Relative Strength/i.test(n))).toBe(true)
  })

  it('⛔ …and the control the tab drew writes through the row patch', () => {
    const { cs } = withSeries('close')
    const seen = []
    render(<ChartSettingsModal open settings={cs} onChange={(next) => seen.push(next)}
                               onClose={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
    openTheSeriesRow()
    const sel = screen.getAllByRole('combobox')
      .find((c) => /source/i.test(c.getAttribute('aria-label') || ''))
    expect(sel).toBeTruthy()
    fireEvent.change(sel, { target: { value: 'volume' } })
    // The write reached settings — through the modal's ordinary patch path, not
    // a side channel of this control's own.
    expect(seen.length).toBeGreaterThan(0)
    const inst = (seen[seen.length - 1].indicatorInstances || [])
      .find((i) => i && i.defId === 'dataSeries')
    expect(inst.inputs.source).toBe('volume')
  })
})
