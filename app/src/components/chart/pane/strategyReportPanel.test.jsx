// app/src/components/chart/pane/strategyReportPanel.test.jsx
//
// W9-T13b rails: the strategy report panel renders `strategyReportOf(record)` EXACTLY.
//   - fixtures: every served metric served; mixed served/refused (an unpinned rule); a whole-report
//     refusal (a run-wide refusal and a record the report cannot read); zero trades; the product
//     default (the committed, empty pin ledger).
//   - sentence-exact: each refused metric's cell IS the report's sentence; the D2 start sentence
//     is the record's, verbatim, and it is visible on every tab.
//   - no guard id string (`runtime:...`, `pine:...`) reaches the DOM, on any tab, in any fixture.
//   - gate off: the one mount renders nothing, whatever the store holds.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import StrategyReportPanel, { OVERVIEW_KEYS, TABS, memberSentence, metricLabel, formatMetric } from './StrategyReportPanel'
import AttachedStrategyReports from './AttachedStrategyReports'

// engine-40 bytes rail: count every time the lazily loaded half of the mount is actually imported
const LOADED = vi.hoisted(() => ({ count: 0 }))
vi.mock('./StrategyReportsLoaded', async (importOriginal) => {
  LOADED.count += 1
  return importOriginal()
})
import { withoutGuardIds } from '../engine/ast/guardIdText'
import {
  strategyReportOf, SERVED_METRICS, REFUSED_METRICS,
  REPORT_UNSTATED_GUARD, REPORT_UNRECORDED_GUARD, REPORT_UNDEFINED_GUARD, REPORT_RECORD_GUARD,
} from '../engine/runtime/brokerReport.js'
import { strategyRecordOf } from '../engine/runtime/strategyRecord.js'
import { orderLogFor } from '../engine/runtime/__tests__/orderLogFixture.js'
import { UNPINNED_GUARD } from '../engine/runtime/brokerRules.js'
import { BROKER_UNSETTLED_GUARD, BROKER_START_GUARD } from '../engine/runtime/broker.js'
import { setStrategyRecord, resetStrategyRecords } from '../engine/strategyReportNotice'

const ALL = () => true
const except = (...ids) => (id) => !ids.includes(id)
const T0 = 1711027800 // 2024-03-21 13:30 UTC
const DAY = 86400
const at = (i) => T0 + i * DAY
const BAR_TIMES = Array.from({ length: 40 }, (_, i) => at(i))
const START_SENTENCE = 'this backtest starts on 2024-03-21 (UTC); TradingView may start elsewhere'

const tr = (id, dir, qty, e, x, exact = true) => ({
  id, dir: dir === 'long' ? 1 : -1, qty, exact,
  entry: { time: at(e[0]), price: e[1], rule: 'B-MARKET' },
  ...(x ? { exit: { time: at(x[0]), price: x[1], rule: 'B-CLOSE' } } : {}),
})
const recordOf = (trades, { fromListing = false } = {}) => strategyRecordOf({
  summary: { record: { trades, orders: orderLogFor(trades), rulesUsed: ['B-MARKET', 'B-CLOSE'], symbol: { mintick: 0.01, pointvalue: 1 } } },
  decl: { version: 5, initialCapital: 100000, defaultQty: 1, pyramiding: 1, fromListing, defaulted: {} },
  barTimes: BAR_TIMES, historyWindowBars: 5000, confirmed: true,
})
// 4 closed (+6, -5, 0, +4) and 1 open: net 5, PF 2 (hand-checked in w9T13aBrokerReport.test.js)
const A = recordOf([
  tr('L1', 'long', 2, [1, 10], [3, 13]),
  tr('S1', 'short', 1, [4, 20], [6, 25]),
  tr('L2', 'long', 3, [7, 5], [9, 5]),
  tr('L3', 'long', 1, [10, 50], [12, 54]),
  tr('L4', 'long', 1, [13, 30], null),
])
const ZERO = recordOf([])
const RUN_REFUSED = {
  ...A,
  refusals: [{ rule: 'B-PATH', guard: UNPINNED_GUARD, time: at(5),
    sentence: 'This backtest stopped: it reached the broker rule B-PATH, which no TradingView capture pins yet (runtime:strategy-unpinned).' }],
}

