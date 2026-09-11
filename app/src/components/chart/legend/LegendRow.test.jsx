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

const handlers = () => ({
  onToggleHidden: vi.fn(),
  onOpenSettings: vi.fn(),
  onRemove: vi.fn(),
})

describe('LegendRow — the three verbs', () => {
  it('renders label, value and all three controls while hovered', () => {
    const h = handlers()
    render(<LegendRow rowId="ma:0" label="EMA 9" value="319.82" vertical {...h} />)
    expect(screen.getByText('EMA 9')).toBeTruthy()
    expect(screen.getByText('319.82')).toBeTruthy()
    for (const name of ['Hide EMA 9', 'EMA 9 settings', 'Remove EMA 9']) {
      expect(screen.getByRole('button', { name }), `no ${name}`).toBeTruthy()
    }
  })

  it('⭐ keeps the controls MOUNTED and collapses them in CSS — never conditional', () => {
    // ⚰️ THE FIRST DRAFT RENDERED THESE ONLY WHILE A REACT `hovered` PROP WAS
    // TRUE, and that is precisely why they could not be clicked: `.legend` is
    // `pointer-events: none`, so the gaps between the row's cells were not hit
    // targets, the pointer "left" on the way to the buttons, and React tore them
    // out mid-approach. Mounting them always and collapsing the CELL is what
    // keeps the gutter at zero without making the control depend on a hover
    // signal — and it is the only way `:focus-within` can ever open the strip for
    // a keyboard user.
    const h = handlers()
    render(<LegendRow rowId="ma:0" label="EMA 9" value="319.82" vertical {...h} />)
    expect(screen.getByRole('button', { name: 'Hide EMA 9' }), 'the controls are conditional again')
      .toBeTruthy()
  })

  it('⛔ ALL THREE HANDLERS OR NONE — a read-only mount gets an inert row', () => {
    // The same gate `IndicatorChip` uses. A row carrying two of three controls is
    // a worse lie than one carrying none, so a partial set renders none — which
    // is also what keeps the `/r/chart` export route's legend button-free and its
    // 46 pixel-parity baselines still.
    const { unmount } = render(
      <LegendRow rowId="ma:0" label="EMA 9" value="1" vertical onToggleHidden={vi.fn()} onRemove={vi.fn()} />,
    )
    expect(screen.queryByRole('button'), 'a partial handler set rendered controls').toBeNull()
    unmount()
    render(<LegendRow rowId="ma:0" label="EMA 9" value="1" vertical />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('the eye says SHOW on a hidden row, and the row is marked hidden for CSS', () => {
    const h = handlers()
    render(<LegendRow rowId="ma:0" label="EMA 9" value="" hidden vertical {...h} />)
    expect(screen.getByRole('button', { name: 'Show EMA 9' })).toBeTruthy()
    expect(document.querySelector('[data-legend-row="ma:0"]').getAttribute('data-hidden')).toBe('true')
  })

  it('every control fires with the ROW ID and stops the event reaching the chart', () => {
    // ⛔ `stopPropagation` IS NOT TIDINESS. The chart wrapper underneath opens a
    // region menu on click; without it, hiding a moving average would also open a
    // menu about the region it was hidden from.
    const h = handlers()
    const onWrapper = vi.fn()
    render(
      <div onClick={onWrapper}>
        <LegendRow rowId="ma:2" label="SMA 50" value="316.68" vertical {...h} />
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Hide SMA 50' }))
    fireEvent.click(screen.getByRole('button', { name: 'SMA 50 settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove SMA 50' }))
    expect(h.onToggleHidden).toHaveBeenCalledWith('ma:2')
    expect(h.onOpenSettings).toHaveBeenCalledWith('ma:2')
    expect(h.onRemove).toHaveBeenCalledWith('ma:2')
    expect(onWrapper, 'a control click reached the chart underneath').not.toHaveBeenCalled()
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
