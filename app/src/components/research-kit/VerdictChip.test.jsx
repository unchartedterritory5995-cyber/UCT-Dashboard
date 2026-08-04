import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import VerdictChip from './VerdictChip'
import { VERDICT_TONES, toneGlyph } from './tones'

const TONE_TABLE = [
  ['positive', 'tonePositive', '▲'],
  ['negative', 'toneNegative', '▼'],
  ['caution', 'toneCaution', '◆'],
  ['neutral', 'toneNeutral', '—'],
  ['gold', 'toneGold', '★'],
]

describe('tones vocabulary', () => {
  it('exports the five verdict tones in a fixed order', () => {
    expect(VERDICT_TONES).toEqual(['positive', 'negative', 'caution', 'neutral', 'gold'])
  })

  it('falls back to the neutral glyph for anything unknown', () => {
    expect(toneGlyph('bogus')).toBe('—')
    expect(toneGlyph(undefined)).toBe('—')
  })
})

describe('VerdictChip tone mapping', () => {
  it.each(TONE_TABLE)('tone %s applies %s and the %s glyph', (tone, cls, glyph) => {
    const { container } = render(<VerdictChip tone={tone} label="PREMIUM RICH" />)
    const chip = container.firstChild
    expect(chip.className).toMatch(new RegExp(cls))
    expect(screen.getByText('PREMIUM RICH')).toBeInTheDocument()
    expect(chip.textContent).toContain(glyph)
  })

  it('is never hue-only: every tone renders a shape glyph (§3.3)', () => {
    for (const tone of VERDICT_TONES) {
      const { container, unmount } = render(<VerdictChip tone={tone} label="X" />)
      expect(container.querySelector('[data-testid="rk-chip-glyph"]').textContent.trim()).not.toBe('')
      unmount()
    }
  })

  it('falls back to neutral on an unknown tone instead of throwing', () => {
    const { container } = render(<VerdictChip tone="chartreuse" label="X" />)
    expect(container.firstChild.className).toMatch(/toneNeutral/)
    expect(container.firstChild.textContent).toContain('—')
  })

  it('accepts a glyph override', () => {
    const { container } = render(<VerdictChip tone="positive" glyph="✓" label="BEAT" />)
    expect(container.querySelector('[data-testid="rk-chip-glyph"]').textContent).toBe('✓')
  })

  it('renders the md size by default and sm on request', () => {
    const { container, rerender } = render(<VerdictChip label="X" />)
    expect(container.firstChild.className).toMatch(/sizeMd/)
    rerender(<VerdictChip label="X" size="sm" />)
    expect(container.firstChild.className).toMatch(/sizeSm/)
  })

  it('exposes the optional ⓘ', () => {
    render(<VerdictChip label="B+ · 3 of 4 inputs" info={{ text: 'One input is unavailable.' }} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('One input is unavailable.')
  })

  it('renders nothing without a label', () => {
    const { container } = render(<VerdictChip tone="positive" />)
    expect(container.firstChild).toBeNull()
  })

  it('stamps the chip identity marker (§4.2)', () => {
    const { container } = render(<VerdictChip label="X" />)
    expect(container.firstChild).toHaveAttribute('data-rk-identity', 'chip')
  })

  // I6 — the gold data-highlight audit hook.
  it('stamps data-rk-gold only on the gold tone', () => {
    const { container: gold } = render(<VerdictChip tone="gold" label="PREMIUM RICH" />)
    expect(gold.firstChild).toHaveAttribute('data-rk-gold', '')

    const { container: positive } = render(<VerdictChip tone="positive" label="BEAT" />)
    expect(positive.firstChild).not.toHaveAttribute('data-rk-gold')
  })

  it('does not stamp data-rk-gold when an unknown tone falls back to neutral', () => {
    const { container } = render(<VerdictChip tone="chartreuse" label="X" />)
    expect(container.firstChild).not.toHaveAttribute('data-rk-gold')
  })
})