const FIXTURES = {
  allServed: strategyReportOf(A, { isPinned: ALL }),
  mixed: strategyReportOf(A, { isPinned: except('B-DEFAULTS') }),
  zeroTrades: strategyReportOf(ZERO, { isPinned: ALL }),
  runRefused: strategyReportOf(RUN_REFUSED, { isPinned: ALL }),
  badRecord: strategyReportOf({ schema: 'nope' }, { isPinned: ALL }),
  productDefault: strategyReportOf(A),
  fromListing: strategyReportOf(recordOf([], { fromListing: true }), { isPinned: ALL }),
}

const GUARD_IDS = [UNPINNED_GUARD, REPORT_UNSTATED_GUARD, REPORT_UNRECORDED_GUARD, REPORT_UNDEFINED_GUARD,
  REPORT_RECORD_GUARD, BROKER_UNSETTLED_GUARD, BROKER_START_GUARD, 'pine:strategy-call']
const GUARD_SHAPE = /\b(?:runtime|pine):[a-z]/i

afterEach(() => { cleanup(); vi.unstubAllEnvs(); resetStrategyRecords() })

const clickTab = (label) => fireEvent.click(screen.getByRole('tab', { name: label }))
const rowOf = (key) => screen.getByTestId(`strategy-report-metric-${key}`)
const valueCell = (key) => rowOf(key).querySelector('td')

describe('W9-T13b the fixtures are what they say', () => {
  it('all served / mixed / zero / refused / bad / product default', () => {
    const servedKeys = Object.keys(SERVED_METRICS)
    expect(servedKeys.every((k) => FIXTURES.allServed.metrics[k].status === 'served')).toBe(true)
    const mixed = servedKeys.map((k) => FIXTURES.mixed.metrics[k].status)
    expect(mixed).toContain('served')
    expect(mixed).toContain('refused')
    expect(FIXTURES.zeroTrades.trades).toEqual({ status: 'served', rows: [] })
    expect(FIXTURES.runRefused.status).toBe('refused')
    expect(FIXTURES.badRecord.status).toBe('refused')
    expect(FIXTURES.badRecord.window).toBe(null)
    expect(servedKeys.every((k) => FIXTURES.productDefault.metrics[k].status === 'refused')).toBe(true)
    expect(FIXTURES.allServed.window.sentence).toBe(START_SENTENCE)
    expect(FIXTURES.fromListing.window.fromListing).toBe(true)
    expect(FIXTURES.fromListing.window.sentence).toBe(START_SENTENCE)
  })
})

