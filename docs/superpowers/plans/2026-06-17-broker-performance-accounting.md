# Broker Performance Accounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give broker-linked Journal 2.0 accounts deposit/withdrawal-adjusted, margin-aware performance with a user-selectable return metric (TWR / money-weighted / simple / $ P&L).

**Architecture:** Three backend units + display surfaces. (1) A cash-flow ledger persists the SnapTrade `CONTRIBUTION`/`WITHDRAWAL`/`DIVIDEND`/`INTEREST`/`FEE` activities the adapter already classifies but currently discards. (2) A pure performance engine takes an equity series + the external-flow series and returns all metrics. (3) A service assembles those series (forward = real net-liq snapshots, history = estimated) and two endpoints expose performance + the transactions list. Surfaces: account-return wiring (backend) + an Analytics performance section.

**Tech Stack:** FastAPI + SQLite (`auth.db`, `j2_*` tables), pytest; React + Vite frontend, SWR hooks, ECharts.

## Global Constraints

- **Mirror the broker; never curate/suppress imported data** (`feedback_broker_mirror_fidelity`). No dust/threshold filtering of cash flows.
- **USD only in v1** — non-USD flows/positions skipped (consistent with `balances.market_value`).
- **External vs internal flow rule (core correctness):** only `CONTRIBUTION`/`WITHDRAWAL`/transfers are *external* (excluded from return). `DIVIDEND`/`INTEREST`/`FEE`/`REI`/`STOCK_DIVIDEND` are *internal* (already in equity changes; never subtracted from return).
- **Idempotent + corrections-healing** on every broker import: stable `external_id`, re-sync = 0 dupes, voided activities pruned. Manual rows (`source != 'broker'`) never touched.
- **Best-effort, never breaks sync:** cash-flow capture wraps in try/except like the existing balances/options enrichment.
- **Default headline metric = TWR** (user-switchable).
- **Shared worktree:** stage only own files; FF-push `worktree-broker-sync:master`; `grep -c broker_sync api/main.py` ≥ 7 before any push; re-read files immediately before editing.
- **Schema:** new tables go in `db.py::_J2_SCHEMA` (run by `ensure_schema` via `executescript`); column adds to existing tables go in `_PHASE_2_ALTERS`.

---

## File Structure

- `api/services/journal_two/db.py` — **modify** `_J2_SCHEMA`: add `j2_broker_cash_flows` table + index.
- `api/services/journal_two/broker/cashflow_reconstruct.py` — **create** capture/dedup/heal of cash flows (sibling to `option_reconstruct.py`).
- `api/services/journal_two/broker/cashflow_store.py` — **create** thin SQLite CRUD for the ledger (sum/list/upsert/prune).
- `api/services/journal_two/broker/performance.py` — **create** pure engine: `time_weighted_return`, `money_weighted_return`, `simple_return`, `dollar_pnl`, `compute_performance`.
- `api/services/journal_two/broker/performance_service.py` — **create** series assembly (snapshots + estimated history + external flows) → calls engine.
- `api/services/journal_two/broker/sync.py` — **modify** wire cash-flow capture into the holdings/balances block.
- `api/services/journal_two/broker/reconstruct.py` — **modify** return `cashFlows` summary count (so sync logs it).
- `api/services/journal_two/accounts.py` — **modify** `comparison()` to source broker-account return from the engine.
- `api/routers/broker_sync.py` — **modify** add `GET /performance` + `GET /cash-flows`.
- `app/src/pages/journal-2-0/hooks/useJ2BrokerPerformance.js` — **create** SWR hook.
- `app/src/pages/journal-2-0/components/PerformancePanel.jsx` — **create** metric selector + summary + equity curve w/ flow markers + tx list.
- `app/src/pages/journal-2-0/tabs/AnalyticsTab.jsx` — **modify** mount `PerformancePanel` for broker accounts.
- Tests: `tests/test_broker_cashflows.py`, `tests/test_broker_performance.py`, `tests/test_broker_performance_service.py`, `tests/test_broker_router.py` (extend).

---

## Phase 1 — Cash-flow ledger (capture)

### Task 1: Schema — `j2_broker_cash_flows`

**Files:**
- Modify: `api/services/journal_two/db.py` (`_J2_SCHEMA`, after the `j2_broker_equity_snapshots` block ~line 443)
- Test: `tests/test_broker_cashflows.py`

**Interfaces:**
- Produces: table `j2_broker_cash_flows(id, user_id, account_id, broker_account_id, external_id, flow_date, flow_type, amount, is_external, currency, source, created_at)` + unique index on `(user_id, external_id)`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_broker_cashflows.py
from __future__ import annotations
import pytest
from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two import accounts as accounts_service


@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    acct = accounts_service.create_account(
        "u1", {"name": "Broker", "color": "blue", "startingBalance": 1.0}
    )
    return {"ba": {"id": "ba1", "j2AccountId": acct["id"]}, "acct_id": acct["id"]}


