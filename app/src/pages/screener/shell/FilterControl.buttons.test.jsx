import { render, screen, fireEvent } from '@testing-library/react'
import { vi, test, expect } from 'vitest'
import FilterControl from './FilterControl'

const f = { key: 'rs_rank', label: 'RS Rank', type: 'range', allow_custom: true,
  presets: [{ label: 'Any' }, { label: '≥ 80', op: 'gte', min: 80 }, { label: '≥ 90', op: 'gte', min: 90 }] }

test('buttons presentation sets a preset', () => {
  const onChange = vi.fn()
  render(<FilterControl filter={f} value={null} onChange={onChange} presentation="buttons" />)
  fireEvent.click(screen.getByRole('button', { name: '≥ 90' }))
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ op: 'gte', min: 90 }))
})
test('the active preset is pressed; Any clears', () => {
  const onChange = vi.fn()
  render(<FilterControl filter={f} value={{ op: 'gte', min: 80 }} onChange={onChange} presentation="buttons" />)
  expect(screen.getByRole('button', { name: '≥ 80' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: '≥ 90' })).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(screen.getByRole('button', { name: 'Any' }))
  expect(onChange).toHaveBeenCalledWith(null)
})
test('Any is pressed when nothing is set', () => {
  render(<FilterControl filter={f} value={null} onChange={vi.fn()} presentation="buttons" />)
  expect(screen.getByRole('button', { name: 'Any' })).toHaveAttribute('aria-pressed', 'true')
})
test('Custom opens the min and max inputs', () => {
  render(<FilterControl filter={f} value={null} onChange={vi.fn()} presentation="buttons" />)
  fireEvent.click(screen.getByRole('button', { name: 'Custom…' }))
  expect(screen.getByLabelText('RS Rank min')).toBeInTheDocument()
})
test('default presentation is still a select', () => {
  render(<FilterControl filter={f} value={null} onChange={vi.fn()} />)
  expect(screen.getByRole('combobox')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '≥ 90' })).toBeNull()
})
test('a value matching no preset shows Custom pressed with the min/max inputs', () => {
  render(<FilterControl filter={f} value={{ op: 'between', min: 70, max: 95 }} onChange={vi.fn()} presentation="buttons" />)
  expect(screen.getByRole('button', { name: 'Custom…' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'Any' })).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByLabelText('RS Rank min')).toHaveValue(70)
})
