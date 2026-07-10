import { renderWithProviders, screen } from '../../test-utils'
import { vi } from 'vitest'
import AckGate from './AckGate'

test('renders disclaimer and agree button when not acked', () => {
  renderWithProviders(
    <AckGate status={{ enabled: true, acked: false }} onAcked={vi.fn()} />,
  )
  expect(screen.getByText(/not financial advice/i)).toBeTruthy()
  expect(screen.getByText(/I understand/i)).toBeTruthy()
})

test('renders nothing when acked', () => {
  const { container } = renderWithProviders(
    <AckGate status={{ enabled: true, acked: true }} onAcked={vi.fn()} />,
  )
  expect(container.firstChild).toBeNull()
})
