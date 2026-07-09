# Journal A+ — P1a Truth Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the dark foundations of the Journal A+ overhaul: an ET trading-day spine on `j2_trades`/`j2_option_strategies`, a batched admin backfill with a day-moved diff, conversion of the four ±1-day-buffer bucketing sites, a JS↔Python math parity harness, annotation-identity helpers, an attachments R2 backup job, the FilterSpec backend with pagination, a J2 telemetry endpoint, and the playbook.py purge.

**Architecture:** All schema changes are additive via `_PHASE_2_ALTERS` in `api/services/journal_two/db.py`. New pure helpers live in new modules (`timeutil.py`, `filters.py`, `trade_refs.py`); existing bucketing call-sites convert to read the stored column with a NULL-row fallback so the code is correct before AND after the backfill runs. Nothing in this plan changes any user-visible surface — P1a ships dark and is verified by tests + the backfill diff.

**Tech Stack:** FastAPI + SQLite (auth.db, WAL) · React/Vite (vitest) · pytest (colocated in `api/services/journal_two/`) · APScheduler (web process, scheduler_lock) · boto3→Cloudflare R2.

## Global Constraints

- Work ONLY in an isolated worktree off `origin/master` (create via superpowers:using-git-worktrees). NEVER touch `C:\Users\Patrick\uct-dashboard` root (may host a live parallel session). Never `git add -A`. Ship via `git push origin <branch>:master`.
- Before EVERY push: `grep -c broker_sync api/main.py` must be ≥ 7.
- Web deploys ship ≥4:20 PM ET or <9:15 AM ET only.
- New j2 columns: append `ALTER TABLE` strings to `_PHASE_2_ALTERS` (db.py:520-633) — never edit `_J2_SCHEMA` for existing tables; columns must be nullable or carry a DEFAULT.
- Broker-mirror law: never mutate imported trade rows' broker-owned facts; annotations live in side tables/columns.
- `pnl_percent` is stored as a FRACTION, not a percent (locked rule). `net_entry` positive = debit. Blank stop is stored as `original_stop == entry_price` (deliberate §14.5 sentinel; r_multiple NULL) — do not change storage semantics in this plan.
- Backend tests colocated: `api/services/journal_two/test_*.py`, run `python -m pytest api/services/journal_two/ -q`. FE tests colocated, run `cd app && npx vitest run <file>`.
- Backfill and any heavy work must NOT run at import/boot time (auth.db serves logins; boot-blocking is a known incident class). Admin endpoints: `Depends(require_admin)` from `api/middleware/auth_middleware.py:50`.
- R2 clients on the web side MUST set `Config(request_checksum_calculation="when_required", response_checksum_validation="when_required")` (R2 rejects modern boto3 checksums) — copy `api/flow_backup.py:_r2_client`.

---

### Task 1: `timeutil.py` — trading-day + hour helpers

**Files:**
- Create: `api/services/journal_two/timeutil.py`
- Test: `api/services/journal_two/test_timeutil.py`

**Interfaces:**
- Produces: `ET`, `UTC` constants; `compute_trading_day_et(iso: str | None) -> str | None`; `compute_hour_et(iso: str | None) -> int | None`. Later tasks (2, 3, 4) import these.

