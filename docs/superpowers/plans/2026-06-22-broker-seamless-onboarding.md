# Broker Seamless Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a newly-connected member's broker trades and equity curve populate automatically within minutes (instead of looking empty until 2:30 AM), with clear in-product "importing" feedback.

**Architecture:** A short, durable server-owned "import warming" window runs FULL syncs every ~3 min after connect until SnapTrade's async backfill stabilizes (covers both auto-retry and late-backfill catch-up). The equity curve gains a live "now" anchor so it never renders blank on day one. The frontend shows an "importing" banner while warming and auto-refreshes when it clears.

**Tech Stack:** FastAPI + SQLite (auth.db, web pod) · APScheduler · React + Vite + SWR · vitest.

## Global Constraints

- Work in the worktree `C:\Users\Patrick\uct-dashboard\.claude\worktrees\broker-investigate` (checked out at `origin/master`). Ship via fast-forward `push investigate-broker-sync:master`. NEVER `git add -A` — stage only the files you touched (shared-tree hazard).
- `grep -c broker_sync api/main.py` must remain **≥ 7** after any change to `main.py`.
- Broker sync runs **web-side** (auth.db is web-local). All new scheduler jobs are gated on `os.getenv("BROKER_SYNC_ENABLED") == "1"`.
- Migrations are **additive nullable columns appended to `_PHASE_2_ALTERS`** in `api/services/journal_two/db.py` (idempotent ALTERs; a re-added existing column is caught and ignored by the existing runner).
- NEVER write synthetic rows into `j2_broker_equity_snapshots` — the day-one curve anchor is render-only.
- NO generic emoji in UI — use `app/src/components/ui/UIcon.jsx` (`<UIcon name=… />`), per the brand standard.
- Run backend tests with `python -m pytest`; frontend tests with `cd app && npx vitest run`.

---

### Task 1: Warming columns + connections helpers

Add the warming state columns and the DB-layer helpers to set/clear/list warming accounts and surface `warming` in the account dict.

**Files:**
- Modify: `api/services/journal_two/db.py` (append to `_PHASE_2_ALTERS`, ~line 570)
- Modify: `api/services/journal_two/broker/connections.py` (add helpers + extend `_row_to_broker_account`)
- Test: `tests/test_broker_connections_warming.py` (create)

**Interfaces:**
- Produces:
  - `connections.set_warming(user_id, broker_account_id, until_iso: str, conn=None) -> bool`
  - `connections.clear_warming(user_id, broker_account_id, conn=None) -> bool`
  - `connections.bump_warming_state(user_id, broker_account_id, *, activity_count: int, stable_ticks: int, conn=None) -> bool`
  - `connections.list_warming_accounts(now_iso: str, conn=None) -> list[dict]` — active, sync-enabled accounts whose `warming_until > now_iso`
  - `_row_to_broker_account` dict gains: `warmingUntil`, `warmingLastActivityCount`, `warmingStableTicks`, and `warming` (bool: `warming_until` present and `> now`)

- [ ] **Step 1: Write the failing test**

Create `tests/test_broker_connections_warming.py`:

```python
from datetime import datetime, timezone, timedelta

from api.services.auth_db import get_connection, init_db
from api.services.journal_two.broker import connections


def _iso(dt):
    return dt.isoformat()


def _make_account(conn, *, user_id="u1"):
    # Mirror map_snaptrade_account's row shape with a minimal direct insert.
    import uuid
    from api.services.journal_two import accounts as accounts_service
    j2 = accounts_service.create_account(user_id, {"name": "RH", "startingBalance": 1.0}, conn=conn)
    ba_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT INTO j2_broker_accounts
           (id, user_id, snaptrade_account_id, brokerage_name, j2_account_id,
            sync_enabled, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, 'active', ?, ?)""",
        (ba_id, user_id, "snap-acct-1", "Robinhood", j2["id"], now, now),
    )
    conn.commit()
    return ba_id


def test_set_and_clear_warming_roundtrip():
    init_db()
    conn = get_connection()
    try:
        ba_id = _make_account(conn)
        future = _iso(datetime.now(timezone.utc) + timedelta(hours=2))
        assert connections.set_warming("u1", ba_id, future, conn=conn) is True
        acct = connections.get_broker_account("u1", ba_id, conn=conn)
        assert acct["warming"] is True
        assert acct["warmingStableTicks"] == 0

        assert connections.clear_warming("u1", ba_id, conn=conn) is True
        acct = connections.get_broker_account("u1", ba_id, conn=conn)
        assert acct["warming"] is False
        assert acct["warmingUntil"] is None
    finally:
        conn.close()


def test_list_warming_accounts_only_future_active():
    init_db()
    conn = get_connection()
    try:
        ba_id = _make_account(conn, user_id="u2")
        past = _iso(datetime.now(timezone.utc) - timedelta(minutes=1))
        future = _iso(datetime.now(timezone.utc) + timedelta(hours=1))
        now = _iso(datetime.now(timezone.utc))

        connections.set_warming("u2", ba_id, past, conn=conn)
        assert all(a["id"] != ba_id for a in connections.list_warming_accounts(now, conn=conn))

        connections.set_warming("u2", ba_id, future, conn=conn)
        assert any(a["id"] == ba_id for a in connections.list_warming_accounts(now, conn=conn))
    finally:
        conn.close()


def test_bump_warming_state_persists_counters():
    init_db()
    conn = get_connection()
    try:
        ba_id = _make_account(conn, user_id="u3")
        connections.set_warming("u3", ba_id,
                                _iso(datetime.now(timezone.utc) + timedelta(hours=1)), conn=conn)
        connections.bump_warming_state("u3", ba_id, activity_count=42, stable_ticks=1, conn=conn)
        acct = connections.get_broker_account("u3", ba_id, conn=conn)
        assert acct["warmingLastActivityCount"] == 42
        assert acct["warmingStableTicks"] == 1
    finally:
        conn.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_broker_connections_warming.py -v`
