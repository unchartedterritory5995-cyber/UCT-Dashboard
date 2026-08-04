import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HeatGrid, { heatTier, HEAT_TIERS, DEFAULT_HEAT_STOPS, formatSigned } from './HeatGrid'

const COLUMNS = ['Q2 26', 'Q1 26', 'Q4 25', 'Q3 25']
const ROWS = [
  { key: 'revenue_yoy', label: 'Revenue YoY', values: [62, 24, 8, -3], unit: '%' },
  { key: 'eps_yoy', label: 'EPS YoY', values: [-55, -21, 0, null], unit: '%' },
]

describe('heatTier', () => {
  it('ramps the green side on the default stops', () => {
    expect(heatTier(80)).toBe('g3')
    expect(heatTier(50)).toBe('g3')
    expect(heatTier(21)).toBe('g2')
    expect(heatTier(20)).toBe('g2')
    expect(heatTier(0.5)).toBe('g1')
  })

  it('mirrors the red side', () => {
    expect(heatTier(-80)).toBe('r3')
    expect(heatTier(-50)).toBe('r3')
    expect(heatTier(-21)).toBe('r2')
    expect(heatTier(-0.5)).toBe('r1')
  })

  it('gives a flat zero NO tier — an untinted cell is the honest rendering', () => {
    expect(heatTier(0)).toBeNull()
  })

  it('is null for anything unmeasured, never a tier', () => {
    expect(heatTier(null)).toBeNull()
    expect(heatTier(undefined)).toBeNull()
    expect(heatTier('x')).toBeNull()
    expect(heatTier(NaN)).toBeNull()
  })

  it('accepts caller stops for a metric on a different scale', () => {
    expect(heatTier(3, [5, 2, 0])).toBe('g2')
    expect(heatTier(6, [5, 2, 0])).toBe('g3')
  })

  it('exposes the full tier vocabulary including the caution band', () => {
    expect(HEAT_TIERS).toEqual(['g3', 'g2', 'g1', 'a', 'r1', 'r2', 'r3'])
    expect(DEFAULT_HEAT_STOPS).toEqual([50, 20, 0])
  })
})

describe('formatSigned', () => {
  it('always shows the sign on a positive number (§3.3 always-visible)', () => {
    expect(formatSigned(12.35, { unit: '%' })).toBe('+12.4%')
    expect(formatSigned(-3, { unit: '%' })).toBe('-3.0%')
    expect(formatSigned(0, { unit: '%' })).toBe('0.0%')
  })

  it('renders an em-dash for nothing, never "NaN" or a blank', () => {
    expect(formatSigned(null)).toBe('—')
    expect(formatSigned('x')).toBe('—')
  })

  it('honours a decimals override', () => {
    expect(formatSigned(12.345, { unit: '%', decimals: 2 })).toBe('+12.35%')
  })
})

describe('HeatGrid', () => {
  it('renders an EmptyState with no rows or no columns', () => {
    const { rerender } = render(<HeatGrid columns={COLUMNS} rows={[]} />)
    expect(screen.getByTestId('rk-empty-title')).toBeInTheDocument()
    rerender(<HeatGrid columns={[]} rows={ROWS} />)
    expect(screen.getByTestId('rk-empty-title')).toBeInTheDocument()
  })

  it('is a real table with column and row headers', () => {
    render(<HeatGrid columns={COLUMNS} rows={ROWS} caption="Quarterly growth" />)
    expect(screen.getByRole('table', { name: 'Quarterly growth' })).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader')).toHaveLength(COLUMNS.length + 1)
    expect(screen.getAllByRole('rowheader')).toHaveLength(ROWS.length)
  })

  it('tints each cell by tier and ALWAYS shows the signed number', () => {
    const { container } = render(<HeatGrid columns={COLUMNS} rows={ROWS} />)
    const cells = container.querySelectorAll('[data-testid="rk-heat-cell"]')
    expect(cells[0].className).toMatch(/\bg3\b/)
    expect(cells[0]).toHaveTextContent('+62.0%')
    expect(cells[3].className).toMatch(/\br1\b/)
    expect(cells[3]).toHaveTextContent('-3.0%')
  })

  it('leaves an unmeasured cell untinted and shows an em-dash', () => {
    const { container } = render(<HeatGrid columns={COLUMNS} rows={ROWS} />)
    const last = container.querySelectorAll('[data-testid="rk-heat-cell"]')[7]
    expect(last).toHaveTextContent('—')
    expect(last.className).not.toMatch(/\b(g1|g2|g3|r1|r2|r3|a)\b/)
  })

  it('keeps cell text in ONE ink — the tint is the only per-cell colour (§3.3)', () => {
    const { container } = render(<HeatGrid columns={COLUMNS} rows={ROWS} />)
    const classes = [...container.querySelectorAll('[data-testid="rk-heat-value"]')].map((n) => n.className)
    expect(new Set(classes).size).toBe(1)
  })

  it('pads a short row rather than shifting the columns', () => {
    const { container } = render(<HeatGrid columns={COLUMNS} rows={[{ key: 'x', label: 'X', values: [1] }]} />)
    expect(container.querySelectorAll('[data-testid="rk-heat-cell"]')).toHaveLength(COLUMNS.length)
  })

  it('exposes a keyboard-reachable chart button per row when onRowChart is given', async () => {
    const onRowChart = vi.fn()
    render(<HeatGrid columns={COLUMNS} rows={ROWS} onRowChart={onRowChart} />)
    const btn = screen.getByRole('button', { name: /Revenue YoY/ })
    await userEvent.click(btn)
    expect(onRowChart).toHaveBeenCalledWith('revenue_yoy')
  })

  it('renders NO button when there is nothing to open (no fake affordance)', () => {
    render(<HeatGrid columns={COLUMNS} rows={ROWS} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('marks the open row for the caller', () => {
    render(<HeatGrid columns={COLUMNS} rows={ROWS} onRowChart={() => {}} activeRowKey="eps_yoy" />)
    expect(screen.getByRole('button', { name: /EPS YoY/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /Revenue YoY/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('carries no inline styles — every tint is a token class', () => {
    const { container } = render(<HeatGrid columns={COLUMNS} rows={ROWS} />)
    for (const cell of container.querySelectorAll('[data-testid="rk-heat-cell"]')) {
      expect(cell.getAttribute('style')).toBeNull()
    }
  })
})