**Semantics (the load-bearing decision):** stored dates are heterogeneous — full UTC ISO (close/manual paths), bare `YYYY-MM-DD` (some CSV rows), adapter ISO (broker). Manual/CSV date-only entries were normalized to `T00:00:00Z` (UTC midnight), which `to_et_date` shifts to the PREVIOUS ET day (8 PM ET) — a live off-by-one for date-only trades. Rules:
- blank/None → `(None, None)`.
- bare date (no `T`) → trading_day = the literal date, hour = None.
- timestamp at exactly `00:00:00` UTC → date-only intent: trading_day = the literal UTC date (user's typed day, FIXES the off-by-one), hour = None.
- anything else → `astimezone(ET)`: trading_day = ET date, hour = ET hour.

- [ ] **Step 1: Write the failing test**

```python
# api/services/journal_two/test_timeutil.py
"""trading_day_et / hour_et semantics — the ET spine's contract."""
from api.services.journal_two.timeutil import compute_trading_day_et, compute_hour_et


def test_blank_and_none():
    assert compute_trading_day_et(None) is None
    assert compute_trading_day_et("") is None
    assert compute_hour_et(None) is None


def test_bare_date_passes_through_verbatim():
    assert compute_trading_day_et("2026-04-19") == "2026-04-19"
    assert compute_hour_et("2026-04-19") is None


def test_utc_midnight_means_date_only_intent():
    # Manual/CSV date-only entries are stored as T00:00:00Z; the user meant
    # THAT calendar day, not 8 PM ET the night before.
    assert compute_trading_day_et("2026-04-19T00:00:00Z") == "2026-04-19"
    assert compute_trading_day_et("2026-04-19T00:00:00+00:00") == "2026-04-19"
    assert compute_hour_et("2026-04-19T00:00:00Z") is None


def test_real_timestamps_bucket_in_et():
    # 14:30Z = 10:30 ET same day
    assert compute_trading_day_et("2026-04-19T14:30:00Z") == "2026-04-19"
    assert compute_hour_et("2026-04-19T14:30:00Z") == 10
    # After-hours 23:00Z = 19:00 ET same day
    assert compute_trading_day_et("2026-04-19T23:00:00Z") == "2026-04-19"
    # Overnight 01:00Z = 21:00 ET PREVIOUS day (matches to_et_date semantics)
    assert compute_trading_day_et("2026-04-20T01:00:00Z") == "2026-04-19"
    # Past midnight ET rolls forward (EDT boundary = 04:00Z)
    assert compute_trading_day_et("2026-04-20T05:00:00Z") == "2026-04-20"


def test_naive_timestamp_treated_as_utc():
    assert compute_trading_day_et("2026-04-19T14:30:00") == "2026-04-19"
    assert compute_hour_et("2026-04-19T14:30:00") == 10


def test_unparseable_returns_none():
    assert compute_trading_day_et("garbage") is None
    assert compute_hour_et("garbage") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest api/services/journal_two/test_timeutil.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'api.services.journal_two.timeutil'`

- [ ] **Step 3: Write minimal implementation**

```python
# api/services/journal_two/timeutil.py
"""ET trading-day spine helpers.

Single source of truth for bucketing a stored j2 timestamp onto its ET
trading day and ET hour. Heterogeneous input forms (full UTC ISO, bare
date, naive ISO) are all handled; date-only intent (bare date or exact
UTC midnight) buckets to the literal typed day with a NULL hour.
"""
from __future__ import annotations

from datetime import datetime, timezone

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover - py3.8 fallback, matches calendar.py
    from backports.zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
UTC = timezone.utc


def _parse(iso: str | None) -> datetime | None:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


def _is_date_only(iso: str, dt: datetime) -> bool:
    if "T" not in str(iso):
        return True
    # Date-only manual/CSV entries are normalized to exact UTC midnight.
    utc_dt = dt.astimezone(UTC)
    return utc_dt.hour == 0 and utc_dt.minute == 0 and utc_dt.second == 0


def compute_trading_day_et(iso: str | None) -> str | None:
    if iso and "T" not in str(iso):
        s = str(iso).strip()
        try:
            datetime.fromisoformat(s)  # validate bare date
        except (ValueError, TypeError):
            return None
        return s
    dt = _parse(iso)
    if dt is None:
        return None
    if _is_date_only(iso, dt):
        return dt.astimezone(UTC).strftime("%Y-%m-%d")
    return dt.astimezone(ET).strftime("%Y-%m-%d")


def compute_hour_et(iso: str | None) -> int | None:
    dt = _parse(iso)
    if dt is None or _is_date_only(iso, dt):
        return None
    return dt.astimezone(ET).hour
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest api/services/journal_two/test_timeutil.py -q`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/timeutil.py api/services/journal_two/test_timeutil.py
git commit -m "feat(j2): ET trading-day spine helpers (timeutil)"
```

---

### Task 2: Schema columns + stamping every write path

**Files:**
- Modify: `api/services/journal_two/db.py` (append to `_PHASE_2_ALTERS`, ~line 633)
- Modify: `api/services/journal_two/trades.py` (close_position INSERT :166-204, create_trade_manual INSERT :415-453, bulk_insert_trades INSERT :665-705)
- Modify: `api/services/journal_two/options.py` (close_strategy / mark_expired write paths — wherever `closed_at` is written)
- Test: `api/services/journal_two/test_trading_day_stamping.py`

**Interfaces:**
- Consumes: `compute_trading_day_et`, `compute_hour_et` from Task 1.
- Produces: columns `j2_trades.trading_day_et TEXT`, `j2_trades.hour_et INTEGER`, `j2_option_strategies.trading_day_et TEXT`; every INSERT stamps them from exit_date/closed_at. Tasks 3-4 and P2/P3 rely on these columns.

- [ ] **Step 1: Append ALTERs to `_PHASE_2_ALTERS`** (follow db.py:597 pattern exactly)

```python
    # Journal A+ P1a — ET trading-day spine (2026-07-09 spec §3)
    "ALTER TABLE j2_trades ADD COLUMN trading_day_et TEXT",
    "ALTER TABLE j2_trades ADD COLUMN hour_et INTEGER",
    "ALTER TABLE j2_option_strategies ADD COLUMN trading_day_et TEXT",
    "CREATE INDEX IF NOT EXISTS idx_j2_trades_tday ON j2_trades(user_id, trading_day_et)",
    "CREATE INDEX IF NOT EXISTS idx_j2_opts_tday ON j2_option_strategies(user_id, trading_day_et)",
```

- [ ] **Step 2: Write the failing test**

```python
# api/services/journal_two/test_trading_day_stamping.py
"""Every j2_trades/option write path stamps trading_day_et (+hour_et)."""
import sqlite3
from api.services.journal_two import db as j2db
from api.services.journal_two import trades as trades_service


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    j2db.ensure_schema(conn)
    return conn


SETTINGS = {"breakevenRange": {"enabled": False, "unit": "$", "value": 0}}


def test_manual_create_stamps_date_only_verbatim():
    conn = _conn()
    trades_service.create_trade_manual(
        "u1",
        {"symbol": "NVDA", "side": "Long", "shares": 10, "entryPrice": 100,
         "entryDate": "2026-04-19", "exitPrice": 110, "exitDate": "2026-04-19"},
        SETTINGS, conn=conn,
    )
    row = conn.execute("SELECT trading_day_et, hour_et FROM j2_trades").fetchone()
    assert row["trading_day_et"] == "2026-04-19"   # NOT 2026-04-18
    assert row["hour_et"] is None


def test_bulk_insert_stamps_real_timestamps_in_et():
    conn = _conn()
    trades_service.bulk_insert_trades(
        "u1",
        [{"symbol": "TSLA", "side": "Long", "shares": 5, "entryPrice": 200,
          "entryDate": "2026-04-19T13:00:00Z", "exitPrice": 210,
          "exitDate": "2026-04-20T01:00:00Z",  # 21:00 ET on the 19th
          "originalStop": 195, "setup": None, "notes": None,
          "externalId": "bk:test1"}],
        SETTINGS, conn=conn, account_id="a1", source="broker",
    )
    row = conn.execute("SELECT trading_day_et, hour_et FROM j2_trades").fetchone()
    assert row["trading_day_et"] == "2026-04-19"
    assert row["hour_et"] == 21
```

- [ ] **Step 3: Run test to verify it fails**

Run: `python -m pytest api/services/journal_two/test_trading_day_stamping.py -q`
Expected: FAIL — `trading_day_et` is NULL (columns exist from Step 1's ALTER, but no write path stamps them)

- [ ] **Step 4: Stamp all write paths**

In `trades.py` add the import at the top: `from api.services.journal_two.timeutil import compute_trading_day_et, compute_hour_et`.

In each of the three INSERT statements (close_position :166-204, create_trade_manual :415-453, bulk_insert_trades :665-705), add the two columns to the column list and pass values computed from the row's **exit_date** (the analytics/calendar bucketing basis):

```python
            trading_day_et = compute_trading_day_et(exit_date_iso)
            hour_et = compute_hour_et(exit_date_iso)
```

(`exit_date_iso` = whatever local variable that INSERT already binds for exit_date; in `bulk_insert_trades` it is `pt.get("exitDate")` at trades.py:686.)

In `options.py`, wherever `closed_at` is written on close/expire (close_strategy and mark_expired/mark_expired_batch), stamp `trading_day_et = compute_trading_day_et(closed_at)` into the same UPDATE/INSERT. The ET-noon anchor for date-only closes (options.py:643) already lands on the typed day — `compute_trading_day_et` on a noon-ET timestamp returns the same day, so no special-casing.

- [ ] **Step 5: Run tests**

Run: `python -m pytest api/services/journal_two/test_trading_day_stamping.py api/services/journal_two/test_options.py api/services/journal_two/test_calculations.py -q`
Expected: PASS. (test_options.py has known time-brittle fixtures with hardcoded past expirations — pre-existing failures there are NOT yours; compare against a pre-change run.)

- [ ] **Step 6: Commit**

```bash
git add api/services/journal_two/db.py api/services/journal_two/trades.py api/services/journal_two/options.py api/services/journal_two/test_trading_day_stamping.py
git commit -m "feat(j2): stamp trading_day_et/hour_et on every trade+option write path"
```

---

### Task 3: Admin backfill endpoint with day-moved diff

**Files:**
- Create: `api/services/journal_two/trading_day_backfill.py`
- Modify: `api/routers/journal_two.py` (add admin route; import `require_admin` from `api.middleware.auth_middleware`)
- Test: `api/services/journal_two/test_trading_day_backfill.py`

**Interfaces:**
- Consumes: Task 1 helpers, Task 2 columns.
- Produces: `run_backfill(conn=None, *, batch_size=500, force=False) -> dict` returning `{"trades_updated": int, "options_updated": int, "moved_days": [{"user_id","trade_id","symbol","old_day","new_day"}], "batches": int}`; route `POST /api/j2/admin/trading-day-backfill` (admin-only). "moved_days" compares the NEW trading_day_et against `to_et_date(exit_date)` (what the calendar showed before) — this IS the user-facing change-note data.

- [ ] **Step 1: Write the failing test**

```python
# api/services/journal_two/test_trading_day_backfill.py
import sqlite3
from api.services.journal_two import db as j2db
from api.services.journal_two.trading_day_backfill import run_backfill


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    j2db.ensure_schema(conn)
    return conn


def _insert_legacy_trade(conn, trade_id, exit_date):
    # Simulates a pre-spine row: trading_day_et NULL.
    conn.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares,"
        " entry_price, entry_date, exit_price, exit_date, original_stop, created_at)"
        " VALUES (?, 'u1', 'p1', 'NVDA', 'Long', 10, 100, ?, 110, ?, 95, '2026-01-01')",
        (trade_id, exit_date, exit_date),
    )