Expected: FAIL — `sqlite3.OperationalError: no such column: warming_until` (or `AttributeError: module ... has no attribute 'set_warming'`).

- [ ] **Step 3: Add the migration columns**

In `api/services/journal_two/db.py`, append to the `_PHASE_2_ALTERS` list (before its closing `]`):

```python
    # Broker import "warming" — after connect, the scheduler runs short full
    # re-syncs until SnapTrade's async backfill stabilizes. Nullable; null = not
    # warming. See docs/superpowers/specs/2026-06-22-broker-seamless-onboarding-design.md
    "ALTER TABLE j2_broker_accounts ADD COLUMN warming_until TEXT",
    "ALTER TABLE j2_broker_accounts ADD COLUMN warming_last_activity_count INTEGER",
    "ALTER TABLE j2_broker_accounts ADD COLUMN warming_stable_ticks INTEGER NOT NULL DEFAULT 0",
```

- [ ] **Step 4: Add the connections helpers**

In `api/services/journal_two/broker/connections.py`, add after `record_sync_result` (before `_update_account_fields`):

```python
def set_warming(
    user_id: str, broker_account_id: str, until_iso: str | None,
    conn: sqlite3.Connection | None = None,
) -> bool:
    """Begin (or extend) the post-connect warming window. Resets tick state."""
    return _update_account_fields(
        user_id, broker_account_id,
        {"warming_until": until_iso, "warming_last_activity_count": None,
         "warming_stable_ticks": 0},
        conn,
    )


def clear_warming(
    user_id: str, broker_account_id: str, conn: sqlite3.Connection | None = None
) -> bool:
    """End the warming window (backfill settled or window expired)."""
    return _update_account_fields(
        user_id, broker_account_id, {"warming_until": None}, conn
    )


def bump_warming_state(
    user_id: str, broker_account_id: str, *, activity_count: int, stable_ticks: int,
    conn: sqlite3.Connection | None = None,
) -> bool:
    """Record the latest warming-tick observation (activity count + stability)."""
    return _update_account_fields(
        user_id, broker_account_id,
        {"warming_last_activity_count": int(activity_count),
         "warming_stable_ticks": int(stable_ticks)},
        conn,
    )


def list_warming_accounts(
    now_iso: str, conn: sqlite3.Connection | None = None
) -> list[dict[str, Any]]:
    """Active, sync-enabled accounts still inside their warming window."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            """
            SELECT * FROM j2_broker_accounts
             WHERE sync_enabled = 1 AND status = 'active'
               AND warming_until IS NOT NULL AND warming_until > ?
             ORDER BY warming_until ASC
            """,
            (now_iso,),
        ).fetchall()
        return [_row_to_broker_account(r) for r in rows]
    finally:
        if owned:
            conn.close()
```

Then extend `_row_to_broker_account` — add these keys to the returned dict (after `"lastError": row["last_error"],`):

```python
        "warmingUntil": row["warming_until"],
        "warmingLastActivityCount": row["warming_last_activity_count"],
        "warmingStableTicks": row["warming_stable_ticks"] or 0,
        "warming": bool(
            row["warming_until"]
            and row["warming_until"] > datetime.now(timezone.utc).isoformat()
        ),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_broker_connections_warming.py -v`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
