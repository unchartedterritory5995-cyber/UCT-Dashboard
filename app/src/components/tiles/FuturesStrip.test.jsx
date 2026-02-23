import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import FuturesStrip from './FuturesStrip'

vi.mock('swr', () => ({
  default: () => ({ data: undefined, error: undefined }),
}))

const mockData = {
  futures: {
    BTC: { price: '67,105', chg: '+1.20%', css: 'pos' },
  },
  etfs: {
    QQQ: { price: '495.79', chg: '+0.50%', css: 'pos' },
    SPY: { price: '580.00', chg: '+0.40%', css: 'pos' },
    IWM: { price: '210.00', chg: '+0.10%', css: 'pos' },
    DIA: { price: '430.00', chg: '+0.20%', css: 'pos' },
    VIX: { price: '19.62',  chg: '-3.30%', css: 'neg' },
  }
}

test('renders all 6 symbols', () => {
  render(<FuturesStrip data={mockData} />)
  expect(screen.getByText('QQQ')).toBeInTheDocument()
  expect(screen.getByText('SPY')).toBeInTheDocument()
  expect(screen.getByText('IWM')).toBeInTheDocument()
  expect(screen.getByText('DIA')).toBeInTheDocument()
  expect(screen.getByText('BTC')).toBeInTheDocument()
  expect(screen.getByText('VIX')).toBeInTheDocument()
})

test('renders prices', () => {
  render(<FuturesStrip data={mockData} />)
  expect(screen.getByText('495.79')).toBeInTheDocument()
  expect(screen.getByText('+0.50%')).toBeInTheDocument()
  expect(screen.getByText('67,105')).toBeInTheDocument()
})

test('renders loading when no data', () => {
  render(<FuturesStrip data={null} />)
  expect(screen.getByText(/loading/i)).toBeInTheDocument()
})

test('clicking QQQ cell opens chart modal', () => {
  render(<FuturesStrip data={mockData} />)
  fireEvent.click(screen.getByTestId('ticker-QQQ'))
  expect(screen.getByTestId('chart-modal')).toBeInTheDocument()
})

test('clicking BTC cell opens chart modal', () => {
  render(<FuturesStrip data={mockData} />)
  fireEvent.click(screen.getByTestId('ticker-BTC'))
  expect(screen.getByTestId('chart-modal')).toBeInTheDocument()
})
