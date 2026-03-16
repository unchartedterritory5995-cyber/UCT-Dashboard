# Breadth Monitor Enhancements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Breadth Monitor from a functional data grid into a professional-grade market analysis tool covering all 20 items from the dual-perspective engineering + financial review.

**Architecture:** New data fields are collected in `breadth_collector.py` and backfilled via dedicated `--patch-*` CLI modes (same pattern as `--patch-exposure`). Derived/computed metrics (cumulative A/D, day %, FTD flag, Hi/Lo ratio, composite score) are generated server-side in `breadth_monitor.py::get_history()` from stored data — no re-collection needed. All changes surface in `Breadth.jsx` with updated column definitions, threshold logic, and new UX components.

**Tech Stack:** React 18, useSWR, CSS Modules; FastAPI, SQLite, yfinance; Python 3.12

---

## Files

| File | Role |
|------|------|
| `app/src/pages/Breadth.jsx` | All frontend changes — COLS, error state, sort, CSV, sparklines, regime rows, localStorage |
| `app/src/pages/Breadth.module.css` | New CSS — row phase classes, pill buttons, composite gauge, sparkline styles |
| `api/services/breadth_monitor.py` | Server-side computed fields: cumulative A/D, day %, FTD, Hi/Lo ratio, composite score, `created_at` in response |
| `C:\Users\Patrick\uct-intelligence\scripts\breadth_collector.py` | New collected fields: market phase + DDC, RSP/SPY ratio, VXMT/VIX ratio, AAII survey date. New CLI modes: `--patch-regime`, `--patch-rsp-vix3m` |

---

## Chunk 1: Frontend Quick Wins (No Backend Required)

### Task 1: Fix error state and empty-state messaging

**Files:**
- Modify: `app/src/pages/Breadth.jsx` lines 204–244

- [ ] **Step 1: Update useSWR destructure and add error banner**

```jsx
// In the Breadth() component, replace:
const { data, isLoading } = useSWR('/api/breadth-monitor?days=90', fetcher, {
  refreshInterval: 5 * 60 * 1000,
})

// With:
const [days, setDays] = useState(90)
const { data, isLoading, error } = useSWR(
  `/api/breadth-monitor?days=${days}`,
  fetcher,
  { refreshInterval: 5 * 60 * 1000 }
)
```

- [ ] **Step 2: Replace the empty state block with proper error + empty states**

```jsx
{error && (
  <div className={styles.errorBanner}>
    Could not load breadth data — {error.message ?? 'network error'}. Retrying in 5m.
  </div>
)}

{!error && rows.length === 0 && !isLoading && (
  <div className={styles.empty}>
    No data yet. Run <code>python scripts/breadth_collector.py</code> in uct-intelligence.
  </div>
)}
```

- [ ] **Step 3: Add CSS for error banner in `Breadth.module.css`**

```css
.errorBanner {
  font-family: 'Instrument Sans', sans-serif;
  font-size: 13px;
  color: var(--loss, #f87171);
  background: rgba(248, 113, 113, 0.08);
  border: 1px solid rgba(248, 113, 113, 0.25);
  border-radius: 6px;
  padding: 10px 14px;
  margin-bottom: 12px;
  flex-shrink: 0;
}
```

- [ ] **Step 4: Verify in browser — load `/breadth` with backend stopped, confirm red banner appears instead of script hint**

- [ ] **Step 5: Commit**
```bash
git add app/src/pages/Breadth.jsx app/src/pages/Breadth.module.css
git commit -m "fix: proper error state and empty state in Breadth monitor"
```

---

### Task 2: Days control pills

**Files:**
- Modify: `app/src/pages/Breadth.jsx` (header section, useSWR URL)
- Modify: `app/src/pages/Breadth.module.css`

Note: `days` state was added in Task 1 Step 1. Wire up the pill buttons here.

- [ ] **Step 1: Add days pills to the header JSX** (after the `<span className={styles.meta}>` line)

```jsx
<div className={styles.daysPills}>
  {[30, 60, 90].map(d => (
    <button
      key={d}
      className={`${styles.daysPill} ${days === d ? styles.daysPillActive : ''}`}
      onClick={() => setDays(d)}
    >
      {d}d
    </button>
  ))}
</div>
```

- [ ] **Step 2: Add CSS for pills**

```css
.daysPills {
  display: flex;
  gap: 4px;
  margin-left: auto;
}
.daysPill {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  padding: 3px 10px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
}
.daysPill:hover { border-color: var(--ut-gold); color: var(--ut-gold); }
.daysPillActive {
  background: var(--ut-gold);
  border-color: var(--ut-gold);
  color: #000;
  font-weight: 700;
}
```

- [ ] **Step 3: Verify — clicking 30d/60d/90d refetches with different row counts**

- [ ] **Step 4: Commit**
```bash
git add app/src/pages/Breadth.jsx app/src/pages/Breadth.module.css
git commit -m "feat: days control pills (30d/60d/90d) for breadth monitor"
```

---

### Task 3: Last updated timestamp in header

**Files:**
- Modify: `api/services/breadth_monitor.py` — expose `created_at` from the latest row
- Modify: `app/src/pages/Breadth.jsx`

- [ ] **Step 1: In `get_history()`, add `created_at` from the raw SQLite row**

Replace:
```python
for row in rows:
    m = json.loads(row["metrics"])
    m["date"] = row["date"]
    result.append(m)
```
With:
```python
for row in rows:
    m = json.loads(row["metrics"])
    m["date"] = row["date"]
    m["_created_at"] = row["created_at"]   # expose for "last updated" display
    result.append(m)
```

Also update the SELECT to include `created_at`:
```python
rows = c.execute(
    "SELECT date, metrics, created_at FROM breadth_snapshots ORDER BY date DESC LIMIT ?",
    (days,),
).fetchall()
```

- [ ] **Step 2: In `Breadth.jsx`, derive and display the timestamp**

```jsx
// After: const rows = data?.rows ?? []
const lastUpdated = rows[0]?._created_at
  ? new Date(rows[0]._created_at + 'Z').toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    })
  : null

// In header, update the meta span:
<span className={styles.meta}>
  {rows.length > 0
    ? `${rows.length} trading days${lastUpdated ? ` · updated ${lastUpdated}` : ''}`
    : isLoading ? 'Loading…' : 'No data'}
</span>
```

- [ ] **Step 3: Verify — header shows e.g. "24 trading days · updated Mar 14, 4:42 PM"**

- [ ] **Step 4: Commit**
```bash
git add api/services/breadth_monitor.py app/src/pages/Breadth.jsx
git commit -m "feat: last updated timestamp in breadth monitor header"
```

---

### Task 4: UCT Exposure column reorder + threshold recalibration + indicator fixes

**Files:**
- Modify: `app/src/pages/Breadth.jsx` (COLS array only)

This task reorders the Regime columns to lead with the most actionable metrics, inverts the AAII Spread color logic, recalibrates McClellan, and fixes NAAIM thresholds.

- [ ] **Step 1: Reorder Regime columns in COLS — move UCT Exp first**

New Regime group order:
1. UCT Exp (was last — most actionable, should be first)
2. S&P 500
3. QQQ
4. VIX
5. 10d VIX
6. VXN
7. 10d VXN
8. SPY MAs
9. QQQ MAs

