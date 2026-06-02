// app/src/components/CompanyLogo.test.jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import CompanyLogo from './CompanyLogo'

describe('CompanyLogo', () => {
  it('renders an img pointing at the logo endpoint', () => {
    render(<CompanyLogo sym="NVDA" />)
    const img = screen.getByAltText('NVDA logo')
    expect(img.getAttribute('src')).toBe('/api/ticker-logo/NVDA')
  })

  it('falls back to a monogram on image error', () => {
    render(<CompanyLogo sym="ZZZZ" />)
    const img = screen.getByAltText('ZZZZ logo')
    fireEvent.error(img)
    expect(screen.getByText('Z')).toBeInTheDocument()
  })
})
