import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import SegmentedNav from './SegmentedNav'

const items = [
  { key: 'overview', label: 'Overview' },
  { key: 'heatmap', label: 'Heatmap' },
  { key: 'monitor', label: 'Monitor' },
]

test('renders all segments and marks the active one', () => {
  render(<SegmentedNav items={items} value="heatmap" onChange={() => {}} />)
  expect(screen.getByText('Overview')).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Heatmap' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'false')
})

test('clicking a segment fires onChange with its key', () => {
  const onChange = vi.fn()
  render(<SegmentedNav items={items} value="overview" onChange={onChange} />)
  fireEvent.click(screen.getByText('Monitor'))
  expect(onChange).toHaveBeenCalledWith('monitor')
})