```jsx
// ── Regime ────────────────────────────────────────────────────────────────
{ key: 'uct_exposure',   label: 'UCT Exp',    group: G.REGIME, fmt: v => fmtDec(v, 0),
  colorFn: v => v == null ? '' : v >= 70 ? 'green' : v <= 30 ? 'red' : 'amber' },
{ key: 'sp500_close',    label: 'S&P 500',    group: G.REGIME, fmt: fmtPrice },
{ key: 'qqq_close',      label: 'QQQ',        group: G.REGIME, fmt: fmtPrice },
{ key: 'vix',            label: 'VIX',        group: G.REGIME, fmt: v => fmtDec(v, 2),
  colorFn: v => v == null ? '' : v > 30 ? 'red' : v > 20 ? 'amber' : 'green' },
{ key: 'avg_10d_vix',    label: '10d VIX',    group: G.REGIME, fmt: v => fmtDec(v, 2),
  colorFn: v => v == null ? '' : v > 28 ? 'red' : v > 20 ? 'amber' : 'green' },
{ key: 'vxn',            label: 'VXN',        group: G.REGIME, fmt: v => fmtDec(v, 2),
  colorFn: v => v == null ? '' : v > 35 ? 'red' : v > 25 ? 'amber' : 'green' },
{ key: 'avg_10d_vxn',    label: '10d VXN',    group: G.REGIME, fmt: v => fmtDec(v, 2),
  colorFn: v => v == null ? '' : v > 32 ? 'red' : v > 24 ? 'amber' : 'green' },
{ key: 'spy_ma_stack', label: 'SPY MAs', group: G.REGIME, type: 'ma_stack',
  keys: ['spy_above_10sma', 'spy_above_20sma', 'spy_above_50sma', 'spy_above_200sma'],
  maLabels: ['10', '20', '50', '200'] },
{ key: 'qqq_ma_stack', label: 'QQQ MAs', group: G.REGIME, type: 'ma_stack',
  keys: ['qqq_above_10sma', 'qqq_above_20sma', 'qqq_above_50sma', 'qqq_above_200sma'],
  maLabels: ['10', '20', '50', '200'] },
```

- [ ] **Step 2: Fix AAII Spread colorFn — contrarian, invert the logic**

```jsx
// Replace:
{ key: 'aaii_spread', label: 'Spread', group: G.SENTIMENT, fmt: v => fmtDec(v, 1),
  colorFn: v => v == null ? '' : v > 10 ? 'green' : v < -10 ? 'red' : '' },

// With (contrarian: extreme bearishness = buy signal, extreme bullishness = warning):
{ key: 'aaii_spread', label: 'B-B Sprd', group: G.SENTIMENT, fmt: v => fmtDec(v, 1),
  colorFn: v => v == null ? '' : v < -20 ? 'green' : v > 30 ? 'red' : v < -10 ? 'amber' : '' },
```

- [ ] **Step 3: Recalibrate McClellan Oscillator — overbought/oversold extremes**

```jsx
// Replace:
{ key: 'mcclellan_osc', label: 'McClellan', group: G.VOLUME, fmt: v => fmtDec(v, 1),
  colorFn: v => v == null ? '' : v > 0 ? 'green' : 'red' },

// With (±150 = extremes; mild >0 is not strongly bullish):
{ key: 'mcclellan_osc', label: 'McClellan', group: G.VOLUME, fmt: v => fmtDec(v, 1),
  colorFn: v => v == null ? '' : v > 150 ? 'amber' : v > 0 ? 'green' : v < -150 ? 'amber' : 'red' },
```

- [ ] **Step 4: Fix NAAIM — high readings are bullish trend confirmation, not a warning**

```jsx
// Replace:
{ key: 'naaim', label: 'NAAIM', group: G.SENTIMENT, fmt: v => fmtDec(v, 2),
  colorFn: v => v == null ? '' : v > 80 ? 'amber' : v < 25 ? 'green' : '' },

// With (>90 with context = amber caution; <25 = extreme fear = green contrarian signal):
{ key: 'naaim', label: 'NAAIM', group: G.SENTIMENT, fmt: v => fmtDec(v, 2),
  colorFn: v => v == null ? '' : v > 90 ? 'amber' : v < 25 ? 'green' : '' },
```

- [ ] **Step 5: Also fix CBOE P/C threshold (post-0DTE structural shift: green at 0.85, not 1.0)**

```jsx
// Replace:
{ key: 'cboe_putcall', label: 'CBOE P/C', group: G.SENTIMENT, fmt: v => fmtDec(v, 2),
  colorFn: v => v == null ? '' : v >= 1.0 ? 'green' : v <= 0.7 ? 'red' : '' },
{ key: 'avg_10d_cpc',  label: '10d P/C',  group: G.SENTIMENT, fmt: v => fmtDec(v, 2),
  colorFn: v => v == null ? '' : v >= 0.95 ? 'green' : v <= 0.72 ? 'red' : '' },

// With:
{ key: 'cboe_putcall', label: 'CBOE P/C', group: G.SENTIMENT, fmt: v => fmtDec(v, 2),
  colorFn: v => v == null ? '' : v >= 0.85 ? 'green' : v <= 0.65 ? 'red' : '' },
{ key: 'avg_10d_cpc',  label: '10d P/C',  group: G.SENTIMENT, fmt: v => fmtDec(v, 2),
  colorFn: v => v == null ? '' : v >= 0.82 ? 'green' : v <= 0.68 ? 'red' : '' },
```

- [ ] **Step 6: Verify in browser — AAII Spread now shows green on negative values, red on very positive. McClellan shows amber at extremes.**

- [ ] **Step 7: Commit**
```bash
git add app/src/pages/Breadth.jsx
git commit -m "fix: AAII spread inversion, McClellan extremes, NAAIM threshold, P/C recalibration, UCT Exp column reorder"
```

---

## Chunk 2: Backend — New Data Fields in breadth_collector.py

### Task 5: Phase + Distribution Days from market_regimes

**Files:**
- Modify: `C:\Users\Patrick\uct-intelligence\scripts\breadth_collector.py`

Market phase and distribution day counts are already set daily in `market_regimes` by Morning Wire. We add a `_fetch_regime_context()` function (similar to `_fetch_uct_exposure()`) and a `--patch-regime` backfill mode.

- [ ] **Step 1: Add `_fetch_regime_context(date_str)` function to breadth_collector.py** (add after the existing `_fetch_uct_exposure()` function)

```python
def _fetch_regime_context(date_str: str = None) -> dict:
    """Fetch market_phase, spy_dist_days, qqq_dist_days from market_regimes table."""
    import sqlite3
    result = {}
    if not date_str:
        return result
    try:
        db = ROOT / "data" / "uct_intelligence.db"
        with sqlite3.connect(str(db)) as conn:
            row = conn.execute(
                "SELECT phase, spy_dist_days, qqq_dist_days "
                "FROM market_regimes WHERE regime_date = ?",
                (date_str,),
            ).fetchone()
            if row:
                result["market_phase"]  = row[0]
                result["spy_dist_days"] = row[1]
                result["qqq_dist_days"] = row[2]
    except Exception:
        pass
    return result
```

- [ ] **Step 2: Call it in `collect()` — add after the `_fetch_uct_exposure` line**

```python
# UCT Regime context (phase + distribution days from market_regimes)
regime_ctx = _fetch_regime_context(today)
metrics.update(regime_ctx)
print(f"  Phase: {regime_ctx.get('market_phase')}  SPY DD: {regime_ctx.get('spy_dist_days')}  QQQ DD: {regime_ctx.get('qqq_dist_days')}")
```

- [ ] **Step 3: Call it in `backfill()` — add after the uct_exposure line**

```python
# Regime context (phase + distribution days)
regime_ctx = _fetch_regime_context(date_str)
m.update(regime_ctx)
```

- [ ] **Step 4: Add `patch_regime()` function** (add alongside existing `patch_exposure()`)

