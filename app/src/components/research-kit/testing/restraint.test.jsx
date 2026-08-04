import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import GlassCard from '../GlassCard'
import VerdictChip from '../VerdictChip'
import RangeSlider from '../RangeSlider'
import ReactionBars from '../charts/ReactionBars'
import {
  countAccentSurfaces,
  countGoldHighlights,
  expectOneAccentPerCanvas,
  expectGoldBudget,
} from './restraint'

describe('restraint helper — accent surfaces (§3.1)', () => {
  it('counts zero when nothing is accented', () => {
    const { container } = render(<div><GlassCard>a</GlassCard><GlassCard>b</GlassCard></div>)
    expect(countAccentSurfaces(container)).toBe(0)
  })

  it('passes the ONE hero per canvas', () => {
    const { container } = render(<div><GlassCard accent>hero</GlassCard><GlassCard>support</GlassCard></div>)
    expect(countAccentSurfaces(container)).toBe(1)
    expect(() => expectOneAccentPerCanvas(container)).not.toThrow()
  })

  // The control case: a helper that cannot fail is not a check.
  it('FAILS on two accented surfaces in one canvas', () => {
    const { container } = render(<div><GlassCard accent>a</GlassCard><GlassCard accent>b</GlassCard></div>)
    expect(countAccentSurfaces(container)).toBe(2)
    expect(() => expectOneAccentPerCanvas(container)).toThrow(/Restraint violation/)
  })

  // I6: counting moved from class-shape (`_accent_<hash>`) to the explicit
  // `data-rk-accent` attribute — a className that merely CONTAINS "accent"
  // was never supposed to match, and still doesn't, now for a more direct
  // reason (there is no attribute at all, not just a shape mismatch).
  it('does not match a class that merely contains "accent" — no data attribute means no match', () => {
    const { container } = render(<div className="accentuate"><span className="accented" /></div>)
    expect(countAccentSurfaces(container)).toBe(0)
  })

  it('counts the passed element itself when IT is the accented surface', () => {
    const { container } = render(<GlassCard accent>solo</GlassCard>)
    expect(countAccentSurfaces(container.firstChild)).toBe(1)   // the card itself
    expect(countAccentSurfaces(container)).toBe(1)              // its wrapper
  })
})

describe('restraint helper — gold data-highlights (§3.1, I6)', () => {
  it('counts zero when nothing is gold', () => {
    const { container } = render(<VerdictChip tone="positive" label="BEAT" />)
    expect(countGoldHighlights(container)).toBe(0)
  })

  it('counts the ONE gold data-highlight on a canvas', () => {
    const { container } = render(<VerdictChip tone="gold" label="PREMIUM RICH" />)
    expect(countGoldHighlights(container)).toBe(1)
  })

  it('counts a gold RangeSlider and a gold VerdictChip together when both sit in one canvas', () => {
    const { container } = render(
      <div>
        <RangeSlider min={0} max={10} value={5} tone="gold" />
        <VerdictChip tone="gold" label="PREMIUM RICH" />
      </div>,
    )
    expect(countGoldHighlights(container)).toBe(2)
  })

  it('counts the ReactionBars implied-bracket PAIR as ONE highlight, not two', () => {
    const rows = [{ quarter: 'Q1', reaction_pct: 3, surprise_pct: 5, reported: true }]
    const { container } = render(<ReactionBars quarters={rows} impliedPct={7} />)
    expect(countGoldHighlights(container)).toBe(1)
  })

  // The control case: a helper that cannot fail is not a check.
  it('FAILS on two gold data-highlights in one canvas', () => {
    const { container } = render(
      <div>
        <VerdictChip tone="gold" label="A" />
        <VerdictChip tone="gold" label="B" />
      </div>,
    )
    expect(countGoldHighlights(container)).toBe(2)
    expect(() => expectGoldBudget(container)).toThrow(/Restraint violation/)
  })
})

describe('expectGoldBudget — accent and gold are SEPARATE budgets (§3.1, I6)', () => {
  it('passes a canvas with its one accented hero AND its one gold chip together', () => {
    // This is the intended, fully-spent state per the GlassCard JSDoc's two
    // separate bullets — NOT a violation, so a combined (summed) budget of
    // max=1 would wrongly fail it. Documents the "implement to the verbatim
    // rule" reading in restraint.js.
    const { container } = render(
      <div>
        <GlassCard accent>hero</GlassCard>
        <VerdictChip tone="gold" label="PREMIUM RICH" />
      </div>,
    )
    expect(() => expectGoldBudget(container)).not.toThrow()
    expect(expectGoldBudget(container)).toEqual({ accents: 1, golds: 1 })
  })

  // The control case for the accent half of the combined helper.
  it('FAILS when the accent budget alone is broken, even with zero gold highlights', () => {
    const { container } = render(
      <div><GlassCard accent>a</GlassCard><GlassCard accent>b</GlassCard></div>,
    )
    expect(() => expectGoldBudget(container)).toThrow(/Restraint violation/)
  })

  // The control case for the gold half of the combined helper.
  it('FAILS when the gold budget alone is broken, even with zero accent surfaces', () => {
    const { container } = render(
      <div><VerdictChip tone="gold" label="A" /><VerdictChip tone="gold" label="B" /></div>,
    )
    expect(() => expectGoldBudget(container)).toThrow(/Restraint violation/)
  })

  it('accepts a caller-supplied max', () => {
    const { container } = render(
      <div><VerdictChip tone="gold" label="A" /><VerdictChip tone="gold" label="B" /></div>,
    )
    expect(() => expectGoldBudget(container, { max: 2 })).not.toThrow()
  })
})
