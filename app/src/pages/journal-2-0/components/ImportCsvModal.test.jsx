import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImportCsvModal from './ImportCsvModal'

describe('ImportCsvModal — step 1 (drop)', () => {
  it('mounts with title', () => {
    render(<ImportCsvModal onConfirmed={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('heading', { name: /Import Trades from CSV/ })).toBeInTheDocument()
  })

  it('renders the dropzone with instruction text', () => {
    render(<ImportCsvModal onConfirmed={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/Drop a CSV file here/)).toBeInTheDocument()
  })

  it('renders template download buttons', () => {
    render(<ImportCsvModal onConfirmed={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Pre-matched template/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Raw executions template/ })).toBeInTheDocument()
  })

  it('lists all 5 supported formats', () => {
    render(<ImportCsvModal onConfirmed={vi.fn()} onClose={vi.fn()} />)
    // Match bold format names only (anchor to <strong> text)
    expect(screen.getByText('Pre-matched', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('Schwab', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('IBKR', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('E*Trade', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('Unknown', { selector: 'strong' })).toBeInTheDocument()
  })

  it('Esc closes the modal', () => {
    const onClose = vi.fn()
    render(<ImportCsvModal onConfirmed={vi.fn()} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('Cancel button fires onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ImportCsvModal onConfirmed={vi.fn()} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('ImportCsvModal — preview + confirm flow', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mockPreview(response) {
    global.fetch.mockImplementation(async (url) => {
      if (url.includes('/import/preview') && !url.includes('preview-mapped')) {
        return {
          ok: true,
          json: async () => response,
        }
      }
      return { ok: true, json: async () => ({ imported: response.trades.length }) }
    })
  }

  it('uploading a file fires preview fetch and shows parsed trades', async () => {
    const user = userEvent.setup()
    mockPreview({
      format: 'pre_matched',
      trades: [
        {
          symbol: 'NVDA',
          side: 'Long',
          shares: 100,
          entryPrice: 500,
          exitPrice: 520,
          entryDate: '2026-04-01T00:00:00Z',
          exitDate: '2026-04-02T00:00:00Z',
        },
      ],
      errors: [],
      warnings: [],
      headers: [],
      raw_rows: [],
    })

    render(<ImportCsvModal onConfirmed={vi.fn()} onClose={vi.fn()} />)
    const file = new File(['symbol\nNVDA'], 'trades.csv', { type: 'text/csv' })
    const input = document.querySelector('input[type="file"]')
    await user.upload(input, file)

    await waitFor(() => {
      expect(screen.getByText(/ready to import/)).toBeInTheDocument()
    })
    expect(screen.getByText('NVDA')).toBeInTheDocument()
  })

  it('confirm button fires the confirm fetch and calls onConfirmed', async () => {
    const user = userEvent.setup()
    const trades = [
      {
        symbol: 'NVDA',
        side: 'Long',
        shares: 100,
        entryPrice: 500,
        exitPrice: 520,
        entryDate: '2026-04-01T00:00:00Z',
        exitDate: '2026-04-02T00:00:00Z',
      },
    ]
    mockPreview({
      format: 'pre_matched',
      trades,
      errors: [],
      warnings: [],
      headers: [],
      raw_rows: [],
    })

    const onConfirmed = vi.fn()
    render(<ImportCsvModal onConfirmed={onConfirmed} onClose={vi.fn()} />)

    const file = new File(['x'], 'trades.csv', { type: 'text/csv' })
    const input = document.querySelector('input[type="file"]')
    await user.upload(input, file)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Import 1 trade/ })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /Import 1 trade/ }))

    await waitFor(() => {
      expect(onConfirmed).toHaveBeenCalledWith(1, 0)
    })
  })

  it('unknown format routes to the mapping wizard', async () => {
    const user = userEvent.setup()
    mockPreview({
      format: 'unknown',
      trades: [],
      errors: [],
      warnings: ['Unrecognized format — use the column mapper to match your columns.'],
      headers: ['Ticker', 'Dir', 'Qty', 'Buy', 'BuyDate', 'Sell', 'SellDate'],
      raw_rows: [['NVDA', 'Long', '100', '500', '2026-04-01', '520', '2026-04-02']],
    })

    render(<ImportCsvModal onConfirmed={vi.fn()} onClose={vi.fn()} />)
    const file = new File(['x'], 'trades.csv', { type: 'text/csv' })
    const input = document.querySelector('input[type="file"]')
    await user.upload(input, file)

    await waitFor(() => {
      expect(screen.getByText(/Map each required Journal 2.0 field/)).toBeInTheDocument()
    })
  })

  it('shows per-row error list when preview has errors', async () => {
    const user = userEvent.setup()
    mockPreview({
      format: 'pre_matched',
      trades: [
        {
          symbol: 'NVDA',
          side: 'Long',
          shares: 100,
          entryPrice: 500,
          exitPrice: 520,
          entryDate: '2026-04-01T00:00:00Z',
          exitDate: '2026-04-02T00:00:00Z',
        },
      ],
      errors: [
        { row: 3, message: 'symbol is required' },
        { row: 5, message: 'shares must be > 0' },
      ],
      warnings: [],
      headers: [],
      raw_rows: [],
    })

    render(<ImportCsvModal onConfirmed={vi.fn()} onClose={vi.fn()} />)
    const file = new File(['x'], 'trades.csv', { type: 'text/csv' })
    const input = document.querySelector('input[type="file"]')
    await user.upload(input, file)

    await waitFor(() => {
      expect(screen.getByText(/2 skipped/)).toBeInTheDocument()
    })
    // Errors are in a <details>; expand to reveal
    await user.click(screen.getByText(/2 rows skipped — show details/))
    expect(screen.getByText(/symbol is required/)).toBeInTheDocument()
    expect(screen.getByText(/shares must be > 0/)).toBeInTheDocument()
  })

  it('file over 10 MB rejected client-side', async () => {
    const user = userEvent.setup()
    render(<ImportCsvModal onConfirmed={vi.fn()} onClose={vi.fn()} />)
    // Build a sparse-looking big file by mocking size
    const bigContent = 'x'.repeat(100)
    const file = new File([bigContent], 'big.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024 })

    const input = document.querySelector('input[type="file"]')
    await user.upload(input, file)

    expect(screen.getByRole('alert')).toHaveTextContent(/exceeds 10 MB/i)
  })
})
