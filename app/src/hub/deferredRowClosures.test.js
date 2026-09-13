/**
 * ⛔⛔ THE STOPS THAT CLOSE FIVE `deferred.md` ROWS — checked, not asserted in prose.
 *
 * Increment 7's exit condition is BACKLOG ZERO: every row ends SHIPPED, CLOSED-BY-SPEC or
 * CLOSED-BLOCKED. A row closed on a quoted stop is a perfectly good outcome — but a stop recorded
 * only in a commit message is a claim about the product that can quietly stop being true, and the
 * person who makes it true will not be the person who remembers the row.
 *
 * ⭐ SO EVERY RED HERE IS AN INVITATION, NOT A PROHIBITION. Nothing in this file says a row must
 * stay closed. Each case says "this is the measured reason it is closed today"; when one goes red,
 * the stop is gone and the row is worth re-opening. That is the same shape
 * `runActionsHaveHandlers.test.js` uses for its borrowed-time list.
 *
 * ⚠️ SOURCE-TEXT CASES READ THE REAL FILE AND STRIP COMMENTS FIRST. `contractArity.test.js` shipped
 * a first version that matched PROSE describing a call and reported it as runtime truth; this repo
 * has paid for that once and does not need to again.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { renderHook, act } from '@testing-library/react'

import { resolveBreadthTabs, BREADTH_TAB_ITEMS } from './sections/breadthSection'
import useBreadthCustomize, { DEFAULT_PRESET } from '../pages/breadth/useBreadthCustomize'

/** Repo root by walking up for `app/src` — the shape `writePathsTransitive.test.js` uses, and it
 *  throws by name rather than silently resolving to the wrong tree. */
