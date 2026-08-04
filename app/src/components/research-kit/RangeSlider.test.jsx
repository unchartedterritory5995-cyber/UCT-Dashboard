import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import RangeSlider, {
  positionPct,
  labelPct,
  LABEL_EDGE_CLAMP_PCT,
  resolveBelowLabels,
  BAND_LABEL_COLLISION_PCT,
} from './RangeSlider'

describe('positionPct', () => {
  it('maps the range linearly onto 0..100', () => {
    expect(positionPct(0, 100, 0)).toBe(0)
    expect(positionPct(0, 100, 50)).toBe(50)
    expect(positionPct(0, 100, 100)).toBe(100)
    expect(positionPct(91, 199, 145)).toBeCloseTo(50, 5)
  })

  it('centres a degenerate range instead of dividing by zero', () => {
    expect(positionPct(50, 50, 50)).toBe(50)
    expect(positionPct(50, 50, 999)).toBe(50)
    expect(Number.isNaN(positionPct(50, 50, 50))).toBe(false)
  })

  it('clamps a value outside the range to the nearest edge', () => {
    expect(positionPct(10, 20, 5)).toBe(0)
    expect(positionPct(10, 20, 40)).toBe(100)
  })

  it('tolerates a reversed range', () => {
    expect(positionPct(100, 0, 25)).toBe(25)
  })

  it('returns null on any non-finite input', () => {
    expect(positionPct(0, 100, NaN)).toBeNull()
    expect(positionPct(null, 100, 50)).toBeNull()
    expect(positionPct(0, undefined, 50)).toBeNull()
    expect(positionPct(0, 100, Infinity)).toBeNull()
    expect(positionPct(0, 100, '')).toBeNull()
  })

  it('accepts numeric strings', () => {
    expect(positionPct('0', '100', '25')).toBe(25)
  })
})

describe('labelPct — the collision rule', () => {
  it('clamps the floating label away from both edges', () => {
    expect(labelPct(0)).toBe(LABEL_EDGE_CLAMP_PCT)
    expect(labelPct(100)).toBe(100 - LABEL_EDGE_CLAMP_PCT)
    expect(labelPct(50)).toBe(50)
  })

  it('passes null through', () => {
    expect(labelPct(null)).toBeNull()
  })
})

describe('resolveBelowLabels — the band/end-label collision rule (I2)', () => {
  it('always renders the end labels when their percentages are given', () => {
    const r = resolveBelowLabels({ minLabelPct: 12, maxLabelPct: 88, bandLoPct: null, bandHiPct: null })
    expect(r.min).toBe(true)
    expect(r.max).toBe(true)
  })

  it('omits an end label whose percentage is null', () => {
    const r = resolveBelowLabels({ minLabelPct: null, maxLabelPct: 88, bandLoPct: null, bandHiPct: null })
    expect(r.min).toBe(false)
    expect(r.max).toBe(true)
  })

  it('renders a band label that sits well clear of both ends', () => {
    const r = resolveBelowLabels({ minLabelPct: 12, maxLabelPct: 88, bandLoPct: 40, bandHiPct: 60 })
    expect(r.bandLo).toBe(true)
    expect(r.bandHi).toBe(true)
  })

  it('suppresses a band label within the collision distance of the min end label', () => {
    const r = resolveBelowLabels({
      minLabelPct: 12,
      maxLabelPct: 88,
      bandLoPct: 12 + BAND_LABEL_COLLISION_PCT, // exactly at the boundary — "within" is inclusive
      bandHiPct: 60,
    })
    expect(r.bandLo).toBe(false)
    expect(r.bandHi).toBe(true)
  })

  it('suppresses a band label within the collision distance of the max end label', () => {
    const r = resolveBelowLabels({
      minLabelPct: 12,
      maxLabelPct: 88,
      bandLoPct: 40,
      bandHiPct: 88 - BAND_LABEL_COLLISION_PCT,
    })
    expect(r.bandHi).toBe(false)
    expect(r.bandLo).toBe(true)
  })

  it('renders a band label just past the collision boundary', () => {
    const r = resolveBelowLabels({
      minLabelPct: 12,
      maxLabelPct: 88,
      bandLoPct: 12 + BAND_LABEL_COLLISION_PCT + 0.01,
      bandHiPct: null,
    })
    expect(r.bandLo).toBe(true)
  })

  it('never renders a band label whose percentage is null', () => {
    const r = resolveBelowLabels({ minLabelPct: 12, maxLabelPct: 88, bandLoPct: null, bandHiPct: null })
    expect(r.bandLo).toBe(false)
    expect(r.bandHi).toBe(false)
  })

  it('the end label always wins — a band label sitting exactly on an end label is suppressed', () => {
    const r = resolveBelowLabels({ minLabelPct: 12, maxLabelPct: 88, bandLoPct: 12, bandHiPct: 88 })
    expect(r.bandLo).toBe(false)
    expect(r.bandHi).toBe(false)
  })
})

