import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// BRK-04 — the Settings row. Dark unless /api/push/config answers configured,
// and browser permission is asked ONLY on the toggle click.
const m = vi.hoisted(() => ({
  config: null,
  support: { ok: true, reason: null },
  sub: null,
  enablePush: vi.fn(),
  disablePush: vi.fn(),
}))
vi.mock('../../utils/webPush', () => ({
  fetchPushConfig: vi.fn(async () => m.config),
  pushSupport: () => m.support,
  currentSubscription: vi.fn(async () => m.sub),
  enablePush: (...a) => m.enablePush(...a),
  disablePush: (...a) => m.disablePush(...a),
}))

import PushNotificationsRow from './PushNotificationsRow'

beforeEach(() => {
  m.config = null
  m.support = { ok: true, reason: null }
  m.sub = null
  m.enablePush.mockReset().mockResolvedValue({ ok: true })
  m.disablePush.mockReset().mockResolvedValue({ ok: true })
})

describe('PushNotificationsRow', () => {
  it('renders nothing while the channel is dark / unconfigured / unpaid', async () => {
    const { container } = render(<PushNotificationsRow />)
    await new Promise(r => setTimeout(r, 0))
    expect(container.innerHTML).toBe('')
  })

  it('shows the toggle and the plain iOS sentence when configured', async () => {
    m.config = { configured: true, public_key: 'BKEY' }
    render(<PushNotificationsRow />)
    const sw = await screen.findByRole('switch', { name: 'Push notifications to this device' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByTestId('push-notifications-row').textContent)
      .toMatch(/add UCT to your Home Screen.*iOS 16\.4 or later/)
  })

  it('asks permission only on click — never on mount', async () => {
    m.config = { configured: true, public_key: 'BKEY' }
    render(<PushNotificationsRow />)
    const sw = await screen.findByRole('switch')
    expect(m.enablePush).not.toHaveBeenCalled()
    fireEvent.click(sw)
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'))
    expect(m.enablePush).toHaveBeenCalledWith('BKEY')
  })

  it('reflects an existing subscription and turns it off', async () => {
    m.config = { configured: true, public_key: 'BKEY' }
    m.sub = { endpoint: 'https://fcm.googleapis.com/x' }
    render(<PushNotificationsRow />)
    const sw = await screen.findByRole('switch')
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'))
    fireEvent.click(sw)
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'))
    expect(m.disablePush).toHaveBeenCalled()
  })

  it('an insecure context disables the toggle and says why', async () => {
    m.config = { configured: true, public_key: 'BKEY' }
    m.support = { ok: false, reason: 'insecure' }
    render(<PushNotificationsRow />)
    expect(await screen.findByRole('switch')).toBeDisabled()
    expect(screen.getByTestId('push-unsupported').textContent).toMatch(/secure \(https\)/)
  })

  it('a denied permission is explained, toggle stays off', async () => {
    m.config = { configured: true, public_key: 'BKEY' }
    m.enablePush.mockResolvedValue({ ok: false, reason: 'denied' })
    render(<PushNotificationsRow />)
    const sw = await screen.findByRole('switch')
    fireEvent.click(sw)
    expect(await screen.findByRole('status')).toHaveTextContent(/blocked/)
    expect(sw).toHaveAttribute('aria-checked', 'false')
  })
})
