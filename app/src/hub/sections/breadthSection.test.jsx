/**
 * Phase 3 §3.2 — the Breadth section, driven through the REAL page.
 *
 * ⛔ WHY THIS MOUNTS `Breadth` INSTEAD OF A STAND-IN.
 * Phase 2 shipped a hub whose every prop was wrong while both unit suites stayed green, because
 * each half tested its own idea of the seam and neither tested the join (`contracts.js` header).
 * A harness that renders its own tab strip would reproduce that exactly: `resolveBreadthTabs`
 * could be perfect and `Breadth.jsx` could still render a hard-coded list, and this file would
 * not notice. So the page is mounted with the same shell mocks `breadthUrlRoute.test.jsx` uses,
 * the config is taken from the REAL `HubProvider` registration, and every user-visible outcome
 * is read off the REAL tab strip's DOM — never off state (CLAUDE.md, "Assert user-facing
 * feedback by RENDERED TEXT, never by state").
 *
 * The load-bearing test is `the scrub sweeps exactly the resolved list`: it is the one that
 * fails if anything walks `BREADTH_TAB_ITEMS` instead of `resolveBreadthTabs(isAdmin)`.
 */
import { describe, it as vitestIt, expect, beforeEach, afterAll, vi } from 'vitest'
import { render, screen, within, act, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ⛔ RAIL (house convention — mirrors useJoystick.test.js / hubWiring.test.jsx): `vitest -t` is a
// REGEX, and a filter matching nothing exits 0 and reads as a PASS. These counters catch a `-t`
// typo or a stray `.only`/`.skip` that would otherwise report a partial run as a full one.
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

// ── The page's outside world, stubbed at the door (same shell as breadthUrlRoute.test.jsx).
// The tab strip and the hub registration are the things under test; the tab CONTENTS are not.
const role = vi.hoisted(() => ({ current: 'user' }))
vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))
vi.mock('../../pages/CotData', () => ({ default: () => <div data-testid="tab-cot" /> }))
vi.mock('../../pages/BreadthCharts', () => ({ default: () => <div data-testid="tab-charts" /> }))
vi.mock('../../pages/breadth/DailyOverview', () => ({ default: () => <div data-testid="tab-daily" /> }))
vi.mock('../../pages/breadth/BreadthViews', () => ({ default: () => <div data-testid="tab-views" /> }))
vi.mock('../../components/tiles/MarketBreadth', () => ({ default: () => <div /> }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { role: role.current } }) }))
vi.mock('../../hooks/useFlagged', () => ({
  useFlagged: () => ({
    flagged: [], toggle: () => {}, remove: () => {}, isFlagged: () => false,
    isShared: false, toggleShare: () => {}, flaggedName: 'Flagged', renameFlagged: () => {},
  }),
}))
vi.mock('../../hooks/useLiveBreadth', () => ({
  useLiveBreadth: () => ({ row: null, stamp: null, superseded: true }),
  formatLiveClock: () => 'now',
}))

const ROWS = Array.from({ length: 40 }, (_, i) => {
  const day = new Date(Date.UTC(2026, 7, 28) - i * 86400000)
  return {
    date: day.toISOString().slice(0, 10),
    breadth_score: 70 - (i % 9), uct_exposure: 60, pct_above_50sma: 55 - i,
    pct_above_200sma: 50, pct_above_5sma: 40, pct_above_10sma: 45, pct_above_20ema: 50,
    pct_above_40sma: 52, pct_above_100sma: 55,
    up_4pct_today: 200, down_4pct_today: 90, new_52w_highs: 30, new_52w_lows: 8,
    mcclellan_osc: 10, vix: 16, sp500_close: 5000 + i, advancing: 3000, declining: 1500,
  }
})
vi.mock('swr', () => ({
  default: () => ({ data: { rows: ROWS, days: 90 }, isLoading: false, error: null, mutate: () => {} }),
  useSWRConfig: () => ({ mutate: () => {} }),
}))

import Breadth from '../../pages/Breadth'
import { HubProvider, useHub } from '../HubContext'
import { validateSectionConfig } from '../contracts'
import { fanFor, modesById } from '../registry'
import {
  BREADTH_TAB_ITEMS, resolveBreadthTabs, createBreadthSection,
} from './breadthSection'

// ⛔ CONTEXT FIRST. `HubRoot.jsx` calls `onScrub(ctx, scrub)` — `contractArity.test.js` derives
// that from the call site. Every scrub below is driven the way the mounted caller drives it.
const CTX = { mode: 'breadth', symbol: null, navigate: () => {} }

// ── harness ────────────────────────────────────────────────────────────────
let registered = null
function ConfigProbe() {
  registered = useHub().activeModeConfig
  return null
}

