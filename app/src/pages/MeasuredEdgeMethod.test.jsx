// The "Measured edge" method page: it renders, it explains the replay against a plain 20-day-high breakout and
// the out-of-sample check, it says hypothetical, and it never uses the words confidence or probability.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import MeasuredEdgeMethod, { MEASURED_EDGE_METHOD_PATH } from './MeasuredEdgeMethod'

describe('MeasuredEdgeMethod', () => {
  it('renders the method and its limits, without forecast words or internal paths', () => {
    render(<MeasuredEdgeMethod />)
    const page = screen.getByTestId('measured-edge-method-page')
    const text = page.textContent
    expect(MEASURED_EDGE_METHOD_PATH).toBe('/methodology/measured-edge')
    expect(text).toMatch(/20-day high/)
    expect(text).toMatch(/held back/)
    expect(text).toMatch(/hypothetical back-test, not a guarantee/i)
    expect(text).not.toMatch(/confidence|probability/i)
    expect(text).not.toMatch(/lab\/|\.py|C:\\|outcome_confidence/i)
  })
})