git add api/services/journal_two/db.py api/services/journal_two/broker/connections.py tests/test_broker_connections_warming.py
git commit -m "feat(broker): warming-state columns + connections helpers"
```

---

### Task 2: Warming sync runner (the state machine)

Add the warming runner to `sync.py`: for each warming account, run a FULL sync, compare the activity-ledger count to the last tick, and clear warming after 2 stable ticks or window expiry.

**Files:**
- Modify: `api/services/journal_two/broker/sync.py` (add constants + `_warming_sync` + `run_warming_sync_blocking`, after `_nightly_reconcile`)
- Test: `tests/test_broker_warming_runner.py` (create)

**Interfaces:**
- Consumes: `connections.list_warming_accounts`, `connections.bump_warming_state`, `connections.clear_warming`, `sync_account(..., full=True)`, `activities_store.get_activities`, `_user_is_paid`.
- Produces:
  - `sync._activity_count(user_id, broker_account_id) -> int`
  - `sync._warming_sync() -> dict` (async; one pass over all warming accounts)
  - `sync.run_warming_sync_blocking() -> None` (sync wrapper for APScheduler; never raises)
  - Constants `WARMING_WINDOW_HOURS = 2`, `WARMING_STABLE_TICKS = 2`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_broker_warming_runner.py`:

```python
import asyncio
from datetime import datetime, timezone, timedelta
from unittest.mock import patch

from api.services.journal_two.broker import sync as broker_sync


def _run(coro):
    return asyncio.run(coro)


def test_warming_clears_after_two_stable_ticks(monkeypatch):
    acct = {"id": "ba1", "userId": "u1", "warmingLastActivityCount": 10,
            "warmingStableTicks": 1, "warmingUntil":
            (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()}

    calls = {"cleared": [], "bumped": [], "synced": 0}

    monkeypatch.setattr(broker_sync.connections, "list_warming_accounts", lambda now: [acct])
    monkeypatch.setattr(broker_sync, "_user_is_paid", lambda uid, cache: True)
    monkeypatch.setattr(broker_sync, "_activity_count", lambda uid, baid: 10)  # unchanged

    async def _fake_sync(uid, baid, *, full=False, cooldown_seconds=0.0):
        calls["synced"] += 1
        return {"imported": 0}
    monkeypatch.setattr(broker_sync, "sync_account", _fake_sync)
    monkeypatch.setattr(broker_sync.connections, "bump_warming_state",
                        lambda *a, **k: calls["bumped"].append(k))
    monkeypatch.setattr(broker_sync.connections, "clear_warming",
                        lambda uid, baid: calls["cleared"].append(baid))

    _run(broker_sync._warming_sync())

    assert calls["synced"] == 1            # full sync ran
    assert calls["cleared"] == ["ba1"]     # 1 prior + 1 now unchanged == 2 stable → cleared


def test_warming_resets_stable_ticks_when_activities_grow(monkeypatch):
    acct = {"id": "ba2", "userId": "u1", "warmingLastActivityCount": 10,
            "warmingStableTicks": 1, "warmingUntil":
            (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()}
    calls = {"cleared": [], "bumped": []}

    monkeypatch.setattr(broker_sync.connections, "list_warming_accounts", lambda now: [acct])
    monkeypatch.setattr(broker_sync, "_user_is_paid", lambda uid, cache: True)
    monkeypatch.setattr(broker_sync, "_activity_count", lambda uid, baid: 25)  # grew

    async def _fake_sync(uid, baid, *, full=False, cooldown_seconds=0.0):
        return {"imported": 5}
    monkeypatch.setattr(broker_sync, "sync_account", _fake_sync)
    monkeypatch.setattr(broker_sync.connections, "bump_warming_state",
                        lambda uid, baid, **k: calls["bumped"].append(k))
    monkeypatch.setattr(broker_sync.connections, "clear_warming",
                        lambda uid, baid: calls["cleared"].append(baid))

    _run(broker_sync._warming_sync())

    assert calls["cleared"] == []                       # still warming
    assert calls["bumped"][-1]["stable_ticks"] == 0     # reset
    assert calls["bumped"][-1]["activity_count"] == 25


def test_warming_no_accounts_is_noop(monkeypatch):
    monkeypatch.setattr(broker_sync.connections, "list_warming_accounts", lambda now: [])
    # Must not raise and must not call sync_account.
    called = {"sync": False}
    async def _boom(*a, **k):
        called["sync"] = True
    monkeypatch.setattr(broker_sync, "sync_account", _boom)
    _run(broker_sync._warming_sync())
    assert called["sync"] is False


def test_run_warming_sync_blocking_never_raises(monkeypatch):
    def _boom(now):
        raise RuntimeError("db down")
    monkeypatch.setattr(broker_sync.connections, "list_warming_accounts", _boom)
    broker_sync.run_warming_sync_blocking()  # should swallow
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_broker_warming_runner.py -v`
Expected: FAIL — `AttributeError: module ... 'sync' has no attribute '_warming_sync'`.

