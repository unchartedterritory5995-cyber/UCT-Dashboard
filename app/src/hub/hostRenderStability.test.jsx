// ⛔⛔ EVERY HOST THAT REGISTERS A HUB MODE MUST SETTLE. THIS IS THE RAIL NOBODY WROTE.
//
// ── WHAT IT COST TO NOT HAVE THIS ──────────────────────────────────────────────────────────────
// On 2026-09-10 the Catalysts controller keyed its config memo on the object `useHubCursor`
// returned — a fresh literal every render. `useHubMode` re-registered every render, the registrar
// lived on the SAME context the registration writes to, and the registrant re-rendered: a passive
// -effect loop at ~4,500 renders/second, which React never throws "Maximum update depth" for.
// React Router's navigation transition never got to commit. **Clicking any nav entry on
// /dashboard changed the URL and left the screen where it was, app-wide, for about four and a
// half hours**, and only a hard refresh recovered.
//
// `hubRegistrarLoop.test.jsx` (shipped with the fix) proves the MECHANISM is now safe: a config
// that changes identity every render settles, because `useHubMode` reads a separate
// `HubRegistrarContext` whose value never changes. That is the class fix and it holds.
//
// ⭐ THIS FILE IS THE OTHER HALF: the mechanism being safe is not the same as every HOST being
// well behaved. A per-render config is now *wasteful* rather than fatal — and "wasteful" on a
// tile that re-derives a cursor, a fan and a readout on every commit is exactly the kind of cost
// that goes unnoticed until it meets a second leg and becomes fatal again. So every host is
// measured, by name, and the list is DERIVED so tomorrow's host cannot opt out by being new.
//
// ⚠️ A NOTE ON WHY THIS IS A CENSUS AND NOT A SPOT CHECK. The instance that froze navigation was
// found by a member, not by a suite, and the hazard class had been named in a report the same
// evening and filed as a curiosity. A rail that checks the one host we already know about would
// have caught nothing.
import { describe, it as vitestIt, expect, afterEach, afterAll } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { HubProvider, useHub } from './HubContext'
import { _reset as resetCursors } from './useHubCursor'

// ⛔ `vitest -t` is a REGEX; a filter matching nothing exits 0 and reads as a PASS.
let defined = 0
let executed = 0
function it(name, fn) {
  defined += 1
  return vitestIt(name, (...a) => { executed += 1; return fn(...a) })
}
// ⛔ `.each` HAS TO BE ATTACHED TO THE WRAPPER, not inherited. Shadowing vitest's `it` to count
// executions silently removes `it.each`, and the first run of this file died with
// "it.each is not a function" rather than reporting a host — a harness that cannot enumerate is
// indistinguishable from a population that is clean.
it.each = (rows) => (name, fn) => {
  defined += rows.length
  return vitestIt.each(rows)(name, (...a) => { executed += 1; return fn(...a) })
}
afterAll(() => {
  expect(executed).toBeGreaterThan(0)
  expect(executed).toBe(defined)
})
afterEach(() => { cleanup(); resetCursors() })

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..')
const stripComments = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

/** Every file under app/src that CALLS `useHubMode(` — derived, never typed. */
function hostFilesFromSource(dir = SRC, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { hostFilesFromSource(p, out); continue }
    if (!/\.(js|jsx)$/.test(e.name) || /\.(test|spec)\./.test(e.name)) continue
    if (path.relative(SRC, p).replace(/\\/g, '/') === 'hub/useHubMode.js') continue
    if (/useHubMode\s*\(/.test(stripComments(readFileSync(p, 'utf8')))) {
      out.push(path.relative(SRC, p).replace(/\\/g, '/'))
    }
  }
  return out
}
const DERIVED_HOSTS = hostFilesFromSource().sort()

// ── the fixtures ──────────────────────────────────────────────────────────────────────────────
// Frozen props, created ONCE at module scope. A fixture that manufactures a new object per render
// would be testing the fixture, not the host — and would fail every host for the same reason.
const REF = Object.freeze({ current: null })
const EMPTY = Object.freeze([])
const NOOP = () => {}

/** file -> a factory returning [hook, stableProps]. Hand-written, and reconciled against
 *  DERIVED_HOSTS below so a new host must be added here before this file will pass. */
