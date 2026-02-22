import { render, screen, fireEvent } from '@testing-library/react'
import TickerPopup from './TickerPopup'

test('renders ticker text', () => {
  render(<TickerPopup sym="NVDA" />)
  expect(screen.getByText('NVDA')).toBeInTheDocument()
})

test('renders custom children', () => {
  render(<TickerPopup sym="NVDA">NVIDIA</TickerPopup>)
  expect(screen.getByText('NVIDIA')).toBeInTheDocument()
})

test('shows modal on click', () => {
  render(<TickerPopup sym="NVDA" />)
  fireEvent.click(screen.getByTestId('ticker-NVDA'))
  expect(screen.getByTestId('chart-modal')).toBeInTheDocument()
})

test('closes modal on overlay click', () => {
  render(<TickerPopup sym="NVDA" />)
  fireEvent.click(screen.getByTestId('ticker-NVDA'))
  expect(screen.getByTestId('chart-modal')).toBeInTheDocument()
  fireEvent.click(screen.getByTestId('chart-modal'))
  expect(screen.queryByTestId('chart-modal')).not.toBeInTheDocument()
})

test('has finviz link in modal', () => {
  render(<TickerPopup sym="NVDA" />)
  fireEvent.click(screen.getByTestId('ticker-NVDA'))
  const link = screen.getByRole('link', { name: /view on finviz/i })
  expect(link).toHaveAttribute('href', expect.stringContaining('finviz.com'))
})