describe('W9-T13b the panel renders the report exactly', () => {
  it('all served: every served metric shows its label and formatted value; refused ones their sentence', () => {
    render(<StrategyReportPanel report={FIXTURES.allServed} name="RDDT test" />)
    clickTab('Performance summary')
    const want = {
      totalClosedTrades: '4', totalOpenTrades: '1', numberWinningTrades: '2', numberLosingTrades: '1',
      numberEvenTrades: '1', netProfit: '5.00', netProfitPercent: '0.005%', grossProfit: '10.00',
      grossLoss: '5.00', profitFactor: '2.000',
    }
    for (const [k, v] of Object.entries(want)) {
      expect(rowOf(k).querySelector('th').textContent).toBe(SERVED_METRICS[k].label)
      expect(valueCell(k).textContent).toBe(v)
      expect(rowOf(k).getAttribute('data-status')).toBe('served')
    }
    for (const [k, r] of Object.entries(REFUSED_METRICS)) {
      expect(rowOf(k).querySelector('th').textContent).toBe(r.label)
      expect(valueCell(k).textContent).toBe(FIXTURES.allServed.metrics[k].sentence)
    }
    // every metric of the report is a row, in the report's order; none missing, none added
    const rows = within(screen.getByTestId('strategy-report-summary')).getAllByTestId(/^strategy-report-metric-/)
    expect(rows.map((r) => r.getAttribute('data-testid').replace('strategy-report-metric-', '')))
      .toEqual(Object.keys(FIXTURES.allServed.metrics))
  })

  it('sentence-exact: the D8 refusal sentences, literally', () => {
    render(<StrategyReportPanel report={FIXTURES.allServed} />)
    clickTab('Performance summary')
    expect(valueCell('maxDrawdown').textContent).toBe("Max drawdown is not shown: we do not yet know exactly how "
      + "TradingView's Strategy Tester computes it, and it has not yet been checked against TradingView.")
    expect(valueCell('sharpeRatio').textContent).toBe("Sharpe ratio is not shown: we do not yet know exactly how "
      + "TradingView's Strategy Tester computes it, and it has not yet been checked against TradingView.")
    expect(valueCell('equity').textContent).toBe("Equity is not shown: it includes the open trades' profit at the "
      + "last bar's close, and the backtest record does not carry that yet.")
  })

  it('mixed: a metric resting on an unpinned rule shows the unpinned sentence; counts still serve', () => {
    render(<StrategyReportPanel report={FIXTURES.mixed} />)
    clickTab('Performance summary')
    expect(valueCell('totalClosedTrades').textContent).toBe('4')
    expect(valueCell('netProfit').textContent).toBe('Net profit is not shown: it depends on a rule of how TradingView runs '
      + 'a backtest that has not yet been checked against TradingView.')
    expect(valueCell('numberWinningTrades').textContent).toBe(FIXTURES.mixed.metrics.numberWinningTrades.sentence)
    // the trade list serves (its fills' rules are pinned); each closed profit carries its refusal
    clickTab('List of trades')
    const row1 = screen.getByTestId('strategy-report-trade-1')
    expect(row1.querySelectorAll('td')[8].textContent).toBe(FIXTURES.mixed.trades.rows[0].profit.sentence)
    expect(FIXTURES.mixed.trades.rows[0].profit.sentence).toMatch(/^Trade 1's profit is not shown: /)
  })

  it('the trade list: every trade a row, served profits, the open trade says why it has none', () => {
    render(<StrategyReportPanel report={FIXTURES.allServed} />)
    clickTab('List of trades')
    const table = screen.getByTestId('strategy-report-trades')
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 5)
    const cells = (n) => [...screen.getByTestId(`strategy-report-trade-${n}`).children].map((c) => c.textContent)
    // W9-T7-F1: each fill's signal (its order's comment, else its id); these fixtures close by strategy.close
    // without a comment, an exit TradingView names itself, so the exit signal says why it is not shown
    const unnamed = (n) => `Trade ${n}'s exit signal is not shown: TradingView names this kind of exit itself, and that `
      + 'name has not yet been checked against TradingView.'
    expect(cells(1)).toEqual(['1', 'Long', '2', 'L1', '2024-03-22 13:30', '10.00', unnamed(1), '2024-03-24 13:30', '13.00', '6.00'])
    expect(cells(2)).toEqual(['2', 'Short', '1', 'S1', '2024-03-25 13:30', '20.00', unnamed(2), '2024-03-27 13:30', '25.00', '-5.00'])
    expect(cells(5).slice(0, 9)).toEqual(['5', 'Long', '1', 'L4', '2024-04-03 13:30', '30.00', '', 'Open', ''])
    expect(cells(5)[9]).toBe("This open trade's profit is not shown: it is its profit at the last bar's close, "
      + 'and the backtest record does not carry that yet.')
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent))
      .toEqual(['Trade', 'Direction', 'Size', 'Entry signal', 'Entry (UTC)', 'Entry price', 'Exit signal', 'Exit (UTC)',
        'Exit price', 'Profit'])
  })

  it('zero trades: the list says so, and the counts are 0 (no D10 floor)', () => {
    render(<StrategyReportPanel report={FIXTURES.zeroTrades} />)
    expect(valueCell('totalClosedTrades').textContent).toBe('0')
    clickTab('List of trades')
    expect(screen.getByTestId('strategy-report-trades-empty').textContent).toBe('This backtest placed no trades.')
    expect(screen.queryByTestId('strategy-report-trades')).toBe(null)
  })

  it('a refused trade list shows its sentence in place of the list', () => {
    const rep = strategyReportOf(A, { isPinned: except('B-CLOSE') })
    expect(rep.trades.status).toBe('refused')
    render(<StrategyReportPanel report={rep} />)
    clickTab('List of trades')
    expect(screen.getByTestId('strategy-report-trades-refused').textContent).toBe(rep.trades.sentence)
  })

  it('a run-wide refusal: the report holds only the refusal (no tabs, no metrics), and the start sentence', () => {
    render(<StrategyReportPanel report={FIXTURES.runRefused} />)
    expect(screen.getByTestId('strategy-report').getAttribute('data-status')).toBe('refused')
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.queryAllByTestId(/^strategy-report-metric-/)).toHaveLength(0)
    const items = within(screen.getByTestId('strategy-report-refusals')).getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual([
      'This backtest stopped: it reached the broker rule B-PATH, which no TradingView capture pins yet.'])
    expect(screen.getByTestId('strategy-report-start-sentence').textContent).toBe(START_SENTENCE)
  })

  it('a record the report cannot read: the refusal alone, no stamp (there is no window)', () => {
    render(<StrategyReportPanel report={FIXTURES.badRecord} />)
    const items = within(screen.getByTestId('strategy-report-refusals')).getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual([FIXTURES.badRecord.refusals[0].sentence])
    expect(screen.queryByTestId('strategy-report-stamp')).toBe(null)
  })

  it('the product default (empty ledger): every served metric refuses by its unpinned sentence', () => {
    render(<StrategyReportPanel report={FIXTURES.productDefault} />)
    clickTab('Performance summary')
    for (const k of Object.keys(SERVED_METRICS)) {
      expect(valueCell(k).textContent).toBe(FIXTURES.productDefault.metrics[k].sentence)
      expect(valueCell(k).textContent).toMatch(/ is not shown: it depends on a rule of how TradingView runs a backtest /)
    }
  })
})

