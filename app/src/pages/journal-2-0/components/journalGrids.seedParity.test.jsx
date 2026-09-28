// app/src/pages/journal-2-0/components/journalGrids.seedParity.test.jsx
//
// ─── TERM-065 — THE TWO JOURNAL GRIDS RENDER IDENTICALLY ON THE DATAGRID SEED ──
//
//     cd app && npx vitest run src/pages/journal-2-0/components/journalGrids.seedParity.test.jsx
//
// `TradesTable` and `PositionsTable` each hand-rolled the same four things: a
// sort state, a click-to-toggle state machine, a blanks-sink comparator and the
// `aria-sort` / caret derivation. TERM-065 moves all four into
// `lib/presentation/dataGrid/` and leaves each grid's DOM where it was.
//
// ⛔ THIS FILE WAS WRITTEN AND RUN AGAINST THE PRE-SEED CODE FIRST. Its snapshot
// (`__snapshots__/journalGrids.seedParity.test.jsx.snap`) was recorded by the
// hand-rolled implementations, then the migration landed WITHOUT `-u`. A diff to
// that snapshot is a member-visible change and is never "updated through".
//
// What it pins, per grid, from ONE fixture built to hit every branch the
// comparator has (null, '', ties that reach the tiebreak, text vs numeric, the
// option row, the unstopped row, the unpriced row):
//   • the full rendered HTML of the default state and of one sorted state —
//     same elements, same CSS-module class hooks, same attributes;
//   • for EVERY sortable header, clicked once and then again: the row order,
//     the `aria-sort` vector across the header row, the caret vector, and a
//     digest of the whole rendered table;
//   • the empty state's HTML.
// And, separately, that column visibility still persists under the SAME
// localStorage keys the tabs have always used — a renamed key would silently
// reset every member's column choice.

import { useState } from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, act, cleanup } from '@testing-library/react'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

// TickerPopup pulls in AuthContext via useFlagged; the same inert stand-in
// PositionsTable.test.jsx uses. It renders its children, so the symbol text is
// still what the row shows.
vi.mock('../../../components/TickerPopup', () => ({
  default: ({ as: Tag = 'span', className, children }) => <Tag className={className}>{children}</Tag>,
}))

import TradesTable, { buildTradesColumns } from './TradesTable'
import PositionsTable, { POSITIONS_COLUMNS } from './PositionsTable'
import useJ2ColumnPrefs from '../hooks/useJ2ColumnPrefs'

beforeEach(() => localStorage.clear())

