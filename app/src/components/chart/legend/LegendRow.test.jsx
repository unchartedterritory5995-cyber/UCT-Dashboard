import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import LegendRow from './LegendRow'

// ─── THE LEGEND ROW FOR THE THINGS THAT ARE NOT ENGINE INSTANCES ────────────
//
// The moving averages and the volume pane had no legend controls at all, for a
// reason that stopped being true: they were not removable, so a "remove" would
// have written nowhere. `chartDefaults`'s overlay TOMBSTONE gave them the verb;
// this component gives them the buttons. What only a test can hold still is the
// LAYOUT CONTRACT — the owner's rule that the numbers must not move when the
// controls appear — and the read-only gate.

// ⚠️ RESOLVED FROM THIS FILE, NOT FROM `process.cwd()`. The sibling chip suite
// does the same: `process.cwd()` is the runner's directory, which is a different
// thing from the module's, and the eslint config does not declare it as a global
// in `src/` at all.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(path.resolve(HERE, rel), 'utf8')

// ⚰️ THREE MOCKS, ONE PER ICON, UNTIL TRACK B. The verbs did not go away —
// they are rows of the popover this ONE door opens — but a row that took three
// write handlers was a row that knew about three controls it no longer renders.
const handlers = () => ({ onOpen: vi.fn() })