def test_backfill_fills_nulls_and_reports_moved_days():
    conn = _conn()
    _insert_legacy_trade(conn, "t1", "2026-04-19T00:00:00Z")   # date-only: moves 04-18 -> 04-19
    _insert_legacy_trade(conn, "t2", "2026-04-19T14:30:00Z")   # real ts: stays 04-19
    result = run_backfill(conn=conn)
    assert result["trades_updated"] == 2
    days = dict(conn.execute("SELECT id, trading_day_et FROM j2_trades").fetchall())
    assert days == {"t1": "2026-04-19", "t2": "2026-04-19"}
    moved = result["moved_days"]
    assert len(moved) == 1 and moved[0]["trade_id"] == "t1"
    assert moved[0]["old_day"] == "2026-04-18" and moved[0]["new_day"] == "2026-04-19"


def test_backfill_is_idempotent():
    conn = _conn()
    _insert_legacy_trade(conn, "t1", "2026-04-19T14:30:00Z")
    run_backfill(conn=conn)
    second = run_backfill(conn=conn)
    assert second["trades_updated"] == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest api/services/journal_two/test_trading_day_backfill.py -q`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```python
# api/services/journal_two/trading_day_backfill.py
"""One-shot, idempotent, batched backfill of trading_day_et/hour_et.

Runs ONLY via the admin endpoint — never at import or boot (auth.db also
serves logins). Batched commits keep writer locks short under WAL.
"""
from __future__ import annotations

import sqlite3
from api.services.auth_db import get_connection
from api.services.journal_two.calendar import to_et_date
from api.services.journal_two.timeutil import compute_trading_day_et, compute_hour_et


def run_backfill(conn: sqlite3.Connection | None = None, *,
                 batch_size: int = 500, force: bool = False) -> dict:
    own = conn is None
    if own:
        conn = get_connection()
    try:
        null_only = "" if force else " AND trading_day_et IS NULL"
        rows = conn.execute(
            "SELECT id, user_id, symbol, exit_date FROM j2_trades"
            f" WHERE exit_date IS NOT NULL{null_only}"
        ).fetchall()

        moved: list[dict] = []
        trades_updated = batches = 0
        for start in range(0, len(rows), batch_size):
            for r in rows[start:start + batch_size]:
                new_day = compute_trading_day_et(r["exit_date"])
                new_hour = compute_hour_et(r["exit_date"])
                try:
                    old_day = to_et_date(r["exit_date"])
                except ValueError:
                    old_day = None
                if new_day and old_day and new_day != old_day:
                    moved.append({"user_id": r["user_id"], "trade_id": r["id"],
                                  "symbol": r["symbol"], "old_day": old_day,
                                  "new_day": new_day})
                conn.execute(
                    "UPDATE j2_trades SET trading_day_et = ?, hour_et = ? WHERE id = ?",
                    (new_day, new_hour, r["id"]),
                )
                trades_updated += 1
            batches += 1
            conn.commit()  # short writer locks — auth.db also serves logins

        opt_rows = conn.execute(
            "SELECT id, closed_at FROM j2_option_strategies"
            f" WHERE closed_at IS NOT NULL{null_only}"
        ).fetchall()
        for r in opt_rows:
            conn.execute(
                "UPDATE j2_option_strategies SET trading_day_et = ? WHERE id = ?",
                (compute_trading_day_et(r["closed_at"]), r["id"]),
            )
        conn.commit()
        return {"trades_updated": trades_updated, "options_updated": len(opt_rows),
                "moved_days": moved[:2000], "batches": batches}
    finally:
        if own:
            conn.close()
```

Route, added to `api/routers/journal_two.py` near the other imports (`from api.middleware.auth_middleware import get_current_user` already exists — extend it):

```python
from api.middleware.auth_middleware import get_current_user, require_admin
from api.services.journal_two import trading_day_backfill


@router.post("/admin/trading-day-backfill")
def trading_day_backfill_route(force: bool = False, user: dict = Depends(require_admin)):
    """Admin-only. Batched, idempotent. Run OFF-HOURS (writer locks auth.db)."""
    return trading_day_backfill.run_backfill(force=force)
```

- [ ] **Step 4: Run tests**

Run: `python -m pytest api/services/journal_two/test_trading_day_backfill.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/trading_day_backfill.py api/services/journal_two/test_trading_day_backfill.py api/routers/journal_two.py
git commit -m "feat(j2): admin trading-day backfill with day-moved diff"
```

---

### Task 4: Convert the four buffer sites to the spine

**Files:**
- Modify: `api/services/journal_two/analytics.py` (`_fetch_trades` :99-141, `_fetch_option_strategies` :614-637, hour bucket :286-292)
- Modify: `api/services/journal_two/calendar.py` (`get_calendar` :514-551, `get_day_detail` :636-676)
- Test: extend `api/services/journal_two/test_analytics.py` + `test_calendar.py`

**Interfaces:**
- Consumes: Task 2 columns; `to_et_date` stays as NULL-row fallback.
- Produces: bucketing reads `trading_day_et` when present. Hour report reads `hour_et`, **excluding NULL** (behavior change: date-only trades vanish from the hour histogram — they were fake-midnight/8PM clusters).

- [ ] **Step 1: Write the failing tests** (append to existing files; reuse each file's `db_conn` fixture + `_add_trade` builder, extending `_add_trade` to also accept and stamp `trading_day_et`/`hour_et`)

```python
# append to api/services/journal_two/test_analytics.py
def test_spine_column_wins_over_utc_refilter(db_conn):
    # Row whose UTC date and spine day differ: spine must decide membership.
    _add_trade(db_conn, "u1", exit_date_iso="2026-04-19T00:00:00Z", pnl=100)
    db_conn.execute("UPDATE j2_trades SET trading_day_et='2026-04-19', hour_et=NULL")
    db_conn.commit()
    out = get_analytics("u1", date_from="2026-04-19", date_to="2026-04-19", conn=db_conn)
    assert out["performance"]["byDay"]  # trade included on the 19th (old code put it on the 18th)