describe('W9-T13b ruling D2: the start sentence is always visible', () => {
  it('on every tab, verbatim, above the tabs', () => {
    render(<StrategyReportPanel report={FIXTURES.allServed} />)
    for (const t of TABS) {
      clickTab(t.label)
      const s = screen.getByTestId('strategy-report-start-sentence')
      expect(s.textContent).toBe(START_SENTENCE)
      expect(s.closest('[role="tabpanel"]')).toBe(null)
    }
    expect(screen.getByTestId('strategy-report-asof').textContent)
      .toBe(`Starts 2024-03-21 (UTC) · As of the bar closed ${FIXTURES.allServed.window.asOfDate} (UTC)`)
  })

  it('r1, D2 ALWAYS: a run from the listing shows the same sentence on every tab (the plan bar limit can move the TradingView start)', () => {
    render(<StrategyReportPanel report={FIXTURES.fromListing} />)
    for (const t of TABS) {
      clickTab(t.label)
      const s = screen.getByTestId('strategy-report-start-sentence')
      expect(s.textContent).toBe(START_SENTENCE)
      expect(s.closest('[role="tabpanel"]')).toBe(null)
    }
    expect(screen.getByTestId('strategy-report-asof').textContent).toMatch(/^Starts 2024-03-21 \(UTC\) · /)
  })
})

