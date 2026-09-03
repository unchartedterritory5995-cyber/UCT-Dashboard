// app/src/components/provenance/Provenance.test.jsx
//
// S8 Step 1's own named deliverable for this component: the degraded state
// (PRD-S8 §9.8) — "provenance unavailable" is a valid, honest render, never a
// fabricated receipt and never a silently bare value.

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import Provenance from './Provenance'

afterEach(cleanup)

describe('the degraded state — no provenance record available', () => {
  it('renders the value AND an explicit "provenance unavailable" affordance', () => {
    render(<Provenance value="$505.24" provenance={null} />)
    expect(screen.getByTestId('provenance-degraded')).toHaveTextContent('$505.24')
    expect(screen.getByTestId('provenance-unavailable-note')).toHaveTextContent(/provenance unavailable/i)
  })

  it('never fabricates a receipt — no source/as-of text appears when provenance is null', () => {
    render(<Provenance value="42" provenance={null} calcVersion="v3" />)
    // calcVersion is a real prop, but with provenance=null it must never be
    // rendered as if it came from a genuine record.
    expect(screen.queryByText(/v3/)).toBeNull()
  })

  it('the value still renders even though provenance is unavailable — never a silently bare value either way', () => {
    render(<Provenance value="not fetched, but not hidden either" provenance={null} />)
    expect(screen.getByTestId('provenance-degraded')).toHaveTextContent('not fetched, but not hidden either')
  })
})

describe('the present-provenance state', () => {
  it('renders plainly, distinct from the degraded state', () => {
    render(<Provenance
      value="$505.24"
      provenance={{ sourceActivity: 'massive.get_quote', sourceEntity: null, timestamp: 1788393600000 }}
    />)
    expect(screen.getByTestId('provenance-present')).toHaveTextContent('$505.24')
    expect(screen.queryByTestId('provenance-degraded')).toBeNull()
    expect(screen.queryByTestId('provenance-unavailable-note')).toBeNull()
  })

  it('carries the source/as-of/calc-version as a minimal, testable affordance (title), not a fabricated one', () => {
    render(<Provenance
      value="230.00"
      provenance={{ sourceActivity: 'fmp_client.get_quote', timestamp: 1788379201000 }}
      calcVersion="v1"
    />)
    const el = screen.getByTestId('provenance-present')
    expect(el.title).toContain('fmp_client.get_quote')
    expect(el.title).toContain('calc v1')
  })
})

describe('density is accepted and threaded through, never changes which state renders', () => {
  it('the degraded state renders identically regardless of density', () => {
    render(<Provenance value="x" provenance={null} density="inline" />)
    expect(screen.getByTestId('provenance-degraded').dataset.density).toBe('inline')
  })
})