def test_hour_report_excludes_null_hours(db_conn):
    _add_trade(db_conn, "u1", exit_date_iso="2026-04-19T14:30:00Z", pnl=100)
    _add_trade(db_conn, "u1", exit_date_iso="2026-04-20T00:00:00Z", pnl=50)  # date-only
    db_conn.execute("UPDATE j2_trades SET trading_day_et = substr(exit_date,1,10)")
    db_conn.execute("UPDATE j2_trades SET hour_et = 10 WHERE exit_date LIKE '%14:30%'")
    db_conn.commit()
    out = get_analytics("u1", conn=db_conn)
    hours = out["performance"]["byHour"]
    assert sum(1 for h in hours if h.get("trades")) == 1  # only the real-timestamp trade
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest api/services/journal_two/test_analytics.py -q`
Expected: the two new tests FAIL; every pre-existing test PASSES (record the baseline first).

- [ ] **Step 3: Convert the four sites** — same shape at each:

```python
# _fetch_trades (analytics.py) — replace the ±1-day buffer block (:119-141) with:
    if date_from:
        sql += (" AND (COALESCE(trading_day_et, '') >= ?"
                " OR (trading_day_et IS NULL AND exit_date >= ?))")
        params.append(date_from)
        params.append((Date.fromisoformat(date_from) - timedelta(days=1)).isoformat() + "T00:00:00Z")
    if date_to:
        sql += (" AND (COALESCE(trading_day_et, '~') <= ?"
                " OR (trading_day_et IS NULL AND exit_date <= ?))")
        params.append(date_to)
        params.append((Date.fromisoformat(date_to) + timedelta(days=1)).isoformat() + "T23:59:59Z")
    rows = conn.execute(sql, params).fetchall()
    # Python re-filter now applies ONLY to legacy NULL-spine rows:
    if date_from or date_to:
        out = []
        for r in rows:
            d = r["trading_day_et"] if "trading_day_et" in r.keys() and r["trading_day_et"] else to_et_date(r["exit_date"])
            if date_from and d < date_from:
                continue
            if date_to and d > date_to:
                continue
            out.append(r)
        rows = out
```

Apply the identical pattern to `_fetch_option_strategies` (on `closed_at`/its `trading_day_et`), `calendar.get_calendar`, and `calendar.get_day_detail` (whose window is the -1/+2-day datetime shape — replace with the same OR-condition on the single `date`).

Everywhere a bucket key is computed (`by_day[to_et_date(r["exit_date"])]` at analytics.py:209-213 and :271-296; calendar `_aggregate_trades` :145; `_union_strategy_aggregates` :436; day-detail :665/:673): use the row-safe read `r["trading_day_et"] if "trading_day_et" in r.keys() and r["trading_day_et"] else to_et_date(...)` (the defensive `in row.keys()` pattern from trades.py:531). Hour bucket (analytics.py:286-292): read `hour_et` the same way; **skip the row when NULL** (no fromisoformat fallback).

Make sure every SELECT in these fetchers adds `trading_day_et` (and `hour_et` for trades) to its column list.

- [ ] **Step 4: Run the full journal suites**

Run: `python -m pytest api/services/journal_two/ -q`
Expected: PASS, except any pre-existing time-brittle test_options failures identical to your baseline run. If a pre-existing hourly-report test asserted date-only trades appear in an hour bucket, update it — that behavior is corrected per spec §3, note it in the commit body.

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/analytics.py api/services/journal_two/calendar.py api/services/journal_two/test_analytics.py api/services/journal_two/test_calendar.py
git commit -m "feat(j2): bucket analytics+calendar on the trading_day_et spine (NULL-row fallback)"
```

---

### Task 5: JS↔Python parity harness (report + gate; NO thinning yet)

**Files:**
- Create: `api/services/journal_two/tools_emit_parity_fixtures.py` (generator, run manually)
- Create: `app/src/lib/journal-2-0/parity-fixtures.json` (generated, committed)
- Create: `app/src/lib/journal-2-0/parity.test.js`
- Create: `api/services/journal_two/test_parity_fixtures.py`
- Modify: `app/src/lib/journal-2-0/calculations.js:440-443` (holdDays negative clamp — see below)

**Interfaces:**
- Produces: one committed JSON consumed by BOTH stacks (new convention: Vite imports JSON natively; Python loads via `json.load`). Pairs covered — equity: `safeDivide/safe_divide`, `tradePnlDollar/trade_pnl_dollar`, `tradePnlPercent/trade_pnl_percent`, `tradeRMultiple/trade_r_multiple`, `holdDays/hold_days`, `tradeResult/trade_result`; options: `sideSign/_side_sign`, `computeNetEntry/compute_net_entry`, `computeNetExit/compute_net_exit`, `computePnl/compute_pnl`, `computeMaxRisk/compute_max_risk`, `computeDaysToExpiration/compute_days_to_expiration`, `classifyDebitCredit/classify_debit_credit`.
- **Two known divergences to resolve, Python is the authority (spec §3):** (1) `holdDays` — JS returns negative floors, Python clamps to 0 → fix JS to clamp (display-only). (2) `classifyDebitCredit` zero-case — JS returns `'even'`; READ options.py:178-186 first: if Python lacks an even-branch, add one returning `'even'` at exactly 0 so both match JS's documented behavior (this is a Python bug-fix toward its own spec, confirm against test_options expectations).

- [ ] **Step 1: Write the generator**

