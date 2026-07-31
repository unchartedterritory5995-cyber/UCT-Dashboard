# The Wire — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live earnings feed at `/calendar` → "Wire" that shows a reporter the moment its price moves on a print or its actuals land, and records **how long each source took** so Phase 2 can be aimed rather than guessed.

**Architecture:** A scheduler job on the web pod polls one all-tickers Massive snapshot per tick, gates moves on liquidity, and upserts rows into a new SQLite store. `GET /api/calendar/wire` is a pure table read — no provider fan-out on the request path. The frontend polls it and renders rows in immutable arrival order, with visual weight proportional to significance.

**Tech Stack:** FastAPI, SQLite (`/data/earnings_wire.db`), APScheduler, React + Vite, SWR (`useMobileSWR`), pytest, vitest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-31-calendar-earnings-wire-design.md`. Read it before Task 1.
- **Phase 1 sources are PRICE + Finnhub/FMP only.** No TwitterAPI, no Perplexity, no LLM parsing — those are Phase 2/3. Do not build them here.
- **No alerts in Phase 1.** No `wire_alerts_fired` table, no `watchlist_alert_service` calls. Phase 3.
- **Position = time.** Row order is by `first_seen_at` and a row NEVER changes position once placed. Significance drives visual weight only.
- **A move only counts if it is liquid** — see Task 3. An illiquid tick must not create a row.
- **No new SSE rail.** Frontend polls. The web pod is one uvicorn process; a second stream is the 2026-07-01 524 class.
- **Everything behind `WIRE_ENABLED`** (default off). The detector job must not register when unset.
- **Work in the existing worktree** `C:\Users\Patrick\uct-worktrees\calendar-perf` on branch `perf/calendar-load`. Never `git add -A` — this repo shares a worktree tree; stage explicit paths only.
- Run backend tests with `python -m pytest <path> -q -p no:warnings` from the worktree root.

## File Structure

| File | Responsibility |
|------|----------------|
| `api/services/wire/__init__.py` | package marker |
| `api/services/wire/session.py` | `market_session_date()` — the ET session date used as PK + dedup key |
| `api/services/wire/store.py` | SQLite CRUD for `wire_prints`. No business logic. |
| `api/services/wire/detect.py` | **Pure** decision logic: snapshot + reporters + existing rows → upserts. No I/O. |
| `api/services/wire/detector.py` | The job: pulls providers, calls `detect`, writes via `store` |
| `api/routers/wire.py` | `GET /api/calendar/wire` — table read only |
| `api/main.py` | scheduler registration, flag-gated |
| `app/src/pages/calendar/useWire.js` | SWR hook |
| `app/src/pages/calendar/WireView.jsx` | the feed: stable order, emphasis, freeze-on-read, empty state |
| `app/src/pages/calendar/WireView.module.css` | styles |
| `app/src/pages/calendar/CalendarHeader.jsx` | add `wire` to `VIEWS` |
| `app/src/pages/Calendar.jsx` | render branch for `view === 'wire'` |

`detect.py` is deliberately pure so the state machine is testable without providers. `detector.py` is the only file that touches the network.

---

### Task 1: Session date

**Files:**
- Create: `api/services/wire/__init__.py`, `api/services/wire/session.py`
- Test: `tests/test_wire_session.py`

**Interfaces:**
- Produces: `market_session_date(now: datetime | None = None) -> str` — ISO `YYYY-MM-DD`

This is the primary key and (in Phase 3) the alert-dedup key. Getting it wrong scrambles both, so it ships first and alone.

- [ ] **Step 1: Write the failing test**

```python
from datetime import datetime
from zoneinfo import ZoneInfo

from api.services.wire.session import market_session_date

ET = ZoneInfo("America/New_York")


def test_amc_print_belongs_to_that_weekday():
    """16:05 ET Friday is Friday's AMC session."""
    assert market_session_date(datetime(2026, 7, 31, 16, 5, tzinfo=ET)) == "2026-07-31"


def test_bmo_print_belongs_to_its_own_day():
    """06:30 ET Monday is Monday's BMO session, not Friday's."""
    assert market_session_date(datetime(2026, 8, 3, 6, 30, tzinfo=ET)) == "2026-08-03"


def test_weekend_resolves_back_to_the_last_weekday():
    """Opening the wire on Saturday shows Friday's session, not an empty Saturday."""
    assert market_session_date(datetime(2026, 8, 1, 11, 0, tzinfo=ET)) == "2026-07-31"
    assert market_session_date(datetime(2026, 8, 2, 11, 0, tzinfo=ET)) == "2026-07-31"


