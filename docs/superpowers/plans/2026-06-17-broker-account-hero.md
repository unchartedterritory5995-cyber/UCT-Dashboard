# Broker Account Hero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A prominent broker-app-style hero at the top of Open Positions for broker accounts — big account value, Today + period P&L, large equity chart, and a secondary balances strip.

**Architecture:** One new component `BrokerAccountHero` that reuses `useBrokerEquityCurve` (chart + change), the selected account object (net-liq/cash/buying-power), and the already-computed `portfolioAggregates` (open P&L / invested %). `OpenPositionsTab` swaps `<BrokerEquityCurve />` → `<BrokerAccountHero account={selectedAccount} aggregates={aggregates} />` — one line in the parallel session's hot file.

**Tech Stack:** React + Vite, CSS modules, self-contained SVG curve (no chart lib), Vitest + React Testing Library.

## Global Constraints

- Broker accounts only: render `null` unless `account.balanceSource === 'broker'` and `account.brokerTotalEquity != null`. Manual accounts show nothing (the existing stats row always renders below).
- No backend changes. Reuse existing hooks/helpers; do not refetch live prices (take `aggregates` as a prop).
- Copy existing `percent(...)` call forms verbatim — invested: `percent(x, { dp: 1 })`; change %: `percent(x, { signed: true, dp: 1, isRatio: true })`.
- Mirror the broker (`feedback_broker_mirror_fidelity`); Risk/Heat stay in the row below, not in the hero.
- Canonical breakpoints only (640 / 1024) — no new literals.
- Shared worktree: stage only own files; re-read `OpenPositionsTab.jsx` immediately before the one-line edit; rebase cleanly over any partner commit; FF-push `worktree-broker-sync:master`.

---

## File Structure

- `app/src/pages/journal-2-0/components/BrokerAccountHero.jsx` — **create** the hero component.
- `app/src/pages/journal-2-0/components/BrokerAccountHero.module.css` — **create** hero styles.
- `app/src/pages/journal-2-0/components/BrokerAccountHero.test.jsx` — **create** component test.
- `app/src/pages/journal-2-0/tabs/OpenPositionsTab.jsx` — **modify** one import + one render line (swap `BrokerEquityCurve` → `BrokerAccountHero`).

---

### Task 1: BrokerAccountHero component

**Files:**
- Create: `app/src/pages/journal-2-0/components/BrokerAccountHero.jsx`
- Create: `app/src/pages/journal-2-0/components/BrokerAccountHero.module.css`
- Test: `app/src/pages/journal-2-0/components/BrokerAccountHero.test.jsx`

**Interfaces:**
- Consumes: `useBrokerEquityCurve(days) -> { points: [{equity:number}], isLoading:boolean }`; `money`, `moneySigned`, `percent` from `lib/journal-2-0`.
- Produces: `default export BrokerAccountHero({ account, aggregates })`. `account` = selected account object (`balanceSource`, `brokerTotalEquity`, `brokerCash`, `brokerBuyingPower`). `aggregates` = `portfolioAggregates` result (`unrealized`, `invested`). Renders `null` for non-broker / pre-equity accounts.

- [ ] **Step 1: Write the failing test**

