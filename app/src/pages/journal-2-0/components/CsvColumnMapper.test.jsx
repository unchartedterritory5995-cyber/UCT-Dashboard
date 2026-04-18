import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CsvColumnMapper from './CsvColumnMapper'

describe('CsvColumnMapper', () => {
  const HEADERS = ['Ticker', 'Direction', 'Count', 'Buy', 'BuyDate', 'Sell', 'SellDate']
  const RAW_ROWS = [
    ['NVDA', 'Long', '100', '500', '2026-04-01', '520', '2026-04-02'],
  ]

  it('renders all 7 required field selectors', () => {
    render(
      <CsvColumnMapper
        headers={HEADERS}
        rawRows={RAW_ROWS}
        onMap={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText('Symbol')).toBeInTheDocument()
    expect(screen.getByText('Side (Long / Short)')).toBeInTheDocument()
    expect(screen.getByText('Shares')).toBeInTheDocument()
    expect(screen.getByText('Entry Price')).toBeInTheDocument()
    expect(screen.getByText('Entry Date (YYYY-MM-DD)')).toBeInTheDocument()
    expect(screen.getByText('Exit Price')).toBeInTheDocument()
    expect(screen.getByText('Exit Date (YYYY-MM-DD)')).toBeInTheDocument()
  })

  it('auto-guesses obvious mappings from header names', () => {
    render(
      <CsvColumnMapper
        headers={HEADERS}
        rawRows={RAW_ROWS}
        onMap={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    // "Ticker" should be auto-guessed as symbol
    const symbolSelect = screen.getByRole('combobox', { name: /Symbol/i })
    expect(symbolSelect.value).toBe('Ticker')
  })

  it('Parse button disabled until all required fields mapped', async () => {
    const user = userEvent.setup()
    // Headers that defeat the auto-guesser
    const weirdHeaders = ['col1', 'col2']
    render(
      <CsvColumnMapper
        headers={weirdHeaders}
        rawRows={[['a', 'b']]}
        onMap={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const submit = screen.getByRole('button', { name: /Parse with mapping/ })
    expect(submit).toBeDisabled()
  })

  it('submitting a valid mapping fires onMap with the cleaned object', async () => {
    const user = userEvent.setup()
    const onMap = vi.fn()
    render(
      <CsvColumnMapper
        headers={HEADERS}
        rawRows={RAW_ROWS}
        onMap={onMap}
        onCancel={vi.fn()}
      />,
    )
    // Auto-guess should already fill most; check submission works
    await user.click(screen.getByRole('button', { name: /Parse with mapping/ }))
    expect(onMap).toHaveBeenCalledTimes(1)
    const mapping = onMap.mock.calls[0][0]
    expect(mapping.symbol).toBeTruthy()
    expect(mapping.side).toBeTruthy()
    expect(mapping.shares).toBeTruthy()
    expect(mapping.entry_price).toBeTruthy()
    expect(mapping.entry_date).toBeTruthy()
    expect(mapping.exit_price).toBeTruthy()
    expect(mapping.exit_date).toBeTruthy()
  })

  it('Back button fires onCancel', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <CsvColumnMapper
        headers={HEADERS}
        rawRows={RAW_ROWS}
        onMap={vi.fn()}
        onCancel={onCancel}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('shows first rows of the CSV for reference', () => {
    render(
      <CsvColumnMapper
        headers={HEADERS}
        rawRows={RAW_ROWS}
        onMap={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText('First rows of your CSV')).toBeInTheDocument()
    expect(screen.getByText('NVDA')).toBeInTheDocument()
  })
})
