/**
 * R-14 / D-35 — `HubConfirmPayload.fields` REACHES THE MEMBER, ASSERTED ON THE RENDERED SHEET.
 *
 * ⛔⛔ WHY EVERY ASSERTION HERE IS ON THE DOM.
 * The defect this file rails is a SEVERED WIRE, not a broken function. `HubConfirmSheet` has
 * rendered ± steppers, a numeric input, min/max clamping and 2dp rounding since Phase 3; the
 * Screener has had `alertConfirmPayload()` written, exported and unit-tested for as long. Both
 * halves were correct and green. What did not exist was the one branch in `HubRoot`'s `confirm`
 * dispatch that ASKS a section for its payload — so the "EQUAL path, not a fallback" that
 * `contracts.js` says is the reason the sheet exists at all was unreachable code, and a member
 * with a tremor could not state a price.
 *
 * ⭐ A TEST THAT `confirmPayload` WAS CALLED PASSES WITH THE WIRE CUT. So does a test that
 * `setConfirmPayload` was invoked, or that the section returned the right object. This file
 * drives the real `HubRoot` through a real gesture and then reads the SHEET: the field's label,
 * the value in its input, what the `+` button does to the displayed number, and what the write
 * receives when the primary is pressed. That is the only evidence that distinguishes "the
 * payload exists" from "the member can use it".
 *
 * ⚠️ SCOPE OF THE STAND-INS. The Screener group mounts the REAL section controller
 * (`useScreenerHubSection`) and the REAL bridge, so the price in the sheet is resolved by the
 * same code the results table resolves it with — the live overlay when there is one, the row's
 * own snapshot otherwise. Only the two DATA hooks behind the bridge are stubbed (the flagged
 * store and the alerts API); nothing on the path under test is. The synthetic group builds its
 * own payload because no section ships a `type: 'text'` field today and none clamps at a bound a
 * test can reach in two clicks — but it goes through the same real `HubRoot` and the same real
 * sheet, which is where both behaviours live.
 */
