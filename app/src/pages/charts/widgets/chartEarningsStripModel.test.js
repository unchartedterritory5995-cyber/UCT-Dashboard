/* The chart earnings strip's cell selection.

   The strip sits under a time axis that runs left-to-right, and it must not
   become a second earnings pipeline: every value comes from the same
   /api/earnings-intel payload and the same earningsRows formatters the Company
   Panel uses. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

import { CELL_PX, stripCells, stripLabel, stripSales } from './chartEarningsStripModel'

const q = (label, over = {}) => ({
  label, reported: true, eps_actual: 1.5, revenue_actual: 2.0e9,
  eps_yoy_pct: 12, rev_yoy_pct: 8, report_date: '2026-06-24', ...over,
})
const intel = (quarters, estimates = []) => ({ quarters, estimates })

describe('stripLabel', () => {
  it('shortens the fiscal form for a narrow cell', () => {
    expect(stripLabel('FY2026 Q3')).toBe("Q3 '26")
    expect(stripLabel('FY2025 Q1')).toBe("Q1 '25")
  })

  it('keeps the year, since the strip spans a fiscal boundary', () => {
    const labels = ['FY2025 Q4', 'FY2026 Q1'].map(stripLabel)
    expect(new Set(labels).size).toBe(2)
  })

  it('passes through anything that is not a fiscal quarter', () => {
    expect(stripLabel('2026-06-30')).toBe('2026-06-30')
    expect(stripLabel('')).toBe('')
    expect(stripLabel(null)).toBe('')
  })
})

describe('stripCells', () => {
  it('runs oldest -> newest, matching the time axis above it', () => {
    // earnings-intel hands back newest-first.
    const cells = stripCells(intel([q('FY2026 Q3'), q('FY2026 Q2'), q('FY2026 Q1')]), 6)
    expect(cells.map(c => c.label)).toEqual(["Q1 '26", "Q2 '26", "Q3 '26"])
  })

  it('puts forward estimates after the reported quarters', () => {
    const cells = stripCells(
      intel([q('FY2026 Q3')], [{ label: 'FY2026 Q4', eps_estimate: 2, revenue_estimate: 3e9 }]), 6)
    expect(cells.map(c => c.est)).toEqual([false, true])
    expect(cells.at(-1).label).toBe("Q4 '26")
  })

  it('trims from the OLD end, so the estimate always survives', () => {
    const cells = stripCells(
      intel([q('FY2026 Q3'), q('FY2026 Q2'), q('FY2026 Q1')],
            [{ label: 'FY2026 Q4', eps_estimate: 2 }]), 2)
    expect(cells).toHaveLength(2)
    expect(cells.at(-1).est).toBe(true)
    expect(cells.map(c => c.label)).toEqual(["Q3 '26", "Q4 '26"])
  })

  it('respects the cell budget', () => {
    const many = Array.from({ length: 12 }, (_, i) => q(`FY2026 Q${(i % 4) + 1}`))
    expect(stripCells(intel(many), 5)).toHaveLength(5)
    expect(stripCells(intel(many), 1)).toHaveLength(1)
  })

  it('ignores unreported quarters — those are not results yet', () => {
    const cells = stripCells(intel([q('FY2026 Q3'), q('FY2026 Q4', { reported: false })]), 6)
    expect(cells.map(c => c.label)).toEqual(["Q3 '26"])
  })

  it('survives an empty or missing payload', () => {
    expect(stripCells(null, 6)).toEqual([])
    expect(stripCells(undefined, 6)).toEqual([])
    expect(stripCells(intel([]), 6)).toEqual([])
    expect(stripCells(intel([q('FY2026 Q3')]), 0)).toEqual([])
  })
})

describe('it reuses the Company Panel rules rather than restating them', () => {
  it('carries growthCell tones, including gold on triple digits', () => {
    // Input is NEWEST-first, as /api/earnings-intel returns it; output runs
    // oldest -> newest to match the time axis, so the tones come back reversed.
    const cells = stripCells(intel([
      q('FY2026 Q3', { eps_yoy_pct: 260 }),
      q('FY2026 Q2', { eps_yoy_pct: -14 }),
      q('FY2026 Q1', { eps_yoy_pct: 8 }),
    ]), 6)
    expect(cells.map(c => c.label)).toEqual(["Q1 '26", "Q2 '26", "Q3 '26"])
    expect(cells.map(c => c.epsCell.tone)).toEqual(['up', 'down', 'gold'])
  })

  it('does NOT gild a swing off a loss', () => {
    // growthCell's own guard: +500% off a negative base is a sign flip, not growth.
    const [cell] = stripCells(
      intel([q('FY2026 Q3', { eps_yoy_pct: 500, eps_yoy_note: 'loss_narrowing' })]), 6)
    expect(cell.epsCell.tone).not.toBe('gold')
  })

  it('reads a swing through zero as the note, never an invented percentage', () => {
    const [cell] = stripCells(
      intel([q('FY2026 Q3', { eps_yoy_pct: null, eps_yoy_note: 'turned_profitable' })]), 6)
    // Shortened for strip width, but it is still the NOTE and not a number:
    // "Profitable" was ~2x the width of any figure beside it and squeezed the
    // value into an ellipsis.
    expect(cell.epsCell.text).toBe('PROFIT')
    expect(cell.epsCell.title).toBe('Profitable')   // full wording on hover
    expect(cell.epsCell.semantic).toBe(true)        // a state, not a rate
  })

  it('shortens a swing to loss the same way', () => {
    const [cell] = stripCells(
      intel([q('FY2026 Q3', { eps_yoy_pct: null, eps_yoy_note: 'turned_negative' })]), 6)
    expect(cell.epsCell.text).toBe('TO LOSS')
    expect(cell.epsCell.tone).toBe('down')
  })

  it('leaves ordinary percentages exactly as the panel formats them', () => {
    const [cell] = stripCells(intel([q('FY2026 Q3', { eps_yoy_pct: 12 })]), 6)
    expect(cell.epsCell.text).toBe('+12%')
    expect(cell.epsCell.title).toBeNull()
  })

  it('formats an estimate cell without pretending it is reported', () => {
    const [cell] = stripCells(intel([], [{ label: 'FY2027 Q1', eps_estimate: 2.37 }]), 6)
    expect(cell.est).toBe(true)
    expect(cell.eps).toBe('$2.37')
  })
})

describe('CELL_PX', () => {
  /* Asserted as the OUTCOME it controls, not as a magic number — the constant
     has moved twice (118 -> 134 to buy font size, 134 -> 160 to stop the cells
     looking crammed) and a bare bound just fails on the next deliberate tune. */
  const fits = (col) => Math.max(2, Math.floor(col / CELL_PX))

  it('shows a useful history with the panel closed', () => {
    expect(fits(1520)).toBeGreaterThanOrEqual(8)   // ~2 years plus an estimate
    expect(fits(1520)).toBeLessThanOrEqual(12)     // beyond this it reads crammed
  })

  it('still shows several quarters at the default panel width', () => {
    expect(fits(1140)).toBeGreaterThanOrEqual(5)
  })

  it('never collapses below a readable pair of cells', () => {
    expect(fits(300)).toBeGreaterThanOrEqual(2)
  })
})

