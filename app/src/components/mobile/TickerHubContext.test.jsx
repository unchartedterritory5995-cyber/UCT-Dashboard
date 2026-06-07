import { render, screen, fireEvent } from '@testing-library/react'
import { TickerHubProvider, useTickerHub } from './TickerHubContext'

function Probe() {
  const { sym, openTicker, closeTicker } = useTickerHub()
  return (
    <div>
      <span data-testid="sym">{sym ?? 'none'}</span>
      <button onClick={() => openTicker('nvda')}>open</button>
      <button onClick={closeTicker}>close</button>
    </div>
  )
}

test('openTicker sets an upper-cased sym; closeTicker clears it', () => {
  render(<TickerHubProvider><Probe /></TickerHubProvider>)
  expect(screen.getByTestId('sym').textContent).toBe('none')
  fireEvent.click(screen.getByText('open'))
  expect(screen.getByTestId('sym').textContent).toBe('NVDA')
  fireEvent.click(screen.getByText('close'))
  expect(screen.getByTestId('sym').textContent).toBe('none')
})

test('useTickerHub outside a provider returns a no-op (sym null)', () => {
  function Bare() {
    const { sym } = useTickerHub()
    return <span data-testid="bare">{sym ?? 'null'}</span>
  }
  render(<Bare />)
  expect(screen.getByTestId('bare').textContent).toBe('null')
})
