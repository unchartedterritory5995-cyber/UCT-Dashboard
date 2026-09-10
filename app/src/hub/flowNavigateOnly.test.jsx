// Joystick hub — Phase 3 §3.9: Flow (`/options-flow`) is VERIFY ONLY, and stays navigate-only.
//
// The plan's whole §3.9 (docs/plans/joystick/60-phase3-plan.md:333-337):
//   "Navigate-only, and stays so: `OptionsFlow.jsx` is partner-owned (~7k lines, all inline
//    styles) and this build touches none of it. Fan stays `[Voice, Home]`. The only Phase 3 work
//    is a device step confirming the hub mounts and navigates there — **no registration hook is
//    added.**"
//
// ─────────────────────────────────────────────────────────────────────────────
// ⛔ WHY THIS IS A RAIL AND NOT A LINE IN A PLAN
// ─────────────────────────────────────────────────────────────────────────────
// "We decided not to wire this section" is the single easiest decision in the programme to undo
// by accident: every other section in Phase 3 got a `sections/*.js` controller and a page-side
// `useHubMode` call, so wiring Flow is the OBVIOUS next move for anyone working down the list.
// What makes it not obvious is the consequence — `OptionsFlow.jsx` is partner-owned and sits on
// flow-worker's watched paths, so a commit there can bounce the OPRA options tape, and Massive
// OPRA does not replay: that gap is permanent until the T+1 flat file (CLAUDE.md, "Live Options
// Flow — Deploy Survival"). A decision whose cost is a permanently gapped tape deserves an
// assertion, not a sentence.
//
// ⛔ WHAT THIS ASSERTS THAT `hubWiring.test.jsx` DOES NOT. That file's "every non-Home mode STILL
// in the preview is exactly [Voice, Home]" walks `flow` on every run — but it reads `fanFor()`,
// the PREVIEW PROJECTION, which flattens every mode to [Voice, Home] regardless of what it
// declares. It would stay green if `flow.fan` grew five actions tomorrow, and go red only on the
// day `flow` left `PREVIEW_MODES` — long after the wiring landed. This file reads
// `modesById.flow.fan`, the DECLARED fan: "Flow has nothing to hide", not "Flow is hidden".
//
// ⭐ MEASURED, not argued (2026-09-10). Adding a `kind:'navigate'` action to `flow.fan` and
// re-running this file leaves the RENDERED-bubble test below GREEN — `fanFor` strips it, because
// the preview projection keeps only Voice and Home. Only the declared-fan assertion goes red.
// So the render test is the proof that the DOOR works; this one is the proof that the wiring has
// not been done. Neither substitutes for the other.
//
// ─────────────────────────────────────────────────────────────────────────────
// 📱 THE ONE EMULATED STEP A HUMAN SHOULD RUN (§3.9's entire device deliverable)
// ─────────────────────────────────────────────────────────────────────────────
// ⛔ EMULATED, NOT DEVICE EVIDENCE — same standing caveat as `device-steps/b9-emulated.py`:
// touch emulation satisfies `useHubActive`'s `(max-width:1023px) and (pointer:coarse)` gate
// genuinely (met, never patched), but no emulator resolves `env(safe-area-inset-*)`.
//
//   STEP F1 — "the hub mounts on Flow, offers only the two doors, and one of them works"
//   Harness: the `b9-emulated.py` recipe (Playwright, `has_touch=True, is_mobile=True`,
//            viewport 393x852), against the hub sandbox at 127.0.0.1:8077.
//   ⛔ Port 8077 is the hub sandbox's and nothing else's; verify the identity nonce before
//      driving it (CLAUDE.md, "A PORT ASSIGNMENT IS NOT A SERVER IDENTITY").
//   1. Log in through `page.request.post('/api/auth/login')`, then
//      `page.goto('/options-flow')`.
//   2. Wait for `[data-testid="hub-root"]`. RECORD: present / absent.
//        -> This is the "the hub mounts there" half. `/options-flow` is a route with no
//           `useHubMode` caller, so what mounts is the registry's route-derived default; if the
//           hub is missing here, the DEFAULT path is broken, not Flow.
//   3. Read the chip: it must say "Flow", and its hint must read "Preview — more coming"
//      (`flow` is in PREVIEW_MODES, so `HubRoot` substitutes the preview hint for the mode's own
//      `tapHint: 'navigate only'`). RECORD the string verbatim.
//   4. Enumerate `[data-action-id]` inside `[data-testid="hub-root"]`. RECORD THE ID LIST.
//      Expected EXACTLY: `flow.voice`, `flow.home`. ⭐ Record the list, never a count — a count
//      of 2 is also what "two wrong bubbles" looks like.
//   5. Long-press the pad (past HOLD_MS) and release WITHOUT dragging. RECORD the resulting
//      `location.pathname`. Expected `/dashboard`.
//        -> The hold-Home path, which is the only gesture on this route that is supposed to do
//           anything at all.
//   6. Tap the pad once, wait past `doubleTapMs`, and RECORD `location.pathname` again.
//      Expected UNCHANGED — `/options-flow`. This is the CONTROL, and it is the actual §3.9
//      claim: a tap on a navigate-only section must do NOTHING, because the mode declares no
//      `onTap`. A step that only checks Home would pass identically on a fully-wired Flow.
//   Result file: claim it (truncated + timestamped, naming the device and
//   "(session did not complete)") BEFORE the session opens, per CLAUDE.md.
//
// ⛔ RAIL (house convention): `vitest -t` is a regex and a filter matching nothing exits 0.
import { describe, it as vitestIt, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { forwardRef } from 'react'
import fs from 'node:fs'
import path from 'node:path'

let definedCount = 0
let executedCount = 0
function it(name, fn) {
  definedCount += 1
  return vitestIt(name, (...args) => {
    executedCount += 1
    return fn(...args)
  })
}
afterAll(() => {
  expect(executedCount).toBeGreaterThan(0)
  expect(executedCount).toBe(definedCount)
})

// ── Leaf mocks (HubFan stays REAL — the bubbles are the artifact) ───────────
let mockPrefs = {}
vi.mock('../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPrefMerged: vi.fn(), loading: false }),
  parsePref: (raw) => {
    if (raw == null) return undefined
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return undefined }
  },
}))
vi.mock('./HubPad', () => ({
  default: forwardRef(function MockHubPad(
    { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }, ref,
  ) {
    return (
      <div
        data-testid="mock-hub-pad"
        ref={ref}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />
    )
  }),
}))
vi.mock('./HubKnob', () => ({ default: () => null }))
vi.mock('./HubChip', () => ({ default: () => null }))
vi.mock('./HubScrim', () => ({ default: () => null }))
vi.mock('./HubActionsButton', () => ({ default: () => null }))