```python
def patch_regime(start_date: str = "2026-02-10", dry_run: bool = False) -> None:
    """Patch market_phase, spy_dist_days, qqq_dist_days from market_regimes into existing snapshots."""
    import sqlite3

    if not PUSH_SECRET:
        print("[patch-regime] PUSH_SECRET not set")
        return

    PATCH_BASE = PUSH_URL.replace("/push", "")
    db_path = ROOT / "data" / "uct_intelligence.db"

    with sqlite3.connect(str(db_path)) as conn:
        rows = conn.execute(
            "SELECT regime_date, phase, spy_dist_days, qqq_dist_days "
            "FROM market_regimes WHERE regime_date >= ? ORDER BY regime_date",
            (start_date,),
        ).fetchall()

    print(f"Found {len(rows)} regime rows since {start_date}")
    ok, skip, fail = 0, 0, 0

    for regime_date, phase, spy_dd, qqq_dd in rows:
        if dry_run:
            print(f"  {regime_date}: phase={phase} spy_dd={spy_dd} qqq_dd={qqq_dd} [dry-run]")
            continue
        # Patch each field individually
        for key, val in [("market_phase", phase), ("spy_dist_days", spy_dd), ("qqq_dist_days", qqq_dd)]:
            if val is None:
                continue
            try:
                r = requests.patch(
                    f"{PATCH_BASE}/{regime_date}/field",
                    json={"key": key, "value": val},
                    headers={"Authorization": f"Bearer {PUSH_SECRET}"},
                    timeout=15,
                )
                if r.status_code == 200:
                    ok += 1
                elif r.status_code == 404:
                    skip += 1
                    break  # no snapshot for this date, skip remaining fields
                else:
                    fail += 1
            except Exception as e:
                print(f"  {regime_date} {key}: ERROR {e}")
                fail += 1
        if not dry_run:
            print(f"  {regime_date}: {phase} / spy={spy_dd} / qqq={qqq_dd}")
        time.sleep(0.15)

    print(f"\nDone. {ok} fields patched, {skip} snapshots skipped, {fail} failed.")
```

- [ ] **Step 5: Wire `--patch-regime` into CLI block** (alongside existing `--patch-exposure`)

```python
parser.add_argument("--patch-regime", action="store_true",
                    help="Patch market_phase + dist days from market_regimes into existing snapshots")
...
if args.patch_regime:
    patch_regime(start_date=args.since, dry_run=args.dry_run)
```

- [ ] **Step 6: Run dry-run, then live run**

```bash
cd C:\Users\Patrick\uct-intelligence
python scripts/breadth_collector.py --patch-regime --dry-run
python scripts/breadth_collector.py --patch-regime
```

Expected output: 21 rows patched (same dates as exposure backfill).

- [ ] **Step 7: Commit breadth_collector.py changes**

```bash
cd C:\Users\Patrick\uct-intelligence
git add scripts/breadth_collector.py
git commit -m "feat: add market_phase + dist days collection + --patch-regime backfill"
```

---

### Task 6: RSP/SPY ratio + VXMT/VIX term structure

**Files:**
- Modify: `C:\Users\Patrick\uct-intelligence\scripts\breadth_collector.py`

RSP and IWM are ETFs and are filtered out of the universe. We fetch them explicitly via yfinance in the indices section. VXMT (^VXMT = 3-month VIX) is fetched alongside VIX.

- [ ] **Step 1: In `_fetch_indices()`, add RSP, IWM, VXMT to the yfinance download**

Find the line (around 913):
```python
df = yf.download(["^VIX", "^VXN", "^GSPC"], period="1y", auto_adjust=True, progress=False)
```

Replace with:
```python
df = yf.download(
    ["^VIX", "^VXN", "^VXMT", "^GSPC", "RSP", "IWM"],
    period="1y", auto_adjust=True, progress=False
)
```

- [ ] **Step 2: Extract RSP, IWM, VXMT values in `_fetch_indices()`** — add after the existing VIX/VXN extraction block:

```python
# RSP/SPY ratio — market participation quality
try:
    if isinstance(df.columns, pd.MultiIndex):
        rsp_s = df["Close"]["RSP"].dropna()
    else:
        rsp_s = df["Close"].get("RSP", pd.Series()).dropna()
    # SPY close is already in result from the universe closes path above
    spy_close = result.get("spy_close")
    if len(rsp_s) > 0 and spy_close:
        result["rsp_close"] = round(float(rsp_s.iloc[-1]), 2)
        result["rsp_spy_ratio"] = round(float(rsp_s.iloc[-1]) / spy_close, 4)
except Exception:
    pass

# IWM/QQQ ratio — small cap vs large cap leadership
try:
    if isinstance(df.columns, pd.MultiIndex):
        iwm_s = df["Close"]["IWM"].dropna()
    else:
        iwm_s = df["Close"].get("IWM", pd.Series()).dropna()
    qqq_close = result.get("qqq_close")
    if len(iwm_s) > 0 and qqq_close:
        result["iwm_qqq_ratio"] = round(float(iwm_s.iloc[-1]) / qqq_close, 4)
except Exception:
    pass

# VXMT/VIX term structure — <1.0 = backwardation (acute stress)
try:
    if isinstance(df.columns, pd.MultiIndex):
        vxmt_s = df["Close"]["^VXMT"].dropna()
    else:
        vxmt_s = df["Close"].get("^VXMT", pd.Series()).dropna()
    vix_val = result.get("vix")
    if len(vxmt_s) > 0 and vix_val:
        result["vxmt"] = round(float(vxmt_s.iloc[-1]), 2)
        result["vix_term_structure"] = round(float(vxmt_s.iloc[-1]) / vix_val, 3)
except Exception:
    pass
```

- [ ] **Step 3: Also update the `backfill()` yfinance download to include RSP, IWM, and ^VXMT**

Find the `yf.download` call inside `backfill()` (around line 1566 in breadth_collector.py):
```python
# Change:
idx_df = yf.download(["^VIX", "^VXN", "^GSPC"], period="1y", auto_adjust=True, progress=False)
# To:
idx_df = yf.download(["^VIX", "^VXN", "^VXMT", "^GSPC", "RSP", "IWM"], period="1y", auto_adjust=True, progress=False)
```
Without this fix, `_indices_from_slice()` will never see RSP/IWM/VXMT columns and will silently compute nothing for those fields during `--backfill` runs.

- [ ] **Step 4: Add the same computation to `_indices_from_slice()` for backfill** (the function that extracts index metrics from historical slices)

Find `_indices_from_slice()` and add parallel logic after VIX/VXN extraction:
```python
# RSP/SPY ratio
for sym, key in [("RSP", "rsp"), ("IWM", "iwm")]:
    if sym in idx_closes.columns:
        try:
            s = idx_closes[sym].loc[:date_str].dropna()
            if len(s) > 0:
                result[f"{key}_close"] = round(float(s.iloc[-1]), 2)
        except Exception:
            pass

spy_c = result.get("spy_close")
rsp_c = result.get("rsp_close")
if spy_c and rsp_c:
    result["rsp_spy_ratio"] = round(rsp_c / spy_c, 4)

qqq_c = result.get("qqq_close")
iwm_c = result.get("iwm_close")
if qqq_c and iwm_c:
    result["iwm_qqq_ratio"] = round(iwm_c / qqq_c, 4)

# VXMT/VIX
if "^VXMT" in idx_closes.columns:
    try:
        vxmt_s = idx_closes["^VXMT"].loc[:date_str].dropna()
        vix_val = result.get("vix")
        if len(vxmt_s) > 0:
            result["vxmt"] = round(float(vxmt_s.iloc[-1]), 2)
            if vix_val:
                result["vix_term_structure"] = round(float(vxmt_s.iloc[-1]) / vix_val, 3)
    except Exception:
        pass
```

- [ ] **Step 4: Add `--patch-rsp-vix3m` backfill mode**