def test_naive_datetime_is_treated_as_ET_not_UTC():
    """A naive datetime must not silently shift the session by the UTC offset."""
    assert market_session_date(datetime(2026, 7, 31, 16, 5)) == "2026-07-31"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_wire_session.py -q -p no:warnings`
Expected: FAIL — `ModuleNotFoundError: No module named 'api.services.wire'`

- [ ] **Step 3: Write minimal implementation**

Create `api/services/wire/__init__.py` (empty file), then `api/services/wire/session.py`:

```python
"""The ET session date a print belongs to.

This is the wire's PRIMARY KEY and (Phase 3) its alert-dedup key, so it is its
own module with its own tests. `date.today()` is wrong here: the box is Central,
and a 16:05 ET print must land on the ET session regardless of host timezone.

Weekday-based, matching `calendar.py::_prev_trading_day`. Market holidays need no
special case: on a holiday there are no scheduled reporters, so the wire is
correctly empty rather than wrong.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")


def market_session_date(now: datetime | None = None) -> str:
    """ISO date of the trading session a print at `now` belongs to."""
    if now is None:
        now = datetime.now(_ET)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=_ET)      # naive means ET here, never UTC
    else:
        now = now.astimezone(_ET)

    d = now.date()
    while d.weekday() >= 5:                # Sat/Sun -> back to Friday
        d -= timedelta(days=1)
    return d.isoformat()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_wire_session.py -q -p no:warnings`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add api/services/wire/__init__.py api/services/wire/session.py tests/test_wire_session.py
git commit -m "wire: ET session date, the wire's primary key"
```

---

### Task 2: The store

**Files:**
- Create: `api/services/wire/store.py`
- Test: `tests/test_wire_store.py`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `upsert_print(row: dict) -> None` — keys: `market_date, sym, timing, first_seen_at, trigger, eps_act, eps_est, rev_act, rev_est, eps_src, rev_src, confirmed, peak_move_pct`
  - `get_prints(market_date: str) -> list[dict]` — ordered by `first_seen_at` ASC
  - `get_print(market_date: str, sym: str) -> dict | None`
  - `_init_db() -> None`
  - Module honours `WIRE_DB_PATH` env (default `/data/earnings_wire.db`)

- [ ] **Step 1: Write the failing test**

```python
import importlib

import pytest


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("WIRE_DB_PATH", str(tmp_path / "wire.db"))
    import api.services.wire.store as s
    importlib.reload(s)
    s._init_db()
    return s


def _row(sym="NVDA", seen=1000.0, **kw):
    base = dict(market_date="2026-07-31", sym=sym, timing="amc",
                first_seen_at=seen, trigger="price",
                eps_act=None, eps_est=1.11, rev_act=None, rev_est=49.8e9,
                eps_src=None, rev_src=None, confirmed=0, peak_move_pct=6.4)
    base.update(kw)
    return base


def test_roundtrip(store):
    store.upsert_print(_row())
    got = store.get_print("2026-07-31", "NVDA")
    assert got["sym"] == "NVDA"
    assert got["trigger"] == "price"
    assert got["confirmed"] == 0


def test_first_seen_at_is_immutable_across_upserts(store):
    """Row order is by first_seen_at. If an upgrade moved it, rows would jump."""
    store.upsert_print(_row(seen=1000.0))
    store.upsert_print(_row(seen=9999.0, eps_act=1.24, confirmed=1))
    got = store.get_print("2026-07-31", "NVDA")
    assert got["first_seen_at"] == 1000.0, "an upgrade rewrote the arrival time"
    assert got["eps_act"] == 1.24, "the upgrade did not land"
    assert got["confirmed"] == 1


def test_get_prints_is_ordered_by_arrival(store):
    store.upsert_print(_row(sym="AMD", seen=3000.0))
    store.upsert_print(_row(sym="NVDA", seen=1000.0))
    store.upsert_print(_row(sym="SBUX", seen=2000.0))
    assert [r["sym"] for r in store.get_prints("2026-07-31")] == ["NVDA", "SBUX", "AMD"]


def test_days_are_isolated(store):
    store.upsert_print(_row(sym="NVDA"))
    store.upsert_print(_row(sym="AMD", market_date="2026-08-03"))
    assert [r["sym"] for r in store.get_prints("2026-07-31")] == ["NVDA"]


def test_peak_move_only_ratchets_upward(store):
    """peak_move_pct drives ranking; a pullback must not erase the spike."""
    store.upsert_print(_row(peak_move_pct=9.0))
    store.upsert_print(_row(peak_move_pct=2.0))
    assert store.get_print("2026-07-31", "NVDA")["peak_move_pct"] == 9.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_wire_store.py -q -p no:warnings`
Expected: FAIL — `No module named 'api.services.wire.store'`

- [ ] **Step 3: Write minimal implementation**

```python
"""SQLite store for the earnings wire. CRUD only — no business logic.

Own DB on the Railway volume, mirroring catalysts.db / tweets.db / cot.db.
The sticky-actuals JSON ledger was rejected for this: it is a whole-file rewrite
under a lock, which would thrash during a 250-name print window.
"""
from __future__ import annotations

import os
import sqlite3
import threading

_DB_PATH = os.environ.get("WIRE_DB_PATH", "/data/earnings_wire.db")
_WRITE_LOCK = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS wire_prints (
  market_date   TEXT NOT NULL,
  sym           TEXT NOT NULL,
  timing        TEXT,
  first_seen_at REAL NOT NULL,
  trigger       TEXT,
  eps_act REAL, eps_est REAL,
  rev_act REAL, rev_est REAL,
  eps_src TEXT, rev_src TEXT,
  confirmed     INTEGER DEFAULT 0,
  peak_move_pct REAL DEFAULT 0.0,
  updated_at    REAL,
  PRIMARY KEY (market_date, sym)
);
CREATE INDEX IF NOT EXISTS idx_wire_day_seen ON wire_prints(market_date, first_seen_at);
"""

_FIELDS = ("market_date", "sym", "timing", "first_seen_at", "trigger",
           "eps_act", "eps_est", "rev_act", "rev_est",
           "eps_src", "rev_src", "confirmed", "peak_move_pct")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _init_db() -> None:
    parent = os.path.dirname(_DB_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with _connect() as conn:
        conn.executescript(_SCHEMA)


def upsert_print(row: dict) -> None:
    """Insert, or upgrade an existing row in place.

    `first_seen_at` is preserved on conflict (arrival order is immutable — the
    feed sorts on it and a row must never move) and `peak_move_pct` only
    ratchets upward, so a pullback cannot erase the spike that ranked it.
    """
    vals = [row.get(f) for f in _FIELDS]
    with _WRITE_LOCK, _connect() as conn:
        conn.execute(
            f"""INSERT INTO wire_prints ({','.join(_FIELDS)}, updated_at)
                VALUES ({','.join('?' * len(_FIELDS))}, strftime('%s','now'))
                ON CONFLICT(market_date, sym) DO UPDATE SET
                  timing        = COALESCE(excluded.timing, wire_prints.timing),
                  trigger       = COALESCE(wire_prints.trigger, excluded.trigger),
                  eps_act       = COALESCE(excluded.eps_act, wire_prints.eps_act),
                  eps_est       = COALESCE(excluded.eps_est, wire_prints.eps_est),
                  rev_act       = COALESCE(excluded.rev_act, wire_prints.rev_act),
                  rev_est       = COALESCE(excluded.rev_est, wire_prints.rev_est),
                  eps_src       = COALESCE(excluded.eps_src, wire_prints.eps_src),
                  rev_src       = COALESCE(excluded.rev_src, wire_prints.rev_src),
                  confirmed     = MAX(excluded.confirmed, wire_prints.confirmed),
                  peak_move_pct = MAX(excluded.peak_move_pct, wire_prints.peak_move_pct),
                  updated_at    = strftime('%s','now')
            """, vals)


def get_prints(market_date: str) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM wire_prints WHERE market_date=? ORDER BY first_seen_at ASC",
            (market_date,)).fetchall()
    return [dict(r) for r in rows]


