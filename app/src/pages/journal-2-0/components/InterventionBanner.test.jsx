import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import InterventionBanner from './InterventionBanner'

describe('InterventionBanner', () => {
  it('renders nothing when interventions empty', () => {
    const { container } = render(<InterventionBanner interventions={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a danger banner with message', () => {
    render(<InterventionBanner interventions={[{
      id: 'i1', rule: 'daily_loss_approach', severity: 'danger',
      message: 'You\'re down $2500 today — past 75% of your 3% limit.',
    }]} />)
    expect(screen.getByText(/down \$2500/i)).toBeInTheDocument()
  })

  it('renders multiple interventions stacked', () => {
    render(<InterventionBanner interventions={[
      { id: 'i1', rule: 'rapid_fire_trading', severity: 'warning', message: 'Slow down.' },
      { id: 'i2', rule: 'cooling_off_active', severity: 'warning', message: 'Pause please.' },
    ]} />)
    expect(screen.getByText(/Slow down/i)).toBeInTheDocument()
    expect(screen.getByText(/Pause please/i)).toBeInTheDocument()
  })

  it('clicking Dismiss fires onDismiss', async () => {
    const onDismiss = vi.fn()
    const user = userEvent.setup()
    render(<InterventionBanner interventions={[{
      id: 'i1', rule: 'rapid_fire_trading', severity: 'warning', message: 'Hi.',
    }]} onDismiss={onDismiss} />)
    await user.click(screen.getByRole('button', { name: /Dismiss/i }))
    expect(onDismiss).toHaveBeenCalledWith('i1')
  })
})
