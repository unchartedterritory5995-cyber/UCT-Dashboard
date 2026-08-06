import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import GlassCard from './GlassCard'

describe('GlassCard', () => {
  it('renders children inside a <section> by default', () => {
    const { container } = render(<GlassCard><p>body</p></GlassCard>)
    expect(container.firstChild.tagName).toBe('SECTION')
    expect(screen.getByText('body')).toBeInTheDocument()
  })

  it('wears the neutral border by default — never gold', () => {
    const { container } = render(<GlassCard>x</GlassCard>)
    expect(container.firstChild.className).toMatch(/card/)
    expect(container.firstChild.className).not.toMatch(/accent/)
  })

  it('adds the accent class only when accent is set', () => {
    const { container } = render(<GlassCard accent>x</GlassCard>)
    expect(container.firstChild.className).toMatch(/accent/)
  })

  it('adds the elevated class only when elevated is set', () => {
    const { container, rerender } = render(<GlassCard>x</GlassCard>)
    expect(container.firstChild.className).not.toMatch(/elevated/)
    rerender(<GlassCard elevated>x</GlassCard>)
    expect(container.firstChild.className).toMatch(/elevated/)
  })

  it('honours `as`, ariaLabel, className and extra DOM props', () => {
    const { container } = render(
      <GlassCard as="article" ariaLabel="Setup" className="extra" data-testid="gc">x</GlassCard>,
    )
    const el = container.firstChild
    expect(el.tagName).toBe('ARTICLE')
    expect(el.getAttribute('aria-label')).toBe('Setup')
    expect(el.className).toMatch(/extra/)
    expect(el.getAttribute('data-testid')).toBe('gc')
  })

  it('carries no inline layout styles (CSS modules only)', () => {
    const { container } = render(<GlassCard accent elevated>x</GlassCard>)
    expect(container.firstChild.getAttribute('style')).toBeNull()
  })
})
