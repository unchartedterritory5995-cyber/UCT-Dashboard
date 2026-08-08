// app/src/components/chart/IndicatorAlertManager.test.jsx
//
// ═══════════════════════════════════════════════════════════════════════════
// audit-not-wired FINDING 5 — THERE IS AN ALERT MANAGER NOW.
// ═══════════════════════════════════════════════════════════════════════════
//
// `indicator_alert_service.list_for_user`'s docstring calls the unscoped listing
// *"the alert manager's view"*. There was no alert manager.
// `IndicatorAlertPopover` was the sole consumer of `useIndicatorAlerts()` and it
// filters the response to the chart's own symbol — so every alert on every OTHER
// symbol was fetched, discarded, and reachable only by navigating a chart to
// that exact ticker. A member with alerts on twelve names had no page listing
// them and no way to find one whose symbol they had forgotten.
//
// ⛔ WHY THE EXISTING GREEN TESTS COULD NOT SEE IT. `IndicatorAlertPopover.test.jsx`
// mocks `../../hooks/useIndicatorAlerts` wholesale and asserts the popover
// renders the symbol's rows — which is CORRECT, and which is exactly why the
// gap survived: nothing was wrong with either component. What was missing was a
// SECOND consumer. So this file drives the real hook against a stubbed `fetch`
// (`lesson_injected_dependency_hides_the_fetch`) and asserts two things a
// component test structurally cannot: the URL that actually leaves, and that the
// manager is MOUNTED on `/settings`.
//
// ⛔ AND EVERY CASE HAS ITS OPPOSITE. "It shows an alert on MSFT" proves nothing
// unless a filter reintroduced on any symbol demonstrably breaks it, and "it
// shows a `state_detail`" proves nothing unless a HEALTHY row carrying one
// demonstrably does not.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// Reaches this test through `@vitejs/plugin-react`'s dependency tree, the same
// route `IndicatorAlertPopover.scope.test.jsx` uses — the phase's standing rule
// is "verify structure with an AST, never a grep".
import { parse } from '@babel/parser'

import IndicatorAlertManager, { groupBySymbol } from './IndicatorAlertManager'
import { AuthContext } from '../../context/AuthContext'

const LIST = '/api/indicator-alerts'

/** A served row, in the shape `indicator_alert_service._row_to_dict` returns. */
const alertRow = (over = {}) => ({
  id: 1,
  sym: 'AAPL',
  indicator: 'rsi',
  instance_label: 'RSI(14)',
  condition: 'above',
  threshold: 70,
  tf: 'D',
  active: true,
  last_value: null,
  triggered_at: null,
  trigger_count: 0,
  created_at: 1_700_000_000,
  state: 'armed',
  state_detail: null,
  instance_missing: false,
  scope: null,
  ...over,
})

/** The real sentence the sweep writes for the tzdata case — quoted from
 *  `indicator_alert_service.diagnose`'s own vocabulary rather than invented, so
 *  a component that paraphrased instead of rendering would stop matching. */
const SWEEP_DETAIL =
  'ZoneInfoNotFoundError: No time zone found with key America/New_York'

let calls = []
let served = []

function stubFetch() {
  calls = []
  global.fetch = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), method: (init && init.method) || 'GET' })
    return { ok: true, status: 200, json: async () => ({ alerts: served }) }
  })
}

const listings = () => calls.filter((c) => c.method === 'GET').map((c) => c.url)

