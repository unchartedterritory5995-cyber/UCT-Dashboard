import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import GlassCard from '../GlassCard'
import { countAccentSurfaces, expectOneAccentPerCanvas } from './restraint'

describe('restraint helper (§3.1)', () => {
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

  it('does not match a class that merely starts with "accent"', () => {
    const { container } = render(<div className="accentuate"><span className="accented" /></div>)
    expect(countAccentSurfaces(container)).toBe(0)
  })

  it('counts the passed element itself when IT is the accented surface', () => {
    const { container } = render(<GlassCard accent>solo</GlassCard>)
    expect(countAccentSurfaces(container.firstChild)).toBe(1)   // the card itself
    expect(countAccentSurfaces(container)).toBe(1)              // its wrapper
  })
})