// A short, dependency-free digest (FNV-1a, 32-bit) so the per-click trace can
// carry "the whole table" without storing ~50 copies of its HTML.
function digest(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function snapshotState(container, label) {
  const ths = [...container.querySelectorAll('thead th')]
  const rows = [...container.querySelectorAll('tbody tr')]
  return {
    after: label,
    order: rows.map((r) => r.querySelector('td')?.textContent ?? ''),
    ariaSort: ths.map((th) => th.getAttribute('aria-sort') ?? '∅'),
    carets: ths.map((th) => th.querySelector('[aria-hidden="true"]')?.textContent ?? '∅').join('|'),
    html: digest(container.innerHTML),
  }
}

/** Click every sortable header twice, in header order, recording each state. */
function walkEveryHeader(container) {
  const trace = [snapshotState(container, 'initial')]
  const count = container.querySelectorAll('thead th button').length
  for (let i = 0; i < count; i += 1) {
    for (const n of [1, 2]) {
      const btn = container.querySelectorAll('thead th button')[i]
      const name = btn.textContent
      act(() => { fireEvent.click(btn) })
      trace.push(snapshotState(container, `${name} ×${n}`))
    }
  }
  return trace
}

// ── fixtures ────────────────────────────────────────────────────────────────

const T = {
  userId: 'u1', positionId: 'p1', side: 'Long', notes: null, createdAt: '2026-04-10T00:00:00Z',
}
const TRADES = [
  { ...T, id: 't1', symbol: 'AAA', shares: 100, entryPrice: 10, entryDate: '2026-03-01T00:00:00Z', exitPrice: 12, exitDate: '2026-03-05T00:00:00Z', originalStop: 9, setup: 'VCP', pnlDollar: 200, pnlDollarNet: 195, fees: 5, pnlPercent: 0.2, rMultiple: 2, holdDays: 4, result: 'Win' },
  { ...T, id: 't2', symbol: 'BBB', shares: 50, entryPrice: 20, entryDate: '2026-04-01T00:00:00Z', exitPrice: 18, exitDate: '2026-04-02T00:00:00Z', originalStop: 19, setup: '', pnlDollar: -100, pnlDollarNet: null, fees: null, pnlPercent: -0.1, rMultiple: -2, holdDays: 1, result: 'Loss' },
  // Ties with t1 on P&L $ and on Setup, so the tiebreak (newest entry, then id) decides.
  { ...T, id: 't3', symbol: 'CCC', shares: 100, entryPrice: 5, entryDate: '2026-05-01T00:00:00Z', exitPrice: 7, exitDate: '2026-05-09T00:00:00Z', originalStop: null, setup: 'VCP', pnlDollar: 200, pnlDollarNet: 190, fees: 10, pnlPercent: 0.4, rMultiple: null, holdDays: 8, result: 'Win' },
  { ...T, id: 't4', symbol: 'DDD', shares: 1.5, entryPrice: 100, entryDate: '2026-05-01T00:00:00Z', exitPrice: 100, exitDate: null, originalStop: 95, setup: null, pnlDollar: null, pnlDollarNet: null, fees: 0, pnlPercent: null, rMultiple: 0, holdDays: null, result: 'BE' },
  { ...T, id: 't5', symbol: 'EEE', shares: 10, entryPrice: 3, entryDate: '2026-02-01T00:00:00Z', exitPrice: 2, exitDate: '2026-02-03T00:00:00Z', originalStop: 2.5, setup: 'Breakout', pnlDollar: -10, pnlDollarNet: -12, fees: 2, pnlPercent: -0.33, rMultiple: -1.5, holdDays: 2, result: 'Loss', isOption: false },
]

const P = {
  userId: 'u1', originalShares: 100, breakevenStop: null, raiseToBreakeven: false, setup: null,
  notes: null, contextAtEntry: {}, createdAt: '2026-04-09T00:00:00Z', updatedAt: '2026-04-09T00:00:00Z', closedAt: null,
}
const POSITIONS = [
  { ...P, id: 'p1', symbol: 'MMM', side: 'Long', entryDate: '2026-04-09T00:00:00Z', shares: 100, entryPrice: 30, stopPrice: 28 },
  { ...P, id: 'p2', symbol: 'AAA', side: 'Short', entryDate: '2026-03-01T00:00:00Z', shares: 40, entryPrice: 50, stopPrice: 55 },
  // No real stop (manual row seeded with 0) — its stop/risk/heat sort as blanks.
  { ...P, id: 'p3', symbol: 'ZZZ', side: 'Long', entryDate: '2026-05-01T00:00:00Z', shares: 10, entryPrice: 100, stopPrice: 0 },
  // Unpriced — every price-derived column is blank for it.
  { ...P, id: 'p4', symbol: 'QQQ', side: 'Long', entryDate: '2026-02-01T00:00:00Z', shares: 5, entryPrice: 400, stopPrice: 380 },
  // Estimated entry date — sorts as a blank on Date.
  { ...P, id: 'p5', symbol: 'BBB', side: 'Long', entryDate: '2026-01-15T00:00:00Z', entryEstimated: true, shares: 100, entryPrice: 30, stopPrice: 29 },
  {
    id: 9, isOption: true, symbol: 'CRWV Oct 16 $110C', side: 'Long Call', sideKind: 'long',
    underlying: 'CRWV', shares: 2, entryPrice: 2, entryDate: '2026-04-20T00:00:00Z',
    optCurrent: 3, optMarketValue: 600, optPnlDollar: 200, optPnlPercent: 0.5, strategy: { id: 's9' },
  },
]
const PRICES = { MMM: { price: 33 }, AAA: { price: 45 }, ZZZ: { price: 110 }, BBB: { price: 33 } }
const ACCOUNT = 100_000

// ── the grids ───────────────────────────────────────────────────────────────

describe('TradesTable renders identically on the DataGrid seed', () => {
  const ALL = buildTradesColumns()

  it('default render — full HTML', () => {
    const { container } = render(<TradesTable trades={TRADES} visibleColumns={ALL} />)
    expect(container.innerHTML).toMatchSnapshot()
  })

  it('every header, clicked twice — order, aria-sort, carets and the table digest', () => {
    const { container } = render(<TradesTable trades={TRADES} visibleColumns={ALL} />)
    const trace = walkEveryHeader(container)
    // CONTROL: the walk really visited every column (15), and sorting really
    // moved rows — a trace of 31 identical orders would pass vacuously.
    expect(trace).toHaveLength(1 + 2 * ALL.length)
    expect(new Set(trace.map((s) => s.order.join(','))).size).toBeGreaterThan(4)
    expect(trace).toMatchSnapshot()
  })

  it('a sorted state — full HTML', () => {
    const { container } = render(<TradesTable trades={TRADES} visibleColumns={ALL} />)
    const btn = [...container.querySelectorAll('thead th button')].find((b) => b.textContent.startsWith('P&L $'))
    act(() => { fireEvent.click(btn) })
    expect(container.innerHTML).toMatchSnapshot()
  })

  it('empty state — full HTML', () => {
    const { container } = render(<TradesTable trades={[]} visibleColumns={ALL} />)
    expect(container.innerHTML).toMatchSnapshot()
  })
})

describe('PositionsTable renders identically on the DataGrid seed', () => {
  const grid = (positions = POSITIONS) => (
    <PositionsTable positions={positions} prices={PRICES} accountSize={ACCOUNT} visibleColumns={POSITIONS_COLUMNS} />
  )

  it('default render — full HTML', () => {
    const { container } = render(grid())
    expect(container.innerHTML).toMatchSnapshot()
  })

  it('every header, clicked twice — order, aria-sort, carets and the table digest', () => {
    const { container } = render(grid())
    const trace = walkEveryHeader(container)
    // 15 sortable columns — Actions has no button.
    expect(trace).toHaveLength(1 + 2 * (POSITIONS_COLUMNS.length - 1))
    expect(new Set(trace.map((s) => s.order.join(','))).size).toBeGreaterThan(4)
    expect(trace).toMatchSnapshot()
  })

  it('a sorted state — full HTML', () => {
    const { container } = render(grid())
    const btn = [...container.querySelectorAll('thead th button')].find((b) => b.textContent.startsWith('P&L $'))
    act(() => { fireEvent.click(btn) })
    expect(container.innerHTML).toMatchSnapshot()
  })

  it('empty state — full HTML', () => {
    const { container } = render(grid([]))
    expect(container.innerHTML).toMatchSnapshot()
  })
})

// ── column visibility persists under the SAME keys ──────────────────────────

const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'api'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error('journalGrids.seedParity: could not find the repo root')
})()