describe('stripSales', () => {
  it('drops the second decimal the panel keeps', () => {
    // "$41.46B" is right for a table row and ~6px too wide for a cell here —
    // it pushed the value into an ellipsis at every width.
    expect(stripSales(41.46e9)).toBe('$41.5B')
    expect(stripSales(2.31e9)).toBe('$2.3B')
  })

  it('scales down through M and K without decimals', () => {
    expect(stripSales(480.7e6)).toBe('$481M')
    expect(stripSales(52_400)).toBe('$52K')
  })

  it('marks a negative with a real minus sign', () => {
    expect(stripSales(-1.2e9)).toBe('−$1.2B')
  })

  it('never invents a figure', () => {
    expect(stripSales(null)).toBe('—')
    expect(stripSales(undefined)).toBe('—')
    expect(stripSales('nope')).toBe('—')
  })

  it('is materially narrower than the panel form', () => {
    expect(stripSales(41.46e9).length).toBeLessThan('$41.46B'.length)
  })
})

describe('the actuals -> estimates transition', () => {
  it('flags the FIRST forecast so the strip can mark it with a hairline', () => {
    const cells = stripCells(
      intel([q('FY2026 Q3')],
            [{ label: 'FY2026 Q4', eps_estimate: 2 }, { label: 'FY2027 Q1', eps_estimate: 3 }]), 6)
    expect(cells.filter(c => c.firstEst)).toHaveLength(1)
    expect(cells.find(c => c.firstEst).label).toBe("Q4 '26")
  })

  it('flags nothing when there are no estimates', () => {
    const cells = stripCells(intel([q('FY2026 Q3')]), 6)
    expect(cells.some(c => c.firstEst)).toBe(false)
  })
})

/* The strip's directional colours follow the CHART WIDGET'S theme, because
   ChartDetailDock sets --dock-up-text / --dock-down-text on .dockRoot and the
   strip renders inside it. Gold is deliberately NOT themed: it is the one
   structural accent and must stay UCT gold under every chart theme.

   Asserted against the stylesheet, because this is a cascade contract between
   two files and nothing else would catch a hard-coded hex creeping back in. */
describe('earnings strip directional colours', () => {
  const css = readFileSync(
    resolve(process.cwd(), 'src/pages/charts/widgets/ChartEarningsStrip.module.css'),
    'utf8',
  )
  const rule = (sel) => {
    const i = css.indexOf(sel)
    return i === -1 ? '' : css.slice(i, css.indexOf('}', i))
  }

  it('up and down read the themed variables', () => {
    expect(rule('.up ')).toMatch(/var\(--dock-up-text/)
    expect(rule('.down ')).toMatch(/var\(--dock-down-text/)
  })

  it('gold is NOT themed — it is the one fixed accent', () => {
    expect(rule('.gold ')).toMatch(/var\(--accent/)
    expect(rule('.gold ')).not.toMatch(/--dock-(up|down)/)
  })

  it('no directional colour is hard-coded past its fallback', () => {
    // A bare hex outside var(...) would ignore the chart theme entirely.
    for (const sel of ['.up ', '.down ']) {
      const hexes = rule(sel).match(/#[0-9a-f]{3,8}/gi) || []
      expect(hexes.length, `${sel} should only carry a var() fallback`).toBeLessThanOrEqual(1)
    }
  })

  it('the strip inherits rather than re-declaring the theme vars', () => {
    // ChartDetailDock owns them on .dockRoot; a second declaration here would
    // shadow the chart theme and silently pin the strip to one palette.
    expect(css).not.toMatch(/--dock-up-text\s*:/)
    expect(css).not.toMatch(/--dock-down-text\s*:/)
  })
})