```python
def patch_rsp_vix3m(start_date: str = "2026-02-10", dry_run: bool = False) -> None:
    """Backfill rsp_spy_ratio, iwm_qqq_ratio, vxmt, vix_term_structure from yfinance history."""
    import yfinance as yf

    if not PUSH_SECRET:
        print("[patch-rsp-vix3m] PUSH_SECRET not set")
        return

    PATCH_BASE = PUSH_URL.replace("/push", "")

    print("Downloading RSP, IWM, ^VXMT, SPY, QQQ, ^VIX history...")
    df = yf.download(
        ["RSP", "IWM", "^VXMT", "SPY", "QQQ", "^VIX"],
        start=start_date, auto_adjust=True, progress=False
    )
    closes = df["Close"] if isinstance(df.columns, pd.MultiIndex) else df

    # Get all trading dates with existing snapshots in range
    import sqlite3
    db_path = ROOT / "data" / "uct_intelligence.db"
    # Use closes index as the source of trading dates
    start_ts = pd.Timestamp(start_date)
    trading_dates = [d.strftime("%Y-%m-%d") for d in closes.index if d >= start_ts]
    print(f"Processing {len(trading_dates)} dates...")

    ok, skip, fail = 0, 0, 0
    for date_str in trading_dates:
        try:
            sl = closes.loc[:date_str]
            metrics = {}
            for sym, key in [("SPY", "spy"), ("QQQ", "qqq"), ("RSP", "rsp"), ("IWM", "iwm")]:
                if sym in sl.columns:
                    s = sl[sym].dropna()
                    if len(s) > 0:
                        metrics[f"{key}_close"] = round(float(s.iloc[-1]), 2)

            spy_c = metrics.get("spy_close")
            rsp_c = metrics.get("rsp_close")
            qqq_c = metrics.get("qqq_close")
            iwm_c = metrics.get("iwm_close")

            if spy_c and rsp_c:
                metrics["rsp_spy_ratio"] = round(rsp_c / spy_c, 4)
            if qqq_c and iwm_c:
                metrics["iwm_qqq_ratio"] = round(iwm_c / qqq_c, 4)

            if "^VXMT" in sl.columns and "^VIX" in sl.columns:
                vxmt_s = sl["^VXMT"].dropna()
                vix_s  = sl["^VIX"].dropna()
                if len(vxmt_s) > 0:
                    metrics["vxmt"] = round(float(vxmt_s.iloc[-1]), 2)
                    if len(vix_s) > 0:
                        metrics["vix_term_structure"] = round(float(vxmt_s.iloc[-1]) / float(vix_s.iloc[-1]), 3)
        except Exception as e:
            print(f"  {date_str}: compute error {e}")
            fail += 1
            continue

        if dry_run:
            print(f"  {date_str}: rsp_spy={metrics.get('rsp_spy_ratio')} iwm_qqq={metrics.get('iwm_qqq_ratio')} vts={metrics.get('vix_term_structure')} [dry-run]")
            continue

        for key, val in metrics.items():
            if key.endswith("_close") or val is None:
                continue  # don't overwrite price closes
            try:
                r = requests.patch(
                    f"{PATCH_BASE}/{date_str}/field",
                    json={"key": key, "value": val},
                    headers={"Authorization": f"Bearer {PUSH_SECRET}"},
                    timeout=15,
                )
                if r.status_code == 200:
                    ok += 1
                elif r.status_code == 404:
                    skip += 1
                    break
                else:
                    fail += 1
            except Exception as e:
                print(f"  {date_str} {key}: ERROR {e}")
                fail += 1
        print(f"  {date_str}: OK")
        time.sleep(0.1)

    print(f"\nDone. {ok} fields patched, {skip} skipped, {fail} failed.")
```

- [ ] **Step 6: Wire `--patch-rsp-vix3m` into CLI**

```python
parser.add_argument("--patch-rsp-vix3m", action="store_true",
                    help="Backfill RSP/SPY ratio, IWM/QQQ ratio, VXMT/VIX from yfinance history")
...
if args.patch_rsp_vix3m:
    patch_rsp_vix3m(start_date=args.since, dry_run=args.dry_run)
```

- [ ] **Step 7: Run backfill**

```bash
python scripts/breadth_collector.py --patch-rsp-vix3m --dry-run
python scripts/breadth_collector.py --patch-rsp-vix3m
```

- [ ] **Step 8: Commit**

```bash
git add scripts/breadth_collector.py
git commit -m "feat: RSP/SPY ratio, IWM/QQQ ratio, VXMT/VIX term structure + --patch-rsp-vix3m backfill"
```

---

### Task 7: AAII survey date storage

**Files:**
- Modify: `C:\Users\Patrick\uct-intelligence\scripts\breadth_collector.py`

Currently the AAII survey date (the actual Thursday the poll was released) is not stored. We store it as `aaii_survey_date` so the frontend can dim repeated readings.

- [ ] **Step 1: Modify `_get_weekly_value()` to also return the key (survey date)**

Find `_get_weekly_value()` (around line 1463). Create a companion:
```python
def _get_weekly_key(hist: dict, date_str: str) -> str | None:
    """Return the dict key (survey date) for the most recent weekly value at or before date_str."""
    if not hist:
        return None
    candidates = [d for d in hist.keys() if d <= date_str]
    if not candidates:
        return None
    return max(candidates)
```

- [ ] **Step 2: In `collect()`, store `aaii_survey_date`** — add after `m.update(aaii)`:

```python
# Also store the AAII survey date so frontend can dim repeated readings
# _fetch_aaii() returns the current week's data; survey is the most recent Thursday
from datetime import date as _date, timedelta
today_d = _date.fromisoformat(today)
days_since_thursday = (today_d.weekday() - 3) % 7
aaii_thursday = today_d - timedelta(days=days_since_thursday)
metrics["aaii_survey_date"] = aaii_thursday.isoformat()
```

- [ ] **Step 3: In `backfill()`, store `aaii_survey_date`** — add after `m.update(aaii_week)`:

```python
survey_key = _get_weekly_key(aaii_hist, date_str)
if survey_key:
    m["aaii_survey_date"] = survey_key
```

- [ ] **Step 4: Add `--patch-aaii-date` mode**

```python
def patch_aaii_date(start_date: str = "2026-02-10", dry_run: bool = False) -> None:
    """Patch aaii_survey_date into existing snapshots (the Thursday survey release date)."""
    from datetime import date as _date, timedelta

    if not PUSH_SECRET:
        print("[patch-aaii-date] PUSH_SECRET not set")
        return

    PATCH_BASE = PUSH_URL.replace("/push", "")

    # Fetch aaii history to get actual survey dates
    print("Fetching AAII history for survey dates...")
    aaii_hist = _fetch_aaii_history()

    import sqlite3
    # Get all dates in breadth_snapshots in range (use market_regimes as proxy for trading dates)
    db_path = ROOT / "data" / "uct_intelligence.db"
    with sqlite3.connect(str(db_path)) as conn:
        rows = conn.execute(
            "SELECT regime_date FROM market_regimes WHERE regime_date >= ? ORDER BY regime_date",
            (start_date,),
        ).fetchall()
    trading_dates = [r[0] for r in rows]

    print(f"Processing {len(trading_dates)} dates...")
    ok, skip, fail = 0, 0, 0

    for date_str in trading_dates:
        survey_key = _get_weekly_key(aaii_hist, date_str) if aaii_hist else None
        if survey_key is None:
            # Fallback: compute nearest Thursday
            d = _date.fromisoformat(date_str)
            days_back = (d.weekday() - 3) % 7
            survey_key = (d - timedelta(days=days_back)).isoformat()

        if dry_run:
            print(f"  {date_str}: aaii_survey_date = {survey_key} [dry-run]")
            continue
        try:
            r = requests.patch(
                f"{PATCH_BASE}/{date_str}/field",
                json={"key": "aaii_survey_date", "value": survey_key},
                headers={"Authorization": f"Bearer {PUSH_SECRET}"},
                timeout=15,
            )
            if r.status_code == 200:
                ok += 1
                print(f"  {date_str}: {survey_key} -> OK")
            elif r.status_code == 404:
                skip += 1
            else:
                fail += 1
        except Exception as e:
            print(f"  {date_str}: ERROR {e}")
            fail += 1
        time.sleep(0.15)

    print(f"\nDone. {ok} patched, {skip} skipped, {fail} failed.")
```

- [ ] **Step 5: Wire `--patch-aaii-date` into CLI**

```python
parser.add_argument("--patch-aaii-date", action="store_true",
                    help="Patch aaii_survey_date into existing snapshots")
...
if args.patch_aaii_date:
    patch_aaii_date(start_date=args.since, dry_run=args.dry_run)
```

- [ ] **Step 6: Run backfill**

```bash
python scripts/breadth_collector.py --patch-aaii-date --dry-run
python scripts/breadth_collector.py --patch-aaii-date
```

- [ ] **Step 7: Commit**

