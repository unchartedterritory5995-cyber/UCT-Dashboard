import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import RegimeClockView, { quadrantOf } from './RegimeClockView'
import { optionsSchema } from './viewMetricConfig'

const mkRows = (levels) => levels.map((v, i) => ({ date: `2026-08-${String(i + 1).padStart(2, '0')}`, pct_above_50sma: v }))

describe('quadrantOf', () => {
  it('names each of the four regimes', () => {
    expect(quadrantOf(70, 5)).toBe('Expansion')
    expect(quadrantOf(30, 5)).toBe('Recovery')
    expect(quadrantOf(70, -5)).toBe('Distribution')
    expect(quadrantOf(30, -5)).toBe('Contraction')
  })
})

describe('RegimeClockView', () => {
  // rows are newest-first: today 70, 20 sessions ago 40 → momentum +30, level 70.
  const rows = mkRows([70, ...Array.from({ length: 19 }, () => 55), 40, 38, 36])

  it('reports the regime from level and momentum together', () => {
    const { getByTestId } = render(<RegimeClockView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ rocWindow: 20, level: 'pct_above_50sma', trail: 10 }} />)
    expect(getByTestId('regime-name').textContent).toBe('Expansion')
    expect(getByTestId('regime-momentum').textContent).toBe('+30.0')
  })

  it('reads momentum from the option window, not a fixed one', () => {
    // 10 sessions ago is 55 → momentum +15, not +30.
    const { getByTestId } = render(<RegimeClockView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ rocWindow: 10, level: 'pct_above_50sma', trail: 10 }} />)
    expect(getByTestId('regime-momentum').textContent).toBe('+15.0')
  })

  it('refuses rather than guessing when the window is too short', () => {
    const { getByTestId, queryByTestId } = render(<RegimeClockView rows={mkRows([70, 60, 50])} rowIdx={0}
      currentRow={{ pct_above_50sma: 70 }} onDrill={() => {}}
      options={{ rocWindow: 20, level: 'pct_above_50sma', trail: 10 }} />)
    expect(queryByTestId('regime-name')).toBeNull()
    expect(getByTestId('clock-insufficient').textContent).toMatch(/needs 21 sessions/i)
  })

  // The refusal used to read "Needs 21 sessions of pct_above_50sma" — the raw
  // field key, at a reader the Customize panel has only ever shown "% above 50
  // SMA" to. One series, two names, and the internal one was on screen.
  it('names the series the way the option schema names it, not by field key', () => {
    const { getByTestId } = render(<RegimeClockView rows={mkRows([70, 60, 50])} rowIdx={0}
      currentRow={{ pct_above_50sma: 70 }} onDrill={() => {}}
      options={{ rocWindow: 20, level: 'pct_above_50sma', trail: 10 }} />)
    const text = getByTestId('clock-insufficient').textContent
    const label = optionsSchema('clock').find(o => o.name === 'level')
      .choices.find(c => c.value === 'pct_above_50sma').label
    expect(text).toContain(label)
    expect(text).not.toContain('pct_above_50sma')
  })
})