const FIXTURES = {
  'hub/sections/breadthSection.js': async () => [
    (await import('./sections/breadthSection')).default,
    Object.freeze({ isAdmin: false, activeTab: 'overview', setActiveTab: NOOP }),
  ],
  'hub/sections/calendarSection.js': async () => [
    (await import('./sections/calendarSection')).default,
    Object.freeze({
      weekDates: EMPTY, days: Object.freeze({}), activeDay: null,
      onDayTab: NOOP, macroOn: false, onToggleMacro: NOOP,
    }),
  ],
  'hub/sections/catalystsSection.js': async () => [
    (await import('./sections/catalystsSection')).default,
    Object.freeze({ rows: EMPTY, enabled: true, rootRef: REF, toggleFlag: NOOP, isFlagged: NOOP, createNote: NOOP }),
  ],
  'hub/sections/chartSection.js': async () => [
    (await import('./sections/chartSection')).default,
    Object.freeze({ tf: 'D', symbol: 'AAA', customTfs: EMPTY, onTf: NOOP, onDraw: NOOP }),
  ],
  'hub/sections/homeSection.js': async () => [
    (await import('./sections/homeSection')).default, undefined,
  ],
  'hub/sections/journalSection.js': async () => [
    (await import('./sections/journalSection')).default,
    Object.freeze({ positions: EMPTY, optionStrategies: EMPTY, view: 'list', settings: null }),
  ],
  'hub/sections/notebookSection.js': async () => [
    (await import('./sections/notebookSection')).default, undefined,
  ],
  'hub/sections/screenerSection.js': async () => [
    (await import('./sections/screenerSection')).default,
    Object.freeze({ displayRows: EMPTY, filters: Object.freeze({}), prices: Object.freeze({}) }),
  ],
  'hub/sections/wireSection.js': async () => [
    async () => {
      const useWire = (await import('./sections/wireSection')).default
      const useHubMode = (await import('./useHubMode')).default
      return (props) => useHubMode(useWire(props))
    },
    Object.freeze({ rootRef: REF, wireDate: '2026-09-10', html: '' }),
  ],
  'pages/MorningWire.jsx': async () => [
    // ⭐ MorningWire calls `useHubMode(useWireSection({...}))` INLINE. Mounting the page needs the
    // whole wire payload; the composition it performs is what matters here, so it is exercised
    // through `wireSection.js` above and this entry asserts the SHAPE of the call site instead.
    null, null,
  ],
}

/** Counts renders of the host, and every DISTINCT config identity the provider published. */
function makeHarness(hook, props) {
  const renders = { n: 0 }
  const configs = { seen: [] }

  function Probe() {
    const { activeModeConfig } = useHub()
    if (!configs.seen.includes(activeModeConfig)) configs.seen.push(activeModeConfig)
    return null
  }
  function Host() {
    renders.n += 1
    hook(props)
    return null
  }
  function Shell() { return (<><Host /><Probe /></>) }
  return { renders, configs, Shell }
}

async function measure(file, commits = 6) {
  const make = FIXTURES[file]
  const [hookRaw, props] = await make()
  const hook = typeof hookRaw === 'function' && hookRaw.constructor.name === 'AsyncFunction'
    ? await hookRaw() : hookRaw
  const { renders, configs, Shell } = makeHarness(hook, props)
  let bump
  function Root() {
    const [tick, setTick] = useState(0)
    bump = () => setTick((t) => t + 1)
    return <div data-tick={tick}><Shell /></div>
  }
  render(<MemoryRouter initialEntries={['/dashboard']}><HubProvider><Root /></HubProvider></MemoryRouter>)
  for (let i = 0; i < commits; i += 1) act(() => { bump() })
  return { renders: renders.n, distinctConfigs: configs.seen.length, commits }
}

/** ⭐ `wireSection.js` is NOT itself a host — `MorningWire.jsx` is, and it calls
 *  `useHubMode(useWireSection(...))` inline. The fixture above composes exactly that pair so the
 *  behaviour is measured rather than asserted from source, and this set records the stand-in so
 *  the stale-fixture check below does not read it as an exemption that stopped describing
 *  anything. ⛔ It is named, not filtered by a pattern: a pattern would also swallow a fixture
 *  that really had gone stale. */
