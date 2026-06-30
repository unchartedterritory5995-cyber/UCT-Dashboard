# Journal Live Pricing & Account Value — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Journal 2.0 price surface (Open Positions, Analytics live-equity point, community TraderDetail, Dashboard "Journal · Positions" tile) stream real-time last prices, and make the account-value headline tick live — including a reconcile-by-construction live mark-to-market for broker accounts.

**Architecture:** Swap each surface's `useLivePrices` (2s/4s REST poll) for the existing `useRealtimePrices` SSE-streaming hook, which internally wraps `useLivePrices` so the REST poll remains the automatic fallback. Add one pure helper, `brokerLiveEquity`, that takes the broker's authoritative `brokerTotalEquity` and adds only price-drift-since-sync, so the live headline equals the broker's number at sync and drifts live thereafter.

**Tech Stack:** React + Vite, SWR, EventSource (SSE), Vitest. Frontend-only — no backend changes.

## Global Constraints

- **Base:** worktree `feat/journal-live-pricing` off `origin/master` (already created at `.worktrees/journal-live-pricing`). All work + commits land here.
- **Frontend-only.** No `api/` changes. No new dependencies.
- **`useRealtimePrices` return shape:** `{ prices, isLoading, isStreaming, staleSymbols }`. `prices` is `symbol → { price, change_pct, day_open, ... }` — identical to `useLivePrices` for the `.price`/`.change_pct` fields the journal reads. A plain `{ prices }` destructure is a drop-in swap.
- **Broker reconciliation invariant:** `brokerLiveEquity` MUST return `liveValue === account.brokerTotalEquity` (and `liveDelta === 0`) whenever every live price equals its `brokerPrice` mark. Options and missing-price positions contribute 0.
- **No options live pricing** — option positions (`isOption`/strategy rows) contribute 0 to broker drift.
- **Test command:** from `app/`, `npx vitest run <path>` for one file; `npm run build` to typecheck/bundle.
- **Brand:** any new affordance (e.g. a LIVE badge) uses existing tokens/`UIcon`, never raw emoji.

---

### Task 1: `brokerLiveEquity` helper + unit tests

**Files:**
- Modify: `app/src/lib/journal-2-0/calculations.js` (append a new export near `portfolioAggregates`, ~line 220)
- Test: `app/src/lib/journal-2-0/calculations.test.js`
- (No barrel edit — `index.js` does `export * from './calculations.js'`, so the new export propagates automatically.)

**Interfaces:**
- Produces: `brokerLiveEquity(account, positions, prices) -> { liveValue: number|null, liveDelta: number }`
  - `account`: `{ brokerTotalEquity?: number|null }`
  - `positions`: array of `{ symbol, shares, side?, brokerPrice?, isOption? }`
  - `prices`: `Record<string, number>` (symbol → live price NUMBER, not the `{price}` object)
  - Consumed by Tasks 2 and 5.

- [ ] **Step 1: Write the failing tests**

Append to `app/src/lib/journal-2-0/calculations.test.js` (and add `brokerLiveEquity` to the existing top-of-file import block from `./calculations.js`):