describe('LegendRow — the three verbs', () => {
  it('renders label, value and ONE control while hovered', () => {
    const h = handlers()
    render(<LegendRow rowId="ma:0" label="EMA 9" value="319.82" vertical {...h} />)
    expect(screen.getByText('EMA 9')).toBeTruthy()
    expect(screen.getByText('319.82')).toBeTruthy()
    // ⚰️ `Hide EMA 9` / `EMA 9 settings` / `Remove EMA 9` STOOD HERE. One
    // affordance, one popover — and the destructive verb is no longer a
    // neighbouring 11px icon.
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].getAttribute('aria-label')).toBe('EMA 9 options')
    expect(buttons[0].getAttribute('aria-haspopup')).toBe('menu')
  })

  it('⭐ keeps the control MOUNTED and collapses it in CSS — never conditional', () => {
    // ⚰️ THE FIRST DRAFT RENDERED THESE ONLY WHILE A REACT `hovered` PROP WAS
    // TRUE, and that is precisely why they could not be clicked: `.legend` is
    // `pointer-events: none`, so the gaps between the row's cells were not hit
    // targets, the pointer "left" on the way to the buttons, and React tore them
    // out mid-approach. Mounting always and collapsing the CELL is what keeps the
    // gutter at zero without making the control depend on a hover signal — and
    // it is the only way `:focus-within` can ever open it for a keyboard user.
    const h = handlers()
    render(<LegendRow rowId="ma:0" label="EMA 9" value="319.82" vertical {...h} />)
    expect(screen.getByRole('button', { name: 'EMA 9 options' }), 'the control is conditional again')
      .toBeTruthy()
  })

  it('⛔ ONE HANDLER OR NONE — a read-only mount gets an inert row', () => {
    // ⚰️ THE GATE USED TO BE ALL-THREE-OR-NONE, because a row carrying two of
    // three controls is a worse lie than one carrying none. With one door the
    // gate is simply that door — and it still keeps the `/r/chart` export
    // route's legend button-free and its 46 pixel-parity baselines still.
    const { unmount } = render(
      <LegendRow rowId="ma:0" label="EMA 9" value="1" vertical onHover={vi.fn()} />,
    )
    expect(screen.queryByRole('button'), 'a hover-only mount rendered a control').toBeNull()
    unmount()
    render(<LegendRow rowId="ma:0" label="EMA 9" value="1" vertical />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('a hidden row is marked hidden for CSS, and the popover is still reachable', () => {
    // ⚰️ `Show EMA 9` WAS AN ARIA-LABEL ON AN EYE. The direction now lives on
    // the popover's Hide/Show row (`chipMenu.chipMenuItems`), which is the only
    // place it can name the row AND state which way it goes. What the ROW still
    // owes the stylesheet is `data-hidden`, which is what dims it and dashes its
    // rail.
    const h = handlers()
    render(<LegendRow rowId="ma:0" label="EMA 9" value="" hidden vertical {...h} />)
    expect(screen.getByRole('button', { name: 'EMA 9 options' })).toBeTruthy()
    expect(document.querySelector('[data-legend-row="ma:0"]').getAttribute('data-hidden')).toBe('true')
  })

  it('the door fires with the ROW ID and stops the event reaching the chart', () => {
    // ⛔ `stopPropagation` IS NOT TIDINESS. The chart wrapper underneath opens a
    // region menu on click; without it, opening a moving average's popover would
    // also open a menu about the region it sits on.
    const h = handlers()
    const onWrapper = vi.fn()
    render(
      <div onClick={onWrapper}>
        <LegendRow rowId="ma:2" label="SMA 50" value="316.68" vertical {...h} />
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'SMA 50 options' }))
    expect(h.onOpen).toHaveBeenCalledWith('ma:2', expect.objectContaining({ x: expect.any(Number) }))
    expect(onWrapper, 'a control click reached the chart underneath').not.toHaveBeenCalled()

    // ⭐ AND THE ROW BODY IS THE SAME DOOR — the label is the button, exactly as
    // it is on an `IndicatorChip`. A right-click on it opens the same popover.
    h.onOpen.mockClear()
    fireEvent.click(document.querySelector('[data-legend-row="ma:2"]'))
    expect(h.onOpen).toHaveBeenCalledTimes(1)
    fireEvent.contextMenu(document.querySelector('[data-legend-row="ma:2"]'))
    expect(h.onOpen, 'right-click opens a different surface').toHaveBeenCalledTimes(2)
    expect(onWrapper).not.toHaveBeenCalled()
  })

  it('⭐ the row carries NO colour swatch, and hover still reports the HOVER KEY', () => {
    // ⚰️ A RAIL STOOD HERE, and before that the row wore `style={{ color }}` on
    // the whole box so the price pane's moving averages printed blue, purple and
    // orange NAMES at 11px. Both are retired (owner, 2026-09-14).
    // ⛔ THE HOVER KEY IS NOT THE ROW ID for a legacy moving average: the row is
    // addressed by its STORED SLOT (`ma:2`) and the drawn series lives at a RENDER
    // index, which differ the moment a tombstone is in the list.
    const h = handlers()
    const onHover = vi.fn()
    const { container } = render(
      <LegendRow rowId="ma:2" label="SMA 50" value="1" color="#c07be0" vertical
        hoverKey="ov:1" onHover={onHover} {...h} />)
    const row = container.querySelector('[data-legend-row="ma:2"]')
    expect(row.style.color, 'the row tints its own text with the line colour again').toBe('')
    expect(row.querySelector('i'), 'a colour rail is back in the row').toBeNull()
    fireEvent.mouseEnter(row)
    expect(onHover).toHaveBeenCalledWith('ov:1')
    fireEvent.mouseLeave(row)
    expect(onHover).toHaveBeenLastCalledWith(null)
  })

  it('⛔ the gutter takes NO WIDTH in either state — the legend cannot move', () => {
    // The CSS artifact, because jsdom lays nothing out. `.vCtl` used to be
    // `width: 0` at rest and `width: auto` on hover, which widened the legend's
    // third track, moved its right edge and crept over the next gridline.
    const css = read('./LegendRow.module.css').replace(/\s+/g, '')
    expect(css, 'the vertical gutter is back in the flow')
      .toMatch(/\.vCtl\{[^}]*position:absolute;/)
    expect(css, 'the horizontal gutter is back in the flow')
      .toMatch(/\.flatCtl\{[^}]*position:absolute;/)
    for (const sel of ['vCtl', 'flatCtl']) {
      expect(css, `${sel} is visible at rest`).toMatch(new RegExp(`\\.${sel}\\{[^}]*opacity:0;`))
      expect(css, `${sel} eats pointer events while invisible`)
        .toMatch(new RegExp(`\\.${sel}\\{[^}]*pointer-events:none;`))
    }
    // ⛔ AND THE ROWS ARE THE CONTAINING BLOCK, or `left: 100%` resolves against
    // something far away and the control lands in the wrong place.
    expect(css).toMatch(/\.vRow\{[^}]*position:relative;/)
    expect(css).toMatch(/\.flat\{[^}]*position:relative;/)
  })

  it('🔴 the vertical variant is ONE row box holding THREE subgrid cells', () => {
    // 🔴 BOTH HALVES OF THIS ARE BUG FIXES THE OWNER REPORTED.
    // ONE BOX: three loose sibling cells left the column GAPS un-hittable
    // (`.legend` is `pointer-events: none`), so the controls vanished mid-approach
    // and flickered between a label and its own value.
    // THREE CELLS: the row borrows the legend's tracks through `subgrid`, and a
    // row that emitted two would leave the control column unclaimed on that line.
    const h = handlers()
    const { container } = render(<LegendRow rowId="ma:0" label="EMA 9" value="319.82" vertical {...h} />)
    expect(container.children, 'the row is not a single box').toHaveLength(1)
    expect(container.firstChild.children, 'the row does not claim all three tracks').toHaveLength(3)
  })
})