describe('RangeSlider', () => {
  const base = {
    min: 91,
    max: 199,
    value: 182,
    minLabel: '$91.00',
    maxLabel: '$199.00',
    valueLabel: '$182.00',
  }

  // Percent assertions parse the number instead of string-comparing: jsdom is
  // free to normalise a long float in a style value, and the contract is the
  // position, not its decimal formatting.
  it('positions the marker at the computed percentage', () => {
    const { container } = render(<RangeSlider {...base} />)
    const marker = container.querySelector('[data-testid="rk-range-marker"]')
    expect(parseFloat(marker.style.left)).toBeCloseTo(positionPct(91, 199, 182), 4)
  })

  it('renders the end labels and the value label on separate rows', () => {
    const { container } = render(<RangeSlider {...base} />)
    expect(screen.getByText('$91.00')).toBeInTheDocument()
    expect(screen.getByText('$199.00')).toBeInTheDocument()
    const valueRow = container.querySelector('[data-testid="rk-range-valuerow"]')
    const endRow = container.querySelector('[data-testid="rk-range-endrow"]')
    expect(valueRow).not.toBeNull()
    expect(endRow).not.toBeNull()
    expect(valueRow.contains(screen.getByText('$91.00'))).toBe(false)
    expect(endRow.contains(screen.getByText('$182.00'))).toBe(false)
  })

  it('clamps the value label away from the edge when the marker is pinned', () => {
    const { container } = render(<RangeSlider {...base} value={91} valueLabel="$91.00" />)
    const label = container.querySelector('[data-testid="rk-range-valuelabel"]')
    expect(parseFloat(label.style.left)).toBeCloseTo(LABEL_EDGE_CLAMP_PCT, 4)
  })

  it('puts every label on tabular numerals', () => {
    const { container } = render(<RangeSlider {...base} />)
    for (const sel of ['rk-range-valuelabel', 'rk-range-minlabel', 'rk-range-maxlabel']) {
      expect(container.querySelector(`[data-testid="${sel}"]`).className).toMatch(/\bt-num\b/)
    }
  })

  it('draws the band only when lo and hi are both finite', () => {
    const { container, rerender } = render(<RangeSlider {...base} />)
    expect(container.querySelector('[data-testid="rk-range-band"]')).toBeNull()

    rerender(<RangeSlider {...base} lo={150} hi={190} />)
    const band = container.querySelector('[data-testid="rk-range-band"]')
    expect(parseFloat(band.style.left)).toBeCloseTo(positionPct(91, 199, 150), 4)
    expect(parseFloat(band.style.width)).toBeCloseTo(
      positionPct(91, 199, 190) - positionPct(91, 199, 150),
      4,
    )
  })

  it('survives a degenerate range without NaN in the DOM', () => {
    const { container } = render(
      <RangeSlider min={50} max={50} value={50} lo={50} hi={50} valueLabel="$50.00" minLabel="$50.00" maxLabel="$50.00" />,
    )
    expect(container.innerHTML).not.toMatch(/NaN/)
    expect(parseFloat(container.querySelector('[data-testid="rk-range-marker"]').style.left)).toBe(50)
  })

  it('renders the track but no marker when value is missing', () => {
    const { container } = render(<RangeSlider min={0} max={10} minLabel="0" maxLabel="10" />)
    expect(container.querySelector('[data-testid="rk-range-track"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="rk-range-marker"]')).toBeNull()
  })

  it('applies the tone class and falls back to neutral', () => {
    const { container, rerender } = render(<RangeSlider {...base} tone="gold" />)
    expect(container.querySelector('[data-testid="rk-range-marker"]').className).toMatch(/toneGold/)
    rerender(<RangeSlider {...base} tone="chartreuse" />)
    expect(container.querySelector('[data-testid="rk-range-marker"]').className).toMatch(/toneNeutral/)
  })

  it('renders an optional eyebrow with an ⓘ', () => {
    render(<RangeSlider {...base} label="52-week range" info="Where price sits in its yearly range." />)
    expect(screen.getByText('52-week range')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'About 52-week range' })).toBeInTheDocument()
  })

  it('gives the track an accessible description', () => {
    const { container } = render(<RangeSlider {...base} label="52-week range" />)
    const track = container.querySelector('[data-testid="rk-range-track"]')
    expect(track.getAttribute('role')).toBe('img')
    expect(track.getAttribute('aria-label')).toContain('$182.00')
  })

  // I2 — expected-move dollar strip: bandLoLabel/bandHiLabel at the lo/hi band
  // edges, sharing the end-label row, suppressed on collision with min/max.
  it('renders band-edge labels at the band position when clear of the ends', () => {
    const { container } = render(<RangeSlider {...base} lo={140} hi={160} bandLoLabel="$140.00" bandHiLabel="$160.00" />)
    const loLabel = container.querySelector('[data-testid="rk-range-bandlolabel"]')
    const hiLabel = container.querySelector('[data-testid="rk-range-bandhilabel"]')
    expect(loLabel).not.toBeNull()
    expect(hiLabel).not.toBeNull()
    expect(loLabel.textContent).toBe('$140.00')
    expect(parseFloat(loLabel.style.left)).toBeCloseTo(labelPct(positionPct(91, 199, 140)), 4)
    expect(loLabel.className).toMatch(/\bt-num\b/)
  })

  it('does not render band-edge labels when the props are omitted', () => {
    const { container } = render(<RangeSlider {...base} lo={140} hi={160} />)
    expect(container.querySelector('[data-testid="rk-range-bandlolabel"]')).toBeNull()
    expect(container.querySelector('[data-testid="rk-range-bandhilabel"]')).toBeNull()
  })

  it('suppresses a band-edge label that collides with the min end label', () => {
    // min=91 clamps to labelPct(0)=12; a `lo` right at the low edge of the
    // track lands its label on top of the min label and must be suppressed.
    const { container } = render(<RangeSlider {...base} lo={92} hi={160} bandLoLabel="$92.00" bandHiLabel="$160.00" />)
    expect(container.querySelector('[data-testid="rk-range-bandlolabel"]')).toBeNull()
    expect(container.querySelector('[data-testid="rk-range-bandhilabel"]')).not.toBeNull()
  })

  it('suppresses a band-edge label that collides with the max end label', () => {
    const { container } = render(<RangeSlider {...base} lo={140} hi={198} bandLoLabel="$140.00" bandHiLabel="$198.00" />)
    expect(container.querySelector('[data-testid="rk-range-bandhilabel"]')).toBeNull()
    expect(container.querySelector('[data-testid="rk-range-bandlolabel"]')).not.toBeNull()
  })
})
