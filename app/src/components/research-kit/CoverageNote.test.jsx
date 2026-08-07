import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import CoverageNote, { coverageText, missingText } from './CoverageNote'

const FULL = { counted: 6, of: 6, missing: [], weight: 1 }
const PARTIAL = { counted: 4, of: 6, missing: ['eps', 'smr'], weight: 0.6 }

describe('CoverageNote', () => {
  it('says nothing when the composite measured every input', () => {
    const { container } = render(<CoverageNote coverage={FULL} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('discloses a partial basis', () => {
    render(<CoverageNote coverage={PARTIAL} />)
    expect(screen.getByText('Measured on 4 of 6 inputs')).toBeInTheDocument()
  })

  it('names the missing components in plain English, not raw keys', () => {
    // The user cannot act on "eps, smr". The explanation is the whole point.
    const t = missingText(PARTIAL)
    expect(t).toContain('EPS')
    expect(t).toContain('SMR')
    expect(t).not.toContain('smr')
    expect(t).toMatch(/re-weighted/)
  })

  it('explains that a growth rating can be UNDEFINED, not merely missing', () => {
    // 5 of the 8 null-EPS names sampled had a negative prior-year base, which
    // makes the percentage undefined. Saying only "unavailable" would imply a
    // fetch failure and invite someone to "fix" it by inventing a number.
    expect(missingText(PARTIAL)).toMatch(/prior-year figure was a loss/)
  })

  it('uses singular grammar for exactly one missing input', () => {
    expect(missingText({ counted: 5, of: 6, missing: ['eps'] })).toMatch(/^EPS is unavailable/)
  })

  it('joins several missing inputs readably', () => {
    const t = missingText({ counted: 3, of: 6, missing: ['eps', 'smr', 'value'] })
    expect(t).toMatch(/^EPS, SMR and Value are unavailable/)
  })

  it.each([
    ['null coverage', null],
    ['undefined coverage', undefined],
    ['a malformed payload', { of: 6 }],
    ['a zero-length scale', { counted: 0, of: 0, missing: [] }],
  ])('renders nothing for %s rather than a broken sentence', (_label, cov) => {
    expect(coverageText(cov)).toBeNull()
    const { container } = render(<CoverageNote coverage={cov} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('discloses even when every single input is missing', () => {
    // The composite is null here, but the note must still explain WHY rather
    // than leaving a bare em dash.
    render(<CoverageNote coverage={{ counted: 0, of: 6, missing: ['eps', 'rs'], weight: 0 }} />)
    expect(screen.getByText('Measured on 0 of 6 inputs')).toBeInTheDocument()
  })
})