function mount() {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      {/* A fresh cache per test: SWR would otherwise serve the previous case's
          answer for the same key and issue no request at all. */}
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <IndicatorAlertManager />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

/** Every rendered row's symbol, read off the row itself rather than off a
 *  heading — a heading with no rows under it would satisfy a heading probe. */
const renderedSyms = () =>
  [...document.querySelectorAll('[data-alert-id]')].map((n) => n.dataset.sym)

beforeEach(() => { served = []; stubFetch() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete global.fetch })

describe('🔴 the manager lists EVERY symbol — the filter is lifted', () => {
  it('⭐ an alert on a symbol no chart is showing is on the page', async () => {
    // The finding, exactly: three names, one screen. The popover would render
    // at most the one it happens to be mounted on.
    served = [
      alertRow({ id: 1, sym: 'AAPL' }),
      alertRow({ id: 2, sym: 'MSFT' }),
      alertRow({ id: 3, sym: 'TSLA' }),
    ]
    mount()
    await waitFor(() => expect(renderedSyms().length).toBe(3))
    expect(new Set(renderedSyms())).toEqual(new Set(['AAPL', 'MSFT', 'TSLA']))
    // …and each is findable by name, which is the member's actual problem:
    // "I have an alert somewhere and I cannot remember on what".
    for (const sym of ['AAPL', 'MSFT', 'TSLA']) {
      expect(screen.getByRole('region', { name: `Alerts on ${sym}` })).toBeTruthy()
    }
  })

  it('⛔ CONTROL: the grouping drops nothing and invents nothing, at the pure level', () => {
    // ⛔ THE FUNCTION, NOT THE RENDER. A symbol filter reintroduced anywhere in
    // the pipeline shows up here first, and this control is what makes the
    // rendered assertion above mean "no filter" rather than "these three
    // happened to survive".
    const rows = [
      alertRow({ id: 1, sym: 'msft' }),
      alertRow({ id: 2, sym: 'AAPL' }),
      alertRow({ id: 3, sym: 'AAPL', created_at: 1_800_000_000 }),
    ]
    const groups = groupBySymbol(rows)
    expect(groups.map((g) => g.sym), 'symbols are A→Z, and case is normalised')
      .toEqual(['AAPL', 'MSFT'])
    expect(groups.flatMap((g) => g.rows.map((r) => r.id)).sort()).toEqual([1, 2, 3])
    // Newest first inside a symbol — the popover's order and the store's order.
    expect(groups[0].rows.map((r) => r.id)).toEqual([3, 2])
    // ⛔ AND A ROW WITH NO SYMBOL IS NOT SILENTLY DROPPED. Hiding one would be
    // this whole finding in miniature: fetched, then discarded.
    expect(groupBySymbol([alertRow({ id: 9, sym: null })]).map((g) => g.sym)).toEqual(['—'])
    expect(groupBySymbol([])).toEqual([])
  })

  it('⭐ it asks for the ALERT MANAGER\'S VIEW — the unscoped listing, no new endpoint', async () => {
    // ⛔ NO `?scope=`. `list_for_user` reads an omitted scope as everything;
    // sending one would narrow the one screen whose purpose is not to narrow,
    // and a chart-scoped alert would then be visible NOWHERE but its own chart.
    served = [alertRow({ id: 1, sym: 'MSFT' })]
    mount()
    await waitFor(() => expect(listings().length).toBeGreaterThan(0))
    expect(listings()).toEqual([LIST])
    expect(listings().some((u) => u.includes('scope'))).toBe(false)
    // …and it is the ONE route that already existed. A second listing endpoint
    // would be a second thing to keep in step with `scope` and `instance_label`.
    expect(new Set(listings())).toEqual(new Set([LIST]))
  })

  it('⭐ a chart-scoped alert is labelled — this list is the only place it is visible at all', async () => {
    served = [
      alertRow({ id: 1, sym: 'AAPL', scope: 'w7:tab-3' }),
      alertRow({ id: 2, sym: 'MSFT', scope: null }),
    ]
    mount()
    await waitFor(() => expect(renderedSyms().length).toBe(2))
    const chips = screen.getAllByTestId('alert-scope-chip')
    expect(chips, 'a global alert was labelled as chart-scoped, or the scoped one was not')
      .toHaveLength(1)
    const scoped = document.querySelector('[data-alert-id="1"]')
    expect(within(scoped).getByTestId('alert-scope-chip')).toBeTruthy()
  })
})

describe('🔴 a member DISCOVERS a mute alert here — `state` / `state_detail`', () => {
  it('⭐ a `needs_attention` row surfaces the sweep\'s own sentence, verbatim', async () => {
    // 🔴 THIS IS WHY THE SCREEN EXISTS. `sweep_silent_alerts` diagnoses a mute
    // alert every five minutes and writes the cause; the popover renders it for
    // ONE symbol, and this is where a member finds it for the other eleven —
    // including the `ichimoku.chikou` alerts that go permanently silent at the
    // cutover.
    served = [alertRow({ id: 5, sym: 'NVDA', state: 'needs_attention', state_detail: SWEEP_DETAIL })]
    mount()
    const line = await screen.findByTestId('alert-state-detail')
    // ⛔ EQUALITY. A client-side summary ("this alert is broken") would be a
    // second, rotting description of a diagnosis the server already wrote.
    expect(line.textContent).toBe(SWEEP_DETAIL)
    expect(line.getAttribute('data-state')).toBe('needs_attention')
    // …on the row for the symbol nothing is charting.
    expect(within(document.querySelector('[data-alert-id="5"]')).getByTestId('alert-state-detail'))
      .toBeTruthy()
  })

  it('⭐ `state=error` too, and the count says how many before a member reads a row', async () => {
    served = [
      alertRow({ id: 6, sym: 'AMD', state: 'error', state_detail: 'no stored bars for AMD on D' }),
      alertRow({ id: 7, sym: 'ZM', state: 'needs_attention', state_detail: SWEEP_DETAIL }),
      alertRow({ id: 8, sym: 'AAPL' }),
    ]
    mount()
    await waitFor(() => expect(renderedSyms().length).toBe(3))
    expect(screen.getAllByTestId('alert-state-detail')).toHaveLength(2)
    expect(screen.getByTestId('alerts-needing-attention').textContent).toMatch(/2 not firing/)
  })

  it('⛔ CONTROL: a HEALTHY row shows no lifecycle line — even when it carries a detail', async () => {
    // `rearm` writes `state_detail` under `armed` and `snooze` writes "snoozed
    // for 60 min" under `snoozed`. An implementation that rendered every detail
    // it was handed would report both as broken alerts, and would pass a control
    // that only checked a detail-less healthy row.
    served = [
      alertRow({ id: 3, sym: 'AAPL', state: 'armed', state_detail: 're-armed by the evaluator' }),
      alertRow({ id: 4, sym: 'MSFT', state: 'snoozed', state_detail: 'snoozed for 60 min' }),
    ]
    mount()
    await waitFor(() => expect(renderedSyms().length).toBe(2))
    expect(screen.queryByTestId('alert-state-detail')).toBeNull()
    expect(screen.queryByText('re-armed by the evaluator')).toBeNull()
    expect(screen.queryByText('snoozed for 60 min')).toBeNull()
    expect(screen.queryByTestId('alerts-needing-attention')).toBeNull()
  })

  it('a fault with NO recorded detail still says the alert is not firing', async () => {
    served = [alertRow({ id: 9, sym: 'GOOG', state: 'needs_attention', state_detail: null })]
    mount()
    expect((await screen.findByTestId('alert-state-detail')).textContent).toMatch(/not firing/i)
  })

  it('⭐ it names the instance the SERVER computed, and its armed/disabled state', async () => {
    served = [alertRow({ id: 2, sym: 'MSFT', instance_label: 'RSI(7)', active: false })]
    mount()
    // ⚠️ ASSERT INSIDE `waitFor`, not "return the query". A callback that
    // returns `null` does not THROW, so `waitFor` resolves immediately and the
    // wait becomes decorative — the first version of this case failed on a null
    // rather than on the claim.
    await waitFor(() => expect(document.querySelector('[data-alert-id="2"]')).toBeTruthy())
    const row = document.querySelector('[data-alert-id="2"]')
    // `instance_label` comes from `params_json` via the module that evaluates —
    // never a second parameter table in the browser.
    expect(row.textContent).toContain('RSI(7)')
    expect(row.textContent).toContain('@ 70')
    expect(within(row).getByText('OFF')).toBeTruthy()
  })

  it('says so plainly when a member has none — not an empty box', async () => {
    served = []
    mount()
    expect(await screen.findByText(/No indicator alerts yet/i)).toBeTruthy()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// AND IT IS MOUNTED. Structure, over parsed JSX — never a grep, which a comment
// or a string literal fools, and which this branch has had both manufacture a
// ship-blocker and hide one.
// ═══════════════════════════════════════════════════════════════════════════

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = (() => {
  let dir = HERE
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'pages', 'Settings.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`alert-manager probe: repo root not found walking up from ${HERE}`)
})()

const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** Every node in a Babel AST, depth-first. */
function* walk(node) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const n of node) yield* walk(n); return }
  if (typeof node.type !== 'string') return
  yield node
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue
    yield* walk(node[key])
  }
}

const astOf = (src) => parse(src, { sourceType: 'module', plugins: ['jsx'] })

/**
 * The local name `src` binds the default export of `spec` to — resolved, never
 * assumed. A rename of the import is a rename of every JSX element below it, and
 * a probe that hardcoded the name would report a live mount as missing.
 */
function defaultImportName(src, spec) {
  for (const node of walk(astOf(src).program)) {
    if (node.type !== 'ImportDeclaration' || node.source.value !== spec) continue
    const def = node.specifiers.find((s) => s.type === 'ImportDefaultSpecifier')
    if (def) return def.local.name
  }
  return null
}

/**
 * Is `<Name/>` rendered inside the `card('<cardId>', …)` entry of `key`'s array
 * in the `sectionCards` object literal?
 *
 * ⛔ THE WHOLE CHAIN, NOT "THE FILE MENTIONS IT". `sectionCards[section]` is
 * what `Settings` renders; a component imported and assigned to a `const` that
 * no section lists is EXACTLY the unreachable-but-present shape this audit is
 * about, and it is what a `toContain('IndicatorAlertManager')` grep would
 * happily accept.
 */
function mountedInSection(src, { key, cardId, name }) {
  const ast = astOf(src)
  // The section map: `const sectionCards = { … }`.
  let map = null
  for (const node of walk(ast.program)) {
    if (node.type !== 'VariableDeclarator') continue
    if (node.id.type !== 'Identifier' || node.id.name !== 'sectionCards') continue
    if (node.init && node.init.type === 'ObjectExpression') map = node.init
  }
  if (!map) return { found: false, reason: 'no sectionCards object literal' }

  const prop = map.properties.find((p) => p.type === 'ObjectProperty'
    && ((p.key.type === 'Identifier' && p.key.name === key)
      || (p.key.type === 'StringLiteral' && p.key.value === key)))
  if (!prop || prop.value.type !== 'ArrayExpression') {
    return { found: false, reason: `sectionCards.${key} is not an array` }
  }

  // …the `card('<cardId>', <node>)` entry inside it.
  const entry = prop.value.elements.find((el) => el
    && el.type === 'CallExpression'
    && el.callee.type === 'Identifier' && el.callee.name === 'card'
    && el.arguments[0] && el.arguments[0].type === 'StringLiteral'
    && el.arguments[0].value === cardId)
  if (!entry) return { found: false, reason: `no card('${cardId}', …) in sectionCards.${key}` }

  // …and, somewhere under whatever that entry renders, the element itself.
  // Resolving the identifier the entry passes (`indicatorAlertsCard`) back to
  // its declaration is what lets the card stay a named `const`, which is the
  // shape every other card on this page uses.
  const roots = []
  for (const arg of entry.arguments.slice(1)) {
    if (arg.type === 'Identifier') {
      for (const node of walk(ast.program)) {
        if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier'
            && node.id.name === arg.name && node.init) roots.push(node.init)
      }
    } else roots.push(arg)
  }
  for (const root of roots) {
    for (const node of walk(root)) {
      if (node.type === 'JSXElement'
          && node.openingElement.name.type === 'JSXIdentifier'
          && node.openingElement.name.name === name) return { found: true, reason: null }
    }
  }
  return { found: false, reason: `<${name}/> is not rendered by card('${cardId}', …)` }
}

