import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import ContextPopover from './ContextPopover'

// Desktop (matchMedia matches:false) → anchored menu path.

test('renders items and title (desktop anchored menu)', () => {
  render(
    <ContextPopover open onClose={() => {}} anchor={{ x: 10, y: 10 }} title="AAPL"
      items={[{ label: 'Flag' }, { label: 'Remove', danger: true }]} />,
  )
  expect(screen.getByText('AAPL')).toBeInTheDocument()
  expect(screen.getByText('Flag')).toBeInTheDocument()
  expect(screen.getByText('Remove')).toBeInTheDocument()
})

test('clicking an item fires its onClick and then onClose', () => {
  const onClose = vi.fn()
  const onClick = vi.fn()
  render(
    <ContextPopover open onClose={onClose} anchor={{ x: 0, y: 0 }}
      items={[{ label: 'Flag', onClick }]} />,
  )
  fireEvent.click(screen.getByText('Flag'))
  expect(onClick).toHaveBeenCalledTimes(1)
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('keepOpen item does not auto-close', () => {
  const onClose = vi.fn()
  render(
    <ContextPopover open onClose={onClose} anchor={{ x: 0, y: 0 }}
      items={[{ label: 'Tag', onClick: () => {}, keepOpen: true }]} />,
  )
  fireEvent.click(screen.getByText('Tag'))
  expect(onClose).not.toHaveBeenCalled()
})

test('renders nothing when closed', () => {
  render(<ContextPopover open={false} onClose={() => {}} items={[{ label: 'Flag' }]} />)
  expect(screen.queryByText('Flag')).toBeNull()
})