```python
# api/services/journal_two/tools_emit_parity_fixtures.py
"""Emit golden parity fixtures from the PYTHON implementations (authority).

Usage:  python -m api.services.journal_two.tools_emit_parity_fixtures
Writes: app/src/lib/journal-2-0/parity-fixtures.json (commit the output).
"""
from __future__ import annotations

import json
from pathlib import Path

from api.services.journal_two import calculations as calc
from api.services.journal_two import options as opt

BE_OFF = {"enabled": False, "unit": "$", "value": 0.0}
BE_PCT = {"enabled": True, "unit": "%", "value": 0.5}

EQUITY_CASES = [
    # (side, entry, exit, shares, stop, entry_date, exit_date, breakeven)
    ("Long", 29.57, 34.50, 100, 27.99, "2026-03-02T14:35:00Z", "2026-03-09T18:10:00Z", BE_OFF),
    ("Short", 50.0, 45.0, 200, 52.5, "2026-03-02", "2026-03-04", BE_OFF),
    ("Long", 10.0, 10.0, 100, 9.5, "2026-03-02", "2026-03-02", BE_OFF),      # exact zero => BE
    ("Long", 100.0, 100.4, 50, 99.0, "2026-03-02", "2026-03-03", BE_PCT),     # inside % threshold
    ("Long", 100.0, 100.0, 10, 100.0, "2026-03-02", "2026-03-01", BE_OFF),    # stop==entry (R null) + negative hold
]

OPTION_LEG_SETS = [
    [{"side": "buy", "qty": 1, "entryPrice": 2.50, "exitPrice": 4.10}],
    [{"side": "buy", "qty": 1, "entryPrice": 3.00, "exitPrice": 1.00},
     {"side": "sell", "qty": 1, "entryPrice": 1.20, "exitPrice": 0.30}],
    [{"side": "sell", "qty": 2, "entryPrice": 1.10, "exitPrice": None}],      # open leg => netExit null
]


def main() -> None:
    fixtures = {"equity": [], "options": []}
    for side, e, x, sh, stop, ed, xd, be in EQUITY_CASES:
        pnl = calc.trade_pnl_dollar(side, e, x, sh)
        fixtures["equity"].append({
            "inputs": {"side": side, "entryPrice": e, "exitPrice": x, "shares": sh,
                        "originalStop": stop, "entryDate": ed, "exitDate": xd,
                        "breakevenRange": be},
            "expected": {
                "pnlDollar": pnl,
                "pnlPercent": calc.trade_pnl_percent(side, e, x),
                "rMultiple": calc.trade_r_multiple(side, e, x, stop),
                "holdDays": calc.hold_days(ed, xd),
                "result": calc.trade_result(pnl, e, sh, be),
            },
        })
    for legs in OPTION_LEG_SETS:
        py_legs = [{"side": l["side"], "qty": l["qty"], "entry_price": l["entryPrice"],
                    "exit_price": l["exitPrice"]} for l in legs]
        ne = opt.compute_net_entry(py_legs)
        nx = opt.compute_net_exit(py_legs)
        fixtures["options"].append({
            "inputs": {"legs": legs},
            "expected": {
                "netEntry": ne,
                "netExit": nx,
                "pnl": opt.compute_pnl(ne, nx, 0, 0) if nx is not None else None,
                "debitCredit": opt.classify_debit_credit(ne),
            },
        })
    out = Path(__file__).resolve().parents[3] / "app" / "src" / "lib" / "journal-2-0" / "parity-fixtures.json"
    out.write_text(json.dumps(fixtures, indent=2))
    print(f"wrote {out} ({len(fixtures['equity'])} equity, {len(fixtures['options'])} option cases)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Resolve the two divergences, then generate**

First READ `api/services/journal_two/options.py:178-186`. If `classify_debit_credit` has no zero-branch, add `if abs(net_entry) < EPSILON: return "even"` mirroring JS. Then fix JS holdDays (calculations.js:440-443) to clamp: `return Math.max(0, Math.floor((exit - entry) / 86400000))`. Update any calculations.test.js case asserting negative holdDays.

Run: `python -m api.services.journal_two.tools_emit_parity_fixtures`
Expected: `wrote .../parity-fixtures.json (5 equity, 3 option cases)`

- [ ] **Step 3: Write the JS parity test**

```javascript
// app/src/lib/journal-2-0/parity.test.js
// Golden parity: Python (api/services/journal_two) is the authority; these
// fixtures were emitted by tools_emit_parity_fixtures.py. If this test fails,
// the JS mirror drifted — fix JS (or regenerate ONLY after changing Python).
import { describe, it, expect } from 'vitest'
import fixtures from './parity-fixtures.json'
import {
  tradePnlDollar, tradePnlPercent, tradeRMultiple, holdDays, tradeResult,
} from './calculations'
import {
  computeNetEntry, computeNetExit, computePnl, classifyDebitCredit,
} from '../../pages/journal-2-0/lib/optionCalcs'

const close = (a, b) => {
  if (a === null || b === null) return a === b
  expect(a).toBeCloseTo(b, 6)
  return true
}

describe('JS↔Python equity parity', () => {
  fixtures.equity.forEach((f, i) => {
    it(`equity case ${i}`, () => {
      const t = {
        side: f.inputs.side, entryPrice: f.inputs.entryPrice,
        exitPrice: f.inputs.exitPrice, shares: f.inputs.shares,
        originalStop: f.inputs.originalStop,
      }
      close(tradePnlDollar(t), f.expected.pnlDollar)
      close(tradePnlPercent(t), f.expected.pnlPercent)
      close(tradeRMultiple(t), f.expected.rMultiple)
      expect(holdDays(f.inputs.entryDate, f.inputs.exitDate)).toBe(f.expected.holdDays)
      expect(tradeResult(t, { breakevenRange: f.inputs.breakevenRange })).toBe(f.expected.result)
    })
  })
})

describe('JS↔Python options parity', () => {
  fixtures.options.forEach((f, i) => {
    it(`options case ${i}`, () => {
      const ne = computeNetEntry(f.inputs.legs)
      close(ne, f.expected.netEntry)
      const nx = computeNetExit(f.inputs.legs)
      close(nx, f.expected.netExit)
      if (f.expected.pnl !== null) close(computePnl(ne, nx, 0, 0), f.expected.pnl)
      expect(classifyDebitCredit(ne)).toBe(f.expected.debitCredit)
    })
  })
})
```

**Implementer check:** `tradeResult`'s JS signature takes `(t, settings)` — confirm the exact settings shape it reads (calculations.js:452) and adapt the call; `tradePnlDollar(t)` reads the trade object per calculations.js:413. If a JS function needs a field this fixture omits, extend the fixture generator — never hand-edit the JSON.

- [ ] **Step 4: Write the Python round-trip test**

```python
# api/services/journal_two/test_parity_fixtures.py
"""Fixtures must always match the CURRENT Python output (regen guard)."""
import json
from pathlib import Path
import pytest
from api.services.journal_two import calculations as calc

FIXTURES = json.loads(
    (Path(__file__).resolve().parents[3] / "app" / "src" / "lib" / "journal-2-0"
     / "parity-fixtures.json").read_text()
)


@pytest.mark.parametrize("case", FIXTURES["equity"])
def test_equity_fixture_matches_python(case):
    i, exp = case["inputs"], case["expected"]
    pnl = calc.trade_pnl_dollar(i["side"], i["entryPrice"], i["exitPrice"], i["shares"])
    assert pnl == pytest.approx(exp["pnlDollar"], abs=1e-9)
    assert calc.hold_days(i["entryDate"], i["exitDate"]) == exp["holdDays"]
    assert calc.trade_result(pnl, i["entryPrice"], i["shares"], i["breakevenRange"]) == exp["result"]
```

- [ ] **Step 5: Run both sides**

Run: `python -m pytest api/services/journal_two/test_parity_fixtures.py -q` → PASS
Run: `cd app && npx vitest run src/lib/journal-2-0/parity.test.js` → PASS
Also run the touched suites: `npx vitest run src/lib/journal-2-0/calculations.test.js` → PASS (with the holdDays clamp update)

- [ ] **Step 6: Commit**

```bash
git add api/services/journal_two/tools_emit_parity_fixtures.py api/services/journal_two/test_parity_fixtures.py app/src/lib/journal-2-0/parity-fixtures.json app/src/lib/journal-2-0/parity.test.js app/src/lib/journal-2-0/calculations.js app/src/lib/journal-2-0/calculations.test.js api/services/journal_two/options.py
git commit -m "feat(j2): golden JS<->Python math parity harness (Python authority)"
```

---

### Task 6: Annotation identity helpers (`trade_refs.py`)

**Files:**
- Create: `api/services/journal_two/trade_refs.py`
- Test: `api/services/journal_two/test_trade_refs.py`

**Interfaces:**
- Produces: `trade_ref_for_row(row: dict|sqlite3.Row) -> str` (`'ext:'+external_id` for broker rows with external_id, else `'id:'+id`); `resolve_trade_by_ref(user_id, ref, conn) -> sqlite3.Row | None`; `orphaned_refs(user_id, refs: list[str], conn) -> list[str]`. P1b screenshots and P6 verdict-outcome key their side tables on this ref. Broker purge+rebuild preserves `ext:` refs by construction (same fingerprint → same external_id).

- [ ] **Step 1: Write the failing test**

```python
# api/services/journal_two/test_trade_refs.py
import sqlite3
from api.services.journal_two import db as j2db
from api.services.journal_two.trade_refs import (
    trade_ref_for_row, resolve_trade_by_ref, orphaned_refs,
)


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    j2db.ensure_schema(conn)
    conn.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares,"
        " entry_price, entry_date, exit_price, exit_date, original_stop, created_at,"
        " source, external_id) VALUES"
        " ('m1','u1','p1','NVDA','Long',10,100,'2026-01-02',110,'2026-01-03',95,'2026-01-01',NULL,NULL),"
        " ('b1','u1','p2','TSLA','Long',5,200,'2026-01-02',210,'2026-01-03',195,'2026-01-01','broker','bk:abc')"
    )
    return conn


