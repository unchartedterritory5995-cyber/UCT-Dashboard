/**
 * AlertBell — the chime must belong to the signed-in member.
 *
 * The bell drives a SOUND and an OS notification off /api/alerts. That is the
 * user-visible face of the 2026-08-06 alert-feed leak: while the endpoint was
 * one unauthenticated global list, another member's alert could ding this
 * device. The server-side fix is in api/services/alerts.py; these tests cover
 * the client half — no poll while signed out, and a change of identity resets
 * the "already seen" bookkeeping so the next member's first poll is silent.
 *
 * ⚠️ Each refusal claim here is preceded by the positive control that proves
 * the mechanism it refuses actually works — a test that asserts "no sound"
 * against a component that can never make a sound proves nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { mutate as swrMutate } from 'swr'
import { AuthContext } from '../context/AuthContext'
import AlertBell from './AlertBell'

const playAlertSound = vi.fn()
const showBrowserNotification = vi.fn()

vi.mock('../utils/alertSound', () => ({
  playAlertSound: (...a) => playAlertSound(...a),
  showBrowserNotification: (...a) => showBrowserNotification(...a),
  requestNotificationPermission: () => {},
}))

vi.mock('../hooks/usePreferences', () => ({
  default: () => ({ prefs: { alert_sound: 'on', alert_sound_type: 'chime' }, savePref: () => {} }),
}))

function alert(id, title) {
  return {
    id,
    type: 'price_alert',
    severity: 'warning',
    title,
    message: `${title} body`,
    timestamp: new Date().toISOString(),
    read: false,
    data: {},
  }
}

/** Render the bell as `userId` (null = signed out). */
function renderAs(userId) {
  const value = { user: userId ? { id: userId, email: `${userId}@t.test` } : null, loading: false }
  return render(
    <AuthContext.Provider value={value}>
      <AlertBell />
    </AuthContext.Provider>,
  )
}

let feed = []

beforeEach(() => {
  playAlertSound.mockClear()
  showBrowserNotification.mockClear()
  feed = []
  global.fetch = vi.fn((url) => {
    if (String(url).startsWith('/api/alerts')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(feed) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AlertBell identity scoping', () => {
  it('does not request the alert feed at all while signed out', async () => {
    feed = [alert('a_1', 'Alert: PRIV')]
    renderAs(null)

    // Give SWR a tick to do the fetch it must not do.
    await act(() => new Promise(r => setTimeout(r, 20)))

    const alertCalls = global.fetch.mock.calls
      .filter(([u]) => String(u).startsWith('/api/alerts'))
    expect(alertCalls).toHaveLength(0)
    expect(screen.queryByText('Alert: PRIV')).toBeNull()
  })

  it('serves the signed-in member their feed (the positive control)', async () => {
    feed = [alert('a_1', 'Alert: PRIV')]
    renderAs('u_a')

    await waitFor(() => {
      expect(
        global.fetch.mock.calls.filter(([u]) => String(u).startsWith('/api/alerts')).length,
      ).toBeGreaterThan(0)
    })
    await waitFor(() => expect(screen.getByLabelText('Notifications')).toBeInTheDocument())
    // The unread badge is the rendered proof the payload reached the component.
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument())
  })

  it('stays silent on the first poll, then chimes for a genuinely new alert', async () => {
    feed = [alert('a_1', 'Alert: ONE')]
    renderAs('u_a')
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument())
    expect(playAlertSound).not.toHaveBeenCalled()   // first load is silent

    // A later poll of the SAME member's feed brings a new id.
    feed = [alert('a_2', 'Alert: TWO'), alert('a_1', 'Alert: ONE')]
    await act(async () => {
      await swrMutate(['/api/alerts?limit=20', 'u_a'])
      await new Promise(r => setTimeout(r, 20))
    })

    // The mechanism works — this is what the identity test below refuses.
    await waitFor(() => expect(playAlertSound).toHaveBeenCalled())
    expect(showBrowserNotification).toHaveBeenCalled()
  })

  it('does not chime when a DIFFERENT member signs in on the same tab', async () => {
    feed = [alert('a_1', 'Alert: u_a ONE')]
    const { rerender } = renderAs('u_a')
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument())
    playAlertSound.mockClear()
    showBrowserNotification.mockClear()

    // u_b signs in; the server hands back u_b's OWN feed — entirely different
    // ids, which under the old id-set bookkeeping read as "all brand new".
    feed = [alert('b_1', 'Alert: u_b ONE'), alert('b_2', 'Alert: u_b TWO')]
    await act(async () => {
      rerender(
        <AuthContext.Provider value={{ user: { id: 'u_b' }, loading: false }}>
          <AlertBell />
        </AuthContext.Provider>,
      )
      await new Promise(r => setTimeout(r, 50))
    })

    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument())
    expect(playAlertSound).not.toHaveBeenCalled()
    expect(showBrowserNotification).not.toHaveBeenCalled()
  })
})