```bash
git add scripts/breadth_collector.py
git commit -m "feat: store aaii_survey_date for weekly repeat detection + --patch-aaii-date backfill"
```

---

## Chunk 3: Server-Side Computed Metrics in breadth_monitor.py

### Task 8: Hi/Lo ratio, day % change, cumulative A/D line

**Files:**
- Modify: `api/services/breadth_monitor.py` (inside `get_history()`)

All three are computable from fields already stored in breadth_snapshots — no new collector data needed.

- [ ] **Step 1: Expand the rolling-window loop in `get_history()` to compute all derived fields**

Replace the existing loop body:
```python
for i, row in enumerate(result_asc):
    w5  = result_asc[max(0, i - 4):  i + 1]
    w10 = result_asc[max(0, i - 9):  i + 1]
    row["ratio_5day"]   = _ratio(w5,  "up_4pct_today", "down_4pct_today")
    row["ratio_10day"]  = _ratio(w10, "up_4pct_today", "down_4pct_today")
    row["avg_10d_cpc"]  = _rolling_avg(w10, "cboe_putcall", 2)
```

With:
```python
adv_decline_cum = 0  # running total for cumulative A/D line

for i, row in enumerate(result_asc):
    w5  = result_asc[max(0, i - 4):  i + 1]
    w10 = result_asc[max(0, i - 9):  i + 1]

    # Existing rolling metrics
    row["ratio_5day"]  = _ratio(w5,  "up_4pct_today", "down_4pct_today")
    row["ratio_10day"] = _ratio(w10, "up_4pct_today", "down_4pct_today")
    row["avg_10d_cpc"] = _rolling_avg(w10, "cboe_putcall", 2)

    # Hi/Lo ratio: new 52W highs as % of universe (shows breadth quality, not raw count)
    nh = row.get("new_52w_highs")
    nl = row.get("new_52w_lows")
    uni = row.get("universe_count")
    if nh is not None and uni and uni > 0:
        row["hi_ratio"] = round(nh / uni * 100, 2)
    else:
        row["hi_ratio"] = None
    if nl is not None and uni and uni > 0:
        row["lo_ratio"] = round(nl / uni * 100, 2)
    else:
        row["lo_ratio"] = None

    # Day-over-day % change for QQQ and SPY (needed for FTD detection and display)
    if i > 0:
        prev = result_asc[i - 1]
        for sym in ("qqq", "spy"):
            curr_c = row.get(f"{sym}_close")
            prev_c = prev.get(f"{sym}_close")
            if curr_c and prev_c and prev_c != 0:
                row[f"{sym}_day_pct"] = round((curr_c - prev_c) / prev_c * 100, 2)
            else:
                row[f"{sym}_day_pct"] = None
    else:
        row["qqq_day_pct"] = None
        row["spy_day_pct"] = None

    # Cumulative A/D line (running sum of daily adv_decline)
    ad = row.get("adv_decline")
    if ad is not None:
        adv_decline_cum += ad
        row["adv_decline_cum"] = adv_decline_cum
    else:
        row["adv_decline_cum"] = None
```

- [ ] **Step 2: Verify the API returns new fields**

```bash
cd C:\Users\Patrick\uct-dashboard
python -c "
from api.services import breadth_monitor as svc
svc.init_db()
rows = svc.get_history(5)
for r in rows:
    print(r.get('date'), 'hi_ratio:', r.get('hi_ratio'), 'qqq_day_pct:', r.get('qqq_day_pct'), 'adv_decline_cum:', r.get('adv_decline_cum'))
"
```

Expected: dates with hi_ratio (e.g. 2.1), qqq_day_pct (e.g. -1.34), adv_decline_cum (running number).

- [ ] **Step 3: Commit**

```bash
git add api/services/breadth_monitor.py
git commit -m "feat: hi/lo ratio, day pct change, cumulative A/D line computed server-side"
```

---

### Task 9: FTD (Follow-Through Day) flag

**Files:**
- Modify: `api/services/breadth_monitor.py` (add to the loop in `get_history()`)

FTD heuristic: QQQ up >= 1.25% on above-average volume (up_vol_ratio > 1.3) AND it is day 4+ from a recent significant low (QQQ within 20 bars of a trough that was at least -5% from the prior high). This is a simplified but practical detection.

- [ ] **Step 1: Add FTD detection to the `get_history()` loop** — add after the day_pct computation block

```python
    # FTD detection: simplified O'Neil Follow-Through Day
    # Criteria: QQQ up >= 1.25% on above-avg volume, on Day 4+ of rally from a prior trough
    row["is_ftd"] = False
    qqq_pct = row.get("qqq_day_pct")
    up_vol   = row.get("up_vol_ratio")
    if qqq_pct is not None and qqq_pct >= 1.25 and up_vol is not None and up_vol >= 1.3 and i >= 3:
        # Walk backwards from the PRIOR day (j=i-1) counting consecutive up days
        # (the current day already qualifies as the up day; we need 3 more prior up days = 4 total)
        rally_days = 1  # count current day
        for j in range(i - 1, max(i - 10, -1), -1):
            prev_pct = result_asc[j].get("qqq_day_pct")
            if prev_pct is not None and prev_pct > 0:
                rally_days += 1
            else:
                break
        # Check drawdown: use closes BEFORE the current day's rally (closes[:-1]) to find the trough
        # so the current up day doesn't pollute the low calculation
        window = result_asc[max(0, i - 15): i]  # exclude current day
        prior_closes = [r.get("qqq_close") for r in window if r.get("qqq_close")]
        if prior_closes and len(prior_closes) >= 4:
            recent_high = max(prior_closes)
            recent_low  = min(prior_closes)
            drawdown = (recent_low - recent_high) / recent_high * 100
            if rally_days >= 4 and drawdown <= -3.0:
                row["is_ftd"] = True
```

- [ ] **Step 2: Verify**

```bash
python -c "
from api.services import breadth_monitor as svc
svc.init_db()
rows = svc.get_history(90)
ftds = [r for r in rows if r.get('is_ftd')]
print(f'FTD flags in history: {len(ftds)}')
for r in ftds:
    print(r.get('date'), 'qqq_pct:', r.get('qqq_day_pct'), 'up_vol:', r.get('up_vol_ratio'))
"
```

- [ ] **Step 3: Commit**

```bash
git add api/services/breadth_monitor.py
git commit -m "feat: FTD (Follow-Through Day) flag detection in breadth_monitor service"
```

---

### Task 10: Composite breadth health score

**Files:**
- Modify: `api/services/breadth_monitor.py` — add `_compute_breadth_score()` helper and call in loop

The composite score (0–100) weights 8 factors. This gives a headline number for quick daily read.

| Component | Weight | Logic |
|-----------|--------|-------|
| % Above 50 SMA | 20pts | 0 at ≤30%, 20 at ≥65% (linear) |
| 5-Day Up/Down Ratio | 15pts | 0 at ≤0.7, 15 at ≥1.5 (linear) |
| MAGNA ratio (up/total) | 10pts | 0 at ≤40%, 10 at ≥70% |
| Hi/Lo ratio (52W Hi%) | 10pts | 0 at ≤0.5%, 10 at ≥5% |
| CBOE P/C (contrarian) | 10pts | 10 at ≥0.85, 0 at ≤0.65 (linear) |
| AAII Spread (contrarian) | 10pts | 10 at ≤-20, 0 at ≥+30 |
| VIX | 10pts | 10 at ≤18, 0 at ≥30 (linear) |
| Stage 2 % of universe | 10pts | 0 at ≤5%, 10 at ≥25% |
| Cumulative A/D trend | 5pts | +5 if adv_decline > 0, else 0 |

- [ ] **Step 1: Add `_compute_breadth_score()` to `breadth_monitor.py`** (add before `get_history()`)

