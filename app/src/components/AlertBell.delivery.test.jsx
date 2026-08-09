/**
 * 🔴 THE ALERT THAT REACHED NOBODY, ON THE SURFACE THE MEMBER READS.
 *
 * `alert_fired_log.delivery_failures()` and `delivery_health()` were written,
 * were correct, and were reachable from NOTHING — no route, then no consumer.
 * Twelve instances of "built, tested, green, and unreachable" are on record in
 * this repo; this file is the rail that makes this one different.
 *
 * ⛔ IT IS A WIRE TEST, NOT A COMPONENT TEST. Every assertion is about a value
 * that must travel SERVER → fetch → render: the URL that leaves, and the
 * symbol + channel names the payload carries. A correct endpoint and a correct
 * component with nothing joining them fails this — which is precisely what a
 * component test with a hand-built prop cannot detect.
 *
 * ⭐ REACHABILITY IS ALSO ASSERTED. AlertBell is rendered by NavBar (desktop)
 * and MobileNav (touch); if it stopped being mounted, this surface would be a
 * thirteenth instance no matter how green its own tests were. That is checked
 * against those files' source rather than described here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { AuthContext } from '../context/AuthContext'
import AlertBell, { failedChannelsOf } from './AlertBell'

vi.mock('../utils/alertSound', () => ({
  playAlertSound: () => {},
  showBrowserNotification: () => {},
  requestNotificationPermission: () => {},
}))

vi.mock('../hooks/usePreferences', () => ({
  default: () => ({ prefs: { alert_sound: 'off' }, savePref: () => {} }),
}))

const DELIVERY_URL = '/api/indicator-alerts/delivery-health'

/** One fire the server says was delivered in-app and NOT by email. */
function partialFire(id, sym) {
  return {
    id,
    alert_id: id,
    sym,
    fired_at: Math.floor(Date.now() / 1000) - 120,
    delivered_at: Math.floor(Date.now() / 1000) - 119,
    delivery_failed_at: null,
    channels_failed: 1,
    delivery_channels: { in_app: 'ok', email: 'failed', discord: 'skipped' },
  }
}

let feed = []
let delivery = { health: { trouble: 0, partial: 0 }, failures: [] }

beforeEach(() => {
  feed = []
  delivery = { health: { trouble: 0, partial: 0 }, failures: [] }
  global.fetch = vi.fn((url) => {
    const u = String(url)
    if (u.startsWith(DELIVERY_URL)) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(delivery) })
    }
    if (u.startsWith('/api/alerts')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(feed) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function renderAs(userId) {
  const value = { user: userId ? { id: userId, email: `${userId}@t.test` } : null, loading: false }
  return render(
    <AuthContext.Provider value={value}>
      <AlertBell />
    </AuthContext.Provider>,
  )
}

async function openBell() {
  const bell = await screen.findByLabelText('Notifications')
  await act(async () => {
    bell.click()
    await new Promise(r => setTimeout(r, 10))
  })
}

describe('AlertBell — undelivered alerts have a surface', () => {
  it('asks the server for its delivery health', async () => {
    renderAs('u_a')
    await waitFor(() => {
      expect(
        global.fetch.mock.calls.filter(([u]) => String(u).startsWith(DELIVERY_URL)).length,
      ).toBeGreaterThan(0)
    })
  })

  it('does NOT ask while signed out', async () => {
    renderAs(null)
    await act(() => new Promise(r => setTimeout(r, 20)))
    expect(
      global.fetch.mock.calls.filter(([u]) => String(u).startsWith(DELIVERY_URL)),
    ).toHaveLength(0)
  })

  it('renders the SYMBOL and the FAILED CHANNEL the server reported', async () => {
    // ⛔ The expected strings are read off the payload, never retyped — a test
    // that restates what the server owns goes green against a component that
    // renders a hard-coded row.
    const fire = partialFire(41, 'NVDA')
    delivery = { health: { trouble: 1, partial: 1 }, failures: [fire] }
    renderAs('u_a')
    await openBell()

    expect(await screen.findByText(fire.sym)).toBeInTheDocument()
    const failed = failedChannelsOf(fire)
    expect(failed).toEqual(['email'])
    expect(
      screen.getByText((t) => failed.every(c => t.includes(c))),
    ).toBeInTheDocument()
  })

  it('says nothing at all when every delivery landed (the control)', async () => {
    // Without this, "it renders the failure" could be satisfied by a component
    // that renders the warning unconditionally.
    delivery = { health: { trouble: 0, partial: 0 }, failures: [] }
    renderAs('u_a')
    await openBell()

    expect(screen.queryByText(/not delivered everywhere/i)).toBeNull()
    expect(screen.queryByText('NVDA')).toBeNull()
  })

  it('does not paint a SKIPPED channel as a failure', async () => {
    // 'skipped' is "we did not try" — an unset Discord webhook, a member with
    // no address. Painting it red sends somebody hunting an outage that does
    // not exist.
    const fire = partialFire(42, 'AMD')
    fire.delivery_channels = { in_app: 'ok', email: 'skipped', discord: 'skipped' }
    fire.channels_failed = 0
    expect(failedChannelsOf(fire)).toEqual([])

    delivery = { health: { trouble: 0, partial: 0 }, failures: [] }
    renderAs('u_a')
    await openBell()
    expect(screen.queryByText('AMD')).toBeNull()
  })

  it('is REACHABLE — the bell it lives in is mounted by the real nav', () => {
    // The thirteenth-instance guard. Derived from the nav sources, so deleting
    // the mount fails here even though every test above would stay green.
    const here = dirname(fileURLToPath(import.meta.url))
    for (const file of ['NavBar.jsx', 'MobileNav.jsx']) {
      const src = readFileSync(join(here, file), 'utf8')
      expect(src).toMatch(/import\s+AlertBell\s+from/)
      expect(src).toMatch(/<AlertBell\s*\/>/)
    }
  })
})
