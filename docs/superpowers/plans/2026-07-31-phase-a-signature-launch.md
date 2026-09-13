# Phase A — Signature Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 3 server-computed premium "UCT Signature Indicators" (Dark Pool Levels, Flow-Confirmed Breakout, GEX Walls) on the existing StockChart path, plus an append-only signal ledger recording from day one — by Sep 5, with zero engine work.

**Architecture:** New FastAPI router `/api/signature/*` (premium-gated `require_paid`, ServeStale-wrapped) computes levels/signals from existing stores (darkpool.db, flow via proxied HTTP, GEX service, bars.db). Frontend fetches inside StockChart via SWR hooks patterned on `usePatternDetections`, renders through the existing `priceLines`/`markers` merge points + one new zone primitive (canvas — screenshot-safe). A nightly closed-bar sweep records Flow-Confirmed Breakout signals into an append-only SQLite ledger.

**Tech Stack:** FastAPI + sqlite3 (WAL) backend; React 19 + SWR + lightweight-charts 5.1 frontend; pytest (asyncio_mode=auto) + vitest (jsdom, pool=forks).

## Global Constraints

- **Work tree:** create a NEW worktree from `origin/master` (the main `C:\Users\Patrick\uct-dashboard` checkout is a stale Jul-11 feature branch `feat/catalyst-coverage-precision` with active WIP — NEVER commit there, never clobber it). All file paths below are relative to the new worktree root.
- **Worktree commands use ABSOLUTE paths** (house rule: relative-path trap).
- **Never touch Ravi's files:** `api/live_massive_router.py`, `api/schwab_router.py`, `api/massive_ws_worker.py`, `api/massive_processor.py`, `app/src/pages/OptionsFlow.jsx`, `api/liveflow_router.py` (Ravi-adjacent). This plan touches none of them.
- **Never mount under `/api/flow*`** — `api/flow_proxy.py` forwards that prefix to flow-worker. Our router prefix is `/api/signature`.
- **Ship:** `git push origin <branch>:master`, ONLY in a deploy window (≥4:20 PM ET or <9:15 AM ET). Never `git add -A` — stage files by name. Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Backend tests:** `python -m pytest tests/<file> -v` from worktree root. **Frontend tests:** `npm test -- run <path>` from `app/` (vitest config pins `pool: 'forks'` + 8GB heap — never override the pool).
- **Closed-bar only:** every signal/level is computed from confirmed data. No forming-bar values anywhere. Nothing enters the ledger unless closed-bar (spec §8).
- **No rounding inside compute** (spec §4); precision is presentation.
- **Premium gate:** module-local dependency named exactly `require_paid` (recognized by `auth_surface_check.GUARD_NAMES`), returning **402**.
- **DB conventions:** `os.environ.get("<FEATURE>_DB_PATH", "/data/<name>.db")` read into a module constant `_DB_PATH`; WAL; lazy `_ensure_init()`; `_WRITE_LOCK = threading.Lock()`; guarded ALTERs.
- **Every new `ServeStale` slot gets a reset fixture in `tests/conftest.py`** (follow `_reset_calendar_serve_stale`'s `sys.modules.get(...)` idiom — never import the router there).
- **Owner review gate:** the v1 rule numbers below and all user-facing copy (blurbs, tooltips, landing section) require explicit owner sign-off before the ship task. Landing-page copy ships ONLY on explicit "ship it".

## v1 Trading Rules — OWNER REVIEW BOX (tunable constants, one module)

All thresholds live in `api/services/signature/rules.py` as named constants so tuning is a one-file diff:

| Indicator | Rule (v1 draft — owner tunes) |
|---|---|
| **Dark Pool Levels** (`dpl-v1`) | Window: last **20** distinct trading dates in `darkpool_trades` for the ticker. Cluster prints into price bins of width **0.25%** of the median print price. Keep clusters with total notional ≥ **$10M**; rank by total notional; return top **5**. Level price = notional-weighted mean of the cluster. Non-repainting by construction: reads only the nightly-confirmed `darkpool_trades` table (never `darkpool_today`). |
| **Flow-Confirmed Breakout** (`fcb-v1`) | Timeframe: **1D only** in v1. Breakout (bull): confirmed daily close > max(high of prior **20** bars) AND bar volume ≥ **1.25×** trailing 20-bar avg volume. Bear: mirrored with lows. Flow confirmation for that session: total call premium ≥ **$500k** AND ≥ **1.75×** total put premium (bear mirrored). Marker prints on the confirmed bar only when BOTH legs pass. |
| **GEX Walls** (`gxw-v1`) | Wrap existing `get_gex_data(ticker, dte_filter="week")`. Render `callWall`, `putWall`, `zeroGamma` only when within **±15%** of spot. Serve-stale: TTL **600s**, max_age **1800s** (3× rule). Regime string included for tooltip copy. |

---

### Task 0: Worktree setup + commit design docs

**Files:**
- Create: worktree at `C:\Users\Patrick\uct-worktrees\phase-a-signature` (branch `feat/phase-a-signature` from `origin/master`)
- Copy in: `docs/superpowers/specs/2026-07-31-indicator-platform-design.md`, `docs/superpowers/plans/2026-07-31-phase-a-signature-launch.md` (both currently only in the stale tree at `C:\Users\Patrick\uct-dashboard\docs\superpowers\...`)

**Interfaces:**
- Produces: the worktree every later task runs in. All later paths are relative to `C:\Users\Patrick\uct-worktrees\phase-a-signature`.

- [ ] **Step 1: Create the worktree**

```bash
cd /c/Users/Patrick/uct-dashboard
git fetch origin
git worktree add -b feat/phase-a-signature /c/Users/Patrick/uct-worktrees/phase-a-signature origin/master
```

- [ ] **Step 2: Verify it is at prod tip and clean**

Run: `git -C /c/Users/Patrick/uct-worktrees/phase-a-signature log --oneline -1` and `git -C /c/Users/Patrick/uct-worktrees/phase-a-signature status --short`
Expected: HEAD at/after `ff8516ed`; empty status.

- [ ] **Step 3: Copy the two design docs in**

```bash
mkdir -p /c/Users/Patrick/uct-worktrees/phase-a-signature/docs/superpowers/specs /c/Users/Patrick/uct-worktrees/phase-a-signature/docs/superpowers/plans
cp /c/Users/Patrick/uct-dashboard/docs/superpowers/specs/2026-07-31-indicator-platform-design.md /c/Users/Patrick/uct-worktrees/phase-a-signature/docs/superpowers/specs/
cp /c/Users/Patrick/uct-dashboard/docs/superpowers/plans/2026-07-31-phase-a-signature-launch.md /c/Users/Patrick/uct-worktrees/phase-a-signature/docs/superpowers/plans/
```

- [ ] **Step 4: Sanity-check the backend test suite runs here**

Run: `cd /c/Users/Patrick/uct-worktrees/phase-a-signature && python -m pytest tests/test_indicator_compute.py -q`
Expected: all pass (baseline green before we add anything).

- [ ] **Step 5: Commit**

```bash
git -C /c/Users/Patrick/uct-worktrees/phase-a-signature add docs/superpowers/specs/2026-07-31-indicator-platform-design.md docs/superpowers/plans/2026-07-31-phase-a-signature-launch.md
git -C /c/Users/Patrick/uct-worktrees/phase-a-signature commit -m "docs: indicator platform design spec + Phase A plan

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 1: Rules module + premium parse helper

**Files:**
- Create: `api/services/signature/__init__.py` (empty), `api/services/signature/rules.py`
- Test: `tests/test_signature_rules.py`

**Interfaces:**
- Produces: `rules.py` constants — `DPL_WINDOW_DAYS=20`, `DPL_BIN_PCT=0.0025`, `DPL_MIN_CLUSTER_NOTIONAL=10_000_000.0`, `DPL_TOP_K=5`, `FCB_LOOKBACK=20`, `FCB_VOL_MULT=1.25`, `FCB_MIN_CALL_PREM=500_000.0`, `FCB_DOMINANCE=1.75`, `GXW_DTE="week"`, `GXW_MAX_DIST_PCT=0.15`, `GXW_TTL_S=600`, `GXW_MAX_AGE_S=1800`, `VERSIONS = {"dpl": "dpl-v1", "fcb": "fcb-v1", "gxw": "gxw-v1"}`
- Produces: `parse_money(raw: str | float | int | None) -> float` — tolerant parser for flow TEXT columns (`"1500000"`, `"$1.5M"`, `"250K"`, `"1,500,000"`, `""` → 0.0). Every later flow read uses this.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_signature_rules.py
from api.services.signature.rules import parse_money, VERSIONS

def test_parse_money_plain_and_suffixed():
    assert parse_money("1500000") == 1_500_000.0
    assert parse_money("$1.5M") == 1_500_000.0
    assert parse_money("250K") == 250_000.0
    assert parse_money("1,500,000") == 1_500_000.0

def test_parse_money_garbage_is_zero():
    assert parse_money(None) == 0.0
    assert parse_money("") == 0.0
    assert parse_money("N/A") == 0.0

def test_versions_are_pinned_strings():
    assert VERSIONS["fcb"] == "fcb-v1"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_signature_rules.py -v`
Expected: FAIL — `ModuleNotFoundError: api.services.signature`

- [ ] **Step 3: Implement**

```python
# api/services/signature/rules.py
"""Signature indicator v1 rule constants + shared parsers.

Every tunable number for the three Signature indicators lives HERE so
owner tuning is a one-file diff. Versions bump when output-changing
logic changes (spec: compute.rev semantics).
"""

DPL_WINDOW_DAYS = 20
DPL_BIN_PCT = 0.0025
DPL_MIN_CLUSTER_NOTIONAL = 10_000_000.0
DPL_TOP_K = 5

FCB_LOOKBACK = 20
FCB_VOL_MULT = 1.25
FCB_MIN_CALL_PREM = 500_000.0
FCB_DOMINANCE = 1.75

GXW_DTE = "week"
GXW_MAX_DIST_PCT = 0.15
GXW_TTL_S = 600
GXW_MAX_AGE_S = 1800

VERSIONS = {"dpl": "dpl-v1", "fcb": "fcb-v1", "gxw": "gxw-v1"}

_SUFFIX = {"K": 1e3, "M": 1e6, "B": 1e9}


def parse_money(raw) -> float:
    """Tolerant money parser for the flow table's TEXT columns.

    Handles "1500000", "$1.5M", "250K", "1,500,000", None/"" -> 0.0.
    Never raises.
    """
    if raw is None:
        return 0.0
    if isinstance(raw, (int, float)):
        return float(raw)
    s = str(raw).strip().upper().replace("$", "").replace(",", "")
    if not s:
        return 0.0
    mult = 1.0
    if s[-1] in _SUFFIX:
        mult = _SUFFIX[s[-1]]
        s = s[:-1]
    try:
        return float(s) * mult
    except ValueError:
        return 0.0
```

Also create empty `api/services/signature/__init__.py`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_signature_rules.py -v` → PASS

- [ ] **Step 5: Commit**

```bash
git add api/services/signature/__init__.py api/services/signature/rules.py tests/test_signature_rules.py
git commit -m "feat(signature): v1 rule constants + tolerant money parser

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Dark Pool Levels compute (pure)

**Files:**
- Create: `api/services/signature/darkpool_levels.py`
- Test: `tests/test_signature_darkpool_levels.py`

**Interfaces:**
- Consumes: `rules.DPL_*`; print dicts shaped like `darkpool_db.get_ticker_prints` rows: `{"price": float, "notional": float, "date": str, ...}`
- Produces: `cluster_levels(prints: list[dict], *, bin_pct=None, min_notional=None, top_k=None) -> list[dict]` where each level = `{"price": float, "notional": float, "printCount": int, "lastDate": str, "rank": int, "lo": float, "hi": float}` (lo/hi = zone bounds, one bin wide). Pure — no I/O, no rounding.
- Produces: `fetch_dp_levels(sym: str) -> dict` — I/O wrapper returning `{"sym", "levels", "asOf", "version", "windowDays"}`; reads `darkpool_db.get_ticker_prints(sym, days=DPL_WINDOW_DAYS, limit=200)` (confirmed table only — non-repainting by construction).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_signature_darkpool_levels.py
from api.services.signature.darkpool_levels import cluster_levels

def _p(price, notional, date="7/30/2026"):
    return {"price": price, "notional": notional, "date": date}

def test_clusters_nearby_prints_and_ranks_by_notional():
    prints = [
        _p(100.00, 6_000_000), _p(100.10, 6_000_000),   # cluster A: 12M near 100
        _p(105.00, 30_000_000),                          # cluster B: 30M at 105
        _p(90.00, 4_000_000),                            # below min -> dropped
    ]
    levels = cluster_levels(prints, bin_pct=0.0025, min_notional=10_000_000, top_k=5)
    assert len(levels) == 2
    assert levels[0]["rank"] == 1 and abs(levels[0]["price"] - 105.0) < 1e-9
    assert levels[1]["printCount"] == 2
    # weighted mean of equal notionals
    assert abs(levels[1]["price"] - 100.05) < 1e-9
    assert levels[1]["lo"] < levels[1]["price"] < levels[1]["hi"]

def test_empty_and_zero_price_prints_are_safe():
    assert cluster_levels([]) == []
    assert cluster_levels([_p(0, 5_000_000)]) == []

def test_top_k_truncates():
    prints = [_p(100 + i * 10, 20_000_000) for i in range(8)]
    assert len(cluster_levels(prints, top_k=3)) == 3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_signature_darkpool_levels.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```python
# api/services/signature/darkpool_levels.py
"""UCT Signature: Dark Pool Levels (dpl-v1).

Clusters confirmed dark-pool prints (darkpool_trades ONLY — never the
intraday preview table) into price bins and returns the top-K levels by
aggregate notional. Non-repainting by construction: input data is the
nightly-confirmed ledger of prints.
"""
from __future__ import annotations

import time

from api.services.signature import rules


def cluster_levels(prints, *, bin_pct=None, min_notional=None, top_k=None):
    bin_pct = rules.DPL_BIN_PCT if bin_pct is None else bin_pct
    min_notional = rules.DPL_MIN_CLUSTER_NOTIONAL if min_notional is None else min_notional
    top_k = rules.DPL_TOP_K if top_k is None else top_k

    rows = [
        p for p in prints
        if (p.get("price") or 0) > 0 and (p.get("notional") or 0) > 0
    ]
    if not rows:
        return []

    prices = sorted(p["price"] for p in rows)
    median = prices[len(prices) // 2]
    bin_w = median * bin_pct
    if bin_w <= 0:
        return []

    buckets: dict[int, dict] = {}
    for p in rows:
        key = int(p["price"] // bin_w)
        b = buckets.setdefault(key, {"notional": 0.0, "wsum": 0.0, "count": 0, "lastDate": ""})
        b["notional"] += float(p["notional"])
        b["wsum"] += float(p["price"]) * float(p["notional"])
        b["count"] += 1
        d = str(p.get("date") or "")
        if d > b["lastDate"]:
            b["lastDate"] = d

    levels = []
    for key, b in buckets.items():
        if b["notional"] < min_notional:
            continue
        levels.append({
            "price": b["wsum"] / b["notional"],
            "notional": b["notional"],
            "printCount": b["count"],
            "lastDate": b["lastDate"],
            "lo": key * bin_w,
            "hi": (key + 1) * bin_w,
        })
    levels.sort(key=lambda l: l["notional"], reverse=True)
    levels = levels[:top_k]
    for i, l in enumerate(levels):
        l["rank"] = i + 1
    return levels


def fetch_dp_levels(sym: str) -> dict:
    """I/O wrapper: read confirmed prints, cluster, envelope."""
    from api import darkpool_db  # local import: keeps this module pure-testable

    prints = darkpool_db.get_ticker_prints(sym, days=rules.DPL_WINDOW_DAYS, limit=200)
    return {
        "sym": sym.upper(),
        "version": rules.VERSIONS["dpl"],
        "windowDays": rules.DPL_WINDOW_DAYS,
        "levels": cluster_levels(prints),
        "asOf": time.time(),
    }
```

- [ ] **Step 4: Run test to verify it passes** → `python -m pytest tests/test_signature_darkpool_levels.py -v` → PASS

- [ ] **Step 5: Commit**

```bash
git add api/services/signature/darkpool_levels.py tests/test_signature_darkpool_levels.py
git commit -m "feat(signature): dark pool levels clustering (dpl-v1)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Flow-Confirmed Breakout compute (pure)

**Files:**
- Create: `api/services/signature/flow_breakout.py`
- Test: `tests/test_signature_flow_breakout.py`

**Interfaces:**
- Consumes: `rules.FCB_*`, `rules.parse_money`; bars as dicts `{"t","o","h","l","c","v"}` oldest-first (the `_fetch_bars_for_alert` shape); flow rows as dicts with TEXT fields `{"CallPut", "Premium", "CreatedDate"}`.
- Produces: `detect_breakouts(bars: list[dict], *, lookback=None, vol_mult=None) -> list[dict]` — each `{"barTime": int, "direction": "bull"|"bear", "close": float}`; evaluates CONFIRMED bars only (bar i is only evaluated if a bar i+1 exists OR the bar is the final bar of a completed session — v1 daily rule: last bar excluded unless `include_last=True` passed by the nightly sweep after the close).
- Produces: `flow_confirms(flow_rows: list[dict], direction: str, *, min_prem=None, dominance=None) -> dict` — `{"confirmed": bool, "callPrem": float, "putPrem": float}`.
- Produces: `fcb_signals(bars, flow_by_date: dict[str, list[dict]], *, include_last=False) -> list[dict]` — joins the two; each signal `{"barTime", "direction", "close", "callPrem", "putPrem", "version"}`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_signature_flow_breakout.py
from api.services.signature.flow_breakout import detect_breakouts, flow_confirms, fcb_signals

def _bars_flat_then_break(n=25, base=100.0):
    """n flat bars then one closing above the 20-bar high on 2x volume."""
    bars = [
        {"t": 86400 * i, "o": base, "h": base + 1, "l": base - 1, "c": base, "v": 1_000_000}
        for i in range(n)
    ]
    bars.append({"t": 86400 * n, "o": base, "h": base + 5, "l": base,
                 "c": base + 4, "v": 2_000_000})
    bars.append({"t": 86400 * (n + 1), "o": base + 4, "h": base + 4.5,
                 "l": base + 3, "c": base + 4.2, "v": 900_000})  # confirms the breakout bar
    return bars

def test_detects_confirmed_bull_breakout_only():
    sigs = detect_breakouts(_bars_flat_then_break())
    assert len(sigs) == 1
    assert sigs[0]["direction"] == "bull"
    assert sigs[0]["barTime"] == 86400 * 25

def test_forming_last_bar_is_never_evaluated_without_flag():
    bars = _bars_flat_then_break()[:-1]  # breakout bar is the LAST bar
    assert detect_breakouts(bars) == []                      # closed-bar rule
    assert len(detect_breakouts(bars, include_last=True)) == 1  # nightly sweep mode

def test_low_volume_breakout_rejected():
    bars = _bars_flat_then_break()
    bars[25]["v"] = 1_000_000  # exactly avg, below 1.25x
    assert detect_breakouts(bars) == []

def test_flow_confirmation_thresholds():
    rows = [{"CallPut": "CALL", "Premium": "400000"}, {"CallPut": "CALL", "Premium": "$200K"},
            {"CallPut": "PUT", "Premium": "100000"}]
    r = flow_confirms(rows, "bull")
    assert r["confirmed"] is True and r["callPrem"] == 600_000.0
    assert flow_confirms(rows[:1], "bull")["confirmed"] is False  # under $500k

def test_fcb_join_requires_both_legs():
    bars = _bars_flat_then_break()
    date_key = "1970-01-26"  # 86400*25 -> day 26 of epoch, UTC date of the bar
    good_flow = {date_key: [{"CallPut": "C", "Premium": "900000"}]}
    assert len(fcb_signals(bars, good_flow)) == 1
    assert fcb_signals(bars, {}) == []
```

- [ ] **Step 2: Run test to verify it fails** → `python -m pytest tests/test_signature_flow_breakout.py -v` → FAIL (module not found)

- [ ] **Step 3: Implement**

```python
# api/services/signature/flow_breakout.py
"""UCT Signature: Flow-Confirmed Breakout (fcb-v1). Daily timeframe, v1.

Closed-bar discipline: a bar is only evaluated once a later bar exists,
EXCEPT when the nightly sweep (post-close) passes include_last=True.
Nothing here may ever evaluate a forming bar in a user-request path.
"""
from __future__ import annotations

from datetime import datetime, timezone

from api.services.signature import rules
from api.services.signature.rules import parse_money


def _is_call(v) -> bool:
    return str(v or "").strip().upper() in ("CALL", "C")


def _is_put(v) -> bool:
    return str(v or "").strip().upper() in ("PUT", "P")


def detect_breakouts(bars, *, lookback=None, vol_mult=None, include_last=False):
    lookback = rules.FCB_LOOKBACK if lookback is None else lookback
    vol_mult = rules.FCB_VOL_MULT if vol_mult is None else vol_mult
    out = []
    last_evaluable = len(bars) if include_last else len(bars) - 1
    for i in range(lookback, last_evaluable):
        window = bars[i - lookback:i]
        avg_vol = sum(b["v"] for b in window) / lookback
        if avg_vol <= 0 or bars[i]["v"] < vol_mult * avg_vol:
            continue
        hi = max(b["h"] for b in window)
        lo = min(b["l"] for b in window)
        c = bars[i]["c"]
        if c > hi:
            out.append({"barTime": bars[i]["t"], "direction": "bull", "close": c})
        elif c < lo:
            out.append({"barTime": bars[i]["t"], "direction": "bear", "close": c})
    return out


def flow_confirms(flow_rows, direction, *, min_prem=None, dominance=None):
    min_prem = rules.FCB_MIN_CALL_PREM if min_prem is None else min_prem
    dominance = rules.FCB_DOMINANCE if dominance is None else dominance
    call_prem = sum(parse_money(r.get("Premium")) for r in flow_rows if _is_call(r.get("CallPut")))
    put_prem = sum(parse_money(r.get("Premium")) for r in flow_rows if _is_put(r.get("CallPut")))
    if direction == "bull":
        confirmed = call_prem >= min_prem and call_prem >= dominance * max(put_prem, 1.0)
    else:
        confirmed = put_prem >= min_prem and put_prem >= dominance * max(call_prem, 1.0)
    return {"confirmed": confirmed, "callPrem": call_prem, "putPrem": put_prem}


def _bar_date_iso(bar_time: int) -> str:
    return datetime.fromtimestamp(int(bar_time), tz=timezone.utc).date().isoformat()


def fcb_signals(bars, flow_by_date, *, include_last=False):
    signals = []
    for b in detect_breakouts(bars, include_last=include_last):
        rows = flow_by_date.get(_bar_date_iso(b["barTime"]), [])
        conf = flow_confirms(rows, b["direction"])
        if conf["confirmed"]:
            signals.append({**b, **{k: conf[k] for k in ("callPrem", "putPrem")},
                            "version": rules.VERSIONS["fcb"]})
    return signals
```

- [ ] **Step 4: Run test to verify it passes** → PASS
- [ ] **Step 5: Commit**

```bash
git add api/services/signature/flow_breakout.py tests/test_signature_flow_breakout.py
git commit -m "feat(signature): flow-confirmed breakout detection (fcb-v1), closed-bar only

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: GEX Walls adapter (serve-stale over the live Schwab call)

**Files:**
- Create: `api/services/signature/gex_walls.py`
- Test: `tests/test_signature_gex_walls.py`

**Interfaces:**
- Consumes: `api.gex_service.get_gex_data(ticker, dte_filter)` (async, returns dict with `spot`, `callWall{strike,gex}`, `putWall{strike,gex}`, `zeroGamma`, `regime`, or `{"error": ...}`); `rules.GXW_*`.
- Produces: `shape_walls(gex: dict) -> dict` — pure; `{"levels": [{"kind": "callWall"|"putWall"|"zeroGamma", "price": float}], "spot": float, "regime": str, "version": "gxw-v1"}`; drops levels farther than `GXW_MAX_DIST_PCT` from spot; returns `{"levels": [], "error": ...}` passthrough on error dicts.
- Produces: `async fetch_gex_walls(sym: str) -> dict` — calls `get_gex_data(sym, rules.GXW_DTE)`, shapes, stamps `asOf`. (ServeStale wrapping happens in the router, Task 6, so this stays pure-ish and testable.)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_signature_gex_walls.py
from api.services.signature.gex_walls import shape_walls

def _gex(spot=500.0):
    return {"spot": spot, "regime": "positive",
            "callWall": {"strike": 510.0, "gex": 1e9},
            "putWall": {"strike": 480.0, "gex": -8e8},
            "zeroGamma": 495.0}

def test_shapes_three_levels():
    out = shape_walls(_gex())
    kinds = {l["kind"]: l["price"] for l in out["levels"]}
    assert kinds == {"callWall": 510.0, "putWall": 480.0, "zeroGamma": 495.0}
    assert out["regime"] == "positive" and out["version"] == "gxw-v1"

def test_far_levels_dropped():
    g = _gex()
    g["callWall"]["strike"] = 700.0  # 40% away
    out = shape_walls(g)
    assert all(l["kind"] != "callWall" for l in out["levels"])

def test_error_passthrough_is_safe():
    out = shape_walls({"error": "Schwab not authenticated"})
    assert out["levels"] == [] and out["error"]
```

- [ ] **Step 2: Run to verify FAIL** → `python -m pytest tests/test_signature_gex_walls.py -v`

- [ ] **Step 3: Implement**

```python
# api/services/signature/gex_walls.py
"""UCT Signature: GEX Walls (gxw-v1).

The underlying gex_service call is a LIVE Schwab /chains request (~20s
timeout, zero caching today). It must only ever be reached through the
router's ServeStale slot — never called per chart render directly.
"""
from __future__ import annotations

import time

from api.services.signature import rules


def shape_walls(gex: dict) -> dict:
    if not gex or gex.get("error"):
        return {"levels": [], "error": (gex or {}).get("error", "no data"),
                "version": rules.VERSIONS["gxw"]}
    spot = float(gex.get("spot") or 0)
    levels = []
    candidates = [
        ("callWall", (gex.get("callWall") or {}).get("strike")),
        ("putWall", (gex.get("putWall") or {}).get("strike")),
        ("zeroGamma", gex.get("zeroGamma")),
    ]
    for kind, price in candidates:
        if price is None or spot <= 0:
            continue
        price = float(price)
        if abs(price - spot) / spot <= rules.GXW_MAX_DIST_PCT:
            levels.append({"kind": kind, "price": price})
    return {"levels": levels, "spot": spot, "regime": gex.get("regime", ""),
            "version": rules.VERSIONS["gxw"]}


async def fetch_gex_walls(sym: str) -> dict:
    from api.gex_service import get_gex_data  # local import for testability

    shaped = shape_walls(await get_gex_data(sym, rules.GXW_DTE))
    shaped["sym"] = sym.upper()
    shaped["asOf"] = time.time()
    return shaped
```

- [ ] **Step 4: Run to verify PASS**
- [ ] **Step 5: Commit**

```bash
git add api/services/signature/gex_walls.py tests/test_signature_gex_walls.py
git commit -m "feat(signature): GEX walls adapter (gxw-v1)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Signal ledger store (append-only)

**Files:**
- Create: `api/services/signature/ledger.py`
- Test: `tests/test_signature_ledger.py`

**Interfaces:**
- Produces: module constant `_DB_PATH = os.environ.get("SIGNAL_LEDGER_DB_PATH", "/data/signal_ledger.db")` (exact name — the house double-patch test fixture depends on it).
- Produces: `record_signal(indicator: str, version: str, sym: str, tf: str, direction: str, bar_time: int, price: float, meta: dict | None = None) -> bool` — True if a NEW row was inserted, False if it already existed (UNIQUE dedup → fire-once, `calendar_alerts.try_record_alert` idiom). `first_seen_at` is stamped inside and IMMUTABLE (wire/store.py invariant).
- Produces: `get_signals(sym: str | None = None, limit: int = 200) -> list[dict]` — newest-first read for future private surfaces.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_signature_ledger.py
import pytest
from api.services.signature import ledger

@pytest.fixture
def tmp_ledger(tmp_path, monkeypatch):
    p = tmp_path / "signal_ledger.db"
    monkeypatch.setenv("SIGNAL_LEDGER_DB_PATH", str(p))
    monkeypatch.setattr(ledger, "_DB_PATH", str(p))   # BOTH — env AND module constant
    monkeypatch.setattr(ledger, "_INITED", False)
    return p

def test_insert_then_duplicate_is_fire_once(tmp_ledger):
    assert ledger.record_signal("fcb", "fcb-v1", "NVDA", "1D", "bull", 1753900000, 182.5) is True
    assert ledger.record_signal("fcb", "fcb-v1", "NVDA", "1D", "bull", 1753900000, 182.5) is False
    rows = ledger.get_signals("NVDA")
    assert len(rows) == 1 and rows[0]["direction"] == "bull"

def test_first_seen_at_never_rewritten(tmp_ledger):
    ledger.record_signal("fcb", "fcb-v1", "AMD", "1D", "bear", 1753900000, 150.0)
    first = ledger.get_signals("AMD")[0]["first_seen_at"]
    ledger.record_signal("fcb", "fcb-v1", "AMD", "1D", "bear", 1753900000, 150.0)
    assert ledger.get_signals("AMD")[0]["first_seen_at"] == first

def test_get_signals_filters_and_orders(tmp_ledger):
    ledger.record_signal("fcb", "fcb-v1", "A", "1D", "bull", 100, 1.0)
    ledger.record_signal("fcb", "fcb-v1", "B", "1D", "bull", 200, 2.0)
    assert [r["sym"] for r in ledger.get_signals()] == ["B", "A"]
    assert len(ledger.get_signals("A")) == 1
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Implement**

```python
# api/services/signature/ledger.py
"""Append-only Signature signal ledger.

Invariants (enforced HERE, not in callers — wire/store.py precedent):
- rows are INSERT-only; there is no UPDATE path in this module
- first_seen_at is stamped at insert and immutable
- (indicator, version, sym, tf, bar_time, direction) is UNIQUE: recording
  is idempotent, so request-path recording + the nightly sweep can both
  call record_signal without double-entry.
"""
from __future__ import annotations

import contextlib
import json
import os
import sqlite3
import threading
import time

_DB_PATH = os.environ.get("SIGNAL_LEDGER_DB_PATH", "/data/signal_ledger.db")
_WRITE_LOCK = threading.Lock()
_INITED = False

_SCHEMA = """
CREATE TABLE IF NOT EXISTS signature_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  indicator TEXT NOT NULL,
  version TEXT NOT NULL,
  sym TEXT NOT NULL,
  tf TEXT NOT NULL,
  direction TEXT NOT NULL,
  bar_time INTEGER NOT NULL,
  price REAL NOT NULL,
  first_seen_at REAL NOT NULL,
  meta_json TEXT,
  UNIQUE(indicator, version, sym, tf, bar_time, direction)
);
CREATE INDEX IF NOT EXISTS idx_sig_sym_seen ON signature_signals(sym, first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_sig_seen ON signature_signals(first_seen_at DESC);
"""


def _connect():
    conn = sqlite3.connect(_DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _ensure_init():
    global _INITED
    if _INITED:
        return
    os.makedirs(os.path.dirname(_DB_PATH) or ".", exist_ok=True)
    with contextlib.closing(_connect()) as c:
        c.executescript(_SCHEMA)
        c.commit()
    _INITED = True


def record_signal(indicator, version, sym, tf, direction, bar_time, price, meta=None) -> bool:
    _ensure_init()
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        try:
            c.execute(
                "INSERT INTO signature_signals"
                " (indicator, version, sym, tf, direction, bar_time, price, first_seen_at, meta_json)"
                " VALUES (?,?,?,?,?,?,?,?,?)",
                (indicator, version, sym.upper(), tf, direction, int(bar_time),
                 float(price), time.time(), json.dumps(meta) if meta else None),
            )
            c.commit()
            return True
        except sqlite3.IntegrityError:
            return False


def get_signals(sym=None, limit=200) -> list[dict]:
    _ensure_init()
    q = "SELECT * FROM signature_signals"
    args: list = []
    if sym:
        q += " WHERE sym = ?"
        args.append(sym.upper())
    q += " ORDER BY first_seen_at DESC LIMIT ?"
    args.append(int(limit))
    with contextlib.closing(_connect()) as c:
        return [dict(r) for r in c.execute(q, args).fetchall()]
```

- [ ] **Step 4: Run to verify PASS**
- [ ] **Step 5: Commit**

```bash
git add api/services/signature/ledger.py tests/test_signature_ledger.py
git commit -m "feat(signature): append-only signal ledger with fire-once dedup

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Router — /api/signature/* (premium-gated, serve-stale)

**Files:**
- Create: `api/routers/signature.py`
- Modify: `api/main.py` (one import + one `include_router`, in the routers block ~L3960-4061)
- Modify: `tests/conftest.py` (add ServeStale reset fixture)
- Test: `tests/test_signature_router.py`

**Interfaces:**
- Consumes: Tasks 2/3/4/5 services; `api.middleware.auth_middleware.get_current_user_with_plan`, `is_paid_user`; `api.services.serve_stale.ServeStale`; `api.services.indicator_alert_evaluator._fetch_bars_for_alert` bar shape (reimplemented locally via `bars_sqlite.get_bars`).
- Produces routes (all GET, all `Depends(require_paid)` → 402 for free users):
  - `GET /api/signature/darkpool-levels?sym=` → Task 2 envelope
  - `GET /api/signature/flow-breakout?sym=` → `{"sym","version","signals":[...],"asOf"}` (closed-bar; `include_last=False` on this request path — the forming session NEVER yields a signal here)
  - `GET /api/signature/gex-walls?sym=` → Task 4 envelope
- Flow rows come from the PROXIED surface: `GET {SELF_BASE}/api/flow/ticker/{sym}` via httpx with the caller's cookie forwarded — NOT from local flow.db (web's copy can be frozen when the proxy is enabled). `SELF_BASE = os.environ.get("SIGNATURE_FLOW_BASE", "http://127.0.0.1:8080")`.
- ServeStale slots: `_DPL_STALE = ServeStale("sig_dpl", max_age_seconds=1800)`, `_FCB_STALE = ServeStale("sig_fcb", max_age_seconds=1800)`, `_GXW_STALE = ServeStale("sig_gxw", max_age_seconds=rules.GXW_MAX_AGE_S)`; keys are `sym.upper()`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_signature_router.py
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import signature as sig
from api.middleware.auth_middleware import get_current_user_with_plan


@pytest.fixture
def client(monkeypatch, tmp_path):
    from api.services.signature import ledger
    monkeypatch.setattr(ledger, "_DB_PATH", str(tmp_path / "ledger.db"))
    monkeypatch.setattr(ledger, "_INITED", False)
    for slot in (sig._DPL_STALE, sig._FCB_STALE, sig._GXW_STALE):
        slot._slots.clear()
    app = FastAPI()
    app.include_router(sig.router)
    return app


def _paid_user():
    return {"id": "u1", "role": "user", "plan": "premium"}


def test_anon_gets_402(client):
    c = TestClient(client, raise_server_exceptions=False)
    r = c.get("/api/signature/darkpool-levels?sym=NVDA")
    assert r.status_code in (401, 402)


def test_paid_gets_dpl_payload(client, monkeypatch):
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    monkeypatch.setattr(sig, "_dpl_build",
                        lambda sym: {"sym": sym, "levels": [], "version": "dpl-v1", "asOf": 1.0})
    c = TestClient(client)
    r = c.get("/api/signature/darkpool-levels?sym=nvda")
    assert r.status_code == 200
    assert r.json()["sym"] == "NVDA" and r.json()["version"] == "dpl-v1"


def test_bad_symbol_rejected(client):
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    c = TestClient(client)
    assert c.get("/api/signature/gex-walls?sym=..%2Fetc").status_code == 422
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Implement the router**

```python
# api/routers/signature.py
"""UCT Signature Indicators — premium, server-computed, serve-stale wrapped.

Prefix is deliberately NOT /api/flow* (flow_proxy would swallow it) and
NOT /api/indicator* (leave that namespace for Phase B's generic engine).
Flow data is read via the PROXIED /api/flow/ticker/{sym} surface so the
fresh flow.db on flow-worker answers, never web's potentially-frozen copy.
"""
from __future__ import annotations

import asyncio
import os
import re

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.serve_stale import ServeStale
from api.services.signature import rules
from api.services.signature.darkpool_levels import fetch_dp_levels
from api.services.signature.flow_breakout import fcb_signals, _bar_date_iso
from api.services.signature.gex_walls import fetch_gex_walls
from api.services.signature import ledger

router = APIRouter(prefix="/api/signature", tags=["signature"])

_SYM_RE = re.compile(r"^[A-Za-z.\-]{1,10}$")
_FLOW_BASE = os.environ.get("SIGNATURE_FLOW_BASE", "http://127.0.0.1:8080")

_DPL_STALE = ServeStale("sig_dpl", max_age_seconds=1800)
_FCB_STALE = ServeStale("sig_fcb", max_age_seconds=1800)
_GXW_STALE = ServeStale("sig_gxw", max_age_seconds=rules.GXW_MAX_AGE_S)


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="UCT Signature indicators require a paid plan")
    return user


def _sym_or_422(sym: str) -> str:
    if not _SYM_RE.match(sym or ""):
        raise HTTPException(status_code=422, detail="invalid symbol")
    return sym.upper()


def _dpl_build(sym: str) -> dict:
    return fetch_dp_levels(sym)


def _fetch_bars(sym: str, count: int = 60) -> list[dict]:
    from api.services import bars_sqlite
    rows = bars_sqlite.get_bars(sym.upper(), "1D", int(count))
    out = []
    for r in rows:
        try:
            out.append({"t": int(r[0]), "o": float(r[1]), "h": float(r[2]),
                        "l": float(r[3]), "c": float(r[4]), "v": int(r[5] or 0)})
        except (TypeError, ValueError, IndexError):
            continue
    return out


def _fetch_flow_rows(sym: str, cookie: str | None) -> list[dict]:
    """Read flow via the proxied surface so flow-worker's fresh DB answers."""
    try:
        headers = {"cookie": cookie} if cookie else {}
        resp = httpx.get(f"{_FLOW_BASE}/api/flow/ticker/{sym}", headers=headers, timeout=15.0)
        if resp.status_code != 200:
            return []
        data = resp.json()
        return data.get("rows") or data.get("data") or []
    except Exception:
        return []


def _fcb_build(sym: str, cookie: str | None) -> dict:
    import time as _time
    bars = _fetch_bars(sym)
    rows = _fetch_flow_rows(sym, cookie)
    by_date: dict[str, list[dict]] = {}
    for r in rows:
        d = r.get("CreatedDate") or ""
        try:  # flow dates are M/D/YYYY — normalize to ISO to match _bar_date_iso
            m, day, y = d.split("/")
            iso = f"{int(y):04d}-{int(m):02d}-{int(day):02d}"
        except (ValueError, AttributeError):
            continue
        by_date.setdefault(iso, []).append(r)
    signals = fcb_signals(bars, by_date, include_last=False)  # NEVER the forming session here
    for s in signals:  # idempotent — UNIQUE dedup makes re-recording a no-op
        ledger.record_signal("fcb", s["version"], sym, "1D", s["direction"],
                             s["barTime"], s["close"],
                             meta={"callPrem": s["callPrem"], "putPrem": s["putPrem"]})
    return {"sym": sym, "version": rules.VERSIONS["fcb"], "signals": signals, "asOf": _time.time()}


@router.get("/darkpool-levels")
def darkpool_levels(sym: str = Query(...), _user: dict = Depends(require_paid)):
    s = _sym_or_422(sym)
    return _DPL_STALE.serve(s, fresh=lambda: None, build=lambda: _dpl_build(s),
                            good=lambda p: bool(p and p.get("levels") is not None))


@router.get("/flow-breakout")
def flow_breakout(request: Request, sym: str = Query(...), _user: dict = Depends(require_paid)):
    s = _sym_or_422(sym)
    cookie = request.headers.get("cookie")
    return _FCB_STALE.serve(s, fresh=lambda: None, build=lambda: _fcb_build(s, cookie),
                            good=lambda p: bool(p and "signals" in p))


@router.get("/gex-walls")
def gex_walls(sym: str = Query(...), _user: dict = Depends(require_paid)):
    s = _sym_or_422(sym)

    def _build():
        return asyncio.run(fetch_gex_walls(s))

    return _GXW_STALE.serve(s, fresh=lambda: None, build=_build,
                            good=lambda p: bool(p and not p.get("error")))
```

- [ ] **Step 4: Register in `api/main.py`** — add beside the other package-router imports (~L80 block) and in the include block (~L3960-4061):

```python
from api.routers import signature as signature_router
# ...
app.include_router(signature_router.router)
```

- [ ] **Step 5: Add the conftest reset fixture** — append to `tests/conftest.py`, following the existing `_reset_calendar_serve_stale` sys.modules idiom:

```python
@pytest.fixture(autouse=True)
def _reset_signature_serve_stale():
    mod = sys.modules.get("api.routers.signature")
    if mod is not None:
        for name in ("_DPL_STALE", "_FCB_STALE", "_GXW_STALE"):
            slot = getattr(mod, name, None)
            if slot is not None:
                slot._slots.clear()
    yield
    mod = sys.modules.get("api.routers.signature")
    if mod is not None:
        for name in ("_DPL_STALE", "_FCB_STALE", "_GXW_STALE"):
            slot = getattr(mod, name, None)
            if slot is not None:
                slot._slots.clear()
```

- [ ] **Step 6: Run the router tests + the full backend suite subset**

Run: `python -m pytest tests/test_signature_router.py tests/test_signature_rules.py tests/test_signature_darkpool_levels.py tests/test_signature_flow_breakout.py tests/test_signature_gex_walls.py tests/test_signature_ledger.py -v`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add api/routers/signature.py api/main.py tests/conftest.py tests/test_signature_router.py
git commit -m "feat(signature): /api/signature router — premium-gated, serve-stale wrapped

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Nightly closed-bar sweep → ledger

**Files:**
- Create: `api/services/signature/sweep.py`
- Modify: `api/main.py` (scheduler job registration beside existing `_ET` cron jobs — new crons use main.py `_ET` timezone convention, NEVER naive/UTC)
- Test: `tests/test_signature_sweep.py`

**Interfaces:**
- Consumes: `flow_breakout.fcb_signals` (with `include_last=True` — the sweep runs POST-close so the session's final bar is confirmed), `ledger.record_signal`, `_fetch_bars`/`_fetch_flow_rows` equivalents injected for testability.
- Produces: `run_sweep(symbols: list[str], *, fetch_bars, fetch_flow, now_iso: str) -> dict` — pure-orchestration function `{"scanned": int, "recorded": int, "errors": int}`; `sweep_job()` — the scheduled entry (reads `SIGNATURE_SWEEP_SYMBOLS` env, comma-separated, default `"SPY,QQQ,NVDA,TSLA,AAPL,MSFT,AMD,META,AMZN,GOOGL"`).
- Schedule: weekdays **16:45 ET** (after close + ingest settle), via the same APScheduler pattern as existing `_ET` jobs in `main.py`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_signature_sweep.py
import pytest
from api.services.signature.sweep import run_sweep
from api.services.signature import ledger

@pytest.fixture
def tmp_ledger(tmp_path, monkeypatch):
    monkeypatch.setattr(ledger, "_DB_PATH", str(tmp_path / "l.db"))
    monkeypatch.setattr(ledger, "_INITED", False)

def _bars_with_final_breakout():
    base = 100.0
    bars = [{"t": 86400 * i, "o": base, "h": base + 1, "l": base - 1, "c": base, "v": 1_000_000}
            for i in range(25)]
    bars.append({"t": 86400 * 25, "o": base, "h": base + 5, "l": base,
                 "c": base + 4, "v": 2_000_000})   # breakout IS the last bar
    return bars

def test_sweep_records_final_bar_signal(tmp_ledger):
    flow = {"1970-01-26": [{"CallPut": "CALL", "Premium": "900000"}]}
    res = run_sweep(["NVDA"], fetch_bars=lambda s: _bars_with_final_breakout(),
                    fetch_flow=lambda s: flow, now_iso="2026-08-03")
    assert res == {"scanned": 1, "recorded": 1, "errors": 0}
    assert len(ledger.get_signals("NVDA")) == 1

def test_sweep_is_idempotent(tmp_ledger):
    flow = {"1970-01-26": [{"CallPut": "CALL", "Premium": "900000"}]}
    kwargs = dict(fetch_bars=lambda s: _bars_with_final_breakout(),
                  fetch_flow=lambda s: flow, now_iso="2026-08-03")
    run_sweep(["NVDA"], **kwargs)
    res2 = run_sweep(["NVDA"], **kwargs)
    assert res2["recorded"] == 0 and len(ledger.get_signals("NVDA")) == 1

def test_sweep_survives_a_bad_symbol(tmp_ledger):
    def bars(s):
        if s == "BAD":
            raise RuntimeError("boom")
        return _bars_with_final_breakout()
    res = run_sweep(["BAD", "NVDA"], fetch_bars=bars,
                    fetch_flow=lambda s: {"1970-01-26": [{"CallPut": "C", "Premium": "900000"}]},
                    now_iso="2026-08-03")
    assert res["errors"] == 1 and res["recorded"] == 1
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Implement**

```python
# api/services/signature/sweep.py
"""Nightly closed-bar FCB sweep -> signal ledger.

Runs POST-close (16:45 ET weekdays), so include_last=True is honest:
the session's final daily bar is confirmed. This is what makes the
ledger accrue from launch day independent of user chart views.
"""
from __future__ import annotations

import logging
import os

from api.services.signature import ledger, rules
from api.services.signature.flow_breakout import fcb_signals

log = logging.getLogger("signature.sweep")

_DEFAULT_SYMBOLS = "SPY,QQQ,NVDA,TSLA,AAPL,MSFT,AMD,META,AMZN,GOOGL"


def run_sweep(symbols, *, fetch_bars, fetch_flow, now_iso: str) -> dict:
    scanned = recorded = errors = 0
    for sym in symbols:
        try:
            bars = fetch_bars(sym)
            flow_by_date = fetch_flow(sym)
            for s in fcb_signals(bars, flow_by_date, include_last=True):
                if ledger.record_signal("fcb", s["version"], sym, "1D", s["direction"],
                                        s["barTime"], s["close"],
                                        meta={"callPrem": s["callPrem"],
                                              "putPrem": s["putPrem"], "sweep": now_iso}):
                    recorded += 1
            scanned += 1
        except Exception:
            log.exception("signature sweep failed for %s", sym)
            errors += 1
    return {"scanned": scanned, "recorded": recorded, "errors": errors}


def sweep_job() -> None:
    from datetime import date
    from api.routers.signature import _fetch_bars, _fetch_flow_rows
    from api.services.signature.flow_breakout import _bar_date_iso  # noqa: F401

    symbols = [s.strip().upper() for s in
               os.environ.get("SIGNATURE_SWEEP_SYMBOLS", _DEFAULT_SYMBOLS).split(",") if s.strip()]

    def fetch_flow(sym):
        rows = _fetch_flow_rows(sym, cookie=None)
        by_date: dict[str, list[dict]] = {}
        for r in rows:
            d = r.get("CreatedDate") or ""
            try:
                m, day, y = d.split("/")
                by_date.setdefault(f"{int(y):04d}-{int(m):02d}-{int(day):02d}", []).append(r)
            except (ValueError, AttributeError):
                continue
        return by_date

    res = run_sweep(symbols, fetch_bars=_fetch_bars, fetch_flow=fetch_flow,
                    now_iso=date.today().isoformat())
    log.info("signature sweep done: %s", res)
```

- [ ] **Step 4: Register the job in `api/main.py`** — beside the existing `_ET` cron registrations, same idiom as neighbors:

```python
scheduler.add_job(sweep_job, "cron", day_of_week="mon-fri", hour=16, minute=45,
                  timezone=_ET, id="signature_sweep", replace_existing=True)
```
(import: `from api.services.signature.sweep import sweep_job`)

- [ ] **Step 5: Run tests** → `python -m pytest tests/test_signature_sweep.py -v` → PASS
- [ ] **Step 6: Commit**

```bash
git add api/services/signature/sweep.py api/main.py tests/test_signature_sweep.py
git commit -m "feat(signature): nightly closed-bar FCB sweep into the ledger (16:45 ET)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Frontend settings keys (the allow-list gotcha)

**Files:**
- Modify: `app/src/components/chart/chartDefaults.js` (CHART_DEFAULTS near the `markers`/`showPatterns` block ~L89-95; mergeChartSettings return ~L262-268)
- Test: `app/src/components/chart/chartDefaults.test.js` (append)

**Interfaces:**
- Produces: `CHART_DEFAULTS.signature = { darkPoolLevels: false, gexWalls: false, flowSignals: false }` and a merge line — WITHOUT the merge line the persisted keys are silently destroyed on every read (hard allow-list).

- [ ] **Step 1: Write the failing test** (append to existing describe block in `chartDefaults.test.js`):

```js
it('signature toggles survive a merge round-trip', () => {
  const merged = mergeChartSettings(JSON.stringify({ signature: { darkPoolLevels: true } }))
  expect(merged.signature.darkPoolLevels).toBe(true)
  expect(merged.signature.gexWalls).toBe(false)   // default fills in
})

it('signature defaults exist and are off', () => {
  const merged = mergeChartSettings(null)
  expect(merged.signature).toEqual({ darkPoolLevels: false, gexWalls: false, flowSignals: false })
})
```

- [ ] **Step 2: Run to verify FAIL** — `cd app && npm test -- run src/components/chart/chartDefaults.test.js`

- [ ] **Step 3: Implement** — in `CHART_DEFAULTS`:

```js
signature: { darkPoolLevels: false, gexWalls: false, flowSignals: false },
```
and in the `mergeChartSettings` return object:

```js
signature: { ...CHART_DEFAULTS.signature, ...(parsed.signature || {}) },
```

- [ ] **Step 4: Run to verify PASS**
- [ ] **Step 5: Commit**

```bash
git add app/src/components/chart/chartDefaults.js app/src/components/chart/chartDefaults.test.js
git commit -m "feat(signature): chart settings keys for the 3 signature toggles

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Frontend transforms (pure) — API payloads → priceLines/markers/zones

**Files:**
- Create: `app/src/components/chart/signatureData.js`
- Test: `app/src/components/chart/signatureData.test.js`

**Interfaces:**
- Consumes: API payloads from Task 6.
- Produces (all pure, all return `[]` on bad input — StockChart-side code stays dumb):
  - `dpToPriceLines(payload)` → `[{price, color, lineWidth, lineStyle, axisLabelVisible, title}]` — rank 1-2 → `lineWidth: 2`, ranks 3-5 → `1`; title `` `DP $${price} · ${fmtNotional}` ``; `lineStyle: 2` (dashed); only rank 1 gets `axisLabelVisible: true` (OptionsFlow gexPriceLines precedent: suppress secondary axis labels to avoid crosshair lag).
  - `dpToZones(payload)` → `[{lo, hi, rank}]` for the zone primitive.
  - `gexToPriceLines(payload)` → callWall gold solid width 2, putWall red solid width 2, zeroGamma gray dashed width 1; titles `Call Wall` / `Put Wall` / `Zero Γ`.
  - `flowToMarkers(payload)` → `[{time, position, color, shape, text, size}]` — bull: `aboveBar`… no: bull = `belowBar`, `arrowUp`, green `#3cb868`, text `FCB`; bear = `aboveBar`, `arrowDown`, red `#e74c3c`. `time` = barTime (unix sec, matches bar times already adjusted upstream), `size: 1`.
  - `fmtNotional(n)` → `"$42M"` / `"$1.2B"`.

- [ ] **Step 1: Write the failing test**

```js
// app/src/components/chart/signatureData.test.js
import { describe, it, expect } from 'vitest'
import { dpToPriceLines, dpToZones, gexToPriceLines, flowToMarkers, fmtNotional } from './signatureData'

describe('signatureData transforms', () => {
  it('fmtNotional compacts', () => {
    expect(fmtNotional(42_000_000)).toBe('$42M')
    expect(fmtNotional(1_200_000_000)).toBe('$1.2B')
  })

  it('dpToPriceLines tiers width by rank and suppresses secondary axis labels', () => {
    const lines = dpToPriceLines({ levels: [
      { price: 105, notional: 30e6, rank: 1 },
      { price: 100, notional: 12e6, rank: 3 },
    ]})
    expect(lines[0].lineWidth).toBe(2)
    expect(lines[0].axisLabelVisible).toBe(true)
    expect(lines[1].lineWidth).toBe(1)
    expect(lines[1].axisLabelVisible).toBe(false)
    expect(lines[0].title).toContain('$30M')
  })

  it('gexToPriceLines maps three kinds', () => {
    const lines = gexToPriceLines({ levels: [
      { kind: 'callWall', price: 510 }, { kind: 'putWall', price: 480 }, { kind: 'zeroGamma', price: 495 },
    ]})
    expect(lines.map(l => l.title)).toEqual(['Call Wall', 'Put Wall', 'Zero Γ'])
  })

  it('flowToMarkers maps direction to shape and side', () => {
    const m = flowToMarkers({ signals: [{ barTime: 1753900000, direction: 'bull', close: 182.5 }] })
    expect(m[0]).toMatchObject({ time: 1753900000, position: 'belowBar', shape: 'arrowUp', text: 'FCB' })
  })

  it('all transforms return [] on garbage', () => {
    for (const fn of [dpToPriceLines, dpToZones, gexToPriceLines, flowToMarkers]) {
      expect(fn(null)).toEqual([])
      expect(fn({})).toEqual([])
    }
  })
})
```

- [ ] **Step 2: Run to verify FAIL** — `cd app && npm test -- run src/components/chart/signatureData.test.js`

- [ ] **Step 3: Implement**

```js
// app/src/components/chart/signatureData.js
// Pure transforms: /api/signature payloads -> StockChart priceLines / markers / zones.
// Everything returns [] on bad input so the chart wiring stays branch-free.

const GOLD = '#c9a84c'
const GAIN = '#3cb868'
const LOSS = '#e74c3c'
const GRAY = '#8a8574'

export function fmtNotional(n) {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n >= 1e9) return `$${parseFloat((n / 1e9).toFixed(1))}B`
  return `$${Math.round(n / 1e6)}M`
}

export function dpToPriceLines(payload) {
  const levels = payload?.levels
  if (!Array.isArray(levels) || !levels.length) return []
  return levels.map(l => ({
    price: l.price,
    color: GOLD,
    lineWidth: l.rank <= 2 ? 2 : 1,
    lineStyle: 2,
    axisLabelVisible: l.rank === 1,
    title: `DP ${fmtNotional(l.notional)}`,
  }))
}

export function dpToZones(payload) {
  const levels = payload?.levels
  if (!Array.isArray(levels) || !levels.length) return []
  return levels.map(l => ({ lo: l.lo, hi: l.hi, rank: l.rank }))
}

const GEX_STYLE = {
  callWall: { color: GOLD, lineWidth: 2, lineStyle: 0, title: 'Call Wall' },
  putWall: { color: LOSS, lineWidth: 2, lineStyle: 0, title: 'Put Wall' },
  zeroGamma: { color: GRAY, lineWidth: 1, lineStyle: 2, title: 'Zero Γ' },
}

export function gexToPriceLines(payload) {
  const levels = payload?.levels
  if (!Array.isArray(levels) || !levels.length) return []
  return levels
    .filter(l => GEX_STYLE[l.kind])
    .map(l => ({ price: l.price, axisLabelVisible: true, ...GEX_STYLE[l.kind] }))
}

export function flowToMarkers(payload) {
  const signals = payload?.signals
  if (!Array.isArray(signals) || !signals.length) return []
  return signals.map(s => ({
    time: s.barTime,
    position: s.direction === 'bull' ? 'belowBar' : 'aboveBar',
    color: s.direction === 'bull' ? GAIN : LOSS,
    shape: s.direction === 'bull' ? 'arrowUp' : 'arrowDown',
    text: 'FCB',
    size: 1,
  }))
}
```

- [ ] **Step 4: Run to verify PASS**
- [ ] **Step 5: Commit**

```bash
git add app/src/components/chart/signatureData.js app/src/components/chart/signatureData.test.js
git commit -m "feat(signature): pure payload->chart transforms

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Zone primitive (canvas — screenshot-safe)

**Files:**
- Create: `app/src/components/chart/levelZonesPrimitive.js`
- Test: `app/src/components/chart/levelZonesPrimitive.test.js`

**Interfaces:**
- Produces: `createLevelZonesPrimitive(initial = {}) -> {primitive, setZones(zones), setOptions(patch)}` — a SERIES primitive (needs `series.priceToCoordinate`; the pane-primitive variant cannot map price→Y). Skeleton copied from `swingLabelsPrimitive.js` (attached/detached/paneViews contract, `zOrder: () => 'bottom'`), draw body from `sessionShadingPrimitive.js`'s fillRect approach: for each zone, `y0=series.priceToCoordinate(hi)`, `y1=series.priceToCoordinate(lo)`, `ctx.fillRect(0, y0, mediaSize.width, y1-y0)` with `fillAlpha` (default 0.10, rank 1 gets 0.14).
- Produces (pure, exported for tests): `zoneRects(zones, priceToY, width)` → `[{x:0, y, w, h, rank}]`, clamping off-screen/invalid to skipped entries.

- [ ] **Step 1: Write the failing test** (pure helper only — primitives' canvas path is never vitest-booted, house convention):

```js
// app/src/components/chart/levelZonesPrimitive.test.js
import { describe, it, expect } from 'vitest'
import { zoneRects } from './levelZonesPrimitive'

describe('zoneRects', () => {
  const priceToY = p => 500 - p  // simple linear fake
  it('maps price range to rect', () => {
    const rects = zoneRects([{ lo: 100, hi: 110, rank: 1 }], priceToY, 800)
    expect(rects).toEqual([{ x: 0, y: 390, w: 800, h: 10, rank: 1 }])
  })
  it('skips zones that fail to map', () => {
    expect(zoneRects([{ lo: 100, hi: 110 }], () => null, 800)).toEqual([])
    expect(zoneRects(null, priceToY, 800)).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Implement** (full primitive; mirror `swingLabelsPrimitive.js`'s exact contract):

```js
// app/src/components/chart/levelZonesPrimitive.js
// Series primitive: translucent horizontal bands at price ranges.
// Canvas-rendered so composeScreenshot() captures it (SVG/DOM overlays are NOT captured).

export function zoneRects(zones, priceToY, width) {
  if (!Array.isArray(zones)) return []
  const out = []
  for (const z of zones) {
    const y0 = priceToY(z.hi)
    const y1 = priceToY(z.lo)
    if (y0 == null || y1 == null || !Number.isFinite(y0) || !Number.isFinite(y1)) continue
    out.push({ x: 0, y: Math.min(y0, y1), w: width, h: Math.abs(y1 - y0), rank: z.rank ?? 99 })
  }
  return out
}

export function createLevelZonesPrimitive(initial = {}) {
  let chart = null
  let series = null
  let requestUpdate = null
  let zones = initial.zones || []
  let opts = { color: initial.color || '#c9a84c', baseAlpha: initial.baseAlpha ?? 0.10, topAlpha: initial.topAlpha ?? 0.14 }

  const paneView = {
    zOrder: () => 'bottom',
    renderer: () => ({
      draw: (target) => {
        if (!series || !zones.length) return
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          const rects = zoneRects(zones, p => series.priceToCoordinate(p), mediaSize.width)
          for (const r of rects) {
            const alpha = r.rank === 1 ? opts.topAlpha : opts.baseAlpha
            ctx.fillStyle = hexWithAlpha(opts.color, alpha)
            ctx.fillRect(r.x, r.y, r.w, r.h)
          }
        })
      },
    }),
  }

  function hexWithAlpha(hex, a) {
    const n = parseInt(hex.slice(1), 16)
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
    return `rgba(${r},${g},${b},${a})`
  }

  const primitive = {
    paneViews: () => [paneView],
    updateAllViews: () => {},
    attached: (param) => { chart = param.chart; series = param.series; requestUpdate = param.requestUpdate },
    detached: () => { chart = null; series = null; requestUpdate = null },
  }

  return {
    primitive,
    setZones(next) { zones = Array.isArray(next) ? next : []; if (requestUpdate) requestUpdate() },
    setOptions(patch) { opts = { ...opts, ...patch }; if (requestUpdate) requestUpdate() },
  }
}
```

- [ ] **Step 4: Run to verify PASS**
- [ ] **Step 5: Commit**

```bash
git add app/src/components/chart/levelZonesPrimitive.js app/src/components/chart/levelZonesPrimitive.test.js
git commit -m "feat(signature): level-zones canvas primitive (screenshot-safe)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: SWR hook + StockChart wiring

**Files:**
- Create: `app/src/hooks/useSignatureIndicators.js`
- Modify: `app/src/components/StockChart.jsx` — four small, surgical touches:
  1. hook call beside `usePatternDetections` (~L1243)
  2. extend the `mergedPriceLines` memo (~L882-885)
  3. extend the `mergedMarkers` memo (~L865-881)
  4. attach `levelZonesPrimitive` beside the swing-labels attach (~L3523-3540), with detach handling mirroring `markersControllerRef` on chart-type swap (~L2782-2785)

**Interfaces:**
- Consumes: `useIsPaid()` from `context/AuthContext.jsx`; `cs.signature.*` from Task 8; transforms from Task 9; primitive from Task 10.
- Produces: `useSignatureIndicators(sym, cfg, isPaid)` returning `{ dpLines, dpZones, gexLines, flowMarkers }` (all `[]` when disabled/unpaid/loading — the wiring below stays branch-free). SWR keys are `null` unless `isPaid && cfg.<toggle>` (the `usePatternDetections` suppression idiom), `refreshInterval: 120_000`, `dedupingInterval: 30_000`.

- [ ] **Step 1: Implement the hook** (no component test — StockChart is never rendered in vitest; the hook is thin over tested transforms):

```js
// app/src/hooks/useSignatureIndicators.js
import { useMemo } from 'react'
import useSWR from 'swr'
import { dpToPriceLines, dpToZones, gexToPriceLines, flowToMarkers } from '../components/chart/signatureData'

const fetcher = (url) => fetch(url, { credentials: 'include' }).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
const OPTS = { refreshInterval: 120_000, revalidateOnFocus: false, dedupingInterval: 30_000 }

export function useSignatureIndicators(sym, cfg, isPaid) {
  const s = sym ? encodeURIComponent(sym) : null
  const { data: dp } = useSWR(isPaid && s && cfg?.darkPoolLevels ? `/api/signature/darkpool-levels?sym=${s}` : null, fetcher, OPTS)
  const { data: gex } = useSWR(isPaid && s && cfg?.gexWalls ? `/api/signature/gex-walls?sym=${s}` : null, fetcher, OPTS)
  const { data: fcb } = useSWR(isPaid && s && cfg?.flowSignals ? `/api/signature/flow-breakout?sym=${s}` : null, fetcher, OPTS)

  const dpLines = useMemo(() => dpToPriceLines(dp), [dp])
  const dpZones = useMemo(() => dpToZones(dp), [dp])
  const gexLines = useMemo(() => gexToPriceLines(gex), [gex])
  const flowMarkers = useMemo(() => flowToMarkers(fcb), [fcb])
  return { dpLines, dpZones, gexLines, flowMarkers }
}
```

- [ ] **Step 2: Wire into StockChart.jsx** — each touch is additive and memoized (the priceLines identity guard at L3481 tears down and rebuilds on EVERY new array reference — never inline a fresh array):

```js
// (1) beside usePatternDetections (~L1243):
const isPaidUser = useIsPaid()
const signatureCfg = cs.signature || {}
const { dpLines, dpZones, gexLines, flowMarkers } =
  useSignatureIndicators(sym, signatureCfg, isPaidUser)

// (2) mergedPriceLines memo (~L882-885) becomes:
const mergedPriceLines = useMemo(
  () => [...(priceLines || []), ...(j2.priceLines || []), ...dpLines, ...gexLines],
  [priceLines, j2.priceLines, dpLines, gexLines],
)

// (3) mergedMarkers memo (~L865-881): add `...flowMarkers` to the array and
//     `flowMarkers` to the dependency list. Nothing else changes.

// (4) primitive attach (beside swing labels ~L3523-3540):
if (!zonesAttachedRef.current && candleSeriesRef.current) {
  try {
    zonesCtlRef.current = createLevelZonesPrimitive({})
    candleSeriesRef.current.attachPrimitive(zonesCtlRef.current.primitive)
    zonesAttachedRef.current = true
  } catch {}
}
if (zonesCtlRef.current) zonesCtlRef.current.setZones(dpZones)
// refs declared beside swingAttachedRef (~L902):
//   const zonesAttachedRef = useRef(false); const zonesCtlRef = useRef(null)
// reset beside the chart-type swap block (~L2785): zonesAttachedRef.current = false
```
Imports added at top of StockChart.jsx: `useSignatureIndicators`, `createLevelZonesPrimitive`, `useIsPaid` (already imported? verify — AuthContext import exists for other uses; add if absent).

- [ ] **Step 3: Full frontend test suite** — `cd app && npm test` → all pass (no regressions; StockChart isn't rendered by tests, so this verifies the touched modules still parse/import cleanly via their consumers).

- [ ] **Step 4: Live verification (dev)** — run the app (`npm run dev` against the dev API or prod API per house dev setup), open a chart as a paid/admin user, enable the three toggles via localStorage-persisted settings (Task 12 adds UI; for now flip `chart_settings.signature` in the browser console via the prefs POST or temporarily default one toggle true in dev). Verify: gold DP lines + zones render; GEX lines render on a liquid symbol; no console errors; flipping tickers doesn't leak lines (identity guard covers removal).

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useSignatureIndicators.js app/src/components/StockChart.jsx
git commit -m "feat(signature): fetch + render signature indicators on the existing chart path

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Toolbar toggles (premium-locked group)

**Files:**
- Modify: `app/src/components/chart/ChartToolbar.jsx` (new settings group beside the `extendedHoursShading` row ~L586-591; uses the existing `update(path, value)` 2-segment idiom ~L101-115)
- Test: none new (ChartToolbar has no existing test file; the settings round-trip is covered by Task 8's chartDefaults tests)

**Interfaces:**
- Consumes: `cs.signature.*`, `update('signature.<key>', bool)`, `useIsPaid()`.
- Produces: a "UCT Signature" group with 3 rows — labels **Dark Pool Levels**, **GEX Walls**, **Flow Signals** — each with `title` tooltip text (copy in Task 13). For free users: rows render disabled with a 🔒 and `title="Premium — UCT Signature indicators"` (merchandise, don't hide — UX panel decision).

- [ ] **Step 1: Implement the group** (pattern copied from the extendedHoursShading row):

```jsx
{/* UCT Signature (premium) */}
<div className={s.sGroup}>
  <div className={s.sGroupTitle}>UCT Signature</div>
  {[
    ['darkPoolLevels', 'Dark Pool Levels', 'Top dark-pool notional levels (20 sessions, confirmed prints only). Non-repainting.'],
    ['gexWalls', 'GEX Walls', 'Call/Put walls + zero gamma from the live options chain. Cached 10 min.'],
    ['flowSignals', 'Flow Signals', 'Breakouts confirmed by same-session options flow. Confirmed bars only. Non-repainting.'],
  ].map(([key, label, tip]) => (
    <label key={key} className={s.sRow} title={isPaid ? tip : 'Premium — UCT Signature indicators'}>
      <input
        type="checkbox"
        disabled={!isPaid}
        checked={!!cs.signature?.[key]}
        onChange={e => update(`signature.${key}`, e.target.checked)}
      />
      <span>{label}{!isPaid ? ' 🔒' : ''}</span>
    </label>
  ))}
</div>
```
(`const isPaid = useIsPaid()` at component top; import from `../../context/AuthContext`. Reuse existing `s.sGroup`/`s.sRow` classes — no new CSS.)

- [ ] **Step 2: Run frontend suite** — `cd app && npm test` → green.

- [ ] **Step 3: Live check** — toggles flip the indicators on/off; free-user view (open a private window logged out or a free test account) shows locked rows.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/chart/ChartToolbar.jsx
git commit -m "feat(signature): toolbar toggles with premium lock state

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Honesty blurbs + owner review pack (NO public copy ships here)

**Files:**
- Create: `docs/superpowers/specs/2026-08-signature-indicators-copy.md`

**Interfaces:**
- Produces: the owner-review document — for EACH indicator: (a) one-paragraph "how it's computed" honesty blurb (plain language, states the exact v1 rule numbers), (b) the repaint statement ("computed from confirmed data only; signals never restate"), (c) the toolbar tooltip line (must match Task 12's strings), (d) a drafted landing-page section "The first indicators that show their receipts" — clearly marked DRAFT, ships only on explicit owner "ship it" (house rule `feedback_explicit_ship_gate`).

- [ ] **Step 1: Write the doc.** Full draft copy for all three indicators + the landing section, each blurb citing the constants from `rules.py` verbatim (e.g., "clusters the last 20 sessions of confirmed dark-pool prints into ¼%-wide price bins and keeps the five heaviest by total notional — minimum $10M"). End with a checklist: `[ ] DPL numbers approved · [ ] FCB numbers approved · [ ] GXW numbers approved · [ ] blurbs approved · [ ] landing copy approved for ship`.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-08-signature-indicators-copy.md
git commit -m "docs(signature): honesty blurbs + owner review pack (draft, unshipped copy)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 3: STOP — owner review gate.** Present the review pack + the rules table to the owner. Do not proceed to Task 14 until the v1 numbers and blurbs are approved (landing copy can lag; it isn't in this branch's ship).

---

### Task 14: Verification + ship (deploy window only)

**Files:** none new — verification + push.

- [ ] **Step 1: Full backend suite** — `python -m pytest tests/ -q` from the worktree root. Expected: green (426+ files; pre-existing weekend-only failures are known — compare against the Task 0 baseline, not absolute zero).
- [ ] **Step 2: Full frontend suite** — `cd app && npm test` → green.
- [ ] **Step 3: The real-fetch check (house rule: one test must hit the real thing).** With the API running locally against real volume data is impossible on this box — instead, after deploy (Step 5) run against prod: `curl -s -o /dev/null -w "%{http_code}" "https://uctintelligence.com/api/signature/darkpool-levels?sym=NVDA"` → expect **401/402** (anon gate proves the premium gate is live — NEVER probe with a real session against mutating endpoints; these are GET-only). Then verify as the owner's logged-in browser session (Claude in Chrome): payload has `levels`, `version: "dpl-v1"`, and second load is instant (serve-stale warm).
- [ ] **Step 4: Ship.** In a deploy window (≥4:20 PM ET or <9:15 AM ET), from the worktree:

```bash
git push origin feat/phase-a-signature:master
```
(The shared pre-push hook enforces the window; if it blocks, WAIT — never bypass.)
- [ ] **Step 5: Prod smoke** — Railway deploy green; anon 402 check (Step 3); paid-session chart shows all three indicators on NVDA/SPY; boot log shows `signature_sweep` job registered; after the first 16:45 ET weekday sweep, `signature_signals` has rows (check via `railway ssh` + `/opt/venv/bin/python -c "from api.services.signature import ledger; print(ledger.get_signals(limit=5))"`).
- [ ] **Step 6: Update memory** — mark Phase A shipped in `project_indicator_platform_2026_07_31.md`, record the ledger start date (the receipts clock), note any tuning the owner requested.

---

## Self-review notes (run before handoff)

- Spec §10 coverage: 3 indicators ✅ (Tasks 2/3/4+6), premium gate ✅ (T6), serve-stale ✅ (T6), ledger from day one ✅ (T5/T7), closed-bar by construction ✅ (T3 `include_last` discipline; T7 post-close only), wire format null-for-NaN — N/A here (no NaN columns in these payloads; levels/signals are sparse objects, which the spec's Phase B wire contract permits for non-column payloads), badges/blurbs ✅ (T12 tooltips + T13 pack), landing copy gated ✅ (T13), screenshot-safety ✅ (T10 canvas primitive), stretch branded-export upgrade NOT included (deliberate — `composeScreenshot` already brands; badge-in-frame moves to Phase B with the badge system).
- Type consistency: `parse_money` (T1) used by T3; ledger signature (T5) matches T6/T7 call sites; transform output shapes (T9) match the StockChart priceLine/marker shapes documented from the codebase; `_fetch_bars` returns the evaluator's bar-dict shape.
- Known deliberate scope cuts: FCB is 1D-only; sweep covers a 10-symbol default list (env-expandable); no fired-alert UI; no zone rendering for GEX (lines only).
