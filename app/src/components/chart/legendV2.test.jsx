// app/src/components/chart/legendV2.test.jsx
//
// ─── LEGEND V2 — THE RAILS THE RENDERED LEGEND CANNOT HOLD BY ITSELF ────────
//
// ⛔ NO SUITE IN THIS REPO MOUNTS `StockChart` WITH `verticalLegend`, and that is
// not an oversight this file fixes by brute force. The workspace legend needs the
// real lightweight-charts renderer to have laid out panes before any of its
// interesting questions (which pane does this plot belong to, how many rows fit)
// even have answers — which is why `pane-harness.html` exists and why the browser
// pass is the gate for those. What a unit suite CAN hold, and what this file
// holds, is:
//
//   1. the two ROW components, rendered for real (chevron, grouping, fold);
//   2. the SOURCE of the V2 block, for the invariants a screenshot cannot prove —
//      that pane membership is asked of the display resolver and never of a pane
//      INDEX, and that the fold reserves a row for its own disclosure;
//   3. the STYLESHEET, for the two numbers JS depends on and for the hover
//      treatment the owner retired.
//
// ⚠️ THE SOURCE CASES READ THE SHIPPED FILE AND THROW BY NAME when a marker has
// moved. A source-reading gate that silently matches nothing is worse than no
// gate — `legendProbe.js` records what that cost the last time.
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import LegendRow from './legend/LegendRow'
import IndicatorChip from './legend/IndicatorChip'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(path.resolve(HERE, rel), 'utf8')
const STOCK_CHART = read('../StockChart.jsx')
const STOCK_CSS = read('../StockChart.module.css')
const ROW_CSS = read('./legend/LegendRow.module.css')
const CHIP_CSS = read('./legend/IndicatorChip.module.css')
const MODAL = read('./ChartSettingsModal.jsx')

/** The text between two literal markers, or a NAMED throw. */
function between(src, a, b) {
  const i = src.indexOf(a)
  if (i < 0) throw new Error(`marker moved: ${JSON.stringify(a)} is no longer in StockChart.jsx`)
  const j = src.indexOf(b, i + a.length)
  if (j < 0) throw new Error(`marker moved: ${JSON.stringify(b)} does not follow ${JSON.stringify(a)}`)
  return src.slice(i + a.length, j)
}

/** Source with comments removed.
 *
 *  ⛔ EVERY "THIS IS GONE" CASE BELOW READS THIS, NOT THE RAW FILE. The
 *  retirements are DOCUMENTED in place — `legendLayout`, `onHover`, the hover
 *  lift — so a raw search finds the tombstone and reports the thing it says was
 *  removed as still present. A gate that cannot tell a comment from code is a
 *  gate that fails on good work and passes on bad. */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

/** The V2 render block — from the row inputs it derives through to the inline
 *  legend branch that follows it. */
function v2Block() {
  const start = STOCK_CHART.indexOf('const indChips = crosshairData.chips')
  if (start < 0) throw new Error('marker moved: the legend no longer reads `crosshairData.chips`')
  const end = STOCK_CHART.indexOf('<span className={styles.legendTime}', start)
  if (end < 0) throw new Error('marker moved: the inline legend branch is no longer after the V2 one')
  const block = STOCK_CHART.slice(start, end)
  if (!block.includes('{legendV2 ? (')) {
    throw new Error('marker moved: the legend no longer branches on `legendV2`')
  }
  return block
}

const chipOf = (over) => ({
  instanceId: 'inst:rsi:1', plotKey: 'rsi', defId: 'rsi', label: 'RSI(14)',
  value: 57.3, decimals: 1, color: '#8b7fd6', text: 'RSI(14) 57.3', hidden: false,
  computed: true, ...over,
})

// ═══ 1. THE ROWS, RENDERED ═════════════════════════════════════════════════

