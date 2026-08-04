import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import IndicatorLibraryDialog from './IndicatorLibraryDialog'
import { mergeChartSettings } from './chartDefaults'
import { catalogRows } from './indicatorCatalog'
import { isIndicatorEnabled, setIndicatorEnabled } from './engine/instanceControls'
import { ENGINE_FLIPPED_DEF_IDS } from './engine/flipState'
import * as engineRegistry from './engine/nativeRegistry'

// ─── THE BROWSE / ADD SURFACE (spec §6) ─────────────────────────────────────
//
// Search-first, add-and-stay-open, checkmarks on what is already on. The claims
// that can actually go wrong here are not "does it render": they are that every
// write routes at the ONE writer, that the carved-out section is the ONE named
// exception, and that the groups are DERIVED rather than typed.

const base = () => mergeChartSettings(null)

const open = (settings = base(), registry = engineRegistry) => {
  const onChange = vi.fn()
  render(<IndicatorLibraryDialog open onClose={() => {}} settings={settings}
                                 onChange={onChange} registry={registry} />)
  return { onChange }
}

const optionIds = () => screen.getAllByRole('option').map((o) => o.dataset.defId)
const type = (v) => fireEvent.change(screen.getByRole('searchbox'), { target: { value: v } })

describe('the indicator library — search-first, add-and-stay-open, checkmarks', () => {
  it('lists every indicator, grouped by the definition\'s own category', () => {
    open()
    // Groups are DERIVED. Adding a definition in a new category brings its own
    // heading; there is no group array to forget to edit — the exact defect the
    // settings modal's hardcoded section list was (B3 Task 12 retired it).
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual([...new Set(catalogRows().map((r) => r.category))])
    expect(screen.getAllByRole('option')).toHaveLength(catalogRows().length)
    // …and the carved-out section is one of them. A list built from definitions
    // alone drops it — the regression B3 Task 11 refused.
    expect(optionIds()).toContain('volumeProfile')
  })

  it('shows the long name and the one-line blurb, not the chip abbreviation', () => {
    open()
    const row = screen.getByRole('option', { name: /Relative Strength Index/ })
    expect(within(row).getByText(/how much of recent movement has been up/i)).toBeTruthy()
    // The long name is `meta.name`; the SHORT name is still there, as a chip.
    expect(within(row).getByText('RSI')).toBeTruthy()
  })

  it('search is focused on open and filters on name, short name, id and tag', () => {
    open()
    const box = screen.getByRole('searchbox')
    expect(document.activeElement).toBe(box)
    fireEvent.change(box, { target: { value: 'bollinger' } })
    expect(optionIds()).toEqual(['bb'])
    fireEvent.change(box, { target: { value: 'BB' } })
    expect(optionIds()).toEqual(['bb'])
    // ⚠️ A TAG, AND THE ORDER IS THE GROUPED ORDER, NOT CATALOG ORDER. The brief
    // expected `['rsi','macd','stoch','mfi','cci','williamsR']` — catalog order —
    // while also requiring category headings. Both cannot hold: `mfi`'s category
    // is Volume and the other five are Momentum, so a grouped render puts it
    // last. Measured, and asserted as it RENDERS.
    fireEvent.change(box, { target: { value: 'oscillator' } })
    expect(optionIds()).toEqual(['rsi', 'macd', 'stoch', 'cci', 'williamsR', 'mfi'])
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent))
      .toEqual(['Momentum', 'Volume'])
  })

  it('a query that matches nothing says so instead of rendering an empty dialog', () => {
    open()
    type('zzzzz')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText(/No indicator matches/)).toBeTruthy()
  })

  it('adding leaves the dialog OPEN and ticks the row (spec §6 add-and-stay-open)', () => {
    const { onChange } = open()
    fireEvent.click(screen.getByRole('option', { name: /Average True Range/ }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0]
    expect(isIndicatorEnabled(next, 'atr', ENGINE_FLIPPED_DEF_IDS)).toBe(true)
    expect(next.indicators.atr.enabled).toBe(true)     // the mirror an un-flipped block reads
    // ⛔ AND IT WENT THROUGH `instanceControls`. A raw slice write moves the
    // mirror and nothing else — the eighth-door regression, and the mirror
    // assertion above cannot tell the two apart on its own.
    expect(next.indicatorInstances.some((i) => i && i.defId === 'atr' && !i.deleted)).toBe(true)
    expect(screen.getByRole('searchbox'), 'the dialog closed after an add').toBeTruthy()
    expect(screen.getAllByRole('option')).toHaveLength(catalogRows().length)
  })

  it('a second click removes it, and the row un-ticks', () => {
    const on = setIndicatorEnabled(base(), 'rsi', true, engineRegistry)
    const { onChange } = open(on)
    expect(screen.getByRole('option', { name: /Relative Strength Index/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('option', { name: /Relative Strength Index/ }))
    const next = onChange.mock.calls[0][0]
    expect(isIndicatorEnabled(next, 'rsi', ENGINE_FLIPPED_DEF_IDS)).toBe(false)
    // The tombstone, not just the mirror: the mirror alone comes back on the
    // next paint because the migrator re-projects it.
    expect(next.indicatorInstances.some((i) => i.instanceId === 'legacy:rsi' && i.deleted === true)).toBe(true)
  })

  it('the carved-out section is addable too — it has a settings toggle and no definition', () => {
    const settings = base()
    const { onChange } = open(settings)
    fireEvent.click(screen.getByRole('option', { name: /Volume Profile/ }))
    // ⛔ NOT through instanceControls: there is nothing to instantiate, and
    // `setIndicatorEnabled` returns the settings BY IDENTITY for a def the
    // registry does not know — so routing it there makes the toggle do nothing.
    // Straight to its settings slice, the way the MA overlays write.
    expect(onChange.mock.calls[0][0].indicators.volumeProfile.enabled).toBe(true)
    expect(onChange.mock.calls[0][0].indicatorInstances).toEqual(settings.indicatorInstances)
    expect(screen.getByRole('option', { name: /Volume Profile/ }).getAttribute('aria-selected')).toBe('false')
  })

  it('shows the repaint and tier badges the definition declares — never self-disclosed prose', () => {
    open()
    const row = screen.getByRole('option', { name: /Session VWAP/ })
    expect(within(row).getByText('Non-repainting')).toBeTruthy()
    expect(within(row).queryByText(/premium/i)).toBeNull()   // every native is tier: free
    // …and the badge is DECLARED, not defaulted: a definition with no `repaint`
    // shows none rather than claiming the safe answer.
    const carved = screen.getByRole('option', { name: /Volume Profile/ })
    expect(within(carved).queryByText(/repaint/i)).toBeNull()
  })

  it('a session indicator says so, derived from meta.timeframes', () => {
    open()
    expect(within(screen.getByRole('option', { name: /Session VWAP/ })).getByText('Intraday only')).toBeTruthy()
    expect(within(screen.getByRole('option', { name: /Average True Range/ })).queryByText('Intraday only')).toBeNull()
  })

  it('refuses to render a definition the registry does not know, rather than a blank row', () => {
    open(base(), { listDefinitions: () => [] })
    // Carved-out rows still list; the point is it does not crash and does not
    // paint an empty row. defSchema's line: a control that refuses to appear is a
    // bug report, one that appears and writes nowhere is a support ticket.
    expect(optionIds()).toEqual(['volumeProfile'])
  })

  it('⭐ a REFUSED write persists nothing — the identity guard, with a real subject', () => {
    // The witness the empty registry cannot provide: a row that RENDERS but whose
    // write `instanceControls` refuses. `listDefinitions` offers it; `getDefinition`
    // does not know it, which is exactly what `setIndicatorEnabled` asks — and it
    // returns `cs` untouched. Calling `onChange` anyway would persist a no-op and
    // stamp `preset: 'custom'` for a click that changed nothing.
    const ghost = {
      id: 'ghost', version: 1,
      meta: { name: 'Ghost Indicator', shortName: 'Ghost', category: 'Momentum', tags: [] },
      placement: { target: 'pane' }, inputs: [], plots: [],
    }
    const { onChange } = open(base(), { listDefinitions: () => [ghost], getDefinition: () => null })
    expect(optionIds()).toEqual(['ghost', 'volumeProfile'])
    fireEvent.click(screen.getByRole('option', { name: /Ghost Indicator/ }))
    expect(onChange, 'a refused write was persisted').not.toHaveBeenCalled()
    // …and the control half: the carved-out row on the SAME render does write, so
    // this is a refusal and not a dialog that never calls onChange.
    fireEvent.click(screen.getByRole('option', { name: /Volume Profile/ }))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('closed renders nothing at all', () => {
    render(<IndicatorLibraryDialog open={false} onClose={() => {}} settings={base()}
                                   onChange={vi.fn()} registry={engineRegistry} />)
    expect(screen.queryByRole('searchbox')).toBeNull()
  })
})
