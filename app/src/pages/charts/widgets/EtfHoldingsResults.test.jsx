import { render } from '@testing-library/react'
import { vi } from 'vitest'
import EtfHoldingsResults from './EtfHoldingsResults'

// Sector/industry come straight off the /api/etf/holdings response (server-side,
// bulk industry_map lookup) — assert the widget forwards them into metaOverride
// rather than leaving the column to the generic (100-cap, alphabetical) watchlist
// meta-batch path. See the file's own header comment for why.
vi.mock('../../../hooks/useMobileSWR', () => ({
  default: () => ({
    data: {
      symbol: 'SPY',
      holdings: [
        { sym: 'NVDA', name: 'Nvidia', weight: 7.94, sector: 'Technology', industry: 'Semiconductors' },
        { sym: 'ZZUNMAPPED1', name: 'Unmapped', weight: 0.01, sector: null, industry: null },
      ],
    },
    mutate: vi.fn(),
    isValidating: false,
  }),
}))
vi.mock('../../../utils/prefetchBars', () => ({ prefetchListDeep: vi.fn() }))

let capturedProps = null
vi.mock('../../Watchlists', () => ({
  default: (props) => { capturedProps = props; return null },
}))

beforeEach(() => { capturedProps = null })

test('forwards sector/industry from the holdings payload into metaOverride', () => {
  render(<EtfHoldingsResults sym="SPY" />)
  expect(capturedProps).not.toBeNull()
  expect(capturedProps.metaOverride.NVDA).toEqual({
    weight: 7.94, name: 'Nvidia', sector: 'Technology', industry: 'Semiconductors',
  })
  // A holding the map hasn't classified yet degrades to null, never drops the key.
  expect(capturedProps.metaOverride.ZZUNMAPPED1).toEqual({
    weight: 0.01, name: 'Unmapped', sector: null, industry: null,
  })
})