- [ ] **Step 3: Add the runner to sync.py**

In `api/services/journal_two/broker/sync.py`, add near the other module constants (after `_MAX_PAGES`):

```python
WARMING_WINDOW_HOURS = 2
WARMING_STABLE_TICKS = 2  # consecutive no-growth ticks before warming stops
```

Then add after `_nightly_reconcile` (end of the scheduler-runner block):

```python
def _activity_count(user_id: str, broker_account_id: str) -> int:
    """Number of raw activities currently stored for this account."""
    try:
        return len(activities_store.get_activities(user_id, broker_account_id))
    except Exception:  # noqa: BLE001 — count is advisory; treat failure as 'unchanged'
        return -1


async def _warming_sync() -> dict[str, Any]:
    """One warming pass: full-sync every account still inside its warming window,
    advancing/clearing the stable-tick state. Late SnapTrade backfill that lands
    older than the incremental overlap window is caught here (full=True ignores
    the cursor). Clears warming after WARMING_STABLE_TICKS no-growth ticks."""
    now_iso = _now_iso()
    accts = connections.list_warming_accounts(now_iso)
    if not accts:
        return {"warming": 0}
    paid_cache: dict[str, bool] = {}
    cleared = 0
    for a in accts:
        if not _user_is_paid(a["userId"], paid_cache):
            connections.clear_warming(a["userId"], a["id"])
            cleared += 1
            continue
        try:
            await sync_account(a["userId"], a["id"], full=True)
        except Exception:  # noqa: BLE001 — one bad account never blocks the rest
            pass
        count = _activity_count(a["userId"], a["id"])
        prev = a.get("warmingLastActivityCount")
        ticks = int(a.get("warmingStableTicks") or 0)
        if prev is not None and count == prev:
            ticks += 1
        else:
            ticks = 0
        if ticks >= WARMING_STABLE_TICKS:
            connections.clear_warming(a["userId"], a["id"])
            cleared += 1
        else:
            connections.bump_warming_state(
                a["userId"], a["id"], activity_count=count, stable_ticks=ticks)
    return {"warming": len(accts), "cleared": cleared}


def run_warming_sync_blocking() -> None:
    """APScheduler entry for the warming loop. NOT market-hours gated (SnapTrade
    backfill lands any time after connect). Never raises into the scheduler."""
    import logging
    try:
        asyncio.run(_warming_sync())
    except Exception as e:  # noqa: BLE001
        logging.getLogger("broker_sync").warning("warming sync failed: %s", e)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_broker_warming_runner.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/broker/sync.py tests/test_broker_warming_runner.py
git commit -m "feat(broker): warming sync runner (full re-sync until backfill stable)"
```

---

### Task 3: Register the warming scheduler job + set warming on connect

Wire the warming job into the existing broker scheduler block, and set the warming window when accounts are (re)connected.

**Files:**
- Modify: `api/main.py` (inside the `if os.getenv("BROKER_SYNC_ENABLED") == "1":` block, ~line 1707)
- Modify: `api/routers/broker_sync.py` (the `accounts/refresh` handler — set warming after mapping accounts)
- Test: `tests/test_broker_connect_sets_warming.py` (create)

**Interfaces:**
- Consumes: `sync.run_warming_sync_blocking`, `connections.set_warming`, `connections.list_broker_accounts`, `sync.WARMING_WINDOW_HOURS`.

- [ ] **Step 1: Read the connect/refresh handler**

Read `api/routers/broker_sync.py` and find the `accounts/refresh` POST handler (it maps SnapTrade accounts into `j2_broker_accounts`, e.g. via `service.refresh_accounts(...)` or `connections.map_snaptrade_account`). Identify where, after the refresh, you have `user["id"]` and the list of the user's broker accounts.

- [ ] **Step 2: Write the failing test**

Create `tests/test_broker_connect_sets_warming.py`. Adapt the import to the real refresh function you found in Step 1 (this test calls the helper that should set warming — define `broker_sync_router._begin_warming(user_id)` as the seam):

```python
from datetime import datetime, timezone

from api.services.auth_db import get_connection, init_db
from api.services.journal_two.broker import connections
import api.routers.broker_sync as broker_sync_router


def _make_account(conn, user_id):
    import uuid
    from api.services.journal_two import accounts as accounts_service
    j2 = accounts_service.create_account(user_id, {"name": "RH", "startingBalance": 1.0}, conn=conn)
    ba_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT INTO j2_broker_accounts
           (id, user_id, snaptrade_account_id, brokerage_name, j2_account_id,
            sync_enabled, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, 'active', ?, ?)""",
        (ba_id, user_id, "snap-x", "Robinhood", j2["id"], now, now))
    conn.commit()
    return ba_id


def test_begin_warming_marks_all_user_accounts():
    init_db()
    conn = get_connection()
    try:
        ba_id = _make_account(conn, "uw1")
    finally:
        conn.close()
    broker_sync_router._begin_warming("uw1")
    acct = connections.get_broker_account("uw1", ba_id)
    assert acct["warming"] is True
```

