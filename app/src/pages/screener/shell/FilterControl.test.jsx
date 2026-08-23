import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FilterControl from './FilterControl'
import { COLUMN_DEFS } from '../columnDefs'

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

// The misreading happens when a member picks a THRESHOLD, not only when they
// read a cell — so the same `columnDefs.desc` has to reach the rail. `meta()`
// ships no description of its own; the join is filter.key → COLUMN_DEFS[key].
const DP = { key: 'dp_notional_1d', label: 'Dark Pool Block Notional (1d)',
  type: 'range', allow_custom: true, presets: [{ label: 'Any' }], unit: '$' }
const infoButtons = () => screen.queryAllByRole('button', { name: /^What .+ means$/ })

describe('FilterControl — column description surface', () => {
  it('the described filter opens the full column text from the keyboard', async () => {
    const user = userEvent.setup()
    render(<FilterControl filter={DP} value={null} onChange={() => {}} />)

    const btn = screen.getByRole('button', { name: 'What Dark Pool Block Notional (1d) means' })
    await user.tab()
    expect(document.activeElement).toBe(btn) // in tab order ahead of the select

    await user.keyboard('{Enter}')
    // The $4M block floor and the three-way-ambiguous blank, in full — the two
    // facts a member setting this threshold would otherwise get wrong.
    expect(screen.getByRole('note')).toHaveTextContent(COLUMN_DEFS.dp_notional_1d.desc)
    expect(btn).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('a filter whose column has no desc grows NO affordance — same probe, both populations', () => {
    // CONTROL: absence is only evidence if the query can see a present one.
    const { unmount } = render(<FilterControl filter={RS} value={null} onChange={() => {}} />)
    expect(COLUMN_DEFS.rs_rank.desc).toBeUndefined()
    expect(infoButtons()).toHaveLength(0)
    unmount()

    render(<FilterControl filter={DP} value={null} onChange={() => {}} />)
    expect(infoButtons().map(b => b.dataset.coldesc)).toEqual(['dp_notional_1d'])
  })
})
