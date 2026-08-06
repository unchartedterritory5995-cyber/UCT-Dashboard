import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import CheckupRow, { normalizeStatus } from './CheckupRow'

describe('normalizeStatus', () => {
  it('passes the backend vocabulary through', () => {
    expect(normalizeStatus('pass')).toBe('pass')
    expect(normalizeStatus('fail')).toBe('fail')
    expect(normalizeStatus('neutral')).toBe('neutral')
  })

  it('accepts na as an alias and neutralises anything unknown', () => {
    expect(normalizeStatus('na')).toBe('neutral')
    expect(normalizeStatus('PASS')).toBe('pass')
    expect(normalizeStatus(undefined)).toBe('neutral')
    expect(normalizeStatus(42)).toBe('neutral')
  })
})

describe('CheckupRow', () => {
  it('renders the requirement and the actual value', () => {
    render(<CheckupRow label="ROE ≥ 17%" status="pass" value="28%" />)
    expect(screen.getByText('ROE ≥ 17%')).toBeInTheDocument()
    expect(screen.getByTestId('rk-checkup-value')).toHaveTextContent('28%')
  })

  it('renders actual-vs-threshold when a threshold is supplied (§5.3)', () => {
    render(<CheckupRow label="ROE" status="pass" value="28.4%" threshold="17% req" />)
    expect(screen.getByTestId('rk-checkup-value')).toHaveTextContent('28.4%')
    expect(screen.getByTestId('rk-checkup-threshold')).toHaveTextContent('vs 17% req')
  })

  it('shape-codes the outcome with a UIcon, never colour alone (§3.3)', () => {
    const { container, rerender } = render(<CheckupRow label="x" status="pass" value="1" />)
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.firstChild.getAttribute('data-status')).toBe('pass')
    rerender(<CheckupRow label="x" status="fail" value="1" />)
    expect(container.firstChild.getAttribute('data-status')).toBe('fail')
  })

  it('uses a text marker, not an icon, for the neutral state', () => {
    const { container } = render(<CheckupRow label="x" status="neutral" value="—" />)
    expect(container.querySelector('svg')).toBeNull()
    expect(screen.getByTestId('rk-checkup-glyph')).toHaveTextContent('—')
  })

  it('states the outcome in text for screen readers', () => {
    render(<CheckupRow label="ROE ≥ 17%" status="fail" value="9%" />)
    expect(screen.getByTestId('rk-checkup-sr')).toHaveTextContent('fail')
  })

  it('puts the value on tabular numerals and carries no inline styles', () => {
    const { container } = render(<CheckupRow label="x" status="pass" value="28%" />)
    expect(screen.getByTestId('rk-checkup-value').className).toMatch(/\bt-num\b/)
    expect(container.firstChild.getAttribute('style')).toBeNull()
  })

  it('renders an em-dash when there is no value', () => {
    render(<CheckupRow label="x" status="neutral" />)
    expect(screen.getByTestId('rk-checkup-value')).toHaveTextContent('—')
  })
})