def get_print(market_date: str, sym: str) -> dict | None:
    with _connect() as conn:
        r = conn.execute(
            "SELECT * FROM wire_prints WHERE market_date=? AND sym=?",
            (market_date, sym)).fetchone()
    return dict(r) if r else None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_wire_store.py -q -p no:warnings`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add api/services/wire/store.py tests/test_wire_store.py
git commit -m "wire: SQLite store with immutable arrival order and ratcheting peak move"
```

---

### Task 3: Detection — the liquidity gate

**Files:**
- Create: `api/services/wire/detect.py`
- Test: `tests/test_wire_detect.py`

**Interfaces:**
- Consumes: nothing (pure)
- Produces:
  - `MIN_MOVE_PCT: float = 2.0`, `MIN_TRADE_VALUE_USD: float = 250_000.0`
  - `is_liquid_move(snap: dict, min_value_usd: float = MIN_TRADE_VALUE_USD) -> bool`
  - `move_pct(snap: dict) -> float | None`
  - `detect_rows(reporters, snapshot, existing, now_ts, market_date) -> list[dict]`
    - `reporters: list[dict]` each `{sym, timing, eps_est, rev_est, eps_act, rev_act}`
    - `snapshot: dict[str, dict]` from `get_full_market_snapshot()`
    - `existing: dict[str, dict]` sym → stored row
    - returns rows ready for `store.upsert_print`

This is the whole state machine and it is pure, so it is tested without a single network call.

- [ ] **Step 1: Write the failing test**

```python
from api.services.wire.detect import detect_rows, is_liquid_move, move_pct

DAY = "2026-07-31"


def _snap(last, prev, today_vol):
    return {"last_price": last, "prev_close": prev,
            "today_vol": today_vol, "prev_vol": 5_000_000}


def _rep(sym="NVDA", **kw):
    base = dict(sym=sym, timing="amc", eps_est=1.11, rev_est=49.8e9,
                eps_act=None, rev_act=None)
    base.update(kw)
    return base


# ── the liquidity gate ────────────────────────────────────────────────────────

def test_a_thin_tape_move_is_not_a_move():
    """+12% on 200 shares is noise. It must not create a row or rank."""
    thin = _snap(last=112.0, prev=100.0, today_vol=200)
    assert is_liquid_move(thin) is False


def test_a_real_move_on_real_volume_counts():
    assert is_liquid_move(_snap(last=112.0, prev=100.0, today_vol=500_000)) is True


def test_move_pct_is_measured_against_the_regular_session_close():
    assert round(move_pct(_snap(last=106.4, prev=100.0, today_vol=10**6)), 2) == 6.40


def test_missing_prev_close_yields_no_move_rather_than_infinity():
    assert move_pct({"last_price": 5.0, "prev_close": 0.0, "today_vol": 10**6}) is None


# ── the state machine ─────────────────────────────────────────────────────────

def test_a_liquid_move_creates_a_row_before_any_numbers_exist():
    rows = detect_rows([_rep()], {"NVDA": _snap(106.4, 100.0, 10**6)},
                       existing={}, now_ts=1000.0, market_date=DAY)
    assert len(rows) == 1
    assert rows[0]["trigger"] == "price"
    assert rows[0]["first_seen_at"] == 1000.0
    assert rows[0]["eps_act"] is None
    assert rows[0]["confirmed"] == 0


def test_actuals_alone_create_a_row_even_with_no_move():
    """A name that prints in line still belongs on the wire."""
    rows = detect_rows([_rep(eps_act=1.24, rev_act=51.2e9)],
                       {"NVDA": _snap(100.1, 100.0, 10**6)},
                       existing={}, now_ts=1000.0, market_date=DAY)
    assert len(rows) == 1
    assert rows[0]["trigger"] == "actuals"
    assert rows[0]["confirmed"] == 1


def test_a_quiet_name_with_no_numbers_never_enters_the_wire():
    rows = detect_rows([_rep()], {"NVDA": _snap(100.1, 100.0, 10**6)},
                       existing={}, now_ts=1000.0, market_date=DAY)
    assert rows == []


def test_an_existing_row_upgrades_and_keeps_its_arrival_time():
    existing = {"NVDA": {"sym": "NVDA", "first_seen_at": 500.0,
                         "trigger": "price", "eps_act": None,
                         "confirmed": 0, "peak_move_pct": 6.4}}
    rows = detect_rows([_rep(eps_act=1.24, rev_act=51.2e9)],
                       {"NVDA": _snap(106.4, 100.0, 10**6)},
                       existing=existing, now_ts=9999.0, market_date=DAY)
    assert rows[0]["first_seen_at"] == 500.0, "the upgrade rewrote arrival order"
    assert rows[0]["eps_act"] == 1.24
    assert rows[0]["confirmed"] == 1


def test_an_unchanged_row_produces_no_write():
    """The detector runs every ~20s; it must not rewrite unchanged rows."""
    existing = {"NVDA": {"sym": "NVDA", "first_seen_at": 500.0, "trigger": "price",
                         "eps_act": 1.24, "rev_act": 51.2e9,
                         "confirmed": 1, "peak_move_pct": 6.4}}
    rows = detect_rows([_rep(eps_act=1.24, rev_act=51.2e9)],
                       {"NVDA": _snap(106.4, 100.0, 10**6)},
                       existing=existing, now_ts=9999.0, market_date=DAY)
    assert rows == []


def test_a_thin_tape_spike_cannot_create_a_row():
    """The gate applies to row CREATION, not just ranking."""
    rows = detect_rows([_rep()], {"NVDA": _snap(112.0, 100.0, 200)},
                       existing={}, now_ts=1000.0, market_date=DAY)
    assert rows == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_wire_detect.py -q -p no:warnings`
Expected: FAIL — `No module named 'api.services.wire.detect'`

- [ ] **Step 3: Write minimal implementation**

