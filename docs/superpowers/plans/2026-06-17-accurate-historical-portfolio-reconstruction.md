# Accurate Historical Portfolio Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the estimated equity walk-back with a true daily mark-to-market reconstruction of net-liq (stocks + options + cash) for broker accounts, using historical daily closes from Massive/Polygon.

**Architecture:** A pure core (normalize activities → events → replay daily holdings/cash timeline → value each day against an injected price-lookup) plus a thin Massive-backed daily-close fetcher and an orchestrator. `performance_service` consumes the result as its equity series; the hero + Performance panel then run on exact data.

**Tech Stack:** Python/FastAPI, SQLite (`j2_*`), Massive/Polygon `/v2/aggs`, pytest.

## Global Constraints

- **Point-in-time valuation uses UNADJUSTED prices** (`adjusted=false`) × as-traded share counts; splits handled explicitly in replay. (spec)
- **Options fully marked to historical price** via `/v2/aggs/ticker/O:{OCC}/range/1/day` (verified live); contract multiplier 100 (10 for minis). (spec)
- **Broker accounts only.** USD only. Daily granularity. No new env secrets (`MASSIVE_API_KEY`/`POLYGON_API_KEY` already set). (spec)
- **Pure core is API-free + deterministic** — fetching is injected as `price_fn` so tests never hit the network. (spec)
- **Best-effort:** any fetch/compute failure degrades to the prior cached/estimated series, never errors the page or breaks sync. (spec)
- **Mirror the broker** — never fabricate; flag `partial` points where a price is unavailable. (`feedback_broker_mirror_fidelity`)
- Shared worktree: own files only, FF-push `worktree-broker-sync:master`, rebase over partner.

---

## File Structure

- `api/services/massive.py` — **modify**: add `get_daily_agg(symbol, from_date, to_date, *, adjusted, map_symbol)` (unadjusted-capable, OCC-safe daily bars).
- `api/services/journal_two/broker/historical_equity.py` — **create**: the engine — `occ_symbol`, `events_from_account`, `replay_timeline`, `value_timeline`, `reconstruct_daily_equity`.
- `api/services/journal_two/broker/performance_service.py` — **modify**: source the equity series from `reconstruct_daily_equity` (fallback to existing estimated walk-back).
- Tests: `tests/test_broker_historical_equity.py` (engine), extend `tests/test_broker_performance_service.py` (wiring).

---

### Task 1: Massive daily-agg helper (unadjusted + OCC-safe)

**Files:**
- Modify: `api/services/massive.py` (after `get_agg_bars`, ~line 462)
- Test: `tests/test_massive_daily_agg.py`

**Interfaces:**
- Produces: `get_daily_agg(symbol, from_date, to_date, *, adjusted=False, map_symbol=True) -> list[dict]`. Returns `[{t,o,h,l,c,v}, …]`. `map_symbol=True` applies `to_polygon_symbol` (equities, e.g. BRK-B→BRK.B); `map_symbol=False` passes `symbol` verbatim (OCC option tickers like `O:AAPL260116C00200000`). Empty list on any error.

