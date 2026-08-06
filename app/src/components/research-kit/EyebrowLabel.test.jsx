import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import EyebrowLabel from './EyebrowLabel'

describe('EyebrowLabel', () => {
  it('renders its text with the eyebrow class', () => {
    const { container } = render(<EyebrowLabel>Expected move</EyebrowLabel>)
    expect(screen.getByText('Expected move')).toBeInTheDocument()
    expect(container.firstChild.className).toMatch(/eyebrow/)
  })

  it('renders no ⓘ affordance by default', () => {
    render(<EyebrowLabel>Expected move</EyebrowLabel>)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('accepts info as a plain string', () => {
    render(<EyebrowLabel info="The options-implied move through the report.">Expected move</EyebrowLabel>)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('The options-implied move through the report.')
  })

  it('accepts info as an object with a methodology href', () => {
    render(
      <EyebrowLabel info={{ text: 'Plain English.', href: '/methodology#move' }}>
        Expected move
      </EyebrowLabel>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('link').getAttribute('href')).toBe('/methodology#move')
  })

  it('labels the ⓘ trigger from the eyebrow text', () => {
    render(<EyebrowLabel info="x">Expected move</EyebrowLabel>)
    expect(screen.getByRole('button', { name: 'About Expected move' })).toBeInTheDocument()
  })

  it('honours the `as` element and forwards id + className', () => {
    const { container } = render(
      <EyebrowLabel as="h3" id="em-label" className="extra">Expected move</EyebrowLabel>,
    )
    const el = container.firstChild
    expect(el.tagName).toBe('H3')
    expect(el.id).toBe('em-label')
    expect(el.className).toMatch(/extra/)
  })
})