describe('⛔ the manager is REACHABLE — mounted on the settings page', () => {
  const SETTINGS = 'app/src/pages/Settings.jsx'
  const SPEC = '../components/chart/IndicatorAlertManager'

  it('the probe reports a missing mount as missing — a gate that cannot fail is not a gate', () => {
    // Positive AND negative control on synthetic source, before any claim about
    // the shipped file is allowed to mean anything.
    const good = `
      import Mgr from '../components/chart/IndicatorAlertManager'
      function S() {
        const someCard = <Tile><Mgr /></Tile>
        const sectionCards = { preferences: [card('other', x), card('indicatorAlerts', someCard)] }
        return sectionCards
      }`
    const unmounted = `
      import Mgr from '../components/chart/IndicatorAlertManager'
      function S() {
        const someCard = <Tile><Mgr /></Tile>
        const sectionCards = { preferences: [card('other', x)] }
        return sectionCards
      }`
    const stringOnly = `
      function S() {
        const someCard = <Tile>{'Mgr'}{/* <Mgr /> */}</Tile>
        const sectionCards = { preferences: [card('indicatorAlerts', someCard)] }
        return sectionCards
      }`
    const args = { key: 'preferences', cardId: 'indicatorAlerts', name: 'Mgr' }
    expect(defaultImportName(good, SPEC)).toBe('Mgr')
    expect(defaultImportName(unmounted, './somewhere-else')).toBeNull()
    expect(mountedInSection(good, args).found).toBe(true)
    // ⛔ The two ways this could rot: the card falls out of the section map…
    expect(mountedInSection(unmounted, args).found).toBe(false)
    // …and a comment or a string that merely NAMES the component.
    expect(mountedInSection(stringOnly, args).found).toBe(false)
  })

  it('⭐ `/settings` imports the manager and renders it inside a Preferences card', () => {
    const src = readSrc(SETTINGS)
    const name = defaultImportName(src, SPEC)
    expect(name, `Settings.jsx no longer imports ${SPEC} — the alert manager is unreachable again`)
      .toBeTruthy()
    const { found, reason } = mountedInSection(src, {
      key: 'preferences', cardId: 'indicatorAlerts', name,
    })
    expect(found,
      'the alert manager is not mounted on /settings: ' + reason + '. A member with alerts on '
      + 'twelve names is back to navigating a chart to each exact ticker.').toBe(true)
  })

  it('⭐ …and it is findable — the settings search index carries it', () => {
    // The rail one level up from "it renders": a card nobody can navigate to is
    // the same defect one screen out. `SEARCH_INDEX` feeds both the rail filter
    // and the ⌘K palette.
    const ast = astOf(readSrc(SETTINGS))
    let index = null
    for (const node of walk(ast.program)) {
      if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier'
          && node.id.name === 'SEARCH_INDEX' && node.init
          && node.init.type === 'ArrayExpression') index = node.init
    }
    expect(index, 'SEARCH_INDEX is no longer an array literal — re-derive this probe').toBeTruthy()
    const cards = index.elements
      .filter((e) => e && e.type === 'ObjectExpression')
      .map((e) => {
        const p = e.properties.find((q) => q.type === 'ObjectProperty'
          && q.key.type === 'Identifier' && q.key.name === 'card')
        return p && p.value.type === 'StringLiteral' ? p.value.value : null
      })
    expect(cards, 'the probe read no cards at all — it is measuring nothing')
      .toContain('notifications')
    expect(cards, 'the alert manager has no search entry: a member searching "alerts" '
      + 'on /settings is told there is nothing there').toContain('indicatorAlerts')
  })
})
