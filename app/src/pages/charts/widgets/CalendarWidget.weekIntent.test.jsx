// app/src/pages/charts/widgets/CalendarWidget.weekIntent.test.jsx
//
// TWO week intents, ONE anchor.
//
// `/calendar` opens on the current-or-UPCOMING week (`currentWeekMonday` — the
// backend's authoritative rule, which rolls a weekend forward). This widget
// opens on the week of the MOST RECENT session (`lastSessionWeekMonday`, which
// rolls a weekend back) because it renders one day at a time in a small pane and
// the upcoming week has no data yet on a Saturday.
//
// Both are defensible. What was the defect — the thing commit b700a874 removed
// four copies of in one file — is a SECOND AUTHORITY over one value: two
// hand-rolled Monday calculations that happen to differ. So this file proves
// three separate things:
//
//   1. the two intents AGREE Mon–Fri and differ by EXACTLY one week Sat/Sun,
//      asserted at pinned instants — that gap is now declared, not accidental;
//   2. the widget really does show a week with sessions in it on a weekend
//      (its entire reason for having the other intent), driven through the
//      REAL component and its REAL request URL;
//   3. the widget contains NO independent Monday derivation — traced by AST +
//      import graph from each intent back to a `weekAnchor` import, never a
//      grep — with positive controls proving each rail can actually find one.
//
// ⚠️ CLOCK DISCIPLINE. Every pinned test goes through `pinET()`, which asserts
// `Date.now()`, `new Date()` and the ET-zoned read all report the SAME instant
// before the test body runs. Faking one clock source and not another is how a
// pinned test manufactures a pass; here it aborts instead.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { SWRConfig } from 'swr'
import { Parser } from 'acorn'
import acornJsx from 'acorn-jsx'
import { WorkspaceContext } from '../WorkspaceContext'
import CalendarWidget from './CalendarWidget'
import {
  currentWeekMonday, lastSessionWeekMonday, lastSessionDay, mondayOf,
} from '../../calendar/weekAnchor'

vi.mock('../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: vi.fn() }),
  parsePref: () => null,
}))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => ({ name: null }) }))
vi.mock('../../../components/CompanyLogo', () => ({ default: () => <span data-testid="logo" /> }))
vi.mock('../../../components/ui/UIcon', () => ({ default: ({ name }) => <span data-icon={name} /> }))
vi.mock('./NewsSettingsPanel', () => ({ default: () => <div data-testid="cal-settings" /> }))

// ── The week under the microscope: Mon 2026-08-03 … Sun 2026-08-09 ───────────
// Same literals as weekAnchor.test.js and the live measurement in
// .superpowers/sdd/audit/fix-cal-report.md, so a failure here reads against the
// same dates the defect was measured on.
const MON = '2026-08-03'
const TUE = '2026-08-04'
const WED = '2026-08-05'
const THU = '2026-08-06'
const FRI = '2026-08-07'
const SAT = '2026-08-08'
const SUN = '2026-08-09'
const NEXT_MON = '2026-08-10'

const WEEKDAYS = [MON, TUE, WED, THU, FRI]
const WEEKEND = [SAT, SUN]
const EIGHT_DAYS = [...WEEKDAYS, ...WEEKEND, NEXT_MON]

const DAY_MS = 86400000
function weeksApart(isoA, isoB) {
  return (Date.parse(`${isoB}T00:00:00Z`) - Date.parse(`${isoA}T00:00:00Z`)) / (7 * DAY_MS)
}

// An ET wall-clock instant as a UTC instant. August 2026 is EDT (UTC−4); the
// offset is written into the parsed string rather than added to the hour, so a
// late-evening time rolls the DATE correctly. (Adding 4 to 23 silently produced
// "T27:59", which `pinET`'s guard caught — which is the point of the guard.)
const ET_OFFSET = '-04:00'
function etInstant(isoDay, hh, mm) {
  const ms = Date.parse(`${isoDay}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00${ET_OFFSET}`)
  return new Date(ms).toISOString()
}

/**
 * Pin every clock source COHERENTLY, and prove it.
 *
 * `expectedEtDay` is what an ET-zoned read of the frozen clock must return —
 * i.e. exactly what `CalendarWidget`'s own `todayET()` will see. If the pin did
 * not take, or took for `Date.now()` but not `new Date()`, these abort the test
 * rather than letting it pass on a live clock.
 */
