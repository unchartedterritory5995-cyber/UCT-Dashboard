// app/src/components/MoversSidebar.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Stub the logo + popup + data hooks so the component mounts cheaply.
vi.mock('./CompanyLogo', () => ({ default: ({ sym }) => <span data-testid="logo">{sym}</span> }))
vi.mock('./TickerPopup', () => ({ default: ({ children }) => <>{children}</> }))
vi.mock('../hooks/useMobileSWR', () => ({ default: () => ({ data: undefined, error: undefined, mutate: () => {} }) }))
vi.mock('../hooks/useBatchTweetCounts', () => ({ default: () => ({ data: {} }) }))
vi.mock('../hooks/useTapeFeed', () => ({ default: () => ({ data: [] }) }))
vi.mock('../hooks/useTickerTweets', () => ({ default: () => ({ data: [] }) }))

import MoversSidebar from './MoversSidebar'

describe('MoversSidebar', () => {
  it('renders a company logo for each mover row', () => {
    render(<MoversSidebar data={{
      ripping: [{ sym: 'NVDA', pct: '+4.2%' }],
      drilling: [{ sym: 'TSLA', pct: '-3.0%' }],
    }} />)
    const logos = screen.getAllByTestId('logo').map(l => l.textContent)
    expect(logos).toEqual(expect.arrayContaining(['NVDA', 'TSLA']))
  })
})