- [ ] **Step 3: Run test to verify it fails**

Run: `python -m pytest tests/test_broker_connect_sets_warming.py -v`
Expected: FAIL — `AttributeError: module 'api.routers.broker_sync' has no attribute '_begin_warming'`.

- [ ] **Step 4: Add `_begin_warming` and call it from the refresh handler**

In `api/routers/broker_sync.py`, add a module-level helper:

```python
def _begin_warming(user_id: str) -> None:
    """Mark every connected account 'warming' so the warming scheduler runs
    short full re-syncs until SnapTrade's async backfill settles."""
    from datetime import datetime, timezone, timedelta
    from api.services.journal_two.broker import connections, sync as _sync
    until = (datetime.now(timezone.utc)
             + timedelta(hours=_sync.WARMING_WINDOW_HOURS)).isoformat()
    for ba in connections.list_broker_accounts(user_id):
        try:
            connections.set_warming(user_id, ba["id"], until)
        except Exception:  # noqa: BLE001 — warming is best-effort
            pass
```

Then call `_begin_warming(user["id"])` inside the `accounts/refresh` handler, right after the accounts are mapped/refreshed (before returning).

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_broker_connect_sets_warming.py -v`
Expected: PASS (1 passed).

- [ ] **Step 6: Register the scheduler job**

In `api/main.py`, inside the existing `if os.getenv("BROKER_SYNC_ENABLED") == "1":` block, after the nightly-reconcile `add_job` and before the final `print(...)`, add:

```python
            # Import warming — short full re-syncs after a connect until
            # SnapTrade's async backfill settles. Self-limiting (clears on 2
            # stable ticks or a 2h window) + cheap no-op when nobody's warming.
            _bs_warm_interval = int(os.getenv("BROKER_WARMING_INTERVAL_MIN", "3"))
            _scheduler.add_job(
                _broker_sync_engine.run_warming_sync_blocking,
                trigger=IntervalTrigger(minutes=_bs_warm_interval),
                id="broker_sync_warming", max_instances=1, replace_existing=True,
            )
```

- [ ] **Step 7: Verify wiring intact + import boots**

Run:
```bash
grep -c broker_sync api/main.py            # expect >= 7
python -c "import api.main"                 # expect no error
```
Expected: count ≥ 7; clean import.

- [ ] **Step 8: Commit**

```bash
git add api/main.py api/routers/broker_sync.py tests/test_broker_connect_sets_warming.py
git commit -m "feat(broker): warming scheduler job + set warming on connect"
```

---

### Task 4: Day-one equity-curve anchor

When a live broker total exists but the snapshot series has <2 points, append a live "now" anchor so the curve renders. Render-only — never persisted.

**Files:**
- Modify: `api/services/journal_two/broker/performance_service.py`
- Test: `tests/test_broker_performance_anchor.py` (create)

**Interfaces:**
- Produces: the `equitySeries` (or `equity`) list returned by `account_performance` / `portfolio_performance` always has ≥2 points whenever a current broker total is known; the appended point is flagged `estimated: True` and dated "today" (ET). No row is written to `j2_broker_equity_snapshots`.

- [ ] **Step 1: Read the performance service**

Read `api/services/journal_two/broker/performance_service.py`. Identify (a) the function(s) that build the response (`account_performance`, `portfolio_performance`), (b) the exact key name for the curve list in the returned dict (e.g. `equitySeries` — each point likely `{"date": ..., "value": ..., "estimated": ...}`), and (c) how the current live broker total is obtained (e.g. `brokerTotalEquity` / `endEquity` / a balances helper). Match those names exactly below.

- [ ] **Step 2: Write the failing test**

Create `tests/test_broker_performance_anchor.py`. Replace `build_series` with the real internal you found, and the point/total key names to match Step 1:

```python
from api.services.journal_two.broker import performance_service as perf


def test_single_snapshot_gets_live_anchor():
    # One real snapshot + a known current total → 2-point renderable series.
    series = [{"date": "2026-06-22", "value": 10000.0, "estimated": False}]
    out = perf._ensure_renderable_series(series, current_total=10250.0, today="2026-06-22")
    assert len(out) >= 2
    assert out[-1]["estimated"] is True
    assert out[-1]["value"] == 10250.0


def test_empty_series_no_total_unchanged():
    out = perf._ensure_renderable_series([], current_total=None, today="2026-06-22")
    assert out == []


