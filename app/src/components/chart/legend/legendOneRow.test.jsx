// app/src/components/chart/legend/legendOneRow.test.jsx
//
// ─── ONE LEGEND ROW PER NAME, AND ROWS THAT MEET ────────────────────────────
//
// Owner, 2026-11-16, two reports on the chart legend:
//   1. a 23-plot script printed 22 rows that all read "Uncharted Clouds";
//   2. the legend "glitches and flickers" when the pointer combs over it.
//
// `legendRows.test.js` and `legendPointerHold.test.js` hold the two rules. This file
// holds what the ROWS do with them: a row prints its sibling plots' values, and two
// neighbouring rows of the study stack leave no gap for the pointer to fall through.
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import IndicatorChip from './IndicatorChip'
import LegendRow from './LegendRow'
import { legendRows, LEGEND_ROW_VALUES_MAX } from './legendRows'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const css = (rel) => readFileSync(path.resolve(HERE, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const CHIP_CSS = css('IndicatorChip.module.css')
const ROW_CSS = css('LegendRow.module.css')
const CHART_CSS = css('../../StockChart.module.css')

afterEach(() => cleanup())

const plot = (plotKey, value, over = {}) => ({
  defId: 'u_clouds', instanceId: 'uc', plotKey, label: 'Uncharted Clouds', color: '#ffffff',
  decimals: 2, value, hidden: false, text: `Uncharted Clouds ${value}`, ...over,
})

describe('IndicatorChip — sibling plots ride on the one row', () => {
  it('the stack row prints the name once and each drawn plot\'s value', () => {
    const [row] = legendRows([
      plot('p0', 433.92), plot('p1', null, { hidden: true }), plot('p2', 451.49, { color: '#ff0000' }),
    ])
    const { container } = render(<IndicatorChip chip={row.chip} more={row.more} grid onMenu={() => {}} />)
    expect(container.querySelectorAll('[data-instance-id="uc"]')).toHaveLength(1)
    expect(container.textContent.match(/Uncharted Clouds/g)).toHaveLength(1)
    expect(container.textContent).toContain('433.92')
    const extra = container.querySelector('[data-more-value="p2"]')
    expect(extra.textContent).toBe('451.49')
    // its own line's colour, so the value's lightness clamp reads THIS plot's colour
    expect(extra.style.getPropertyValue('--chip-color')).toBe('#ff0000')
    expect(container.querySelector('[data-more-value="p1"]'), 'a hidden plot prints nothing').toBeNull()
  })

  it('⭐ a sibling value is inked legibly even when the lead line draws nothing (the Uncharted Clouds row)', () => {
    // Measured on production 2026-11-17: the script's fast average is fully transparent and its slow
    // average is white at 95% transparency. The row carried no colour, the contrast clamp was keyed on
    // the ROW's colour, and the slow average's value printed at 5% opacity.
    const [row] = legendRows([
      plot('fast', 156.22, { color: 'rgba(255, 255, 255, 0)' }),
      plot('slow', 156.06, { color: 'rgba(255, 255, 255, 0.05)' }),
    ])
    const { container } = render(<IndicatorChip chip={row.chip} more={row.more} grid onMenu={() => {}} />)
    const extra = container.querySelector('[data-more-value="slow"]')
    // the premise: the sibling value carries a colour, and nothing above it (the row) does
    expect(extra.getAttribute('style')).toMatch(/--chip-color/)
    let above = 0
    for (let el = extra.parentElement; el && el !== container; el = el.parentElement) {
      expect(el.getAttribute('style') || '', 'the row carries a colour: this case no longer tests the gap').not.toMatch(/--chip-color/)
      above += 1
    }
    expect(above).toBeGreaterThan(0)
    // the rule: the clamp (which ends in `/ 1`, opaque) reaches a value by the VALUE's own colour,
    // in the stack and in the inline chip, and never a hidden row's
    const block = /@supports \(color: oklch\(from red l c h\)\) \{\s*([^{}]+)\{([^{}]*)\}/.exec(CHIP_CSS)
    const selectors = block[1].split(',').map((s) => s.trim())
    expect(selectors).toContain('.chipGridRow:not(.chipHidden) .chipGridVal[style*="--chip-color"]')
    expect(selectors).toContain('.chip:not(.chipHidden) .chipVal[style*="--chip-color"]:not(.chipValStale)')
    expect(block[2]).toMatch(/color:\s*oklch\(from var\(--chip-color\)[^;]*\/ 1\)/)
    // the control: the row-keyed selectors are still there (a coloured row clamps its lead value)
    expect(selectors).toContain('.chipGridRow[style*="--chip-color"]:not(.chipHidden) .chipGridVal')
    // and a pane readout row already keys on the value itself
    expect(ROW_CSS).toMatch(/\.vRow:not\(\.rowHidden\) \.vVal\[style\*="--row-color"\]/)
  })

  it('the inline chip prints them too, after its own value', () => {
    const { container } = render(<IndicatorChip chip={plot('p0', 433.92)} more={[plot('p2', 451.49)]} onMenu={() => {}} />)
    expect(container.querySelector('[data-instance-id="uc"]').textContent).toBe('Uncharted Clouds 433.92 451.49')
  })

  it('the control: with no siblings the chip is byte for byte the chip it was', () => {
    const first = render(<IndicatorChip chip={plot('p0', 433.92)} onMenu={() => {}} />).container
    const a = first.innerHTML
    // the chip's text is `label + ' ' + value` to the byte (`stockChartWiring` reads it so)
    expect(first.querySelector('[data-instance-id="uc"]').textContent).toBe('Uncharted Clouds 433.92')
    cleanup()
    const b = render(<IndicatorChip chip={plot('p0', 433.92)} more={[]} onMenu={() => {}} />).container.innerHTML
    expect(b).toBe(a)
    expect(a).not.toContain('data-more-value')
  })

  it('a sibling with no value on this bar prints nothing', () => {
    const { container } = render(<IndicatorChip chip={plot('p0', 433.92)} more={[plot('p2', null)]} grid />)
    expect(container.querySelector('[data-more-value]')).toBeNull()
  })

  it('past the row\'s value budget the rest fold into a count', () => {
    const extras = Array.from({ length: LEGEND_ROW_VALUES_MAX + 2 }, (_, i) => plot(`x${i}`, 10 + i))
    const { container } = render(<IndicatorChip chip={plot('p0', 1)} more={extras} grid />)
    expect(container.querySelectorAll('[data-more-value]')).toHaveLength(LEGEND_ROW_VALUES_MAX - 1)
    expect(container.querySelector('[data-more-over]').textContent).toBe('+3')
  })
})

describe('LegendRow — the pane readout carries sibling values the same way', () => {
  const more = [{ key: 'p2', text: '451.49', color: '#ff0000' }, { key: 'p3', text: '', color: '#00ff00' }]

  it('vertical: one row, the extra value in its own colour, blanks dropped', () => {
    const { container } = render(<LegendRow vertical rowId="uc" label="Uncharted Clouds" value="433.92" moreValues={more} />)
    expect(container.querySelectorAll('[data-legend-row]')).toHaveLength(1)
    const extra = container.querySelector('[data-more-value="p2"]')
    expect(extra.textContent).toBe('451.49')
    expect(extra.style.getPropertyValue('--row-color')).toBe('#ff0000')
    expect(container.querySelector('[data-more-value="p3"]')).toBeNull()
  })

  it('flat: the same', () => {
    const { container } = render(<LegendRow rowId="uc" label="Uncharted Clouds" value="433.92" moreValues={more} />)
    expect(container.querySelector('[data-more-value="p2"]').textContent).toBe('451.49')
  })

  it('the control: without `moreValues` the row is byte for byte the row it was', () => {
    const a = render(<LegendRow vertical rowId="uc" label="X" value="1.00" />).container.innerHTML
    cleanup()
    const b = render(<LegendRow vertical rowId="uc" label="X" value="1.00" moreValues={[]} />).container.innerHTML
    expect(b).toBe(a)
  })
})

describe('the study stack\'s rows meet: no gap for the pointer to fall through to the chart', () => {
  const px = (re, src, what) => {
    const m = re.exec(src)
    if (!m) throw new Error(`could not read ${what} from the stylesheet`)
    return Number(m[1])
  }
  const stack = /\.studyStack\s*\{([^}]*)\}/.exec(CHART_CSS)[1]

  it('each row reaches exactly half the stack\'s row gap, above and below', () => {
    const gap = px(/row-gap:\s*(\d+(?:\.\d+)?)px/, stack, '.studyStack row-gap')
    const pad = px(/--row-hit-pad:\s*(\d+(?:\.\d+)?)px/, stack, '.studyStack --row-hit-pad')
    expect(gap).toBeGreaterThan(0)
    expect(pad * 2, 'two neighbouring rows must meet in the middle of the gap').toBe(gap)
  })

  it('a pane readout stack reaches the same way: half its own row gap', () => {
    // every rule that is `.paneLegend` alone and declares a row-gap is the vertical readout stack
    const rules = [...CHART_CSS.matchAll(/(?:^|\})\s*\.paneLegend\s*\{([^}]*)\}/g)].map((m) => m[1])
    const stackRule = rules.find((r) => /row-gap:/.test(r))
    expect(stackRule, 'the pane readout stack rule is gone').toBeTruthy()
    const gap = px(/row-gap:\s*(\d+(?:\.\d+)?)px/, stackRule, '.paneLegend row-gap')
    const pad = px(/--row-hit-pad:\s*(\d+(?:\.\d+)?)px/, stackRule, '.paneLegend --row-hit-pad')
    expect(pad * 2).toBe(gap)
  })

  it.each([
    ['LegendRow', ROW_CSS, '.vRow'],
    ['IndicatorChip', CHIP_CSS, '.chipGridRow'],
  ])('%s: the row carries the hit strip, sized by the stack and out of the layout', (_n, src, sel) => {
    const rule = new RegExp(`\\${sel}::after\\s*\\{([^}]*)\\}`).exec(src)
    expect(rule, `${sel}::after is gone`).toBeTruthy()
    const body = rule[1]
    expect(body).toMatch(/position:\s*absolute/)
    expect(body).toMatch(/top:\s*calc\(-1 \* var\(--row-hit-top,\s*var\(--row-hit-pad,\s*0px\)\)\)/)
    expect(body).toMatch(/bottom:\s*calc\(-1 \* var\(--row-hit-pad,\s*0px\)\)/)
    // behind the row's text, and it must stay a hit target
    expect(body).toMatch(/z-index:\s*-1/)
    expect(body).not.toMatch(/pointer-events:\s*none/)
    // the row is the strip's containing block and its stacking context
    const row = new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`).exec(src)[1]
    expect(row).toMatch(/position:\s*relative/)
    expect(row).toMatch(/isolation:\s*isolate/)
    expect(row).toMatch(/pointer-events:\s*auto/)
  })

  it('no stacked row gets its own margin — every row is spaced by the stack row-gap alone (owner 11-17)', () => {
    // Volume used to sit 3px lower than the moving averages above it.
    expect(CHART_CSS).not.toMatch(/\[data-legend-row[^\]]*\][^{]*\{[^}]*margin/)
    expect(CHART_CSS).not.toMatch(/--row-hit-top:/)
  })
})