describe('LegendRow — the CSS artifact', () => {
  // ⛔ ASSERTED ON THE STYLESHEET, NEVER ON A SYNTHETIC CLICK. `.legend` is
  // `pointer-events: none` (the box sits over the chart and must not swallow the
  // crosshair) and that INHERITS — so a row without its own `pointer-events: auto`
  // is unreachable in a browser while every `button.click()` in this file still
  // passes, because jsdom implements no pointer-events hit-testing. That is
  // exactly how the `+N` button shipped un-clickable for an hour.
  const css = () => read('./LegendRow.module.css')

  /** One rule's declaration block, brace to brace.
   *  ⛔ NOT A FIXED-LENGTH SLICE. The first draft read 400 characters from the
   *  selector and `.vLabel`'s block opens with a 14-line comment explaining WHY
   *  it re-enables pointer events — so the slice ended before the declaration it
   *  was looking for and the case failed on a file that was correct. A probe that
   *  can be defeated by a comment is measuring the comment. */
  const ruleBlock = (src, cls) => {
    const at = src.indexOf(`${cls} {`)
    expect(at, `${cls} has no rule in this stylesheet`).toBeGreaterThan(-1)
    return src.slice(at, src.indexOf('}', at) + 1)
  }

  it('re-enables pointer events, on the row AND on the buttons', () => {
    const src = css()
    // ⛔ THE ROW, NOT ITS CELLS. The row is the hover box now; a cell that
    // re-enabled pointer events would not help, because the gaps between cells
    // belong to the row.
    for (const cls of ['.vRow', '.flat', '.btn']) {
      expect(ruleBlock(src, cls), `${cls} does not re-enable pointer events`)
        .toMatch(/pointer-events:\s*auto/)
    }
  })

  it('⛔ …and the PARENT still disables them — the premise, not a stale memory', () => {
    // A gate whose premise nobody re-checks is a gate that quietly stops meaning
    // anything. If `.legend` ever stops being `pointer-events: none`, the rule
    // above is cargo and this case says so.
    const legend = read('../../StockChart.module.css')
    const block = legend.slice(legend.indexOf('\n.legend {'))
    expect(block.slice(0, 600), 'the legend no longer disables pointer events')
      .toMatch(/pointer-events:\s*none/)
  })

  it('🔴 the vertical row is a SUBGRID — that is what keeps the columns aligned', () => {
    // Without it the row would be an ordinary grid item and its label/value would
    // size to their OWN content, so every row's value would land on a different
    // right edge — the alignment the owner asked for in the first place. The row
    // has to be one box (for hover) AND share the legend's tracks (for
    // alignment), and `subgrid` is the only thing that is both.
    const block = ruleBlock(css(), '.vRow')
    expect(block).toMatch(/grid-template-columns:\s*subgrid/)
    expect(block).toMatch(/grid-column:\s*1\s*\/\s*-1/)
  })

  it('🔴 the reveal is `:has(:focus-visible)` — NEVER `:focus-within`', () => {
    // ⚰️ MEASURED BY THE OWNER: click a row's eye, move to the next indicator, and
    // BOTH rows showed their buttons. A mouse click leaves DOM focus on the
    // button, `:focus-within` stays true for as long as it is there, and nothing
    // takes it away — so the row you had just acted on stayed open behind the one
    // you moved to and the legend claimed two rows were live at once.
    //
    // ⛔ AND THE ANSWER IS NOT `blur()` ON CLICK, which would snatch the strip
    // away from a KEYBOARD user the moment they activated anything in it — the
    // exact population the focus rule exists for. `:focus-visible` is the
    // distinction the platform already draws: set for tab-navigation, not for a
    // pointer click. Both files that reveal a legend strip are checked, because
    // they drifted apart once already.
    for (const f of ['./LegendRow.module.css', './IndicatorChip.module.css']) {
      const src = read(f)
      expect(src, `${f} reveals on :focus-within — a clicked row will stay open`)
        .not.toMatch(/:focus-within\s*\.?[\w-]*\s*\{|:focus-within\s+\./)
      expect(src, `${f} lost its keyboard reveal entirely`).toMatch(/:has\(:focus-visible\)/)
    }
  })

  it('⛔ contains no class whose name includes "legend"', () => {
    // The export route (`pages/ChartRender.jsx`) hides `[class*="legend" i]` and
    // re-shows `[class*="volLegend" i]`; a class here matching the second rule
    // would un-hide the strip inside every branded export and move all 46
    // pixel-parity baselines. These rows inherit the hide as DESCENDANTS.
    const offenders = (css().match(/^\.[A-Za-z][\w-]*/gm) || []).filter(c => /legend/i.test(c))
    expect(offenders).toEqual([])
  })
})
