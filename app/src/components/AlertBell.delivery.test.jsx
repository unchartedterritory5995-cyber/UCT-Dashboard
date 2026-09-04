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
 * ⭐ REACHABILITY IS ALSO ASSERTED. If the bell stopped being mounted, this
 * surface would be a thirteenth instance no matter how green its own tests were.
 * That is checked against the nav sources rather than described here.
 *
 * ⚰️ THIS PARAGRAPH SAID "rendered by NavBar (desktop) and MobileNav (touch)"
 * and half of it stopped being true on 2026-09-02 (`feat(nav): sidebar revamp`),
 * which took the whole suite red. The desktop bell was removed BY OWNER REQUEST
 * and NavBar carries its own note saying so — so the rail below now asserts what
 * is true, and pins the absence as a DECISION rather than letting it read as a
 * hole nobody noticed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { AuthContext } from '../context/AuthContext'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

import AlertBell, { failedChannelsOf } from './AlertBell'

/** JSX-aware parser — the same pair `Screener.door.test.jsx` uses. */
const JSXParser = Parser.extend(jsx())

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

  it('is REACHABLE — the bell is mounted by the nav that still ships it', () => {
    // The thirteenth-instance guard. Derived from the nav sources, so deleting
    // the mount fails here even though every test above would stay green.
    const here = dirname(fileURLToPath(import.meta.url))
    const mobile = readFileSync(join(here, 'MobileNav.jsx'), 'utf8')
    expect(mobile).toMatch(/import\s+AlertBell\s+from/)
    expect(mobile).toMatch(/<AlertBell\s*\/>/)
  })

  it('⛔ the DESKTOP absence is a decision on the record, not a hole', () => {
    // ⚰️ `feat(nav): sidebar revamp` removed the bell from the desktop sidebar
    // "(owner request)" and left instructions for putting it back. It also left
    // this file red, because the old rail required BOTH navs to mount it.
    //
    // ⭐ THE HONEST RAIL IS NOT "DELETE THE ASSERTION". A member on a desktop
    // viewport now has no notification bell at all — MobileNav is the ≤1024px
    // surface — and that is a real consequence somebody chose. So this asserts
    // the two halves together: the mount is gone AND the reason is still written
    // where the next reader of NavBar will find it. Restoring the bell without
    // clearing the note, or clearing the note while the bell stays gone, both
    // go red here.
    //
    // ⚰️ AND THE ABSENCE IS READ WITH AN AST, NOT A REGEX. The first version of
    // this case used `not.toMatch(/<AlertBell\s*\/>/)` and FAILED — because the
    // restore note itself contains the literal text `<AlertBell />`. A grep
    // cannot tell a mount from a mention of one, which is the whole reason this
    // repo keeps reaching for the parser.
    const here = dirname(fileURLToPath(import.meta.url))
    const desktop = readFileSync(join(here, 'NavBar.jsx'), 'utf8')
    const mounts = (src) => {
      const found = []
      const walk = (node) => {
        if (!node || typeof node !== 'object') return
        if (node.type === 'JSXOpeningElement' && node.name && node.name.name === 'AlertBell') {
          found.push(node.name.name)
        }
        for (const k of Object.keys(node)) {
          const v = node[k]
          if (Array.isArray(v)) v.forEach(walk)
          else if (v && typeof v === 'object' && v.type) walk(v)
        }
      }
      walk(JSXParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module' }))
      return found
    }
    // ⛔ NON-VACUITY: the same walker MUST find the mount that does exist, or
    // "none in NavBar" is a statement about a broken parser.
    expect(mounts(readFileSync(join(here, 'MobileNav.jsx'), 'utf8'))).toHaveLength(1)
    expect(mounts(desktop)).toHaveLength(0)
    // The reason is still where the next reader of NavBar will meet it.
    expect(desktop).toMatch(/AlertBell/)
    expect(desktop).toMatch(/temporarily removed/i)
  })
})
