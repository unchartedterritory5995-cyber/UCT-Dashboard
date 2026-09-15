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
/** Everything BEFORE the first `@media`, whitespace-stripped — the desktop /
 *  default cascade. Scoping matters in both directions: a default-block claim
 *  read over the whole file would be satisfied (or falsified) by a media-query
 *  rule that says the opposite deliberately. The hover and focus rules below are
 *  read through THIS and not through `flat`, because the phone tier redefines
 *  the chip entirely and a `.rowLive` rule hiding in there would not be the one
 *  a desktop member gets. */
const baseBlock = CSS.slice(0, CSS.indexOf('@media')).replace(/\s+/g, '')

const CHIP = {
  defId: 'rsi', plotKey: 'rsi', instanceId: 'legacy:rsi',
  label: 'RSI(14)', color: '#7b68ee', decimals: 1, value: 54.3,
  hidden: false, text: 'RSI(14) 54.3',
}
// ⚰️ THIS USED TO BE FOUR MOCKS — `onToggleHidden`, `onOpenSettings`,
// `onRemove` and `onMenu`, one per icon in the hover strip plus the right-click.
// Track B retired the strip: there is ONE door now and every verb is a row of
// the popover it opens, so a chip that took three write handlers was a chip that
// knew about three verbs it no longer renders.
const handlers = () => ({ onMenu: vi.fn() })
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

  it('⛔ THERE IS NO CONTROL — no chevron, no gutter, no reserved space', () => {
    // ⚰️⚰️ TWO GENERATIONS OF CONTROL DIED HERE. First an eye/gear/✕ strip that
    // collapsed `max-width: 0 → 82px`; then a single chevron that had to be taken
    // out of flow to stop widening the legend, at which point it detached from
    // its own label and, horizontally, sat over the next one. The owner retired
    // the idea after production use: the ROW is the control.
    expect(flat, 'a control strip is back in the stylesheet').not.toMatch(/\.chipControls\{/)
    expect(flat, 'a control button is back in the stylesheet').not.toMatch(/\.chipBtn\{/)
    expect(SRC, 'a chevron is back in the component').not.toMatch(/chevronDown/)
    expect(SRC, 'a control button is back in the component').not.toMatch(/<button/)
  })

  it('⭐ hover is a faint background and NOTHING else', () => {
    // ⛔ THE ONLY THING A HOVER MAY DO. It must not reveal, must not move, must
    // not tint gold and must not reach the renderer — the whole point of the
    // retirement is that pointing at a label stops changing the chart.
    expect(baseBlock, 'the manageable row has no hover treatment at all')
      .toMatch(/\.rowLive:hover\{background:rgba\(255,255,255,0\.055\);\}/)
    expect(baseBlock, 'the row does not advertise itself as interactive')
      .toMatch(/\.rowLive\{cursor:pointer;\}/)
    // ⛔ NO GOLD ON HOVER — gold is the selection/accent colour, and this is a
    // passive affordance. The keyboard ring may use it; the hover may not.
    const hoverRule = /\.rowLive:hover\{([^}]*)\}/.exec(baseBlock)
    expect(hoverRule[1], 'the hover state uses the accent colour').not.toMatch(/dcbb5e|--accent/)
  })

  it('⛔ the keyboard gets a ring, the mouse does not', () => {
    // `:focus-visible`, never `:focus` — a mouse click leaves DOM focus on the row,
    // so a plain `:focus` ring would sit behind whatever the member moved to next.
    // The same distinction the retired reveal rules drew, for the same reason.
    expect(baseBlock).toMatch(/\.rowLive:focus\{outline:none;\}/)
    expect(baseBlock).toMatch(/\.rowLive:focus-visible\{/)
  })

  it('⛔ nothing is rendered off a breakpoint hook — the first-paint trap, from SOURCE', () => {
    // `useMediaQuery` seeds from `matchMedia` at MOUNT and only updates on a
    // `change` event, so in a fixed mobile context a JS read renders the DESKTOP
    // variant on a phone and never corrects itself. This file must not import one.
    const src = stripComments(SRC)
    for (const name of ['useIsTouch', 'useMediaQuery', 'useBreakpoint']) {
      expect(src, `${name} is imported — a hook-gated variant is wrong at first paint`)
        .not.toMatch(new RegExp(name))
    }
  })

  it('⭐ the CHIP is the trigger: role, tab order and aria all on the chip itself', () => {
    const { container } = draw()
    const chip = container.querySelector('[data-instance-id]')
    expect(container.querySelectorAll('button'), 'a control button is back').toHaveLength(0)
    expect(chip.getAttribute('role')).toBe('button')
    expect(chip.getAttribute('tabindex')).toBe('0')
    expect(chip.getAttribute('aria-haspopup')).toBe('menu')
  })

  // ── wiring ────────────────────────────────────────────────────────────────

  it('⛔ there are ZERO controls — the chip itself is the only target', () => {
    // ⚰️ THREE, THEN ONE, THEN NONE. Each generation shrank the control and each
    // kept the same problem: something had to appear, and appearing costs either
    // layout (a collapsed gutter widened the legend) or adjacency (an out-of-flow
    // one landed over the neighbour). Nothing appears now.
    const { container } = draw()
    expect(container.querySelectorAll('button')).toHaveLength(0)
    expect(container.querySelector('svg'), 'an icon is back in the chip').toBeNull()
  })

  it('…and the control strip adds NO TEXT — one element, one text node, still', () => {
    // 22 assertions in `legendFromDefinitions.test.jsx` read `el.textContent` off
    // the chip. Three icon buttons with a label in `aria-label` and nothing in the
    // node keep every one of them reading exactly what it read before.
    const { container } = draw()
    const chip = container.querySelector('[data-instance-id]')
    expect(chip.textContent).toBe('RSI(14) 54.3')
  })

  it('⭐⭐ clicking the chip opens the SAME popover the right-click does', () => {
    const { container, h } = draw()
    fireEvent.click(container.querySelector('[data-instance-id]'))
    expect(h.onMenu).toHaveBeenCalledTimes(1)
    // ⚠️ THE WHOLE ROW, not the id — one instance can own several chips.
    expect(h.onMenu.mock.calls[0][0]).toMatchObject({ instanceId: 'legacy:rsi', plotKey: 'rsi' })
  })

  it('⭐ Enter and Space open it too — the row is a real menu trigger', () => {
    for (const key of ['Enter', ' ']) {
      cleanup()
      const h = handlers()
      const { container } = render(<IndicatorChip chip={CHIP} {...h} />)
      fireEvent.keyDown(container.querySelector('[data-instance-id]'), { key })
      expect(h.onMenu, `${key} did not open the menu`).toHaveBeenCalledTimes(1)
    }
  })

  it('⛔ …and the click STOPS at the chip', () => {
    // A click that keeps travelling reaches the chart wrapper and opens its
    // region menu beside ours.
    const spy = vi.fn()
    const h = handlers()
    const { container } = render(<div onClick={spy}><IndicatorChip chip={CHIP} {...h} /></div>)
    fireEvent.click(container.querySelector('[data-instance-id]'))
    expect(spy, 'the click reached the ancestor — the chart region menu opens too')
      .not.toHaveBeenCalled()
    expect(h.onMenu, 'the popover never opened — the absence above is vacuous').toHaveBeenCalled()
  })

  it('⭐ a right-click opens the menu anchored to the CHIP, and eats the browser default', () => {
    const { container, h } = draw()
    const chip = container.querySelector('[data-instance-id]')
    chip.getBoundingClientRect = () => ({ left: 40, bottom: 90, top: 70, right: 160, width: 120, height: 20 })
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 44 })
    fireEvent(chip, ev)
    expect(h.onMenu).toHaveBeenCalledWith(
      expect.objectContaining({ instanceId: 'legacy:rsi', plotKey: 'rsi', label: 'RSI(14)' }),
      { x: 40, y: 93 })
    // ⚰️ IT USED TO ANCHOR AT `{clientX, clientY}` — 120,44 here. A pointer anchor
    // cannot serve a KEYBOARD activation, which has no coordinates at all, so the
    // element's own rectangle serves every input and the menu always hangs off the
    // thing it is about.
    expect(h.onMenu.mock.calls[0][1]).not.toEqual({ x: 120, y: 44 })
    // ⛔ …AND IT EATS THE BROWSER DEFAULT. `useLongPress` does not call
    // `preventDefault` for us, so without it the native menu opens ON TOP of ours.
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

  it('⛔ an interactive chip advertises a menu; a read-only one advertises nothing', () => {
    const { container } = draw()
    const chip = container.querySelector('[data-instance-id]')
    expect(chip.getAttribute('aria-haspopup')).toBe('menu')
    // ⛔ A READ-ONLY CHIP IS NOT A BUTTON AND IS NOT IN THE TAB ORDER. Announcing
    // a control that opens nothing is worse than announcing plain text.
    cleanup()
    const { container: c2 } = render(<IndicatorChip chip={CHIP} />)
    const inert = c2.querySelector('[data-instance-id]')
    expect(inert.getAttribute('role')).toBeNull()
    expect(inert.getAttribute('tabindex')).toBeNull()
    expect(inert.getAttribute('aria-haspopup')).toBeNull()
  })

  it('⭐⭐ the chip WEARS ITS PLOT COLOUR — label and value alike, and no swatch', () => {
    // ⚰️ A 2×9px `<i>` RAIL STOOD BEFORE EVERY NAME, because Track B had
    // neutralised the text. Both are retired and the ORDER matters: the rail went
    // first (nine little coloured tabs on a nine-row legend), and then the owner
    // put the colour back where it had always been — *"every plot or label inside
    // the legend … showed up as the color of the plot on the chart"* (2026-09-14).
    // The legend is the chart's key; a key printed in one colour names nothing.
    const { container } = draw()
    const chip = container.querySelector('[data-instance-id]')
    expect(chip.style.color, 'the chip is back to neutral text').toBe('rgb(123, 104, 238)')
    // ⛔ THE VALUE FOLLOWS THE LABEL. `.chipVal` carries the bright legend ink for
    // an uncoloured chip, so a coloured one has to defeat it — `inherit`, not a
    // second copy of the colour, so the box stays the one source of truth.
    const val = chip.querySelector('span')
    expect(val.textContent).toBe('54.3')
    expect(val.style.color, 'the value kept the neutral ink while the label turned').toBe('inherit')
    // ⛔ AND STILL NO SWATCH. The colour is ON the name, not in a tab beside it.
    expect(chip.querySelector('i'), 'a colour rail is back in the chip').toBeNull()
  })

  it('⛔ …and a chip with NO colour keeps the inherited legend ink', () => {
    // The other half, and the reason the rule reads as a rule: an uncoloured row
    // must inherit rather than fall back to black. `LegendRow` relies on the same
    // distinction for O/H/L/C and `Vol`.
    cleanup()
    const { container } = render(<IndicatorChip chip={{ ...CHIP, color: undefined }} {...handlers()} />)
    const chip = container.querySelector('[data-instance-id]')
    expect(chip.style.color, 'an uncoloured chip invented a colour').toBe('')
  })

  it('⛔ …but the plot colour still REACHES the chip, as `--chip-color`', () => {
    // ⛔ THE PIPELINE IS STILL RAILED, AND IT HAS TO BE. On a PHONE the chip is a
    // 10px dot with its text indented off-screen, so that dot is the only thing
    // telling two series apart — and it reads this custom property (see the
    // ≤640px block in `IndicatorChip.module.css`). It is also what keeps W0.1's
    // rail alive: a colour changed in the settings dialog must reach the
    // OFF-CURSOR chip, and this is now where that arrives.
    const { container } = draw()
    const chip = container.querySelector('[data-instance-id]')
    expect(chip.style.getPropertyValue('--chip-color').replace(/\s/g, ''))
      .toBe('#7b68ee')
    expect(CSS.replace(/\s+/g, ''),
      'the phone dot no longer reads the property the component sets')
      .toMatch(/\.chip::before\{[^}]*background:var\(--chip-color/)
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

  it('⛔ A HOVER REACHES NOTHING — the prop is gone and no handler survives it', () => {
    // ⚰️⚰️ `onHover` DROVE THE PLOT LIFT: a pixel added to the drawn series while
    // the pointer sat on its label. The owner retired it after production use —
    // hovering a legend must not mutate the chart. The component must not carry a
    // mouse-enter/leave path at all, or a future caller will wire one back.
    const src = stripComments(SRC)
    expect(src, 'a hover handler is back in the component').not.toMatch(/onMouseEnter|onMouseLeave/)
    expect(src, 'the hover prop is back in the signature').not.toMatch(/onHover/)
  })
})

describe('wave 10 — the body tap (tap-the-legend-name → editor)', () => {
  it('fires onBodyTap with THE ROW on a body click, and the popover never opens', () => {
    const h = handlers()
    const onBodyTap = vi.fn()
    const { container } = render(<IndicatorChip chip={CHIP} {...h} onBodyTap={onBodyTap} />)
    const chip = container.querySelector('[data-instance-id="legacy:rsi"]')
    fireEvent.click(chip)
    expect(onBodyTap).toHaveBeenCalledTimes(1)
    expect(onBodyTap.mock.calls[0][0]).toMatchObject({ defId: 'rsi', instanceId: 'legacy:rsi' })
    // ⛔⛔ AND `onBodyTap` WINS OVER THE POPOVER, WHICH IS WHAT KEEPS THE PHONE
    // SHELL UNCHANGED. The body click opens the popover on every mount that does
    // NOT pass this prop; the phone shell passes it and keeps its own study
    // editor sheet, exactly as before Track B.
    expect(h.onMenu, 'the body tap also opened the popover — the phone shell gets two')
      .not.toHaveBeenCalled()
    // ⛔ …AND SUCH A CHIP IS NOT A MENU TRIGGER. It opens an editor, not a menu,
    // so announcing `aria-haspopup="menu"` would be a lie.
    expect(chip.getAttribute('aria-haspopup')).toBeNull()
  })

  it('⭐ without the prop the body OPENS THE POPOVER — the label is the button', () => {
    // ⚰️ IT USED TO STAY INERT. The approved V1 makes the label itself the
    // primary target: a member should not have to find a 16px chevron to manage
    // the line they are already pointing at.
    const h = handlers()
    const { container } = render(<IndicatorChip chip={CHIP} {...h} />)
    const chip = container.querySelector('[data-instance-id]')
    fireEvent.click(chip)
    expect(h.onMenu).toHaveBeenCalledTimes(1)
  })
})
