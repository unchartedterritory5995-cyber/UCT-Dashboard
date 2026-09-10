/**
 * B3 — the Journal's three write actions open EXACTLY ONE sheet each, through the REAL HubRoot.
 *
 * ⛔⛔ WHY THIS FILE EXISTS, AND WHY IT IS NOT IN journalSection.test.jsx.
 * The double-sheet defect shipped past a green suite, and the reason is structural: every existing
 * test of these three actions calls `.run()` DIRECTLY — `journalSection.test.jsx:413` (moveStop),
 * `:419` (breakeven), `:426` (close). `.run()` is the section's handler. It is the SECOND half of
 * the gesture. The first half — `HubRoot`'s `runAction`, which decides whether to put a sheet of
 * its own in FRONT of the section's — was never executed by any test that named these actions. So
 * a `kind:'confirm'` that opened `HubConfirmSheet` and then the section's own sheet was invisible:
 * both halves were correct in isolation and nobody tested the join.
 *
 * ⭐ THE CLAIM THIS FILE RAILS is therefore not "the section opens a sheet" (already railed, in
 * journalSection.test.jsx, against the real page) but "HubRoot adds NOTHING in front of it". That
 * is a statement about a COUNT, so it is asserted as a count: `role="dialog"` is rendered by the
 * shared `Sheet` (`components/mobile/Sheet.jsx:184-185`) AND by `ClosePositionModal.jsx:94`, so one
 * query counts hub sheets and section sheets alike and cannot miss a stacked one.
 *
 * The gesture is DELIBERATE, never a flick: `Date.now` is advanced past `FLICK_MS` between
 * pointerdown and pointerup, so release lands in `useJoystick.js:428`'s `phase === 'pushing'`
 * branch -> `releaseOntoFan` -> `fireTarget`. That path ignores `flickable` by design (a deliberate
 * selection is always allowed; only a <120ms flick is blocked), which is why `journal.close` can be
 * driven here at all. The flick path for Close is a DEVICE step, not a jsdom one — see
 * `docs/plans/joystick/40-phase2-device.md` A10.
 *
 * ⚠️ The section here is a stand-in for the PAGE, not for the SHEETS: it registers the REAL
 * `modesById.journal` fan and renders the REAL `StopConfirmSheet` / `ClosePositionModal`. Mounting
 * the whole j2 tab would re-test what journalSection.test.jsx already covers and would make "how
 * many sheets are open" depend on that tab's own modals.
 */
