// Task 0 — the Phase 3 seam, driven end to end.
//
// ⛔ WHY THIS FILE IS THE PRECONDITION FOR DISPATCHING ANY INTEGRATOR.
//
// Phase 2 built the engine, the components and the integrator in parallel against a seam nobody
// owned. Every prop across it was wrong, the hub was non-functional, and BOTH unit suites were
// green the whole time — each half tested its own idea of the contract and neither tested the
// join. Component tests are structurally blind to a severed wire.
//
// Phase 3's seam is worse in one way: the section config comes from a PAGE at runtime, and every
// way it can be wrong is silent. A missing `onScrub` is not an error, it is a gesture that does
// nothing. So this file does not test the validators in isolation — it registers a FAKE PAGE,
// drives the real engine through it, and asserts the page received exactly the documented calls
// in the documented order.
//
// Three things are asserted, matching the three halves of the seam:
//   1. the section config receives tap / double-tap / scrub / commit, in order;
//   2. the confirm sheet renders its payload AS TEXT and fires onConfirm exactly once;
//   3. the cursor marks the identity-keyed row and calls the adapter's scrollTo.
//
// Plus the rail: every Phase 3 typedef has a matching `validate*`, derived from the file.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useRef } from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  HubContractError,
  validateSectionConfig, validateListAdapter, validateConfirmPayload,
  validateCursorApi, validatePlanTradeSheetProps, validateChipReadout,
} from './contracts'
import HubConfirmSheet from './HubConfirmSheet'
import useHubCursor, { _reset as resetCursors } from './useHubCursor'
import useJoystick from './useJoystick'

const HERE = path.dirname(fileURLToPath(import.meta.url))

beforeEach(() => { resetCursors?.() })
afterEach(() => { vi.restoreAllMocks() })

