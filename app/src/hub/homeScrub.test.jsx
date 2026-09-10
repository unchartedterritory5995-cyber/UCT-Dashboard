// Joystick hub — Phase 3 §3.8(a): Home's scrub. See docs/plans/joystick/60-phase3-plan.md:330-331
// ("Phase 3 adds the scrub (recent sections)") and §8a of the master spec
// (00-master-spec-v1.6.md:535-550, the `ctx.navigate` seam this feature could not exist without).
//
// ─────────────────────────────────────────────────────────────────────────────
// ⛔ WHAT EACH LAYER HERE FAILS FOR, BECAUSE THEY ARE NOT INTERCHANGEABLE
// ─────────────────────────────────────────────────────────────────────────────
//   1  the LIST      — pure derivation. Fails when "recent" stops meaning MRU-of-one over the
//                      registry's declared section order.
//   2  lastSection   — real execution through localStorage -> HubContext -> the controller. Fails
//                      when this file stops being `lastSection`'s reader, which is the whole point:
//                      it had ZERO readers for its entire life before §3.8a.
//   3  the GESTURE   — real execution through HubRoot + useJoystick + the real HubChip. Fails when
//                      the chip stops narrating, when the commit stops navigating, or when the two
//                      stop agreeing about where the member is going.
//   4  the MOUNT     — Layout.jsx actually renders the controller. A controller nobody mounts is
//                      the "built, tested, green and unreachable" defect this repo keeps paying for;
//                      `reachable.test.js` catches the import edge, this catches the render site.
//
// ⛔ THE CHIP IS ASSERTED BY RENDERED TEXT, never by state. Owner ruling, 2026-09-09
// (CLAUDE.md, "Assert user-facing feedback by RENDERED TEXT"): two joystick toasts shipped with
// every structural assertion green and the only broken part was the half that talks to the member.
// So `HubChip` is deliberately NOT mocked in this file, unlike homeFanCalendar.test.jsx.
//
// ⛔ NO SECOND COPY OF THE NAVIGATION-AUTHORITY RULE. `navigationAuthority.test.jsx` already owns
// "no second navigation path under app/src/hub/**" and walks this file's product module on every
// run. Restating it here would be a guard repeated and therefore a guard unproved.
//
// ⛔ RAIL (house convention — mirrors homeFanCalendar.test.jsx / hubWiring.test.jsx):
// `vitest -t <regex>` is a regex filter, and a filter matching nothing exits 0 and reads as a PASS.
import { describe, it as vitestIt, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { forwardRef, useEffect } from 'react'
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

// ── Leaf mocks — the same set homeFanCalendar.test.jsx uses, MINUS HubChip ───
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
vi.mock('./HubScrim', () => ({ default: () => null }))
vi.mock('./HubActionsButton', () => ({ default: () => null }))

/** Every capability HubRoot's own `useHubActive()` checks, forced ON. */
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

/** The storage key HubContext owns. Named here so a rename there fails loudly rather than making
 *  every "lastSection" assertion below quietly test the null branch. */
const LAST_SECTION_KEY = 'hub.lastSection'

// ═════════════════════════════════════════════════════════════════════════════
// 1 — what "recent" resolves to
// ═════════════════════════════════════════════════════════════════════════════
describe('§3.8a — the recent-section list', () => {
  it('CONTROL: the declared order IS the registry\'s route-backed sections, home excluded', async () => {
    const { DECLARED_SECTION_ORDER } = await import('./sections/homeSection')
    const { modes, HOME_MODE_ID } = await import('./registry')

    // NON-VACUITY (rule 14): a broken derivation returns [] and every membership assertion below
    // is trivially satisfied. Name members that MUST be there rather than counting.
    expect(DECLARED_SECTION_ORDER, 'the derivation came back without the sections that plainly '
      + 'exist — every assertion below would be vacuous')
      .toEqual(expect.arrayContaining(['wire', 'scan', 'journal', 'flow']))

    // Derived control, not a hand-typed twin: the same answer computed from `modes` directly.
    const fromRegistry = modes.filter((m) => m.route).map((m) => m.id)
      .filter((id) => id !== HOME_MODE_ID)
    expect(DECLARED_SECTION_ORDER).toEqual(fromRegistry)

    // `home` is the destination, never a destination in its own list; `catalysts` declares no
    // route at all (Wave 0: an in-place dashboard tile), so it cannot be navigated to.
    expect(DECLARED_SECTION_ORDER).not.toContain(HOME_MODE_ID)
    expect(DECLARED_SECTION_ORDER).not.toContain('catalysts')
  })

  it('lastSection is promoted to the front, and everything after it keeps registry order', async () => {
    const { recentSections, DECLARED_SECTION_ORDER } = await import('./sections/homeSection')

    const items = recentSections('journal')
    expect(items[0], '"recent" is MRU-of-one: the stored section leads').toBe('journal')
    expect(items.slice(1), 'the tail is registry order with the promoted id removed — not a reshuffle')
      .toEqual(DECLARED_SECTION_ORDER.filter((id) => id !== 'journal'))
    expect(items.length, 'promotion must move an entry, never duplicate or drop one')
      .toBe(DECLARED_SECTION_ORDER.length)
  })

  it('nothing stored ⇒ pure registry order, with nothing substituted (spec §C3:915)', async () => {
    const { recentSections, DECLARED_SECTION_ORDER } = await import('./sections/homeSection')

    // 00-master-spec-v1.6.md:915 — "**On a first-ever visit with nothing stored, Primary is inert**
    // — disabled, no navigation. Defaulting it to Wire was rejected: Primary and Reverse would fire
    // the same destination on a new account, which reads as a bug rather than a design."
    // The list obeys the same rule: no recency, so nothing is promoted and nothing stands in.
    for (const empty of [null, undefined, '']) {
      expect(recentSections(empty)).toEqual(DECLARED_SECTION_ORDER)
    }
  })

  it('a stored id that is no longer a section is ignored, not prepended', async () => {
    const { recentSections, DECLARED_SECTION_ORDER } = await import('./sections/homeSection')
    // `catalysts` is a real mode with no route — exactly the shape of a value that could sit in
    // storage from an older build. Prepending it would put a destination at the head of the list
    // that `resolveNavTarget` can only pass through as a literal path.
    expect(recentSections('catalysts')).toEqual(DECLARED_SECTION_ORDER)
    expect(recentSections('a-mode-that-never-existed')).toEqual(DECLARED_SECTION_ORDER)
  })

  it('the cursor listId is DERIVED from the registry, never typed', async () => {
    const { LIST_ID } = await import('./sections/homeSection')
    const { modesById } = await import('./registry')
    expect(modesById.home.cursor, 'the home mode declares no cursor — LIST_ID fell back to the '
      + 'mode id and the derivation below proves nothing').toBeDefined()
    expect(LIST_ID).toBe(modesById.home.cursor.listId)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 2 — lastSection finally has a reader (real execution, not a pure function)
// ═════════════════════════════════════════════════════════════════════════════
describe('§3.8a — lastSection is read', () => {
  beforeEach(async () => {
    const { _reset } = await import('./useHubCursor')
    _reset()
    localStorage.clear()
  })

  async function renderProbe(route = '/dashboard') {
    const { default: useHomeSection } = await import('./sections/homeSection')
    const { HubProvider } = await import('./HubContext')
    function HomeProbe() {
      const { items, index, destination, onRoute } = useHomeSection()
      return (
        <>
          <div data-testid="items">{items.join(',')}</div>
          <div data-testid="cursor">{`${index}/${items.length}`}</div>
          <div data-testid="destination">{String(destination)}</div>
          <div data-testid="onRoute">{String(onRoute)}</div>
        </>
      )
    }
    return render(
      <MemoryRouter initialEntries={[route]}>
        <HubProvider><HomeProbe /></HubProvider>
      </MemoryRouter>,
    )
  }

  it('a stored hub.lastSection leads the list — the value\'s FIRST consumer', async () => {
    localStorage.setItem(LAST_SECTION_KEY, 'journal')
    await renderProbe()
    expect(screen.getByTestId('items').textContent.split(',')[0]).toBe('journal')
    expect(screen.getByTestId('destination').textContent,
      'the cursor starts on the most recent section').toBe('journal')
  })

  it('CONTROL: with storage empty the SAME render leads with the registry\'s first section', async () => {
    const { DECLARED_SECTION_ORDER } = await import('./sections/homeSection')
    await renderProbe()
    // Without this the test above passes for a controller that always returns registry order and
    // never reads storage at all — 'journal' would just happen to be in the list.
    expect(screen.getByTestId('items').textContent.split(',')[0]).toBe(DECLARED_SECTION_ORDER[0])
    expect(DECLARED_SECTION_ORDER[0]).not.toBe('journal')
  })

  it('off /dashboard the controller registers nothing — it never overrides another section', async () => {
    await renderProbe('/screener')
    expect(screen.getByTestId('onRoute').textContent).toBe('false')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 3 — the gesture, end to end: chip narrates, release navigates
// ═════════════════════════════════════════════════════════════════════════════
describe('§3.8a — the scrub on /dashboard', () => {
  beforeEach(async () => {
    const { _reset } = await import('./useHubCursor')
    _reset()
    localStorage.clear()
    localStorage.setItem(LAST_SECTION_KEY, 'journal')
    mockPrefs = { joystick_hub: JSON.stringify({ enabled: true }) }
    stubHubCapable()
  })
  afterEach(() => {
    vi.useRealTimers()
    unstubHubCapable()
    localStorage.clear()
  })

  async function renderHub(route = '/dashboard') {
    const { default: HubRoot } = await import('./HubRoot')
    const { default: HomeHubSection } = await import('./sections/HomeHubSection')
    const { HubProvider } = await import('./HubContext')
    return render(
      <MemoryRouter initialEntries={[route]}>
        <HubProvider>
          {/* The same two siblings Layout.jsx mounts, in the same order. */}
          <HomeHubSection />
          <HubRoot />
          <LocationProbe />
        </HubProvider>
      </MemoryRouter>,
    )
  }

  /**
   * Hold, then drag in SEVERAL steps until the cursor is on `targetIndex`, finger still down.
   *
   * ⛔ THE DISTANCE IS DERIVED FROM THE ENGINE'S OWN CONSTANTS, not a magic pixel count.
   * `useJoystick.js:306` emits `raw / travelPx` per move and `useHubCursor.scrubTo` reads the
   * accumulated total as an absolute 0..1 position, so the pixels needed depend on TRAVEL_PX and
   * on the list length. Typing "7" here would silently stop selecting what it names the day either
   * moves.
   *
   * ⛔⛔ AND IT MUST BE SEVERAL STEPS, NOT ONE. A single-move drag makes an ACCUMULATING scrub and
   * a scrub that hands `scrub.delta` straight to `scrubTo` produce the identical index — this
   * helper's own first version did exactly that, and the mutation proof for the accumulator came
   * back GREEN against product code carrying the defect `wireSection.js:222-236` records paying
   * for. A fixture that cannot distinguish is not a rail.
   */
  const SCRUB_STEPS = 4

  async function scrubToward(pad, targetIndex, count) {
    const { TRAVEL_PX, HOLD_MS } = await import('./constants')
    const dy = (targetIndex / (count - 1)) * TRAVEL_PX

    vi.useFakeTimers()                       // engaged AFTER the tree mounted on real timers
    fireEvent.pointerDown(pad, { clientX: 0, clientY: 0, pointerId: 1 })
    act(() => { vi.advanceTimersByTime(HOLD_MS + 20) })   // a hold, so the drag is a SCRUB (§C1)
    // The first move after the hold only ENTERS the scrub phase (it seeds `lastRef` and returns);
    // every move after that emits one step.
    fireEvent.pointerMove(pad, { clientX: 0, clientY: 0, pointerId: 1 })
    for (let step = 1; step <= SCRUB_STEPS; step += 1) {
      fireEvent.pointerMove(pad, { clientX: 0, clientY: (dy * step) / SCRUB_STEPS, pointerId: 1 })
    }
    return dy
  }

  it('the chip NARRATES the destination while the thumb is down, and release goes there', async () => {
    const { recentSections } = await import('./sections/homeSection')
    const { modesById } = await import('./registry')

    const items = recentSections('journal')
    const TARGET = 2
    // Named member, not a bare index: if the promotion or the declared order moves, this fails
    // HERE rather than silently asserting a different section's label below.
    expect(items[TARGET], `recent list was ${items.join(', ')}`).toBe('breadth')

    await renderHub()
    expect(screen.getByTestId('loc').textContent).toBe('/dashboard')

    const pad = screen.getByTestId('mock-hub-pad')
    await scrubToward(pad, TARGET, items.length)

    // ⛔ RENDERED TEXT, mid-gesture. This is the only surface that tells the member where release
    // will take them — nothing on /dashboard moves as the cursor travels.
    expect(screen.getByText('Go to Breadth'),
      'the chip is not naming the destination — the scrub is invisible to the member').toBeTruthy()

    fireEvent.pointerUp(pad, { clientX: 0, clientY: (TARGET / (items.length - 1)) * 24, pointerId: 1 })

    expect(screen.getByTestId('loc').textContent,
      'release did not navigate — the chip named a destination the gesture never reached').toBe('/breadth')
    expect(modesById.breadth.route, 'the route the registry declares for the mode the chip named')
      .toBe('/breadth')
  })

  it('a longer drag lands on a DIFFERENT section — the destination follows the thumb', async () => {
    const { recentSections } = await import('./sections/homeSection')
    const items = recentSections('journal')
    const last = items[items.length - 1]
    expect(last, `recent list was ${items.join(', ')}`).toBe('flow')

    await renderHub()
    const pad = screen.getByTestId('mock-hub-pad')
    // Well past the end of travel: `scrubTo` clamps at 1, so this lands on the last entry.
    await scrubToward(pad, (items.length - 1) * 4, items.length)

    expect(screen.getByText('Go to Flow')).toBeTruthy()
    fireEvent.pointerUp(pad, { clientX: 0, clientY: 400, pointerId: 1 })
    expect(screen.getByTestId('loc').textContent).toBe('/options-flow')
  })

  it('CONTROL: mounting the controller navigates nowhere — only the gesture does', async () => {
    await renderHub()
    // Without this, a controller that navigated on mount (or on every render) would satisfy both
    // tests above for entirely the wrong reason.
    expect(screen.getByTestId('loc').textContent).toBe('/dashboard')
    expect(screen.queryByText(/^Go to /), 'the chip is narrating a scrub nobody started').toBeNull()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 3b — the accumulator: a scrub is a STREAM of steps, seeded from where it starts
// ═════════════════════════════════════════════════════════════════════════════
//
// ⛔ THESE DRIVE THE REGISTERED CONFIG DIRECTLY, and that is deliberate rather than lazy. The two
// behaviours below need many steps at chosen magnitudes and a commit that does NOT navigate away
// (a real navigation unmounts the controller, so a second gesture can never be observed). Both are
// exercised through the REAL registration seam — the config under test is whatever
// `HubContext.activeModeConfig` hands the gesture engine, not a hand-built object.
describe('§3.8a — the scrub accumulates, and resumes where the last one landed', () => {
  beforeEach(async () => {
    const { _reset } = await import('./useHubCursor')
    _reset()
    localStorage.clear()
    localStorage.setItem(LAST_SECTION_KEY, 'journal')
  })
  afterEach(() => localStorage.clear())

  /** The live registered config, re-read after every act() — the same object HubRoot calls. */
  async function renderRegistered() {
    const { default: HomeHubSection } = await import('./sections/HomeHubSection')
    const { HubProvider, useHub } = await import('./HubContext')
    const seen = { config: null }
    function ConfigProbe() {
      // Captured in an effect, not during render: `react-hooks/immutability` rejects the render-time
      // write, and an effect is what the rule itself points at. RTL flushes effects inside every
      // `act()`, so `seen.config` is the LATEST registered config at each assertion below.
      const { activeModeConfig } = useHub()
      useEffect(() => { seen.config = activeModeConfig }, [activeModeConfig])
      return null
    }
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <HubProvider><HomeHubSection /><ConfigProbe /></HubProvider>
      </MemoryRouter>,
    )
    // NON-VACUITY: without this the assertions below could be running against the registry's own
    // `home` entry, which declares no onScrub at all and would make every call a silent no-op.
    expect(typeof seen.config?.onScrub,
      'the controller never registered — activeModeConfig is still the registry default')
      .toBe('function')
    expect(seen.config.label, 'the spread is gone: the chip would render an unlabelled mode')
      .toBe('Home')
    return seen
  }

  it('two steps land where their SUM points, not where the last one does', async () => {
    const seen = await renderRegistered()
    const ctx = { navigate: vi.fn() }

    act(() => {
      seen.config.onScrub(ctx, { delta: 0.15, axis: 'y' })
      seen.config.onScrub(ctx, { delta: 0.15, axis: 'y' })
    })

    // list is [journal, wire, breadth, scan, chart, notebook, calendar, flow] (8 entries).
    // accumulated 0.30 -> round(0.30 x 7) = 2 -> breadth.  A non-accumulating scrub would read the
    // last step alone, 0.15 -> round(1.05) = 1 -> wire.
    expect(seen.config.readout(),
      'the steps did not accumulate — `scrub.delta` is being read as an absolute position')
      .toBe('Go to Breadth')
  })

  it('a second gesture resumes from where the first landed, not from the top', async () => {
    const seen = await renderRegistered()
    const ctx = { navigate: vi.fn() }

    act(() => { seen.config.onScrub(ctx, { delta: 0.60, axis: 'y' }) })
    expect(seen.config.readout()).toBe('Go to Chart')          // round(0.60 x 7) = 4

    act(() => { seen.config.onScrubCommit(ctx) })
    expect(ctx.navigate, 'the commit navigates to the mode id, never a hand-typed path')
      .toHaveBeenCalledWith('chart')

    // Second gesture, a small step. Seeded from the landed index (4/7 = 0.571) it reaches
    // round(0.671 x 7) = 5 -> notebook. Seeded from zero it would read round(0.10 x 7) = 1 -> wire,
    // sending a member who had already moved the cursor back to the top of the list.
    act(() => { seen.config.onScrub(ctx, { delta: 0.10, axis: 'y' }) })
    expect(seen.config.readout(),
      'the accumulator restarted at 0 — a member who had moved the cursor is thrown back to the top')
      .toBe('Go to Notebook')
  })

  it('a ctx with no navigate is REPORTED, not silently ignored', async () => {
    const { HubContractError } = await import('./contracts')
    const seen = await renderRegistered()

    act(() => { seen.config.onScrub({ navigate: vi.fn() }, { delta: 0.30, axis: 'y' }) })
    // contracts.js:442 exists for exactly this: a mode handed a ctx without `navigate` does not
    // throw on its own, it just does NOTHING on release — present-and-inert by omission.
    expect(() => seen.config.onScrubCommit({ mode: 'home' })).toThrow(HubContractError)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 4 — the controller is actually mounted
// ═════════════════════════════════════════════════════════════════════════════
describe('§3.8a — Layout mounts Home\'s controller', () => {
  // Comments stripped so a MENTION in prose can never read as a mount — the same reason
  // `contractArity.test.js` strips before matching (its own first version matched a sentence).
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('Layout.jsx imports HomeHubSection AND renders it', () => {
    const src = strip(fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/Layout.jsx'), 'utf8',
    ))

    // NON-VACUITY: prove the file was read and the probes can find a mount that indisputably
    // exists, before reading anything into a match on ours.
    expect(src.length, 'Layout.jsx read back empty').toBeGreaterThan(1000)
    expect(src).toMatch(/import\s+NotebookHubSection\s+from\s+'\.\.\/hub\/sections\/NotebookHubSection'/)
    expect(src).toMatch(/<NotebookHubSection\s*\/>/)

    expect(src, 'HomeHubSection is not imported by Layout.jsx — homeSection.js is reachable from '
      + 'no route').toMatch(/import\s+HomeHubSection\s+from\s+'\.\.\/hub\/sections\/HomeHubSection'/)
    expect(src, 'HomeHubSection is imported but never RENDERED. An import edge satisfies '
      + 'reachable.test.js while the controller registers nothing and the scrub does nothing.')
      .toMatch(/<HomeHubSection\s*\/>/)
  })
})