def test_cash_flows_table_exists(env):
    conn = auth_db.get_connection()
    try:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(j2_broker_cash_flows)")}
    finally:
        conn.close()
    assert {"id", "user_id", "account_id", "broker_account_id", "external_id",
            "flow_date", "flow_type", "amount", "is_external", "currency",
            "source", "created_at"} <= cols
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_broker_cashflows.py::test_cash_flows_table_exists -v`
Expected: FAIL (no such table / missing columns)

- [ ] **Step 3: Add the table to `_J2_SCHEMA`**

Insert into the `_J2_SCHEMA` string (after the `j2_broker_equity_snapshots` index line):

```sql
CREATE TABLE IF NOT EXISTS j2_broker_cash_flows (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL,
    account_id        TEXT NOT NULL,
    broker_account_id TEXT NOT NULL,
    external_id       TEXT NOT NULL,
    flow_date         TEXT NOT NULL,
    flow_type         TEXT NOT NULL,
    amount            REAL NOT NULL,
    is_external       INTEGER NOT NULL DEFAULT 0,
    currency          TEXT,
    source            TEXT NOT NULL DEFAULT 'broker',
    created_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_j2_cash_flows_ext
    ON j2_broker_cash_flows(user_id, external_id);
CREATE INDEX IF NOT EXISTS idx_j2_cash_flows_acct
    ON j2_broker_cash_flows(user_id, account_id, flow_date);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_broker_cashflows.py::test_cash_flows_table_exists -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/db.py tests/test_broker_cashflows.py
git commit -m "feat(broker): j2_broker_cash_flows ledger table"
```

### Task 2: Flow classification — map a SnapTrade cash activity → ledger row

**Files:**
- Create: `api/services/journal_two/broker/cashflow_reconstruct.py`
- Test: `tests/test_broker_cashflows.py`

**Interfaces:**
- Consumes: raw SnapTrade activity dicts (the `cash` + `transfers` buckets from `snaptrade_adapter.partition`).
- Produces: `to_cash_flow(act: dict, broker_account_id: str) -> dict | None` returning `{externalId, flowDate, flowType, amount, isExternal, currency}`. `flowType ∈ {deposit, withdrawal, dividend, interest, fee, transfer, other}`; `isExternal` is 1 for deposit/withdrawal/transfer, else 0. `amount` signed USD (+ into account, − out). Returns None for non-USD or unparseable.

- [ ] **Step 1: Write the failing test**

```python
from api.services.journal_two.broker import cashflow_reconstruct as cf

def _act(aid, typ, amount, date="2026-05-01", cur="USD"):
    return {"id": aid, "type": typ, "amount": amount, "trade_date": date, "currency": cur}

def test_classifies_external_and_internal_flows():
    dep = cf.to_cash_flow(_act("c1", "CONTRIBUTION", 5000), "ba1")
    assert dep["flowType"] == "deposit" and dep["isExternal"] == 1 and dep["amount"] == 5000.0
    wd = cf.to_cash_flow(_act("c2", "WITHDRAWAL", 2000), "ba1")
    assert wd["flowType"] == "withdrawal" and wd["isExternal"] == 1 and wd["amount"] == -2000.0
    div = cf.to_cash_flow(_act("c3", "DIVIDEND", 12.5), "ba1")
    assert div["flowType"] == "dividend" and div["isExternal"] == 0 and div["amount"] == 12.5
    fee = cf.to_cash_flow(_act("c4", "FEE", 1.0), "ba1")
    assert fee["flowType"] == "fee" and fee["isExternal"] == 0 and fee["amount"] == -1.0

def test_skips_non_usd():
    assert cf.to_cash_flow(_act("c5", "CONTRIBUTION", 100, cur="CAD"), "ba1") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_broker_cashflows.py -k classifies -v`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement the classifier**

```python
# api/services/journal_two/broker/cashflow_reconstruct.py
"""Capture SnapTrade cash-flow activities (deposits/withdrawals/dividends/
interest/fees) into j2_broker_cash_flows. External flows (deposit/withdrawal/
transfer) drive deposit-adjusted return; internal flows (dividend/interest/fee)
are income/cost already reflected in equity. Idempotent + corrections-healing,
mirroring reconstruct.py for trades."""
from __future__ import annotations
import hashlib
import logging
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two.broker import snaptrade_adapter as adapter

logger = logging.getLogger(__name__)

# SnapTrade activity type → (flow_type, is_external, sign). sign multiplies the
# reported (positive) amount: +1 money into the account, -1 money out.
_FLOW_MAP = {
    "CONTRIBUTION": ("deposit", 1, +1),
    "WITHDRAWAL": ("withdrawal", 1, -1),
    "DIVIDEND": ("dividend", 0, +1),
    "STOCK_DIVIDEND": ("dividend", 0, +1),
    "REI": ("dividend", 0, +1),
    "INTEREST": ("interest", 0, +1),   # credit interest +; margin interest is reported negative → stays negative
    "FEE": ("fee", 0, -1),
    "TRANSFER": ("transfer", 1, +1),   # sign follows the reported amount's own sign (see below)
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def to_cash_flow(act: dict, broker_account_id: str) -> dict | None:
    typ = str(act.get("type") or "").strip().upper()
    spec = _FLOW_MAP.get(typ)
    if spec is None:
        return None
    cur = adapter.extract_currency(act)
    if cur not in (None, "USD"):
        return None
    raw = adapter._num(act.get("amount"))
    if raw is None:
        return None
    flow_type, is_external, sign = spec
    # FEE/WITHDRAWAL: brokers usually report a positive magnitude → apply sign.
    # If the broker already signed it (e.g. margin interest as negative), respect
    # that sign and don't double-negate.
    amount = abs(raw) * sign if raw >= 0 else raw
    date = adapter.normalize_date(act) or _now_iso()
    flow_date = date[:10]
    ext = _fingerprint(broker_account_id, act, typ, raw, flow_date)
    return {
        "externalId": ext,
        "flowDate": flow_date,
        "flowType": flow_type,
        "amount": round(amount, 2),
        "isExternal": is_external,
        "currency": cur or "USD",
    }


def _fingerprint(broker_account_id: str, act: dict, typ: str, amount: float, flow_date: str) -> str:
    base = "|".join(str(x) for x in (
        broker_account_id, act.get("id") or "", typ, amount, flow_date,
    ))
    return "bkcf:" + hashlib.sha1(base.encode("utf-8")).hexdigest()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_broker_cashflows.py -k "classifies or non_usd" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/broker/cashflow_reconstruct.py tests/test_broker_cashflows.py
git commit -m "feat(broker): classify SnapTrade cash activities into flow rows"
```

### Task 3: Persist + idempotent re-sync + heal

**Files:**
- Modify: `api/services/journal_two/broker/cashflow_reconstruct.py` (add `reconcile_cash_flows`)
- Create: `api/services/journal_two/broker/cashflow_store.py`
- Test: `tests/test_broker_cashflows.py`

**Interfaces:**
- Produces: `reconcile_cash_flows(user_id, broker_account, cash_activities, conn=None) -> {imported, pruned}`. `broker_account` = `{"id": brokerAccountId, "j2AccountId": ...}`. Persists/updates rows, prunes broker rows whose `external_id` is no longer present (corrections-heal). Mirrors `reconstruct._prune_broker_trades`.
- Produces (store): `sum_flows(user_id, account_id, *, external_only, start, end, conn) -> float`, `list_flows(user_id, account_id, start, end, conn) -> list[dict]`, `external_flow_series(user_id, account_id, conn) -> list[(date, amount)]`.

- [ ] **Step 1: Write the failing test**

```python
def test_reconcile_imports_then_idempotent_and_heals(env):
    acts = [
        _act("c1", "CONTRIBUTION", 5000, "2026-05-01"),
        _act("c2", "DIVIDEND", 10, "2026-05-02"),
        _act("c3", "WITHDRAWAL", 1000, "2026-05-03"),
    ]
    r1 = cf.reconcile_cash_flows("u1", env["ba"], acts)
    assert r1["imported"] == 3
    # Re-sync same activities → zero new.
    r2 = cf.reconcile_cash_flows("u1", env["ba"], acts)
    assert r2["imported"] == 0 and r2["pruned"] == 0
    # c2 voided at broker (gone from feed) → pruned on next sync.
    r3 = cf.reconcile_cash_flows("u1", env["ba"], [acts[0], acts[2]])
    assert r3["pruned"] == 1

def test_store_external_only_sum(env):
    cf.reconcile_cash_flows("u1", env["ba"], [
        _act("c1", "CONTRIBUTION", 5000, "2026-05-01"),
        _act("c2", "DIVIDEND", 10, "2026-05-02"),
        _act("c3", "WITHDRAWAL", 1000, "2026-05-03"),
    ])
    from api.services.journal_two.broker import cashflow_store as store
    assert store.sum_flows("u1", env["acct_id"], external_only=True) == 4000.0   # 5000 - 1000
    assert store.sum_flows("u1", env["acct_id"], external_only=False) == 4010.0  # + dividend
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_broker_cashflows.py -k "reconcile or external_only" -v`
Expected: FAIL

- [ ] **Step 3: Implement `cashflow_store.py` and `reconcile_cash_flows`**

```python
# api/services/journal_two/broker/cashflow_store.py
from __future__ import annotations
import sqlite3
from typing import Any
from api.services.auth_db import get_connection


def _bounds(start: str | None, end: str | None) -> tuple[str, list]:
    sql, args = "", []
    if start:
        sql += " AND flow_date >= ?"; args.append(start)
    if end:
        sql += " AND flow_date <= ?"; args.append(end)
    return sql, args


def sum_flows(user_id, account_id, *, external_only=False, start=None, end=None,
              conn: sqlite3.Connection | None = None) -> float:
    owned = conn is None
    conn = conn or get_connection()
    try:
        clause, args = _bounds(start, end)
        ext = " AND is_external = 1" if external_only else ""
        row = conn.execute(
            f"SELECT COALESCE(SUM(amount), 0) AS s FROM j2_broker_cash_flows "
            f"WHERE user_id = ? AND account_id = ?{ext}{clause}",
            (user_id, account_id, *args),
        ).fetchone()
        return round(float(row["s"]), 2)
    finally:
        if owned:
            conn.close()


def list_flows(user_id, account_id, start=None, end=None,
               conn: sqlite3.Connection | None = None) -> list[dict]:
    owned = conn is None
    conn = conn or get_connection()
    try:
        clause, args = _bounds(start, end)
        rows = conn.execute(
            f"SELECT flow_date, flow_type, amount, is_external, currency "
            f"FROM j2_broker_cash_flows WHERE user_id = ? AND account_id = ?{clause} "
            f"ORDER BY flow_date ASC",
            (user_id, account_id, *args),
        ).fetchall()
        return [{"date": r["flow_date"], "type": r["flow_type"], "amount": r["amount"],
                 "isExternal": bool(r["is_external"]), "currency": r["currency"]} for r in rows]
    finally:
        if owned:
            conn.close()


def external_flow_series(user_id, account_id,
                         conn: sqlite3.Connection | None = None) -> list[tuple[str, float]]:
    """[(date, signed_amount), ...] of EXTERNAL flows only, date-ascending —
    the input the performance engine adjusts returns by."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT flow_date, SUM(amount) AS a FROM j2_broker_cash_flows "
            "WHERE user_id = ? AND account_id = ? AND is_external = 1 "
            "GROUP BY flow_date ORDER BY flow_date ASC",
            (user_id, account_id),
        ).fetchall()
        return [(r["flow_date"], round(float(r["a"]), 2)) for r in rows]
    finally:
        if owned:
            conn.close()
```

Add to `cashflow_reconstruct.py`:

```python
def reconcile_cash_flows(user_id: str, broker_account: dict,
                         cash_activities: list[dict],
                         conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    j2_account_id = broker_account["j2AccountId"]
    broker_account_id = broker_account["id"]
    owned = conn is None
    conn = conn or get_connection()
    imported = 0
    desired: set[str] = set()
    try:
        conn.execute("BEGIN")
        for act in (cash_activities or []):
            flow = to_cash_flow(act, broker_account_id)
            if flow is None:
                continue
            desired.add(flow["externalId"])
            exists = conn.execute(
                "SELECT 1 FROM j2_broker_cash_flows WHERE user_id = ? AND external_id = ?",
                (user_id, flow["externalId"]),
            ).fetchone()
            if exists:
                continue
            conn.execute(
                """INSERT INTO j2_broker_cash_flows
                   (id, user_id, account_id, broker_account_id, external_id, flow_date,
                    flow_type, amount, is_external, currency, source, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'broker', ?)""",
                (str(uuid.uuid4()), user_id, j2_account_id, broker_account_id,
                 flow["externalId"], flow["flowDate"], flow["flowType"], flow["amount"],
                 flow["isExternal"], flow["currency"], _now_iso()),
            )
            imported += 1
        # Corrections heal: prune broker rows for this account no longer present.
        rows = conn.execute(
            "SELECT id, external_id FROM j2_broker_cash_flows "
            "WHERE user_id = ? AND account_id = ? AND source = 'broker'",
            (user_id, j2_account_id),
        ).fetchall()
        stale = [r["id"] for r in rows if r["external_id"] not in desired]
        if stale:
            conn.executemany("DELETE FROM j2_broker_cash_flows WHERE id = ?",
                             [(i,) for i in stale])
        conn.commit()
        return {"imported": imported, "pruned": len(stale)}
    except Exception:
        conn.rollback()
        raise
    finally:
        if owned:
            conn.close()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_broker_cashflows.py -v`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/broker/cashflow_reconstruct.py api/services/journal_two/broker/cashflow_store.py tests/test_broker_cashflows.py
git commit -m "feat(broker): persist + idempotently heal cash-flow ledger"
```

### Task 4: Wire capture into sync

**Files:**
- Modify: `api/services/journal_two/broker/sync.py` (holdings/balances block, after `write_balances`)
- Test: `tests/test_broker_sync.py` (extend — assert a deposit activity lands in the ledger after a sync)

**Interfaces:**
- Consumes: `adapter.partition(all_acts)["cash"]` + `["transfers"]`; `cashflow_reconstruct.reconcile_cash_flows`.

- [ ] **Step 1: Write the failing test** — add a `CONTRIBUTION` activity to an existing sync test's activity list and assert `sum_flows(..., external_only=True)` reflects it after `run_sync`. (Follow the existing `test_broker_sync.py` harness; if it mocks SnapTrade, add the activity to the mocked `get_activities` return.)

- [ ] **Step 2: Run** the new assertion → FAIL (ledger empty; capture not wired).

- [ ] **Step 3: Wire it in.** In `sync.py`, inside the best-effort holdings block (right after the `write_balances(...)` call), add:

```python
            # Cash-flow ledger: deposits/withdrawals/dividends/interest/fees.
            # Best-effort — a hiccup must not fail the core sync.
            try:
                from api.services.journal_two.broker import cashflow_reconstruct as _cf
                part = adapter.partition(all_acts)
                _cf.reconcile_cash_flows(
                    user_id, ba, part["cash"] + part["transfers"]
                )
            except Exception:
                logger.exception("[broker] cash-flow capture failed (non-fatal)")
```

(`adapter` is already imported in `reconstruct`; import `snaptrade_adapter as adapter` at the top of `sync.py` if not present. `all_acts` is already in scope from the reconstruct call.)

- [ ] **Step 4: Run** → PASS. Then full broker suite: `python -m pytest tests/ -k broker -q`.

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/broker/sync.py tests/test_broker_sync.py
git commit -m "feat(broker): capture cash flows during sync (best-effort)"
```

---

## Phase 2 — Performance engine (pure)

### Task 5: TWR, simple, dollar P&L

**Files:**
- Create: `api/services/journal_two/broker/performance.py`
- Test: `tests/test_broker_performance.py`

**Interfaces:**
- Produces:
  - `time_weighted_return(equity: list[tuple[str, float]], external_flows: list[tuple[str, float]]) -> float | None` — `equity` = dated net-liq values ascending; `external_flows` = dated signed external amounts. Convention: a flow on date `d` is applied at the **start** of the sub-period beginning `d` (i.e. the sub-period return is `(V_d − F_d) / V_{prev}`). Returns None if < 2 equity points or any start value ≤ 0.
  - `simple_return(start_equity, end_equity, net_external) -> float | None`
  - `dollar_pnl(start_equity, end_equity, net_external) -> float`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_broker_performance.py
from api.services.journal_two.broker import performance as perf

def test_twr_zero_when_deposit_no_market_move():
    # Equity 10000 → deposit 5000 → 15000, no market move. TWR must be 0%.
    equity = [("2026-05-01", 10000.0), ("2026-05-02", 15000.0)]
    flows = [("2026-05-02", 5000.0)]
    assert abs(perf.time_weighted_return(equity, flows) - 0.0) < 1e-9

def test_twr_withdrawal_no_phantom_loss():
    equity = [("2026-05-01", 10000.0), ("2026-05-02", 8000.0)]
    flows = [("2026-05-02", -2000.0)]
    assert abs(perf.time_weighted_return(equity, flows) - 0.0) < 1e-9

def test_twr_chains_market_moves_across_a_deposit():
    # +10% then deposit then +10% → 1.1*1.1 - 1 = 21%.
    equity = [("2026-05-01", 10000.0), ("2026-05-02", 11000.0),
              ("2026-05-03", 17100.0)]  # 11000 + 5000 deposit = 16000, +6.875%? see flow
    flows = [("2026-05-03", 5000.0)]
    # sub1: 11000/10000 = 1.10 ; sub2: (17100 - 5000)/11000 = 1.10 → 1.21
    assert abs(perf.time_weighted_return(equity, flows) - 0.21) < 1e-9

def test_simple_and_dollar_pnl():
    assert perf.simple_return(10000, 13000, 2000) == pytest.approx(0.10)  # (13000-10000-2000)/10000
    assert perf.dollar_pnl(10000, 13000, 2000) == 1000.0
```
(add `import pytest` at top.)

- [ ] **Step 2: Run** → FAIL (module not found).

- [ ] **Step 3: Implement**

```python
# api/services/journal_two/broker/performance.py
"""Pure performance math: deposit/withdrawal-adjusted returns. No I/O.
External flows are the only adjustment — internal flows (div/interest/fee)
are already reflected in the equity series."""
from __future__ import annotations
from typing import Any


def _flows_by_date(external_flows: list[tuple[str, float]]) -> dict[str, float]:
    out: dict[str, float] = {}
    for d, a in external_flows:
        out[d] = out.get(d, 0.0) + a
    return out


def time_weighted_return(equity, external_flows) -> float | None:
    if not equity or len(equity) < 2:
        return None
    fbd = _flows_by_date(external_flows)
    growth = 1.0
    prev_val = equity[0][1]
    if prev_val <= 0:
        return None
    for d, v in equity[1:]:
        flow = fbd.get(d, 0.0)
        if prev_val <= 0:
            return None
        # Flow applied at start of this sub-period → strip it from end value.
        sub = (v - flow) / prev_val
        growth *= sub
        prev_val = v
    return growth - 1.0


def simple_return(start_equity, end_equity, net_external) -> float | None:
    if start_equity is None or start_equity <= 0:
        return None
    return (end_equity - start_equity - net_external) / start_equity


def dollar_pnl(start_equity, end_equity, net_external) -> float:
    return round(end_equity - start_equity - net_external, 2)
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/broker/performance.py tests/test_broker_performance.py
git commit -m "feat(broker): TWR + simple return + dollar P&L (pure)"
```

### Task 6: Money-weighted return (XIRR)

**Files:**
- Modify: `api/services/journal_two/broker/performance.py`
- Test: `tests/test_broker_performance.py`

**Interfaces:**
- Produces: `money_weighted_return(cash_flows: list[tuple[str, float]]) -> float | None`. `cash_flows` are dated signed amounts from the investor's perspective: the **start equity is a negative flow** (money in), external deposits are negative (more money in), withdrawals positive (money out), and the **end equity is a positive flow** (final value out). Returns annualized XIRR, or None if it can't bracket/converge.

- [ ] **Step 1: Write the failing test**

```python
def test_xirr_simple_doubling_one_year():
    # -1000 today, +2000 in 365 days → 100% annual.
    flows = [("2026-01-01", -1000.0), ("2027-01-01", 2000.0)]
    assert perf.money_weighted_return(flows) == pytest.approx(1.0, abs=1e-3)

def test_xirr_none_on_degenerate():
    assert perf.money_weighted_return([("2026-01-01", -1000.0)]) is None
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** (bisection on NPV; day-count via `datetime`):

```python
from datetime import date as _date

def _to_date(s: str) -> _date:
    return _date.fromisoformat(s[:10])

def _npv(rate: float, flows: list[tuple[_date, float]], t0: _date) -> float:
    total = 0.0
    for d, amt in flows:
        yrs = (d - t0).days / 365.0
        total += amt / ((1.0 + rate) ** yrs)
    return total

def money_weighted_return(cash_flows) -> float | None:
    if not cash_flows or len(cash_flows) < 2:
        return None
    flows = sorted(((_to_date(d), a) for d, a in cash_flows), key=lambda x: x[0])
    if not (any(a < 0 for _, a in flows) and any(a > 0 for _, a in flows)):
        return None
    t0 = flows[0][0]
    lo, hi = -0.9999, 100.0
    f_lo, f_hi = _npv(lo, flows, t0), _npv(hi, flows, t0)
    if f_lo * f_hi > 0:
        return None  # can't bracket a root
    for _ in range(200):
        mid = (lo + hi) / 2.0
        f_mid = _npv(mid, flows, t0)
        if abs(f_mid) < 1e-7:
            return round(mid, 6)
        if f_lo * f_mid < 0:
            hi, f_hi = mid, f_mid
        else:
            lo, f_lo = mid, f_mid
    return round((lo + hi) / 2.0, 6)
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/broker/performance.py tests/test_broker_performance.py
git commit -m "feat(broker): money-weighted return (XIRR) via bisection"
```

### Task 7: `compute_performance` aggregator

**Files:**
- Modify: `api/services/journal_two/broker/performance.py`
- Test: `tests/test_broker_performance.py`

**Interfaces:**
- Produces: `compute_performance(equity, external_flows, internal_summary) -> dict` with keys `timeWeighted`, `moneyWeighted`, `simple`, `dollarPnl`, `netDeposits`, `netWithdrawals`, `dividends`, `interest`, `fees`, `startEquity`, `endEquity`. `internal_summary` = `{"dividends": x, "interest": y, "fees": z}`. Builds the XIRR flow list as: start = `(equity[0].date, -startEquity)`, each external flow negated (deposit −, withdrawal +), end = `(equity[-1].date, +endEquity)`.

- [ ] **Step 1: Write the failing test**

```python
def test_compute_performance_assembles_all():
    equity = [("2026-05-01", 10000.0), ("2026-05-02", 15000.0)]
    flows = [("2026-05-02", 5000.0)]
    out = perf.compute_performance(equity, flows,
                                   {"dividends": 10.0, "interest": -2.0, "fees": -1.0})
    assert out["timeWeighted"] == pytest.approx(0.0)
    assert out["netDeposits"] == 5000.0 and out["netWithdrawals"] == 0.0
    assert out["dollarPnl"] == 0.0
    assert out["startEquity"] == 10000.0 and out["endEquity"] == 15000.0
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```python
def compute_performance(equity, external_flows, internal_summary) -> dict:
    if not equity:
        return {k: None for k in ("timeWeighted", "moneyWeighted", "simple", "dollarPnl")} | {
            "netDeposits": 0.0, "netWithdrawals": 0.0, "dividends": 0.0,
            "interest": 0.0, "fees": 0.0, "startEquity": None, "endEquity": None}
    start_v, end_v = equity[0][1], equity[-1][1]
    net_ext = round(sum(a for _, a in external_flows), 2)
    net_dep = round(sum(a for _, a in external_flows if a > 0), 2)
    net_wd = round(sum(a for _, a in external_flows if a < 0), 2)
    xirr_flows = [(equity[0][0], -start_v)] + [(d, -a) for d, a in external_flows] + [(equity[-1][0], end_v)]
    return {
        "timeWeighted": time_weighted_return(equity, external_flows),
        "moneyWeighted": money_weighted_return(xirr_flows),
        "simple": simple_return(start_v, end_v, net_ext),
        "dollarPnl": dollar_pnl(start_v, end_v, net_ext),
        "netDeposits": net_dep,
        "netWithdrawals": net_wd,
        "dividends": round(internal_summary.get("dividends", 0.0), 2),
        "interest": round(internal_summary.get("interest", 0.0), 2),
        "fees": round(internal_summary.get("fees", 0.0), 2),
        "startEquity": round(start_v, 2),
        "endEquity": round(end_v, 2),
    }
```

- [ ] **Step 4: Run** → PASS (`python -m pytest tests/test_broker_performance.py -v`).

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/broker/performance.py tests/test_broker_performance.py
git commit -m "feat(broker): compute_performance aggregator (all metrics)"
```

---

## Phase 3 — Series assembly + endpoints

### Task 8: Series-assembly service

**Files:**
- Create: `api/services/journal_two/broker/performance_service.py`
- Test: `tests/test_broker_performance_service.py`

**Interfaces:**
- Consumes: `j2_broker_equity_snapshots` (forward), `cashflow_store` (flows), `j2_trades` (realized P&L for estimated history), the account's `broker_account_id` (resolve from `j2_broker_accounts` by `account_id`).
- Produces: `account_performance(user_id, account_id, period, conn=None) -> dict` = `compute_performance(...)` output + `equitySeries: [{date, value, estimated}]` + `flows: [...]` (from `cashflow_store.list_flows`) + `estimated: bool`. `period ∈ {1W,1M,3M,YTD,1Y,ALL}`.
  - **Forward equity** = snapshot rows in window. **Estimated history**: if the window starts before the earliest snapshot, prepend estimated points walking back from the earliest snapshot: `equity_est(t) = first_snap − externalFlowsAfter(t) − realizedPnlAfter(t)`, one point per flow/trade date, each `estimated: true`.
  - `internal_summary` = `cashflow_store` sums by type over the window (dividends, interest, fees).

- [ ] **Step 1: Write the failing test** — seed two snapshots + a deposit between them; assert `account_performance("u1", acct, "ALL")["timeWeighted"]` matches the hand-computed TWR and `equitySeries` has the snapshot points with `estimated=False`. (Use the `env` fixture; insert snapshot rows directly + `reconcile_cash_flows` for the deposit.)

- [ ] **Step 2: Run** → FAIL (module not found).

- [ ] **Step 3: Implement** `performance_service.py`: resolve `broker_account_id`; `_period_start(period)` → ISO date; pull snapshots (`SELECT snapshot_date, total_equity FROM j2_broker_equity_snapshots WHERE user_id=? AND broker_account_id=? AND snapshot_date>=? ORDER BY snapshot_date`); build estimated prefix from `cashflow_store.external_flow_series` + realized-P&L-by-date (`SELECT exit_date, SUM(pnl_dollar) FROM j2_trades WHERE account_id=? GROUP BY exit_date`); assemble `equity` list; `external = cashflow_store.external_flow_series` clipped to window; `internal_summary` from `list_flows`; call `compute_performance`; attach `equitySeries`, `flows`, `estimated`.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/broker/performance_service.py tests/test_broker_performance_service.py
git commit -m "feat(broker): assemble equity+flow series (fwd snapshots + est history)"
```

### Task 9: Endpoints

**Files:**
- Modify: `api/routers/broker_sync.py` (add two routes near `equity_curve`)
- Test: `tests/test_broker_router.py` (extend)

**Interfaces:**
- Produces: `GET /api/j2/broker/performance?accountId=&period=` → `performance_service.account_performance(...)`. `GET /api/j2/broker/cash-flows?accountId=&period=` → `{flows: cashflow_store.list_flows(...)}`. Both `Depends(get_current_user)`, account-ownership-checked like the existing routes.

- [ ] **Step 1: Write the failing test** — authed GET `/api/j2/broker/performance?accountId=<acct>&period=ALL` after seeding snapshots+flows → 200 with `timeWeighted`/`equitySeries` keys; cross-user account → 404/403 per existing convention.

- [ ] **Step 2: Run** → FAIL (404, route missing).

- [ ] **Step 3: Implement** both routes following the `equity_curve` handler's auth + account-ownership pattern (verbatim guard, then delegate to the service).

- [ ] **Step 4: Run** → PASS. Then `grep -c broker_sync api/main.py` (must be ≥7 — routes are in the already-mounted router, no main.py change, but confirm).

- [ ] **Step 5: Commit**

```bash
git add api/routers/broker_sync.py tests/test_broker_router.py
git commit -m "feat(broker): /performance + /cash-flows endpoints"
```

---

## Phase 4 — Surfaces

### Task 10: Account return wiring (backend)

**Files:**
- Modify: `api/services/journal_two/accounts.py` (`comparison()` — broker accounts source `totalReturn` from the engine)
- Test: `tests/test_broker_balances.py` or `test_broker_performance_service.py`

**Interfaces:**
- For broker accounts (`balanceSource == 'broker'`), `comparison()` sets `totalReturn` = `performance_service.account_performance(user_id, id, "ALL")["timeWeighted"]` (fallback to existing realized math if None). Manual accounts unchanged.

- [ ] **Step 1: Write the failing test** — broker account with a mid-period deposit + flat market → `comparison()` row `totalReturn ≈ 0`, NOT inflated by the deposit.
- [ ] **Step 2: Run** → FAIL (naive math inflates it).
- [ ] **Step 3: Implement** the branch in `comparison()`.
- [ ] **Step 4: Run** → PASS + full broker suite.
- [ ] **Step 5: Commit** `feat(broker): account return uses cash-flow-adjusted TWR`.

### Task 11: Frontend — performance hook + panel

**Files:**
- Create: `app/src/pages/journal-2-0/hooks/useJ2BrokerPerformance.js`
- Create: `app/src/pages/journal-2-0/components/PerformancePanel.jsx`
- Modify: `app/src/pages/journal-2-0/tabs/AnalyticsTab.jsx` (mount for broker accounts)
- Test: `app/src/pages/journal-2-0/components/PerformancePanel.test.jsx`

> **Shared-worktree note:** AnalyticsTab is lower-traffic than OpenPositionsTab but still shared — re-read immediately before editing, stage only these files. Do NOT edit OpenPositionsTab here; equity-curve markers there are a coordinated follow-up.

**Interfaces:**
- `useJ2BrokerPerformance(accountId, period)` → SWR GET `/api/j2/broker/performance` (mirror `useJ2AccountComparison` fetcher style).
- `PerformancePanel({ accountId })`: metric selector (TWR · Money-Weighted · Simple · $ P&L, persisted via `usePreferences('j2_perf_metric')`, default `twr`), summary line (selected metric + $ P&L + net deposits/withdrawals + dividends/interest/fees), ECharts equity curve from `equitySeries` with `▲`/`▼` markPoints at external-flow dates (from `flows`), estimated points rendered dashed. A transactions table from `flows`.

- [ ] **Step 1: Write the failing test** — render `PerformancePanel` with a mocked hook payload (TWR 0.21, deposit flow); assert it shows "21%" and a deposit row. (Vitest + RTL, mock the hook.)
- [ ] **Step 2: Run** `cd app && npx vitest run PerformancePanel` → FAIL (component missing).
- [ ] **Step 3: Implement** the hook + panel (follow `AnalyticsTab`/`ComparisonGrid` styling + ECharts usage already in the tab).
- [ ] **Step 4: Run** vitest → PASS, then `cd app && npm run build`.
- [ ] **Step 5: Commit** `feat(broker): performance panel (metric selector + curve + tx list)`.

### Task 12: Margin display

**Files:**
- Modify: `PerformancePanel.jsx` (or the account summary) — show **Buying Power** + **Margin Used** (`= -cash` when `cash < 0`, else 0) from `account.brokerBuyingPower` / `account.brokerCash`.
- Test: extend `PerformancePanel.test.jsx`.

- [ ] **Step 1:** Failing test — negative `brokerCash` → "Margin Used $X" shown.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement (pure display from existing account fields; no backend change).
- [ ] **Step 4:** Run vitest + build → PASS.
- [ ] **Step 5:** Commit `feat(broker): surface buying power + margin used`.

---

## Self-Review

**Spec coverage:** ledger (T1–T4) ✓; external/internal rule (T2 `_FLOW_MAP`/`isExternal`) ✓; TWR/MWR/simple/$PnL (T5–T7) ✓; forward+estimated series (T8) ✓; endpoints (T9) ✓; account-return wiring (T10) ✓; Analytics surfaces + metric selector + tx list + flow markers (T11) ✓; margin display (T12) ✓; idempotent/heal (T3) ✓; USD-only (T2) ✓; best-effort sync (T4) ✓. Manual accounts explicitly deferred (spec) — no task, correct.

**Placeholder scan:** Backend tasks carry complete code. T8/T11/T12 describe implementation against fully-specified interfaces + existing patterns (acceptable: they extend established modules — `equity_curve` handler, `useJ2AccountComparison`, AnalyticsTab ECharts — rather than introduce new shapes). No "TODO/handle edge cases".

**Type consistency:** `to_cash_flow` keys (externalId/flowDate/flowType/amount/isExternal/currency) consumed verbatim in `reconcile_cash_flows`. `external_flow_series`/`sum_flows`/`list_flows` signatures consumed in T8. `compute_performance` output keys consumed in T9/T10/T11. `time_weighted_return`/`money_weighted_return` flow conventions consistent T5↔T6↔T7. ✓

**Coordination:** backend (T1–T10) collision-free; only T11/T12 touch frontend (AnalyticsTab, not OpenPositionsTab) — coordinated, equity-curve markers in OpenPositionsTab left as a deliberate follow-up.