def test_ref_shapes():
    conn = _conn()
    manual = conn.execute("SELECT * FROM j2_trades WHERE id='m1'").fetchone()
    broker = conn.execute("SELECT * FROM j2_trades WHERE id='b1'").fetchone()
    assert trade_ref_for_row(manual) == "id:m1"
    assert trade_ref_for_row(broker) == "ext:bk:abc"


def test_resolve_and_orphans():
    conn = _conn()
    assert resolve_trade_by_ref("u1", "id:m1", conn)["id"] == "m1"
    assert resolve_trade_by_ref("u1", "ext:bk:abc", conn)["id"] == "b1"
    assert resolve_trade_by_ref("u1", "ext:bk:GONE", conn) is None
    assert orphaned_refs("u1", ["id:m1", "ext:bk:abc", "ext:bk:GONE"], conn) == ["ext:bk:GONE"]
```

- [ ] **Step 2: Run to verify failure** — `python -m pytest api/services/journal_two/test_trade_refs.py -q` → FAIL (module missing)

- [ ] **Step 3: Implement**

```python
# api/services/journal_two/trade_refs.py
"""Stable annotation identity for trades.

Broker rows are purged+reinserted with fresh uuid4 ids on full resync
(broker/service.py _purge_imported), but their external_id fingerprint is
deterministic — so annotations key on 'ext:<external_id>' for broker rows
and 'id:<row id>' for manual rows (manual ids never change).
Orphaned refs (a re-sliced fingerprint) are PARKED, never deleted —
surfaced later by the Trust Center reattach queue (spec §8).
"""
from __future__ import annotations

import sqlite3


def trade_ref_for_row(row) -> str:
    ext = row["external_id"] if "external_id" in row.keys() else None
    if row["source"] == "broker" and ext:
        return f"ext:{ext}"
    return f"id:{row['id']}"


def resolve_trade_by_ref(user_id: str, ref: str, conn: sqlite3.Connection):
    if ref.startswith("ext:"):
        return conn.execute(
            "SELECT * FROM j2_trades WHERE user_id = ? AND external_id = ?",
            (user_id, ref[4:]),
        ).fetchone()
    if ref.startswith("id:"):
        return conn.execute(
            "SELECT * FROM j2_trades WHERE user_id = ? AND id = ?",
            (user_id, ref[3:]),
        ).fetchone()
    return None


def orphaned_refs(user_id: str, refs: list[str], conn: sqlite3.Connection) -> list[str]:
    return [r for r in refs if resolve_trade_by_ref(user_id, r, conn) is None]
```

*(`trade_ref_for_row` must tolerate sqlite3.Row: `row["source"]` raises IndexError on missing key for Row objects — use the `in row.keys()` guard for BOTH source and external_id, mirroring trades.py:531.)*

- [ ] **Step 4: Run** — `python -m pytest api/services/journal_two/test_trade_refs.py -q` → PASS

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/trade_refs.py api/services/journal_two/test_trade_refs.py
git commit -m "feat(j2): stable trade annotation refs (ext:/id: scheme)"
```

---

### Task 7: Attachments R2 backup job (gates P1b screenshots)

**Files:**
- Create: `api/j2_attachments_backup.py` (sibling of `api/flow_backup.py`, same shape)
- Modify: `api/main.py` (register in the lifespan scheduler-lock block next to flow_backup at :2859-2864)
- Test: `api/test_j2_attachments_backup.py` (tarball + prune logic with a tmp dir + stubbed R2 client)

