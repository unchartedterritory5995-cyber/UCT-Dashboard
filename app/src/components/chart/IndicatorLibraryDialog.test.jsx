import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import IndicatorLibraryDialog from './IndicatorLibraryDialog'
import { mergeChartSettings } from './chartDefaults'
import { catalogRows } from './indicatorCatalog'
import { isIndicatorEnabled, setIndicatorEnabled } from './engine/instanceControls'
import { ENGINE_OWNED } from './engine/flipState'
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
    expect(isIndicatorEnabled(next, 'atr', ENGINE_OWNED)).toBe(true)
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
    expect(isIndicatorEnabled(next, 'rsi', ENGINE_OWNED)).toBe(false)
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

  // ⚰️ THE REPAINT HALF OF THIS CASE IS RETIRED, NOT DELETED, AND THE REASON IS
  // THE DEFECT IT WAS PART OF. It asserted `within(row).getByText('Non-repainting')`
  // on the VWAP row — i.e. it REQUIRED this surface to print the definition's
  // DECLARED badge. That badge is written once, by `nativeRegistry.nativeDef`,
  // before the `...meta` spread, so all seventeen definitions inherit it and
  // nothing audited anything (decision record §1); on `ichimoku` the machine
  // linter contradicts it outright. So this case did not merely fail to catch
  // the lie — it PINNED it, the same shape as the retired
  // `d.meta.repaint === 'non-repainting'` assertion in `indicatorCatalog.test.js`
  // (an honest badge was blocked BY A TEST). The badge is now the LINTER'S
  // measurement, and its gate — both directions, plus the per-plot separation —
  // is `IndicatorLibraryDialog.repaintBadge.test.jsx`.
  //
  // What survives here is the TIER half, which is unrelated and still true, plus
  // the "no badge on the carved-out row" clause, which is now true for a better
  // reason: `volumeProfile` has no definition, so there is nothing to measure.
  it('shows the tier badge the definition declares — and no repaint badge nobody measured', () => {
    open()
    const row = screen.getByRole('option', { name: /Session VWAP/ })
    expect(within(row).queryByText(/premium/i)).toBeNull()   // every native is tier: free
    expect(row.querySelector('[data-repaint]'),
      'a hand-written compute the linter may not read wears a repaint badge').toBeNull()
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

  // ═══════════════════════════════════════════════════════════════════════════
  // ⭐ chart-UX-walls TASK 6 — "+ Add another"
  //
  // The checkmark toggles; this ADDS. They cannot be the same control:
  // `setIndicatorEnabled` REVIVES `legacy:<id>` when it is already there, so
  // clicking a ticked row twice can never produce two lines — it turns the
  // indicator off and back on. `addInstance` is the door that means "another".
  // ═══════════════════════════════════════════════════════════════════════════
  const rsiOn = () => setIndicatorEnabled(base(), 'rsi', true, engineRegistry)
  /** The row's Add-another button, addressed by `data-def-id` — the attribute the
   *  dialog already stamps. ⚠️ NOT by accessible NAME: a definition's `meta.name`
   *  is a moving subject (`/Relative Strength/` matches `rsi` AND `rsLine`), and a
   *  name lookup that misses THROWS, which reads as a broken control rather than
   *  as a mis-aimed test. */
  const rowFor = (defId) => screen.getAllByRole('option').find((o) => o.dataset.defId === defId)
  const addAnotherIn = (defId) => {
    const row = rowFor(defId)
    expect(row, `no ${defId} row in the dialog — this case is asserting on nothing`).toBeTruthy()
    return within(row).queryByRole('button', { name: /Add another/i })
  }

  it('⭐ shows "+ Add another" ONLY on a row that is already on', () => {
    open(rsiOn())
    expect(addAnotherIn('rsi'),
      'a row that IS on offers no way to add a second copy').toBeTruthy()
    // …and the control: an OFF row does not, because "another" of nothing is the
    // checkmark's job and two controls doing one thing is how a user learns to
    // trust neither. Asserted over EVERY off row, so the claim is a totality
    // rather than one hand-picked witness.
    const off = catalogRows().map((r) => r.id).filter((id) => id !== 'rsi')
    expect(off.length, 'nothing is off — the control half is vacuous').toBeGreaterThan(5)
    for (const id of off) {
      expect(addAnotherIn(id), `${id} is OFF and offers "Add another" — there is nothing to `
        + 'add another OF').toBeNull()
    }
  })

  it('⛔ …and NEVER on the carved-out row, whose write `addInstance` refuses by identity', () => {
    const vpOn = {
      ...base(),
      indicators: { ...(base().indicators || {}), volumeProfile: { enabled: true } },
    }
    open(vpOn)
    expect(within(rowFor('volumeProfile')).getByText('✓'),
      'the fixture did not turn the carved-out row on').toBeTruthy()
    expect(addAnotherIn('volumeProfile'),
      '`volumeProfile` has no definition, so `addInstance` returns the settings BY IDENTITY '
      + 'for it — a live button that writes nowhere').toBeNull()
  })

  it('⭐ clicking it adds a SECOND instance and does NOT toggle the row off', () => {
    // ⛔ THE SECOND HALF IS THE ONE THAT BREAKS SILENTLY. The whole `<li>` is the
    // toggle, so without `stopPropagation` this click would ALSO fire `toggle(row)`
    // — adding an instance and tombstoning every instance of the definition in one
    // gesture, i.e. a button that does the exact opposite of its label.
    const { onChange } = open(rsiOn())
    fireEvent.click(addAnotherIn('rsi'))
    expect(onChange, 'the button wrote nothing').toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0]
    const live = (next.indicatorInstances || []).filter((i) => i && i.defId === 'rsi' && !i.deleted)
    expect(live.map((i) => i.instanceId), 'the row did not gain a SECOND rsi instance')
      .toEqual(['legacy:rsi', 'inst:rsi:1'])
    expect(next.indicators.rsi.enabled, 'Add another turned the indicator OFF').toBe(true)
    // …and the new one carries the DECLARED defaults, not a copy of its sibling —
    // an identical second RSI draws a line exactly on top of the first.
    const declared = engineRegistry.getDefinition('rsi').inputs.filter((i) => i.default !== undefined)
    expect(declared.length, 'rsi declares no defaults — the check below is vacuous').toBeGreaterThan(0)
    for (const d of declared) expect(live[1].inputs[d.key], d.key).toEqual(d.default)
  })

  it('⛔ the ARTIFACT: "+ Add another" is a 44px target, and NOTHING above it kills the pointer', () => {
    // ⚠️ TASK 3 SHIPPED A BUTTON NOBODY COULD CLICK AND 23 GREEN CLICK CASES SAID
    // OTHERWISE: `.legend` is `pointer-events: none` and it INHERITS, and jsdom
    // implements no hit-testing. Task 4's rule is that a new control's
    // reachability is asserted on the ARTIFACT, never on a `fireEvent.click`.
    //
    // ⭐ MEASURED, AND THE TRAP DOES NOT APPLY HERE — which is a claim, so it is
    // asserted: neither this dialog's own stylesheet nor the two shipped
    // primitives it renders inside (`Sheet`, and `ContextPopover` beside it)
    // declares `pointer-events` at all, so nothing above the button disables it.
    // The 44px target is a spec §7 requirement that CAN regress silently, so it
    // is read off the file rather than trusted.
    const here = path.dirname(fileURLToPath(import.meta.url))
    const css = fs.readFileSync(path.join(here, 'IndicatorLibraryDialog.module.css'), 'utf8')
    const block = css.slice(css.indexOf('.addAnother {'), css.indexOf('.addAnother:hover'))
    expect(block.length, 'the `.addAnother` rule is gone from the stylesheet — the slice below '
      + 'would satisfy every `toContain` by reading nothing').toBeGreaterThan(60)
    expect(block, 'the Add-another button is no longer a 44px touch target; this dialog is a '
      + 'BOTTOM SHEET on a phone and the button sits in a row a thumb has to hit')
      .toMatch(/min-height:\s*var\(--tap-min\)/)
    expect(block, 'control: the slice really is the .addAnother rule').toContain('margin-left: auto')

    for (const rel of ['IndicatorLibraryDialog.module.css',
      '../mobile/Sheet.module.css', '../mobile/ContextPopover.module.css']) {
      const src = fs.readFileSync(path.join(here, rel), 'utf8')
      expect(src.length, `${rel} read as empty — the absence below is vacuous`).toBeGreaterThan(200)
      expect(src, `${rel} now declares pointer-events. If it DISABLES them anywhere above this `
        + 'button, the button is unreachable in a browser and every click case in this file '
        + 'still passes — re-derive this claim, do not delete the assertion.')
        .not.toMatch(/pointer-events/)
    }
  })

  it('closed renders nothing at all', () => {
    render(<IndicatorLibraryDialog open={false} onClose={() => {}} settings={base()}
                                   onChange={vi.fn()} registry={engineRegistry} />)
    expect(screen.queryByRole('searchbox')).toBeNull()
  })
})