```jsx
// BrokerAccountHero.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

let mockCurve = { points: [{ equity: 10000 }, { equity: 14000 }], isLoading: false }
vi.mock('../hooks/useBrokerEquityCurve', () => ({ default: () => mockCurve }))

import BrokerAccountHero from './BrokerAccountHero'

const brokerAccount = {
  balanceSource: 'broker', brokerTotalEquity: 14632.18,
  brokerCash: -12053.04, brokerBuyingPower: 9470.11,
}
const aggregates = { unrealized: 1204, invested: 1.78 }

describe('BrokerAccountHero', () => {
  beforeEach(() => { mockCurve = { points: [{ equity: 10000 }, { equity: 14000 }], isLoading: false } })

  it('renders account value, today P&L, and margin used for a broker account', () => {
    render(<BrokerAccountHero account={brokerAccount} aggregates={aggregates} />)
    expect(screen.getByText('$14,632.18')).toBeInTheDocument()          // account value
    expect(screen.getByText('Today')).toBeInTheDocument()               // today block label
    expect(screen.getByText('Margin Used')).toBeInTheDocument()
    expect(screen.getByText('$12,053.04')).toBeInTheDocument()          // = -brokerCash
  })

  it('returns null for a non-broker account', () => {
    const { container } = render(
      <BrokerAccountHero account={{ balanceSource: 'manual' }} aggregates={aggregates} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('hides Today when there are fewer than two equity points', () => {
    mockCurve = { points: [{ equity: 14000 }], isLoading: false }
    render(<BrokerAccountHero account={brokerAccount} aggregates={aggregates} />)
    expect(screen.queryByText('Today')).not.toBeInTheDocument()
    expect(screen.getByText('$14,632.18')).toBeInTheDocument()          // value still shows
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/journal-2-0/components/BrokerAccountHero.test.jsx`
Expected: FAIL — "Failed to resolve import './BrokerAccountHero'".

- [ ] **Step 3: Write the component**

```jsx
// BrokerAccountHero.jsx
/**
 * BrokerAccountHero — broker-app-style summary at the top of Open Positions.
 * Dominant account value + Today / period P&L + large equity curve + a
 * secondary balances strip. Reuses useBrokerEquityCurve + the account object +
 * the already-computed portfolioAggregates (passed in, so no live-price refetch).
 * Renders null for non-broker accounts (the normal stats row renders below).
 */
import { useMemo, useState } from 'react'
import { money, moneySigned, percent } from '../../../lib/journal-2-0'
import useBrokerEquityCurve from '../hooks/useBrokerEquityCurve'
import styles from './BrokerAccountHero.module.css'

const RANGES = [
  { label: '1M', days: 31 },
  { label: '3M', days: 93 },
  { label: '1Y', days: 365 },
  { label: 'All', days: 1825 },
]

export default function BrokerAccountHero({ account, aggregates }) {
  const [range, setRange] = useState(RANGES[1]) // default 3M
  const { points, isLoading } = useBrokerEquityCurve(range.days)

  const model = useMemo(() => {
    if (!points || points.length < 2) return null
    const ys = points.map((p) => p.equity)
    const min = Math.min(...ys)
    const max = Math.max(...ys)
    const span = max - min || 1
    const n = points.length
    const coords = points.map((p, i) => ({
      x: (i / (n - 1)) * 100,
      y: 100 - ((p.equity - min) / span) * 100,
    }))
    const line = coords.map((c, i) => `${i ? 'L' : 'M'}${c.x.toFixed(2)} ${c.y.toFixed(2)}`).join(' ')
    const area = `${line} L100 100 L0 100 Z`
    const first = points[0].equity
    const last = points[n - 1].equity
    const prev = points[n - 2].equity
    const change = last - first
    const todayChange = last - prev
    return {
      line, area,
      change, changePct: first ? change / Math.abs(first) : null, up: change >= 0,
      todayChange, todayPct: prev ? todayChange / Math.abs(prev) : null, todayUp: todayChange >= 0,
    }
  }, [points])

  const isBroker = account?.balanceSource === 'broker' && account?.brokerTotalEquity != null
  if (!isBroker) return null

  const marginUsed = account.brokerCash != null && account.brokerCash < 0 ? -account.brokerCash : 0

  return (
    <section className={styles.hero} aria-label="Account summary">
      <header className={styles.top}>
        <div className={styles.valueBlock}>
          <div className={styles.label}>Account Value</div>
          <div className={styles.value}>{money(account.brokerTotalEquity)}</div>
          <div className={styles.changes}>
            {model && (
              <span className={`${styles.change} ${model.todayUp ? styles.pos : styles.neg}`}>
                {model.todayUp ? '▲' : '▼'} {moneySigned(model.todayChange)}
                {model.todayPct != null && <>{' '}({percent(model.todayPct, { signed: true, dp: 1, isRatio: true })})</>}
                <span className={styles.changeLabel}> Today</span>
              </span>
            )}
            {model && (
              <span className={`${styles.change} ${model.up ? styles.pos : styles.neg}`}>
                {model.up ? '▲' : '▼'} {moneySigned(model.change)}
                {model.changePct != null && <>{' '}({percent(model.changePct, { signed: true, dp: 1, isRatio: true })})</>}
                <span className={styles.changeLabel}> · {range.label}</span>
              </span>
            )}
          </div>
        </div>
        <div className={styles.ranges} role="tablist" aria-label="Range">
          {RANGES.map((r) => (
            <button
              key={r.label}
              type="button"
              role="tab"
              aria-selected={r.label === range.label}
              className={`${styles.rangeBtn} ${r.label === range.label ? styles.rangeActive : ''}`}
              onClick={() => setRange(r)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>

      {model && (
        <div className={styles.chartWrap}>
          <svg className={styles.svg} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={model.up ? 'var(--color-success)' : 'var(--color-danger)'} stopOpacity="0.28" />
                <stop offset="100%" stopColor={model.up ? 'var(--color-success)' : 'var(--color-danger)'} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={model.area} fill="url(#heroFill)" />
            <path
              d={model.line}
              fill="none"
              stroke={model.up ? 'var(--color-success)' : 'var(--color-danger)'}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
          {isLoading && <span className={styles.loading}>…</span>}
        </div>
      )}

      <div className={styles.strip}>
        <Metric label="Open P&L" value={moneySigned(aggregates?.unrealized ?? 0)}
                tone={(aggregates?.unrealized ?? 0) >= 0 ? 'pos' : 'neg'} />
        {account.brokerCash != null && <Metric label="Cash" value={money(account.brokerCash)} />}
        {account.brokerBuyingPower != null && <Metric label="Buying Power" value={money(account.brokerBuyingPower)} />}
        <Metric label="Margin Used" value={money(marginUsed)} tone={marginUsed > 0 ? 'neg' : undefined} />
        <Metric label="Invested"
                value={aggregates?.invested == null ? '—' : percent(aggregates.invested, { dp: 1 })} />
      </div>
    </section>
  )
}

function Metric({ label, value, tone }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={`${styles.metricValue} ${tone === 'pos' ? styles.pos : tone === 'neg' ? styles.neg : ''}`}>
        {value}
      </span>
    </div>
  )
}
```

