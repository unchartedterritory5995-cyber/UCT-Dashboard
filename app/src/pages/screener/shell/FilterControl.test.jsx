import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FilterControl from './FilterControl'

const RS = { key: 'rs_rank', label: 'RS Rank', type: 'range', allow_custom: true,
  presets: [{ label: 'Any' }, { label: 'Over 80', op: 'gte', min: 80 }], unit: null }

const SCAN = { key: 'scan', label: 'Scan', type: 'select', allow_custom: false,
  presets: [{ label: 'Any' }, { label: 'Breakout base', op: 'in', value: 'sha256:aaa' }], unit: null }

describe('FilterControl', () => {
  it('preset select emits the preset spec; Any clears', () => {
    const onChange = vi.fn()
    render(<FilterControl filter={RS} value={null} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('RS Rank'), { target: { value: 'Over 80' } })
    expect(onChange).toHaveBeenCalledWith({ op: 'gte', min: 80 })
    fireEvent.change(screen.getByLabelText('RS Rank'), { target: { value: 'Any' } })
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('custom range commits on Enter — controlled, no DOM id pairing', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<FilterControl filter={RS} value={null} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('RS Rank'), { target: { value: 'Custom…' } })
    await user.type(screen.getByLabelText('RS Rank min'), '70')
    await user.type(screen.getByLabelText('RS Rank max'), '95{Enter}')
    expect(onChange).toHaveBeenLastCalledWith({ op: 'between', min: 70, max: 95 })
  })

  it('clearing both custom inputs drops the filter and closes the row', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<FilterControl filter={RS} value={{ op: 'gte', min: 70 }} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('RS Rank'), { target: { value: 'Custom…' } })
    await user.clear(screen.getByLabelText('RS Rank min'))
    fireEvent.keyDown(screen.getByLabelText('RS Rank min'), { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(screen.queryByLabelText('RS Rank min')).toBeNull()
  })

  it('K9: the preset label rides into the spec only on the scan filter', () => {
    const onScan = vi.fn()
    render(<FilterControl filter={SCAN} value={null} onChange={onScan} />)
    fireEvent.change(screen.getByLabelText('Scan'), { target: { value: 'Breakout base' } })
    expect(onScan).toHaveBeenCalledWith({ op: 'in', value: 'sha256:aaa', label: 'Breakout base' })

    const onRs = vi.fn()
    render(<FilterControl filter={RS} value={null} onChange={onRs} />)
    fireEvent.change(screen.getByLabelText('RS Rank'), { target: { value: 'Over 80' } })
    expect(onRs).toHaveBeenCalledWith({ op: 'gte', min: 80 })
    expect(onRs.mock.calls[0][0]).not.toHaveProperty('label')
  })

  it('a value applied from outside re-seeds the inputs', () => {
    const { rerender } = render(<FilterControl filter={RS} value={null} onChange={() => {}} />)
    rerender(<FilterControl filter={RS} value={{ op: 'between', min: 60, max: 90 }} onChange={() => {}} />)
    fireEvent.change(screen.getByLabelText('RS Rank'), { target: { value: 'Custom…' } })
    expect(screen.getByLabelText('RS Rank min')).toHaveValue(60)
    expect(screen.getByLabelText('RS Rank max')).toHaveValue(90)
  })
})