describe('§6 — the permanent chevron', () => {
  it('a manageable LegendRow draws one, always, with no hover needed', () => {
    render(<LegendRow rowId="ma:0" label="EMA 9" value="319.82" vertical onOpen={vi.fn()} />)
    const row = document.querySelector('[data-legend-row="ma:0"]')
    expect(row.querySelector('svg'), 'the row draws no chevron at rest').toBeTruthy()
  })

  it('a manageable chip row draws one too — the two surfaces agree', () => {
    render(<IndicatorChip chip={chipOf()} grid onMenu={vi.fn()} />)
    expect(document.querySelector('[data-plot-key="rsi"]').closest('span[role="button"]')
      .querySelector('svg')).toBeTruthy()
  })

  it('⛔ IT IS NOT A SECOND CONTROL — no role, no tab stop, hidden from the reader', () => {
    // The ROW is the trigger. A chevron that announced itself would be a second
    // control over one door, and "chevron" after "EMA 9 options" teaches nothing.
    render(<LegendRow rowId="ma:0" label="EMA 9" value="319.82" vertical onOpen={vi.fn()} />)
    const chev = document.querySelector('[data-legend-row="ma:0"] svg').parentElement
    expect(chev.getAttribute('aria-hidden')).toBe('true')
    expect(chev.getAttribute('role')).toBeNull()
    expect(chev.getAttribute('tabindex')).toBeNull()
  })

  it('⛔ A READ-ONLY ROW DRAWS NONE — and still emits its third cell', () => {
    // Model Book, a grid cell, the export route. A chevron there would promise a
    // menu that does not exist; a MISSING cell would let the next row's label fall
    // into the chevron track and cascade the stack out of true.
    render(<LegendRow rowId="ma:0" label="EMA 9" value="319.82" vertical />)
    const row = document.querySelector('[data-legend-row="ma:0"]')
    expect(row.querySelector('svg')).toBeNull()
    expect(row.children.length, 'a read-only row emitted fewer than three cells').toBe(3)
  })

  it('a chip row emits three cells in both states, for the same reason', () => {
    const { unmount } = render(<IndicatorChip chip={chipOf()} grid onMenu={vi.fn()} />)
    expect(document.querySelector('span[role="button"]').children.length).toBe(3)
    unmount()
    render(<IndicatorChip chip={chipOf()} grid />)
    expect(document.querySelector('[data-plot-key="rsi"]').parentElement.children.length).toBe(3)
  })
})

