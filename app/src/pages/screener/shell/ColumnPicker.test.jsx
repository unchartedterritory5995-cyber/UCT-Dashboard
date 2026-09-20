import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ColumnPicker from './ColumnPicker'

const ALL = [
  { key: 'ticker', label: 'Ticker' }, { key: 'price', label: 'Price' },
  { key: 'candle_score', label: 'Score' }, { key: 'pole_pct', label: 'Pole%' },
]

describe('ColumnPicker', () => {
  it('toggles a column on/off; ticker is locked', () => {
    const onChange = vi.fn()
    render(<ColumnPicker open onClose={() => {}} allColumns={ALL}
      visible={['ticker', 'price']} onChange={onChange} onReset={() => {}} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /score/i }))
    expect(onChange).toHaveBeenCalledWith(['ticker', 'price', 'candle_score'])
    expect(screen.getByRole('checkbox', { name: /ticker/i })).toBeDisabled()
  })

  it('reorder buttons move a visible column', () => {
    const onChange = vi.fn()
    render(<ColumnPicker open onClose={() => {}} allColumns={ALL}
      visible={['ticker', 'price', 'candle_score']} onChange={onChange} onReset={() => {}} />)
    fireEvent.click(screen.getByLabelText('Move Score up'))
    expect(onChange).toHaveBeenCalledWith(['ticker', 'candle_score', 'price'])
  })

  it('search narrows the list', () => {
    render(<ColumnPicker open onClose={() => {}} allColumns={ALL}
      visible={['ticker']} onChange={() => {}} onReset={() => {}} />)
    fireEvent.change(screen.getByLabelText('Find a column'), { target: { value: 'pole' } })
    expect(screen.getByText('Pole%')).toBeInTheDocument()
    expect(screen.queryByText('Price')).toBeNull()
  })

  it('moving the SECOND visible item up never displaces ticker from position 0', () => {
    const onChange = vi.fn()
    render(<ColumnPicker open onClose={() => {}} allColumns={ALL}
      visible={['ticker', 'price', 'candle_score']} onChange={onChange} onReset={() => {}} />)
    fireEvent.click(screen.getByLabelText('Move Price up'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('saves the current columns as a named preset', () => {
    const onSavePreset = vi.fn()
    render(<ColumnPicker open onClose={() => {}} allColumns={ALL}
      visible={['ticker', 'price']} onChange={() => {}} onReset={() => {}} onSavePreset={onSavePreset} />)
    fireEvent.change(screen.getByLabelText('Preset name'), { target: { value: 'My momentum' } })
    fireEvent.click(screen.getByRole('button', { name: /save view/i }))
    expect(onSavePreset).toHaveBeenCalledWith('My momentum')
  })

  it('offers no save affordance when onSavePreset is absent', () => {
    render(<ColumnPicker open onClose={() => {}} allColumns={ALL}
      visible={['ticker']} onChange={() => {}} onReset={() => {}} />)
    expect(screen.queryByLabelText('Preset name')).toBeNull()
  })
})