describe('W9-T13b no guard id reaches the DOM', () => {
  for (const [name, rep] of Object.entries(FIXTURES)) {
    it(`fixture ${name}, every tab`, () => {
      const { container } = render(<StrategyReportPanel report={rep} />)
      const check = () => {
        const html = container.innerHTML
        for (const g of GUARD_IDS) expect(html, g).not.toContain(g)
        expect(html).not.toMatch(GUARD_SHAPE)
      }
      check()
      for (const t of screen.queryAllByRole('tab')) { fireEvent.click(t); check() }
    })
  }

  it('the fixtures DO carry guard ids (the rail above is not vacuous)', () => {
    expect(JSON.stringify(FIXTURES.runRefused)).toContain(UNPINNED_GUARD)
    expect(JSON.stringify(FIXTURES.allServed)).toContain(REPORT_UNSTATED_GUARD)
    expect(JSON.stringify(FIXTURES.badRecord)).toContain(REPORT_RECORD_GUARD)
  })

  it('memberSentence strips a quoted guard id and changes nothing else', () => {
    expect(memberSentence('it stopped (runtime:strategy-unpinned).')).toBe('it stopped.')
    // r3: a bare id is left in place (its composer's to fix); only quoted ids are removed
    expect(memberSentence('refused (pine:strategy-call) here')).toBe('refused here')
    const plain = FIXTURES.allServed.metrics.maxDrawdown.sentence
    expect(memberSentence(plain)).toBe(plain)
    expect(memberSentence(START_SENTENCE)).toBe(START_SENTENCE)
  })

  it('r2: the panel delegates to the shared rule (ast/sentence.js::withoutGuardIds) and only adds the empty fallback', () => {
    expect(memberSentence('')).toBe('This was not shown, and the backtest did not record why.')
    for (const s of ['it stopped (runtime:strategy-unpinned).', 'refused pine:strategy-call here', 'refused enum:bad-value here', 'stopped (strategy:no-fill).', START_SENTENCE]) {
      expect(memberSentence(s)).toBe(withoutGuardIds(s))
    }
  })

  // The review's three probes, against the shared helper at r3 (fix/pine-disclosure-no-guard-ids be3d512b38).
  // r3 strips QUOTED ids only, keeping brackets balanced; a BARE id is left in place by design ("that
  // sentence is its composer's to fix"), so no subject or noun is ever eaten. The report's own sentences
  // carry no bare id (rail: w9T13aBrokerReport "plain words"), so none reaches this panel's DOM.
  const balanced = (out) => (out.match(/\(/g) || []).length === (out.match(/\)/g) || []).length
  it('r3 probe 1: an id inside a parenthetical goes, the bracket stays balanced, no dangling comma', () => {
    const out = memberSentence('(capture row Q-S1a, runtime:strategy-unsettled).')
    expect(out).toBe('(capture row Q-S1a).')
    expect(balanced(out)).toBe(true)
  })
  it('r3 probes 2 and 3: a bare id is left whole (no hole where the subject or noun was)', () => {
    expect(memberSentence('pine:strategy-call stops this.')).toBe('pine:strategy-call stops this.')
    expect(memberSentence('Use the runtime:limit (budget) guard.')).toBe('Use the runtime:limit (budget) guard.')
  })
})

describe('W9-T13b one authority for names and formats', () => {
  it('labels come from the report module', () => {
    for (const k of Object.keys(SERVED_METRICS)) expect(metricLabel(k)).toBe(SERVED_METRICS[k].label)
    for (const [k, r] of Object.entries(REFUSED_METRICS)) {
      expect(metricLabel(k)).toBe(r.label)
      expect(r.sentence.startsWith(`${r.label} is not shown: `)).toBe(true)
    }
    for (const k of OVERVIEW_KEYS) expect(Object.keys(FIXTURES.allServed.metrics)).toContain(k)
    expect(formatMetric('netProfitPercent', 0.005)).toBe('0.005%')
  })

  it('tabs are a real tablist: one selected, arrow keys move selection', () => {
    render(<StrategyReportPanel report={FIXTURES.allServed} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Overview', 'Performance summary', 'List of trades'])
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])
    const selected = () => screen.getAllByRole('tab').map((t) => t.getAttribute('aria-selected'))
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
    expect(selected()).toEqual(['false', 'true', 'false'])
    const panel = screen.getByRole('tabpanel')
    expect(panel.getAttribute('aria-labelledby')).toBe(screen.getAllByRole('tab')[1].id)
    // r2 (review M5/M6): ArrowLeft wraps from the first tab to the last, End goes last, Home goes first
    fireEvent.keyDown(screen.getAllByRole('tab')[1], { key: 'ArrowLeft' })
    expect(selected()).toEqual(['true', 'false', 'false'])
    fireEvent.keyDown(screen.getAllByRole('tab')[0], { key: 'ArrowLeft' })
    expect(selected()).toEqual(['false', 'false', 'true'])
    expect(document.activeElement).toBe(screen.getAllByRole('tab')[2])
    fireEvent.keyDown(screen.getAllByRole('tab')[2], { key: 'Home' })
    expect(selected()).toEqual(['true', 'false', 'false'])
    fireEvent.keyDown(screen.getAllByRole('tab')[0], { key: 'End' })
    expect(selected()).toEqual(['false', 'false', 'true'])
    fireEvent.keyDown(screen.getAllByRole('tab')[2], { key: 'ArrowRight' })
    expect(selected()).toEqual(['true', 'false', 'false'])
  })

  it('r2: every aria-controls names a panel that is in the DOM, on every tab', () => {
    render(<StrategyReportPanel report={FIXTURES.allServed} />)
    for (const t of TABS) {
      clickTab(t.label)
      const controls = screen.getAllByRole('tab').map((el) => el.getAttribute('aria-controls')).filter(Boolean)
      expect(controls).toHaveLength(1)
      for (const id of controls) expect(document.getElementById(id), id).not.toBe(null)
    }
  })

  it('r2: tap targets are 44px across the whole touch tier (<=1024), not only on phones', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    for (const [file, sel] of [['StrategyReportPanel.module.css', '.tab'], ['AttachedStrategyReports.module.css', '.summary']]) {
      const css = fs.readFileSync(path.join(here, file), 'utf8')
      const block = css.match(/@media \(max-width: 1024px\) \{([\s\S]*?)\r?\n\}/)
      expect(block, file).not.toBe(null)
      expect(block[1], file).toMatch(new RegExp(`\\${sel} \\{[^}]*min-height: var\\(--tap-min, 44px\\)`))
    }
  })
})