describe('§6 — the row is still the ONE door', () => {
  const open = () => {
    const onOpen = vi.fn()
    render(<LegendRow rowId="ma:0" label="EMA 9" value="319.82" vertical onOpen={onOpen} />)
    return { onOpen, row: document.querySelector('[data-legend-row="ma:0"]') }
  }

  it('a click on the row opens it', () => {
    const { onOpen, row } = open()
    fireEvent.click(row)
    expect(onOpen).toHaveBeenCalledWith('ma:0', expect.objectContaining({ x: expect.any(Number) }))
  })

  it('a click on the CHEVRON opens the same one — it is inside the trigger', () => {
    // §6: "The text portion of the row should also be clickable so the user does
    // not have to hit a tiny chevron." Both halves are one element, so neither can
    // be the half that does nothing.
    const { onOpen, row } = open()
    fireEvent.click(row.querySelector('svg').parentElement)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('right-click and Enter still open it', () => {
    const { onOpen, row } = open()
    fireEvent.contextMenu(row)
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledTimes(2)
  })
})

describe('§7 — a multi-output indicator reads as one group', () => {
  it('a sibling output is marked, and a primary one is not', () => {
    const { container, unmount } = render(
      <LegendRow rowId="inst:macd" label="SIG" value="1.6272" controlLabel="MACD" vertical secondary onOpen={vi.fn()} />)
    const sub = container.querySelector('[data-legend-row="inst:macd"]').className
    unmount()
    const { container: c2 } = render(
      <LegendRow rowId="inst:macd" label="MACD" value="2.3999" vertical onOpen={vi.fn()} />)
    expect(sub).not.toBe(c2.querySelector('[data-legend-row="inst:macd"]').className)
    expect(sub).toMatch(/vRowSub/)
  })

  it('⛔ A SIBLING KEEPS ITS OWN VALUE, CHEVRON AND DOOR', () => {
    // Grouping is presentation. Making only the first row of a group clickable is
    // the exact complaint that produced the all-rows rule.
    const onOpen = vi.fn()
    render(<LegendRow rowId="inst:macd" label="SIG" value="1.6272" controlLabel="MACD" vertical secondary onOpen={onOpen} />)
    const row = document.querySelector('[data-legend-row="inst:macd"]')
    expect(row.textContent).toContain('1.6272')
    expect(row.querySelector('svg')).toBeTruthy()
    fireEvent.click(row)
    expect(onOpen).toHaveBeenCalled()
    // ⛔ …and the control still announces the INSTANCE, not the plot.
    expect(row.getAttribute('aria-label')).toBe('MACD options')
  })

  it('the chip row carries the same mark', () => {
    render(<IndicatorChip chip={chipOf({ plotKey: 'signal', label: 'SIG' })} grid secondary onMenu={vi.fn()} />)
    expect(document.querySelector('span[role="button"]').className).toMatch(/chipGridSub/)
  })
})

describe('§8 — a folded row leaves the layout AND the accessibility tree', () => {
  it('LegendRow', () => {
    render(<LegendRow rowId="ma:0" label="EMA 9" value="319.82" vertical folded onOpen={vi.fn()} />)
    expect(document.querySelector('[data-legend-row="ma:0"]').className).toMatch(/rowFolded/)
  })

  it('🔴 …and the fold OUT-SPECIFIES the row it hides, in both stylesheets', () => {
    // MEASURED IN THE BROWSER on a short pane: `.chipGridRow` declares `display:
    // grid` and is declared LATER in its file, so at equal specificity it won and
    // a folded chip rendered anyway — the stack printed `BB(20,2)` between the
    // visible rows and its own `+3 more`. Latent since the grid variant shipped,
    // because the old vertical legend DROPPED every chip in compact mode and so
    // never asked this class to hide one.
    expect(CHIP_CSS, 'the chip fold is left to source order again')
      .toMatch(/\.chipGridRow\.chipFolded\s*\{[^}]*display:\s*none/)
    expect(ROW_CSS, 'the row fold is left to source order again')
      .toMatch(/\.vRow\.rowFolded[^{]*\{[^}]*display:\s*none/)
  })
})

// ═══ 2. THE SOURCE — WHAT A SCREENSHOT CANNOT PROVE ════════════════════════

describe('§3 — pane ownership, with no pane-0 assumption', () => {
  it('⭐ the stack takes the plots the DISPLAY RESOLVER puts in this pane', () => {
    // `chipPaneHost` answers through `resolveDisplayTarget`, the same authority the
    // layout and the placement resolver consume, and `null` means "no pane of its
    // own" — drawn on Price. Everything else is named at the top-left of the pane
    // it actually draws in.
    expect(v2Block()).toContain('indChips.filter((c) => chipPaneHost(c) == null)')
  })

  it('⛔ AND IT CONSULTS NO PANE INDEX AT ALL', () => {
    const block = v2Block()
    expect(block, 'the V2 legend indexes a pane').not.toMatch(/panes\s*\[\s*0\s*\]/)
    expect(block).not.toMatch(/paneIndex/)
    expect(block).not.toMatch(/paneHeights\s*\[/)
  })

  it('⛔ the row budget is measured against PRICE, resolved from the candle series', () => {
    // `chromePlan` asks the CANDLE SERIES which pane it is in. Reading pane 0
    // instead is the 2026-09-15 regression that sent the lookback bar to the top
    // of the workspace when QQQ was arranged above Price.
    const sampler = between(STOCK_CHART, 'LEGEND V2 — THE STUDY STACK\'S ROW BUDGET',
      'const leg = legendRef.current')
    expect(sampler).toContain('plan.collapseThresholdPx')
    expect(sampler).toContain('plan.priceHeight')
    expect(sampler).not.toMatch(/\[\s*0\s*\]/)
  })

  it('⭐ a pane readout is the same vertical row, grouped the same way', () => {
    const readout = between(STOCK_CHART, 'A PANE READOUT IS A STUDY STACK', 'controlLabel={paneReadoutLabel(')
    expect(readout).toContain('vertical')
    expect(readout).toContain('secondary={ci > 0 && row.chips[ci - 1].instanceId === c.instanceId}')
  })
})

describe('§8 — the geometric fold', () => {
  const block = () => v2Block()

  it('🔴 THE DISCLOSURE RESERVES ITS OWN ROW, and only when there is something to disclose', () => {
    // MEASURED IN THE BROWSER: `+N more` renders INSIDE the stack, so a budget
    // spent entirely on study rows put the button one row below the space that was
    // measured. The legend's bottom then crossed `collapseThresholdPx`, the
    // responsive collapse fired, and the member got a HOVER-ONLY legend with NO
    // rows instead of the rows and a disclosure the budget had just computed.
    // There was no chart height in between where the fold was reachable at all.
    expect(STOCK_CHART).toMatch(/studyTotal > studyRowBudget\s*\n\s*\?\s*Math\.max\(0, studyRowBudget - 1\)\s*:\s*studyRowBudget/)
  })

  it('⛔ AND THE BUTTON MUST MEASURE ONE ROW, or the reservation buys nothing', () => {
    const more = /\.studyMore\s*\{([^}]*)\}/.exec(STOCK_CSS)
    expect(more, '.studyMore is gone — has the disclosure been renamed?').toBeTruthy()
    expect(more[1]).toMatch(/height:\s*15px/)
    expect(more[1]).toMatch(/margin-top:\s*0/)
  })

  it('⛔ THE FOLD NEVER CUTS A MULTI-OUTPUT INDICATOR IN HALF', () => {
    // MACD's `SIG` folded away under a visible `MACD` reads as a missing plot
    // rather than a collapsed group, so the cut walks back to the group's head.
    expect(block()).toMatch(/while \(studyFitFrom > studyChipAt/)
    expect(block()).toContain('studyFitFrom -= 1')
  })

  it('⛔ AND THE BUDGET IS BOTH A ROOM TEST AND A SHARE OF THE PANE', () => {
    // §8: "must not consume half the chart". Room alone makes 28 rows legal on a
    // tall pane — every one of which fits, and together they are 83% of the
    // candles behind a wall of text.
    expect(STOCK_CHART).toMatch(/const STUDY_STACK_MAX_FRAC = 0\.\d+/)
    const frac = Number(/const STUDY_STACK_MAX_FRAC = ([\d.]+)/.exec(STOCK_CHART)[1])
    expect(frac, 'the stack may take half the price pane or more').toBeLessThan(0.5)
    expect(frac).toBeGreaterThan(0.2)
    expect(STOCK_CHART).toContain('Math.min(room, share)')
  })

  it('⛔ THE ROW PITCH IS ONE NUMBER, DECLARED IN BOTH PLACES AND EQUAL', () => {
    // `STUDY_ROW_PX` counts rows; `.studyStack`'s `line-height` + `row-gap` produce
    // them. Measured first with `line-height: normal`, where the real pitch came
    // out at 17 and the budget over-counted every short pane by a row.
    const px = Number(/const STUDY_ROW_PX = (\d+)/.exec(STOCK_CHART)[1])
    const stack = /\.studyStack\s*\{([^}]*)\}/.exec(STOCK_CSS)
    expect(stack, '.studyStack is gone').toBeTruthy()
    const lh = Number(/line-height:\s*(\d+)px/.exec(stack[1])[1])
    const gap = Number(/row-gap:\s*(\d+)px/.exec(stack[1])[1])
    expect(px, `STUDY_ROW_PX (${px}) disagrees with .studyStack (${lh} + ${gap})`).toBe(lh + gap)
  })

  it('⛔ AND COMPACT MODE MUST NOT MOVE THAT PITCH', () => {
    // It shrinks the COLUMN gap. Changing `line-height` or `row-gap` there would
    // make the budget wrong in exactly the state where space is tightest.
    const compact = /\.legendCompact \.studyStack\s*\{([^}]*)\}/.exec(STOCK_CSS)
    expect(compact).toBeTruthy()
    expect(compact[1]).not.toMatch(/row-gap|line-height/)
  })
})

describe('§5 — hover restyles nothing but text', () => {
  it('⚰️ THE ROW-WIDE HOVER BACKGROUND IS GONE FROM BOTH STACK ROWS', () => {
    expect(ROW_CSS).toMatch(/\.vRow\.rowLive:hover\s*\{[^}]*background:\s*none/)
    expect(CHIP_CSS).toMatch(/\.chipGridRow\.rowLive:hover\s*\{[^}]*background:\s*none/)
  })

  it('⛔ WHAT REPLACES IT COSTS NO GEOMETRY — decoration and opacity only', () => {
    // Nothing that reflows: no padding, no margin, no border, no font-size, no
    // transform, no width. The legend box, its right edge and every cell must be
    // identical hovered and at rest.
    for (const [name, css, sel] of [
      ['LegendRow', ROW_CSS, /\.vRow\.rowLive:hover[^{]*\{([^}]*)\}/g],
      ['IndicatorChip', CHIP_CSS, /\.chipGridRow\.rowLive:hover[^{]*\{([^}]*)\}/g],
    ]) {
      const bodies = [...css.matchAll(sel)].map((m) => m[1])
      expect(bodies.length, `${name} declares no stack-row hover at all`).toBeGreaterThan(0)
      for (const body of bodies) {
        expect(body, `${name}'s hover moves the row`)
          .not.toMatch(/(^|;)\s*(padding|margin|border(?!-)|border-width|font-size|font-weight|transform|width|height|top|left)\s*:/)
      }
    }
  })

  it('⛔ AND NOTHING IN EITHER FILE REACHES THE RENDERER ON HOVER', () => {
    // The permanent invariant: a legend hover must not restyle or thicken the
    // plot. Proved byte-for-byte in the browser (15 canvases, `toDataURL()`
    // identical hovered and at rest); this is the rail that keeps it true.
    for (const [name, src] of [['LegendRow', read('./legend/LegendRow.jsx')],
      ['IndicatorChip', read('./legend/IndicatorChip.jsx')]]) {
      expect(stripComments(src), `${name} took a hover handler back`)
        .not.toMatch(/onHover|onMouseEnter|applyOptions|lineWidth/)
    }
  })

  it('the keyboard ring is still :focus-visible only', () => {
    expect(ROW_CSS).toMatch(/\.rowLive:focus-visible/)
    expect(CHIP_CSS).toMatch(/\.rowLive:focus-visible/)
  })
})

describe('§2/§14 — the two areas, and the box that is gone', () => {
  it('⛔ NEITHER AREA WEARS A CARD — no border, no shadow, no radius past a hairline', () => {
    for (const cls of ['barInfo', 'studyStack']) {
      const body = new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`).exec(STOCK_CSS)
      expect(body, `.${cls} is gone`).toBeTruthy()
      expect(body[1], `.${cls} grew a border`).not.toMatch(/(^|;)\s*border\s*:/)
      expect(body[1], `.${cls} grew a shadow`).not.toMatch(/box-shadow/)
      const radius = /border-radius:\s*(\d+)px/.exec(body[1])
      expect(Number(radius ? radius[1] : 0), `.${cls} reads as a card`).toBeLessThanOrEqual(3)
    }
  })

  it('⭐ …but each keeps the BLUR that makes transparency safe over candles', () => {
    // MEASURED 2026-08-10: a transparent legend had candlesticks running straight
    // through its numbers. Blur averages a candle into a wash the text reads
    // against while the grid lines survive as soft lines — it is a readability
    // rail, not decoration, and it is per-AREA so the wash follows the text
    // instead of spanning both and becoming a card again.
    for (const cls of ['barInfo', 'studyStack']) {
      const body = new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`).exec(STOCK_CSS)[1]
      expect(body, `.${cls} lost its backdrop blur`).toMatch(/backdrop-filter:\s*blur/)
    }
    expect(/\.legendV2\s*\{([^}]*)\}/.exec(STOCK_CSS)[1],
      'the V2 container grew a wash of its own — that is the card, back').toMatch(/background:\s*none/)
  })

  it('⛔ VOLUME IS IN THE STACK AND NOT IN THE STRIP', () => {
    const block = v2Block()
    const strip = between(block, '<div className={styles.barInfo}>', '</div>')
    expect(strip, 'volume crept back into the bar info strip').not.toMatch(/formatVolume|volLegendRowVisible/)
    const stack = block.slice(block.indexOf('<div className={styles.studyStack}'))
    expect(stack).toContain('volLegendRowVisible')
    expect(stack).toContain('formatVolume(crosshairData.volume)')
  })

  it('⛔ AND THE STRIP PRINTS EXACTLY THE SEVEN RESOLVED FIELDS, through the ONE reader', () => {
    const block = v2Block()
    expect(block).toContain('const barFields = barInfoFieldsOf(cs)')
    expect(stripComments(block), 'a surface reads the stored key directly instead of the resolver')
      .not.toMatch(/header\??\.barInfo/)
    for (const id of ['date', 'open', 'high', 'low', 'close', 'change', 'changePct']) {
      expect(block, `the strip never asks about ${id}`).toContain(`barShows('${id}')`)
    }
  })
})

describe('⚰ §9 — the retired layout selector leaves no dead control', () => {
  it('Chart Settings offers no Vertical/Horizontal choice any more', () => {
    expect(MODAL, 'the legend layout selector is still rendered').not.toMatch(/LEGEND_LAYOUTS\.map/)
    expect(MODAL).not.toMatch(/legendLayout: val/)
    expect(MODAL).not.toMatch(/>Legend layout</)
  })

  it('…and nothing in the chart reads the key', () => {
    expect(stripComments(STOCK_CHART), 'StockChart still branches on the retired layout key')
      .not.toMatch(/legendLayout/)
  })

  it('the three-way visibility control is untouched — `Hold` still means hold', () => {
    // §9: "Do not accidentally change what Hold means." The mode resolver and the
    // segmented control are the same ones; only the row BELOW them changed.
    expect(MODAL).toContain('LEGEND_MODES.map')
    expect(MODAL).toContain('setHeader({ legendMode: val })')
    expect(STOCK_CHART).toContain('const legendMode = legendModeOf(cs)')
  })
})