// ─────────────────────────────────────────────────────────────────────────────
describe('the rail — every Phase 3 typedef has a validator', () => {
  // ⭐ DERIVED FROM THE FILE, not a list typed here. A typedef added tomorrow is covered the day
  // it lands; a hand-typed roster is the enumeration defect this repo keeps paying for.
  const src = readFileSync(path.join(HERE, 'contracts.js'), 'utf8')
  const phase3 = src.slice(src.indexOf('PHASE 3 CONTRACTS — the seam'))
  const typedefs = [...phase3.matchAll(/@typedef\s+\{[^}]*\}\s+(\w+)/g)].map((m) => m[1])
  const validators = new Set(
    [...phase3.matchAll(/export function (validate\w+)/g)].map((m) => m[1]),
  )

  it('CONTROL: the Phase 3 section was actually found and has typedefs', () => {
    // Without this, a renamed section header makes `typedefs` empty and the assertion below
    // passes while checking nothing.
    expect(typedefs.length, 'no @typedef found in the Phase 3 section — the scan broke').toBeGreaterThan(3)
  })

  it('⛔ every typedef has a matching validate* export', () => {
    // Hub<Name> -> validate<Name>, minus the leading "Hub" where present.
    const expected = typedefs.map((t) => `validate${t.replace(/^Hub/, '')}`)
    const missing = expected.filter((v) => !validators.has(v))
    expect(
      missing,
      `these Phase 3 typedefs document a seam nothing checks at runtime: ${missing.join(', ')}. `
      + 'A @typedef is a comment; it enforces nothing.',
    ).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('validators reject the shapes that fail SILENTLY in production', () => {
  it('a section with onScrub but no readout — the drag that narrates nothing', () => {
    expect(() => validateSectionConfig({ id: 'scan', onScrub: () => {} }))
      .toThrow(HubContractError)
  })

  it('a listAdapter without scrollTo — a cursor that advances off-screen', () => {
    // index still moves and data-hub-cursor still lands, so nothing downstream throws and the
    // member simply sees the selection leave the screen.
    expect(() => validateListAdapter({ items: [], identityKey: (x) => x }))
      .toThrow(/scrollTo/)
  })

  it('onScrubCommit without onScrub — a commit that can never fire', () => {
    expect(() => validateSectionConfig({ id: 'wire', onScrubCommit: () => {} }))
      .toThrow(/onScrubCommit/)
  })

  it('a number field with no step — a stepper that cannot step', () => {
    expect(() => validateConfirmPayload({
      title: 't', body: 'b', primaryLabel: 'Go', onConfirm: () => {},
      fields: [{ name: 'stop', type: 'number', value: 1 }],
    })).toThrow(/step is required/)
  })

  it('a plan-trade with stop === entry — a plan that cannot say what it risks', () => {
    // Mirrors the backend's hard 422: at stop === entry the side is undefined and r_value is null.
    expect(() => validatePlanTradeSheetProps({
      symbol: 'NVDA', entry: 100, stop: 100, size: 10, onClose: () => {},
    })).toThrow(/stop must differ from entry/)
  })

  it('CONTROL: the valid shapes pass, so the validators are not simply always throwing', () => {
    expect(() => validateSectionConfig({
      id: 'scan',
      onTap: () => {}, onScrub: () => {}, onScrubCommit: () => {}, readout: () => 'x',
      listAdapter: { items: [], identityKey: (x) => x, scrollTo: () => {} },
    })).not.toThrow()
    expect(() => validateConfirmPayload({
      title: 't', body: 'b', primaryLabel: 'Go', onConfirm: () => {},
      fields: [{ name: 'stop', type: 'number', value: 1, step: 0.01 }],
    })).not.toThrow()
    expect(() => validateCursorApi({
      item: null, index: -1, count: 0,
      next: () => {}, prev: () => {}, scrubTo: () => {}, itemProps: () => ({}), paintCursor: () => {},
    })).not.toThrow()
    expect(() => validateChipReadout('NVDA · 4H')).not.toThrow()
    expect(() => validateChipReadout({ label: 'stop', value: '178.10' })).not.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('the confirm sheet — renders its payload as text, fires onConfirm exactly once', () => {
  const basePayload = (overrides = {}) => ({
    title: 'Set stop',
    body: 'Set the stop on NVDA to 178.10. This replaces your current stop of 176.00.',
    primaryLabel: 'Set stop 178.10',
    onConfirm: vi.fn(),
    ...overrides,
  })

  it('⛔ renders the payload AS TEXT — asserted on the DOM, never on state', () => {
    // The CLAUDE.md rule this earns its place from: user-facing feedback is asserted by rendered
    // text after the action settles. Two toast defects shipped in this feature that left every
    // structural assertion green while the member saw nothing.
    const payload = basePayload()
    render(<HubConfirmSheet payload={payload} onClose={() => {}} />)
    expect(screen.getByText(payload.body)).toBeTruthy()
    expect(screen.getByText('Set stop 178.10')).toBeTruthy()
  })

  it('⛔ fires onConfirm EXACTLY ONCE, however many times the button is tapped', () => {
    // A double-tap on a slow network is the ordinary case, and the Journal write is a PUT.
    const payload = basePayload()
    render(<HubConfirmSheet payload={payload} onClose={vi.fn()} />)
    const primary = screen.getByTestId('hub-confirm-primary')
    fireEvent.click(primary)
    fireEvent.click(primary)
    fireEvent.click(primary)
    expect(payload.onConfirm).toHaveBeenCalledTimes(1)
  })

  it('closes after confirming', () => {
    const onClose = vi.fn()
    render(<HubConfirmSheet payload={basePayload()} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('hub-confirm-primary'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the steppers reach the same value as the gesture — the WCAG 2.5.1 equal path', () => {
    const payload = basePayload({
      fields: [{ name: 'stop', type: 'number', value: 178.10, step: 0.01, min: 0 }],
    })
    render(<HubConfirmSheet payload={payload} onClose={() => {}} />)
    fireEvent.click(screen.getByLabelText('Increase stop'))
    fireEvent.click(screen.getByLabelText('Increase stop'))
    // 2dp (A2): raw float addition would show 178.12000000000002 here.
    expect(screen.getByTestId('hub-confirm-field-stop').value).toBe('178.12')
    fireEvent.click(screen.getByTestId('hub-confirm-primary'))
    expect(payload.onConfirm).toHaveBeenCalledWith({ stop: 178.12 })
  })

  it('⛔ B1: a REUSED sheet fires again — the latch is per-sheet, not per-mount', () => {
    // Every other test in this file mounts a FRESH component with a payload in hand. The product
    // does the opposite: `HubRoot` mounts one sheet permanently and swaps `payload` in and out. So
    // the whole suite was blind to a latch that survived the close — the first confirm of a session
    // worked and every one after it hit the early return, never calling onConfirm AND never calling
    // onClose, leaving the sheet open with a dead button until a reload.
    const first = basePayload()
    const onClose = vi.fn()
    const { rerender } = render(<HubConfirmSheet payload={first} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('hub-confirm-primary'))
    expect(first.onConfirm).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)

    // The sheet closes (payload -> null) and a SECOND action opens it, same mounted component.
    rerender(<HubConfirmSheet payload={null} onClose={onClose} />)
    const second = basePayload({ primaryLabel: 'Set stop 179.00' })
    rerender(<HubConfirmSheet payload={second} onClose={onClose} />)

    fireEvent.click(screen.getByTestId('hub-confirm-primary'))
    expect(second.onConfirm, 'the second confirm never fired — the latch outlived its sheet')
      .toHaveBeenCalledTimes(1)
    // …and still exactly once for the new sheet.
    fireEvent.click(screen.getByTestId('hub-confirm-primary'))
    expect(second.onConfirm).toHaveBeenCalledTimes(1)
  })

  it('⛔ B1: a REUSED sheet seeds its field values from the NEW payload', () => {
    // The same defect in the state initialiser: `useState`'s lazy init ran once, at mount, when
    // payload was null — so `values` was {} forever and a payload with `fields` rendered
    // value={undefined}. That is the structural cause of R-14, not just its symptom.
    const onClose = vi.fn()
    const { rerender } = render(<HubConfirmSheet payload={null} onClose={onClose} />)
    const withFields = basePayload({
      fields: [{ name: 'stop', type: 'number', value: 178.10, step: 0.01 }],
    })
    rerender(<HubConfirmSheet payload={withFields} onClose={onClose} />)
    expect(screen.getByTestId('hub-confirm-field-stop').value).toBe('178.1')
  })

  it('renders nothing at all with no payload', () => {
    const { container } = render(<HubConfirmSheet payload={null} onClose={() => {}} />)
    expect(container.textContent).toBe('')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('the cursor seam — identity key and scrollTo', () => {
  function Fake({ adapter }) {
    const cursor = useHubCursor('contract-test', adapter.items, { key: adapter.identityKey })
    return (
      <ul>
        {adapter.items.map((it, i) => (
          <li key={it.id} data-testid={`row-${it.id}`} {...cursor.itemProps(i)}>{it.id}</li>
        ))}
        <button type="button" data-testid="next" onClick={() => { cursor.next(); adapter.scrollTo(cursor.index + 1) }}>next</button>
      </ul>
    )
  }

  it('marks the identity-keyed row and calls the adapter scrollTo', () => {
    const adapter = {
      items: [{ id: 'AAA' }, { id: 'BBB' }, { id: 'CCC' }],
      identityKey: (it) => it.id,
      scrollTo: vi.fn(),
    }
    validateListAdapter(adapter)
    render(<Fake adapter={adapter} />)

    expect(screen.getByTestId('row-AAA').getAttribute('data-hub-cursor')).toBe('active')
    expect(screen.getByTestId('row-BBB').getAttribute('data-hub-cursor')).toBeNull()

    act(() => { fireEvent.click(screen.getByTestId('next')) })

    expect(screen.getByTestId('row-BBB').getAttribute('data-hub-cursor')).toBe('active')
    expect(screen.getByTestId('row-AAA').getAttribute('data-hub-cursor')).toBeNull()
    expect(adapter.scrollTo).toHaveBeenCalledWith(1)
  })

  it('⛔ a poll returning NEW objects for the same rows does not send the cursor home', () => {
    // The identity is the ordered join of the keys, not the array reference. Journal polls every
    // 15s; if this regressed, the cursor would jump to row 0 four times a minute.
    const mk = () => [{ id: 'AAA' }, { id: 'BBB' }, { id: 'CCC' }]
    const adapter = { items: mk(), identityKey: (it) => it.id, scrollTo: vi.fn() }
    const { rerender } = render(<Fake adapter={adapter} />)
    act(() => { fireEvent.click(screen.getByTestId('next')) })
    expect(screen.getByTestId('row-BBB').getAttribute('data-hub-cursor')).toBe('active')

    rerender(<Fake adapter={{ ...adapter, items: mk() }} />)
    expect(screen.getByTestId('row-BBB').getAttribute('data-hub-cursor')).toBe('active')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// THE HALF THAT WOULD HAVE CAUGHT PHASE 2: a fake page, the REAL engine, and the
// exact documented call order. Not a validator test — a join test.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wires a `HubSectionConfig` to the real gesture engine exactly as `HubRoot` does: `mode` carries
 * onTap/onDoubleTap (the engine reads them off the mode object), while onScrub/onScrubCommit are
 * passed as engine callbacks. If that wiring ever drifts, this harness drifts with it and the
 * order assertions below go red — which is the point.
 */
function EngineHarness({ config, settings = {}, ctx = { fake: 'ctx' } }) {
  const padRef = useRef(null)
  const { handlers } = useJoystick({
    mode: config,
    settings,
    padRef,
    // ⛔ CONTEXT-FIRST, EXACTLY AS HubRoot.jsx:147/151 DOES IT.
    //
    // This harness previously passed `config.onScrub` straight through, i.e. the one-argument
    // form — and the contract typedef had been written to match the harness. Both halves agreed
    // with each other and neither agreed with the mounted product, so a section built against
    // the contract would have read `ctx.delta === undefined` on the real page with a green
    // suite behind it. That is the Phase 2 seam failure reproduced inside the file written to
    // prevent it. `contractArity.test.js` now derives the argument list from HubRoot rather
    // than letting this harness be the authority.
    onScrub: (scrub) => config.onScrub?.(ctx, scrub),
    onScrubCommit: () => config.onScrubCommit?.(ctx),
  })
  return <div data-testid="pad" ref={padRef} {...handlers} />
}

describe('a fake page + the real engine — the documented call order', () => {
  const HOLD_MS = 500
  const DOUBLE_TAP_MS = 280

  /** Records every call the section receives, in order, with no arguments lost. */
  function makeSection(calls) {
    return validateSectionConfig({
      id: 'scan',
      onTap: () => calls.push('tap'),
      onDoubleTap: () => calls.push('doubleTap'),
      // Context-first: the section asserts it RECEIVES ctx, so a regression to the
      // one-argument form fails here rather than silently on a real page.
      onScrub: (ctx, s) => calls.push(ctx && s ? `scrub:${s.axis}` : 'scrub:BAD-ARITY'),
      onScrubCommit: (ctx) => calls.push(ctx ? 'commit' : 'commit:BAD-ARITY'),
      readout: () => 'row 3 of 41',
      listAdapter: { items: [], identityKey: (x) => x, scrollTo: () => {} },
    })
  }

  afterEach(() => { vi.useRealTimers() })

  it('a single tap reaches onTap, and ONLY onTap', () => {
    const calls = []
    render(<EngineHarness config={makeSection(calls)} settings={{ holdMs: HOLD_MS, doubleTapMs: DOUBLE_TAP_MS }} />)
    // Fake timers engaged AFTER mount: mounting a tree while they are already active starves
    // React 18's scheduler and the render never commits (recorded in hubWiring.test.jsx).
    vi.useFakeTimers()
    const pad = screen.getByTestId('pad')

    fireEvent.pointerDown(pad, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerUp(pad, { clientX: 0, clientY: 0, pointerId: 1 })
    act(() => { vi.advanceTimersByTime(DOUBLE_TAP_MS + 20) })

    expect(calls).toEqual(['tap'])
  })

  it('a double tap reaches onDoubleTap and NEVER also onTap', () => {
    // The engine cancels the pending single-tap timer. If it stopped doing that, a member would
    // get both actions from one gesture — and on a section where tap and double-tap do different
    // things, that is a write they did not ask for.
    const calls = []
    render(<EngineHarness config={makeSection(calls)} settings={{ holdMs: HOLD_MS, doubleTapMs: DOUBLE_TAP_MS }} />)
    vi.useFakeTimers()
    const pad = screen.getByTestId('pad')

    fireEvent.pointerDown(pad, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerUp(pad, { clientX: 0, clientY: 0, pointerId: 1 })
    act(() => { vi.advanceTimersByTime(DOUBLE_TAP_MS / 4) })
    fireEvent.pointerDown(pad, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerUp(pad, { clientX: 0, clientY: 0, pointerId: 1 })
    act(() => { vi.advanceTimersByTime(DOUBLE_TAP_MS * 2) })

    expect(calls).toEqual(['doubleTap'])
  })

  it('⛔ hold → drag → release is scrub… scrub… commit, in that order, commit LAST', () => {
    const calls = []
    render(<EngineHarness config={makeSection(calls)} settings={{ holdMs: HOLD_MS, doubleTapMs: DOUBLE_TAP_MS }} />)
    vi.useFakeTimers()
    const pad = screen.getByTestId('pad')

    fireEvent.pointerDown(pad, { clientX: 0, clientY: 0, pointerId: 1 })
    act(() => { vi.advanceTimersByTime(HOLD_MS + 20) })   // hold reached -> a drag is a scrub, not a fan push
    // ⭐ N moves produce N-1 onScrub calls, and that is correct, not an off-by-one. The FIRST
    // move after a hold only ARMS the scrub: it flips the phase and stores the anchor point
    // (`lastRef`) it will measure the next move against. There is no delta to report yet — a
    // scrub step is the distance between two moves, not between a move and the press.
    fireEvent.pointerMove(pad, { clientX: 0, clientY: -10, pointerId: 1 })
    fireEvent.pointerMove(pad, { clientX: 0, clientY: -20, pointerId: 1 })
    fireEvent.pointerMove(pad, { clientX: 0, clientY: -30, pointerId: 1 })
    fireEvent.pointerUp(pad, { clientX: 0, clientY: -30, pointerId: 1 })

    expect(calls.filter((c) => c.startsWith('scrub')).length).toBeGreaterThanOrEqual(2)
    expect(calls[calls.length - 1]).toBe('commit')
    expect(calls).not.toContain('tap')
    expect(calls).not.toContain('doubleTap')
  })

  it('the scrub axis is reported, so a section can tell vertical from horizontal', () => {
    // Chart mode scrubs the symbol vertically and the bar position horizontally off the SAME
    // gesture, so an axis that always read 'x' would silently drive the wrong one.
    const calls = []
    render(<EngineHarness config={makeSection(calls)} settings={{ holdMs: HOLD_MS, doubleTapMs: DOUBLE_TAP_MS }} />)
    vi.useFakeTimers()
    const pad = screen.getByTestId('pad')

    fireEvent.pointerDown(pad, { clientX: 0, clientY: 0, pointerId: 1 })
    act(() => { vi.advanceTimersByTime(HOLD_MS + 20) })
    fireEvent.pointerMove(pad, { clientX: 25, clientY: 0, pointerId: 1 })  // arms the scrub
    fireEvent.pointerMove(pad, { clientX: 50, clientY: 0, pointerId: 1 })  // first reported step
    fireEvent.pointerUp(pad, { clientX: 50, clientY: 0, pointerId: 1 })

    expect(calls).toContain('scrub:x')
  })

  it('the first move after a hold ARMS the scrub and reports no step', () => {
    // Pinned deliberately: a section that assumed "one move = one step" would double-count the
    // first step of every scrub, and on the Journal that is a stop one cent away from the one the
    // member saw on the chip.
    const calls = []
    render(<EngineHarness config={makeSection(calls)} settings={{ holdMs: HOLD_MS, doubleTapMs: DOUBLE_TAP_MS }} />)
    vi.useFakeTimers()
    const pad = screen.getByTestId('pad')

    fireEvent.pointerDown(pad, { clientX: 0, clientY: 0, pointerId: 1 })
    act(() => { vi.advanceTimersByTime(HOLD_MS + 20) })
    fireEvent.pointerMove(pad, { clientX: 0, clientY: -10, pointerId: 1 })

    expect(calls.filter((c) => c.startsWith('scrub'))).toEqual([])
  })

  it('CONTROL: a release with no movement commits NOTHING', () => {
    // Proves the commit above is caused by the scrub and not fired on every release — otherwise
    // the order assertion would pass for the wrong reason.
    const calls = []
    render(<EngineHarness config={makeSection(calls)} settings={{ holdMs: HOLD_MS, doubleTapMs: DOUBLE_TAP_MS }} />)
    vi.useFakeTimers()
    const pad = screen.getByTestId('pad')

    fireEvent.pointerDown(pad, { clientX: 0, clientY: 0, pointerId: 1 })
    act(() => { vi.advanceTimersByTime(HOLD_MS + 20) })
    fireEvent.pointerUp(pad, { clientX: 0, clientY: 0, pointerId: 1 })
    act(() => { vi.advanceTimersByTime(DOUBLE_TAP_MS * 2) })

    expect(calls).not.toContain('commit')
    expect(calls.filter((c) => c.startsWith('scrub'))).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('⛔ the contract argument lists are DERIVED from the mounted call sites', () => {
  // The R-05 rail. A typedef and a test harness can agree with each other and both be wrong
  // about the product — that is exactly what happened here, and `validateSectionConfig` cannot
  // catch it because arity is not a shape. So this reads HubRoot and asserts the contract
  // matches, rather than restating either.
  const hubRoot = readFileSync(path.join(HERE, 'HubRoot.jsx'), 'utf8')
  const contracts = readFileSync(path.join(HERE, 'contracts.js'), 'utf8')

  it('CONTROL: the call sites are present in HubRoot', () => {
    expect(hubRoot).toMatch(/onScrub\?\.\(/)
    expect(hubRoot).toMatch(/onScrubCommit\?\.\(/)
  })

  it('HubRoot calls onScrub with (ctx, scrub) and the typedef says so', () => {
    expect(hubRoot, 'HubRoot no longer passes ctx first').toMatch(/onScrub\?\.\(\s*ctx\s*,/)
    // Line-scoped rather than one big regex: the type itself contains braces
    // (`{delta, axis}`), so a `[^}]*` span stops inside it and can never reach `[onScrub]`.
    const onScrubLine = contracts.split(/\r?\n/).find((l) => l.includes('[onScrub]'))
    expect(onScrubLine, 'no [onScrub] property found in contracts.js').toBeTruthy()
    expect(onScrubLine, 'the HubSectionConfig typedef disagrees with HubRoot')
      .toContain('(ctx: object, scrub:')
  })

  it('HubRoot calls onScrubCommit with (ctx) and the typedef says so', () => {
    expect(hubRoot).toMatch(/onScrubCommit\?\.\(\s*ctx\s*\)/)
    expect(contracts).toMatch(/@property \{\(ctx: object\) => void\}\s*\[onScrubCommit\]/)
  })

  it('⛔ HubRoot renders the section readout — it is not hard-coded null', () => {
    // R-06: `scrubReadout={null}` made every section's readout() dead code while the contract
    // required one, so the product contradicted its own stated rule.
    expect(hubRoot, 'scrubReadout is hard-coded null again — every readout() is dead')
      .not.toMatch(/scrubReadout=\{null\}/)
    expect(hubRoot).toMatch(/scrubReadout=\{scrubReadout\}/)
  })
})