def test_two_real_points_not_modified():
    series = [{"date": "2026-06-20", "value": 100.0, "estimated": False},
              {"date": "2026-06-21", "value": 110.0, "estimated": False}]
    out = perf._ensure_renderable_series(series, current_total=120.0, today="2026-06-22")
    assert len(out) == 2  # already renderable; no anchor added
```

- [ ] **Step 3: Run test to verify it fails**

Run: `python -m pytest tests/test_broker_performance_anchor.py -v`
Expected: FAIL — `AttributeError: ... has no attribute '_ensure_renderable_series'`.

- [ ] **Step 4: Add the helper + call it**

In `performance_service.py`, add:

```python
def _ensure_renderable_series(series: list[dict], *, current_total, today: str) -> list[dict]:
    """Guarantee a >=2-point curve when a live balance exists, without writing
    synthetic snapshots. If <2 real points and we know the current net-liq,
    append a live 'now' anchor (flagged estimated). No-op when already >=2 or
    when there's genuinely no balance to anchor on."""
    if len(series) >= 2 or current_total is None:
        return series
    out = list(series)
    if not out:
        # No history at all — seed both endpoints from the live total so the
        # hero shows a flat baseline rather than nothing.
        out.append({"date": today, "value": float(current_total), "estimated": True})
    if out[-1].get("date") != today:
        out.append({"date": today, "value": float(current_total), "estimated": True})
    return out
```

Then, in each function that returns the curve (`account_performance` / `portfolio_performance`), pass the built series and the current total through `_ensure_renderable_series(...)` immediately before returning, using the real `today` (ET) value already computed there. Use the actual curve key name from Step 1.

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_broker_performance_anchor.py -v`
Expected: PASS (3 passed).

- [ ] **Step 6: Run the broker suite for regressions**

Run: `python -m pytest tests/ -k broker -q`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add api/services/journal_two/broker/performance_service.py tests/test_broker_performance_anchor.py
git commit -m "feat(broker): day-one equity-curve live anchor (render-only)"
```

---

### Task 5: Surface `warming` in /status + relax the curve gate

Expose `warming` per account in the status payload and let the hero render a 2-point anchored series.

**Files:**
- Modify: `api/services/journal_two/broker/service.py` (the per-account status summary)
- Modify: `app/src/pages/journal-2-0/components/BrokerAccountHero.jsx` (gate at line ~50)
- Test: `tests/test_broker_status_warming.py` (create) + `app/src/pages/journal-2-0/components/BrokerAccountHero.test.jsx` (extend)

**Interfaces:**
- Consumes: `connections.get_broker_account(...)["warming"]`.
- Produces: each account object in `GET /api/j2/broker/status` `accounts[]` carries `warming: bool`.

- [ ] **Step 1: Read the status builder**

Read `api/services/journal_two/broker/service.py` and find where each account's status dict is assembled (the one exposing `lastSyncAt`/`lastSyncStatus`/`status`). Note the function name (e.g. `status_for_user`) and the per-account dict literal.

- [ ] **Step 2: Write the failing backend test**

Create `tests/test_broker_status_warming.py`. Adapt to the real status function from Step 1:

```python
from datetime import datetime, timezone, timedelta

from api.services.auth_db import get_connection, init_db
from api.services.journal_two.broker import connections, service


