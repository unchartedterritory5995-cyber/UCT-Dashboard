import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../components/calendar/SentimentGauge', () => ({ default: () => <div>sentiment-gauge</div> }))
vi.mock('../../../components/calendar/CallRecapSection', () => ({ default: ({ recap }) => <div>recap:{recap?.headline}</div> }))
vi.mock('../hooks/useCallRecap', () => ({ default: () => ({ data: { recap: { headline: 'Strong quarter' } }, isLoading: false }) }))
vi.mock('../hooks/useEarningsAudio', () => ({ default: () => ({ data: null }) }))

import CallsTab from './CallsTab'

describe('CallsTab', () => {
  it('renders the sentiment gauge and call recap', () => {
    render(<CallsTab sym="AAPL" />)
    expect(screen.getByText('sentiment-gauge')).toBeInTheDocument()
    expect(screen.getByText(/Strong quarter/)).toBeInTheDocument()
  })
})