/** The config the page ACTUALLY registered with the provider — re-read after every render. */
const cfg = () => {
  if (!registered) throw new Error('no hub config registered — the page never called useHubMode')
  return registered
}

function openBreadth({ admin = false } = {}) {
  role.current = admin ? 'admin' : 'user'
  return render(
    <MemoryRouter initialEntries={['/breadth']}>
      <HubProvider>
        <Breadth />
        <ConfigProbe />
      </HubProvider>
    </MemoryRouter>,
  )
}

/** The real strip: the element that owns the Monitor button. Never a stand-in. */
const strip = () => within(screen.getByRole('button', { name: 'Monitor' }).parentElement)

/** The active tab READ OFF THE DOM — the label the member can see is highlighted. */
const activeTabLabel = () => strip()
  .getAllByRole('button')
  .find((b) => /tabActive/.test(b.className))
  ?.textContent

const tabLabels = () => strip().getAllByRole('button').map((b) => b.textContent)

// ⚠️ ONE `act()` PER GESTURE, never a loop inside one. React batches inside an `act` block, so
// n taps in a single one would all read the SAME pre-render config and land exactly one step —
// a green "clamped" for entirely the wrong reason. A real tap is a separate gesture with a
// render between, and the harness has to be the same shape as the thing it models.
const tap = (n = 1) => { for (let i = 0; i < n; i += 1) act(() => { cfg().onTap() }) }
const doubleTap = (n = 1) => { for (let i = 0; i < n; i += 1) act(() => { cfg().onDoubleTap() }) }

beforeEach(() => { registered = null; role.current = 'user'; localStorage.clear() })