- [ ] **Step 1: Write the failing test** (URL construction, no network — monkeypatch the client's `_get`)

```python
# tests/test_massive_daily_agg.py
from api.services import massive

def test_get_daily_agg_builds_unadjusted_url_and_passes_occ_verbatim(monkeypatch):
    captured = {}
    class _Client:
        _api_key = "k"
        def _get(self, url):
            captured["url"] = url
            return {"results": [{"t": 1, "c": 36.82}]}
    monkeypatch.setattr(massive, "_get_client", lambda: _Client())

    out = massive.get_daily_agg("O:AAPL260116C00200000", "2025-09-02", "2025-12-01",
                                adjusted=False, map_symbol=False)
    assert out == [{"t": 1, "c": 36.82}]
    assert "/v2/aggs/ticker/O:AAPL260116C00200000/range/1/day/2025-09-02/2025-12-01" in captured["url"]
    assert "adjusted=false" in captured["url"]      # point-in-time valuation
```

- [ ] **Step 2: Run → FAIL** `python -m pytest tests/test_massive_daily_agg.py -v` (AttributeError: get_daily_agg).

- [ ] **Step 3: Implement** (in `massive.py`)

```python
def get_daily_agg(symbol: str, from_date: str, to_date: str, *,
                  adjusted: bool = False, map_symbol: bool = True) -> list[dict]:
    """Daily OHLCV bars from the Massive agg endpoint. Generic over ticker —
    works for equities (map_symbol=True applies to_polygon_symbol) AND option
    OCC symbols like 'O:AAPL260116C00200000' (map_symbol=False, verbatim).
    adjusted=False gives raw point-in-time prices for portfolio valuation."""
    try:
        client = _get_client()
        sym = to_polygon_symbol(symbol) if map_symbol else symbol
        adj = "true" if adjusted else "false"
        url = (
            f"{_REST_BASE}/v2/aggs/ticker/{sym}/range/1/day/{from_date}/{to_date}"
            f"?adjusted={adj}&sort=asc&limit=50000&apiKey={client._api_key}"
        )
        return client._get(url).get("results") or []
    except Exception:
        return []
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `git add api/services/massive.py tests/test_massive_daily_agg.py && git commit -m "feat(broker): massive.get_daily_agg (unadjusted, OCC-safe daily bars)"`

---

### Task 2: OCC symbol builder

**Files:**
- Create: `api/services/journal_two/broker/historical_equity.py`
- Test: `tests/test_broker_historical_equity.py`

**Interfaces:**
- Produces: `occ_symbol(underlying, expiration, contract_type, strike) -> str`. `expiration` ISO `YYYY-MM-DD`; `contract_type` `'call'|'put'`; `strike` float. Returns `'O:' + UNDER + YYMMDD + (C|P) + int(round(strike*1000)) zero-padded to 8`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_broker_historical_equity.py
from api.services.journal_two.broker import historical_equity as he

def test_occ_symbol():
    assert he.occ_symbol("AAPL", "2026-01-16", "call", 200.0) == "O:AAPL260116C00200000"
    assert he.occ_symbol("SPY", "2025-12-19", "put", 600.5) == "O:SPY251219P00600500"
```

- [ ] **Step 2: Run → FAIL** (module/func missing).

- [ ] **Step 3: Implement** (start the module)

```python
# api/services/journal_two/broker/historical_equity.py
"""Accurate daily portfolio-value reconstruction for broker accounts.

Pure core (API-free, deterministic): normalize activities → events → replay a
daily holdings+cash timeline → value each day against an injected price-lookup.
A thin Massive-backed fetcher + orchestrator wire it to real data.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any, Callable

logger = logging.getLogger(__name__)


def occ_symbol(underlying: str, expiration: str, contract_type: str, strike: float) -> str:
    yymmdd = str(expiration)[2:10].replace("-", "")           # YYYY-MM-DD → YYMMDD
    cp = "C" if str(contract_type).lower().startswith("c") else "P"
    strike_int = int(round(float(strike) * 1000))
    return f"O:{underlying.upper()}{yymmdd}{cp}{strike_int:08d}"
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `git add api/services/journal_two/broker/historical_equity.py tests/test_broker_historical_equity.py && git commit -m "feat(broker): OCC option symbol builder"`

---

### Task 3: Replay events → daily holdings/cash timeline

**Files:**
- Modify: `historical_equity.py`
- Test: `tests/test_broker_historical_equity.py`

**Interfaces:**
- Consumes: `events` — list of dicts sorted-or-unsorted by `date` (`YYYY-MM-DD`), each:
  - `{kind:'stock', date, ticker, shares_delta, cash_delta}`
  - `{kind:'option', date, occ, contracts_delta, cash_delta}`
  - `{kind:'option_close', date, occ}` (lifecycle: expire/assign/exercise → zero the occ)
  - `{kind:'cash', date, amount}` (signed: + in, − out)
  - `{kind:'split', date, ticker, factor}` (multiply held shares)
- Produces: `replay_timeline(events) -> list[dict]` — one row per distinct event date, ascending: `{date, stocks:{ticker:shares}, options:{occ:contracts}, cash}` reflecting cumulative state **as of end of that date**. Deltas on the same date fold into one row.

- [ ] **Step 1: Write the failing test**

```python
def test_replay_accumulates_stock_option_cash_and_handles_split_and_close():
    events = [
        {"kind": "cash", "date": "2026-01-01", "amount": 10000.0},                 # deposit
        {"kind": "stock", "date": "2026-01-02", "ticker": "AAPL", "shares_delta": 100, "cash_delta": -1000.0},
        {"kind": "option", "date": "2026-01-03", "occ": "O:AAPL260116C00200000", "contracts_delta": 2, "cash_delta": -300.0},
        {"kind": "split", "date": "2026-01-04", "ticker": "AAPL", "factor": 2},     # 100 → 200
        {"kind": "stock", "date": "2026-01-05", "ticker": "AAPL", "shares_delta": -50, "cash_delta": 600.0},
        {"kind": "option_close", "date": "2026-01-06", "occ": "O:AAPL260116C00200000"},
    ]
    tl = he.replay_timeline(events)
    assert [r["date"] for r in tl] == ["2026-01-01", "2026-01-02", "2026-01-03",
                                       "2026-01-04", "2026-01-05", "2026-01-06"]
    assert tl[0]["cash"] == 10000.0
    assert tl[1]["stocks"]["AAPL"] == 100 and tl[1]["cash"] == 9000.0
    assert tl[2]["options"]["O:AAPL260116C00200000"] == 2 and tl[2]["cash"] == 8700.0
    assert tl[3]["stocks"]["AAPL"] == 200                       # split doubled
    assert tl[4]["stocks"]["AAPL"] == 150 and tl[4]["cash"] == 9300.0
    assert tl[5]["options"].get("O:AAPL260116C00200000", 0) == 0  # closed/expired
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** (append to `historical_equity.py`)

```python
def replay_timeline(events: list[dict]) -> list[dict]:
    stocks: dict[str, float] = {}
    options: dict[str, float] = {}
    cash = 0.0
    by_date: dict[str, list[dict]] = {}
    for e in events:
        by_date.setdefault(e["date"][:10], []).append(e)

    out: list[dict] = []
    for d in sorted(by_date):
        for e in by_date[d]:
            k = e["kind"]
            if k == "stock":
                stocks[e["ticker"]] = stocks.get(e["ticker"], 0.0) + e["shares_delta"]
                cash += e.get("cash_delta", 0.0)
            elif k == "option":
                options[e["occ"]] = options.get(e["occ"], 0.0) + e["contracts_delta"]
                cash += e.get("cash_delta", 0.0)
            elif k == "option_close":
                options[e["occ"]] = 0.0
            elif k == "cash":
                cash += e["amount"]
            elif k == "split":
                if e["ticker"] in stocks:
                    stocks[e["ticker"]] *= e["factor"]
        out.append({
            "date": d,
            "stocks": {t: s for t, s in stocks.items() if abs(s) > 1e-9},
            "options": {o: c for o, c in options.items() if abs(c) > 1e-9},
            "cash": round(cash, 2),
        })
    return out
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `git commit -am "feat(broker): replay events → daily holdings/cash timeline"`

---

### Task 4: Value the timeline against an injected price-lookup

**Files:**
- Modify: `historical_equity.py`
- Test: `tests/test_broker_historical_equity.py`

**Interfaces:**
- Produces: `value_timeline(timeline, calendar_dates, price_fn) -> list[dict]`. `calendar_dates` = ascending ISO dates to emit (e.g. each trading day from first to last). `price_fn(kind, symbol, date) -> float | None` where `kind ∈ {'stock','option'}`. Carries the last-known holdings state forward to every calendar date; per date: `equity = cash + Σ shares×stock_close + Σ contracts×opt_close×100`. A missing price (`None`) → uses the most recent prior close for that symbol; if none ever → that symbol contributes 0 and the row is flagged `partial:true`. Returns `[{date, equity, estimated:False, partial:bool}]`.

- [ ] **Step 1: Write the failing test**

```python
def test_value_timeline_marks_holdings_to_market():
    timeline = [
        {"date": "2026-01-01", "stocks": {"AAPL": 100}, "options": {}, "cash": 0.0},
    ]
    dates = ["2026-01-01", "2026-01-02", "2026-01-03"]
    prices = {("stock", "AAPL", "2026-01-01"): 10.0,
              ("stock", "AAPL", "2026-01-02"): 11.0,
              ("stock", "AAPL", "2026-01-03"): 12.0}
    pf = lambda kind, sym, d: prices.get((kind, sym, d))
    out = he.value_timeline(timeline, dates, pf)
    assert [round(r["equity"]) for r in out] == [1000, 1100, 1200]   # reflects HOLDING gains
    assert all(r["estimated"] is False and r["partial"] is False for r in out)

def test_value_timeline_options_x100_and_carry_forward_and_partial():
    timeline = [{"date": "2026-01-01", "stocks": {}, "options": {"O:X": 2}, "cash": 500.0}]
    prices = {("option", "O:X", "2026-01-01"): 1.50}  # 2026-01-02 missing → carry 1.50
    pf = lambda kind, sym, d: prices.get((kind, sym, d))
    out = he.value_timeline(timeline, ["2026-01-01", "2026-01-02"], pf)
    assert round(out[0]["equity"]) == 500 + round(2 * 1.50 * 100)     # 800
    assert round(out[1]["equity"]) == 800                              # carried forward
    # No price ever for a held symbol → partial.
    tl2 = [{"date": "2026-01-01", "stocks": {"ZZZ": 5}, "options": {}, "cash": 0.0}]
    out2 = he.value_timeline(tl2, ["2026-01-01"], lambda *a: None)
    assert out2[0]["partial"] is True and out2[0]["equity"] == 0.0
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```python
def value_timeline(timeline: list[dict], calendar_dates: list[str],
                   price_fn: Callable[[str, str, str], float | None]) -> list[dict]:
    states = {r["date"]: r for r in timeline}
    last_close: dict[tuple[str, str], float] = {}   # (kind, symbol) → last seen close
    cur = {"stocks": {}, "options": {}, "cash": 0.0}
    out: list[dict] = []
    for d in calendar_dates:
        if d in states:
            cur = states[d]
        partial = False
        equity = cur["cash"]
        for ticker, shares in cur["stocks"].items():
            c = price_fn("stock", ticker, d)
            if c is None:
                c = last_close.get(("stock", ticker))
            else:
                last_close[("stock", ticker)] = c
            if c is None:
                partial = True
            else:
                equity += shares * c
        for occ, contracts in cur["options"].items():
            c = price_fn("option", occ, d)
            if c is None:
                c = last_close.get(("option", occ))
            else:
                last_close[("option", occ)] = c
            if c is None:
                partial = True
            else:
                equity += contracts * c * 100
        out.append({"date": d, "equity": round(equity, 2), "estimated": False, "partial": partial})
    return out
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `git commit -am "feat(broker): daily mark-to-market valuation (stocks + options ×100)"`

---

### Task 5: Normalize account activities → events

**Files:**
- Modify: `historical_equity.py`
- Test: `tests/test_broker_historical_equity.py`

**Interfaces:**
- Consumes: `activities_store.get_activities`, `snaptrade_adapter.partition` (→ `equity_fills` [`Fill`], `option_events` [dict]), `cashflow_store.list_flows` (the persisted cash ledger), `occ_symbol`, `replay_timeline`/`value_timeline` (later).
- Produces: `events_from_account(user_id, account_id, broker_account_id, activities, cash_flows) -> list[dict]` returning the event dicts Task 3 consumes. Stock buy → `shares_delta=+shares, cash_delta=-(shares*price+fee)`; sell → `-shares, +(shares*price-fee)`. Option `side=='buy'` → `contracts_delta=+contracts, cash_delta=-(contracts*price*100+fee)`; `'sell'` → `-contracts, +(contracts*price*100-fee)`; lifecycle `option_expiration|assignment|exercise` → `{kind:'option_close', occ}`. Cash-ledger rows → `{kind:'cash', amount}` (signed amount already). (Splits: SnapTrade split activities aren't reliably typed in v1 → none emitted; reconciliation in Task 6 flags divergence.)

- [ ] **Step 1: Write the failing test**

```python
from api.services.journal_two.broker.snaptrade_adapter import Fill

def test_events_from_account_normalizes_stock_option_cash(monkeypatch):
    # Stub partition to return one buy fill + one option open event.
    fills = [Fill(row=1, symbol="AAPL", action="Buy", shares=100, price=10.0,
                  date="2026-01-02T00:00:00Z", fee=0.0)]
    opt = [{"eventKind": "option_trade", "side": "buy", "openClose": "open",
            "underlying": "AAPL", "strike": 200.0, "expiration": "2026-01-16",
            "contractType": "call", "contracts": 2, "price": 1.50, "fee": 0.0,
            "date": "2026-01-03T00:00:00Z"}]
    monkeypatch.setattr(he, "_partition",
                        lambda acts: {"equity_fills": fills, "option_events": opt})
    cash_flows = [{"date": "2026-01-01", "type": "deposit", "amount": 10000.0}]
    evs = he.events_from_account("u1", "acc", "bk1", activities=[], cash_flows=cash_flows)
    kinds = [e["kind"] for e in evs]
    assert "cash" in kinds and "stock" in kinds and "option" in kinds
    stock = next(e for e in evs if e["kind"] == "stock")
    assert stock["ticker"] == "AAPL" and stock["shares_delta"] == 100 and stock["cash_delta"] == -1000.0
    opt_ev = next(e for e in evs if e["kind"] == "option")
    assert opt_ev["occ"] == "O:AAPL260116C00200000" and opt_ev["contracts_delta"] == 2
    assert opt_ev["cash_delta"] == -300.0    # 2 × 1.50 × 100
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** (use a `_partition` indirection so tests can stub it)

```python
from api.services.journal_two.broker import snaptrade_adapter as _adapter

def _partition(activities):
    return _adapter.partition(activities)

_OPT_LIFECYCLE = {"option_expiration", "option_assignment", "option_exercise"}

def events_from_account(user_id, account_id, broker_account_id, activities, cash_flows) -> list[dict]:
    part = _partition(activities)
    events: list[dict] = []

    for f in part.get("equity_fills", []):
        d = f.date[:10]
        gross = f.shares * f.price
        if f.action == "Buy":
            events.append({"kind": "stock", "date": d, "ticker": f.symbol,
                           "shares_delta": f.shares, "cash_delta": -(gross + f.fee)})
        else:
            events.append({"kind": "stock", "date": d, "ticker": f.symbol,
                           "shares_delta": -f.shares, "cash_delta": (gross - f.fee)})

    for ev in part.get("option_events", []):
        d = (ev.get("date") or "")[:10]
        occ = occ_symbol(ev["underlying"], ev["expiration"], ev["contractType"], ev["strike"])
        if ev.get("eventKind") in _OPT_LIFECYCLE:
            events.append({"kind": "option_close", "date": d, "occ": occ})
            continue
        contracts = ev.get("contracts") or 0
        price = ev.get("price") or 0.0
        fee = ev.get("fee") or 0.0
        gross = contracts * price * 100
        if ev.get("side") == "buy":
            events.append({"kind": "option", "date": d, "occ": occ,
                           "contracts_delta": contracts, "cash_delta": -(gross + fee)})
        elif ev.get("side") == "sell":
            events.append({"kind": "option", "date": d, "occ": occ,
                           "contracts_delta": -contracts, "cash_delta": (gross - fee)})

    for cf in (cash_flows or []):
        events.append({"kind": "cash", "date": cf["date"][:10], "amount": cf["amount"]})

    return events
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `git commit -am "feat(broker): normalize activities + cash ledger → reconstruction events"`

---

### Task 6: Orchestrator — reconstruct_daily_equity

**Files:**
- Modify: `historical_equity.py`
- Test: `tests/test_broker_historical_equity.py`

**Interfaces:**
- Produces: `reconstruct_daily_equity(user_id, account_id, *, price_fn=None, live_equity=None, today=None, conn=None) -> list[{date, equity, estimated:False, partial}]`. Loads activities (`activities_store.get_activities` via the account's broker_account_id) + cash flows (`cashflow_store.list_flows`); builds events (Task 5) → timeline (Task 3); emits one point per **trading day present in the timeline plus a final `today` point** (v1 uses event-date granularity + today — avoids fabricating a full calendar); values via `price_fn` (Task 4). Default `price_fn` fetches daily closes via `massive.get_daily_agg` (stocks `map_symbol=True, adjusted=False`; options `map_symbol=False`), memoized per symbol across the window (one fetch per symbol, indexed by date). If `live_equity` given, the final point's equity is overridden with it (live right-edge). Returns `[]` if no events.

- [ ] **Step 1: Write the failing test** (inject `price_fn`, stub loaders)

```python
def test_reconstruct_daily_equity_end_to_end(monkeypatch):
    fills = [Fill(row=1, symbol="AAPL", action="Buy", shares=100, price=10.0,
                  date="2026-01-02T00:00:00Z", fee=0.0)]
    monkeypatch.setattr(he, "_partition", lambda a: {"equity_fills": fills, "option_events": []})
    monkeypatch.setattr(he, "_load_activities", lambda u, b: [{"x": 1}])
    monkeypatch.setattr(he, "_load_cash_flows", lambda u, a: [{"date": "2026-01-01", "type": "deposit", "amount": 5000.0}])
    monkeypatch.setattr(he, "_resolve_broker_account_id", lambda u, a, conn=None: "bk1")
    prices = {"2026-01-01": 10.0, "2026-01-02": 10.0, "2026-01-03": 12.0}
    pf = lambda kind, sym, d: prices.get(d)
    out = he.reconstruct_daily_equity("u1", "acc", price_fn=pf, today="2026-01-03")
    # 01-01 deposit 5000, no shares → 5000; 01-02 buy 100@10 (cash 4000 + 100×10) → 5000;
    # 01-03 (today) cash 4000 + 100×12 → 5200.
    assert out[-1]["date"] == "2026-01-03" and round(out[-1]["equity"]) == 5200

def test_reconstruct_live_equity_overrides_final_point(monkeypatch):
    fills = [Fill(row=1, symbol="AAPL", action="Buy", shares=10, price=10.0,
                  date="2026-01-02T00:00:00Z", fee=0.0)]
    monkeypatch.setattr(he, "_partition", lambda a: {"equity_fills": fills, "option_events": []})
    monkeypatch.setattr(he, "_load_activities", lambda u, b: [{}])
    monkeypatch.setattr(he, "_load_cash_flows", lambda u, a: [])
    monkeypatch.setattr(he, "_resolve_broker_account_id", lambda u, a, conn=None: "bk1")
    out = he.reconstruct_daily_equity("u1", "acc", price_fn=lambda *a: 10.0,
                                      live_equity=999.0, today="2026-01-03")
    assert out[-1]["equity"] == 999.0
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** (loaders as small indirections for testability)

```python
def _resolve_broker_account_id(user_id, account_id, conn=None):
    from api.services.auth_db import get_connection
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT id FROM j2_broker_accounts WHERE user_id=? AND j2_account_id=? "
            "ORDER BY created_at ASC LIMIT 1", (user_id, account_id)).fetchone()
        return row["id"] if row else None
    finally:
        if owned:
            conn.close()

def _load_activities(user_id, broker_account_id):
    from api.services.journal_two.broker import activities_store
    return activities_store.get_activities(user_id, broker_account_id)

def _load_cash_flows(user_id, account_id):
    from api.services.journal_two.broker import cashflow_store
    return cashflow_store.list_flows(user_id, account_id)

def _default_price_fn():
    """Memoized Massive-backed daily-close lookup. One fetch per symbol/window."""
    from api.services import massive
    cache: dict[str, dict[str, float]] = {}
    bounds: dict[str, tuple[str, str]] = {}

    def fetch(kind, symbol, start, end):
        bars = massive.get_daily_agg(symbol, start, end,
                                     adjusted=False, map_symbol=(kind == "stock"))
        series = {}
        for b in bars:
            iso = date.fromtimestamp(b["t"] / 1000).isoformat()
            series[iso] = b.get("c")
        return series

    def price_fn(kind, symbol, d):
        if symbol not in cache:
            cache[symbol] = fetch(kind, symbol, *bounds.get(symbol, (d, d)))
        return cache[symbol].get(d)

    price_fn._cache = cache
    price_fn._bounds = bounds
    return price_fn

def reconstruct_daily_equity(user_id, account_id, *, price_fn=None, live_equity=None,
                             today=None, conn=None) -> list[dict]:
    bkid = _resolve_broker_account_id(user_id, account_id, conn=conn)
    if not bkid:
        return []
    activities = _load_activities(user_id, bkid)
    cash_flows = _load_cash_flows(user_id, account_id)
    events = events_from_account(user_id, account_id, bkid, activities, cash_flows)
    if not events:
        return []
    timeline = replay_timeline(events)

    dates = sorted({r["date"] for r in timeline})
    if today and today > dates[-1]:
        dates.append(today)

    if price_fn is None:
        price_fn = _default_price_fn()
        # Pre-bound each symbol's fetch window to [first event, last date].
        syms_stock = {t for r in timeline for t in r["stocks"]}
        syms_opt = {o for r in timeline for o in r["options"]}
        for s in syms_stock | syms_opt:
            price_fn._bounds[s] = (dates[0], dates[-1])

    valued = value_timeline(timeline, dates, price_fn)
    if live_equity is not None and valued:
        valued[-1] = {**valued[-1], "equity": round(float(live_equity), 2)}
    return valued
```

- [ ] **Step 4: Run → PASS** (`python -m pytest tests/test_broker_historical_equity.py -v`).
- [ ] **Step 5: Commit** `git commit -am "feat(broker): reconstruct_daily_equity orchestrator (replay + marks + live edge)"`

---

### Task 7: Wire into performance_service

**Files:**
- Modify: `api/services/journal_two/broker/performance_service.py` (`account_performance`)
- Test: `tests/test_broker_performance_service.py` (extend)

**Interfaces:**
- `account_performance` builds its equity series from `historical_equity.reconstruct_daily_equity(...)` (filtered to the period window, live right-edge = the account's `brokerTotalEquity`). On empty/exception, fall back to the existing snapshot + estimated-prefix series (current behavior). `equitySeries` points carry `estimated:False` from the reconstruction.

- [ ] **Step 1: Write the failing test** — seed a broker account + 1 buy activity + a snapshot; monkeypatch `historical_equity.reconstruct_daily_equity` to return a known 3-point series; assert `account_performance(...)["equitySeries"]` equals it (reconstruction preferred over the estimated walk-back) and `estimated` is False.

```python
def test_account_performance_prefers_reconstruction(env, monkeypatch):
    from api.services.journal_two.broker import historical_equity, performance_service
    monkeypatch.setattr(historical_equity, "reconstruct_daily_equity",
        lambda user_id, account_id, **kw: [
            {"date": "2026-05-01", "equity": 10000.0, "estimated": False, "partial": False},
            {"date": "2026-05-02", "equity": 12000.0, "estimated": False, "partial": False},
        ])
    out = performance_service.account_performance("u1", env["j2"], "ALL")
    assert [p["date"] for p in out["equitySeries"]] == ["2026-05-01", "2026-05-02"]
    assert out["estimated"] is False
    assert out["timeWeighted"] == pytest.approx(0.20)   # 10000 → 12000, no flows
```

- [ ] **Step 2: Run → FAIL** (still using estimated prefix).

- [ ] **Step 3: Implement** — at the top of `account_performance`, after resolving the account, try the reconstruction and use it when non-empty:

```python
        # Prefer the exact daily mark-to-market reconstruction; fall back to the
        # snapshot + estimated-prefix series only if it yields nothing / errors.
        recon = []
        try:
            from api.services.journal_two.broker import historical_equity
            live_eq = None
            acct = accounts_service.get_account(user_id, account_id, conn=conn)
            if acct and acct.get("brokerTotalEquity") is not None:
                live_eq = float(acct["brokerTotalEquity"])
            recon = historical_equity.reconstruct_daily_equity(
                user_id, account_id, live_equity=live_eq, conn=conn) or []
        except Exception:
            logger.exception("[broker] historical reconstruction failed; using estimated")
        if recon:
            start = _period_start(period)
            equity = [(p["date"], p["equity"]) for p in recon if (start is None or p["date"] >= start)]
            external = cashflow_store.external_flow_series(user_id, account_id, start=start, conn=conn)
            by_type = cashflow_store.sum_by_type(user_id, account_id, start=start, conn=conn)
            internal = {"dividends": by_type.get("dividend", 0.0),
                        "interest": by_type.get("interest", 0.0), "fees": by_type.get("fee", 0.0)}
            result = performance.compute_performance(equity, external, internal)
            result["equitySeries"] = [{"date": d, "value": v, "estimated": False} for d, v in equity]
            result["flows"] = cashflow_store.list_flows(user_id, account_id, start=start, conn=conn)
            result["estimated"] = False
            result["period"] = (period or "ALL").upper()
            return result
        # … existing snapshot + estimated-prefix path unchanged below …
```
(Add `import logging; logger = logging.getLogger(__name__)` at module top if absent.)

- [ ] **Step 4: Run → PASS**, then full broker suite `python -m pytest tests/ -k broker -q`.
- [ ] **Step 5: Commit** `git commit -am "feat(broker): performance uses exact daily reconstruction (estimated fallback)"`

---

## Self-Review

**Spec coverage:** historical stock closes (T1 `get_daily_agg`) ✓; historical option closes via OCC (T1 `map_symbol=False` + T2 `occ_symbol`) ✓; replay holdings/cash incl. splits + option lifecycle (T3) ✓; unadjusted point-in-time mark-to-market, options ×100 (T4) ✓; normalize from activities + cash ledger (T5) ✓; orchestrator + live right-edge + per-symbol memoized fetch (T6) ✓; feeds performance_service, estimated fallback (T7) ✓; best-effort/never-break (T6 returns []/T7 try-except) ✓; partial-flagging on missing prices (T4) ✓; broker-only/USD (resolve broker_account_id, USD via existing helpers) ✓.

**Placeholder scan:** none — every code step is complete. Splits-from-feed are explicitly v1-deferred (no event emitted) with reconciliation-flag noted, not a hidden TODO.

**Type consistency:** event dict shapes identical across T3/T5; `price_fn(kind, symbol, date)` signature identical T4/T6; `reconstruct_daily_equity(...)` return `[{date,equity,estimated,partial}]` consumed in T7; `occ_symbol` output (`O:AAPL260116C00200000`) matches the live-probed format + T1 `map_symbol=False` path; `massive.get_daily_agg` signature identical T1/T6.

**Known v1 limitation (documented, not silent):** corporate-action splits are only applied if present as typed activities; otherwise a held-shares-vs-broker reconciliation discrepancy is logged. Acceptable per spec ("detected + logged").