- [ ] **Step 4: Write the CSS module**

```css
/* BrokerAccountHero.module.css */
.hero {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 20px;
  border: 1px solid var(--border, #2a2a2a);
  border-radius: 12px;
  background: var(--surface-1, rgba(255,255,255,0.02));
  margin-bottom: 14px;
}
.top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.label { font-size: 12px; letter-spacing: 0.6px; text-transform: uppercase; color: var(--text-muted); }
.value { font-size: 38px; font-weight: 700; line-height: 1.05; color: var(--text-bright); margin-top: 2px; }
.changes { display: flex; gap: 18px; flex-wrap: wrap; margin-top: 6px; }
.change { font-size: 14px; font-weight: 600; }
.changeLabel { color: var(--text-muted); font-weight: 400; }
.pos { color: var(--color-success, #4ade80); }
.neg { color: var(--color-danger, #f87171); }
.ranges { display: flex; gap: 4px; }
.rangeBtn {
  padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--border, #333); background: transparent; color: var(--text-muted);
}
.rangeActive { border-color: var(--ut-gold, #c9a84c); color: var(--ut-gold, #c9a84c); background: rgba(201,168,76,0.12); }
.chartWrap { position: relative; width: 100%; height: 160px; }
.svg { width: 100%; height: 100%; display: block; }
.loading { position: absolute; top: 6px; right: 8px; color: var(--text-muted); font-size: 18px; }
.strip { display: flex; flex-wrap: wrap; gap: 22px; padding-top: 12px; border-top: 1px solid var(--border, #2a2a2a); }
.metric { display: flex; flex-direction: column; gap: 2px; }
.metricLabel { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); }
.metricValue { font-size: 15px; font-weight: 600; color: var(--text-bright); }

@media (max-width: 640px) {
  .value { font-size: 30px; }
  .changes { flex-direction: column; gap: 4px; }
  .chartWrap { height: 130px; }
  .strip { gap: 16px; }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/journal-2-0/components/BrokerAccountHero.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/journal-2-0/components/BrokerAccountHero.jsx app/src/pages/journal-2-0/components/BrokerAccountHero.module.css app/src/pages/journal-2-0/components/BrokerAccountHero.test.jsx
git commit -m "feat(broker): BrokerAccountHero — broker-style account value + P&L + curve"
```

