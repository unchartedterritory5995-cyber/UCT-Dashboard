import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import NewsSection from './NewsSection'

// TERM-033: the position page's News read used to swallow a failure into `null`, which
// hid the section exactly as an empty answer would. A failed read is now stated.
describe('NewsSection — a failed read is stated, an empty one stays hidden', () => {
  it('failed with nothing to show: says the read failed', () => {
    render(<NewsSection items={undefined} failed />)
    expect(screen.getByRole('alert').textContent).toMatch(/could not be loaded/)
  })

  it('control: an answered-empty read renders nothing', () => {
    const { container } = render(<NewsSection items={[]} />)
    expect(container.textContent).toBe('')
  })

  it('control: headlines win over a later failed poll', () => {
    render(<NewsSection items={[{ url: 'u', time_published: 1, source: 'S', headline: 'H' }]} failed />)
    expect(screen.getByText('H')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