```python
"""Pure decision logic for the wire. NO I/O — every provider call lives in
detector.py, so this whole state machine is testable without the network.

A row enters the wire when EITHER its price moves (liquid) OR its actuals land.
Whichever fires first sets `first_seen_at`, which is then IMMUTABLE: the feed
sorts on it and a row must never move once the reader has seen it.
"""
from __future__ import annotations

MIN_MOVE_PCT = 2.0
# Extended-hours tape is thin: a name can print +12% on 200 shares. Requiring a
# minimum traded VALUE (not share count) keeps the gate meaningful across a $4
# stock and a $400 one. Without this the wire manufactures fake movers at exactly
# the moment it is trusted -- and (Phase 3) alerts on them.
MIN_TRADE_VALUE_USD = 250_000.0


def move_pct(snap: dict) -> float | None:
    """% move of the last (extended-hours-aware) print vs the regular close."""
    prev = float(snap.get("prev_close") or 0.0)
    last = float(snap.get("last_price") or 0.0)
    if prev <= 0 or last <= 0:
        return None
    return (last - prev) / prev * 100.0


def is_liquid_move(snap: dict, min_value_usd: float = MIN_TRADE_VALUE_USD) -> bool:
    last = float(snap.get("last_price") or 0.0)
    vol = float(snap.get("today_vol") or 0.0)
    return last > 0 and (last * vol) >= min_value_usd


def _has_actuals(rep: dict) -> bool:
    return rep.get("eps_act") is not None or rep.get("rev_act") is not None


def detect_rows(reporters, snapshot, existing, now_ts, market_date) -> list[dict]:
    """Rows needing a write. Returns [] for anything unchanged."""
    out = []
    for rep in reporters:
        sym = rep.get("sym")
        if not sym:
            continue
        snap = snapshot.get(sym) or {}
        mv = move_pct(snap)
        moved = (mv is not None and abs(mv) >= MIN_MOVE_PCT
                 and is_liquid_move(snap))
        has_act = _has_actuals(rep)
        prior = existing.get(sym)

        if prior is None:
            if not (moved or has_act):
                continue
            out.append({
                "market_date": market_date, "sym": sym,
                "timing": rep.get("timing"),
                "first_seen_at": now_ts,
                "trigger": "actuals" if has_act else "price",
                "eps_act": rep.get("eps_act"), "eps_est": rep.get("eps_est"),
                "rev_act": rep.get("rev_act"), "rev_est": rep.get("rev_est"),
                "eps_src": "provider" if has_act else None,
                "rev_src": "provider" if rep.get("rev_act") is not None else None,
                "confirmed": 1 if has_act else 0,
                "peak_move_pct": abs(mv) if mv is not None and moved else 0.0,
            })
            continue

        # Existing row: write only if something actually changed.
        new_peak = max(float(prior.get("peak_move_pct") or 0.0),
                       abs(mv) if (mv is not None and moved) else 0.0)
        gained_act = has_act and prior.get("eps_act") is None
        peak_grew = new_peak > float(prior.get("peak_move_pct") or 0.0) + 1e-9
        if not (gained_act or peak_grew):
            continue
        out.append({
            "market_date": market_date, "sym": sym,
            "timing": rep.get("timing"),
            "first_seen_at": prior["first_seen_at"],   # IMMUTABLE
            "trigger": prior.get("trigger"),
            "eps_act": rep.get("eps_act"), "eps_est": rep.get("eps_est"),
            "rev_act": rep.get("rev_act"), "rev_est": rep.get("rev_est"),
            "eps_src": "provider" if has_act else prior.get("eps_src"),
            "rev_src": ("provider" if rep.get("rev_act") is not None
                        else prior.get("rev_src")),
            "confirmed": 1 if has_act else int(prior.get("confirmed") or 0),
            "peak_move_pct": new_peak,
        })
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_wire_detect.py -q -p no:warnings`
Expected: PASS (10 tests)

- [ ] **Step 5: Mutation-check the liquidity gate**

A guard is only real if removing it fails a test. Temporarily change
`is_liquid_move` to `return True`, run
`python -m pytest tests/test_wire_detect.py -q -p no:warnings`, and confirm
**`test_a_thin_tape_move_is_not_a_move` and `test_a_thin_tape_spike_cannot_create_a_row` FAIL**.
Then restore the original body by editing it back in place.
⚠️ Do NOT `git checkout --` to restore — it reverts to HEAD and wipes uncommitted work.

- [ ] **Step 6: Commit**

```bash
git add api/services/wire/detect.py tests/test_wire_detect.py
git commit -m "wire: pure detection state machine with a liquidity gate"
```

---

### Task 4: The detector job

**Files:**
- Create: `api/services/wire/detector.py`
- Test: `tests/test_wire_detector.py`

**Interfaces:**
- Consumes: `session.market_session_date`, `store.upsert_print/get_prints/_init_db`, `detect.detect_rows`
- Produces:
  - `run_wire_tick(now_ts: float | None = None) -> dict` → `{"market_date", "scanned", "written"}`
  - `todays_reporters(market_date: str) -> list[dict]`

`run_wire_tick` is the only network-touching function. It must never raise into the scheduler.

- [ ] **Step 1: Write the failing test**

```python
import importlib
from unittest import mock

import pytest


@pytest.fixture
def mod(tmp_path, monkeypatch):
    monkeypatch.setenv("WIRE_DB_PATH", str(tmp_path / "wire.db"))
    import api.services.wire.store as s
    importlib.reload(s)
    s._init_db()
    import api.services.wire.detector as d
    importlib.reload(d)
    return d, s


def _snap(last, prev, vol=10**6):
    return {"last_price": last, "prev_close": prev, "today_vol": vol, "prev_vol": 10**6}


def test_a_tick_writes_a_mover_and_is_idempotent(mod):
    detector, store = mod
    reporters = [{"sym": "NVDA", "timing": "amc", "eps_est": 1.11,
                  "rev_est": 49.8e9, "eps_act": None, "rev_act": None}]
    with mock.patch.object(detector, "todays_reporters", return_value=reporters), \
         mock.patch.object(detector, "_market_snapshot",
                           return_value={"NVDA": _snap(106.4, 100.0)}):
        first = detector.run_wire_tick(now_ts=1000.0)
        second = detector.run_wire_tick(now_ts=2000.0)

    assert first["written"] == 1
    assert second["written"] == 0, "an unchanged tick rewrote the row"
    rows = store.get_prints(first["market_date"])
    assert len(rows) == 1
    assert rows[0]["first_seen_at"] == 1000.0


def test_a_provider_failure_never_raises_into_the_scheduler(mod):
    detector, _ = mod
    with mock.patch.object(detector, "todays_reporters",
                           side_effect=RuntimeError("finnhub down")):
        result = detector.run_wire_tick(now_ts=1000.0)
    assert result["written"] == 0
    assert result.get("error")


def test_a_snapshot_failure_still_lets_actuals_through(mod):
    """Degrade to what we have -- never blank."""
    detector, store = mod
    reporters = [{"sym": "AMD", "timing": "amc", "eps_est": 0.94,
                  "rev_est": 7e9, "eps_act": 0.98, "rev_act": 7.1e9}]
    with mock.patch.object(detector, "todays_reporters", return_value=reporters), \
         mock.patch.object(detector, "_market_snapshot", return_value={}):
        result = detector.run_wire_tick(now_ts=1000.0)
    assert result["written"] == 1
    assert store.get_print(result["market_date"], "AMD")["confirmed"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_wire_detector.py -q -p no:warnings`