```python
def _lerp(val, lo, hi, max_pts):
    """Linear interpolation: map val in [lo..hi] -> [0..max_pts], clamped."""
    if val is None:
        return 0
    if val <= lo:
        return 0
    if val >= hi:
        return max_pts
    return round((val - lo) / (hi - lo) * max_pts, 1)

def _compute_breadth_score(row: dict) -> Optional[float]:
    """Composite market breadth health score 0–100."""
    score = 0.0

    # 1. % above 50 SMA (20pts)
    score += _lerp(row.get("pct_above_50sma"), 30, 65, 20)

    # 2. 5-day up/down ratio (15pts)
    score += _lerp(row.get("ratio_5day"), 0.7, 1.5, 15)

    # 3. MAGNA ratio — up / (up + down) (10pts)
    mu = row.get("magna_up")
    md = row.get("magna_down")
    if mu is not None and md is not None and (mu + md) > 0:
        score += _lerp(mu / (mu + md) * 100, 40, 70, 10)

    # 4. 52W Hi ratio % (10pts)
    score += _lerp(row.get("hi_ratio"), 0.5, 5.0, 10)

    # 5. CBOE P/C contrarian (10pts) — higher P/C = more fearful = bullish setup
    score += _lerp(row.get("cboe_putcall"), 0.65, 0.85, 10)

    # 6. AAII Spread contrarian (10pts) — more bearish spread = more bullish setup
    spread = row.get("aaii_spread")
    if spread is not None:
        score += _lerp(-spread, -30, 20, 10)  # invert: -30 spread (very bearish) maps to 10pts

    # 7. VIX (10pts) — lower VIX = calmer market = higher score
    vix = row.get("vix")
    if vix is not None:
        score += _lerp(30 - vix, 0, 12, 10)  # 30-VIX: VIX=18 -> 12pts input -> 10pts out

    # 8. Stage 2 % of universe (10pts)
    s2 = row.get("stage2_count")
    uni = row.get("universe_count")
    if s2 is not None and uni and uni > 0:
        score += _lerp(s2 / uni * 100, 5, 25, 10)

    # 9. Daily A/D direction (5pts)
    ad = row.get("adv_decline")
    if ad is not None and ad > 0:
        score += 5

    return round(min(100, max(0, score)), 1)
```

- [ ] **Step 2: Call it inside the `get_history()` loop** — add at the end of the loop body

```python
    row["breadth_score"] = _compute_breadth_score(row)
```

- [ ] **Step 3: Verify**

```bash
python -c "
from api.services import breadth_monitor as svc
svc.init_db()
rows = svc.get_history(10)
for r in rows:
    print(r.get('date'), 'score:', r.get('breadth_score'))
"
```

Expected: scores between 0 and 100, varying by date.

- [ ] **Step 4: Commit**

```bash
git add api/services/breadth_monitor.py
git commit -m "feat: composite breadth health score (0-100) with 9 weighted components"
```

---

## Chunk 4: Frontend — New Columns + Row Coloring + Composite Gauge

### Task 11: Add all new data columns to Breadth.jsx

**Files:**
- Modify: `app/src/pages/Breadth.jsx` (COLS array additions)

Add all new backend fields to the COLS array in the appropriate groups.

- [ ] **Step 1: Add to Regime group** — insert after existing MA stack columns

```jsx
// After qqq_ma_stack:
{ key: 'market_phase',      label: 'Phase',      group: G.REGIME,
  colorFn: v => v == null ? '' :
    ['Uptrend','Bull','Recovery'].some(p => v.includes(p)) ? 'green' :
    ['Distribution','Liquidation','Correction'].some(p => v.includes(p)) ? 'red' : 'amber' },
{ key: 'spy_dist_days',     label: 'SPY DD',     group: G.REGIME,
  colorFn: v => v == null ? '' : v >= 7 ? 'red' : v >= 4 ? 'amber' : v <= 1 ? 'green' : '' },
{ key: 'qqq_dist_days',     label: 'QQQ DD',     group: G.REGIME,
  colorFn: v => v == null ? '' : v >= 7 ? 'red' : v >= 4 ? 'amber' : v <= 1 ? 'green' : '' },
{ key: 'rsp_spy_ratio',     label: 'RSP/SPY',    group: G.REGIME, fmt: v => fmtDec(v, 4),
  colorFn: v => v == null ? '' : v > 0.46 ? 'green' : v < 0.43 ? 'red' : '' },
{ key: 'iwm_qqq_ratio',     label: 'IWM/QQQ',    group: G.REGIME, fmt: v => fmtDec(v, 4),
  colorFn: v => v == null ? '' : v > 0.18 ? 'green' : v < 0.15 ? 'red' : '' },
{ key: 'vix_term_structure',label: 'VTS',        group: G.REGIME, fmt: v => fmtDec(v, 3),
  colorFn: v => v == null ? '' : v >= 1.05 ? 'green' : v < 1.0 ? 'red' : 'amber' },
```

- [ ] **Step 2: Add to Primary Breadth group** — add FTD + day pct cols

```jsx
// After universe_count:
{ key: 'qqq_day_pct',       label: 'QQQ%',       group: G.PRIMARY, fmt: v => fmtDec(v, 2),
  colorFn: v => v == null ? '' : v >= 1.25 ? 'green' : v <= -1.25 ? 'red' : '' },
{ key: 'spy_day_pct',       label: 'SPY%',       group: G.PRIMARY, fmt: v => fmtDec(v, 2),
  colorFn: v => v == null ? '' : v >= 1.25 ? 'green' : v <= -1.25 ? 'red' : '' },
{ key: 'is_ftd',            label: 'FTD',        group: G.PRIMARY,
  fmt: v => v ? 'FTD' : '—',
  colorFn: v => v ? 'green' : '' },
```

- [ ] **Step 3: Add to Highs/Lows group** — Hi/Lo ratio columns

```jsx
// After near_52w_high:
{ key: 'hi_ratio',          label: 'Hi%',        group: G.HIGHS, fmt: v => fmtDec(v, 2),
  colorFn: v => v == null ? '' : v > 4 ? 'green' : v < 0.5 ? 'red' : '' },
{ key: 'lo_ratio',          label: 'Lo%',        group: G.HIGHS, fmt: v => fmtDec(v, 2),
  colorFn: v => v == null ? '' : v > 4 ? 'red' : v < 0.5 ? 'green' : '' },
```

- [ ] **Step 4: Add to Volume/A-D group** — cumulative A/D

```jsx
// After mcclellan_osc:
{ key: 'adv_decline_cum',   label: 'A-D Cum',    group: G.VOLUME, fmt: v => fmtDec(v, 0),
  colorFn: v => v == null ? '' : v > 0 ? 'green' : 'red' },
```

- [ ] **Step 5: Add composite score as first column after the Date** — insert at the very top of COLS, before Regime

```jsx
// Before the Regime section:
const G = {
  SCORE:     'Score',   // <-- add this
  REGIME:    'Regime',
  ...
}

// First entry in COLS:
{ key: 'breadth_score',     label: 'Health',     group: G.SCORE,
  fmt: v => fmtDec(v, 0),
  colorFn: v => v == null ? '' : v >= 65 ? 'green' : v <= 35 ? 'red' : 'amber' },
```

And add its group header color:
```jsx
const GROUP_HEADER_CLASS = {
  [G.SCORE]:     styles.ghScore,
  ...
}
```

```css
/* In Breadth.module.css: */
.ghScore { background: #141414; color: #c9a84c; font-weight: 900; }
```

- [ ] **Step 6: Commit**

```bash
cd C:\Users\Patrick\uct-dashboard
git add app/src/pages/Breadth.jsx app/src/pages/Breadth.module.css
git commit -m "feat: add all new columns (phase, DDC, RSP/SPY, VTS, FTD, Hi%, A-D cum, composite score)"
```
(Deployment happens in the Final section after all changes are committed.)

---

### Task 12: Row-level regime coloring

**Files:**
- Modify: `app/src/pages/Breadth.jsx`
- Modify: `app/src/pages/Breadth.module.css`

Each row gets a subtle 2px left border color indicating the market phase for that day. Green = uptrend/recovery, amber = rally attempt/caution, red = distribution/correction.

- [ ] **Step 1: Add `phaseClass()` helper function in Breadth.jsx**