```js
describe('brokerLiveEquity', () => {
  const acct = { brokerTotalEquity: 10000 }

  it('reconciles to brokerTotalEquity when live === broker mark', () => {
    const positions = [{ symbol: 'AAPL', shares: 10, side: 'Long', brokerPrice: 100 }]
    expect(brokerLiveEquity(acct, positions, { AAPL: 100 }))
      .toEqual({ liveValue: 10000, liveDelta: 0 })
  })

  it('adds signed drift for a long position', () => {
    const positions = [{ symbol: 'AAPL', shares: 10, side: 'Long', brokerPrice: 100 }]
    const r = brokerLiveEquity(acct, positions, { AAPL: 102 })
    expect(r.liveDelta).toBe(20)        // (102 - 100) * 10
    expect(r.liveValue).toBe(10020)
  })

  it('flips sign for a short position', () => {
    const positions = [{ symbol: 'TSLA', shares: 5, side: 'Short', brokerPrice: 200 }]
    const r = brokerLiveEquity(acct, positions, { TSLA: 210 })
    expect(r.liveDelta).toBe(-50)       // (210 - 200) * -5
    expect(r.liveValue).toBe(9950)
  })

  it('ignores options and missing-price positions', () => {
    const positions = [
      { symbol: 'NVDA Oct $5C', shares: 2, side: 'Long', brokerPrice: 3, isOption: true },
      { symbol: 'MSFT', shares: 4, side: 'Long' },                 // no brokerPrice
      { symbol: 'AMD', shares: 1, side: 'Long', brokerPrice: 50 }, // no live price
    ]
    expect(brokerLiveEquity(acct, positions, { MSFT: 400 }))
      .toEqual({ liveValue: 10000, liveDelta: 0 })
  })

  it('returns null liveValue when brokerTotalEquity is missing', () => {
    expect(brokerLiveEquity({ brokerTotalEquity: null }, [], {}))
      .toEqual({ liveValue: null, liveDelta: 0 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `app/`): `npx vitest run src/lib/journal-2-0/calculations.test.js -t brokerLiveEquity`
Expected: FAIL — `brokerLiveEquity is not a function` / not exported.

- [ ] **Step 3: Implement `brokerLiveEquity`**

Append to `app/src/lib/journal-2-0/calculations.js` (after `portfolioAggregates`, before the `§14.5 Trade-level` divider):

```js
/**
 * Live mark-to-market for a BROKER account headline.
 *
 * Starts from the broker's authoritative net-liq (`account.brokerTotalEquity`)
 * and adds ONLY the price drift since the last sync. At sync time
 * (livePrice === brokerPrice) liveDelta is 0, so liveValue reconciles EXACTLY
 * to the broker's reported number; intraday it drifts with the market.
 *
 *   liveDelta = Σ over equity positions of (livePrice − brokerPrice) × signedShares
 *   signedShares: Short ⇒ −shares, else +shares
 *
 * A position contributes 0 when it is an option, or when its live price, broker
 * mark, or share count is missing/non-finite.
 *
 * @param {{brokerTotalEquity?: number|null}} account
 * @param {Array<{symbol:string, shares:number, side?:string, brokerPrice?:number, isOption?:boolean}>} positions
 * @param {Record<string, number>} prices  symbol → live price (number)
 * @returns {{liveValue: number|null, liveDelta: number}}
 */
export const brokerLiveEquity = (account, positions, prices) => {
  const base = account?.brokerTotalEquity
  if (base == null || !Number.isFinite(base)) return { liveValue: null, liveDelta: 0 }
  let liveDelta = 0
  for (const p of positions || []) {
    if (p?.isOption) continue
    const live = prices?.[p.symbol]
    const mark = p?.brokerPrice
    if (!Number.isFinite(live) || !Number.isFinite(mark) || !Number.isFinite(p?.shares)) continue
    const signed = p.side === 'Short' ? -p.shares : p.shares
    liveDelta += (live - mark) * signed
  }
  return { liveValue: base + liveDelta, liveDelta }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `app/`): `npx vitest run src/lib/journal-2-0/calculations.test.js`