Expected: FAIL — `No module named 'api.services.wire.detector'`

- [ ] **Step 3: Write minimal implementation**

```python
"""The wire's only network-touching module.

Runs on the WEB pod next to the catalyst engine (Phase 3 alerts need auth.db,
which is web-local). Registered with max_instances=1 -- a slow tick must never
stack on the next one.

Restart-safe by construction: the store is the truth, so a redeploy mid-window
loses nothing. `existing` is re-read every tick, so a row already recorded is
recognised rather than re-created with a new arrival time.
"""
from __future__ import annotations

import logging
import time

from api.services.wire import detect, store
from api.services.wire.session import market_session_date

_logger = logging.getLogger(__name__)


def _market_snapshot() -> dict:
    """One all-tickers call: extended-hours-aware last_price + prev_close + volume
    for every symbol. One request covers all ~250 reporters AND feeds the
    liquidity gate."""
    from api.services.massive import _get_client
    return _get_client().get_full_market_snapshot()


def todays_reporters(market_date: str) -> list[dict]:
    """This session's reporters, with whatever estimates/actuals exist so far.
    Reuses the calendar payload -- the wire adds no second earnings schedule."""
    from api.routers.calendar import get_calendar
    payload = get_calendar() or {}
    day = (payload.get("days") or {}).get(market_date) or {}
    out = []
    for timing in ("bmo", "amc", "tbd"):
        for e in day.get(timing) or []:
            if e.get("sym"):
                out.append({"sym": e["sym"], "timing": timing,
                            "eps_est": e.get("eps_est"), "rev_est": e.get("rev_est"),
                            "eps_act": e.get("eps_act"), "rev_act": e.get("rev_act")})
    return out


def run_wire_tick(now_ts: float | None = None) -> dict:
    """One detection pass. NEVER raises -- the scheduler must survive any provider."""
    ts = time.time() if now_ts is None else now_ts
    md = market_session_date()
    result = {"market_date": md, "scanned": 0, "written": 0}
    try:
        reporters = todays_reporters(md)
        result["scanned"] = len(reporters)
        if not reporters:
            return result
        try:
            snapshot = _market_snapshot()
        except Exception as exc:                 # price gone -> actuals still land
            _logger.warning("wire: snapshot failed: %s", exc)
            snapshot = {}
        existing = {r["sym"]: r for r in store.get_prints(md)}
        rows = detect.detect_rows(reporters, snapshot, existing, ts, md)
        for row in rows:
            store.upsert_print(row)
        result["written"] = len(rows)
    except Exception as exc:
        _logger.warning("wire: tick failed: %s", exc)
        result["error"] = str(exc)
    return result
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_wire_detector.py -q -p no:warnings`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add api/services/wire/detector.py tests/test_wire_detector.py
git commit -m "wire: detector tick — one snapshot call, degrades instead of failing"
```

---

### Task 5: The endpoint

**Files:**
- Create: `api/routers/wire.py`
- Modify: `api/main.py` (add `from api.routers import wire as wire_router` and `app.include_router(wire_router.router)` beside the other calendar routers)
- Test: `tests/test_wire_endpoint.py`

**Interfaces:**
- Produces: `GET /api/calendar/wire?date=YYYY-MM-DD` → `{"market_date", "rows": [...], "expected": int}`
  - each row adds `move_pct` (live, overlaid at read time) to the stored fields
  - `expected` = number of reporters scheduled this session, for the empty state

- [ ] **Step 1: Write the failing test**

```python
import importlib
from unittest import mock

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("WIRE_DB_PATH", str(tmp_path / "wire.db"))
    import api.services.wire.store as s
    importlib.reload(s)
    s._init_db()
    import api.routers.wire as w
    importlib.reload(w)
    from api.main import app
    return TestClient(app), s, w


def test_returns_rows_in_arrival_order(client):
    c, store, w = client
    for sym, seen in (("AMD", 3000.0), ("NVDA", 1000.0), ("SBUX", 2000.0)):
        store.upsert_print({"market_date": "2026-07-31", "sym": sym, "timing": "amc",
                            "first_seen_at": seen, "trigger": "price",
                            "eps_act": None, "eps_est": 1.0, "rev_act": None,
                            "rev_est": 1e9, "eps_src": None, "rev_src": None,
                            "confirmed": 0, "peak_move_pct": 5.0})
    with mock.patch.object(w, "_live_moves", return_value={}), \
         mock.patch.object(w, "_expected_count", return_value=37):
        r = c.get("/api/calendar/wire?date=2026-07-31")
    assert r.status_code == 200
    body = r.json()
    assert [row["sym"] for row in body["rows"]] == ["NVDA", "SBUX", "AMD"]
    assert body["expected"] == 37


def test_empty_session_still_reports_what_is_expected(client):
    """Before the first print the view must say '37 reporters after the close',
    not render blank."""
    c, _, w = client
    with mock.patch.object(w, "_live_moves", return_value={}), \
         mock.patch.object(w, "_expected_count", return_value=37):
        body = c.get("/api/calendar/wire?date=2026-07-31").json()
    assert body["rows"] == []
    assert body["expected"] == 37