function repoRoot() {
  let d = process.cwd()
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(d, 'app', 'src', 'hub'))) return d
    const up = path.dirname(d)
    if (up === d) break
    d = up
  }
  throw new Error(`could not locate the repo root by walking up from ${process.cwd()}`)
}
const ROOT = repoRoot()
const readRepo = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[^\n'"`]*\/\/[^\n]*/gm, (m) => m.replace(/\/\/.*$/, ''))

describe('the derivation reads the real files — non-vacuity', () => {
  // Every case below is "this file still contains / no longer contains X". A read that returned an
  // empty string would satisfy half of them, so the fixtures are proved to be real first.
  const FIXTURES = [
    'app/src/pages/calendar/CalendarHeader.jsx',
    'app/src/pages/calendar/filterLogic.js',
    'app/src/pages/screener/shell/ScannerShell.jsx',
    'app/src/pages/Calendar.jsx',
    'app/src/styles/tokens.css',
    'api/routers/breadth_monitor.py',
  ]
  it.each(FIXTURES)('%s is present and non-trivial', (rel) => {
    expect(readRepo(rel).length, `${rel} read as (nearly) empty — every case over it is vacuous`)
      .toBeGreaterThan(500)
  })
})

describe('D-21 (econ-only view) — CLOSED: the page LOCKS the earnings event type', () => {
  it('⛔ the earnings chip cannot be turned off — `CalendarHeader.jsx`', () => {
    // `const locked = type === 'earnings'; if (locked) return` — an econ-only view means earnings
    // OFF, and this is the one-way valve that makes that unreachable. Same stop that DELETED
    // `calendar.earnings` from the registry rather than shipping it inert.
    const src = stripComments(readRepo('app/src/pages/calendar/CalendarHeader.jsx'))
    expect(src, 'the earnings lock is gone — an econ-only view may now be buildable; re-open D-21')
      .toMatch(/const\s+locked\s*=\s*type\s*===\s*'earnings'/)
    expect(src).toMatch(/DEFAULT_EVENT_TYPES\s*=\s*new\s+Set\(\['earnings'\]\)/)
  })

  it('⛔ and `filterLogic.js` — the file the row names — has no notion of an event TYPE at all', () => {
    // D-21's "smallest enabling change" says "a filter-logic change in filterLogic.js". Measured,
    // that module filters earnings ROWS (audience, market cap, volume, price, confirmed-only,
    // sector, search). Event types are a Set held in `Calendar.jsx` and read by the VIEWS. The row
    // names the wrong file, which is why it could not be costed from the row alone.
    const src = stripComments(readRepo('app/src/pages/calendar/filterLogic.js'))
    expect(src, 'filterLogic.js now knows about event types — re-cost D-21 against it')
      .not.toMatch(/eventType|DEFAULT_EVENT_TYPES|\bmacro\b/)
  })
})

describe('D-20 (Add to Notebook from a calendar entry) — CLOSED-BLOCKED: no reachable entry', () => {
  it('⛔ the calendar hands the hub NO per-entry symbol', () => {
    // Every `requires: ['symbol']` action reads `ctx.symbol`, which only a page's own
    // `useHub().setSymbol` fills — the Screener and the Journal each do. The calendar never does,
    // and its hub cursor walks DAYS (`weekDates`), not entries. So a calendar Note bubble would
    // render permanently DISABLED: the exact measured reason R-17 removed `notebook.linkTicker`.
    const src = stripComments(readRepo('app/src/pages/Calendar.jsx'))
    expect(src, 'Calendar.jsx now sets the hub symbol — a per-entry Note may be buildable; re-open D-20')
      .not.toMatch(/useHub\(\)[\s\S]{0,80}setSymbol|setSymbol\s*\(/)
    expect(src, 'the calendar no longer mounts the day-scoped hub section — re-derive D-20')
      .toMatch(/useCalendarHubSection/)
  })

  it('⛔ and the one surface that DOES name an entry outranks the hub on z — it buries it', () => {
    // The only per-entry selection on `/calendar` is `EarningsResearchModal`
    // (`Calendar.jsx`'s `selected`), at `--z-modal`. The hub's own ladder tops out at
    // `--z-hub-open`. So while an entry is selected the hub is underneath it and unreachable, and
    // whenever the hub IS reachable no entry is selected. Both halves must change together.
    const tokens = stripComments(readRepo('app/src/styles/tokens.css'))
    const num = (name) => {
      const m = new RegExp(`${name}:\\s*(\\d+)`).exec(tokens)
      expect(m, `${name} is gone from tokens.css — re-derive the z ladder before trusting D-20`).toBeTruthy()
      return Number(m[1])
    }
    const modal = num('--z-modal')
    const hubOpen = num('--z-hub-open')
    expect(modal, 'the hub now outranks the modal — a selected calendar entry may be reachable from '
      + 'the fan; re-open D-20').toBeGreaterThan(hubOpen)
    expect(stripComments(readRepo('app/src/components/research/EarningsResearchModal.module.css')),
      'the entry modal no longer rides --z-modal — re-measure which surface wins')
      .toMatch(/z-index:\s*var\(--z-modal/)
  })
})

describe('D-09 (phone sort) — CLOSED: the props are absent AND the control is undecided', () => {
  it('⛔ the phone branch is passed no sort/onSort while the desktop branch is passed both', () => {
    // The asymmetry the row cites, derived rather than quoted by line number (those move). Passing
    // the props is one line; what the row actually defers is the SECOND half of its own sentence —
    // "then decide what control renders them" — which is a Screener product decision, and the spec
    // records the state it leaves behind: "Sort is deferred — the phone has no sort UI at all".
    const src = stripComments(readRepo('app/src/pages/screener/shell/ScannerShell.jsx'))
    const block = (tag) => {
      const i = src.indexOf(`<${tag}`)
      expect(i, `${tag} is no longer rendered by ScannerShell — re-derive D-09`).toBeGreaterThan(-1)
      return src.slice(i, src.indexOf('/>', i))
    }
    expect(block('VirtualResults'), 'the DESKTOP branch lost its sort props — this rail is measuring '
      + 'the wrong thing now').toMatch(/onSort=/)
    expect(block('ResultCards'), 'the phone card list is now passed onSort — a phone sort control '
      + 'may exist; re-open D-09').not.toMatch(/onSort=/)
  })
})

describe('D-06 (metric-group cycling) — CLOSED-BLOCKED: the named mechanism is inert on Default', () => {
  it('⛔⛔ `customize.hidden` CANNOT BE WRITTEN on the default preset — measured, not read', () => {
    // D-06's smallest enabling change is "reuse the existing reachable `customize.hidden` set as a
    // group filter". Measured behaviourally: on the shipped default preset every writer in that
    // hook is a no-op (`useBreadthCustomize.js`: "if (prev.activePreset === DEFAULT_PRESET) return
    // prev  // immutable"). A hub bubble built on it would answer a deliberate gesture with silence
    // for every member who has never made a preset — which is precisely why `breadth.sizeRule` and
    // `breadth.snapshot` were REMOVED from this very mode's fan rather than shipped inert.
    //
    // ⛔⛔ THE STOP IS DOUBLED, AND ITS MUTATION PROOF IS WHAT REVEALED THAT. Removing the WRITER's
    // guard (`setHiddenSet`'s `if (prev.activePreset === DEFAULT_PRESET) return prev`) left this
    // case GREEN; so did removing the READER's (`hidden`'s `if (isDefaultActive) return new Set()`).
    // Only removing BOTH turns it red. That is `lesson_a_guard_repeated_is_a_guard_unproved` in the
    // product rather than in a rail — and it is why this case asserts the OUTCOME a member would
    // see instead of the presence of either guard. For D-06 it makes the close STRONGER: two
    // independent mechanisms would have to change before that write reaches a preset.
    const { result } = renderHook(() => useBreadthCustomize())
    expect(result.current.activePreset, 'the shipped default is no longer the immutable preset — '
      + 're-cost D-06').toBe(DEFAULT_PRESET)

    const someGroupFilter = BREADTH_TAB_ITEMS.map((t) => t.key)   // any non-empty key list will do
    act(() => { result.current.setHiddenSet(someGroupFilter) })
    expect(result.current.hidden.size, 'setHiddenSet now writes on the default preset — D-06\'s '
      + 'mechanism is live and the row is worth re-opening').toBe(0)

    act(() => { result.current.toggleHidden('breadth_score') })
    expect(result.current.hidden.size, 'toggleHidden now writes on the default preset — re-open D-06')
      .toBe(0)
  })

  it('⛔ and on a NON-default preset the same write is destructive: it replaces the member\'s set', () => {
    // The other half of the stop, and the reason "just create a preset first" is not a fix. The
    // hidden set is persisted (localStorage `uct.breadth.customize.v1`) and there is no restore —
    // a group cycle would overwrite a saved customization from a gesture, permanently.
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => { result.current.savePreset('D-06 probe', ['breadth_score']) })
    expect(result.current.hidden.has('breadth_score')).toBe(true)

    act(() => { result.current.setHiddenSet(['vix']) })
    expect(result.current.hidden.has('breadth_score'),
      'the member\'s own hidden key survived a group write — the destructive half of D-06\'s stop is '
      + 'gone and the row can be re-costed').toBe(false)
    act(() => { result.current.deletePreset('D-06 probe') })
  })
})

describe('D-08 (compare prior cycle) — OWNER RULING: the gate is one client-side list', () => {
  it('⛔ Analogues is admin-only in the TAB LIST, and nowhere else', () => {
    // This case exists to keep the owner's decision cheap to make: it pins that the admin-only-ness
    // is a single client-side append, so "a member-visible surface" costs one list move plus the
    // non-admin bounce in `Breadth.jsx` — not a backend change.
    expect(resolveBreadthTabs(false).map((t) => t.key),
      'Analogues is no longer admin-gated in the tab list — D-08 may already be answered')
      .not.toContain('analogues')
    expect(resolveBreadthTabs(true).map((t) => t.key)).toContain('analogues')
  })

  it('⛔⛔ the DATA is paid-gated, NOT admin-gated — so no backend work is in the price', () => {
    // The decisive fact for the ruling. `/api/breadth-monitor/analogues` depends on `require_paid`.
    // Every paid member's session can already fetch it; only the client declines to show it. So the
    // question in front of the owner is purely "should members see a forward-return narrative",
    // never "what would it cost to build".
    const router = stripComments(readRepo('api/routers/breadth_monitor.py'))
    const i = router.indexOf('/api/breadth-monitor/analogues')
    expect(i, 'the analogues endpoint moved — re-derive D-08\'s cost').toBeGreaterThan(-1)
    const decl = router.slice(i, i + 400)
    expect(decl, 'the analogues endpoint is no longer paid-gated — re-cost D-08')
      .toMatch(/Depends\(require_paid\)/)
    expect(decl, 'if this ever gains an admin dependency, the cost of D-08 changes entirely')
      .not.toMatch(/require_admin|role.*admin/)
  })
})
