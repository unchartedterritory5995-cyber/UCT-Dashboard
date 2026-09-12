/**
 * D-25 — Feedback is a ONE-TAP affordance again, and it does not collide with anything.
 *
 * ⛔ WHAT WAS WRONG. The gate moved Feedback behind the two-finger Peek, so reaching it was a
 * gesture plus two taps — and with the hub up, `Layout.jsx` stops mounting `<FeedbackWidget/>`,
 * which makes that the ONLY feedback path a mobile member has. The row's own note is that the old
 * FAB "was bottom-LEFT and never actually collided", i.e. the collision the move was made to avoid
 * was never measured. So this file measures it, in both handedness settings, instead of repeating
 * the claim.
 *
 * ⛔ ONE TAP MEANS THE SHEET IS NEVER OPENED. The load-bearing assertion is not "a Feedback
 * control exists" — it existed before, inside the sheet. It is that a single click on a control
 * present AT REST fires `onFeedback` while no dialog has been opened at all.
 *
 * ⚠️ WHAT THIS CANNOT PROVE: jsdom performs no layout. Every rectangle below is computed from the
 * DECLARED style, the same convention as `hubChipCollision.test.js`, with `env(safe-area-inset-*)`
 * read as 0 — the bare, non-notched floor, which is the conservative case for a collision check
 * (a real safe area only pushes the hub further from the bottom edge). A device run owns the rest.
 */
import { describe, it as vitestIt, expect, afterAll, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { AuthContext } from '../context/AuthContext'
import HubActionsButton from './HubActionsButton'
import { modes, INNER_MAX } from './registry'
import { sumPx, boxOf, overlaps, nameOf, INWARD_UNBOUNDED, UNKNOWN_HEIGHT } from './__tests__/restBoxes'

let definedCount = 0
let executedCount = 0
function it(name, fn) {
  definedCount += 1
  return vitestIt(name, (...args) => { executedCount += 1; return fn(...args) })
}
afterAll(() => {
  expect(executedCount).toBeGreaterThan(0)
  expect(executedCount).toBe(definedCount)
})

let mockPrefs = {}
vi.mock('../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPrefMerged: vi.fn(), loading: false }),
  parsePref: (raw) => {
    if (raw == null) return undefined
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return undefined }
  },
}))
const { default: HubRoot } = await import('./HubRoot.jsx')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const scan = modes.find((m) => m.id === 'scan')

// ── capability stubs (copied idiom from mirrorsAsAUnit.test.jsx) ─────────────
const realVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
function stubCapable() {
  globalThis.CSS = { supports: () => true }
  window.visualViewport = {
    width: 375, height: 812, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }
  window.matchMedia = vi.fn().mockImplementation((q) => ({
    matches: /max-width:\s*1023px/.test(q),
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }))
}
beforeEach(() => { mockPrefs = {}; stubCapable() })
afterEach(() => {
  vi.restoreAllMocks()
  delete globalThis.CSS
  if (realVisualViewport) Object.defineProperty(window, 'visualViewport', realVisualViewport)
  else delete window.visualViewport
})