### Task 2: Mount the hero in Open Positions

**Files:**
- Modify: `app/src/pages/journal-2-0/tabs/OpenPositionsTab.jsx` (import line 24 + render line ~248)

**Interfaces:**
- Consumes: `BrokerAccountHero` (Task 1); `selectedAccount` + `aggregates` already in scope in `OpenPositionsTab`.

- [ ] **Step 1: Re-read the file** (it's co-edited).

Run: confirm line 24 still `import BrokerEquityCurve from '../components/BrokerEquityCurve'` and the render still has `<BrokerEquityCurve />`. If they moved, adapt the anchors below.

- [ ] **Step 2: Swap the import**

Change:
```jsx
import BrokerEquityCurve from '../components/BrokerEquityCurve'
```
to:
```jsx
import BrokerAccountHero from '../components/BrokerAccountHero'
```

- [ ] **Step 3: Swap the render line**

Change:
```jsx
      <BrokerEquityCurve />
```
to:
```jsx
      <BrokerAccountHero account={selectedAccount} aggregates={aggregates} />
```
(`selectedAccount` comes from `useJ2SelectedAccount()` and `aggregates` from the `useMemo(... portfolioAggregates ...)` — both already defined in this component.)

- [ ] **Step 4: Build to verify JSX + that nothing else referenced BrokerEquityCurve**

Run: `cd app && npm run build`
Expected: builds clean. (If the build errors on an unused `BrokerEquityCurve` import elsewhere, search `grep -rn BrokerEquityCurve app/src` — only OpenPositionsTab should reference it; leave the `BrokerEquityCurve.jsx` file in place, unreferenced, for the parallel session.)

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/tabs/OpenPositionsTab.jsx
git commit -m "feat(broker): lead Open Positions with the account hero"
```

---

## Self-Review

**Spec coverage:** account value (Task 1 value block) ✓; Today $+% (model.todayChange, hidden <2 pts — Task 1 test 3) ✓; period $+% tied to range tabs (model.change + RANGES) ✓; prominent full-width chart (chartWrap 160px) ✓; secondary strip open P&L/cash/buying power/margin used/invested (Task 1 strip) ✓; Risk/Heat stay below (untouched OpenPositionsTab stats row) ✓; broker-only null (isBroker guard + test 2) ✓; reuse `useBrokerEquityCurve` + `aggregates` prop, no backend ✓; one-line swap in hot file (Task 2) ✓; responsive 640 (CSS media) ✓.

**Placeholder scan:** none — full component, CSS, test, and exact swap lines included.

**Type consistency:** `useBrokerEquityCurve(days) -> {points:[{equity}], isLoading}` consumed exactly as `BrokerEquityCurve` does. `percent` invested call `{dp:1}` matches OpenPositionsTab; change-% call `{signed,dp:1,isRatio:true}` matches BrokerEquityCurve. `aggregates.unrealized`/`.invested` match `portfolioAggregates` output. `account.brokerTotalEquity/brokerCash/brokerBuyingPower/balanceSource` match `_row_to_account` serializer.