const parse = (src) => Parser.extend(jsx()).parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
function walk(node, fn) {
  if (!node || typeof node.type !== 'string') return
  fn(node)
  for (const k of Object.keys(node)) {
    const v = node[k]
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, fn))
    else if (v && typeof v.type === 'string') walk(v, fn)
  }
}

/** What the tab passes as the storage key, and to which hook — read off its AST. */
function storageWiring(tabRel) {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'src', ...tabRel.split('/')), 'utf8')
  let literal = null
  const callees = []
  walk(parse(src), (n) => {
    if (n.type === 'VariableDeclarator' && n.id?.name === 'COLUMN_STORAGE_KEY') literal = n.init?.value
    if (n.type === 'CallExpression' && n.arguments[0]?.type === 'Identifier'
      && n.arguments[0].name === 'COLUMN_STORAGE_KEY') callees.push(n.callee?.name)
  })
  return { literal, callees }
}

// ⛔ These two strings are TYPED on purpose. They are not a derived fact about
// the code — they are the address of data already sitting in members' browsers.
// Changing either orphans every stored column choice, so the pin is the point.
const PERSISTED = [
  { tab: 'pages/journal-2-0/tabs/TradeJournalTab.jsx', key: 'uct.j2.tradeJournal.columns', Grid: 'trades' },
  { tab: 'pages/journal-2-0/tabs/OpenPositionsTab.jsx', key: 'uct.j2.openPositions.columns', Grid: 'positions' },
]

function Harness({ storageKey, kind }) {
  const defaults = kind === 'trades' ? TRADE_DEFAULTS : POSITIONS_COLUMNS
  const { visibleColumns, toggleColumn } = useJ2ColumnPrefs(storageKey, defaults)
  const [, force] = useState(0)
  return (
    <>
      <button type="button" data-testid="toggle-a" onClick={() => { toggleColumn(kind === 'trades' ? 'fees' : 'heat'); force((x) => x + 1) }} />
      <button type="button" data-testid="toggle-b" onClick={() => { toggleColumn(kind === 'trades' ? 'setup' : 'side'); force((x) => x + 1) }} />
      {kind === 'trades'
        ? <TradesTable trades={TRADES} visibleColumns={visibleColumns} />
        : <PositionsTable positions={POSITIONS} prices={PRICES} accountSize={ACCOUNT} visibleColumns={visibleColumns} />}
    </>
  )
}
const TRADE_DEFAULTS = buildTradesColumns()
const headers = (container) => [...container.querySelectorAll('thead th')].map((th) => th.textContent.replace(/[▲▼]/g, ''))

describe('column visibility persists under the same storage keys', () => {
  for (const { tab, key, Grid } of PERSISTED) {
    it(`${tab} still hands ${key} to the column-prefs hook`, () => {
      const { literal, callees } = storageWiring(tab)
      expect(literal).toBe(key)
      expect(callees).toEqual(['useJ2ColumnPrefs'])
    })

    it(`a toggled column survives a remount under ${key}`, () => {
      const first = render(<Harness storageKey={key} kind={Grid} />)
      const before = headers(first.container)
      act(() => { fireEvent.click(first.getByTestId('toggle-a')) })
      act(() => { fireEvent.click(first.getByTestId('toggle-b')) })
      const toggled = headers(first.container)
      expect(toggled).not.toEqual(before)
      first.unmount()
      cleanup()

      const stored = JSON.parse(localStorage.getItem(key))
      expect(Object.keys(stored).sort()).toEqual(['hidden', 'order'])
      expect({ before, toggled, stored }).toMatchSnapshot()

      const second = render(<Harness storageKey={key} kind={Grid} />)
      expect(headers(second.container)).toEqual(toggled)
    })
  }
})