def test_live_move_is_overlaid_not_stored(client):
    c, store, w = client
    store.upsert_print({"market_date": "2026-07-31", "sym": "NVDA", "timing": "amc",
                        "first_seen_at": 1000.0, "trigger": "price",
                        "eps_act": None, "eps_est": 1.0, "rev_act": None,
                        "rev_est": 1e9, "eps_src": None, "rev_src": None,
                        "confirmed": 0, "peak_move_pct": 5.0})
    with mock.patch.object(w, "_live_moves", return_value={"NVDA": 6.4}), \
         mock.patch.object(w, "_expected_count", return_value=1):
        body = c.get("/api/calendar/wire?date=2026-07-31").json()
    assert body["rows"][0]["move_pct"] == 6.4
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_wire_endpoint.py -q -p no:warnings`
Expected: FAIL — `No module named 'api.routers.wire'`

- [ ] **Step 3: Write minimal implementation**

Create `api/routers/wire.py`:

```python
"""GET /api/calendar/wire — a TABLE READ.

Deliberately does no provider fan-out on the request path: the detector job owns
all provider work, so first_seen_at stays accurate when nobody has the page open
and the request path stays off the anyio threadpool (the 2026-07-01 524 class).
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Query

from api.services.wire import store
from api.services.wire.session import market_session_date

router = APIRouter()


def _live_moves(syms: list[str]) -> dict[str, float]:
    """Current move % per symbol, overlaid at read time (never stored)."""
    if not syms:
        return {}
    try:
        from api.services.massive import _get_client
        from api.services.wire.detect import move_pct
        snap = _get_client().get_full_market_snapshot()
    except Exception:
        return {}
    out = {}
    for s in syms:
        mv = move_pct(snap.get(s) or {})
        if mv is not None:
            out[s] = round(mv, 2)
    return out


def _expected_count(market_date: str) -> int:
    try:
        from api.services.wire.detector import todays_reporters
        return len(todays_reporters(market_date))
    except Exception:
        return 0


@router.get("/api/calendar/wire")
def get_wire(date_str: str | None = Query(None, alias="date")):
    """The session's wire, oldest-first by arrival (the frontend reverses).

    Arg is `date_str` with alias="date": naming it `date` would shadow
    `datetime.date` — the exact bug that 500ed calendar reactions for 3 weeks.
    """
    if date_str and not re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
        return {"market_date": market_session_date(), "rows": [], "expected": 0}
    md = date_str or market_session_date()
    rows = store.get_prints(md)
    moves = _live_moves([r["sym"] for r in rows])
    for r in rows:
        r["move_pct"] = moves.get(r["sym"])
    return {"market_date": md, "rows": rows, "expected": _expected_count(md)}
```

In `api/main.py`, beside the existing calendar router registration, add the import
`from api.routers import wire as wire_router` and, next to
`app.include_router(calendar_router.router)`, add `app.include_router(wire_router.router)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_wire_endpoint.py -q -p no:warnings`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add api/routers/wire.py api/main.py tests/test_wire_endpoint.py
git commit -m "wire: GET /api/calendar/wire as a pure table read"
```

---

### Task 6: Scheduler registration

**Files:**
- Modify: `api/main.py` (scheduler block, beside the catalyst jobs)
- Test: `tests/test_wire_scheduler_gate.py`

**Interfaces:**
- Consumes: `detector.run_wire_tick`
- Produces: job id `wire_detector`, registered only when `WIRE_ENABLED=1`

- [ ] **Step 1: Write the failing test**

```python
import os
from unittest import mock


def test_detector_is_flag_gated_off_by_default():
    """WIRE_ENABLED unset must mean the job never registers."""
    from api.main import _wire_enabled
    with mock.patch.dict(os.environ, {}, clear=False):
        os.environ.pop("WIRE_ENABLED", None)
        assert _wire_enabled() is False


def test_detector_enables_only_on_explicit_1():
    from api.main import _wire_enabled
    with mock.patch.dict(os.environ, {"WIRE_ENABLED": "1"}):
        assert _wire_enabled() is True
    with mock.patch.dict(os.environ, {"WIRE_ENABLED": "0"}):
        assert _wire_enabled() is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_wire_scheduler_gate.py -q -p no:warnings`
Expected: FAIL — `cannot import name '_wire_enabled'`

- [ ] **Step 3: Write minimal implementation**

In `api/main.py`, at module level near the other flag helpers:

```python
def _wire_enabled() -> bool:
    """The earnings wire ships dark: the detector job only registers on an
    explicit WIRE_ENABLED=1."""
    return os.environ.get("WIRE_ENABLED", "") == "1"
```

Then inside the scheduler setup block, beside the catalyst jobs:

```python
        # -- Earnings wire detector -----------------------------------------
        if _wire_enabled():
            from api.services.wire import store as _wire_store
            _wire_store._init_db()

            def _wire_tick_job():
                try:
                    from api.services.wire.detector import run_wire_tick
                    run_wire_tick()
                except Exception as _e:
                    print(f"[scheduler] wire detector error: {_e}")

            # Every 20s inside the print windows, hourly otherwise. max_instances=1
            # so a slow tick can never stack on the next.
            _scheduler.add_job(
                _wire_tick_job, CronTrigger(day_of_week="mon-fri",
                                            hour="6-9,16", second="*/20",
                                            timezone=_ET),
                id="wire_detector", max_instances=1, replace_existing=True)
            _scheduler.add_job(
                _wire_tick_job, CronTrigger(day_of_week="mon-fri", minute=5,
                                            timezone=_ET),
                id="wire_detector_slow", max_instances=1, replace_existing=True)
            print("[scheduler] earnings wire detector registered (20s in windows)")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_wire_scheduler_gate.py -q -p no:warnings`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add api/main.py tests/test_wire_scheduler_gate.py
git commit -m "wire: register the detector, dark behind WIRE_ENABLED"
```

---

### Task 7: The Wire view

**Files:**
- Create: `app/src/pages/calendar/useWire.js`, `app/src/pages/calendar/WireView.jsx`, `app/src/pages/calendar/WireView.module.css`
- Test: `app/src/pages/calendar/WireView.test.jsx`

**Interfaces:**
- Consumes: `GET /api/calendar/wire`
- Produces: `<WireView />` default export; `useWire(dateStr)` returning `{data, error}`

Rendering rules from the spec, all three tested: newest-first with **immutable order**, emphasis by significance, and a useful empty state.

- [ ] **Step 1: Write the failing test**

```jsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import WireView from './WireView'

const row = (sym, seen, extra = {}) => ({
  sym, first_seen_at: seen, timing: 'amc', move_pct: 6.4,
  eps_act: null, eps_est: 1.11, rev_act: null, rev_est: 4.98e10,
  confirmed: 0, peak_move_pct: 6.4, trigger: 'price', ...extra,
})

vi.mock('./useWire', () => ({
  useWire: () => globalThis.__wire,
}))

describe('WireView', () => {
  it('renders newest first', () => {
    globalThis.__wire = { data: { rows: [row('NVDA', 1000), row('AMD', 3000)], expected: 37 } }
    render(<WireView />)
    const syms = screen.getAllByTestId('wire-sym').map(n => n.textContent)
    expect(syms).toEqual(['AMD', 'NVDA'])
  })

  it('orders by arrival, NOT by move size', () => {
    // The big mover arrived FIRST; it must stay below the newer, smaller one.
    globalThis.__wire = { data: {
      rows: [row('NVDA', 1000, { move_pct: 12.0 }), row('AMD', 3000, { move_pct: 0.4 })],
      expected: 37 } }
    render(<WireView />)
    const syms = screen.getAllByTestId('wire-sym').map(n => n.textContent)
    expect(syms).toEqual(['AMD', 'NVDA'])
  })

  it('shows what is expected before the first print instead of rendering blank', () => {
    globalThis.__wire = { data: { rows: [], expected: 37 } }
    render(<WireView />)
    expect(screen.getByText(/37 reporters/i)).toBeInTheDocument()
  })

  it('marks a row without actuals as pending', () => {
    globalThis.__wire = { data: { rows: [row('NVDA', 1000)], expected: 1 } }
    render(<WireView />)
    expect(screen.getByText(/pending/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/calendar/WireView.test.jsx --pool=threads`
Expected: FAIL — cannot resolve `./WireView`

- [ ] **Step 3: Write minimal implementation**

`app/src/pages/calendar/useWire.js`:

```js
import useMobileSWR from '../../hooks/useMobileSWR'

const fetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null))

// 10s inside the windows is indistinguishable from push here: the price data
// underneath is already real-time and the endpoint is a table read. A second SSE
// rail was explicitly rejected (single-process web pod).
export function useWire(dateStr) {
  return useMobileSWR(
    dateStr ? `/api/calendar/wire?date=${dateStr}` : '/api/calendar/wire',
    fetcher,
    { refreshInterval: 10000, revalidateOnFocus: false },
  )
}
```

`app/src/pages/calendar/WireView.jsx`:

```jsx
import { useMemo } from 'react'
import styles from './WireView.module.css'
import { useWire } from './useWire'

const fmtMoney = (v) => {
  if (v == null) return '—'
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  return v.toFixed(2)
}

// Significance drives visual WEIGHT only — never position.
function weightOf(row) {
  const m = Math.abs(row.move_pct ?? row.peak_move_pct ?? 0)
  if (m >= 8) return styles.loud
  if (m >= 4) return styles.mid
  return styles.quiet
}

export default function WireView({ dateStr }) {
  const { data } = useWire(dateStr)
  const rows = data?.rows ?? []
  const expected = data?.expected ?? 0

  // Sort by arrival DESC. first_seen_at is immutable, so a row never moves.
  const ordered = useMemo(
    () => [...rows].sort((a, b) => b.first_seen_at - a.first_seen_at),
    [rows],
  )

  if (!ordered.length) {
    return (
      <div className={styles.empty}>
        {expected > 0
          ? `${expected} reporters this session — waiting on the first print`
          : 'No reporters scheduled'}
      </div>
    )
  }

  return (
    <div className={styles.wire}>
      {ordered.map(r => (
        <div key={r.sym} className={`${styles.row} ${weightOf(r)}`}>
          <span className={styles.time}>
            {new Date(r.first_seen_at * 1000).toLocaleTimeString('en-US',
              { hour12: false, timeZone: 'America/New_York' })}
          </span>
          <span className={styles.sym} data-testid="wire-sym">{r.sym}</span>
          <span className={r.move_pct >= 0 ? styles.up : styles.down}>
            {r.move_pct == null ? '—' : `${r.move_pct >= 0 ? '▲' : '▼'} ${r.move_pct.toFixed(1)}%`}
          </span>
          {r.eps_act == null ? (
            <span className={styles.pending}>numbers pending…</span>
          ) : (
            <span className={styles.nums}>
              EPS {fmtMoney(r.eps_act)} vs {fmtMoney(r.eps_est)}
              {' · '}Rev {fmtMoney(r.rev_act)} vs {fmtMoney(r.rev_est)}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
```

`app/src/pages/calendar/WireView.module.css`:

```css
.wire { display: flex; flex-direction: column; gap: 2px; padding: 8px 0; }
.row {
  display: grid; grid-template-columns: 72px 64px 84px 1fr;
  align-items: center; gap: 10px; padding: 7px 12px;
  border-bottom: 1px solid var(--color-border, #222);
  font-size: 13px; min-height: 44px;
}
.time { color: var(--color-text-muted, #888); font-variant-numeric: tabular-nums; }
.sym  { font-weight: 700; letter-spacing: 0.5px; }
.up   { color: #4ade80; font-variant-numeric: tabular-nums; }
.down { color: #f87171; font-variant-numeric: tabular-nums; }
.pending { color: var(--color-text-muted, #888); font-style: italic; }
.nums { font-variant-numeric: tabular-nums; }
.loud  { background: rgba(201, 168, 76, 0.10); font-size: 14px; }
.mid   { background: rgba(201, 168, 76, 0.04); }
.quiet { opacity: 0.72; }
.empty { padding: 40px 16px; text-align: center; color: var(--color-text-muted, #888); }
@media (max-width: 640px) {
  .row { grid-template-columns: 58px 56px 72px 1fr; font-size: 12px; gap: 6px; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/calendar/WireView.test.jsx --pool=threads`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/calendar/useWire.js app/src/pages/calendar/WireView.jsx app/src/pages/calendar/WireView.module.css app/src/pages/calendar/WireView.test.jsx
git commit -m "wire: Wire view — immutable arrival order, weight by significance"
```

---

### Task 8: Mount it on the Calendar page

**Files:**
- Modify: `app/src/pages/calendar/CalendarHeader.jsx` (the `VIEWS` array, ~line 254)
- Modify: `app/src/pages/Calendar.jsx` (render branch beside `view === 'table'`, ~line 565)
- Test: `app/src/pages/calendar/CalendarHeader.test.jsx` (extend existing)

- [ ] **Step 1: Write the failing test**

Add to `app/src/pages/calendar/CalendarHeader.test.jsx`:

```jsx
it('offers the Wire view', () => {
  // renderHeader() is the existing helper in this file
  renderHeader()
  expect(screen.getByRole('button', { name: /wire/i })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/calendar/CalendarHeader.test.jsx --pool=threads`
Expected: FAIL — no matching button

- [ ] **Step 3: Write minimal implementation**

In `CalendarHeader.jsx`, add to `VIEWS` as the FIRST entry (it is the live surface):

```js
  ['wire', 'Wire', 'Live earnings results as they hit the tape'],
```

In `Calendar.jsx`, beside the other view branches:

```jsx
        {view === 'wire' && <WireView />}
```

with `import WireView from './calendar/WireView'` at the top. Passing no
`dateStr` lets the endpoint resolve the current session itself.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/pages/calendar --pool=threads`
Expected: PASS — all calendar frontend tests including the new Wire ones

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/calendar/CalendarHeader.jsx app/src/pages/Calendar.jsx app/src/pages/calendar/CalendarHeader.test.jsx
git commit -m "wire: mount the Wire view on the calendar page"
```

---

### Task 9: Latency instrumentation — the reason Phase 1 exists

**Files:**
- Modify: `api/routers/wire.py` (add the status endpoint)
- Test: `tests/test_wire_latency_status.py`

**Interfaces:**
- Produces: `GET /api/calendar/wire-status` → `{"market_date", "rows": n, "with_actuals": n, "price_first": n, "actuals_first": n, "median_seconds_price_to_actuals": float | None}`

Phase 2 is aimed by this number. Without it we would be guessing at exactly the thing the spec says to measure.

- [ ] **Step 1: Write the failing test**

```python
import importlib
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("WIRE_DB_PATH", str(tmp_path / "wire.db"))
    import api.services.wire.store as s
    importlib.reload(s)
    s._init_db()
    import api.routers.wire as w
    importlib.reload(w)
    from api.main import app
    return TestClient(app), s


def _r(sym, seen, **kw):
    base = dict(market_date="2026-07-31", sym=sym, timing="amc",
                first_seen_at=seen, trigger="price", eps_act=None, eps_est=1.0,
                rev_act=None, rev_est=1e9, eps_src=None, rev_src=None,
                confirmed=0, peak_move_pct=5.0)
    base.update(kw)
    return base


def test_counts_how_many_arrived_on_price_before_numbers(client):
    c, store = client
    store.upsert_print(_r("NVDA", 1000.0, trigger="price"))
    store.upsert_print(_r("AMD", 1100.0, trigger="actuals", eps_act=1.0, confirmed=1))
    body = c.get("/api/calendar/wire-status?date=2026-07-31").json()
    assert body["rows"] == 2
    assert body["price_first"] == 1
    assert body["actuals_first"] == 1
    assert body["with_actuals"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_wire_latency_status.py -q -p no:warnings`
Expected: FAIL — 404 from the missing route

- [ ] **Step 3: Write minimal implementation**

Append to `api/routers/wire.py`:

```python
@router.get("/api/calendar/wire-status")
def wire_status(date_str: str | None = Query(None, alias="date")):
    """How the wire actually filled — the measurement Phase 2 is aimed by.

    `price_first` vs `actuals_first` answers the spec's open question: how much
    work the price trigger is really doing, i.e. how far behind the structured
    providers land after a print.
    """
    md = date_str or market_session_date()
    rows = store.get_prints(md)
    price_first = sum(1 for r in rows if r.get("trigger") == "price")
    actuals_first = sum(1 for r in rows if r.get("trigger") == "actuals")
    with_actuals = sum(1 for r in rows if r.get("eps_act") is not None)
    return {
        "market_date": md,
        "rows": len(rows),
        "with_actuals": with_actuals,
        "price_first": price_first,
        "actuals_first": actuals_first,
        "median_seconds_price_to_actuals": None,   # filled in Phase 2 with per-source stamps
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_wire_latency_status.py -q -p no:warnings`
Expected: PASS

- [ ] **Step 5: Full suite + commit**

```bash
python -m pytest tests/ -k "wire or calendar" -q -p no:warnings
git add api/routers/wire.py tests/test_wire_latency_status.py
git commit -m "wire: latency status — the measurement that aims Phase 2"
```

---

## Acceptance — this is NOT a green test suite

Phase 1 is done when a **live 16:00 ET window** has been observed:

1. Set `WIRE_ENABLED=1` in Railway (web), deploy **outside** 16:00–16:30.
2. At 15:55 ET open `/calendar` → Wire. Confirm the empty state names the expected count.
3. Watch through 16:30. Confirm rows appear on price before their numbers, upgrade in place, and **never reorder**.
4. Read `GET /api/calendar/wire-status` — record `price_first` vs `actuals_first`. **That ratio is the Phase 2 input.**
5. Sanity-check 3 rows against a real quote: no fake movers from thin tape.

Mocked tests passed while a calendar feature was wrong-shaped and shipped in 0 of 24 charts (`lesson_injected_dependency_hides_the_fetch`). The live window is the gate.

## Known Phase 1 limitations (by design)

- No tweets, no LLM parsing, no Perplexity — Phase 2.
- No alerts — Phase 3.
- **No targeted per-mover FMP call.** The spec's Phase 1 says "price and
  Finnhub/FMP"; this plan takes actuals from the calendar payload, which is fed by
  Finnhub's existing one-call range sweep (`_patch_today_actuals`). A per-mover FMP
  call would likely be faster, but Phase 1 exists to **measure** how slow the
  Finnhub path actually is — adding FMP first would hide the very number we are
  trying to read. `wire-status`'s `price_first` vs `actuals_first` ratio decides
  whether Phase 2 adds it. This is a deliberate narrowing of the spec, recorded
  here rather than silently dropped.
- `_live_moves` calls the full snapshot per request; it is cached upstream by Massive's client but should move behind `ServeStale` if the endpoint gets hot.
- No freeze-on-read pill yet: it matters once real flood volume is observed, and Phase 1's job is to produce that observation.