import { describe, it as vitestIt, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import { forwardRef, useEffect, useMemo } from 'react'
import { MemoryRouter } from 'react-router-dom'

// ⛔ RAIL (house convention — mirrors journalSheetStacking / hubWiring): `vitest -t` is a REGEX,
// and a filter matching nothing exits 0 and reads as a PASS. These counters catch a `-t` typo or
// a stray `.only` / `.skip` that would report fewer green tests as a full pass.
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

// ── leaf mocks ───────────────────────────────────────────────────────────────────────────────
// The same six as `journalSheetStacking.test.jsx`, for the same reason: `HubPad` is the seam
// `useJoystick` drives, and everything else would only add noise to a sheet query.
const { hoisted } = vi.hoisted(() => ({
  hoisted: {
    prefs: {},
    /** `HubActionsButton`'s props, captured. `onAction` IS the Peek sheet's door into
     *  `runAction` (`HubRoot.jsx`: `onAction={runAction}`) — see the contract group for why one
     *  rail needs a door it can call directly rather than through a DOM event. */
    actionsDoor: { current: null },
    createAlert: null,
    flagged: { toggle: null, isFlagged: null },
  },
}))

vi.mock('../hooks/usePreferences', () => ({
  default: () => ({ prefs: hoisted.prefs, setPrefMerged: vi.fn(), loading: false }),
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
vi.mock('./HubActionsButton', () => ({
  default: (props) => { hoisted.actionsDoor.current = props; return null },
}))
vi.mock('../components/FeedbackWidget', () => ({ default: () => null }))

// The two DATA hooks behind the Screener's ActionsBridge. The bridge itself is real — it is what
// publishes `createAlert` onto the section's ref, and stubbing it would put a probe where the
// product's own wire is.
vi.mock('../hooks/useWatchlistAlerts', () => ({
  default: () => ({ createAlert: hoisted.createAlert, alerts: [], deleteAlert: () => {} }),
}))
vi.mock('../hooks/useFlagged', () => ({
  useFlagged: () => hoisted.flagged,
}))

import HubRoot from './HubRoot'
import { HubProvider, useHub } from './HubContext'
import useHubMode from './useHubMode'
import { modesById } from './registry'
import { wedgeAngles } from './fanGeometry'
import { HubContractError, validateSectionConfig } from './contracts'
import { _reset as resetCursors } from './useHubCursor'
import { AuthContext } from '../context/AuthContext'
import useScreenerHubSection, { buildScanFan } from './sections/screenerSection'
import { COMMIT_NOTICE_TEXT } from './HubCommitNotice'

// ── the scene ────────────────────────────────────────────────────────────────────────────────
/** Two screener rows. `price` is the row's own snapshot — what the table shows with no live tick. */
const ROWS = Object.freeze([
  Object.freeze({ ticker: 'AAA', company: 'Alpha', price: 178.10 }),
  Object.freeze({ ticker: 'BBB', company: 'Beta', price: 200 }),
])
/** The live overlay for AAA. All three results renderers prefer this over `row.price`. */
const LIVE = Object.freeze({ AAA: Object.freeze({ price: 179.55 }) })
const NO_LIVE = Object.freeze({})

/** Set per test, read (never mutated) during render. */
const scene = { prices: NO_LIVE, fan: null }

/** The registered section config, as `HubRoot` receives it from `HubProvider`. */
let registered = null
function ConfigProbe() {
  registered = useHub().activeModeConfig
  return null
}
const registeredFan = () => {
  if (!registered) throw new Error('no hub config registered — the page never called useHubMode')
  return registered.fan
}
const actionInFan = (id) => registeredFan().find((a) => a.id === id)

/** The REAL Screener section controller, with the real bridge mounted. */
function ScreenerPageStandIn() {
  const { hubMount } = useScreenerHubSection({
    displayRows: ROWS,
    filters: {},
    prices: scene.prices,
  })
  return hubMount
}

/**
 * A page that registers a fan of its own, for the two behaviours no shipped section exercises
 * yet (a `text` field, and bounds tight enough to clamp in two clicks).
 *
 * ⚠️ `useMemo` with an empty dep list is load-bearing, not tidiness — `useHubMode` re-registers
 * on config IDENTITY, registration is a `setState` on `HubProvider`, and a fresh object every
 * render is an infinite loop that presents as a HUNG test rather than a failing one.
 */
function CustomPageStandIn() {
  const { setSymbol } = useHub()
  useEffect(() => { setSymbol('AAA') }, [setSymbol])
  const config = useMemo(() => ({ ...modesById.scan, fan: scene.fan }), [])
  useHubMode(config)
  return null
}

/** The registry's own `scan.alert`, untouched — the action every group below dispatches. */
const registryAlert = () => modesById.scan.fan.find((a) => a.id === 'scan.alert')
/** Voice + Home, so the inner ring is never empty in a hand-built fan. */
const innerRing = () => modesById.scan.fan.filter((a) => a.ring === 1)

// ── the hub's own mount floor ────────────────────────────────────────────────────────────────
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

// ── driving the real gesture ─────────────────────────────────────────────────────────────────
/** A point `dist` px from the pad centre at `angleDeg` — the inverse of `fanGeometry.pointerAngle`. */
function vecAtAngle(dist, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180
  return { dx: Math.cos(rad) * dist, dy: -Math.sin(rad) * dist }
}

/**
 * A DELIBERATE push-and-release onto `actionId` — pointerdown, drag past the open threshold, then
 * release more than FLICK_MS later, so release lands in `useJoystick`'s `phase === 'pushing'`
 * branch and fires the resolved target.
 */
function deliberateSelect(actionId) {
  const outer = registeredFan().filter((a) => a.ring === 0)
  // ⭐ NON-VACUITY. Without this, a fan that shipped no such action makes the gesture land on
  // nothing and every assertion below fails for a reason that reads like the sheet is broken.
  const idx = outer.findIndex((a) => a.id === actionId)
  expect(idx, `${actionId} is not on the registered outer ring`).toBeGreaterThanOrEqual(0)
  const { dx, dy } = vecAtAngle(30, wedgeAngles(outer.length)[idx])

  let now = 1_700_000_000_000
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
  try {
    const pad = screen.getByTestId('mock-hub-pad')
    fireEvent.pointerDown(pad, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(pad, { clientX: dx, clientY: dy, pointerId: 1 })
    now += 400 // past FLICK_MS (120): a deliberate selection, never a flick
    fireEvent.pointerUp(pad, { clientX: dx, clientY: dy, pointerId: 1 })
  } finally {
    clock.mockRestore()
  }
}

const renderHub = (page) => render(
  <AuthContext.Provider value={{ user: { id: 1, email: 'x@y.z' } }}>
    <MemoryRouter initialEntries={['/screener']}>
      <HubProvider>
        {page}
        <ConfigProbe />
        <HubRoot />
      </HubProvider>
    </MemoryRouter>
  </AuthContext.Provider>,
)

/** The sheet, as the DOM has it. */
const sheetOpen = () => screen.queryByTestId('hub-confirm-primary') != null
const field = (name) => screen.getByTestId(`hub-confirm-field-${name}`)
const fieldCount = () => document.querySelectorAll('[data-testid^="hub-confirm-field-"]').length
const press = (label) => fireEvent.click(screen.getByLabelText(label))
const confirmIt = () => fireEvent.click(screen.getByTestId('hub-confirm-primary'))

beforeEach(() => {
  hoisted.prefs = { joystick_hub: JSON.stringify({ enabled: true }) }
  hoisted.actionsDoor.current = null
  hoisted.createAlert = vi.fn()
  hoisted.flagged = { toggle: vi.fn(), isFlagged: vi.fn(() => false) }
  scene.prices = NO_LIVE
  scene.fan = null
  registered = null
  resetCursors()
  stubHubCapable()
})

afterEach(() => {
  cleanup()
  delete globalThis.CSS
  delete window.visualViewport
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("the Screener's Alert — the section's own payload, on the rendered sheet", () => {
  it('CONTROL: the real section shipped scan.alert WITH a confirmPayload function', () => {
    // The derivation this whole group rests on. `buildScanFan` drops what it cannot handle, so an
    // absent action would make every case below fail for the wrong reason.
    renderHub(<ScreenerPageStandIn />)
    expect(registeredFan().map((a) => a.id)).toContain('scan.alert')
    expect(typeof actionInFan('scan.alert').confirmPayload).toBe('function')
    expect(sheetOpen(), 'a sheet was open before any gesture').toBe(false)
  })

  it('⛔⛔ a SECTION-supplied payload still carries the action\'s escalation', () => {
    // ⚰️ THE INTEGRATION DEFECT THIS EXISTS FOR, and it was built out of two correct changes.
    // R-14's branch sets the section's payload verbatim. The iOS visible-escalation work put
    // `escalate` on the FALLBACK payload only. `scan.alert` declares `escalate: true` in the
    // registry and is the ONLY action that takes the section path — so the Screener's Alert,
    // the exact action R-14 existed to fix, was the one confirm sheet in the product that
    // rendered no commit notice. On an iPhone, where `navigator.vibrate` does not exist, that
    // member got no escalation signal in either channel.
    //
    // ⭐ Asserted as RENDERED TEXT on the real sheet, not as a payload field: the whole point of
    // the notice is that a phone which cannot buzz still SAYS the write is the serious kind, and
    // a test that reads `payload.escalate` would pass with nothing on screen.
    expect(modesById.scan.fan.find((a) => a.id === 'scan.alert')?.escalate,
      'scan.alert stopped escalating in the registry — this rail now proves nothing, and the '
      + 'right fix is to pick another escalating confirm, not to delete the assertion').toBe(true)

    renderHub(<ScreenerPageStandIn />)
    deliberateSelect('scan.alert')

    expect(screen.getByLabelText('price'), 'the section payload did not open — this rail is '
      + 'measuring the generic sheet, not the one under test').toBeTruthy()
    expect(screen.queryByText(COMMIT_NOTICE_TEXT),
      'the section-supplied sheet rendered NO commit notice. `scan.alert` escalates, so a member '
      + 'on an iPhone — which cannot vibrate — now has no signal at all that this one writes. '
      + '`escalate` belongs to the ACTION; HubRoot must carry it onto a section payload.').not.toBeNull()
  })

  it('⛔ the sheet carries a PRICE FIELD, defaulting to the number the table is showing', () => {
    renderHub(<ScreenerPageStandIn />)

    deliberateSelect('scan.alert')

    // The label a member reads, and the value in the box under it.
    expect(screen.getByLabelText('price'), 'no price field — the sheet is the generic yes/no one')
      .toBe(field('price'))
    expect(field('price').value).toBe('178.1')
    // …and the sheet says the same number in words, so the field and the body cannot disagree.
    expect(screen.getByTestId('hub-confirm-body')).toHaveTextContent('AAA is 178.10 now.')
    expect(screen.getByTestId('hub-confirm-primary')).toHaveTextContent('Create alert')
  })

  it('⛔ the default FOLLOWS THE LIVE OVERLAY — the sheet never argues with the table', () => {
    // Both renderers overlay the live price when there is one. A default taken from the row's own
    // snapshot would put a different number in the box than the one on screen.
    scene.prices = LIVE
    renderHub(<ScreenerPageStandIn />)

    deliberateSelect('scan.alert')

    expect(field('price').value).toBe('179.55')
    expect(field('price').value, "the sheet defaulted to the row's stale snapshot").not.toBe('178.1')
  })

  it('⛔ the + stepper moves the DISPLAYED number, and the alert is written at the STEPPED value', () => {
    scene.prices = LIVE
    renderHub(<ScreenerPageStandIn />)

    deliberateSelect('scan.alert')
    press('Increase price')
    press('Increase price')

    // 2dp: raw float addition would render 179.57000000000002 here.
    expect(field('price').value).toBe('179.57')

    confirmIt()

    // The WRITE, through the section's own `createAlert` — the whole point of R-14. Direction is
    // derived from the reference the sheet opened at, never asked.
    expect(hoisted.createAlert).toHaveBeenCalledTimes(1)
    expect(hoisted.createAlert).toHaveBeenCalledWith('AAA', 179.57, 'above')
  })

  it('⛔ stepping DOWN writes a below-alert at the value the member chose', () => {
    scene.prices = LIVE
    renderHub(<ScreenerPageStandIn />)

    deliberateSelect('scan.alert')
    press('Decrease price')

    expect(field('price').value).toBe('179.54')
    confirmIt()
    expect(hoisted.createAlert).toHaveBeenCalledWith('AAA', 179.54, 'below')
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe('a section payload, field by field, through the same HubRoot', () => {
  /** Registers the registry's own `scan.alert` with a hand-built payload behind it. */
  const withPayload = (payload) => {
    scene.fan = [{ ...registryAlert(), confirmPayload: () => payload }, ...innerRing()]
    return renderHub(<CustomPageStandIn />)
  }

  it('⛔ NUMBER: the steppers clamp at max and at min — the bounds are real, not decoration', () => {
    const onConfirm = vi.fn()
    withPayload({
      title: 'Alert on AAA',
      body: 'Alert when AAA crosses this price.',
      primaryLabel: 'Create alert',
      fields: [{ name: 'price', type: 'number', value: 1, min: 1, max: 1.02, step: 0.01 }],
      onConfirm,
    })

    deliberateSelect('scan.alert')

    press('Increase price')
    press('Increase price')
    expect(field('price').value).toBe('1.02')
    press('Increase price')
    press('Increase price')
    expect(field('price').value, 'the max bound did not hold').toBe('1.02')

    for (let i = 0; i < 5; i += 1) press('Decrease price')
    expect(field('price').value, 'the min bound did not hold').toBe('1')

    confirmIt()
    expect(onConfirm).toHaveBeenCalledWith({ price: 1 })
  })

  it('⛔ NUMBER: the displayed value is 2dp — float addition never reaches the member', () => {
    const onConfirm = vi.fn()
    withPayload({
      title: 'Alert on AAA',
      body: 'Alert when AAA crosses this price.',
      primaryLabel: 'Create alert',
      fields: [{ name: 'price', type: 'number', value: 0.1, step: 0.2 }],
      onConfirm,
    })

    deliberateSelect('scan.alert')
    press('Increase price')

    // 0.1 + 0.2 === 0.30000000000000004 in IEEE-754. The member sees 0.3.
    expect(field('price').value).toBe('0.3')
    confirmIt()
    expect(onConfirm).toHaveBeenCalledWith({ price: 0.3 })
  })

  it('⛔ TEXT: a text field renders as text, edits, and its value reaches the write', () => {
    const onConfirm = vi.fn()
    withPayload({
      title: 'Alert on AAA',
      body: 'Say what you are waiting for.',
      primaryLabel: 'Save note',
      fields: [{ name: 'note', type: 'text', value: 'watch the open' }],
      onConfirm,
    })

    deliberateSelect('scan.alert')

    const input = screen.getByLabelText('note')
    expect(input).toBe(field('note'))
    expect(input.type).toBe('text')
    // A text field is not a numeric one wearing a label: no numeric affordances follow it.
    expect(input).not.toHaveAttribute('step')
    expect(input).not.toHaveAttribute('inputmode')
    expect(input.value).toBe('watch the open')

    fireEvent.change(input, { target: { value: 'gap and go' } })
    expect(field('note').value).toBe('gap and go')

    confirmIt()
    expect(onConfirm).toHaveBeenCalledWith({ note: 'gap and go' })
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe('the generic yes/no confirm is UNCHANGED for an action with no confirmPayload', () => {
  /** The registry's own `scan.alert` with a `run` handler and NO section payload. */
  const genericFan = (run) => {
    // Belt and braces: the registry entry carries no `confirmPayload` today, and this file would
    // be lying about what it registers if that ever changed under it.
    const bare = { ...registryAlert() }
    delete bare.confirmPayload
    scene.fan = [{ ...bare, run }, ...innerRing()]
  }

  it('opens the fallback sheet — confirmText as the body, the action label as the primary, NO fields', () => {
    genericFan(vi.fn())
    renderHub(<CustomPageStandIn />)

    deliberateSelect('scan.alert')

    expect(sheetOpen(), 'no sheet at all — the generic confirm path is broken').toBe(true)
    expect(screen.getByTestId('hub-confirm-body')).toHaveTextContent('Alert on AAA')
    expect(screen.getByTestId('hub-confirm-primary')).toHaveTextContent('Alert')
    expect(fieldCount(), 'the generic sheet grew fields it was never given').toBe(0)
  })

  it("⛔ the primary calls the action's run WITH the sheet's values, not just ctx", () => {
    // ⭐ This is the half of the R-14 diff that has no visible symptom TODAY: the generic payload
    // declares no fields, so `values` is `{}`. It is load-bearing the moment any action grows one
    // — and a handler written as `run(ctx)` would silently drop everything the member typed.
    const run = vi.fn()
    genericFan(run)
    renderHub(<CustomPageStandIn />)

    deliberateSelect('scan.alert')
    confirmIt()

    expect(run).toHaveBeenCalledTimes(1)
    const [ctxArg, valuesArg] = run.mock.calls[0]
    expect(run.mock.calls[0], 'run was called with one argument — the sheet values were dropped')
      .toHaveLength(2)
    // It really is the hub's ctx (the seam every mode callback receives), not some other object.
    expect(typeof ctxArg.navigate).toBe('function')
    expect(ctxArg.symbol).toBe('AAA')
    // …and it really is the sheet's own values object.
    expect(valuesArg).toEqual({})
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe('the section payload is contract-checked before it can reach the sheet', () => {
  /**
   * ⚠️ FIRED THROUGH `HubActionsButton`'s `onAction` — the Peek sheet's door, which `HubRoot`
   * wires as `onAction={runAction}`. It is used here and not the gesture for one reason: a
   * contract failure THROWS in DEV, and an exception raised inside a DOM event listener is
   * swallowed by jsdom's dispatch rather than handed back to the caller. Calling the door
   * directly keeps the throw assertable. The first case proves the door is the real dispatcher
   * and not a prop this file invented.
   */
  const fire = (action) => act(() => { hoisted.actionsDoor.current.onAction(action) })

  const validPayload = {
    title: 'Alert on AAA',
    body: 'Alert when AAA crosses this price.',
    primaryLabel: 'Create alert',
    fields: [{ name: 'price', type: 'number', value: 179.55, step: 0.01 }],
    onConfirm: () => {},
  }

  it('CONTROL: the Peek door dispatches the SAME confirm branch the gesture does', () => {
    scene.fan = [{ ...registryAlert(), confirmPayload: () => validPayload }, ...innerRing()]
    renderHub(<CustomPageStandIn />)
    expect(typeof hoisted.actionsDoor.current?.onAction,
      'HubRoot no longer hands HubActionsButton a dispatcher — the accessible door is dead')
      .toBe('function')

    fire(actionInFan('scan.alert'))

    expect(sheetOpen()).toBe(true)
    expect(field('price').value).toBe('179.55')
  })

  it('⛔ a malformed section payload is REFUSED, named against the action, and never opens a sheet', () => {
    // A number field with no `step` — "a stepper that cannot step", which is precisely the
    // accessible path silently becoming worse than the gesture it exists to equal.
    const broken = { ...validPayload, fields: [{ name: 'price', type: 'number', value: 179.55 }] }
    scene.fan = [{ ...registryAlert(), confirmPayload: () => broken }, ...innerRing()]
    renderHub(<CustomPageStandIn />)

    // ⚰️ THIS BLOCK WAS VACUOUS ON ITS FIRST WRITING, and its own mutation proof is what caught
    // it. The assertions lived INSIDE a `catch`, after a first `expect(...).toThrow()` had already
    // consumed one throw. Delete `HubRoot`'s validator call and the sheet's own render-time check
    // throws instead — the first `toThrow` still passed, the second `fire()` hit an already-torn-
    // down tree and threw nothing, so the catch never ran and NEITHER message assertion was ever
    // evaluated. A test whose real assertions are reachable only on a branch that may not be taken
    // is a test that passes for free (`lesson_a_capture_that_only_breaks_on_failure`).
    let caught = null
    try {
      fire(actionInFan('scan.alert'))
    } catch (err) {
      caught = err
    }

    expect(caught, 'the malformed payload was accepted — nothing refused it').toBeInstanceOf(HubContractError)
    // ⭐ THE CALL-SITE LABEL IS THE LOAD-BEARING HALF, and it is the only half that can tell the
    // two validators apart. `HubConfirmSheet` validates on render too, so a payload this bad is
    // refused either way — but the sheet's report is labelled `HubConfirmSheet` and fires only
    // AFTER the payload has become state, while the hub's names the ACTION and fires before.
    expect(caught.message).toMatch(/scan\.alert confirmPayload/)
    expect(caught.message).toMatch(/step is required/)
    expect(sheetOpen(), 'a payload that fails its contract still opened a sheet').toBe(false)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe('validateSectionConfig refuses a confirmPayload nothing can read', () => {
  const cfg = (action) => ({ id: 'scan', fan: [action] })

  it('a confirmPayload that is not a function', () => {
    // `HubRoot` evaluates `action.confirmPayload?.(ctx)`; optional-call guards null, not a string,
    // so this THROWS inside a gesture handler where nothing catches it.
    expect(() => validateSectionConfig(cfg({ id: 'scan.alert', kind: 'confirm', confirmPayload: 'nope' })))
      .toThrow(/confirmPayload must be a function/)
  })

  it('⛔ a confirmPayload on a kind the hub never asks — the scrubAxis-without-onScrub shape', () => {
    expect(() => validateSectionConfig(cfg({ id: 'scan.flag', kind: 'run', confirmPayload: () => null })))
      .toThrow(/declares a payload nothing reads/)
  })

  it('CONTROL: the REAL screener fan passes, so the check is not simply always throwing', () => {
    const fan = buildScanFan({ symbol: 'AAA', shownPrice: 178.10, createAlert: () => {} })
    // Non-vacuity: the derivation returned the action this control is about.
    expect(fan.map((a) => a.id)).toContain('scan.alert')
    expect(typeof fan.find((a) => a.id === 'scan.alert').confirmPayload).toBe('function')
    expect(() => validateSectionConfig({ ...modesById.scan, fan })).not.toThrow()
  })
})