// ─────────────────────────────────────────────────────────────────────────────
describe('the resolved list — the admin tab is the whole reason this module exists', () => {
  it('⛔ the admin-only tab is PRESENT for an admin and ABSENT for a member, on the real strip', () => {
    // Rendered DOM, not the constant: the member's strip must not carry an Analogues button at
    // all, and the admin's must — otherwise "resolved" is a word rather than a behaviour.
    openBreadth({ admin: false })
    expect(tabLabels()).toEqual(['Monitor', 'Views', 'Daily', 'COT Data', 'Data Charts'])
    expect(strip().queryByRole('button', { name: 'Analogues' })).toBeNull()

    cleanup()
    openBreadth({ admin: true })
    expect(tabLabels()).toEqual(['Monitor', 'Views', 'Daily', 'COT Data', 'Data Charts', 'Analogues'])
    expect(strip().getByRole('button', { name: 'Analogues' })).toBeTruthy()
  })

  it('resolveBreadthTabs is the one authority — the constant is the BASE, never the list', () => {
    expect(resolveBreadthTabs(false)).toBe(BREADTH_TAB_ITEMS)
    expect(resolveBreadthTabs(true)).toHaveLength(BREADTH_TAB_ITEMS.length + 1)
    expect(resolveBreadthTabs(true).at(-1)).toEqual({ key: 'analogues', label: 'Analogues' })
    // CONTROL: the two lengths actually differ, so every "matches the resolved list" assertion
    // below is capable of failing.
    expect(resolveBreadthTabs(true).length).not.toBe(resolveBreadthTabs(false).length)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('tap and double-tap walk the strip and CLAMP', () => {
  it('tap advances one tab at a time, in strip order', () => {
    openBreadth()
    expect(activeTabLabel()).toBe('Monitor')
    tap(); expect(activeTabLabel()).toBe('Views')
    tap(); expect(activeTabLabel()).toBe('Daily')
    tap(); expect(activeTabLabel()).toBe('COT Data')
    tap(); expect(activeTabLabel()).toBe('Data Charts')
  })

  it('⛔ tap CLAMPS at the last tab and never wraps back to the first', () => {
    // A wrap would send a member who tapped once too often back to the top of the page they were
    // walking away from — indistinguishable, on a phone, from the gesture having done nothing.
    openBreadth()
    tap(10)
    expect(activeTabLabel()).toBe('Data Charts')
  })

  it('⛔ double-tap retreats and CLAMPS at the first tab, never wrapping to the last', () => {
    openBreadth()
    tap(3)
    expect(activeTabLabel()).toBe('COT Data')
    doubleTap(); expect(activeTabLabel()).toBe('Daily')
    doubleTap(10)
    expect(activeTabLabel()).toBe('Monitor')
  })

  it('⛔ an admin can tap ONTO the admin-only tab; a member stops one short of it', () => {
    // The same ten taps, the same code, two lists. This is the asymmetry the resolved list
    // exists to produce — and the one a `BREADTH_TAB_ITEMS` reading would erase.
    openBreadth({ admin: true })
    tap(10)
    expect(activeTabLabel()).toBe('Analogues')

    cleanup()
    openBreadth({ admin: false })
    tap(10)
    expect(activeTabLabel()).toBe('Data Charts')
  })

  it('the tab CONTENT follows, not just the highlight', () => {
    // The strip's class is a hint; what the member came for is the panel underneath it.
    openBreadth()
    tap(3)
    expect(screen.getByTestId('tab-cot')).toBeTruthy()
    tap()
    expect(screen.getByTestId('tab-charts')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('the scrub — the range IS the resolved list', () => {
  /** One drag, `steps` equal moves, collecting what the chip narrates at each step. */
  const sweepLabels = (steps = 20) => {
    const seen = [cfg().readout()]
    for (let i = 0; i < steps; i += 1) {
      act(() => { cfg().onScrub(CTX, { delta: 1 / steps, axis: 'x' }) })
      seen.push(cfg().readout())
    }
    return seen.filter((label, i) => i === 0 || label !== seen[i - 1])
  }

  it('⛔ a full-travel drag sweeps EXACTLY the member’s five tabs, in order', () => {
    openBreadth({ admin: false })
    expect(sweepLabels()).toEqual(resolveBreadthTabs(false).map((t) => t.label))
  })

  it('⛔ the same drag sweeps the admin’s SIX, ending on the admin-only tab', () => {
    // Same gesture, same code path, one more tab — because the divisor is `resolved.length - 1`.
    // Read the range off `BREADTH_TAB_ITEMS` instead and this drag stops on Data Charts and the
    // last fifth of the pad's travel does nothing at all.
    openBreadth({ admin: true })
    const labels = sweepLabels()
    expect(labels).toEqual(resolveBreadthTabs(true).map((t) => t.label))
    expect(labels.at(-1)).toBe('Analogues')
  })

  it('releasing commits the swept tab — asserted on the rendered strip', () => {
    openBreadth({ admin: true })
    sweepLabels()
    act(() => { cfg().onScrubCommit() })
    expect(activeTabLabel()).toBe('Analogues')
  })

  it('a drag PAST the end clamps instead of wrapping', () => {
    openBreadth({ admin: false })
    act(() => {
      cfg().onScrub(CTX, { delta: 5, axis: 'x' })   // five pad-travels to the right
      cfg().onScrubCommit()
    })
    expect(activeTabLabel()).toBe('Data Charts')
  })

  it('a drag back past the start clamps on the first tab', () => {
    openBreadth({ admin: false })
    tap(4)
    expect(activeTabLabel()).toBe('Data Charts')
    act(() => {
      cfg().onScrub(CTX, { delta: -5, axis: 'x' })
      cfg().onScrubCommit()
    })
    expect(activeTabLabel()).toBe('Monitor')
  })

  it('⛔ the VERTICAL axis is ignored — the tab scrub is horizontal (plan §3.2)', () => {
    // The engine reports the dominant axis of each individual move, so a sideways drag under an
    // unsteady thumb still emits 'y'. Counting those would make the gesture drift.
    openBreadth({ admin: false })
    act(() => {
      cfg().onScrub(CTX, { delta: 1, axis: 'y' })
      cfg().onScrubCommit()
    })
    expect(activeTabLabel()).toBe('Monitor')
  })

  it('CONTROL: a hold-and-release that never moved commits nothing', () => {
    // Without this the clamp tests above could pass for the wrong reason — a commit that always
    // fires would still land on a plausible tab.
    openBreadth({ admin: false })
    tap(2)
    act(() => { cfg().onScrubCommit() })
    expect(activeTabLabel()).toBe('Daily')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('readout — the chip narrates the resolved tab, by label', () => {
  it('returns the ACTIVE tab’s label when nothing is being dragged', () => {
    openBreadth()
    expect(cfg().readout()).toBe('Monitor')
    tap(2)
    expect(cfg().readout()).toBe('Daily')
  })

  it('⛔ narrates the LABEL, never the key — `overview` is displayed as "Daily"', () => {
    // The key leaks the schema at the member; the strip says Daily and so must the chip.
    openBreadth()
    tap(2)
    expect(activeTabLabel()).toBe('Daily')
    expect(cfg().readout()).toBe('Daily')
    expect(cfg().readout()).not.toBe('overview')
  })

  it('is a valid ChipReadout for every tab of both lists', () => {
    for (const isAdmin of [false, true]) {
      for (const tab of resolveBreadthTabs(isAdmin)) {
        expect(typeof tab.label).toBe('string')
        expect(tab.label.length).toBeGreaterThan(0)
      }
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('the contract', () => {
  it('⛔ the registered config passes validateSectionConfig', () => {
    // `registerHubMode` already runs this at the mounted boundary and THROWS in dev, so a bad
    // config would have failed every test above — calling it here names the reason directly.
    openBreadth()
    expect(() => validateSectionConfig(cfg(), 'breadthSection')).not.toThrow()
  })

  it('supplies readout() beside onScrub, and onScrub beside onScrubCommit', () => {
    openBreadth()
    const c = cfg()
    expect(typeof c.onScrub).toBe('function')
    expect(typeof c.readout).toBe('function')
    expect(typeof c.onScrubCommit).toBe('function')
  })

  it('⛔ carries the registry fan through — a config without one white-screens the page', () => {
    // A page registration REPLACES the route default (`HubContext`: pageModeConfig ?? modesById),
    // and `fanFor` does `mode.fan.filter(...)` unguarded. This is the assertion that catches a
    // future refactor building the config from scratch.
    openBreadth()
    expect(() => fanFor(cfg())).not.toThrow()
    expect(fanFor(cfg())).toEqual(fanFor(modesById.breadth))
    expect(cfg().id).toBe('breadth')
  })

  /**
   * ⚰️ R-05 IS CLOSED, AND THIS TEST IS WHERE ITS SHIM DIED.
   *
   * This used to read `⛔ onScrub reads BOTH mounted call shapes — (scrub) and (ctx, scrub)`, and
   * beside it sat a unit test for `scrubPayloadOf`, the normaliser that made both land. Both were
   * correct for as long as `contracts.js` said `onScrub(scrub)` while `HubRoot.jsx` called
   * `onScrub(ctx, scrub)`. The Director settled that on `(ctx, scrub)` and `contractArity.test.js`
   * now DERIVES the shape from the call site, so the disagreement cannot come back unnoticed.
   *
   * ⭐ A test that accepts BOTH shapes is the thing that lets the wrong one survive. Breadth was
   * the last section still accepting both; wire, screener and journal closed theirs when the
   * ruling landed. So the assertion is inverted: the one-argument form must now do NOTHING.
   */
  it('⛔ a one-ARGUMENT call is inert — the section reads the second argument only', () => {
    let key = 'breadth'
    const config = createBreadthSection({
      tabs: resolveBreadthTabs(false),
      activeTab: key,
      setActiveTab: (k) => { key = k },
      scrubRef: { current: null },
    })
    // With the shim, this moved the cursor a full travel and committed 'charts'.
    config.onScrub({ delta: 1, axis: 'x' })
    config.onScrubCommit()
    expect(key, 'a one-argument onScrub still moved the tab — the payload-sniffing shim is back, '
      + 'or something re-introduced a rest parameter').toBe('breadth')
  })

  it('CONTROL: the two-argument form DOES move it, so the test above is not vacuous', () => {
    // Without this, deleting the whole handler would satisfy the inert assertion perfectly.
    let key = 'breadth'
    const config = createBreadthSection({
      tabs: resolveBreadthTabs(false),
      activeTab: key,
      setActiveTab: (k) => { key = k },
      scrubRef: { current: null },
    })
    config.onScrub(CTX, { delta: 1, axis: 'x' })
    config.onScrubCommit()
    expect(key, 'the mounted call shape does not move the tab either — the scrub is dead, not '
      + 'merely strict').toBe('charts')
  })

  it('⛔ a NON-FINITE delta is refused, and does not poison the held position', () => {
    // ⚰️ THIS COVERAGE CAME OUT WITH THE SHIM AND HAD TO BE PUT BACK DELIBERATELY.
    // `scrubPayloadOf` tested `Number.isFinite(a.delta)` as part of IDENTIFYING which argument
    // was the payload, so deleting the shim silently deleted a GUARD as well as a normaliser —
    // the two jobs were tangled in one function and only one of them was obsolete.
    //
    // Untreated, NaN reaches `clamp(pos + NaN)` -> NaN -> `Math.round(NaN)` -> `tabs[NaN]` ->
    // undefined, which the commit reads as "a hold that never moved". The gesture dies quietly
    // rather than clamping, and scrubRef is left holding a NaN the next move compounds.
    const scrubRef = { current: null }
    let key = 'breadth'
    const config = createBreadthSection({
      tabs: resolveBreadthTabs(false),
      activeTab: key,
      setActiveTab: (k) => { key = k },
      scrubRef,
    })
    config.onScrub(CTX, { delta: Number.NaN, axis: 'x' })
    expect(scrubRef.current, 'a NaN delta was written into the held scrub position').toBeNull()

    // A real move afterwards must still work — the refusal rejects the input, not the gesture.
    config.onScrub(CTX, { delta: 1, axis: 'x' })
    config.onScrubCommit()
    expect(key, 'the section stopped responding after refusing one bad delta').toBe('charts')
  })
})