const COMPOSED_STANDINS = Object.freeze({
  'hub/sections/wireSection.js': 'pages/MorningWire.jsx',
})

const BEHAVIOURAL = Object.keys(FIXTURES).filter((f) => f !== 'pages/MorningWire.jsx')

describe('the host census is derived, so a new host cannot opt out by being new', () => {
  it('CONTROL: the sweep really walked app/src and found the known hosts', () => {
    expect(DERIVED_HOSTS.length, 'the source sweep found no useHubMode callers — the walk is '
      + 'broken and every assertion below is vacuous').toBeGreaterThan(5)
    expect(DERIVED_HOSTS).toContain('hub/sections/catalystsSection.js')
    expect(DERIVED_HOSTS).toContain('pages/MorningWire.jsx')
  })

  it('⛔⛔ every derived host has a fixture here', () => {
    const missing = DERIVED_HOSTS.filter((f) => !(f in FIXTURES))
    expect(missing, 'A new host registers a hub mode and has no render-stability fixture in this '
      + 'file. That is how the navigation freeze shipped: the hazard was a class, and the only '
      + 'host anybody measured was the one already known to be broken. Add a fixture with STABLE '
      + 'frozen props — do not delete the host from the census.').toEqual([])
  })

  it('⛔ every composed stand-in still stands in for a REAL host', () => {
    for (const [standin, host] of Object.entries(COMPOSED_STANDINS)) {
      expect(DERIVED_HOSTS, `${standin} is exercised on behalf of ${host}, which no longer calls `
        + 'useHubMode — the stand-in is now measuring nothing').toContain(host)
    }
  })

  it('⛔ and no fixture describes a host that no longer exists', () => {
    const stale = Object.keys(FIXTURES)
      .filter((f) => !DERIVED_HOSTS.includes(f) && !(f in COMPOSED_STANDINS))
    expect(stale, 'a fixture names a file that no longer calls useHubMode — remove it rather than '
      + 'leaving an exemption that has stopped describing anything').toEqual([])
  })
})

describe('⛔⛔ every host SETTLES under stable inputs', () => {
  it.each(BEHAVIOURAL)('%s renders a bounded number of times', async (file) => {
    const { renders, commits } = await measure(file)
    // A loop produces thousands. A healthy host renders once per commit it is given, plus the
    // mount — the bound is deliberately generous so this fails on RUNAWAY, not on a legitimate
    // extra pass from an effect.
    expect(renders, `${file} re-rendered ${renders} times across ${commits} commits. That is the `
      + 'navigation-freeze signature: a registration that re-renders its own registrant. Check '
      + 'what this host passes to useHubMode — it must be a memo whose deps are all stable.')
      .toBeLessThanOrEqual((commits + 1) * 3)
  })

  it.each(BEHAVIOURAL)('%s publishes at most one config per distinct identity', async (file) => {
    const { distinctConfigs, commits } = await measure(file)
    // `activeModeConfig` starts null and becomes the host's config. With stable inputs that is
    // TWO distinct values for the whole life of the mount, however many commits happen.
    expect(distinctConfigs, `${file} published ${distinctConfigs} distinct configs across `
      + `${commits} commits with UNCHANGED inputs. Each one is a setPageModeConfig that changed `
      + 'the hub context for every consumer. With the registrar decoupled this is waste rather '
      + 'than a freeze — but it is the same defect one leg short.')
      .toBeLessThanOrEqual(3)
  })
})

describe('the inline call site is checked too', () => {
  it('⛔ MorningWire composes useHubMode(useWireSection(...)) — the config comes from a hook', () => {
    // It cannot be memoized at the call site because it IS a hook call. That is legal precisely
    // because `wireSection` owns the memo, which the behavioural case above measures. Asserted
    // here so a future edit that inlines a literal object is visible.
    const src = stripComments(readFileSync(path.join(SRC, 'pages/MorningWire.jsx'), 'utf8'))
    expect(src, 'MorningWire no longer composes useHubMode over useWireSection — re-check where '
      + 'its config identity comes from').toMatch(/useHubMode\(\s*useWireSection\(/)
    expect(src, 'MorningWire now passes an object LITERAL to useHubMode. A literal is a new '
      + 'identity every render; the memo must live in the section hook.')
      .not.toMatch(/useHubMode\(\s*\{/)
  })
})