function pinET(utcIso, expectedEtDay) {
  const ms = Date.parse(utcIso)
  expect(Number.isFinite(ms)).toBe(true)
  vi.setSystemTime(new Date(ms))
  expect(Date.now()).toBe(ms)                                     // source 1
  expect(new Date().getTime()).toBe(ms)                           // source 2 — the ~15:1 trap
  expect(new Date(Date.now()).toISOString()).toBe(new Date().toISOString())
  // source 3 — the zoned read the widget actually performs.
  expect(new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }))
    .toBe(expectedEtDay)
  return expectedEtDay
}

// `pool: 'forks'` reuses a worker across files, so a leaked zone would corrupt
// every later file in this fork. Restored in a `finally` AND here.
const ENV = globalThis.process.env       // via globalThis: `process` is not an eslint global here
const _REAL_TZ = ENV.TZ

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  if (_REAL_TZ === undefined) delete ENV.TZ
  else ENV.TZ = _REAL_TZ
})

// ─────────────────────────────────────────────────────────────────────────────
// 1. The two intents, side by side
// ─────────────────────────────────────────────────────────────────────────────
describe('the two week intents are one anchor asked two questions', () => {
  it('agree on every weekday', () => {
    for (const d of WEEKDAYS) {
      expect(lastSessionWeekMonday(d)).toBe(currentWeekMonday(d))
      expect(lastSessionWeekMonday(d)).toBe(MON)
    }
  })

  it('differ by EXACTLY one week on Saturday and Sunday', () => {
    for (const d of WEEKEND) {
      expect(lastSessionWeekMonday(d)).toBe(MON)
      expect(currentWeekMonday(d)).toBe(NEXT_MON)
      // Not merely "different" — one week, in the widget's direction (behind).
      expect(weeksApart(lastSessionWeekMonday(d), currentWeekMonday(d))).toBe(1)
    }
  })

  it('neither intent has collapsed into a constant', () => {
    // Every assertion above is satisfiable by a function that returns one fixed
    // string. Over eight days each rule must produce exactly the two weeks.
    expect([...new Set(EIGHT_DAYS.map(lastSessionWeekMonday))].sort()).toEqual([MON, NEXT_MON])
    expect([...new Set(EIGHT_DAYS.map(currentWeekMonday))].sort()).toEqual([MON, NEXT_MON])
    // …and they are not the SAME function under two names: over those eight
    // days they disagree on exactly the two weekend days.
    const disagree = EIGHT_DAYS.filter(d => lastSessionWeekMonday(d) !== currentWeekMonday(d))
    expect(disagree).toEqual(WEEKEND)
  })

  it('lastSessionDay is the identity on a weekday and Friday from a weekend', () => {
    for (const d of WEEKDAYS) expect(lastSessionDay(d)).toBe(d)
    for (const d of WEEKEND) expect(lastSessionDay(d)).toBe(FRI)
  })

  it('is composed from the anchor, not restated: week === mondayOf(lastSession)', () => {
    for (const d of EIGHT_DAYS) expect(lastSessionWeekMonday(d)).toBe(mondayOf(lastSessionDay(d)))
  })

  it('answers the same in a UTC+9 browser as in a UTC−5 one', () => {
    // The other axis b700a874 closed: `toISOString()` on a local-midnight Date
    // is the UTC day, one day early for every browser east of UTC. These two
    // functions inherit `localIso` + noon anchoring from their siblings, so they
    // must be zone-independent. The control below asserts the pin actually TOOK
    // — without it this passes without exercising anything.
    const here = EIGHT_DAYS.map(d => `${lastSessionDay(d)}|${lastSessionWeekMonday(d)}`)
    const prev = ENV.TZ
    try {
      ENV.TZ = 'Asia/Tokyo'
      expect(new Date('2026-08-10T00:00:00').toISOString().slice(0, 10)).toBe('2026-08-09')
      expect(EIGHT_DAYS.map(d => `${lastSessionDay(d)}|${lastSessionWeekMonday(d)}`)).toEqual(here)
    } finally {
      if (prev === undefined) delete ENV.TZ
      else ENV.TZ = prev
    }
    expect(here).toContain(`${FRI}|${MON}`)     // …and `here` was not an empty/degenerate list
  })

  it('returns null on a calendar-invalid day instead of crashing the render', () => {
    expect(lastSessionDay('2026-13-05')).toBeNull()
    expect(lastSessionWeekMonday('2026-13-05')).toBeNull()
    expect(lastSessionWeekMonday('nonsense')).toBeNull()
  })

  it('survives both US DST transitions (noon-anchored date math)', () => {
    // Both transitions fall on a SUNDAY, so both land on the rolling branch —
    // the one that MOVES days. A midnight-anchored implementation lands on the
    // wrong calendar day here; noon anchoring is what makes these hold.
    expect(lastSessionDay('2026-03-07')).toBe('2026-03-06')          // Sat, −1 into spring-forward week
    expect(lastSessionDay('2026-03-08')).toBe('2026-03-06')          // Sun, −2 spanning the transition
    expect(lastSessionWeekMonday('2026-03-08')).toBe('2026-03-02')
    expect(currentWeekMonday('2026-03-08')).toBe('2026-03-09')       // the other intent, one week on
    expect(lastSessionDay('2026-10-31')).toBe('2026-10-30')          // Sat, −1 into fall-back week
    expect(lastSessionDay('2026-11-01')).toBe('2026-10-30')          // Sun, −2 spanning the transition
    expect(lastSessionWeekMonday('2026-11-01')).toBe('2026-10-26')
    expect(currentWeekMonday('2026-11-01')).toBe('2026-11-02')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. The same comparison, at PINNED INSTANTS on a real clock
// ─────────────────────────────────────────────────────────────────────────────
describe('the two intents, read off a pinned clock at several instants', () => {
  const INSTANTS = [
    [etInstant(MON, 9, 31), MON, 'agree'],
    [etInstant(WED, 16, 5), WED, 'agree'],
    [etInstant(FRI, 23, 59), FRI, 'agree'],
    [etInstant(SAT, 0, 0), SAT, 'differ'],
    [etInstant(SAT, 12, 0), SAT, 'differ'],
    [etInstant(SUN, 23, 59), SUN, 'differ'],
    [etInstant(NEXT_MON, 0, 0), NEXT_MON, 'agree'],
  ]

  for (const [utc, etDay, verdict] of INSTANTS) {
    it(`${utc} (ET ${etDay}) → the intents ${verdict}`, () => {
      const today = pinET(utc, etDay)
      const widget = lastSessionWeekMonday(today)
      const page = currentWeekMonday(today)
      if (verdict === 'agree') {
        expect(widget).toBe(page)
      } else {
        expect(widget).not.toBe(page)
        expect(weeksApart(widget, page)).toBe(1)
      }
    })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. The widget itself: which week it REQUESTS, and that the week has sessions
// ─────────────────────────────────────────────────────────────────────────────

// A fixture with a hard asymmetry: the week of the last session (Aug 3–7) has
// reporters on its Friday, and the UPCOMING week (Aug 10–14) — the week
// `/calendar` shows on a Saturday — is present but EMPTY, because nothing has
// been scheduled into it yet. That asymmetry is the point: an assertion that
// "the widget shows a week with sessions" is only meaningful if the other
// candidate week would have shown nothing.
const WEEK_LAST_SESSION = {
  [FRI]: {
    econ: [], fed: [], tbd: [],
    bmo: [{ sym: 'FRIBMO', eps_est: 1.1, rev_est: 900 }],
    amc: [{ sym: 'FRIAMC', eps_act: 2.2, eps_est: 2.0, rev_act: 1200, rev_est: 1100 }],
  },
  [THU]: { econ: [], fed: [], tbd: [], bmo: [{ sym: 'THUBMO', eps_est: 0.5 }], amc: [] },
}
const WEEK_UPCOMING = {
  [NEXT_MON]: { econ: [], fed: [], tbd: [], bmo: [], amc: [] },
}
const WEEKS = { [MON]: WEEK_LAST_SESSION, [NEXT_MON]: WEEK_UPCOMING }

function stubFetch() {
  const urls = []
  const impl = vi.fn(async (url) => {
    urls.push(String(url))
    const u = String(url)
    if (u.startsWith('/api/calendar?week=')) {
      const wk = new URLSearchParams(u.slice(u.indexOf('?') + 1)).get('week')
      return { ok: true, json: async () => ({ week_start: wk, days: WEEKS[wk] ?? {} }) }
    }
    return { ok: true, json: async () => ({}) }
  })
  vi.stubGlobal('fetch', impl)
  return urls
}

// A FRESH SWR cache per mount. Two mounts inside one test would otherwise share
// the module-global cache, and with the clock frozen SWR's 60s dedupe window
// never elapses — the second mount would serve the first mount's data without
// issuing a request, and the boundary tests below would read an undefined week
// instead of the one the component actually asked for.
function Wrap() {
  return (
    <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false }}>
      <WorkspaceContext.Provider value={{ groupSyms: { A: null }, setGroupSym: vi.fn() }}>
        <CalendarWidget color="A" opts={{}} onOptsChange={vi.fn()} />
      </WorkspaceContext.Provider>
    </SWRConfig>
  )
}

function weekParamsRequested(urls) {
  return urls
    .filter(u => u.startsWith('/api/calendar?week='))
    .map(u => new URLSearchParams(u.slice(u.indexOf('?') + 1)).get('week'))
}

describe('on a weekend the widget opens on a week that actually has sessions', () => {
  for (const [label, day] of [['Saturday', SAT], ['Sunday', SUN]]) {
    it(`${label}: requests ${MON} (the last session's week) and renders its reporters`, async () => {
      pinET(etInstant(day, 11, 0), day)
      const urls = stubFetch()
      render(<Wrap />)

      // The week it asked the backend for IS the named widget intent…
      expect(weekParamsRequested(urls)).toEqual([lastSessionWeekMonday(day)])
      expect(weekParamsRequested(urls)).toEqual([MON])
      // …and it NEVER asked for the week /calendar would have shown, which is
      // the week that has no data yet.
      expect(weekParamsRequested(urls)).not.toContain(currentWeekMonday(day))
      expect(currentWeekMonday(day)).toBe(NEXT_MON)

      // The day on screen is the last session — Friday — not the empty weekend.
      expect(await screen.findByText('Aug 7')).toBeInTheDocument()
      // And that day genuinely HAS sessions: real reporters render.
      expect(await screen.findByText('FRIBMO')).toBeInTheDocument()
      expect(screen.getByText('FRIAMC')).toBeInTheDocument()
      // The control on the fixture itself: the week the OTHER intent would have
      // asked for is empty, so "shows a week with sessions" could not have been
      // satisfied by both answers.
      expect(WEEKS[NEXT_MON][NEXT_MON].bmo).toHaveLength(0)
      expect(WEEKS[NEXT_MON][NEXT_MON].amc).toHaveLength(0)
    })
  }

  it('on a WEEKDAY it opens on today, and both intents asked for the same week', async () => {
    pinET(etInstant(THU, 11, 0), THU)
    const urls = stubFetch()
    render(<Wrap />)
    expect(weekParamsRequested(urls)).toEqual([MON])
    expect(currentWeekMonday(THU)).toBe(MON)     // no disagreement to declare
    expect(await screen.findByText('Aug 6')).toBeInTheDocument()
    expect(await screen.findByText('THUBMO')).toBeInTheDocument()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. NON-VACUITY — sixty seconds apart, the verdict INVERTS
// ─────────────────────────────────────────────────────────────────────────────
//
// A pinned clock can silently remove the behaviour along with the flakiness, so
// each boundary below is driven twice through the REAL component with identical
// inputs — same fixture, same stub, same props — and only the clock moved, by
// sixty seconds. If the rule had collapsed to a constant (or the pin stopped
// reaching the component) both sides answer the same thing and these go red.
describe('non-vacuity: the same input 60s apart across a boundary inverts the verdict', () => {
  async function renderAt(utc, etDay) {
    pinET(utc, etDay)
    const urls = stubFetch()
    const view = render(<Wrap />)
    const week = weekParamsRequested(urls)[0]
    const openedOn = (await screen.findByText(/^Aug \d+$/)).textContent
    view.unmount()
    return { week, openedOn, page: currentWeekMonday(etDay) }
  }

  it('Fri 23:59 → Sat 00:00 ET: the two intents go from AGREEING to DISAGREEING', async () => {
    const before = await renderAt(etInstant(FRI, 23, 59), FRI)
    const after = await renderAt(etInstant(SAT, 0, 0), SAT)

    // Sixty seconds of wall clock…
    expect(Date.parse(etInstant(SAT, 0, 0)) - Date.parse(etInstant(FRI, 23, 59))).toBe(60000)

    // The widget does not move — it is still looking at Friday's week…
    expect(before.week).toBe(MON)
    expect(after.week).toBe(MON)
    expect(before.openedOn).toBe('Aug 7')
    expect(after.openedOn).toBe('Aug 7')
    // …but `/calendar`'s intent DOES, so the verdict inverts.
    expect(before.page).toBe(MON)
    expect(after.page).toBe(NEXT_MON)
    expect(before.week === before.page).toBe(true)
    expect(after.week === after.page).toBe(false)
  })

  it('Sun 23:59 → Mon 00:00 ET: the WIDGET flips a whole week (the anchor does not)', async () => {
    // This boundary is the widget's OWN: Sunday and Monday are the same week for
    // `currentWeekMonday`, so a rail here can only be satisfied by the
    // last-session rule actually running.
    const before = await renderAt(etInstant(SUN, 23, 59), SUN)
    const after = await renderAt(etInstant(NEXT_MON, 0, 0), NEXT_MON)

    expect(Date.parse(etInstant(NEXT_MON, 0, 0)) - Date.parse(etInstant(SUN, 23, 59))).toBe(60000)

    expect(before.week).toBe(MON)
    expect(after.week).toBe(NEXT_MON)
    expect(weeksApart(before.week, after.week)).toBe(1)
    expect(before.openedOn).toBe('Aug 7')          // Friday
    expect(after.openedOn).toBe('Aug 10')          // Monday
    // The control that makes it the WIDGET's boundary and not the anchor's:
    // `/calendar` answers the same week on both sides.
    expect(before.page).toBe(NEXT_MON)
    expect(after.page).toBe(NEXT_MON)
    expect(before.page).toBe(after.page)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE RAIL — no independent Monday derivation, by AST + import graph
// ─────────────────────────────────────────────────────────────────────────────
//
// ⛔ Never a grep. A text search for "mondayOf" passes on a comment and fails on
// a rename; what has to hold is a PROVENANCE property: the value the widget
// interpolates into its `?week=` request, and the day it opens on, must each be
// produced by a call to a binding IMPORTED from weekAnchor. Anything produced by
// a locally-declared function is a second authority, which is the defect.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const WIDGET_PATH = path.join(HERE, 'CalendarWidget.jsx')
const ANCHOR_DIR = path.join(HERE, '..', '..', 'calendar')
const JsxParser = Parser.extend(acornJsx())

const readWidget = () => fs.readFileSync(WIDGET_PATH, 'utf8')
const parse = src => JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })

const SKIP_KEYS = new Set(['start', 'end', 'loc', 'range', 'type'])
function walk(node, fn) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const n of node) walk(n, fn); return }
  if (typeof node.type === 'string') fn(node)
  for (const k of Object.keys(node)) {
    if (SKIP_KEYS.has(k)) continue
    walk(node[k], fn)
  }
}

/** Local names bound by `import … from '…/weekAnchor'`. */
function anchorImports(ast) {
  const names = new Set()
  for (const n of ast.body) {
    if (n.type !== 'ImportDeclaration') continue
    if (!/(^|\/)weekAnchor(\.js)?$/.test(n.source.value)) continue
    for (const s of n.specifiers) names.add(s.local.name)
  }
  return names
}

/**
 * Peel the React/functional wrappers off a declarator's initializer until the
 * expression that PRODUCES the value is reached:
 *   useMemo(() => X, deps) → X · (…) => X → X · { return X } → X
 */
function producingExpression(init) {
  let cur = init
  for (let i = 0; cur && i < 20; i++) {
    if (cur.type === 'CallExpression' && cur.callee.type === 'Identifier' && /^use[A-Z]/.test(cur.callee.name)) {
      cur = cur.arguments[0]
      continue
    }
    if (cur.type === 'ArrowFunctionExpression' || cur.type === 'FunctionExpression') { cur = cur.body; continue }
    if (cur.type === 'BlockStatement') {
      const returns = cur.body.filter(s => s.type === 'ReturnStatement')
      if (returns.length !== 1) return null
      cur = returns[0].argument
      continue
    }
    break
  }
  return cur
}

/** The name of the function that produces binding `name`, or a failure reason. */
function producerOf(ast, name) {
  const decls = []
  walk(ast, n => {
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.id.name === name) decls.push(n)
  })
  if (decls.length !== 1) return { reason: `expected exactly one declaration of \`${name}\`, found ${decls.length}` }
  const expr = producingExpression(decls[0].init)
  if (!expr || expr.type !== 'CallExpression' || expr.callee.type !== 'Identifier') {
    return { reason: `\`${name}\` is not produced by a plain function call (got ${expr ? expr.type : 'nothing'})` }
  }
  return { callee: expr.callee.name }
}

/** One intent's provenance verdict: null when it traces to a weekAnchor import. */
function provenanceOf(ast, imported, bindingName, label) {
  const p = producerOf(ast, bindingName)
  if (p.reason) return `the ${label} is not a single call to a weekAnchor import — ${p.reason}`
  if (!imported.has(p.callee)) {
    return `the ${label} is derived LOCALLY by \`${p.callee}()\` — it must come from weekAnchor`
  }
  return null
}

/**
 * The rail. Returns a list of provenance violations — empty means both of the
 * widget's week intents trace back to a weekAnchor import.
 */
function weekIntentViolations(src) {
  const ast = parse(src)
  const imported = anchorImports(ast)
  const problems = []

  const keys = []
  walk(ast, n => {
    if (n.type === 'TemplateLiteral' && n.quasis[0]?.value?.cooked?.startsWith('/api/calendar?week=')) keys.push(n)
  })
  if (keys.length !== 1) {
    problems.push(`expected exactly one \`/api/calendar?week=\` request key, found ${keys.length}`)
  } else {
    const expr = keys[0].expressions[0]
    if (!expr || expr.type !== 'Identifier') {
      problems.push('the ?week= value is inlined rather than a named binding, so it cannot be traced')
    } else {
      const v = provenanceOf(ast, imported, expr.name, 'requested week')
      if (v) problems.push(v)
    }
  }

  const v = provenanceOf(ast, imported, 'todayView', 'opening day')
  if (v) problems.push(v)

  return problems
}

/** Rewrite `src`, refusing to "succeed" when the target text isn't there. */
function mutate(src, pairs) {
  let out = src
  for (const [oldText, newText] of pairs) {
    expect(out).toContain(oldText)          // ⛔ never str.replace without asserting the target exists
    const before = out
    out = out.replace(oldText, newText)
    expect(out).not.toBe(before)            // the mutation APPLIED
    expect(out).toContain(newText)
  }
  return out
}

// The pre-fix widget, verbatim from `git show b700a874^:…CalendarWidget.jsx` —
// a private `mondayOfISO` and a private weekend snap-back, self-consistent and
// completely undetectable to the import graph.
const PREFIX_LOCAL_MONDAY = [
  'function addTradingDay(iso, dir) {',
  'function mondayOfISO(iso) { const wd = isoWeekday(iso); return addDaysISO(iso, wd === 0 ? -6 : 1 - wd) }\nfunction addTradingDay(iso, dir) {',
]
const PREFIX_USE_LOCAL_MONDAY = ['const weekParam = mondayOf(selected)', 'const weekParam = mondayOfISO(selected)']
const PREFIX_LOCAL_SNAPBACK = [
  'const todayView = useMemo(() => lastSessionDay(todayET()), [])',
  'const todayView = useMemo(() => {\n    const now = todayET()\n    const wd = isoWeekday(now)\n    return (wd === 0 || wd === 6) ? addTradingDay(now, -1) : now\n  }, [])',
]
// The same defect wearing a helper's clothes: a private function instead of an
// inline branch. Different AST shape, same second authority — the rail has to
// catch BOTH, or "extract that into a helper" launders the bug past it.
const HELPER_LOCAL_SNAPBACK_DECL = [
  'function addTradingDay(iso, dir) {',
  'function localOpeningDay(iso) { const wd = isoWeekday(iso); return (wd === 0 || wd === 6) ? addTradingDay(iso, -1) : iso }\nfunction addTradingDay(iso, dir) {',
]
const HELPER_LOCAL_SNAPBACK_USE = [
  'const todayView = useMemo(() => lastSessionDay(todayET()), [])',
  'const todayView = useMemo(() => localOpeningDay(todayET()), [])',
]

describe('CalendarWidget has no independent Monday derivation (AST + import graph)', () => {
  it('both intents trace back to a weekAnchor import', () => {
    expect(weekIntentViolations(readWidget())).toEqual([])
  })

  it('the widget imports the anchor and declares none of its functions itself', () => {
    const ast = parse(readWidget())
    const imported = anchorImports(ast)
    expect(imported.size).toBeGreaterThan(0)
    const declaredHere = new Set()
    walk(ast, n => {
      if (n.type === 'FunctionDeclaration' && n.id) declaredHere.add(n.id.name)
      if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier'
        && n.init && /Function/.test(n.init.type)) declaredHere.add(n.id.name)
    })
    for (const name of ['mondayOf', 'nextSessionDay', 'lastSessionDay', 'currentWeekMonday', 'lastSessionWeekMonday', 'localIso']) {
      expect(declaredHere.has(name)).toBe(false)
    }
  })

  it('each anchor function is declared exactly once across the calendar surfaces', () => {
    // A second authority does not have to live in CalendarWidget.jsx to be a
    // second authority. Scan both directories that own this surface.
    const files = []
    for (const dir of [ANCHOR_DIR, HERE]) {
      for (const f of fs.readdirSync(dir)) {
        if (!/\.(js|jsx)$/.test(f) || /\.test\.jsx?$/.test(f)) continue
        files.push(path.join(dir, f))
      }
    }
    expect(files.length).toBeGreaterThan(10)     // the scan actually read something
    const counts = {}
    for (const f of files) {
      walk(parse(fs.readFileSync(f, 'utf8')), n => {
        if (n.type === 'FunctionDeclaration' && n.id) counts[n.id.name] = (counts[n.id.name] || 0) + 1
      })
    }
    for (const name of ['mondayOf', 'nextSessionDay', 'lastSessionDay', 'currentWeekMonday', 'lastSessionWeekMonday']) {
      expect([name, counts[name] ?? 0]).toEqual([name, 1])
    }
  })

  // ── POSITIVE CONTROLS ─────────────────────────────────────────────────────
  // Without these the rail above is a gate that cannot fail: a scanner that
  // silently finds nothing reports a clean bill of health forever.

  it('control: the scan FINDS a locally-derived week (the pre-fix mondayOfISO)', () => {
    const problems = weekIntentViolations(
      mutate(readWidget(), [PREFIX_LOCAL_MONDAY, PREFIX_USE_LOCAL_MONDAY]),
    )
    // Exactly one — so the two rails are independent, not one rail firing twice.
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/requested week is derived LOCALLY by `mondayOfISO\(\)`/)
  })

  it('control: the scan FINDS the pre-fix inline weekend snap-back', () => {
    const problems = weekIntentViolations(mutate(readWidget(), [PREFIX_LOCAL_SNAPBACK]))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/^the opening day is not a single call to a weekAnchor import/)
    expect(problems[0]).toMatch(/ConditionalExpression/)
  })

  it('control: the scan FINDS the same snap-back extracted into a local helper', () => {
    const problems = weekIntentViolations(
      mutate(readWidget(), [HELPER_LOCAL_SNAPBACK_DECL, HELPER_LOCAL_SNAPBACK_USE]),
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/opening day is derived LOCALLY by `localOpeningDay\(\)`/)
  })

  it('control: the whole pre-fix shape trips BOTH rails independently', () => {
    const problems = weekIntentViolations(
      mutate(readWidget(), [PREFIX_LOCAL_MONDAY, PREFIX_USE_LOCAL_MONDAY, PREFIX_LOCAL_SNAPBACK]),
    )
    expect(problems).toHaveLength(2)
    expect(problems.join('\n')).toMatch(/mondayOfISO/)
    expect(problems.join('\n')).toMatch(/opening day/)
  })

  it('control: the scan cannot pass by failing to find the request at all', () => {
    const problems = weekIntentViolations(
      mutate(readWidget(), [['`/api/calendar?week=${weekParam}&full_impact=1`', '`/api/calendar-v2?w=${weekParam}`']]),
    )
    expect(problems).toContain('expected exactly one `/api/calendar?week=` request key, found 0')
  })
})
