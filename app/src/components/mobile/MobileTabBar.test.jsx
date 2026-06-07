import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import MobileTabBar from './MobileTabBar'

function renderAt(path, onMore = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MobileTabBar onMore={onMore} />
    </MemoryRouter>,
  )
}

test('renders all five tabs', () => {
  renderAt('/dashboard')
  ;['Home', 'Markets', 'Charts', 'Journal', 'More'].forEach((label) =>
    expect(screen.getByText(label)).toBeInTheDocument(),
  )
})

test('Home tab is active on /dashboard', () => {
  renderAt('/dashboard')
  expect(screen.getByText('Home').closest('a')).toHaveAttribute('aria-current', 'page')
})

test('Markets tab is active on a Markets sub-route (/options-flow)', () => {
  renderAt('/options-flow')
  expect(screen.getByText('Markets').closest('a')).toHaveAttribute('aria-current', 'page')
})

test('More button fires onMore', () => {
  const onMore = vi.fn()
  renderAt('/dashboard', onMore)
  fireEvent.click(screen.getByText('More'))
  expect(onMore).toHaveBeenCalledTimes(1)
})
