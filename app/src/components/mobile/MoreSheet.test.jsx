import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import MoreSheet from './MoreSheet'

function renderSheet(props = {}) {
  return render(
    <MemoryRouter>
      <MoreSheet open onClose={vi.fn()} {...props} />
    </MemoryRouter>,
  )
}

test('renders secondary destinations', () => {
  renderSheet()
  ;['UCT 20', 'Model Book', 'Setup Library', 'Morning Wire', 'Settings'].forEach((label) =>
    expect(screen.getByText(label)).toBeInTheDocument(),
  )
})

test('clicking a link calls onClose', () => {
  const onClose = vi.fn()
  renderSheet({ onClose })
  fireEvent.click(screen.getByText('Settings'))
  expect(onClose).toHaveBeenCalled()
})

test('renders nothing when closed', () => {
  render(<MemoryRouter><MoreSheet open={false} onClose={vi.fn()} /></MemoryRouter>)
  expect(screen.queryByText('Settings')).toBeNull()
})