```jsx
function phaseClass(phase) {
  if (!phase) return ''
  const p = phase.toLowerCase()
  if (['uptrend', 'bull', 'recovery'].some(k => p.includes(k))) return styles.phaseGreen
  if (['distribution', 'liquidation', 'correction'].some(k => p.includes(k))) return styles.phaseRed
  return styles.phaseAmber  // rally attempt, caution, pullback
}
```

- [ ] **Step 2: Apply phase class to each `<tr>` in the tbody**

```jsx
// Change:
<tr key={row.date} className={ri % 2 === 0 ? styles.rowEven : styles.rowOdd}>

// To:
<tr key={row.date} className={`${ri % 2 === 0 ? styles.rowEven : styles.rowOdd} ${phaseClass(row.market_phase)}`}>
```

- [ ] **Step 3: Add CSS for row phase classes**

```css
/* Row phase — left border color indicates market regime for that day */
.phaseGreen  { border-left: 3px solid rgba(74, 222, 128, 0.5); }
.phaseRed    { border-left: 3px solid rgba(248, 113, 113, 0.5); }
.phaseAmber  { border-left: 3px solid rgba(201, 168, 76, 0.3); }
```

- [ ] **Step 4: Verify — rows with Uptrend phase have green left border; Distribution rows have red; Rally Attempt rows have amber**

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/Breadth.jsx app/src/pages/Breadth.module.css
git commit -m "feat: row-level regime color border (green/amber/red by market phase)"
```

---

### Task 13: AAII weekly repeat dimming + composite score gauge in header

**Files:**
- Modify: `app/src/pages/Breadth.jsx`
- Modify: `app/src/pages/Breadth.module.css`

Part A: Dim AAII cells on days where the value is a carry-forward from a prior survey (date != survey date).
Part B: Add a headline composite score gauge above the table.

- [ ] **Step 1: Add AAII staleness check in the cell renderer**

In the `visibleCols.map(col => ...)` loop inside the tbody, add a special case for AAII columns:

```jsx
// Define AAII columns that repeat weekly
const AAII_KEYS = new Set(['aaii_bulls', 'aaii_neutral', 'aaii_bears', 'aaii_spread'])

// In the cell render (before the generic td):
const isStaleAaii = AAII_KEYS.has(col.key) &&
  row.aaii_survey_date &&
  row.aaii_survey_date !== row.date