Expected: PASS (the new `brokerLiveEquity` block + the pre-existing calculations tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/journal-2-0/calculations.js app/src/lib/journal-2-0/calculations.test.js
git commit -m "feat(journal): brokerLiveEquity reconcile-by-construction live net-liq helper"
```

---

### Task 2: Open Positions tab streams + broker hero ticks live

**Files:**
- Modify: `app/src/pages/journal-2-0/tabs/OpenPositionsTab.jsx` (import line 22; hook call line 123; build a price-number map + `brokerLiveEquity`; pass new props to `BrokerAccountHero` line 252)
- Modify: `app/src/pages/journal-2-0/components/BrokerAccountHero.jsx` (accept `liveEquity` + `isLive`; use for headline + Today)
- Test: `app/src/pages/journal-2-0/components/BrokerAccountHero.test.jsx`

**Interfaces:**
- Consumes: `brokerLiveEquity` (Task 1); `useRealtimePrices` from `app/src/hooks/useRealtimePrices.js`.
- Produces: `BrokerAccountHero` now accepts optional props `liveEquity: {liveValue:number|null, liveDelta:number} | null` and `isLive: boolean`.

- [ ] **Step 1: Write a failing test for the live headline**

`BrokerAccountHero` is prop-driven (no EventSource), so it renders safely in jsdom. Add to `app/src/pages/journal-2-0/components/BrokerAccountHero.test.jsx`:

```js
it('shows the live mark-to-market value when liveEquity is provided', () => {
  const account = { balanceSource: 'broker', brokerTotalEquity: 10000, brokerCash: 2000 }
  render(
    <BrokerAccountHero
      account={account}
      aggregates={{ unrealized: 0, invested: 0.8, count: 1, value: 8000 }}
      liveEquity={{ liveValue: 10020, liveDelta: 20 }}
      isLive
    />,
  )
  expect(screen.getByText('$10,020.00')).toBeInTheDocument()
  expect(screen.getByText(/LIVE/i)).toBeInTheDocument()
})
```

(If the existing test file lacks imports, mirror its siblings: `import { render, screen } from '@testing-library/react'` + `import BrokerAccountHero from './BrokerAccountHero'`. The `useJ2BrokerPerformance` hook it calls returns `{ data: undefined, isLoading: false }` for an un-mocked fetch — fine; with `<2` series the curve is null and the headline falls back to `liveEquity`/`brokerTotalEquity`, which is exactly what we assert.)

- [ ] **Step 2: Run the test to verify it fails**

Run (from `app/`): `npx vitest run src/pages/journal-2-0/components/BrokerAccountHero.test.jsx -t "live mark-to-market"`
Expected: FAIL — headline still shows `$10,000.00` (from `brokerTotalEquity`) and no `LIVE` badge.

- [ ] **Step 3: Make `BrokerAccountHero` consume `liveEquity` + `isLive`**

In `app/src/pages/journal-2-0/components/BrokerAccountHero.jsx`:

Change the signature (line 40):
```js
export default function BrokerAccountHero({ account, aggregates, liveEquity = null, isLive = false }) {
```

Replace the headline value line (line 93). Current:
```js
  const headValue = scrubbing ? series[scrub].value : (data?.endEquity ?? account.brokerTotalEquity)
```
New — when not scrubbing, prefer the live mark-to-market:
```js
  const baseValue = data?.endEquity ?? account.brokerTotalEquity
  const liveVal = liveEquity?.liveValue
  const headValue = scrubbing
    ? series[scrub].value
    : (liveVal != null ? liveVal : baseValue)
```

Make "Today" include the live drift. The non-scrub Today branch (lines 123–129) renders `model.todayChange`. Replace `model.todayChange` usage in that branch with a `liveToday` that adds `liveEquity.liveDelta`. Insert just before the `return (` (after line 96 `const scrubUp = ...`):
```js
  // Today's change, with live drift since last sync folded in.
  const liveDelta = liveEquity?.liveDelta ?? 0
  const liveToday = model && model.todayChange != null ? model.todayChange + liveDelta : null
  const liveTodayUp = (liveToday ?? 0) >= 0
```
Then in the non-scrub Today `<span>` (lines 123–129) swap `model.todayChange` → `liveToday`, `model.todayUp` → `liveTodayUp`, and the guard `model && model.todayChange != null` → `model && liveToday != null`. (Leave `model.todayPct` as-is — the percentage stays anchored to the synced curve.)

Add a LIVE badge next to the label. Replace the label block (line 112):
```js
          <div className={styles.label}>Account Value</div>
```
with:
```js
          <div className={styles.label}>
            Account Value
            {isLive && <span className={styles.liveBadge}> LIVE</span>}
          </div>
```
Add to `app/src/pages/journal-2-0/components/BrokerAccountHero.module.css`:
```css
.liveBadge {
  margin-left: 6px;
  font-size: 0.62em;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--gain, #3cb868);
  vertical-align: middle;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `app/`): `npx vitest run src/pages/journal-2-0/components/BrokerAccountHero.test.jsx`
Expected: PASS (new test + existing hero tests).

- [ ] **Step 5: Wire OpenPositionsTab to the stream + compute `liveEquity`**

In `app/src/pages/journal-2-0/tabs/OpenPositionsTab.jsx`:

Swap the import (line 22):
```js
import useRealtimePrices from '../../../hooks/useRealtimePrices'
```
Add `brokerLiveEquity` to the existing barrel import (lines 35–40):
```js
import {
  portfolioAggregates,
  brokerLiveEquity,
  money,
  moneySigned,
  percent,
} from '../../../lib/journal-2-0'
```
Swap the hook call (line 123):
```js
  const { prices, isStreaming } = useRealtimePrices(symbols)
```
The `aggregates` memo (lines 216–234) already builds a price-number map inline via `Object.entries(prices).map(([sym, v]) => [sym, v?.price])`. Lift that map so it can be reused, then compute `liveEquity`. Just after the `aggregates` memo (after line 234) add:
```js
  const priceMap = useMemo(
    () => Object.fromEntries(Object.entries(prices).map(([sym, v]) => [sym, v?.price])),
    [prices],
  )
  const liveEquity = useMemo(
    () => brokerLiveEquity(selectedAccount, positions, priceMap),
    [selectedAccount, positions, priceMap],
  )
```
Pass the new props to the hero (line 252):
```js
      <BrokerAccountHero
        account={selectedAccount}
        aggregates={aggregates}
        liveEquity={liveEquity}
        isLive={isStreaming}
      />
```

- [ ] **Step 6: Build to verify the wiring compiles**

Run (from `app/`): `npm run build`
Expected: build succeeds (no unresolved imports / syntax errors).

- [ ] **Step 7: Commit**

```bash
git add app/src/pages/journal-2-0/tabs/OpenPositionsTab.jsx app/src/pages/journal-2-0/components/BrokerAccountHero.jsx app/src/pages/journal-2-0/components/BrokerAccountHero.module.css app/src/pages/journal-2-0/components/BrokerAccountHero.test.jsx
git commit -m "feat(journal): stream Open Positions + live broker net-liq headline"
```

---

### Task 3: Analytics live-equity point streams

**Files:**
- Modify: `app/src/pages/journal-2-0/tabs/AnalyticsTab.jsx` (import line 19; hook call line 354)

**Interfaces:**
- Consumes: `useRealtimePrices`. No new exports.

- [ ] **Step 1: Swap the import (line 19)**

```js
import useRealtimePrices from '../../../hooks/useRealtimePrices'
```

- [ ] **Step 2: Swap the hook call (line 354, inside `EquitySection`)**

Current:
```js
  const { prices } = useLivePrices(symbols)
```
New:
```js
  const { prices } = useRealtimePrices(symbols)
```
(`symbols` is `[]` while the live toggle is off, so the hook opens no stream until the user enables "live unrealized" — unchanged behavior, now tick-by-tick when on.)

- [ ] **Step 3: Build to verify**

Run (from `app/`): `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Run the analytics-area suite (if present)**

Run (from `app/`): `npx vitest run src/pages/journal-2-0/tabs/AnalyticsTab.test.jsx`
Expected: PASS, or "No test files found" (acceptable — covered by the full build + Task 6 suite). If the file exists and renders `EquitySection`, ensure it mocks `useRealtimePrices` the same way it previously mocked `useLivePrices`.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/tabs/AnalyticsTab.jsx
git commit -m "feat(journal): stream the Analytics live-unrealized equity point"
```

---

### Task 4: Community TraderDetail streams

**Files:**
- Modify: `app/src/pages/journal-2-0/components/TraderDetail.jsx` (import ~line 13; hook call line 64)

**Interfaces:**
- Consumes: `useRealtimePrices`. No new exports.

- [ ] **Step 1: Swap the import (~line 13)**

```js
import useRealtimePrices from '../../../hooks/useRealtimePrices'
```

- [ ] **Step 2: Swap the hook call (line 64)**

```js
  const { prices } = useRealtimePrices(positionSymbols)
```

- [ ] **Step 3: Build to verify**

Run (from `app/`): `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/src/pages/journal-2-0/components/TraderDetail.jsx
git commit -m "feat(journal): stream community TraderDetail open-position prices"
```

---

### Task 5: Dashboard "Journal · Positions" tile streams + live broker hero

**Files:**
- Modify: `app/src/components/tiles/JournalSnapshotTile.jsx` (import line 24; hook call line 122; live broker headline in `BrokerHero`)
- Test: `app/src/components/tiles/JournalSnapshotTile.test.jsx`

**Interfaces:**
- Consumes: `useRealtimePrices`; `brokerLiveEquity` (Task 1, already exported from the barrel).

- [ ] **Step 1: Update the test mock to `useRealtimePrices`**

In `app/src/components/tiles/JournalSnapshotTile.test.jsx`, find the `vi.mock('.../hooks/useLivePrices', ...)` block and replace it with a mock of the new hook (same return shape plus `isStreaming`). Example:
```js
vi.mock('../../hooks/useRealtimePrices', () => ({
  default: (syms = []) => ({
    prices: Object.fromEntries(syms.map((s) => [s, { price: 100, change_pct: 1 }])),
    isLoading: false,
    isStreaming: true,
    staleSymbols: new Set(),
  }),
}))
```
If a broker-hero test asserts a specific headline number, update it to expect the live mark-to-market (base `brokerTotalEquity`/`endEquity` plus the drift implied by the mocked prices vs each position's `brokerPrice`); if positions in that test have no `brokerPrice`, the drift is 0 and the asserted value is unchanged.

- [ ] **Step 2: Run the test to verify it fails (or errors on the stale mock)**

Run (from `app/`): `npx vitest run src/components/tiles/JournalSnapshotTile.test.jsx`
Expected: FAIL — the component now imports `useRealtimePrices`, so the old `useLivePrices` mock no longer intercepts it (real EventSource would be hit) until the component swap in Step 3 + the mock from Step 1 are both in place. (Run again after Step 3.)

- [ ] **Step 3: Swap the hook + make the broker headline live**

In `app/src/components/tiles/JournalSnapshotTile.jsx`:

Swap the import (line 24):
```js
import useRealtimePrices from '../../hooks/useRealtimePrices'
```
Add `brokerLiveEquity` to the barrel import (lines 26–32):
```js
import {
  portfolioAggregates,
  positionPnlDollar,
  brokerLiveEquity,
  money,
  moneySigned,
  percent,
} from '../../lib/journal-2-0'
```
Swap the hook call (line 122):
```js
  const { prices, isStreaming } = useRealtimePrices(symbols)
```
`priceMap` already exists (lines 124–129). Compute a portfolio-wide live broker value just after it. The tile's broker headline base is `perf?.endEquity ?? Σ brokerAccounts.brokerTotalEquity`; reuse `brokerLiveEquity` to fold in drift across all broker positions:
```js
  const brokerBase = perf?.endEquity
    ?? brokerAccounts.reduce((s, a) => s + (a.brokerTotalEquity || 0), 0)
  const brokerLive = useMemo(
    () => brokerLiveEquity({ brokerTotalEquity: brokerBase }, positions, priceMap),
    [brokerBase, positions, priceMap],
  )
```
In the `BrokerHero` render (the `hasBroker` branch, ~lines 244–298), use `brokerLive.liveValue ?? brokerBase` for the headline value instead of the static base, and add ` LIVE` (gated on `isStreaming`) next to its label, mirroring Task 2. (`ManualHero` already ticks live — it reads `agg.value` from `portfolioAggregates(positions, priceMap, 0)`, now fed streamed prices; no change needed there.)

Pass `brokerLive`/`isStreaming` into `BrokerHero` if it's a separate component, or inline the value if `BrokerHero` is defined in-file — follow the file's existing structure.

- [ ] **Step 4: Run the test to verify it passes**

Run (from `app/`): `npx vitest run src/components/tiles/JournalSnapshotTile.test.jsx`
Expected: PASS.

- [ ] **Step 5: Build to verify**

Run (from `app/`): `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/tiles/JournalSnapshotTile.jsx app/src/components/tiles/JournalSnapshotTile.test.jsx
git commit -m "feat(journal): stream Dashboard Journal snapshot + live broker net-liq"
```

---

### Task 6: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full frontend test suite**

Run (from `app/`): `npx vitest run`
Expected: PASS — all suites green (the journal + tile + calculations suites plus everything else).

- [ ] **Step 2: Production build**

Run (from `app/`): `npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 3: Grep-verify no journal surface still imports the poll-only hook**

Run (from repo root): `grep -rn "useLivePrices" app/src/pages/journal-2-0 app/src/components/tiles/JournalSnapshotTile.jsx`
Expected: NO matches in `OpenPositionsTab.jsx`, `AnalyticsTab.jsx`, `TraderDetail.jsx`, `JournalSnapshotTile.jsx` (other journal files that legitimately still poll, if any, are out of scope — confirm only the four converted surfaces are clean).

- [ ] **Step 4: Commit (only if Steps 1–3 produced any fixups)**

```bash
git add -A
git commit -m "chore(journal): verification fixups for live-pricing swap"
```

---

## Self-Review

**Spec coverage:**
- Stream all journal surfaces → Tasks 2 (OpenPositions), 3 (Analytics), 4 (TraderDetail), 5 (snapshot tile). ✓
- Manual account ticks live for free → covered by feeding streamed prices to `portfolioAggregates` (Tasks 2 & 5, no calc change). ✓
- Broker live mark-to-market, reconcile-by-construction → Task 1 (`brokerLiveEquity`) + Tasks 2 & 5 (consumers). ✓
- LIVE affordance → Tasks 2 & 5 (`isStreaming` badge). ✓
- REST fallback preserved → inherent to `useRealtimePrices` (wraps `useLivePrices`); noted in Global Constraints. ✓
- Real-time last price only; options keep broker mark → `brokerLiveEquity` skips `isOption`; no bid/ask anywhere. ✓
- Tests: `brokerLiveEquity` units + mocked-hook component tests → Tasks 1, 2, 5; full suite Task 6. ✓

**Placeholder scan:** No TBD/TODO; every code step shows real code; every command has an expected result. ✓

**Type consistency:** `brokerLiveEquity(account, positions, prices)` returns `{ liveValue, liveDelta }` in Task 1 and is consumed with those exact field names in Tasks 2 and 5. `BrokerAccountHero` props `liveEquity`/`isLive` are defined in Task 2 Step 3 and passed in Task 2 Step 5. `prices` map (symbol→number) passed to `brokerLiveEquity` matches the `priceMap` construction in both consumers. ✓
