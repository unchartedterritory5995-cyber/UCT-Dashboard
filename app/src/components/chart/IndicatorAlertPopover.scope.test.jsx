// app/src/components/chart/IndicatorAlertPopover.scope.test.jsx
//
// ═══════════════════════════════════════════════════════════════════════════
// PHASE C TASK 12 — `?scope=` HAS A CLIENT.
// ═══════════════════════════════════════════════════════════════════════════
//
// The backend half of per-chart alert sets shipped complete and stayed dark:
// `indicator_alerts.scope` (nullable, one spelling of global), `_clean_scope`,
// `list_for_user(user_id, scope=…)`, `GET /api/indicator-alerts?scope=` and a
// pure `engine/alertSets.js`. **No surface anywhere supplied a chart id**, and
// `useIndicatorAlerts` never sent the parameter — so the column, the filter and
// the scoped-instance shape formed a closed loop with no entry.
//
// ⛔ WHY THIS FILE DOES NOT MOCK THE HOOK. `IndicatorAlertPopover.test.jsx`
// replaces `../../hooks/useIndicatorAlerts` wholesale, which is right for the
// 47 cases about the FORM — and structurally incapable of observing the one
// thing that was missing, because a mocked hook issues no request. What was
// broken here is a URL, so the assertion has to be about the request that
// actually leaves: real hook, real SWR, `fetch` as the only stub
// (`lesson_injected_dependency_hides_the_fetch`).
//
// ⛔ AND EVERY CASE HAS ITS OPPOSITE. `?scope=` reaching the wire proves nothing
// on its own unless a surface WITHOUT a chart id demonstrably does not send it —
// otherwise a hook that hardcoded a scope would pass, and every alert a member
// owns would vanish from every chart.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// ⚠️ `@babel/parser` reaches this test through `@vitejs/plugin-react`'s own
// dependency tree, not a direct devDependency — the same route
// `parityGateBlindness.test.js` uses, and for the same reason: the phase's
// standing rule is "verify structure with an AST, never a grep". If the import
// ever fails it fails loudly at module load, which is the right failure for a
// gate.
import { parse } from '@babel/parser'

import IndicatorAlertPopover from './IndicatorAlertPopover'
import { AuthContext } from '../../context/AuthContext'

const LIST = '/api/indicator-alerts'
const CATALOG = '/api/indicator-alerts/catalog'

const RSI_ONLY = [{
  indicator: 'rsi',
  label: 'RSI',
  conditions: [{ value: 'above', label: 'Above threshold', needs_threshold: true }],
  default_threshold: 70,
}]

/** Every request this browser made, in order. The subject of every assertion
 *  below — not an argument list handed to a stub of the thing under test. */
let calls = []

function stubFetch() {
  calls = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const method = (init && init.method) || 'GET'
    calls.push({ url: u, method, body: (init && init.body) || null })
    if (u.startsWith(CATALOG)) {
      return { ok: true, status: 200, json: async () => ({ catalog: RSI_ONLY }) }
    }
    if (method === 'POST') return { ok: true, status: 200, json: async () => ({ id: 1 }) }
    return { ok: true, status: 200, json: async () => ({ alerts: [] }) }
  })
}

/** Listing requests only — the catalog shares the prefix and is a different
 *  resource with a different fetcher. */
const listings = () => calls
  .filter((c) => c.method === 'GET' && !c.url.startsWith(CATALOG) && c.url.startsWith(LIST))
  .map((c) => c.url)

const posts = () => calls.filter((c) => c.method === 'POST' && !c.url.startsWith(CATALOG))

