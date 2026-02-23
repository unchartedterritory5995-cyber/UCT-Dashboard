import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  const link = screen.getByRole('link', { name: /open in finviz/i })
  expect(link).toHaveAttribute('href', expect.stringContaining('finviz.com'))
})

test('modal shows tab buttons for all timeframes', async () => {
  const user = userEvent.setup()
  render(<TickerPopup sym="NVDA" />)
  await user.click(screen.getByTestId('ticker-NVDA'))
  expect(screen.getByRole('button', { name: '5min' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '30min' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '1hr' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Daily' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Weekly' })).toBeInTheDocument()
})

test('modal shows finviz chart by default (Daily tab)', async () => {
  const user = userEvent.setup()
  render(<TickerPopup sym="NVDA" />)
  await user.click(screen.getByTestId('ticker-NVDA'))
  const img = screen.getByAltText(/NVDA Daily chart/)
  expect(img).toBeInTheDocument()
  expect(img.src).toContain('finviz.com')
  expect(img.src).toContain('p=d')
})

test('modal shows TradingView iframe when 5min tab clicked', async () => {
  const user = userEvent.setup()
  render(<TickerPopup sym="NVDA" />)
  await user.click(screen.getByTestId('ticker-NVDA'))
  await user.click(screen.getByRole('button', { name: '5min' }))
  const frame = screen.getByTitle(/NVDA 5min/)
  expect(frame).toBeInTheDocument()
  expect(frame.src).toContain('tradingview.com')
})

test('modal has open in finviz and tradingview links', async () => {
  const user = userEvent.setup()
  render(<TickerPopup sym="NVDA" />)
  await user.click(screen.getByTestId('ticker-NVDA'))
  expect(screen.getByText(/Open in FinViz/)).toBeInTheDocument()
  expect(screen.getByText(/Open in TradingView/)).toBeInTheDocument()
})
