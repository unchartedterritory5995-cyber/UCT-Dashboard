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
  it('renders label and value, and NO control at all', () => {
    // ⚰️⚰️ `Hide EMA 9` / `EMA 9 settings` / `Remove EMA 9`, then one chevron.
    // Both generations are retired: the ROW is the control (owner, 2026-09-14,
    // after production use of the chevron).
    const h = handlers()
    render(<LegendRow rowId="ma:0" label="EMA 9" value="319.82" vertical {...h} />)
    expect(screen.getByText('EMA 9')).toBeTruthy()
    expect(screen.getByText('319.82')).toBeTruthy()
    expect(screen.queryAllByRole('button', { hidden: true }).filter((b) => b.tagName === 'BUTTON'))
      .toHaveLength(0)
  })

  it('⭐ the ROW is the trigger — role, tab order and an aria label that names it', () => {
    const h = handlers()
    render(<LegendRow rowId="ma:0" label="EMA 9" value="319.82" vertical {...h} />)
    const row = document.querySelector('[data-legend-row="ma:0"]')
    expect(row.getAttribute('role')).toBe('button')
    expect(row.getAttribute('tabindex')).toBe('0')
    expect(row.getAttribute('aria-haspopup')).toBe('menu')
    // ⛔ THE LABEL NAMES THE ROW. "Options" on six rows is six identical controls
    // to a screen reader.
    expect(row.getAttribute('aria-label')).toBe('EMA 9 options')
  })

  it('⛔ `controlLabel` still names the INSTANCE, not the plot', () => {
    // ⭐ MACD IS WHY IT EXISTS. Its pane prints two rows — `MACD 2.3999` and
    // `SIG 1.6272` — and both act on ONE instance, so `SIG`'s row must announce
    // the thing the menu will act on. The control moved onto the row; the naming
    // rule moved with it.
    const h = handlers()
    render(<LegendRow rowId="inst:macd" label="SIG" value="1.6272" controlLabel="MACD" vertical {...h} />)
    const row = document.querySelector('[data-legend-row="inst:macd"]')
    expect(row.getAttribute('aria-label')).toBe('MACD options')
    expect(row.getAttribute('title')).toMatch(/^MACD/)
  })

  it('⛔ ONE HANDLER OR NONE — a read-only row is not even focusable', () => {
    // ⛔ A ROW THAT OPENS NOTHING MUST NOT ANNOUNCE ITSELF AS A BUTTON or sit in
    // the tab order. `/r/chart`, Model Book and a grid cell all render one, and
    // for them the legend is plain text.
    render(<LegendRow rowId="ma:0" label="EMA 9" value="1" vertical />)
    const row = document.querySelector('[data-legend-row="ma:0"]')
    expect(row.getAttribute('role')).toBeNull()
    expect(row.getAttribute('tabindex')).toBeNull()
    expect(row.getAttribute('aria-haspopup')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('a hidden row is marked hidden for CSS, and the popover is still reachable', () => {
    // ⛔ THE DIRECTION LIVES ON THE POPOVER'S Hide/Show ROW, which is the only
    // place that can state it. What the ROW owes the stylesheet is `data-hidden`,
    // which is what dims it.
    const h = handlers()
    render(<LegendRow rowId="ma:0" label="EMA 9" value="" hidden vertical {...h} />)
    const row = document.querySelector('[data-legend-row="ma:0"]')
    expect(row.getAttribute('data-hidden')).toBe('true')
    fireEvent.click(row)
    expect(h.onOpen).toHaveBeenCalledTimes(1)
  })

  it('the row fires with the ROW ID, anchored to itself, and stops at the chart', () => {
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
    const row = document.querySelector('[data-legend-row="ma:2"]')
    row.getBoundingClientRect = () => ({ left: 12, bottom: 40, top: 22, right: 120, width: 108, height: 18 })

    fireEvent.click(row)
    // ⭐ ANCHORED TO THE ROW, NOT THE POINTER — a keyboard activation has no
    // coordinates, so one anchor serves click, right-click and Enter alike.
    expect(h.onOpen).toHaveBeenCalledWith('ma:2', { x: 12, y: 43 })
    expect(onWrapper, 'a click reached the chart underneath').not.toHaveBeenCalled()

    h.onOpen.mockClear()
    fireEvent.contextMenu(row)
    expect(h.onOpen, 'right-click opens a different surface').toHaveBeenCalledWith('ma:2', { x: 12, y: 43 })

    for (const key of ['Enter', ' ']) {
      h.onOpen.mockClear()
      fireEvent.keyDown(row, { key })
      expect(h.onOpen, `${key} did not open the menu`).toHaveBeenCalledTimes(1)
    }
    expect(onWrapper).not.toHaveBeenCalled()
  })

  it('⭐⭐ the row WEARS ITS LINE COLOUR — no swatch, and no hover handler at all', () => {
    // ⚰️ THE ROW WORE `style={{ color }}`, then a 2×9px rail instead, then an
    // `onHover` that lifted the drawn series by a pixel. The rail and the lift are
    // retired for good; the COLOUR came back the same day, on the owner's report
    // that an indicator's name and value had always printed in the colour of its
    // line. Hovering still reaches nothing but a CSS background.
    const h = handlers()
    const { container } = render(
      <LegendRow rowId="ma:2" label="SMA 50" value="1" color="#c07be0" vertical {...h} />)
    const row = container.querySelector('[data-legend-row="ma:2"]')
    expect(row.style.color, 'the row lost its line colour').toBe('rgb(192, 123, 224)')
    // ⚰️⚰️ "THE VALUE FOLLOWS THE LABEL, BY INHERITING" WAS THE RULE HERE AND IT IS
    // REVERSED. The owner's final colour system is COLOUR = which series, WHITE =
    // the market value: the LABEL carries the hue (it is the identity) and the
    // number is always the same bright neutral, so the eye lands on it first at
    // every hue — including the pale ones, where a coloured value was hardest to
    // read. The row still wears the line colour; only the value opts out.
    expect(screen.getByText('1').style.color,
      'the value is inheriting the series colour again — it must stay bright neutral')
      .toBe('')
    // ⚰️⚰️ THIS ASSERTED `toBeNull()` — "no colour rail" — and the owner reversed it.
    // Track B's rail REPLACED the coloured label, so nine rows read as nine little
    // coloured tabs with neutral text beside them; the retirement was of THAT, not
    // of colour-at-the-head-of-a-row. The micro-rail ACCOMPANIES the coloured label
    // in the same hue, so it reads as the start of the label rather than a mark of
    // its own. It is pinned by `legendV2.test.jsx`, which owns its dimensions.
    expect(row.querySelector('i'), 'the micro-rail left the row').toBeTruthy()
    expect(row.querySelector('i').style.background,
      'the rail stopped taking the row\'s own series colour').toBe('rgb(192, 123, 224)')
    const src = read('./LegendRow.jsx')
    expect(src, 'a hover handler is back in the component').not.toMatch(/onMouseEnter|onMouseLeave/)
  })

  it('⛔ …and a row with NO colour keeps the inherited legend ink', () => {
    // O/H/L/C and `Vol` pass none: they are readings of the instrument, not of a
    // line somebody chose a colour for, and the before-and-after picture the owner
    // sent draws exactly that line.
    render(<LegendRow rowId="volume" label="Vol" value="38.7M" vertical {...handlers()} />)
    const row = document.querySelector('[data-legend-row="volume"]')
    expect(row.style.color, 'an uncoloured row invented a colour').toBe('')
    expect(screen.getByText('38.7M').style.color, 'the value stopped using the legend ink')
      .toBe('')
  })

  it('⛔ the gutter takes NO WIDTH — and the row hover cannot move the legend', () => {
    // A CSS-ARTIFACT ASSERTION, because jsdom lays nothing out. The gutter held a
    // control that was `width: 0 → auto`, then out-of-flow; it holds nothing now
    // and is simply gone from the layout.
    const css = read('./LegendRow.module.css').replace(/\s+/g, '')
    expect(css, 'the vertical gutter takes space again').toMatch(/\.vCtl\{display:none;\}/)
    expect(css, 'a control strip is back').not.toMatch(/\.controls\{/)
    expect(css, 'a control button is back').not.toMatch(/\.btn\{/)
    // ⛔ AND THE HOVER TREATMENT PAINTS ONLY — no padding, no border, no margin,
    // nothing that could reflow a row that is already laid out.
    const hover = /\.rowLive:hover\{([^}]*)\}/.exec(css)
    expect(hover, 'the manageable row has no hover treatment').toBeTruthy()
    expect(hover[1]).toBe('background:rgba(255,255,255,0.055);')
  })

  it('🔴 the vertical variant is ONE row box — rail, label, value', () => {
    // 🔴 THE HALF THAT IS A BUG FIX AND STILL IS: ONE BOX. Three loose sibling
    // cells left the column GAPS un-hittable (`.legend` is `pointer-events: none`),
    // so the controls vanished mid-approach and flickered between a label and its
    // own value. The row is still a single element for exactly that reason.
    //
    // ⚰️ THE OTHER HALF — "THREE SUBGRID CELLS" — IS GONE WITH THE SUBGRID. The row
    // borrowed the legend's tracks so every value landed on one x; that alignment
    // was the invisible table the floating pass removed, and the retired control
    // gutter was the third track. The row now carries a micro-rail, a label and a
    // value, and the count is asserted so a silently dropped cell still fails.
    const h = handlers()
    const { container } = render(<LegendRow rowId="ma:0" label="EMA 9" value="319.82" vertical {...h} />)
    expect(container.children, 'the row is not a single box').toHaveLength(1)
    const cells = [...container.firstChild.children]
    expect(cells.map((c) => c.tagName), 'a row cell went missing')
      .toEqual(['I', 'SPAN', 'SPAN', 'SPAN'])
    expect(cells[0].tagName, 'the micro-rail is not first').toBe('I')
    // ⚰️ THE FOURTH IS VESTIGIAL: `.vCtl`, `display: none`. It existed so the old
    // subgrid filled by ORDER — a two-cell row would have let the next row's label
    // land in the control track. There is no grid and no track, so it holds nothing
    // and costs nothing; it is asserted here only so its removal is a deliberate
    // edit rather than a silent one.
    expect(cells[3].className, 'the vestigial control cell changed identity').toMatch(/vCtl/)
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

  it('re-enables pointer events on the ROW — there are no buttons left', () => {
    const src = css()
    // ⛔ THE ROW, NOT ITS CELLS. The row is the hover box AND the control now; a
    // cell that re-enabled pointer events would not help, because the gaps
    // between cells belong to the row.
    for (const cls of ['.vRow', '.flat']) {
      expect(ruleBlock(src, cls), `${cls} does not re-enable pointer events`)
        .toMatch(/pointer-events:\s*auto/)
    }
    // ⚰️ `.btn` WAS IN THIS LIST. There is no button: two generations of control
    // lived on this row and both are retired.
    expect(src, 'a control button rule is back in this stylesheet')
      .not.toMatch(/\n\.btn\s*\{/)
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

  it('⚰️ the row is an INLINE PAIR — the subgrid went with the value column', () => {
    // ⚰️⚰️ THIS ASSERTED `grid-template-columns: subgrid`, and the reason it gave
    // was that every row's value must land on one right edge. That alignment is
    // exactly what the owner retired: five values ruled into a column is an
    // INVISIBLE TABLE, and it was half of why the legend read as a box. The value
    // follows its OWN label now — `EMA 9 711.65` starts further left than
    // `SMA 200 661.14`, deliberately — and the left edge still aligns because
    // every row starts at the stack's own origin.
    //
    // ⛔ WHAT SURVIVES IS THE HALF THAT WAS NEVER ABOUT ALIGNMENT: the row is ONE
    // element. `.legend` is `pointer-events: none`, so the gap between a label and
    // its value is only a hit target while it lives inside the row's own box —
    // loose siblings left dead columns and cost this legend four reported bugs.
    // ⛔ COMMENTS OUT FIRST. The retirement is DOCUMENTED inside this very rule, so
    // a raw read finds the tombstone and reports the thing it says was removed as
    // still present — a gate that cannot tell a comment from a declaration fails on
    // good work and passes on bad.
    const block = ruleBlock(css(), '.vRow').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(block, 'the value column came back — the legend will read as a table again')
      .not.toMatch(/subgrid/)
    expect(block, 'the row stopped being one inline box').toMatch(/display:\s*inline-flex/)
    expect(block, 'the label and value lost their pair gap').toMatch(/gap:\s*\d+px/)
    expect(block, 'the row must still take pointer events — see the note above')
      .toMatch(/pointer-events:\s*auto/)
  })

  it('🔴 the keyboard ring is `:focus-visible` — NEVER `:focus`, NEVER `:focus-within`', () => {
    // ⚰️ THIS GUARDED A HOVER REVEAL; it guards a FOCUS RING now, for the same
    // measured reason. MEASURED BY THE OWNER when it was a reveal: click a row's
    // eye, move to the next indicator, and BOTH rows showed their buttons — a
    // mouse click leaves DOM focus on the target, `:focus-within` stays true for
    // as long as it is there, and nothing takes it away. A plain `:focus` ring
    // would sit behind whatever the member moved to next in exactly that way.
    //
    // ⛔ AND THE ANSWER IS NOT `blur()` ON CLICK, which would snatch the ring away
    // from a KEYBOARD user the moment they activated anything — the exact
    // population the rule exists for. `:focus-visible` is the distinction the
    // platform already draws: set for tab-navigation, not for a pointer click.
    // Both legend stylesheets are checked, because they drifted apart once.
    for (const f of ['./LegendRow.module.css', './IndicatorChip.module.css']) {
      // ⚠️ COMMENTS ARE STRIPPED FIRST. Both files keep a TOMBSTONE that quotes
      // `:focus-within` and says why it was wrong; a whole-file read would fail
      // on the explanation and the obvious "fix" would be to delete the record.
      const flat = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '')
      expect(flat, `${f} lost its keyboard ring`).toMatch(/\.rowLive:focus-visible\{/)
      expect(flat, `${f} rings on a mouse click too`).toMatch(/\.rowLive:focus\{outline:none;\}/)
      expect(flat, `${f} uses :focus-within — it sticks after a mouse click`)
        .not.toMatch(/:focus-within/)
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
