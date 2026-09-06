import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen, fireEvent } from '../../test-utils'
import ResearchHeader from './ResearchHeader'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => mockNavigate }
})

// SymbolSearch's real dropdown/fetch behavior isn't the point of this test --
// stub it to a minimal control that exposes onSymbolChange directly, mirroring
// how other header tests in this app isolate SymbolSearch (it already has its
// own dedicated test coverage elsewhere).
vi.mock('../../components/chart/SymbolSearch', () => ({
  default: ({ sym, onSymbolChange, displayLabel }) => (
    <button
      data-testid={sym ? 'symbol-search-primary' : 'symbol-search-compare'}
      onClick={() => onSymbolChange(sym ? 'TSLA' : 'MSFT')}
    >
      {displayLabel || sym || 'search'}
    </button>
  ),
}))

describe('ResearchHeader — Compare entry point', () => {
  beforeEach(() => mockNavigate.mockClear())

  it('renders a Compare entry point distinct from the primary symbol search', () => {
    renderWithProviders(
      <ResearchHeader sym="AAPL" meta={{}} live={{}} ratings={null} onSymbolChange={() => {}} />,
    )
    expect(screen.getByTestId('research-compare-entry')).toBeInTheDocument()
    expect(screen.getByTestId('symbol-search-compare')).toHaveTextContent('+ Compare')
  })

  it('choosing a comparator navigates to the canonical compare route for the current sym', () => {
    renderWithProviders(
      <ResearchHeader sym="AAPL" meta={{}} live={{}} ratings={null} onSymbolChange={() => {}} />,
    )
    fireEvent.click(screen.getByTestId('symbol-search-compare'))
    expect(mockNavigate).toHaveBeenCalledWith('/research/AAPL/compare/MSFT')
  })

  it('the primary symbol search still calls onSymbolChange, not the compare navigator', () => {
    const onSymbolChange = vi.fn()
    renderWithProviders(
      <ResearchHeader sym="AAPL" meta={{}} live={{}} ratings={null} onSymbolChange={onSymbolChange} />,
    )
    fireEvent.click(screen.getByTestId('symbol-search-primary'))
    expect(onSymbolChange).toHaveBeenCalledWith('TSLA')
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