function renderHub({ handedness = 'right', coachMarkSeen = true } = {}) {
  mockPrefs = { joystick_hub: JSON.stringify({ enabled: true, coachMarkSeen, handedness }) }
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <AuthContext.Provider value={{ user: { role: 'admin' }, plan: 'pro', trial: null, isPaid: true }}>
        <HubRoot />
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

// ── ONE TAP ─────────────────────────────────────────────────────────────────
describe('⛔ ONE tap, from rest', () => {
  it('the control is present before anything is opened, and one click fires onFeedback', () => {
    const onFeedback = vi.fn()
    render(<HubActionsButton mode="Scan" actions={scan.fan} onFeedback={onFeedback} />)

    const btn = screen.getByRole('button', { name: /send feedback/i })
    // ⭐ THE CONTROL THAT MAKES THIS MEAN "ONE TAP". Without it this assertion passes for a button
    // inside an already-open sheet, which is exactly the state the row is complaining about.
    expect(screen.queryByRole('dialog'), 'a sheet was open, so this was not a tap from rest')
      .not.toBeInTheDocument()

    fireEvent.click(btn)
    expect(onFeedback).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog'), 'the one-tap door opened a sheet instead of acting')
      .not.toBeInTheDocument()
  })

  it('is >=44px by its OWN declared style (WCAG 2.5.5)', () => {
    render(<HubActionsButton mode="Scan" actions={scan.fan} onFeedback={() => {}} />)
    const btn = screen.getByTestId('hub-feedback')
    expect(Number.parseFloat(btn.style.minWidth)).toBeGreaterThanOrEqual(44)
    expect(Number.parseFloat(btn.style.minHeight)).toBeGreaterThanOrEqual(44)
  })

  it('the SHEET entry survives — two doors, one destination', () => {
    // The sheet row is the labelled, screen-reader path (§C2: VoiceOver and TalkBack both eat the
    // two-finger Peek). Replacing it with the icon button would trade one excluded group for
    // another, which is not what "one tap" asked for.
    const onFeedback = vi.fn()
    render(<HubActionsButton mode="Scan" actions={scan.fan} onFeedback={onFeedback} />)
    fireEvent.click(screen.getByRole('button', { name: /actions/i }))
    fireEvent.click(screen.getByText('Feedback').closest('button'))
    expect(onFeedback).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when no destination is wired', () => {
    // A door to nowhere is worse than no door: it reads as a working feedback path.
    render(<HubActionsButton mode="Scan" actions={scan.fan} />)
    expect(screen.queryByTestId('hub-feedback')).not.toBeInTheDocument()
  })
})

// ── the ring was measured, not assumed ──────────────────────────────────────
describe('why it is a button and not an inner-ring action', () => {
  it('the inner ring is FULL in most modes — promoting Feedback would evict or overflow', () => {
    // The row offered the ring as the alternative. This is that alternative, measured against the
    // registry rather than guessed, and recorded so the option is not re-proposed from memory.
    const full = modes
      .filter((m) => (m.fan ?? []).filter((a) => a.ring === 1).length >= INNER_MAX)
      .map((m) => m.id)
    // Named members, not a count: a count goes stale the day a mode is added.
    for (const id of ['scan', 'chart', 'journal', 'home']) expect(full).toContain(id)
  })
})

// ── geometry: the collision claim, measured ─────────────────────────────────
// ⛔ THE ARITHMETIC MOVED OUT, AND THAT IS THE POINT. `sumPx`/`boxOf`/`overlaps` used to be
// private to this file, pointed at ONE element. They were already capable of catching the hub
// chip sitting under the Actions button and never did, because nothing asked them that pair —
// which is how G3-15 ended up being found on real glass instead. They now live in
// `__tests__/restBoxes.js` so `hubChipActionsClearance.test.jsx` measures the SAME boxes with the
// SAME rules rather than a second copy that agrees until it doesn't.
const name = nameOf

describe('⛔ it does not collide — with the hub, in either hand', () => {
  for (const handedness of ['right', 'left']) {
    it(`${handedness}-handed: the feedback box is clear of every other resting hub element`, () => {
      const { container } = renderHub({ handedness })
      const fb = container.querySelector('[data-testid="hub-feedback"]')
      expect(fb, 'the one-tap feedback control did not render inside a real hub').toBeTruthy()
      const mine = boxOf(fb)

      // Every hub piece declares its anchor INLINE (an edge + a bottom); `position: fixed` comes
      // from the stylesheet, so filtering on it here would silently drop the pad and the chip and
      // leave this assertion measuring three elements out of six.
      const others = [...container.querySelectorAll('[style*="bottom"]')]
        .filter((el) => el !== fb && !el.contains(fb))
        .filter((el) => (el.style.right && el.style.right !== 'auto')
          || (el.style.left && el.style.left !== 'auto'))
      // CONTROL: an empty list would make "collides with nothing" true and meaningless.
      expect(others.map(name)).toContain('hub-pad')
      expect(others.map(name)).toContain('hub-chip')

      const hits = others.filter((el) => overlaps(mine, boxOf(el))).map(name)
      expect(hits, `the feedback button overlaps ${hits.join(', ')} at rest. Auto-width elements `
        + 'are treated as extending inward without limit, so the guarantee for those is VERTICAL '
        + 'separation — move the button, not the assumption.').toEqual([])
    })
  }

  it('it clears the coach mark, which is the one element that appears on first run only', () => {
    const { container } = renderHub({ coachMarkSeen: false })
    const fb = boxOf(container.querySelector('[data-testid="hub-feedback"]'))
    // The coach mark's geometry lives in the stylesheet, not inline, so it is read from there.
    const css = readFileSync(path.join(HERE, 'hub.module.css'), 'utf8')
    const block = css.slice(css.indexOf('.coachMark {'))
    const coachBottom = sumPx(/bottom:\s*([^;]+);/.exec(block)?.[1])
    expect(coachBottom, 'could not read .coachMark bottom — the rail is measuring nothing')
      .toBeGreaterThan(0)
    const coach = { x0: 0, x1: INWARD_UNBOUNDED, y0: coachBottom, y1: coachBottom + UNKNOWN_HEIGHT }
    expect(overlaps(fb, coach), 'the feedback button sits under the first-run coach mark').toBe(false)
  })

  it('it anchors to the SAME edge as the hub, in both hands (§C2:769)', () => {
    // ⛔ NOT the far corner. The old FAB was bottom-left; putting it back there breaks the
    // "hub moves as a unit" rule AND strands the affordance under a left-handed member's
    // other hand — one-tap is only one tap if the thumb can reach it.
    const right = renderHub({ handedness: 'right' }).container
      .querySelector('[data-testid="hub-feedback"]')
    expect(right.style.right, 'right-handed: feedback is not on the right edge').toBeTruthy()
    expect(right.style.left).toBeFalsy()

    const left = renderHub({ handedness: 'left' }).container
      .querySelector('[data-testid="hub-feedback"]')
    expect(left.style.left, 'left-handed: feedback did not mirror with the hub').toBeTruthy()
    expect(left.style.right).toBeFalsy()
  })
})
