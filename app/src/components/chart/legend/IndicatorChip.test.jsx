import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import IndicatorChip from './IndicatorChip'
import { stripComments } from '../engine/__tests__/sourceScan'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CSS = readFileSync(path.join(HERE, 'IndicatorChip.module.css'), 'utf-8')
const SRC = readFileSync(path.join(HERE, 'IndicatorChip.jsx'), 'utf-8')
const LEGEND_CSS = readFileSync(
  path.resolve(HERE, '..', '..', 'StockChart.module.css'), 'utf-8')

/** The CSS with every run of whitespace gone — the artifact reads below compare
 *  DECLARATIONS, not formatting. */
const flat = CSS.replace(/\s+/g, '')
/** Everything BEFORE the first `@media` — the desktop/default cascade. Scoping
 *  matters in both directions: a default-block claim read over the whole file
 *  would be satisfied (or falsified) by a media-query rule that says the
 *  opposite deliberately. */
const baseBlock = CSS.slice(0, CSS.indexOf('@media'))

const CHIP = {
  defId: 'rsi', plotKey: 'rsi', instanceId: 'legacy:rsi',
  label: 'RSI(14)', color: '#7b68ee', decimals: 1, value: 54.3,
  hidden: false, text: 'RSI(14) 54.3',
}
const handlers = () => ({
  onToggleHidden: vi.fn(), onOpenSettings: vi.fn(), onRemove: vi.fn(), onMenu: vi.fn(),
})
const draw = (over = {}, h = handlers()) =>
  ({ h, ...render(<IndicatorChip chip={{ ...CHIP, ...over }} {...h} />) })

afterEach(cleanup)