describe('W9-T13b the mount is dark behind VITE_PINE_STRATEGY_BROKER_ENABLED', () => {
  const SETTINGS = { indicatorInstances: [{ instanceId: 'i1', defId: 'u_strat' }, { instanceId: 'i2', defId: 'u_strat', hidden: true }] }
  const REGISTRY = { getDefinition: () => ({ meta: { name: 'My strategy' } }) }
  beforeEach(() => {
    setStrategyRecord('i1', A, 'scopeA')
    setStrategyRecord('i2', A, 'scopeA')
  })

  for (const v of [undefined, '', '0', 'true']) {
    it(`gate ${JSON.stringify(v)}: nothing renders AND nothing is imported, whatever the store holds`, async () => {
      if (v !== undefined) vi.stubEnv('VITE_PINE_STRATEGY_BROKER_ENABLED', v)
      const { container } = render(<AttachedStrategyReports settings={SETTINGS} registry={REGISTRY} noticeScope="scopeA" />)
      await new Promise((r) => setTimeout(r, 30))
      expect(container.innerHTML).toBe('')
      // engine-40 bytes: the report module (panel, brokerReport, CSS) was never requested. ABSOLUTE 0:
      // these cases run before any gate-on case in this file, so a static import would already read 1
      expect(LOADED.count).toBe(0)
    })
  }

  it('gate "1" but no record: nothing renders and nothing is imported', async () => {
    vi.stubEnv('VITE_PINE_STRATEGY_BROKER_ENABLED', '1')
    resetStrategyRecords()
    const { container } = render(<AttachedStrategyReports settings={SETTINGS} registry={REGISTRY} noticeScope="scopeA" />)
    await new Promise((r) => setTimeout(r, 30))
    expect(container.innerHTML).toBe('')
    expect(LOADED.count).toBe(0)
  })

  it('gate "1" (CONTROL): the drawn strategy shows its report, the hidden one does not', async () => {
    vi.stubEnv('VITE_PINE_STRATEGY_BROKER_ENABLED', '1')
    const { container } = render(<AttachedStrategyReports settings={SETTINGS} registry={REGISTRY} noticeScope="scopeA" />)
    expect(await screen.findAllByTestId('strategy-report')).toHaveLength(1)
    expect(LOADED.count).toBeGreaterThan(0)
    expect(container.querySelector('summary').textContent).toBe('My strategy: strategy report')
    expect(screen.getByTestId('strategy-report-start-sentence').textContent).toBe(START_SENTENCE)
  })

  it('gate "1": another binder scope, or no record, renders nothing', () => {
    vi.stubEnv('VITE_PINE_STRATEGY_BROKER_ENABLED', '1')
    const { container } = render(<AttachedStrategyReports settings={SETTINGS} registry={REGISTRY} noticeScope="scopeB" />)
    expect(container.innerHTML).toBe('')
  })

  it('the panel has ONE mount: only AttachedStrategyReports imports it, and only ChartPane imports that', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const src = path.resolve(here, '../../..')
    const importers = (name) => {
      const out = []
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name)
          if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue }
          if (!/\.(jsx?|mjs)$/.test(e.name) || /\.test\./.test(e.name)) continue
          const s = fs.readFileSync(p, 'utf8')
          if (new RegExp(`^\\s*import\\s[^;]*from\\s+['"][^'"]*/${name}(\\.jsx)?['"]`, 'm').test(s)) out.push(path.basename(p))
        }
      }
      walk(src)
      return out.sort()
    }
    expect(importers('StrategyReportPanel')).toEqual(['StrategyReportsLoaded.jsx'])
    expect(importers('AttachedStrategyReports')).toEqual(['ChartPane.jsx'])
    // engine-40 bytes: the loaded half is reached ONLY by AttachedStrategyReports' dynamic import,
    // and the mount imports neither the report module nor the panel statically
    expect(importers('StrategyReportsLoaded')).toEqual([])
    const mount = fs.readFileSync(path.join(here, 'AttachedStrategyReports.jsx'), 'utf8')
    expect(mount).toMatch(/lazy\(\(\) => import\('\.\/StrategyReportsLoaded'\)\)/)
    expect(mount).not.toMatch(/^import[^\n]*(brokerReport|StrategyReportPanel|\.module\.css)/m)
    const report = fs.readFileSync(path.join(here, '../engine/runtime/brokerReport.js'), 'utf8')
    expect(report, 'brokerReport must not import the broker (it split broker.js into a shared chunk)').not.toMatch(/^import[^\n]*from '\.\/broker\.js'/m)
  })
})

