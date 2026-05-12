import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PreTradeVerdictCard from './PreTradeVerdictCard'

describe('PreTradeVerdictCard', () => {
  it('renders nothing when verdict is null', () => {
    const { container } = render(<PreTradeVerdictCard verdict={null} isLoading={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders loading spinner when isLoading', () => {
    render(<PreTradeVerdictCard verdict={null} isLoading={true} />)
    expect(screen.getByText(/Compass is thinking/i)).toBeInTheDocument()
  })

  it('renders GO label in green', () => {
    render(<PreTradeVerdictCard verdict={{
      label: 'GO', paragraph: 'Bull Flag at AMBER is +1.8R over last 90d.',
      factors: ['90d setup avg: +1.8R'],
    }} isLoading={false} />)
    expect(screen.getByText('GO')).toBeInTheDocument()
    expect(screen.getByText(/Bull Flag at AMBER/i)).toBeInTheDocument()
  })

  it('renders SKIP label in red with paragraph', () => {
    render(<PreTradeVerdictCard verdict={{
      label: 'SKIP', paragraph: 'Risk exceeds your 1% cap.',
      factors: ['risk 2.0% > cap 1%'],
    }} isLoading={false} />)
    expect(screen.getByText('SKIP')).toBeInTheDocument()
    expect(screen.getByText(/Risk exceeds your 1% cap/i)).toBeInTheDocument()
  })

  it('renders factors when expandable section is opened', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    render(<PreTradeVerdictCard verdict={{
      label: 'GO', paragraph: 'Looks fine.',
      factors: ['Setup +1.8R avg', 'Regime AMBER fit'],
    }} isLoading={false} />)
    await user.click(screen.getByRole('button', { name: /What Compass weighed/i }))
    expect(screen.getByText(/Setup \+1.8R avg/i)).toBeInTheDocument()
  })
})