return (
  <td
    key={col.key}
    className={`${styles.td} ${cellClass(col, val)} ${isStaleAaii ? styles.aaiiStale : ''}`}
    title={isStaleAaii ? `Survey: ${row.aaii_survey_date}` : undefined}
  >
    {fmtCell(col, val)}
  </td>
)
```

- [ ] **Step 2: Add CSS for stale AAII cells**

```css
.aaiiStale {
  opacity: 0.45;
  font-style: italic;
}
```

- [ ] **Step 3: Add composite score summary bar above the table**

In the Breadth.jsx return, add between `<div className={styles.header}>` and `<div className={styles.tableWrap}>`:

```jsx
{rows.length > 0 && (() => {
  const latest = rows[0]
  const score = latest?.breadth_score
  const phase = latest?.market_phase ?? '—'
  const exp = latest?.uct_exposure
  const dd = latest?.spy_dist_days
  return (
    <div className={styles.scoreSummary}>
      <div className={styles.scoreGauge}>
        <span className={styles.scoreLabel}>HEALTH</span>
        <span className={`${styles.scoreValue} ${
          score >= 65 ? styles.scoreGreen : score <= 35 ? styles.scoreRed : styles.scoreAmber
        }`}>{score != null ? score : '—'}</span>
        <div className={styles.scoreBar}>
          <div
            className={styles.scoreBarFill}
            style={{ width: `${score ?? 0}%`, background:
              score >= 65 ? 'var(--ut-green-bright)' :
              score <= 35 ? 'var(--loss)' : 'var(--ut-gold)'
            }}
          />
        </div>
      </div>
      <div className={styles.scoreMeta}>
        <span className={styles.scoreMetaItem}>Phase: <strong>{phase}</strong></span>
        <span className={styles.scoreMetaItem}>Exposure: <strong>{exp != null ? `${exp}%` : '—'}</strong></span>
        <span className={styles.scoreMetaItem}>SPY DD: <strong>{dd ?? '—'}</strong></span>
      </div>
    </div>
  )
})()}
```

- [ ] **Step 4: Add CSS for the summary bar**

```css
.scoreSummary {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 10px 16px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  margin-bottom: 10px;
  flex-shrink: 0;
}
.scoreGauge {
  display: flex;
  align-items: center;
  gap: 10px;
}
.scoreLabel {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 9px;
  letter-spacing: 2px;
  color: var(--text-muted);
  text-transform: uppercase;
}
.scoreValue {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 28px;
  font-weight: 700;
  line-height: 1;
  min-width: 44px;
}
.scoreGreen { color: var(--ut-green-bright, #4ade80); }
.scoreRed   { color: var(--loss, #f87171); }
.scoreAmber { color: var(--ut-gold, #c9a84c); }
.scoreBar {
  width: 100px;
  height: 6px;
  background: rgba(255,255,255,0.08);
  border-radius: 3px;
  overflow: hidden;
}
.scoreBarFill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.4s ease;
}
.scoreMeta {
  display: flex;
  gap: 20px;
  border-left: 1px solid var(--border);
  padding-left: 20px;
}
.scoreMetaItem {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  color: var(--text-muted);
}
.scoreMetaItem strong {
  color: var(--text);
  font-weight: 600;
}
```

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/Breadth.jsx app/src/pages/Breadth.module.css
git commit -m "feat: AAII stale-reading dimming + composite health score summary bar"
```

---

## Chunk 5: Advanced UX Features

### Task 14: Column sort

**Files:**
- Modify: `app/src/pages/Breadth.jsx`
- Modify: `app/src/pages/Breadth.module.css`

- [ ] **Step 1: Add sort state**

```jsx
const [sortKey, setSortKey] = useState(null)
const [sortDir, setSortDir] = useState('desc')  // 'asc' | 'desc'
```

- [ ] **Step 2: Compute `sortedRows`**

```jsx
const sortedRows = useMemo(() => {
  if (!sortKey) return rows
  return [...rows].sort((a, b) => {
    const av = a[sortKey] ?? (sortDir === 'asc' ? Infinity : -Infinity)
    const bv = b[sortKey] ?? (sortDir === 'asc' ? Infinity : -Infinity)
    if (typeof av === 'string' && typeof bv === 'string') {
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    }
    return sortDir === 'asc' ? av - bv : bv - av
  })
}, [rows, sortKey, sortDir])
```

Also add `useMemo` to imports.

- [ ] **Step 3: Add sort click handler on column label `<th>`**

```jsx
// Replace the column label <th> onClick:
onClick={() => {
  if (sortKey === col.key) {
    setSortDir(d => d === 'desc' ? 'asc' : 'desc')
  } else {
    setSortKey(col.key)
    setSortDir('desc')
  }
}}

// Add sort indicator in the label:
{isColCollapsed
  ? <span className={styles.colCollapsedLabel}>{col.label}</span>
  : <>
      {col.label}
      {sortKey === col.key && (
        <span className={styles.sortIndicator}>{sortDir === 'desc' ? ' ▾' : ' ▴'}</span>
      )}
    </>
}
```

- [ ] **Step 4: Replace `rows.map(...)` in tbody with `sortedRows.map(...)`**

- [ ] **Step 5: Add "clear sort" — double-click date column header resets sort**

```jsx
<th ... onDoubleClick={() => setSortKey(null)}>Date</th>
```

- [ ] **Step 6: Add CSS**

```css
.sortIndicator { font-size: 9px; opacity: 0.8; }
```

- [ ] **Step 7: Verify — click any numeric column header to sort rows; click again to reverse; double-click Date to restore chronological order**

- [ ] **Step 8: Commit**

```bash
git add app/src/pages/Breadth.jsx app/src/pages/Breadth.module.css
git commit -m "feat: column sort in breadth monitor (click header to sort, double-click date to reset)"
```

---

### Task 15: CSV export

**Files:**
- Modify: `app/src/pages/Breadth.jsx`
- Modify: `app/src/pages/Breadth.module.css`

- [ ] **Step 1: Add `exportCsv()` function**

```jsx
function exportCsv(rows, cols) {
  const headers = ['date', ...cols.map(c => c.key)]
  const lines = [
    headers.join(','),
    ...rows.map(row =>
      headers.map(h => {
        const v = row[h]
        if (v === null || v === undefined) return ''
        if (typeof v === 'string' && v.includes(',')) return `"${v}"`
        return v
      }).join(',')
    )
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `breadth-monitor-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 2: Add download button in the header** (alongside the days pills)

```jsx
<button
  className={styles.exportBtn}
  onClick={() => exportCsv(sortedRows, COLS)}
  title="Download as CSV"
>
  ↓ CSV
</button>
```

- [ ] **Step 3: Add CSS**

```css
.exportBtn {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  padding: 3px 10px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
  margin-left: 8px;
}
.exportBtn:hover { border-color: var(--ut-gold); color: var(--ut-gold); }
```

- [ ] **Step 4: Verify — clicking CSV button downloads a properly formatted file with all visible columns**

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/Breadth.jsx app/src/pages/Breadth.module.css
git commit -m "feat: CSV export button for breadth monitor"
```

---

### Task 16: Sparklines for trending metrics

**Files:**
- Modify: `app/src/pages/Breadth.jsx`
- Modify: `app/src/pages/Breadth.module.css`

Sparklines are inline SVGs showing the 10-day trend of select metrics. Applied to: `new_52w_highs`, `stage2_count`, `magna_up`, `breadth_score`. The sparkline replaces the numeric value in those cells (number shown as tooltip).

- [ ] **Step 1: Add `Sparkline` component**

```jsx
function Sparkline({ values, color = 'var(--text-muted)', width = 50, height = 18 }) {
  const vals = values.filter(v => v != null)
  if (vals.length < 2) return null
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const range = max - min || 1
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 2) - 1
    return `${x},${y}`
  })
  return (
    <svg width={width} height={height} className={styles.sparkline}>
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
```

- [ ] **Step 2: Add `type: 'sparkline'` support to COLS array** — mark specific columns

```jsx
// Add to these columns in COLS:
{ key: 'new_52w_highs',  label: '52W Hi', group: G.HIGHS, type: 'sparkline',
  colorFn: ... },
{ key: 'stage2_count', label: 'Stage 2', group: G.SETUPS, type: 'sparkline',
  colorFn: ... },
{ key: 'breadth_score', label: 'Health', group: G.SCORE, type: 'sparkline_num',
  ...  },
```

- [ ] **Step 3: Build per-column sparkline data** — keyed by date (not row index) so it works correctly when sort is active

```jsx
// Before the tbody (sparkData is a map of { colKey: { dateStr: last10Values[] } })
const sparkData = useMemo(() => {
  const out = {}
  const sparkCols = COLS.filter(c => c.type === 'sparkline' || c.type === 'sparkline_num')
  if (!sparkCols.length) return out
  // rows is newest-first; build oldest-first array + date→index lookup
  const asc = [...rows].reverse()
  const dateToIdx = Object.fromEntries(asc.map((r, i) => [r.date, i]))
  for (const col of sparkCols) {
    out[col.key] = {}
    for (const row of rows) {
      const idx = dateToIdx[row.date]
      if (idx != null) {
        out[col.key][row.date] = asc
          .slice(Math.max(0, idx - 9), idx + 1)
          .map(r => r[col.key] ?? null)
      }
    }
  }
  return out
}, [rows])  // depends on `rows` (chronological), NOT sortedRows
```

- [ ] **Step 4: Render sparklines in the cell loop**

```jsx
if (col.type === 'sparkline') {
  // Lookup by date (works correctly even when sort is active)
  const last10 = sparkData[col.key]?.[row.date] ?? []
  const colorClass = cellClass(col, val)
  const color = colorClass === styles.cellGreen ? 'var(--ut-green-bright)'
              : colorClass === styles.cellRed ? 'var(--loss)' : 'var(--text-muted)'
  return (
    <td key={col.key} className={`${styles.td} ${styles.sparklineCell}`} title={val != null ? String(val) : '—'}>
      <Sparkline values={last10} color={color} />
    </td>
  )
}
```

- [ ] **Step 5: Add CSS**

```css
.sparkline { display: block; }
.sparklineCell { padding: 2px 6px; text-align: center; min-width: 62px; }
```

- [ ] **Step 6: Verify — 52W Hi, Stage 2, and Health Score columns show sparklines. Hovering shows the numeric value.**

- [ ] **Step 7: Commit**

```bash
git add app/src/pages/Breadth.jsx app/src/pages/Breadth.module.css
git commit -m "feat: inline sparklines for 52W highs, Stage 2, and breadth score columns"
```

---

### Task 17: localStorage persistence for collapsed state

**Files:**
- Modify: `app/src/pages/Breadth.jsx`

Collapsed group state and individual column collapse state should persist across page refreshes.

- [ ] **Step 1: Replace `useState` initializers with localStorage-aware versions**

```jsx
// Replace:
const [collapsed, setCollapsed] = useState(new Set())
const [collapsedCols, setCollapsedCols] = useState(new Set())

// With:
const [collapsed, setCollapsed] = useState(() => {
  try {
    const raw = localStorage.getItem('breadth_collapsed_groups')
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch { return new Set() }
})

const [collapsedCols, setCollapsedCols] = useState(() => {
  try {
    const raw = localStorage.getItem('breadth_collapsed_cols')
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch { return new Set() }
})
```

- [ ] **Step 2: Persist on every toggle — update `toggleGroup` and `toggleCol`**

```jsx
const toggleGroup = group => {
  setCollapsed(prev => {
    const next = new Set(prev)
    next.has(group) ? next.delete(group) : next.add(group)
    try { localStorage.setItem('breadth_collapsed_groups', JSON.stringify([...next])) } catch {}
    return next
  })
}

const toggleCol = key => {
  setCollapsedCols(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    try { localStorage.setItem('breadth_collapsed_cols', JSON.stringify([...next])) } catch {}
    return next
  })
}
```

- [ ] **Step 3: Verify — collapse a group, refresh page, confirm it stays collapsed**

- [ ] **Step 4: Commit**

```bash
git add app/src/pages/Breadth.jsx
git commit -m "feat: persist breadth monitor column/group collapse state in localStorage"
```

---

## Final: Deploy + Backfill Run

- [ ] **Deploy dashboard**

```bash
cd C:\Users\Patrick\uct-dashboard
git push origin master
# Wait ~90 seconds for Railway auto-deploy
```

- [ ] **Run all backfill modes**

```bash
cd C:\Users\Patrick\uct-intelligence
python scripts/breadth_collector.py --patch-regime --dry-run
python scripts/breadth_collector.py --patch-regime

python scripts/breadth_collector.py --patch-rsp-vix3m --dry-run
python scripts/breadth_collector.py --patch-rsp-vix3m

python scripts/breadth_collector.py --patch-aaii-date --dry-run
python scripts/breadth_collector.py --patch-aaii-date
```

- [ ] **Verify `/breadth` tab in browser**

Check:
- Composite Health Score gauge visible at top (0–100 with colored bar)
- UCT Exp is first Regime column
- Phase + DDC columns populated for Feb 20 – present
- RSP/SPY, IWM/QQQ, VTS columns showing values
- FTD column shows `FTD` on relevant days (if any detected)
- Hi% and Lo% columns showing ratios
- A-D Cum column showing running cumulative values
- AAII cells dimmed on carry-forward days
- Row left borders colored by phase (green/amber/red)
- Days pills working (30/60/90)
- Last updated timestamp in header
- Sort works (click column header)
- CSV export downloads valid file
- Collapse state persists on refresh

- [ ] **Final commit if any post-deploy tweaks needed**