**Interfaces:**
- Produces: `backup_j2_attachments_to_r2() -> dict` (tar.gz of `_ATTACHMENT_ROOT` → R2 key `j2_attachment_backups/j2-attachments-<ET date>.tar.gz`; retain 14 days, keep newest 3 regardless; never raises); `register_jobs(scheduler) -> bool` (CronTrigger mon-sat 02:45 ET, `id="j2_attachments_backup"`, `max_instances=1, replace_existing=True`); env gate `J2_ATTACHMENT_BACKUP_ENABLED` (default "0" — P1b's ship checklist flips it on Railway); manual trigger `POST /api/j2/admin/attachments-backup` (require_admin, daemon thread).

- [ ] **Step 1: Copy the template** — open `api/flow_backup.py` and mirror it exactly: `_r2_client()` (:68-101 — KEEP the `request_checksum_calculation="when_required"` / `response_checksum_validation="when_required"` Config and region us-east-1, reusing `DATA_SYNC_*` creds), the retain/prune logic (:262+ RETAIN_DAYS=14/keep 3), the `.j2_attachments_backup_last.json` marker, and `register_jobs`. The only structural difference: instead of a sqlite `.backup`, build a tarball —

```python
def _make_tarball(root: Path, dest: Path) -> int:
    """tar.gz the attachments tree; returns file count. Skips nothing —
    originals are ≤5MB validated images, the tree IS the user data."""
    count = 0
    with tarfile.open(dest, "w:gz") as tar:
        for p in sorted(root.rglob("*")):
            if p.is_file():
                tar.add(p, arcname=str(p.relative_to(root)))
                count += 1
    return count
```

Root: `from api.services.journal_two.calendar import _ATTACHMENT_ROOT` (calendar.py:902 — respects `J2_ATTACHMENT_ROOT` env; notes.py uses the same root). Empty/missing root → `{"skipped": "no attachments"}`, no upload.

- [ ] **Step 2: Write the test** (tmp attachment root via `monkeypatch.setenv("J2_ATTACHMENT_ROOT", ...)` + reload, stub `_r2_client` with a recorder object; assert tarball contains the seeded files, marker written, disabled-gate no-ops)

```python
# api/test_j2_attachments_backup.py — shape:
def test_backup_disabled_by_default(monkeypatch):
    monkeypatch.delenv("J2_ATTACHMENT_BACKUP_ENABLED", raising=False)
    from api import j2_attachments_backup as mod
    assert mod.backup_j2_attachments_to_r2() == {"skipped": "disabled"}
```

(plus `test_tarball_roundtrip` seeding `<tmp>/<user>/<date>/x.png` and asserting the recorder saw one `put_object`/`upload_file` with the expected key prefix; follow whatever call shape flow_backup uses.)

- [ ] **Step 3: Register in main.py** — inside the `if acquire_scheduler_lock():` block, mirror flow_backup's try/except non-fatal registration (main.py:2859-2864) with a `[startup] j2 attachments backup registered` print. Add the admin route in `api/routers/journal_two.py`:

```python
@router.post("/admin/attachments-backup")
def attachments_backup_route(user: dict = Depends(require_admin)):
    import threading
    from api import j2_attachments_backup
    threading.Thread(target=j2_attachments_backup.backup_j2_attachments_to_r2, daemon=True).start()
    return {"started": True}
```

- [ ] **Step 4: Run** — `python -m pytest api/test_j2_attachments_backup.py -q` → PASS; boot-import check: `python -c "import api.main"` exits 0.

- [ ] **Step 5: Commit**

```bash
git add api/j2_attachments_backup.py api/test_j2_attachments_backup.py api/main.py api/routers/journal_two.py
git commit -m "feat(j2): nightly R2 backup for journal attachments (gated, default off)"
```

---

### Task 8: FilterSpec backend + /trades pagination

**Files:**
- Create: `api/services/journal_two/filters.py`
- Modify: `api/routers/journal_two.py:255-266` (GET /trades gains filter + pagination params)
- Modify: `api/services/journal_two/trades.py:777-782` (`list_trades_for_user` accepts spec)
- Test: `api/services/journal_two/test_filters.py`

**Interfaces:**
- Produces: `class FilterSpec(BaseModel)` — fields `date_from: str | None`, `date_to: str | None`, `symbol: str | None`, `sides: list[str]`, `setups: list[str]`, `limit: int = 500` (clamped 1..2000, community_trades idiom), `offset: int = 0`; `trades_where(spec) -> tuple[str, list]` compiling a WHERE fragment — dates against `COALESCE(trading_day_et, substr(exit_date,1,10))`, symbol prefix `UPPER(symbol) LIKE ? || '%'`, sides/setups as IN-lists; `parse_filter_query(...)` FastAPI dependency. GET /trades response envelope gains **additive** keys: `{"trades": [...], "total": int, "limit": int, "offset": int}` (existing consumers read only `trades` — verified useJ2Trades.js:12-29 reads `data?.trades`).
- URL codec contract (P3 FE work consumes this): query params `date_from`, `date_to`, `symbol`, `sides` (comma-joined), `setups` (comma-joined, members URL-encoded — commas inside a setup name survive as %2C), `limit`, `offset`. Snake_case on the wire (matches existing account_id/date_from convention).

- [ ] **Step 1: Failing tests**

```python
# api/services/journal_two/test_filters.py
import sqlite3
from api.services.journal_two import db as j2db
from api.services.journal_two.filters import FilterSpec, trades_where


def _conn_with_trades():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    j2db.ensure_schema(conn)
    rows = [
        ("t1", "NVDA", "Long", "VCP", "2026-04-19"),
        ("t2", "TSLA", "Short", "PEG", "2026-04-20"),
        ("t3", "NVAX", "Long", "VCP", "2026-04-21"),
    ]
    for tid, sym, side, setup, day in rows:
        conn.execute(
            "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares,"
            " entry_price, entry_date, exit_price, exit_date, original_stop,"
            " created_at, setup, trading_day_et) VALUES"
            " (?, 'u1', 'p', ?, ?, 10, 100, ?, 110, ?, 95, '2026-01-01', ?, ?)",
            (tid, sym, side, day, day + "T15:00:00Z", setup, day),
        )
    return conn


def _ids(conn, spec):
    frag, params = trades_where(spec)
    sql = f"SELECT id FROM j2_trades WHERE user_id = ? {frag} ORDER BY id"
    return [r["id"] for r in conn.execute(sql, ["u1", *params])]


def test_date_range_uses_spine():
    conn = _conn_with_trades()
    assert _ids(conn, FilterSpec(date_from="2026-04-20", date_to="2026-04-21")) == ["t2", "t3"]


def test_symbol_prefix_and_sides_and_setups():
    conn = _conn_with_trades()
    assert _ids(conn, FilterSpec(symbol="NV")) == ["t1", "t3"]
    assert _ids(conn, FilterSpec(sides=["Short"])) == ["t2"]
    assert _ids(conn, FilterSpec(setups=["VCP"])) == ["t1", "t3"]


def test_limit_clamps():
    assert FilterSpec(limit=99999).limit == 2000
    assert FilterSpec(limit=0).limit == 1
```

- [ ] **Step 2: Run to verify failure** — `python -m pytest api/services/journal_two/test_filters.py -q` → FAIL (module missing)

- [ ] **Step 3: Implement `filters.py`**

```python
# api/services/journal_two/filters.py
"""Versioned server-side filter contract (FilterSpec v1) — spec §6.

One pydantic model, one WHERE-fragment compiler for j2_trades. Calendar/
options adapters arrive in P3; this module is the single place filter
params are parsed — endpoints never read filter query params directly.
"""
from __future__ import annotations

from pydantic import BaseModel, field_validator


class FilterSpec(BaseModel):
    date_from: str | None = None
    date_to: str | None = None
    symbol: str | None = None
    sides: list[str] = []
    setups: list[str] = []
    limit: int = 500
    offset: int = 0

    @field_validator("limit")
    @classmethod
    def _clamp_limit(cls, v: int) -> int:
        return max(1, min(int(v or 500), 2000))

    @field_validator("offset")
    @classmethod
    def _clamp_offset(cls, v: int) -> int:
        return max(0, int(v or 0))


_DAY = "COALESCE(trading_day_et, substr(exit_date, 1, 10))"


def trades_where(spec: FilterSpec) -> tuple[str, list]:
    frag, params = [], []
    if spec.date_from:
        frag.append(f"AND {_DAY} >= ?")
        params.append(spec.date_from)
    if spec.date_to:
        frag.append(f"AND {_DAY} <= ?")
        params.append(spec.date_to)
    if spec.symbol:
        frag.append("AND UPPER(symbol) LIKE ? || '%'")
        params.append(spec.symbol.strip().upper())
    if spec.sides:
        frag.append(f"AND side IN ({','.join('?' * len(spec.sides))})")
        params.extend(spec.sides)
    if spec.setups:
        frag.append(f"AND setup IN ({','.join('?' * len(spec.setups))})")
        params.extend(spec.setups)
    return (" ".join(frag), params)


def parse_filter_query(
    date_from: str | None = None, date_to: str | None = None,
    symbol: str | None = None, sides: str | None = None,
    setups: str | None = None, limit: int = 500, offset: int = 0,
) -> FilterSpec:
    """FastAPI dependency: comma-joined sets, URL-decoded members."""
    from urllib.parse import unquote
    split = lambda s: [unquote(x) for x in s.split(",") if x] if s else []
    return FilterSpec(date_from=date_from, date_to=date_to, symbol=symbol,
                      sides=split(sides), setups=split(setups),
                      limit=limit, offset=offset)
```

*(Pydantic v1 fallback: if the repo pins pydantic<2, use `@validator` instead of `@field_validator` — check `pip show pydantic` / imports in broker_sync.py:39 first.)*

- [ ] **Step 4: Wire GET /trades** — extend `list_trades_for_user` with `spec: FilterSpec | None = None` applying `trades_where` + `LIMIT ? OFFSET ?` + a `SELECT COUNT(*)` with the same fragment; route becomes:

```python
@router.get("/trades")
def list_trades(account_id: str | None = None,
                spec: FilterSpec = Depends(parse_filter_query),
                user: dict = Depends(get_current_user)):
    trades, total = trades_service.list_trades_for_user(
        user["id"], account_id=account_id, spec=spec)
    return {"trades": trades, "total": total, "limit": spec.limit, "offset": spec.offset}
```

Keep `list_trades_for_user`'s no-spec behavior IDENTICAL for other internal callers (grep for callers first: coach/data assembler etc. — give spec a default that preserves current unbounded behavior for `spec=None`).

- [ ] **Step 5: Run** — `python -m pytest api/services/journal_two/test_filters.py api/services/journal_two/ -q` → PASS (no regressions; `{"trades": ...}` envelope additive)

- [ ] **Step 6: Commit**

```bash
git add api/services/journal_two/filters.py api/services/journal_two/test_filters.py api/services/journal_two/trades.py api/routers/journal_two.py
git commit -m "feat(j2): FilterSpec v1 backend + paginated /trades (additive envelope)"
```

---

### Task 9: J2 telemetry endpoint

**Files:**
- Modify: `api/routers/journal_two.py` (one new route)
- Test: extend `api/services/journal_two/test_filters.py`? No — create `api/services/journal_two/test_telemetry.py` (route-level via FastAPI TestClient if a precedent exists; otherwise unit-test the allow-list function)

**Interfaces:**
- Produces: `POST /api/j2/telemetry` body `{"event": str, "props": dict|None}`; allow-list (landing_analytics.py:32-45 pattern): `{"trade_page_open", "import_preset_used", "verdict_embed_run", "scope_applied", "surface_visit", "screenshot_added", "reflection_saved"}`; writes via existing `log_activity(user_id, action, details)` (auth_service.py:548-554) with `action=f"j2:{event}"`, `details=json.dumps(props)[:500]`. Unknown event → 400. P1b fires these.

- [ ] **Step 1: Implement the route** (small enough to write first, then test)

```python
_J2_TELEMETRY_EVENTS = {
    "trade_page_open", "import_preset_used", "verdict_embed_run",
    "scope_applied", "surface_visit", "screenshot_added", "reflection_saved",
}


@router.post("/telemetry")
def j2_telemetry(payload: dict, user: dict = Depends(get_current_user)):
    import json as _json
    event = str(payload.get("event") or "")
    if event not in _J2_TELEMETRY_EVENTS:
        raise HTTPException(status_code=400, detail="Unknown event")
    from api.services.auth_service import log_activity
    log_activity(user["id"], f"j2:{event}", _json.dumps(payload.get("props") or {})[:500])
    return {"ok": True}
```

- [ ] **Step 2: Test** — assert allow-list rejection + accepted event writes an activity_log row (in-memory auth db via the test_analytics.py `db_conn` fixture pattern). Run `python -m pytest api/services/journal_two/test_telemetry.py -q` → PASS.

- [ ] **Step 3: Commit** — `git add api/routers/journal_two.py api/services/journal_two/test_telemetry.py && git commit -m "feat(j2): telemetry endpoint (allow-listed events -> activity_log)"`

---

### Task 10: playbook.py purge

**Files:**
- Delete: `api/services/journal_two/playbook.py`, `api/services/journal_two/test_playbook.py`
- Modify: `api/routers/journal_two.py:37` (remove `playbook as playbook_service` from the services import block)

**Scope guard:** do NOT touch `api/services/playbook_service.py` (Journal 1.0, live) or the Compass `lookup_playbook` chat tool — three unrelated "playbook" things exist. Do NOT drop `j2_playbook_entries` or `run_notebook_migration_v1` in this task — the table drop is a manual prod op after a row-count check (`SELECT COUNT(*) FROM j2_playbook_entries`), documented in the ship checklist.

- [ ] **Step 1: Verify dead** — `grep -rn "playbook_service\|from api.services.journal_two import playbook\|journal_two.playbook" api/ | grep -v test_playbook` — expect ONLY journal_two.py:37 + comments.
- [ ] **Step 2: Delete + de-import** — remove the two files and the import token.
- [ ] **Step 3: Run** — `python -m pytest api/services/journal_two/ -q` → PASS; `python -c "import api.main"` → exits 0.
- [ ] **Step 4: Commit** — `git add -u api/ && git commit -m "chore(j2): delete deprecated playbook service (425 lines; table drop deferred to manual op)"`

*(Note: `git add -u api/` stages deletions under api/ only — still never `git add -A`.)*

---

### Task 11: Verification investigations (timeboxed, produce notes not code)

- [ ] **Step 1: Regime history** — investigate whether a queryable historical regime/breadth series exists (check `api/services/journal_two/regime.py` imports → the breadth source; check uct-intelligence DB tables via `C:\Users\Patrick\uct-intelligence\data\uct_intelligence.db` for a breadth/regime history table). Write findings to `docs/superpowers/plans/notes/2026-07-XX-regime-history-verification.md`: EXISTS + backfill feasible / FORWARD-ONLY. This gates P5's regime copy ("since regime history began").
- [ ] **Step 2: Broker coverage** — inspect the SnapTrade connect flow (`api/services/journal_two/broker/service.py::connect`, `snaptrade_client.py` portal params) for any Robinhood-only restriction. If the portal is broker-agnostic (expected), note "multi-broker likely works, needs one live non-Robinhood test" in the same notes file — it becomes a marketing claim after a real test, not an engineering project.
- [ ] **Step 3: Commit notes** — `git add docs/superpowers/plans/notes/ && git commit -m "docs(j2): P1a verification notes (regime history, broker coverage)"`

---

### Task 12: Full-suite gate + ship

- [ ] **Step 1: Full backend suite** — `python -m pytest api/services/journal_two/ api/test_j2_attachments_backup.py -q` → green (minus documented pre-existing brittle fixtures).
- [ ] **Step 2: Full FE suite + build** — `cd app && npm test` → green; `npm run build` → success.
- [ ] **Step 3: Push gate** — `grep -c broker_sync api/main.py` ≥ 7. Ship window ≥4:20 PM ET. `git push origin <branch>:master`.
- [ ] **Step 4: Post-deploy (prod, off-hours)** — as admin: `POST /api/j2/admin/trading-day-backfill` (from a logged-in Chrome fetch, per the admin-endpoint playbook). Save the `moved_days` response to `docs/superpowers/plans/notes/2026-07-XX-backfill-diff.md`. This diff seeds the P1b change-note banner copy. Verify `GET /api/j2/analytics` + `/calendar` responses unchanged for a known account except documented moved days.
- [ ] **Step 5: Railway env check** (feedback: check Railway vars first) — confirm `DATA_SYNC_*` creds exist on the WEB service (flow_backup already uses them there); do NOT set `J2_ATTACHMENT_BACKUP_ENABLED=1` yet — that's P1b's checklist, before screenshots ship.

---

## Self-review notes (already applied)

- Spec coverage: §3 ET spine (Tasks 1-4), parity harness (5), annotation identity (6), attachments backup (7), FilterSpec backend (8), telemetry (9), playbook purge (10), verification tasks (11), backfill diff → change-note data (3, 12).
- The `run_backfill` reference implementation's NULL-loop double-query is flagged for simplification by the implementer; its contract is the tests.
- Type consistency: `FilterSpec` field names (snake_case wire) are consumed verbatim by P1b's prev/next and P3's Scope bar; `trade_ref_for_row` ref shapes (`ext:`/`id:`) are consumed by P1b screenshots.