function stubHubCapable() {
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
function unstubHubCapable() {
  delete globalThis.CSS
  delete window.visualViewport
  vi.unstubAllGlobals()
}

function LocationProbe() {
  const { pathname } = useLocation()
  return <div data-testid="loc">{pathname}</div>
}

async function renderHub(route) {
  const { default: HubRoot } = await import('./HubRoot')
  const { HubProvider } = await import('./HubContext')
  return render(
    <MemoryRouter initialEntries={[route]}>
      <HubProvider>
        <HubRoot />
        <LocationProbe />
      </HubProvider>
    </MemoryRouter>,
  )
}

function vecAtAngle(dist, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180
  return { dx: Math.cos(rad) * dist, dy: -Math.sin(rad) * dist }
}

/** ⚠️ CRLF normalised at the door — `core.autocrlf` is on in this checkout. */
const read = (rel) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')

/**
 * Every line by which a page could hand itself to the hub as a section controller.
 *
 * ⛔ NOT a bare substring search for "hub". `OptionsFlow.jsx` is 9.6k lines of a trading UI and
 * the word appears in ordinary prose; what makes a page a hub CONSUMER is an import edge or a
 * registration call, so those are what this looks for. Its own can-it-fail control lives beside
 * the assertion — this function is the half that has to be provable, because the file it reads
 * is one this stream may not mutate even transiently.
 */
function hubWiringIn(src) {
  const hits = []
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue
    if (/\bfrom\s+['"][^'"]*\/hub\/[^'"]*['"]/.test(line)
      || /\brequire\(\s*['"][^'"]*\/hub\/[^'"]*['"]\s*\)/.test(line)
      || /\buseHubMode\s*\(/.test(line)
      || /\buseHubCursor\s*\(/.test(line)
      || /\bregisterHubMode\s*\(/.test(line)) {
      hits.push(`${i + 1}: ${line.trim()}`)
    }
  }
  return hits
}

// ═════════════════════════════════════════════════════════════════════════════
// 1 — the DECLARED fan, not the projection
// ═════════════════════════════════════════════════════════════════════════════
describe('§3.9 — the flow mode is navigate-only by declaration', () => {
  it('flow.fan is exactly [flow.voice, flow.home] and nothing else', async () => {
    const { modesById } = await import('./registry')
    const ids = modesById.flow.fan.map((a) => a.id)

    // Named members and exact order — a length check passes over the wrong two.
    expect(ids).toEqual(['flow.voice', 'flow.home'])
    expect(modesById.flow.route).toBe('/options-flow')
    expect(modesById.flow.tapHint).toBe('navigate only')

    // Control: this same read on a WIRED section must look different, or the assertion above is
    // measuring the registry's shape rather than Flow's emptiness.
    expect(modesById.wire.fan.length,
      'wire declares a real fan — if it did not, the assertion above proves nothing about flow')
      .toBeGreaterThan(2)
  })

  it('the flow mode carries no section controller of any kind', async () => {
    const { modesById } = await import('./registry')
    const flow = modesById.flow
    const wired = ['onTap', 'onDoubleTap', 'onScrub', 'onScrubCommit', 'readout', 'listAdapter']
      .filter((k) => flow[k] != null)
    expect(wired, `the flow mode has grown ${wired.join(', ')} — §3.9 is verify-only`).toEqual([])
    expect(flow.cursor, 'flow has no list, so it must declare no cursor').toBeUndefined()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 2 — no registration hook was added, on either side of the seam
// ═════════════════════════════════════════════════════════════════════════════
describe('§3.9 — no registration hook exists for flow', () => {
  it('there is no flow section module under app/src/hub/sections', () => {
    const dir = path.resolve(process.cwd(), 'src/hub/sections')
    const entries = fs.readdirSync(dir)

    // NON-VACUITY (rule 14): a wrong path, a rename or an empty read would make the filter below
    // trivially satisfied. Name modules that MUST be there rather than counting.
    expect(entries, 'the sections directory read came back without the modules that do exist — '
      + 'the path is wrong and the assertion below is vacuous')
      .toEqual(expect.arrayContaining(['wireSection.js', 'breadthSection.js', 'notebookSection.js']))

    const flowish = entries.filter((e) => /^flow/i.test(e))
    expect(flowish, 'a flow section module appeared — §3.9 adds no registration hook').toEqual([])
  })

  it('OptionsFlow.jsx imports nothing from the hub and registers nothing', () => {
    const src = read('src/pages/OptionsFlow.jsx')

    // NON-VACUITY: prove the file was actually read, and is the file we think it is, before
    // reading anything into an empty violation list.
    expect(src.length, 'OptionsFlow.jsx read back tiny or empty').toBeGreaterThan(500_000)
    expect(src).toMatch(/export default/)

    expect(hubWiringIn(src),
      'OptionsFlow.jsx now reaches into the hub. §3.9 is a HARD NO on this file: it is '
      + 'partner-owned and sits on flow-worker\'s watched deploy paths, and a bounce there gaps '
      + 'the OPRA tape permanently until the T+1 flat file.').toEqual([])
  })

  it('CONTROL — the probe reports a violation when one is actually present', () => {
    // ⛔ THE HALF THAT MAKES THE TEST ABOVE MEAN SOMETHING. `OptionsFlow.jsx` may not be mutated
    // even transiently (see the deploy note above), so the detector is proved against a planted
    // source instead: the exact wiring a future engineer would add, in the exact shape every
    // other section uses. Without this, "no hub imports found" and "the regex never matched
    // anything" are the same observation.
    const planted = [
      "import React from 'react'",
      "import useHubMode from '../hub/useHubMode'",
      '',
      'export default function OptionsFlow() {',
      '  useHubMode({ id: "flow" })',
      '  return null',
      '}',
    ].join('\n')
    const hits = hubWiringIn(planted)
    expect(hits.length, 'the probe found nothing in a source that plainly wires the hub')
      .toBeGreaterThan(0)
    expect(hits.join('\n')).toMatch(/useHubMode/)

    // And it must not fire on prose — the reason this is not a substring search.
    expect(hubWiringIn('// the hub is deliberately not wired here; see hub/registry.js\n'))
      .toEqual([])
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 3 — real execution on /options-flow
// ═════════════════════════════════════════════════════════════════════════════
describe('§3.9 — what actually renders on /options-flow', () => {
  beforeEach(() => {
    mockPrefs = { joystick_hub: JSON.stringify({ enabled: true }) }
    stubHubCapable()
  })
  afterEach(() => {
    vi.useRealTimers()
    unstubHubCapable()
  })

  it('the hub mounts and offers exactly two bubbles: Voice and Home', async () => {
    await renderHub('/options-flow')
    expect(screen.getByTestId('loc').textContent).toBe('/options-flow')
    expect(screen.getByTestId('hub-root')).toBeInTheDocument()

    // The ID LIST, never a count — "two bubbles" is also what two wrong bubbles look like.
    const ids = Array.from(document.querySelectorAll('[data-action-id]'))
      .map((el) => el.getAttribute('data-action-id'))
    expect(ids).toEqual(['flow.voice', 'flow.home'])

    // ── CORROBORATION, deliberately not a rail of its own ──────────────────
    // A tap here must do nothing (`flow` declares no `onTap`), and that is the jsdom mirror of
    // emulated step F1.6. It is asserted HERE, inside a test whose named assertions can be made
    // to fail, rather than as its own guard — because it cannot be mutation-proved from the
    // registry: an `onTap` added there receives no arguments (`useJoystick.js:449` calls
    // `mode?.onTap?.()`) and has no `navigate` in scope, so a registry-side mutation produces an
    // onTap that fires and still cannot move the router. The falsifiable form of this claim is
    // "the flow mode carries no section controller" above; shipping a second, unfailable copy
    // here would be a guard repeated and therefore a guard unproved. On real glass it is worth
    // checking anyway, which is why F1.6 exists.
    const { DOUBLE_TAP_MS } = await import('./constants')
    vi.useFakeTimers()
    const pad = screen.getByTestId('mock-hub-pad')
    fireEvent.pointerDown(pad, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerUp(pad, { clientX: 0, clientY: 0, pointerId: 1 })
    act(() => { vi.advanceTimersByTime(DOUBLE_TAP_MS + 60) })
    expect(screen.getByTestId('loc').textContent).toBe('/options-flow')
  })

  it('the Home bubble navigates to /dashboard — the fan is real, just small', async () => {
    const { wedgeAngles } = await import('./fanGeometry')
    const { modesById, fanFor } = await import('./registry')
    const { FAN_RADIUS_INNER, FLICK_MS } = await import('./constants')

    await renderHub('/options-flow')

    const inner = fanFor(modesById.flow).filter((a) => a.ring === 1)
    const idx = inner.findIndex((a) => a.id === 'flow.home')
    expect(inner[idx].kind).toBe('home')
    const { dx, dy } = vecAtAngle(FAN_RADIUS_INNER, wedgeAngles(inner.length)[idx])

    const pad = screen.getByTestId('mock-hub-pad')
    vi.useFakeTimers()
    fireEvent.pointerDown(pad, { clientX: 0, clientY: 0, pointerId: 1 })
    act(() => { vi.advanceTimersByTime(FLICK_MS + 20) })
    fireEvent.pointerMove(pad, { clientX: dx, clientY: dy, pointerId: 1 })
    fireEvent.pointerUp(pad, { clientX: dx, clientY: dy, pointerId: 1 })

    expect(screen.getByTestId('loc').textContent).toBe('/dashboard')
  })
})