describe('W9-T7-F1 r1 (review N1) a reversed trade\'s exit signal: the plain refusal, never the reversing entry\'s comment', () => {
  // trade 1 long L, closed on bar 6 by the reversing short entry S (comment "flip"), which opens trade 2
  const rev = () => {
    const trades = [tr('L', 'long', 1, [1, 10], [6, 12]), tr('S', 'short', 1, [6, 12], null)]
    const orders = orderLogFor(trades, { entryComments: [null, 'flip'] })
    // the broker logs a reversal as ONE row: the entry S, which closed trade 1 and opened trade 2
    const s = orders.find((o) => o.kind === 'entry' && o.id === 'S')
    const c = orders.find((o) => o.kind === 'close')
    s.closed = c.closed
    const log = orders.filter((o) => o !== c).map((o, i) => ({ ...o, n: i + 1 }))
    return strategyRecordOf({ summary: { record: { trades, orders: log, rulesUsed: ['B-MARKET', 'B-CLOSE'], symbol: { mintick: 0.01, pointvalue: 1 } } },
      decl: { version: 5, initialCapital: 100000, defaultQty: 1, pyramiding: 1, defaulted: {} },
      barTimes: BAR_TIMES, historyWindowBars: 5000, confirmed: true })
  }
  const SENT = "Trade 1's exit signal is not shown: this trade was closed by the order that reversed the position, and what "
    + 'TradingView shows for that exit has not yet been checked against TradingView.'

  it('the panel shows the plain sentence in that cell; the reversing entry\'s own entry signal is served', () => {
    const report = strategyReportOf(rev(), { isPinned: ALL })
    expect(report.trades.rows[0].exitSignal).toMatchObject({ status: 'refused', guard: REPORT_UNSTATED_GUARD, row: 'W9-V1', sentence: SENT })
    expect(report.trades.rows[1].entrySignal).toEqual({ status: 'served', value: 'flip' })
    render(<StrategyReportPanel report={report} />)
    clickTab('List of trades')
    const cells = (n) => [...screen.getByTestId(`strategy-report-trade-${n}`).children].map((c) => c.textContent)
    expect(cells(1)[6]).toBe(SENT)
    expect(cells(1)[6]).not.toMatch(/flip|W9-V1|runtime:/)
    expect(cells(2)[3]).toBe('flip')
  })
})