def _make_account(conn, user_id):
    import uuid
    from api.services.journal_two import accounts as accounts_service
    j2 = accounts_service.create_account(user_id, {"name": "RH", "startingBalance": 1.0}, conn=conn)
    ba_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT INTO j2_broker_accounts
           (id, user_id, snaptrade_account_id, brokerage_name, j2_account_id,
            sync_enabled, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, 'active', ?, ?)""",
        (ba_id, user_id, "snap-st", "Robinhood", j2["id"], now, now))
    conn.commit()
    return ba_id


def test_status_exposes_warming_flag():
    init_db()
    conn = get_connection()
    try:
        ba_id = _make_account(conn, "us1")
        connections.set_warming("us1", ba_id,
                                (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
                                conn=conn)
    finally:
        conn.close()
    st = service.status_for_user("us1")  # <- replace with the real function name
    acct = next(a for a in st["accounts"] if a["id"] == ba_id)
    assert acct["warming"] is True
```

- [ ] **Step 3: Run test to verify it fails**

Run: `python -m pytest tests/test_broker_status_warming.py -v`
Expected: FAIL — `KeyError: 'warming'`.

- [ ] **Step 4: Add `warming` to the status dict**

In `service.py`, in the per-account status dict, add `"warming": ba.get("warming", False),` (where `ba` is the `connections.get_broker_account`/`list_broker_accounts` dict for that account).

- [ ] **Step 5: Run backend test to verify it passes**

Run: `python -m pytest tests/test_broker_status_warming.py -v`
Expected: PASS.

- [ ] **Step 6: Relax the hero curve gate**

In `app/src/pages/journal-2-0/components/BrokerAccountHero.jsx`, the model memo currently early-returns on `series.length < 2`. With Task 4 the backend now always returns ≥2 points when a balance exists, so this gate already passes — but make the intent explicit and guard the 1-point edge: change

```js
  if (series.length < 2) return null
```

to

```js
  // Day one: backend appends a live "now" anchor so a single real snapshot
  // still yields a 2-point baseline. Only bail when truly empty.
  if (series.length < 1) return null
  if (series.length === 1) {
    // Defensive: flat baseline if the anchor wasn't added (e.g. no live total).
    const only = series[0]
    return buildFlatModel ? buildFlatModel(only) : null
  }
```

If a `buildFlatModel` helper doesn't already exist, instead keep `if (series.length < 2) return null` (the backend anchor covers the real case) and rely on Task 4 — choose the smaller change that keeps existing tests green. The required behavior: a real account with one snapshot + a live total renders a curve.

- [ ] **Step 7: Extend the hero test**

In `app/src/pages/journal-2-0/components/BrokerAccountHero.test.jsx`, add a case feeding a 2-point series where the last point has `estimated: true`, and assert the curve/SVG renders (not the null state). Mirror the existing test's mocking of `useJ2BrokerPerformance`.

- [ ] **Step 8: Run frontend tests**

Run: `cd app && npx vitest run src/pages/journal-2-0/components/BrokerAccountHero.test.jsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add api/services/journal_two/broker/service.py app/src/pages/journal-2-0/components/BrokerAccountHero.jsx app/src/pages/journal-2-0/components/BrokerAccountHero.test.jsx tests/test_broker_status_warming.py
git commit -m "feat(broker): expose warming in /status + render day-one curve"
```

---

### Task 6: "Importing" banner + poll-then-refresh (frontend)

While any account is warming, show a branded importing banner and poll `/status`; when warming clears, revalidate trades + curve so they appear without a manual refresh.

**Files:**
- Create: `app/src/pages/journal-2-0/components/BrokerImportingBanner.jsx` + `.module.css`
- Create: `app/src/pages/journal-2-0/hooks/useBrokerWarming.js`
- Modify: `app/src/pages/journal-2-0/components/BrokerConnectionsCard.jsx` (show banner while warming)
- Modify: `app/src/pages/journal-2-0/tabs/OpenPositionsTab.jsx` and/or `TradeJournalTab.jsx` (show banner above the empty state while warming)
- Test: `app/src/pages/journal-2-0/components/BrokerImportingBanner.test.jsx` (create)

**Interfaces:**
- Consumes: `GET /api/j2/broker/status` (`accounts[].warming`).
- Produces:
  - `useBrokerWarming()` → `{ warming: boolean, refresh: () => void }` — SWR on `/api/j2/broker/status` with `refreshInterval: 25000` while any account warms (else no polling); calls the SWR global mutate for trades/positions/performance keys when `warming` transitions true→false.
  - `<BrokerImportingBanner broker={name} />` — branded copy, `UIcon` (e.g. `name="sync"` / `"refresh"`), NO emoji.

- [ ] **Step 1: Write the failing test**

Create `app/src/pages/journal-2-0/components/BrokerImportingBanner.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import BrokerImportingBanner from './BrokerImportingBanner'

describe('BrokerImportingBanner', () => {
  it('renders branded importing copy with the broker name', () => {
    render(<BrokerImportingBanner broker="Robinhood" />)
    expect(screen.getByText(/importing your full robinhood history/i)).toBeInTheDocument()
  })

  it('uses no generic emoji', () => {
    const { container } = render(<BrokerImportingBanner broker="Robinhood" />)
    // No emoji codepoints in the rendered text.
    expect(/\p{Extended_Pictographic}/u.test(container.textContent)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/journal-2-0/components/BrokerImportingBanner.test.jsx`
Expected: FAIL — cannot resolve `./BrokerImportingBanner`.

- [ ] **Step 3: Create the banner component**

Create `app/src/pages/journal-2-0/components/BrokerImportingBanner.jsx`:

```jsx
import UIcon from '../../../components/ui/UIcon'
import styles from './BrokerImportingBanner.module.css'

export default function BrokerImportingBanner({ broker }) {
  const name = broker || 'your brokerage'
  return (
    <div className={styles.banner} role="status" aria-live="polite">
      <span className={styles.spin}><UIcon name="sync" size={18} /></span>
      <div className={styles.copy}>
        <strong>Importing your full {name} history</strong>
        <span className={styles.sub}>
          Your trades and equity curve fill in over the next few minutes — no need to refresh.
        </span>
      </div>
    </div>
  )
}
```

Create `app/src/pages/journal-2-0/components/BrokerImportingBanner.module.css`:

```css
.banner {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px; margin-bottom: 12px;
  border: 1px solid var(--color-border, #2a2a2a);
  border-radius: 10px;
  background: var(--color-surface-2, rgba(255,255,255,0.03));
}
.copy { display: flex; flex-direction: column; gap: 2px; }
.sub { color: var(--color-text-muted, #9aa0a6); font-size: 12px; }
.spin { display: inline-flex; animation: bs-spin 1.4s linear infinite; }
@keyframes bs-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
```

(If `UIcon` has no `"sync"` glyph, use an existing one like `"refresh"` or `"clock"` — check the registry in `app/src/components/ui/UIcon.jsx`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/journal-2-0/components/BrokerImportingBanner.test.jsx`
Expected: PASS (2 passed).

- [ ] **Step 5: Create the warming hook**

Create `app/src/pages/journal-2-0/hooks/useBrokerWarming.js`:

```js
import { useEffect, useRef } from 'react'
import useSWR, { useSWRConfig } from 'swr'

const fetcher = (u) => fetch(u, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

/**
 * Polls broker status while any account is warming (post-connect backfill).
 * Returns { warming, broker, refresh }. On warming true→false, revalidates the
 * trades/positions/performance SWR keys so the journal fills in automatically.
 */
export default function useBrokerWarming() {
  const { mutate } = useSWRConfig()
  const wasWarming = useRef(false)
  const { data } = useSWR('/api/j2/broker/status', fetcher, { refreshInterval: 25000 })

  const accounts = data?.accounts || []
  const warmingAcct = accounts.find((a) => a.warming)
  const warming = Boolean(warmingAcct)
  const broker = warmingAcct?.brokerageName

  useEffect(() => {
    if (wasWarming.current && !warming) {
      // Backfill just settled — refresh everything the import populates.
      mutate((key) => typeof key === 'string' && (
        key.includes('/api/j2/positions') ||
        key.includes('/api/j2/trades') ||
        key.includes('/api/j2/broker/performance') ||
        key.includes('/api/j2/broker/equity-curve')
      ), undefined, { revalidate: true })
    }
    wasWarming.current = warming
  }, [warming, mutate])

  return { warming, broker, refresh: () => mutate('/api/j2/broker/status') }
}
```

- [ ] **Step 6: Mount the banner**

In `BrokerConnectionsCard.jsx`, `OpenPositionsTab.jsx`, and `TradeJournalTab.jsx`, call `const { warming, broker } = useBrokerWarming()` and render `{warming && <BrokerImportingBanner broker={broker} />}` above the existing content / empty state. In the tabs, place it above the table so an empty journal reads as "importing", not "no trades".

- [ ] **Step 7: Build the frontend**

Run: `cd app && npm run build`
Expected: build succeeds (validates imports + JSX).

- [ ] **Step 8: Commit**

```bash
git add app/src/pages/journal-2-0/components/BrokerImportingBanner.jsx app/src/pages/journal-2-0/components/BrokerImportingBanner.module.css app/src/pages/journal-2-0/hooks/useBrokerWarming.js app/src/pages/journal-2-0/components/BrokerConnectionsCard.jsx app/src/pages/journal-2-0/tabs/OpenPositionsTab.jsx app/src/pages/journal-2-0/tabs/TradeJournalTab.jsx app/src/pages/journal-2-0/components/BrokerImportingBanner.test.jsx
git commit -m "feat(broker): importing banner + poll-then-refresh while warming"
```

---

### Task 7: Full regression + ship

**Files:** none (verification + deploy).

- [ ] **Step 1: Backend broker suite**

Run: `python -m pytest tests/ -k broker -q`
Expected: all green.

- [ ] **Step 2: Frontend journal-2-0 suite**

Run: `cd app && npx vitest run src/pages/journal-2-0`
Expected: all green.

- [ ] **Step 3: Build + wiring check**

Run:
```bash
cd app && npm run build && cd ..
grep -c broker_sync api/main.py    # >= 7
python -c "import api.main"
```
Expected: build OK; count ≥ 7; clean import.

- [ ] **Step 4: Fast-forward push to master**

Run:
```bash
git fetch origin
git rebase origin/master         # resolve cleanly; never touch files you didn't author
git push origin investigate-broker-sync:master
```
Expected: fast-forward push accepted. (Per shared-tree lesson: stage only your files, never `git add -A`.)

- [ ] **Step 5: Verify deploy**

After Railway deploys: `railway deployment list` → newest SUCCESS. In the browser (logged-in), reconnect/observe a connected account: within a few minutes the importing banner appears, then trades + a 2-point curve populate without a manual refresh.