describe('IndicatorChip — the controls, and the one line that makes them reachable', () => {
  // ═════════════════════════════════════════════════════════════════════════
  // ⛔ THE ARTIFACT GATES. A GREEN `click()` PROVES NOTHING ABOUT REACHABILITY.
  //
  // `StockChart.module.css` `.legend` is `pointer-events: none` and it INHERITS.
  // jsdom implements no pointer-events hit-testing, so every `fireEvent.click`
  // below would pass just as happily on a control no human could reach — which is
  // literally what happened to the `+N` button one task ago. So reachability is
  // asserted on the CSS FILE, in BOTH directions, and the interaction cases are
  // about WIRING (which handler, which id), not about whether a click can land.
  // ═════════════════════════════════════════════════════════════════════════

  it('⛔ the chip RE-ENABLES pointer events — without this line nothing here is clickable', () => {
    expect(flat, 'the chip does not re-enable pointer events: it inherits '
      + '`pointer-events: none` from `.legend`, so the hover row, the tooltip and the '
      + 'right-click menu are all unreachable in a browser — and every jsdom click in '
      + 'this file still passes')
      .toMatch(/\.chip\{[^}]*pointer-events:auto;/)
  })

  it('⛔ …and the OTHER direction: the legend box really is what turns them off', () => {
    // Half an artifact gate is a stale premise waiting to happen. If `.legend`
    // ever stops disabling pointer events, the line above becomes a no-op nobody
    // re-reads — so the premise is asserted where a reader will meet it.
    const legendBlock = LEGEND_CSS.slice(LEGEND_CSS.indexOf('\n.legend {')).slice(0, 400)
    expect(legendBlock,
      'the legend box no longer disables pointer events — re-derive why `.chip` re-enables them')
      .toContain('pointer-events: none')
    // …and the control: the slice really is the `.legend` rule and not an empty
    // read that would contain nothing either way.
    expect(legendBlock, 'the `.legend` rule was not found — this gate read nothing').toContain('position: absolute')
  })

  it('⛔ the reveal is CSS — collapsed by default, opened by :hover AND :focus-within', () => {
    expect(flat, 'the control row is not collapsed by default — every chip carries ~60px '
      + 'of dead box and the strip wraps').toMatch(/\.chipControls\{[^}]*max-width:0;/)
    expect(flat, 'no :hover reveal — the controls can never open with a mouse')
      .toMatch(/\.chip:hover\.chipControls|\.chip:hover\s*\.chipControls/)
    expect(CSS.replace(/\s+/g, ' '),
      'no :focus-within reveal — a keyboard user can tab into the controls and never see them')
      .toMatch(/\.chip:focus-within \.chipControls/)
    // ⛔ AND NOT `display: none`, which is the obvious way to write this and the
    // one that puts the controls out of the tab order — at which point
    // `:focus-within` can never fire and the keyboard path above is decorative.
    //
    // ⚠️ SCOPED TO THE DEFAULT BLOCK, because the PHONE query legitimately does
    // hide the row (`display: none`) — there the bottom sheet is the control
    // surface. A whole-file read would have failed on that rule and the obvious
    // "fix" would have been to delete this assertion.
    expect(baseBlock.replace(/\s+/g, ''),
      'the collapsed state is `display:none`, so the controls cannot be focused '
      + 'and the :focus-within reveal is unreachable')
      .not.toMatch(/\.chipControls\{[^}]*display:none;/)
  })

  it('⛔ 44px on touch — the tap-target minimum, inside the canonical touch query', () => {
    const touch = CSS.slice(CSS.indexOf('@media (max-width: 1024px)'))
    expect(touch.length, 'there is no touch media query at all — this gate read nothing')
      .toBeGreaterThan(80)
    const block = touch.slice(0, touch.indexOf('@media', 10))
    expect(block.replace(/\s+/g, ''),
      'the controls are not 44px on touch — `--tap-min` is the app-wide minimum and a 16px '
      + 'icon button is not reachable with a thumb')
      .toMatch(/\.chipBtn\{[^}]*min-width:var\(--tap-min\);/)
    expect(block.replace(/\s+/g, ''), 'the controls are not 44px TALL on touch')
      .toMatch(/\.chipBtn\{[^}]*min-height:var\(--tap-min\);/)
    // …and the row is OPEN there, because touch has no hover to open it with.
    expect(block.replace(/\s+/g, ''),
      'the control row stays collapsed on touch, where no `:hover` can ever fire')
      .toMatch(/\.chipControls\{[^}]*opacity:1;/)
  })

  it('⛔ the controls are RENDERED, not hook-gated — the first-paint trap, from SOURCE', () => {
    // ⛔ THE ONE THAT MATTERS. `useMediaQuery` seeds from `matchMedia` at MOUNT and
    // only updates on a `change` event; in a fixed mobile context that event never
    // arrives, so a `useIsTouch()` branch renders the DESKTOP variant on a phone
    // forever. Comment-stripped, because this file's own prose names all three.
    const code = stripComments(SRC)
    for (const hook of ['useIsTouch', 'useMediaQuery', 'useBreakpoint', 'useIsPhone']) {
      expect(code, `${hook} decides what this component renders — that read is stale at first `
        + 'paint and a phone gets the desktop chip').not.toContain(hook)
    }
    expect(code, 'the source probe read nothing — the stripper ate the file').toContain('chipControls')
  })

  // ── wiring ────────────────────────────────────────────────────────────────

  it('the three controls are in the DOM with NO hover event, and there are exactly three', () => {
    const { container } = draw()
    expect(container.querySelectorAll('button')).toHaveLength(3)
  })

  it('…and the control strip adds NO TEXT — one element, one text node, still', () => {
    // 22 assertions in `legendFromDefinitions.test.jsx` read `el.textContent` off
    // the chip. Three icon buttons with a label in `aria-label` and nothing in the
    // node keep every one of them reading exactly what it read before.
    const { container } = draw()
    const chip = container.querySelector('[data-instance-id]')
    expect(chip.textContent).toBe('RSI(14) 54.3')
  })

  it('clicking the eye toggles hidden — once, with the INSTANCE id, and nothing else fires', () => {
    const { container, h } = draw()
    fireEvent.click(container.querySelector('[aria-label="Hide RSI(14)"]'))
    expect(h.onToggleHidden).toHaveBeenCalledTimes(1)
    expect(h.onToggleHidden).toHaveBeenCalledWith('legacy:rsi')
    for (const fn of [h.onOpenSettings, h.onRemove, h.onMenu]) expect(fn).not.toHaveBeenCalled()
  })

  it('clicking the gear opens THIS instance\'s settings', () => {
    const { container, h } = draw()
    fireEvent.click(container.querySelector('[aria-label="RSI(14) settings"]'))
    expect(h.onOpenSettings).toHaveBeenCalledTimes(1)
    expect(h.onOpenSettings).toHaveBeenCalledWith('legacy:rsi')
    for (const fn of [h.onToggleHidden, h.onRemove, h.onMenu]) expect(fn).not.toHaveBeenCalled()
  })

  it('clicking × removes THIS instance', () => {
    const { container, h } = draw()
    fireEvent.click(container.querySelector('[aria-label="Remove RSI(14)"]'))
    expect(h.onRemove).toHaveBeenCalledTimes(1)
    expect(h.onRemove).toHaveBeenCalledWith('legacy:rsi')
    for (const fn of [h.onToggleHidden, h.onOpenSettings, h.onMenu]) expect(fn).not.toHaveBeenCalled()
  })

  it('a right-click opens the menu at the pointer, and eats the browser default', () => {
    const { container, h } = draw()
    const chip = container.querySelector('[data-instance-id]')
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 44 })
    fireEvent(chip, ev)
    // ⚠️ THE WHOLE ROW, not the id: one instance can own several chips (MACD's
    // line and its signal), so an id alone cannot say WHICH chip was clicked and
    // the caller would have to guess "the first one with this instance id".
    expect(h.onMenu).toHaveBeenCalledWith(
      expect.objectContaining({ instanceId: 'legacy:rsi', plotKey: 'rsi', label: 'RSI(14)' }),
      { x: 120, y: 44 })
    // ⛔ …AND IT EATS THE BROWSER DEFAULT. `useLongPress` does not call
    // `preventDefault` for us, so without this line the native context menu opens
    // ON TOP of ours.
    expect(ev.defaultPrevented, 'the native browser menu still opens over ours').toBe(true)
  })

  it('⛔ …and the event STOPS at the chip — with its own positive control', () => {
    // The second half of the same handler. A right-click that keeps travelling
    // reaches whatever is listening above and opens a SECOND menu next to ours.
    //
    // ⚠️ NOT `ev.cancelBubble` — MEASURED, jsdom does not report it after React's
    // synthetic dispatch has finished, so that read is `false` on a handler that
    // really did call `stopPropagation` and the assertion would have been a lie in
    // the passing direction. The observable fact is whether an ancestor handler runs.
    const spy = vi.fn()
    const h = handlers()
    const { container } = render(
      <div onContextMenu={spy}><IndicatorChip chip={CHIP} {...h} /></div>)
    fireEvent.contextMenu(container.querySelector('[data-instance-id]'))
    expect(spy, 'the right-click reached the ancestor — the chart region menu opens too')
      .not.toHaveBeenCalled()
    expect(h.onMenu, 'the chip menu never opened — the absence above is vacuous').toHaveBeenCalled()

    cleanup()
    // ⛔ THE POSITIVE CONTROL: the ancestor handler DOES fire when the chip is not
    // the one stopping it, so the absence above is a property of the handler and
    // not of the fixture.
    const spy2 = vi.fn()
    const { container: c2 } = render(
      <div onContextMenu={spy2}><IndicatorChip chip={CHIP} /></div>)
    fireEvent.contextMenu(c2.querySelector('[data-instance-id]'))
    expect(spy2, 'an ancestor never sees a contextmenu here at all — the case above proves nothing')
      .toHaveBeenCalledTimes(1)
  })

  it('every control NAMES the chip, and the eye says which way it goes', () => {
    const labels = (over) => [...draw(over).container.querySelectorAll('button')]
      .map(b => b.getAttribute('aria-label'))
    expect(labels()).toEqual(['Hide RSI(14)', 'RSI(14) settings', 'Remove RSI(14)'])
    cleanup()
    // ⛔ "Hide" on a chip that is already hidden is a lie, and the chip's own
    // dimming is the only other thing on screen that says which state it is in.
    expect(labels({ hidden: true })[0]).toBe('Show RSI(14)')
  })

  it('⛔ a READ-ONLY mount gets the inert chip — no controls, no tooltip, no menu', () => {
    // The same gate the region menu's `<label> settings…` row uses: a mount with
    // no drawing tools (Model Book, a grid cell, the export route) passes no
    // handlers and must not sprout a control that writes nowhere.
    const { container } = render(<IndicatorChip chip={CHIP} />)
    expect(container.querySelectorAll('button')).toHaveLength(0)
    const chip = container.querySelector('[data-instance-id]')
    expect(chip.getAttribute('title'),
      'an inert chip advertises a right-click menu it does not have').toBeNull()
    expect(chip.textContent).toBe('RSI(14) 54.3')
  })

  it('⛔ …and a PARTIAL handler set renders none of them', () => {
    // Two controls out of three is a worse lie than none: the missing one reads
    // as "this chip cannot be removed" rather than as "this mount is read-only".
    const { container } = render(
      <IndicatorChip chip={CHIP} onToggleHidden={vi.fn()} onOpenSettings={vi.fn()} />)
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })
})
