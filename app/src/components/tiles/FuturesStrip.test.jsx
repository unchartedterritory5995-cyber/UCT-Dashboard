import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import FuturesStrip from './FuturesStrip'

vi.mock('swr', () => ({
  default: () => ({ data: undefined, error: undefined }),
}))

const mockData = {
  futures: {
    NQ:  { price: '25,039.75', chg: '+0.54%', css: 'pos' },
    ES:  { price: '6,909.50',  chg: '+0.22%', css: 'pos' },
    RTY: { price: '2,663.00',  chg: '+0.10%', css: 'pos' },
    BTC: { price: '67,105',    chg: '+1.20%', css: 'pos' },
  },
  etfs: {
    QQQ: { price: '495.79', chg: '+0.50%', css: 'pos' },
    SPY: { price: '580.00', chg: '+0.40%', css: 'pos' },
    IWM: { price: '210.00', chg: '+0.10%', css: 'pos' },
    DIA: { price: '430.00', chg: '+0.20%', css: 'pos' },
    VIX: { price: '19.62',  chg: '-3.30%', css: 'neg' },
  }
}

test('renders all futures symbols', () => {
  render(<FuturesStrip data={mockData} />)
  expect(screen.getByText('NQ')).toBeInTheDocument()
  expect(screen.getByText('ES')).toBeInTheDocument()
  expect(screen.getByText('RTY')).toBeInTheDocument()
  expect(screen.getByText('BTC')).toBeInTheDocument()
})

test('renders all ETF symbols', () => {
  render(<FuturesStrip data={mockData} />)
  expect(screen.getByText('QQQ')).toBeInTheDocument()
  expect(screen.getByText('SPY')).toBeInTheDocument()
  expect(screen.getByText('VIX')).toBeInTheDocument()
})

test('renders prices', () => {
  render(<FuturesStrip data={mockData} />)
  expect(screen.getByText('25,039.75')).toBeInTheDocument()
  expect(screen.getByText('+0.54%')).toBeInTheDocument()
})

test('renders loading when no data', () => {
  render(<FuturesStrip data={null} />)
  expect(screen.getByText(/loading/i)).toBeInTheDocument()
})

test('clicking NQ cell opens chart modal', () => {
  render(<FuturesStrip data={mockData} />)
  fireEvent.click(screen.getByTestId('ticker-NQ'))
  expect(screen.getByTestId('chart-modal')).toBeInTheDocument()
})