import { describe, it as vitestIt, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import { MemoryRouter } from 'react-router-dom'
import { forwardRef, useMemo, useState } from 'react'

// ⛔ RAIL (house convention — mirrors useJoystick.test.js / hubWiring.test.jsx): `vitest -t` is a
// REGEX, and a filter matching nothing exits 0 and reads as a PASS. These counters catch a `-t`
// typo or a stray `.only`/`.skip` that would report fewer green tests as a full pass.
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

// ── leaf mocks: the same six hubWiring.test.jsx mocks, and for the same reason ──────────────
// `HubPad` is the one worth real behaviour — it forwards `ref` and the four pointer handlers,
// because that IS the seam `useJoystick` drives. Everything else would only add noise to a
// `role="dialog"` count.
let mockPrefs = {}
vi.mock('../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPrefMerged: vi.fn(), loading: false }),
  // ⚠️ A mocked module namespace is a Proxy that THROWS on any export the mock omits, and
  // useHubSettings.js imports `parsePref` directly.
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
vi.mock('./HubFan', () => ({ default: () => null }))
vi.mock('./HubChip', () => ({ default: () => null }))
vi.mock('./HubScrim', () => ({ default: () => null }))
vi.mock('./HubActionsButton', () => ({ default: () => null }))
vi.mock('../components/FeedbackWidget', () => ({ default: () => null }))

/** Every capability HubRoot's own `useHubActive()` checks, forced ON — same shape as
 *  hubWiring.test.jsx's `stubHubCapable`, so "the hub is active" means what HubRoot means. */
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

const POSITION = {
  id: 42, symbol: 'AAPL', side: 'Long', shares: 100, entryPrice: 178.1, stopPrice: 176,
}

/** Stands in for the PAGE: registers the REAL journal fan, renders the REAL sheets. */
function JournalPageStandIn() {
  const [sheet, setSheet] = useState(null)

  // ⚠️ `useMemo` with a stable dep list is load-bearing, not tidiness. `useHubMode` re-registers
  // whenever the config's IDENTITY changes, and registration is a `setState` on `HubProvider` —
  // which re-renders this component. A fresh object every render therefore re-registers, which
  // re-renders, which rebuilds the config: an infinite loop that presents as a HUNG TEST, not a
  // failing one. Same trap `journalSection.js:428` documents for the real page.
  const config = useMemo(() => {
    const handlers = {
      'journal.moveStop': () => setSheet('moveStop'),
      'journal.breakeven': () => setSheet('breakeven'),
      'journal.close': () => setSheet('close'),
    }
    const base = seedModesRef.current.journal
    return { ...base, fan: base.fan.map((a) => (handlers[a.id] ? { ...a, run: handlers[a.id] } : a)) }
  }, [])

  useHubModeRef.current(config)

  return (
    <>
      {(sheet === 'moveStop' || sheet === 'breakeven') && (
        <StopConfirmSheetRef.current
          symbol={POSITION.symbol}
          side={POSITION.side}
          entry={POSITION.entryPrice}
          shares={POSITION.shares}
          currentStop={POSITION.stopPrice}
          originalStop={POSITION.stopPrice}
          stop={sheet === 'breakeven' ? POSITION.entryPrice : POSITION.stopPrice}
          title="Set stop"
          onConfirm={() => {}}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'close' && (
        <ClosePositionModalRef.current
          position={POSITION}
          currentPrice={180}
          onSave={() => {}}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  )
}

// Module refs, filled in `beforeEach` after the dynamic imports resolve. The alternative — a
// top-level `await import` — would run before `vi.mock` hoisting is settled for the leaf mocks.
const useHubModeRef = { current: null }
const StopConfirmSheetRef = { current: null }
const ClosePositionModalRef = { current: null }
const seedModesRef = { current: null }

/** A point `dist` px from the pad centre at `angleDeg` (0=right, 90=up) — the exact inverse of
 *  `fanGeometry.pointerAngle`, matching useJoystick.test.js's fixture idiom. */
function vecAtAngle(dist, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180
  return { dx: Math.cos(rad) * dist, dy: -Math.sin(rad) * dist }
}

let wedgeAngles
let modesById
let HubRoot
let HubProvider

async function renderJournalHub() {
  return render(
    <MemoryRouter initialEntries={['/journal/trades']}>
      <HubProvider>
        <JournalPageStandIn />
        <HubRoot />
      </HubProvider>
    </MemoryRouter>,
  )
}

/**
 * A DELIBERATE push-and-release onto `actionId` — pointerdown, drag past the open threshold, then
 * release more than FLICK_MS later. Not a flick: `useJoystick.js:392` needs `elapsed < FLICK_MS`.
 */
function deliberateSelect(actionId) {
  const outer = modesById.journal.fan.filter((a) => a.ring === 0)
  const angles = wedgeAngles(outer.length)
  const idx = outer.findIndex((a) => a.id === actionId)
  expect(idx, `${actionId} is not on the journal outer ring`).toBeGreaterThanOrEqual(0)
  const { dx, dy } = vecAtAngle(30, angles[idx])

  let now = 1_700_000_000_000
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
  try {
    const pad = screen.getByTestId('mock-hub-pad')
    fireEvent.pointerDown(pad, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(pad, { clientX: dx, clientY: dy, pointerId: 1 })
    now += 400 // ⭐ past FLICK_MS (120): a deliberate selection, never a flick
    fireEvent.pointerUp(pad, { clientX: dx, clientY: dy, pointerId: 1 })
  } finally {
    clock.mockRestore()
  }
}

/** Every open sheet, hub-owned or section-owned. See the header for why this one query suffices. */
const openSheets = () => screen.queryAllByRole('dialog')

describe('B3 — one gesture, one sheet (the REAL HubRoot dispatch)', () => {
  beforeEach(async () => {
    mockPrefs = { joystick_hub: JSON.stringify({ enabled: true }) }
    stubHubCapable()
    const geometry = await import('./fanGeometry')
    const registry = await import('./registry')
    const hubMode = await import('./useHubMode')
    HubRoot = (await import('./HubRoot')).default
    HubProvider = (await import('./HubContext')).HubProvider
    StopConfirmSheetRef.current = (await import('./StopConfirmSheet')).default
    ClosePositionModalRef.current =
      (await import('../pages/journal-2-0/components/ClosePositionModal')).default
    useHubModeRef.current = hubMode.default
    wedgeAngles = geometry.wedgeAngles
    modesById = registry.modesById
    seedModesRef.current = registry.modesById
  })

  afterEach(() => {
    unstubHubCapable()
    vi.restoreAllMocks()
  })

  // ── the three actions ──────────────────────────────────────────────────────────────────────
  for (const [actionId, sheetTestId] of [
    ['journal.moveStop', 'hub-stop-body'],
    ['journal.breakeven', 'hub-stop-body'],
  ]) {
    it(`${actionId} opens EXACTLY ONE sheet, and it is the section's, not the hub's`, async () => {
      await renderJournalHub()
      expect(openSheets(), 'a sheet was open before the gesture').toHaveLength(0)

      deliberateSelect(actionId)

      expect(openSheets(), 'TWO sheets on one gesture — HubConfirmSheet is stacking again')
        .toHaveLength(1)
      expect(screen.getByTestId(sheetTestId)).toBeInTheDocument()
      expect(
        screen.queryByTestId('hub-confirm-primary'),
        'HubRoot put its own confirm sheet in front of the section sheet',
      ).toBeNull()
    })
  }

  it('journal.close opens EXACTLY ONE sheet — ClosePositionModal, with no hub sheet in front', async () => {
    await renderJournalHub()

    deliberateSelect('journal.close')

    expect(openSheets(), 'TWO sheets on one gesture — HubConfirmSheet is stacking again')
      .toHaveLength(1)
    expect(screen.queryByTestId('hub-confirm-primary')).toBeNull()
    // The modal's own confirmation surface: the six fields and its primary.
    expect(screen.getByLabelText(/shares/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/exit price/i)).toBeInTheDocument()
  })

  // ── the label ──────────────────────────────────────────────────────────────────────────────
  it("Move stop's primary carries the PRICE, not the action label — the B3 label half", async () => {
    await renderJournalHub()

    deliberateSelect('journal.moveStop')

    // ⭐ The wrong label was never StopConfirmSheet's: `HubRoot.jsx:143` builds the hub sheet's
    // primary as `primaryLabel: action.label`, i.e. the registry's "Move stop". Dropping the hub
    // sheet is what restores the mandated "Set stop 176.00" (`StopConfirmSheet.jsx:78`).
    const primary = screen.getByTestId('hub-stop-primary')
    expect(primary).toHaveTextContent(/^Set stop \d+\.\d{2}$/)
    expect(screen.queryByText(/^Move stop$/)).toBeNull()
  })

  // ── the registry contract these three rest on ──────────────────────────────────────────────
  it("all three are kind:'run', and Close keeps its flickable:false guard", async () => {
    const fan = modesById.journal.fan
    const byId = (id) => fan.find((a) => a.id === id)
    expect(byId('journal.moveStop').kind).toBe('run')
    expect(byId('journal.breakeven').kind).toBe('run')
    expect(byId('journal.close').kind).toBe('run')
    // ⛔ The guard `useJoystick.js:396` honours, and it never looked at `kind`.
    expect(byId('journal.close').flickable).toBe(false)
  })
})