function mount(props = {}) {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      {/* A fresh cache per test: SWR would otherwise serve the previous case's
          answer for the same key and issue no request at all, which would make
          every assertion below vacuous in the second test that used a key. */}
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <IndicatorAlertPopover sym="AAPL" onClose={() => {}} {...props} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

beforeEach(() => { stubFetch() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete global.fetch })

describe('Phase C Task 12 — the chart id reaches the request', () => {
  it('⭐ a chart id becomes `?scope=` on the listing the popover actually fetches', async () => {
    mount({ chartId: 'w7:tab-3' })
    await waitFor(() => expect(listings().length).toBeGreaterThan(0))
    // ⛔ THE FULL URL, ENCODED. A chart id can carry `:` (a widget slot and its
    // tab), and an unencoded one would be a different string on the server than
    // the one the row was stored under — the scope would silently match nothing.
    expect(listings()).toContain(`${LIST}?scope=${encodeURIComponent('w7:tab-3')}`)
  })

  it('⛔ CONTROL: a surface with NO chart id sends no scope at all', async () => {
    // This is the case that makes the one above mean something, and it is also
    // the migration: every alert in production is unscoped, and the server reads
    // an omitted `scope` as the whole alert manager's view. A hook that always
    // sent one would empty every existing member's list.
    mount()
    await waitFor(() => expect(listings().length).toBeGreaterThan(0))
    expect(listings()).toEqual([LIST])
    expect(listings().some((u) => u.includes('scope'))).toBe(false)
  })

  it('⛔ two charts do not share one listing — the id is what varies', async () => {
    mount({ chartId: 'cell-a' })
    await waitFor(() => expect(listings().length).toBeGreaterThan(0))
    cleanup()
    mount({ chartId: 'cell-b' })
    await waitFor(() => expect(listings().length).toBeGreaterThan(1))
    expect(new Set(listings())).toEqual(new Set([`${LIST}?scope=cell-a`, `${LIST}?scope=cell-b`]))
  })
})

describe('Phase C Task 12 — "Only on this chart" is the producer of a scoped row', () => {
  const addBtn = () => screen.getByRole('button', { name: /add alert/i })
  const readyForm = async () => {
    await waitFor(() => expect(addBtn()).not.toBeDisabled())
  }

  it('⭐ checked ⇒ the create body carries this chart id', async () => {
    mount({ chartId: 'w7:tab-3' })
    await readyForm()
    fireEvent.click(screen.getByLabelText('Only on this chart'))
    fireEvent.click(addBtn())
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(JSON.parse(posts()[0].body).scope).toBe('w7:tab-3')
  })

  it('⛔ CONTROL: unchecked ⇒ the key is ABSENT, which is what global means', async () => {
    // ⚠️ Checked through real JSON. `JSON.stringify` DROPS an `undefined` value,
    // so a payload carrying `scope: undefined` would satisfy a naive
    // `toBeUndefined()` while being indistinguishable on the wire from one that
    // omits the key — and this branch has shipped exactly that fixture once.
    mount({ chartId: 'w7:tab-3' })
    await readyForm()
    fireEvent.click(addBtn())
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(Object.keys(JSON.parse(posts()[0].body))).not.toContain('scope')
  })

  it('⛔ a surface with no chart id offers no scope control at all', async () => {
    // Scoping an alert to "no chart" is a global write wearing a per-chart
    // label — `alertSets.applyAlertTemplate` refuses the same thing loudly.
    mount()
    await readyForm()
    expect(screen.queryByLabelText('Only on this chart')).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// THE PRODUCER CHAIN — because a hook that CAN send a scope sends none until
// something hands it an id.
// ═══════════════════════════════════════════════════════════════════════════
//
// The cases above prove the popover turns a chart id into a request. They would
// all stay green with the id never leaving `ChartWidget` — which is the exact
// state the audit found: `alertSets.js` complete, the column complete, the
// filter complete, and `chartId` occurring in the whole frontend only inside
// two engine modules that nothing called.
//
// So the four hops between a surface and the popover are asserted STRUCTURALLY,
// over parsed JSX — never a grep, which a comment or a string literal fools, and
// this branch has had a grep both manufacture a ship-blocker and hide one.

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = (() => {
  let dir = HERE
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`alert-scope probe: repo root not found walking up from ${HERE}`)
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

/** How many `<Name …>` elements in `src` carry a `chartId` attribute, and how
 *  many exist at all. Both numbers matter: `0 of 0` means the element was
 *  RENAMED and the probe is looking at nothing. */
function chartIdOn(src, name) {
  let total = 0
  let withProp = 0
  for (const node of walk(astOf(src).program)) {
    if (node.type !== 'JSXElement') continue
    const open = node.openingElement
    if (open.name.type !== 'JSXIdentifier' || open.name.name !== name) continue
    total += 1
    if ((open.attributes || []).some(
      (a) => a.type === 'JSXAttribute' && a.name.name === 'chartId')) withProp += 1
  }
  return { total, withProp }
}

/** Whether the object literal passed as `<Name stockChartProps={{…}}>` declares
 *  a `chartId` key. `ChartPane` spreads that object onto `StockChart`, so this
 *  is the same hop as a JSX attribute — one indirection further in. */
function stockChartPropsHasChartId(src) {
  for (const node of walk(astOf(src).program)) {
    if (node.type !== 'JSXAttribute' || node.name.name !== 'stockChartProps') continue
    const v = node.value
    if (!v || v.type !== 'JSXExpressionContainer') continue
    const obj = v.expression
    if (!obj || obj.type !== 'ObjectExpression') continue
    if (obj.properties.some((p) => p.type === 'ObjectProperty'
      && ((p.key.type === 'Identifier' && p.key.name === 'chartId')
        || (p.key.type === 'StringLiteral' && p.key.value === 'chartId')))) return true
  }
  return false
}

describe('the chart id has a PRODUCER, and it reaches the popover', () => {
  it('the probe reports a missing prop as missing — a gate that cannot fail is not a gate', () => {
    // Positive AND negative control, on synthetic source, before any claim about
    // shipped files is allowed to mean anything.
    expect(chartIdOn('const a = <Foo chartId={x} bar={1} />', 'Foo')).toEqual({ total: 1, withProp: 1 })
    expect(chartIdOn('const a = <Foo bar={1} />', 'Foo')).toEqual({ total: 1, withProp: 0 })
    expect(chartIdOn('const a = <Bar chartId={x} />', 'Foo')).toEqual({ total: 0, withProp: 0 })
    // A comment or a string mentioning the prop must NOT satisfy it.
    expect(chartIdOn('/* chartId */ const a = <Foo bar={"chartId"} />', 'Foo'))
      .toEqual({ total: 1, withProp: 0 })
    expect(stockChartPropsHasChartId('const a = <P stockChartProps={{ chartId: id }} />')).toBe(true)
    expect(stockChartPropsHasChartId('const a = <P stockChartProps={{ other: id }} />')).toBe(false)
  })

  it('⭐ HOP 1 — the workspace slot hands `ChartWidget` its persisted id', () => {
    const { total, withProp } = chartIdOn(readSrc('app/src/pages/charts/WidgetHost.jsx'), 'ChartWidget')
    expect(total, '<ChartWidget> is no longer mounted in WidgetHost — re-derive this probe').toBe(1)
    expect(withProp, 'WidgetHost stopped supplying a chart id: every /charts alert silently goes global').toBe(1)
  })

  it('⭐ HOP 2 — `ChartWidget` publishes it down the pane\'s StockChart passthrough', () => {
    expect(stockChartPropsHasChartId(readSrc('app/src/pages/charts/widgets/ChartWidget.jsx')),
      'ChartWidget no longer puts chartId in stockChartProps — ChartPane spreads that object onto StockChart, '
      + 'so dropping the key severs the only live path between a chart and its alert set').toBe(true)
  })

  it('⭐ HOP 2b — the Multi-Chart grid cell supplies its PERSISTED cell id', () => {
    const { total, withProp } = chartIdOn(readSrc('app/src/pages/charts/grid/GridChartCell.jsx'), 'StockChart')
    expect(total).toBe(1)
    expect(withProp).toBe(1)
  })

  it('⭐ HOP 3 — `StockChart` forwards it to EVERY toolbar it mounts', () => {
    const { total, withProp } = chartIdOn(readSrc('app/src/components/StockChart.jsx'), 'ChartToolbar')
    expect(total, 'StockChart mounts no ChartToolbar — re-derive this probe').toBeGreaterThan(0)
    // ⛔ EVERY mount, not "at least one". StockChart mounts two toolbars and each
    // one owns its own alert popover; a scoped chart whose toolbar happens to be
    // the un-threaded one would show the wrong alert set with nothing to say so.
    expect(withProp, 'a ChartToolbar mount lost its chartId').toBe(total)
  })

  it('⭐ HOP 4 — `ChartToolbar` hands it to the alert popover', () => {
    const { total, withProp } = chartIdOn(
      readSrc('app/src/components/chart/ChartToolbar.jsx'), 'IndicatorAlertPopover')
    expect(total).toBe(1)
    expect(withProp).toBe(1)
  })
})
