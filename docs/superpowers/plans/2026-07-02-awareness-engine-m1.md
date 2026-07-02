# Awareness Engine — Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first real slice of the Awareness Engine (spec §5.4) — Compass watches **stops (R1/R2)**, **earnings proximity (R5)**, and **regime flips (R4)**, and speaks up through the existing insight pipeline. Every candidate gets a deterministic relevance score that becomes its `importance`; the existing `add_insight` queue (daily cap, per-symbol cooldown), away-delivery (email/Discord for importance ≥ 8), and a revived "Compass noticed" dashboard tile consume it unchanged. Dark-launchable: two independent flags, both default OFF.

**Architecture:** A new `api/services/awareness/` package is a *producer*, nothing else. `rules.py` holds pure functions `(scan_ctx, user_ctx) -> list[InsightCandidate]` for each watch rule plus a pure relevance-score formula (`base_signal × personal_multiplier × urgency`, clamped 1–10). `regime_snapshots.py` is a tiny durable ledger (one row per scan cycle: label + confidence + timestamp) that finally lets the app say "the regime just flipped" — `voice_regime_classifier.get_current_regime()` recomputes from a 15-min TTLCache but never persisted a prior label anywhere. `engine.py` is the scan cycle: **one shared market-wide computation per cycle** (regime + a short earnings-calendar window + cached live prices for every symbol any user holds — no new fetches, reads the existing `/api/live-prices` shared cache) → **bulk-load every user's open J2 positions + watchlist symbols in two queries total** (the proven `calendar_alerts.py` idiom) → run the three rules per user → score each candidate → fire via `add_insight` (dedup/cap/cooldown already enforced there) → also `deliver_alert_payload` (email/Discord/in-app) when importance ≥ 8. Scheduler wiring in `api/main.py` reuses `_add_compass_job` (gates on `COMPASS_AUTOMATION_ENABLED`) and the job function itself ALSO checks the new `AWARENESS_ENGINE_ENABLED` — both must be on. The frontend revives the already-built-but-unmounted `CompassTodayTile.jsx`, upgrading its single "last noticed" line into a grouped, dismissible feed (grouped by `kind`, wired to the existing `POST /api/voice/insights/{id}/dismiss`), and mounts it on the Dashboard below the existing tiles, rendering `null` when there's nothing to show.

**Tech Stack:** Python 3 / FastAPI / SQLite (WAL, `auth.db`) / APScheduler / React + SWR / vitest / pytest.

## Global Constraints

- **Both flags default OFF, independently gated.** `COMPASS_AUTOMATION_ENABLED` (existing master switch, gates job *registration* via `_add_compass_job`) AND `AWARENESS_ENGINE_ENABLED` (new, checked *inside* the job function AND inside `run_awareness_scan()` — belt-and-suspenders so the engine is inert even if called directly). Flag read pattern: `os.environ.get("FLAG", "0") == "1"` (repo convention).
- **Never blocks the request path.** The entire scan runs on the APScheduler background thread (web pod), never inside a FastAPI request handler. Stop-checks read the existing shared live-price cache (`api/routers/live_prices.py`) — **never** fetch a price per-position.
- **Web-pod SQLite conventions:** WAL mode + `PRAGMA busy_timeout=2000` on every new connection (matches `indicator_alert_service.py` / `bar_provenance.py` / `brain_kb_service.py`). New tables live in the existing `auth.db` file (via `AUTH_DB_PATH`) — no new SQLite file/WAL sidecar for this milestone.
- **`grep -c broker_sync api/main.py` must stay ≥ 7** (locked CLAUDE.md invariant) — Task 7 edits `api/main.py` near the scheduler block; do not touch the broker-sync block.
- **Broker placeholder-stop trap:** `j2_positions.stop_price` is `NOT NULL`; broker-imported carried-in positions store `stop_price == entry_price` as a placeholder (`journal_two/broker/balances.py`). R1/R2 MUST skip any row where `source == 'broker' AND stop_price == entry_price` — otherwise every broker position reads as "at stop."
- **Reuse, don't reimplement:** `add_insight` (queue + cap + cooldown), `deliver_alert_payload` (away-delivery), the `calendar_alerts.py` bulk-scan idiom, and `POST /api/voice/insights/{id}/dismiss` are all reused unchanged. This plan only *produces* insights and *revives* the consuming tile.
- **Backend tests:** `python -m pytest tests/<file>.py -q` from repo root. **Frontend tests:** `cd app && npx vitest run src/components/tiles/CompassTodayTile.test.jsx` (or `npm test` for the full suite).
- **Dedup-key convention (per `add_insight`'s `symbol=` cooldown scoping):** stop rules pass the bare symbol (`"NVDA"`), earnings-proximity passes a composite key (`"NVDA:earnings"`), regime-flip passes a label-scoped key (`"REGIME:bear_trend"`) — this is how one symbol can carry independent cooldowns per insight kind.

---

### Task 1: `rules.py` core — `InsightCandidate` + the relevance-score formula

**Files:**
- Create: `api/services/awareness/__init__.py`
- Create: `api/services/awareness/rules.py`
- Create: `tests/test_awareness_rules.py`

**Interfaces:**
- `InsightCandidate` (frozen dataclass): `kind: str`, `symbol: str | None`, `headline: str`, `body: str | None`, `base_signal: float`, `personal_multiplier: float`, `urgency: float`, `dedup_key: str | None`.
- `compute_relevance_score(base_signal: float, personal_multiplier: float = 1.0, urgency: float = 1.0) -> int` — pure, clamped 1–10, used as `add_insight(..., importance=...)`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_awareness_rules.py
"""Tests for api/services/awareness/rules.py — pure rule functions + the
deterministic relevance-score formula. (Task 1 covers only the score
formula + InsightCandidate; stop/regime/earnings rule tests are appended
in Tasks 2, 4, 5.)"""
from __future__ import annotations

from datetime import date

from api.services.awareness.rules import (
    InsightCandidate,
    compute_relevance_score,
)


# ── compute_relevance_score ─────────────────────────────────────────────────

def test_relevance_score_baseline_is_midpoint():
    assert compute_relevance_score(0.5, 1.0, 1.0) == 5


def test_relevance_score_clamps_to_ten():
    assert compute_relevance_score(1.0, 2.0, 2.0) == 10


def test_relevance_score_clamps_to_one():
    assert compute_relevance_score(0.01, 0.5, 0.5) == 1


def test_relevance_score_rounds_to_nearest_int():
    # 0.37 * 1.0 * 1.0 * 10 = 3.7 -> rounds to 4
    assert compute_relevance_score(0.37, 1.0, 1.0) == 4


def test_insight_candidate_is_a_plain_frozen_record():
    c = InsightCandidate(
        kind="stop_hit", symbol="NVDA", headline="h", body="b",
        base_signal=1.0, personal_multiplier=1.0, urgency=1.0, dedup_key="NVDA",
    )
    assert c.kind == "stop_hit"
    assert c.symbol == "NVDA"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_awareness_rules.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'api.services.awareness'`.

- [ ] **Step 3: Write the implementation**

```python
# api/services/awareness/__init__.py
"""Awareness Engine — Milestone 1.

A pure PRODUCER of voice_proactive_insights rows. All existing delivery
surfaces (session-start speak, chat-thread mirror, /api/voice/insights,
away-delivery via email/Discord) consume rows written here unchanged.

Gated behind two independent flags, both default OFF:
  - COMPASS_AUTOMATION_ENABLED (existing master switch; gates scheduler
    job REGISTRATION via api/main.py's _add_compass_job)
  - AWARENESS_ENGINE_ENABLED (new; checked inside engine.run_awareness_scan()
    AND inside the scheduler job function itself)

See docs/superpowers/plans/2026-07-02-awareness-engine-m1.md.
"""
```

```python
# api/services/awareness/rules.py
"""Pure watch-rule functions for the Awareness Engine (Milestone 1).

Every rule has the same shape: (scan_ctx, user_ctx) -> list[InsightCandidate].
scan_ctx is the ONE shared market-wide computation for this cycle (live
prices, regime, earnings window) built once by engine.py. user_ctx is that
one user's bulk-loaded positions + watchlist symbols. Rules never touch the
database or the network — engine.py owns all I/O.

The relevance score is deterministic and pure:
    importance = clamp(round(base_signal * personal_multiplier * urgency * 10), 1, 10)

  - base_signal (0.0-1.0): raw strength of the trigger itself (e.g. 1.0 for
    a stop that's been hit, 0.4-0.7 for "nearing" it).
  - personal_multiplier (~0.5-1.6): how much this matters to THIS user
    (owns it vs. just watches it).
  - urgency (~1.0-2.0): how time-sensitive it is (today vs. a few days out).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class InsightCandidate:
    kind: str
    symbol: str | None
    headline: str
    body: str | None
    base_signal: float
    personal_multiplier: float
    urgency: float
    # Passed as `symbol=` to add_insight() for its per-symbol cooldown scope.
    # May be a composite key (e.g. "NVDA:earnings") so different rule kinds
    # on the same ticker don't share a cooldown window.
    dedup_key: str | None


def compute_relevance_score(
    base_signal: float, personal_multiplier: float = 1.0, urgency: float = 1.0,
) -> int:
    """The deterministic relevance-score formula. Pure; clamped to 1-10 so
    it's always a valid add_insight() importance value."""
    raw = float(base_signal) * float(personal_multiplier) * float(urgency) * 10.0
    return max(1, min(10, round(raw)))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_awareness_rules.py -q`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```
git add api/services/awareness/__init__.py api/services/awareness/rules.py tests/test_awareness_rules.py
git commit -m "feat(awareness): relevance-score formula + InsightCandidate (Awareness Engine M1, pure/tested)"
```

---

### Task 2: `rules.py` — R1/R2 stop-watch rule

**Files:**
- Edit: `api/services/awareness/rules.py`
- Edit: `tests/test_awareness_rules.py`

**Interfaces:**
- `NEAR_STOP_PCT: float = 0.03` (module constant).
- `rule_stop_watch(scan_ctx: dict, user_ctx: dict) -> list[InsightCandidate]`.
- `scan_ctx["live_prices"]: dict[str, float]` (symbol → cached price).
- `user_ctx["positions"]: list[dict]` — each `{"symbol", "side", "entry_price", "stop_price", "source"}`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_awareness_rules.py`:

```python
from api.services.awareness.rules import rule_stop_watch  # add to the import block above


# ── rule_stop_watch (R1/R2) ─────────────────────────────────────────────────

def _scan(prices):
    return {"live_prices": prices, "regime": {}, "earnings_by_symbol": {},
            "today": date(2026, 7, 2)}


def test_stop_watch_fires_stop_hit_when_long_price_at_or_below_stop():
    user_ctx = {"positions": [{"symbol": "NVDA", "side": "Long",
                                "entry_price": 100.0, "stop_price": 90.0,
                                "source": None}], "watch_syms": set()}
    out = rule_stop_watch(_scan({"NVDA": 88.0}), user_ctx)
    assert len(out) == 1
    assert out[0].kind == "stop_hit"
    assert out[0].dedup_key == "NVDA"
    assert out[0].base_signal == 1.0


def test_stop_watch_fires_stop_proximity_when_near():
    # stop=90, price=91.5 -> distance = (91.5-90)/91.5 = 1.64% < 3% threshold
    user_ctx = {"positions": [{"symbol": "NVDA", "side": "Long",
                                "entry_price": 100.0, "stop_price": 90.0,
                                "source": None}], "watch_syms": set()}
    out = rule_stop_watch(_scan({"NVDA": 91.5}), user_ctx)
    assert len(out) == 1
    assert out[0].kind == "stop_proximity"


def test_stop_watch_silent_when_price_far_from_stop():
    user_ctx = {"positions": [{"symbol": "NVDA", "side": "Long",
                                "entry_price": 100.0, "stop_price": 90.0,
                                "source": None}], "watch_syms": set()}
    assert rule_stop_watch(_scan({"NVDA": 110.0}), user_ctx) == []


def test_stop_watch_short_side_at_stop():
    # Short: stop above entry; at/through fires once price >= stop.
    user_ctx = {"positions": [{"symbol": "TSLA", "side": "Short",
                                "entry_price": 200.0, "stop_price": 210.0,
                                "source": None}], "watch_syms": set()}
    out = rule_stop_watch(_scan({"TSLA": 212.0}), user_ctx)
    assert len(out) == 1
    assert out[0].kind == "stop_hit"


def test_stop_watch_skips_broker_placeholder_stop():
    # source='broker' + stop_price == entry_price is a placeholder (no real
    # stop set on the broker's side) -- must be skipped even though the
    # price is well below it.
    user_ctx = {"positions": [{"symbol": "AAPL", "side": "Long",
                                "entry_price": 150.0, "stop_price": 150.0,
                                "source": "broker"}], "watch_syms": set()}
    assert rule_stop_watch(_scan({"AAPL": 140.0}), user_ctx) == []


def test_stop_watch_skips_when_no_live_price_cached():
    user_ctx = {"positions": [{"symbol": "MSFT", "side": "Long",
                                "entry_price": 300.0, "stop_price": 280.0,
                                "source": None}], "watch_syms": set()}
    assert rule_stop_watch(_scan({}), user_ctx) == []  # MSFT not cached this cycle
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_awareness_rules.py -q`
Expected: FAIL — `ImportError: cannot import name 'rule_stop_watch'`.

- [ ] **Step 3: Write the implementation**

Append to `api/services/awareness/rules.py`:

```python
NEAR_STOP_PCT = 0.03  # 3% — R2 "nearing stop" threshold


def _stop_distance_pct(side: str, price: float, stop: float) -> float:
    """Positive = price hasn't reached the stop yet (as a % of price).
    <= 0 means at or through the stop."""
    if side == "Long":
        return (price - stop) / price
    return (stop - price) / price  # Short


def rule_stop_watch(scan_ctx: dict, user_ctx: dict) -> list[InsightCandidate]:
    """R1 (at/through stop) + R2 (nearing stop). Skips broker carried-in
    positions whose stop is a NOT-NULL placeholder (stop_price==entry_price,
    source=='broker') -- see journal_two/broker/balances.py."""
    out: list[InsightCandidate] = []
    live_prices: dict = scan_ctx.get("live_prices") or {}

    for pos in user_ctx.get("positions") or []:
        sym = (pos.get("symbol") or "").upper()
        side = pos.get("side")
        stop = pos.get("stop_price")
        entry = pos.get("entry_price")
        source = pos.get("source")
        if not sym or side not in ("Long", "Short") or stop is None or entry is None:
            continue
        if source == "broker" and abs(float(stop) - float(entry)) < 1e-9:
            continue  # placeholder stop -- nothing real to watch

        price = live_prices.get(sym)
        if not price or price <= 0:
            continue  # no cached price this cycle -- never fetch per-position

        distance_pct = _stop_distance_pct(side, float(price), float(stop))

        if distance_pct <= 0:
            out.append(InsightCandidate(
                kind="stop_hit", symbol=sym,
                headline=f"{sym} is AT or THROUGH its stop",
                body=(f"{side} {sym}: stop {float(stop):.2f}, current price "
                      f"{float(price):.2f}. Review the position now."),
                base_signal=1.0, personal_multiplier=1.3, urgency=2.0,
                dedup_key=sym,
            ))
        elif distance_pct <= NEAR_STOP_PCT:
            base_signal = 0.4 + (1.0 - distance_pct / NEAR_STOP_PCT) * 0.3
            out.append(InsightCandidate(
                kind="stop_proximity", symbol=sym,
                headline=f"{sym} is nearing its stop",
                body=(f"{side} {sym}: stop {float(stop):.2f}, current price "
                      f"{float(price):.2f} ({distance_pct * 100:.1f}% away)."),
                base_signal=base_signal, personal_multiplier=1.2, urgency=1.3,
                dedup_key=sym,
            ))
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_awareness_rules.py -q`
Expected: 11 passed.

- [ ] **Step 5: Commit**

```
git add api/services/awareness/rules.py tests/test_awareness_rules.py
git commit -m "feat(awareness): R1/R2 stop-watch rule -- at-stop + near-stop, broker placeholder skip"
```

---

### Task 3: `regime_snapshots.py` — durable regime-label store

**Files:**
- Create: `api/services/awareness/regime_snapshots.py`
- Create: `tests/test_awareness_regime_snapshots.py`

**Interfaces:**
- `init_schema() -> None`
- `record_snapshot(label: str, confidence: float | None = None) -> int` (returns row id)
- `get_last_label() -> str | None`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_awareness_regime_snapshots.py
import pytest


@pytest.fixture
def rs(tmp_path, monkeypatch):
    db_path = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(db_path))
    from api.services.awareness import regime_snapshots as mod
    monkeypatch.setattr(mod, "_DB_PATH", str(db_path))
    mod.init_schema()
    return mod


def test_get_last_label_none_when_empty(rs):
    assert rs.get_last_label() is None


def test_record_and_read_back_last_label(rs):
    rs.record_snapshot("bull_trend", 0.8)
    assert rs.get_last_label() == "bull_trend"


def test_last_label_reflects_most_recent_row(rs):
    rs.record_snapshot("bull_trend", 0.8)
    rs.record_snapshot("chop", 0.5)
    rs.record_snapshot("bear_trend", 0.6)
    assert rs.get_last_label() == "bear_trend"


def test_record_snapshot_is_append_only(rs):
    rs.record_snapshot("bull_trend", 0.8)
    rs.record_snapshot("bull_trend", 0.8)  # same label -- still a new row
    with rs._conn() as db:
        n = db.execute(
            "SELECT COUNT(*) FROM awareness_regime_snapshots"
        ).fetchone()[0]
    assert n == 2


def test_init_schema_is_idempotent(rs):
    rs.init_schema()  # second call must not raise
    rs.record_snapshot("chop", 0.4)
    assert rs.get_last_label() == "chop"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_awareness_regime_snapshots.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'api.services.awareness.regime_snapshots'`.

- [ ] **Step 3: Write the implementation**

```python
# api/services/awareness/regime_snapshots.py
"""Durable regime-label snapshot store -- the missing memory behind the
Awareness Engine's R4 (regime flip) rule.

voice_regime_classifier.get_current_regime() recomputes the label on every
call via a 15-min TTLCache but never persists the PRIOR label anywhere, so
nothing in the app can say "the regime just flipped" durably (the existing
voice_proactive_service.maybe_emit_regime_shift() only compares against text
in the user's last voice-session summary -- a heuristic, not a ledger). This
module is that ledger: one row appended per Awareness Engine scan cycle.

Schema + connection pragmas mirror api/services/indicator_alert_service.py
(same physical auth.db file via AUTH_DB_PATH, same WAL + busy_timeout=2000
web-pod convention)."""
from __future__ import annotations

import os
import sqlite3

_DB_PATH = os.environ.get("AUTH_DB_PATH", "/data/auth.db")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS awareness_regime_snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  label       TEXT NOT NULL,
  confidence  REAL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_awareness_regime_snapshots_created
  ON awareness_regime_snapshots(created_at DESC);
"""


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(_DB_PATH, timeout=10.0)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=2000")
    return c


def init_schema() -> None:
    with _conn() as db:
        db.executescript(_SCHEMA)


def get_last_label() -> str | None:
    """Most recently recorded regime label, or None if the table is empty
    (first-ever scan -- nothing to compare against yet)."""
    with _conn() as db:
        row = db.execute(
            "SELECT label FROM awareness_regime_snapshots "
            "ORDER BY id DESC LIMIT 1"
        ).fetchone()
    return row[0] if row else None


def record_snapshot(label: str, confidence: float | None = None) -> int:
    """Append a new snapshot row. Called once per scan cycle, unconditionally
    -- this table is a ledger. Flip detection is a read-then-write done by
    the CALLER (engine.py): read get_last_label() BEFORE calling this."""
    with _conn() as db:
        cur = db.execute(
            "INSERT INTO awareness_regime_snapshots (label, confidence) "
            "VALUES (?, ?)",
            (label, confidence),
        )
        db.commit()
        return cur.lastrowid
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_awareness_regime_snapshots.py -q`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```
git add api/services/awareness/regime_snapshots.py tests/test_awareness_regime_snapshots.py
git commit -m "feat(awareness): regime_snapshots -- durable per-cycle ledger for regime-flip detection"
```

---

### Task 4: `rules.py` — R4 regime-flip rule

**Files:**
- Edit: `api/services/awareness/rules.py`
- Edit: `tests/test_awareness_rules.py`

**Interfaces:**
- `rule_regime_flip(scan_ctx: dict, user_ctx: dict) -> list[InsightCandidate]`.
- `scan_ctx["regime"]: {"label": str | None, "prev_label": str | None, "confidence": float | None}`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_awareness_rules.py`:

```python
from api.services.awareness.rules import rule_regime_flip  # add to import block


# ── rule_regime_flip (R4) ────────────────────────────────────────────────────

def test_regime_flip_fires_when_label_changed_and_user_has_positions():
    scan_ctx = {"live_prices": {}, "earnings_by_symbol": {}, "today": date(2026, 7, 2),
                "regime": {"label": "bear_trend", "prev_label": "bull_trend",
                           "confidence": 0.7}}
    user_ctx = {"positions": [{"symbol": "NVDA", "side": "Long",
                                "entry_price": 100.0, "stop_price": 90.0,
                                "source": None}], "watch_syms": set()}
    out = rule_regime_flip(scan_ctx, user_ctx)
    assert len(out) == 1
    assert out[0].kind == "regime_flip"
    assert out[0].dedup_key == "REGIME:bear_trend"


def test_regime_flip_silent_when_label_unchanged():
    scan_ctx = {"live_prices": {}, "earnings_by_symbol": {}, "today": date(2026, 7, 2),
                "regime": {"label": "bull_trend", "prev_label": "bull_trend",
                           "confidence": 0.7}}
    user_ctx = {"positions": [{"symbol": "NVDA", "side": "Long",
                                "entry_price": 100.0, "stop_price": 90.0,
                                "source": None}], "watch_syms": set()}
    assert rule_regime_flip(scan_ctx, user_ctx) == []


def test_regime_flip_silent_for_user_with_nothing_at_stake():
    scan_ctx = {"live_prices": {}, "earnings_by_symbol": {}, "today": date(2026, 7, 2),
                "regime": {"label": "bear_trend", "prev_label": "bull_trend",
                           "confidence": 0.7}}
    user_ctx = {"positions": [], "watch_syms": set()}
    assert rule_regime_flip(scan_ctx, user_ctx) == []


def test_regime_flip_silent_when_no_prior_label():
    # First-ever scan (empty regime_snapshots ledger) -- nothing to compare.
    scan_ctx = {"live_prices": {}, "earnings_by_symbol": {}, "today": date(2026, 7, 2),
                "regime": {"label": "bull_trend", "prev_label": None,
                           "confidence": 0.7}}
    user_ctx = {"positions": [{"symbol": "NVDA", "side": "Long",
                                "entry_price": 100.0, "stop_price": 90.0,
                                "source": None}], "watch_syms": set()}
    assert rule_regime_flip(scan_ctx, user_ctx) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_awareness_rules.py -q`
Expected: FAIL — `ImportError: cannot import name 'rule_regime_flip'`.

- [ ] **Step 3: Write the implementation**

Append to `api/services/awareness/rules.py`:

```python
def rule_regime_flip(scan_ctx: dict, user_ctx: dict) -> list[InsightCandidate]:
    """R4: fires once per (label, cycle) for any user with something at
    stake (an open position or a watched symbol) -- an inactive account
    with neither gets nothing. dedup_key is label-scoped (not per-user),
    so add_insight's 6h per-symbol cooldown naturally suppresses repeat
    firing for the SAME flip across scan cycles while allowing a genuine
    flip-back-and-forth to re-fire (different label string)."""
    regime = scan_ctx.get("regime") or {}
    label = regime.get("label")
    prev_label = regime.get("prev_label")
    confidence = regime.get("confidence") or 0.5
    if not label or not prev_label or label == prev_label:
        return []

    has_positions = bool(user_ctx.get("positions"))
    has_watch = bool(user_ctx.get("watch_syms"))
    if not has_positions and not has_watch:
        return []

    pretty_prev = prev_label.replace("_", " ")
    pretty_new = label.replace("_", " ")
    base_signal = 0.5 + 0.5 * min(1.0, max(0.0, float(confidence)))

    return [InsightCandidate(
        kind="regime_flip", symbol=None,
        headline=f"Market regime flipped: {pretty_prev} → {pretty_new}",
        body=(f"Confidence {float(confidence) * 100:.0f}%. Reassess exposure "
              f"and setup selection for the new regime."),
        base_signal=base_signal,
        personal_multiplier=1.3 if has_positions else 1.0,
        urgency=1.4,
        dedup_key=f"REGIME:{label}",
    )]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_awareness_rules.py -q`
Expected: 15 passed.

- [ ] **Step 5: Commit**

```
git add api/services/awareness/rules.py tests/test_awareness_rules.py
git commit -m "feat(awareness): R4 regime-flip rule (uses the durable regime_snapshots ledger)"
```

---

### Task 5: `rules.py` — R5 earnings-proximity rule

**Files:**
- Edit: `api/services/awareness/rules.py`
- Edit: `tests/test_awareness_rules.py`

**Interfaces:**
- `EARNINGS_PROXIMITY_DEFAULT_DAYS: int = 3` (module constant).
- `rule_earnings_proximity(scan_ctx: dict, user_ctx: dict) -> list[InsightCandidate]`.
- `scan_ctx["earnings_by_symbol"]: dict[str, str]` (symbol → ISO date of nearest report).

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_awareness_rules.py`:

```python
from api.services.awareness.rules import rule_earnings_proximity  # add to import block


# ── rule_earnings_proximity (R5) ─────────────────────────────────────────────

def test_earnings_proximity_fires_for_owned_symbol_today():
    scan_ctx = {"live_prices": {}, "regime": {}, "today": date(2026, 7, 2),
                "earnings_by_symbol": {"AAPL": "2026-07-02"}}
    user_ctx = {"positions": [{"symbol": "AAPL", "side": "Long",
                                "entry_price": 190.0, "stop_price": 180.0,
                                "source": None}], "watch_syms": set()}
    out = rule_earnings_proximity(scan_ctx, user_ctx)
    assert len(out) == 1
    assert out[0].kind == "earnings_proximity"
    assert out[0].dedup_key == "AAPL:earnings"
    assert out[0].personal_multiplier == 1.4  # owned boost


def test_earnings_proximity_fires_for_watched_symbol_within_window():
    scan_ctx = {"live_prices": {}, "regime": {}, "today": date(2026, 7, 2),
                "earnings_by_symbol": {"MSFT": "2026-07-04"}}  # +2 days
    user_ctx = {"positions": [], "watch_syms": {"MSFT"}}
    out = rule_earnings_proximity(scan_ctx, user_ctx)
    assert len(out) == 1
    assert out[0].personal_multiplier == 1.0  # watched, not owned


def test_earnings_proximity_silent_outside_window():
    scan_ctx = {"live_prices": {}, "regime": {}, "today": date(2026, 7, 2),
                "earnings_by_symbol": {"MSFT": "2026-07-10"}}  # +8 days, past default 3-day window
    user_ctx = {"positions": [], "watch_syms": {"MSFT"}}
    assert rule_earnings_proximity(scan_ctx, user_ctx) == []


def test_earnings_proximity_silent_for_untracked_symbol():
    scan_ctx = {"live_prices": {}, "regime": {}, "today": date(2026, 7, 2),
                "earnings_by_symbol": {"GOOG": "2026-07-02"}}
    user_ctx = {"positions": [], "watch_syms": {"MSFT"}}  # GOOG not owned/watched
    assert rule_earnings_proximity(scan_ctx, user_ctx) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_awareness_rules.py -q`
Expected: FAIL — `ImportError: cannot import name 'rule_earnings_proximity'`.

- [ ] **Step 3: Write the implementation**

Append to `api/services/awareness/rules.py`:

```python
EARNINGS_PROXIMITY_DEFAULT_DAYS = 3


def rule_earnings_proximity(scan_ctx: dict, user_ctx: dict) -> list[InsightCandidate]:
    """R5: fires for any owned OR watched symbol reporting within the
    proximity window. dedup_key is composite ("SYM:earnings") so it never
    shares a cooldown with a stop-watch insight on the same symbol."""
    out: list[InsightCandidate] = []
    earnings_by_symbol: dict = scan_ctx.get("earnings_by_symbol") or {}
    if not earnings_by_symbol:
        return out

    today = scan_ctx.get("today")
    owned_syms = {(p.get("symbol") or "").upper()
                  for p in (user_ctx.get("positions") or [])}
    watch_syms = {s.upper() for s in (user_ctx.get("watch_syms") or set())}
    mine = owned_syms | watch_syms

    for sym in mine:
        report_date_str = earnings_by_symbol.get(sym)
        if not report_date_str:
            continue
        try:
            report_date = date.fromisoformat(report_date_str)
        except ValueError:
            continue
        days_out = (report_date - today).days
        if days_out < 0 or days_out > EARNINGS_PROXIMITY_DEFAULT_DAYS:
            continue

        owned = sym in owned_syms
        # base_signal scales inversely with days_out: today=1.0, floors at 0.3.
        base_signal = max(0.3, 1.0 - 0.2 * days_out)
        when = ("today" if days_out == 0 else
                "tomorrow" if days_out == 1 else f"in {days_out} days")

        out.append(InsightCandidate(
            kind="earnings_proximity", symbol=sym,
            headline=f"{sym} reports earnings {when}",
            body=(f"{'You own' if owned else 'On your watchlist'}: {sym} is "
                  f"scheduled to report on {report_date_str}."),
            base_signal=base_signal,
            personal_multiplier=1.4 if owned else 1.0,
            urgency=1.5 if days_out == 0 else 1.0,
            dedup_key=f"{sym}:earnings",
        ))
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_awareness_rules.py -q`
Expected: 19 passed.

- [ ] **Step 5: Commit**

```
git add api/services/awareness/rules.py tests/test_awareness_rules.py
git commit -m "feat(awareness): R5 earnings-proximity rule (owned/watched, composite cooldown key)"
```

---

### Task 6: `engine.py` — the scan cycle orchestrator

**Files:**
- Create: `api/services/awareness/engine.py`
- Create: `tests/test_awareness_engine.py`

**Interfaces:**
- `run_awareness_scan() -> dict` (`{"enabled": bool, "scanned_users": int, "fired": int}`) — the entry point the scheduler job calls.
- `_enabled() -> bool`, `_bulk_load_user_contexts() -> dict[str, dict]`, `_collect_earnings_window(today: date, days: int) -> dict[str, str]`, `_build_market_scan_ctx(user_ctxs: dict) -> dict`, `_fire_candidate(user_id: str, candidate: InsightCandidate) -> bool`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_awareness_engine.py
"""Tests for api/services/awareness/engine.py -- the scan cycle orchestrator."""
from __future__ import annotations

import importlib
import os
import tempfile
import uuid
from datetime import date
from unittest import mock

import pytest


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    monkeypatch.setenv("DATA_DIR", os.path.dirname(tmp.name) or ".")

    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()

    from api.services.awareness import regime_snapshots
    importlib.reload(regime_snapshots)
    regime_snapshots.init_schema()

    from api.services.awareness import engine as eng
    importlib.reload(eng)

    yield tmp.name
    os.unlink(tmp.name)


def _seed_user(user_id: str, email: str) -> None:
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO users (id, email, password_hash, display_name, role) "
            "VALUES (?, ?, 'x', 'x', 'member')",
            (user_id, email),
        )
        conn.commit()
    finally:
        conn.close()


def _seed_position(user_id, symbol, side, entry, stop, source=None):
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO j2_positions
               (id, user_id, symbol, side, entry_date, shares, original_shares,
                entry_price, stop_price, context_at_entry, created_at,
                updated_at, source)
               VALUES (?, ?, ?, ?, '2026-01-01', 100, 100, ?, ?, '{}',
                       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)""",
            (str(uuid.uuid4()), user_id, symbol, side, entry, stop, source),
        )
        conn.commit()
    finally:
        conn.close()


def _seed_watchlist(user_id, symbols):
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        wl_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO watchlists (id, user_id, name) VALUES (?, ?, 'My List')",
            (wl_id, user_id),
        )
        for sym in symbols:
            conn.execute(
                "INSERT INTO watchlist_items (id, watchlist_id, sym) VALUES (?, ?, ?)",
                (str(uuid.uuid4()), wl_id, sym),
            )
        conn.commit()
    finally:
        conn.close()


# ── _enabled ─────────────────────────────────────────────────────────────────

def test_enabled_gate(monkeypatch):
    from api.services.awareness import engine as eng
    monkeypatch.delenv("AWARENESS_ENGINE_ENABLED", raising=False)
    assert eng._enabled() is False
    monkeypatch.setenv("AWARENESS_ENGINE_ENABLED", "1")
    assert eng._enabled() is True


# ── _bulk_load_user_contexts ─────────────────────────────────────────────────

def test_bulk_load_user_contexts_groups_positions_and_watchlists(db_path):
    from api.services.awareness import engine as eng
    _seed_user("u1", "u1@x.com")
    _seed_user("u2", "u2@x.com")
    _seed_position("u1", "NVDA", "Long", 100.0, 90.0)
    _seed_watchlist("u2", ["AAPL", "MSFT"])

    ctxs = eng._bulk_load_user_contexts()

    assert ctxs["u1"]["positions"] == [
        {"symbol": "NVDA", "side": "Long", "entry_price": 100.0,
         "stop_price": 90.0, "source": None},
    ]
    assert ctxs["u1"]["watch_syms"] == set()
    assert ctxs["u2"]["positions"] == []
    assert ctxs["u2"]["watch_syms"] == {"AAPL", "MSFT"}


# ── _collect_earnings_window ─────────────────────────────────────────────────

def test_collect_earnings_window_returns_earliest_date_per_symbol(monkeypatch):
    from api.services.awareness import engine as eng

    def fake_reporters(d_str):
        return {"2026-07-02": {"AAPL"}, "2026-07-03": {"AAPL", "MSFT"}}[d_str]

    monkeypatch.setattr(
        "api.services.calendar_alerts._get_reporters_for_date", fake_reporters,
    )
    out = eng._collect_earnings_window(date(2026, 7, 2), 1)
    assert out == {"AAPL": "2026-07-02", "MSFT": "2026-07-03"}


# ── _build_market_scan_ctx ───────────────────────────────────────────────────

def test_build_market_scan_ctx_reads_cached_prices_and_regime(db_path, monkeypatch):
    from api.services.awareness import engine as eng
    from api.routers.live_prices import cache as px_cache, _px_key

    px_cache.set(_px_key("NVDA"), {"price": 123.45}, ttl=60)

    monkeypatch.setattr(
        "api.services.voice_regime_classifier.get_current_regime",
        lambda: {"regime": "bull_trend", "confidence": 0.8},
    )
    monkeypatch.setattr(eng, "_collect_earnings_window",
                         lambda today, days: {"AAPL": "2026-07-03"})

    user_ctxs = {"u1": {"positions": [{"symbol": "NVDA", "side": "Long",
                                        "entry_price": 100.0, "stop_price": 90.0,
                                        "source": None}],
                         "watch_syms": set()}}

    ctx = eng._build_market_scan_ctx(user_ctxs)

    assert ctx["live_prices"]["NVDA"] == 123.45
    assert ctx["regime"]["label"] == "bull_trend"
    assert ctx["regime"]["confidence"] == 0.8
    assert ctx["earnings_by_symbol"] == {"AAPL": "2026-07-03"}

    # A second call sees the FIRST call's label as prev_label (durable ledger).
    ctx2 = eng._build_market_scan_ctx(user_ctxs)
    assert ctx2["regime"]["prev_label"] == "bull_trend"


# ── _fire_candidate ───────────────────────────────────────────────────────────

def test_fire_candidate_delivers_when_importance_high(db_path):
    from api.services.awareness import engine as eng
    from api.services.awareness.rules import InsightCandidate
    _seed_user("u3", "u3@x.com")

    candidate = InsightCandidate(
        kind="stop_hit", symbol="NVDA", headline="NVDA is AT its stop",
        body="body", base_signal=1.0, personal_multiplier=1.3, urgency=2.0,
        dedup_key="NVDA",
    )
    with mock.patch(
        "api.services.watchlist_alert_service.deliver_alert_payload"
    ) as deliver:
        fired = eng._fire_candidate("u3", candidate)

    assert fired is True
    deliver.assert_called_once()
    assert deliver.call_args.kwargs["user_id"] == "u3"
    assert deliver.call_args.kwargs["sym"] == "NVDA"


def test_fire_candidate_no_delivery_below_importance_floor(db_path):
    from api.services.awareness import engine as eng
    from api.services.awareness.rules import InsightCandidate
    _seed_user("u4", "u4@x.com")

    # 0.4*1.0*1.0*10 = 4 -> importance 4, below the delivery floor (8)
    candidate = InsightCandidate(
        kind="earnings_proximity", symbol="AAPL", headline="AAPL reports soon",
        body="body", base_signal=0.4, personal_multiplier=1.0, urgency=1.0,
        dedup_key="AAPL:earnings",
    )
    with mock.patch(
        "api.services.watchlist_alert_service.deliver_alert_payload"
    ) as deliver:
        fired = eng._fire_candidate("u4", candidate)

    assert fired is True
    deliver.assert_not_called()


def test_fire_candidate_suppressed_by_cooldown_returns_false(db_path):
    from api.services.awareness import engine as eng
    from api.services.awareness.rules import InsightCandidate
    _seed_user("u5", "u5@x.com")

    candidate = InsightCandidate(
        kind="stop_hit", symbol="TSLA", headline="TSLA is AT its stop",
        body="body", base_signal=1.0, personal_multiplier=1.0, urgency=1.0,
        dedup_key="TSLA",
    )
    with mock.patch("api.services.watchlist_alert_service.deliver_alert_payload"):
        first = eng._fire_candidate("u5", candidate)
        second = eng._fire_candidate("u5", candidate)  # same symbol -> 6h cooldown

    assert first is True
    assert second is False


# ── run_awareness_scan (end to end) ──────────────────────────────────────────

def test_run_awareness_scan_noop_when_disabled(db_path, monkeypatch):
    from api.services.awareness import engine as eng
    monkeypatch.setenv("AWARENESS_ENGINE_ENABLED", "0")
    assert eng.run_awareness_scan() == {"enabled": False, "scanned_users": 0, "fired": 0}


def test_run_awareness_scan_end_to_end_fires_stop_hit(db_path, monkeypatch):
    from api.services.awareness import engine as eng
    monkeypatch.setenv("AWARENESS_ENGINE_ENABLED", "1")
    _seed_user("u6", "u6@x.com")
    _seed_position("u6", "NVDA", "Long", 100.0, 90.0)

    monkeypatch.setattr(
        eng, "_build_market_scan_ctx",
        lambda user_ctxs: {
            "live_prices": {"NVDA": 88.0},  # below stop -> R1 fires
            "regime": {"label": None, "confidence": None, "prev_label": None},
            "earnings_by_symbol": {},
            "today": date(2026, 7, 2),
        },
    )

    with mock.patch("api.services.watchlist_alert_service.deliver_alert_payload"):
        result = eng.run_awareness_scan()

    assert result["enabled"] is True
    assert result["scanned_users"] == 1
    assert result["fired"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_awareness_engine.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'api.services.awareness.engine'`.

- [ ] **Step 3: Write the implementation**

```python
# api/services/awareness/engine.py
"""Awareness Engine -- Milestone 1 scan cycle.

One shared market scan per cycle (regime + earnings window + cached live
prices) -> per-user filter (bulk-loaded positions + watchlists, two queries
total) -> pure rule functions (rules.py) produce InsightCandidate objects ->
the deterministic relevance score becomes add_insight()'s importance -> the
existing queue (dedup + daily cap + per-symbol cooldown, session-start
speak, chat-thread mirror, tile feed) and away-delivery (email/Discord for
importance >= 8) take it from there, unchanged.

Gated behind AWARENESS_ENGINE_ENABLED (checked here) AND
COMPASS_AUTOMATION_ENABLED (checked by api/main.py's _add_compass_job
before this ever runs on a schedule) -- both default off.
"""
from __future__ import annotations

import logging
import os
from datetime import date, timedelta

from api.services.awareness import regime_snapshots, rules
from api.services.awareness.rules import InsightCandidate

_log = logging.getLogger(__name__)

_DELIVER_IMPORTANCE_FLOOR = 8


def _enabled() -> bool:
    return os.environ.get("AWARENESS_ENGINE_ENABLED", "0") == "1"


def _bulk_load_user_contexts() -> dict[str, dict]:
    """One pass over auth.db builds every user's positions + watchlist
    symbols in two queries total (not N+1 per-user) -- mirrors
    calendar_alerts._collect_all_users_ticker_sets."""
    from api.services.auth_db import get_connection

    positions_by_user: dict[str, list[dict]] = {}
    watch_by_user: dict[str, set[str]] = {}

    conn = get_connection()
    try:
        prows = conn.execute(
            "SELECT user_id, symbol, side, entry_price, stop_price, source "
            "FROM j2_positions WHERE closed_at IS NULL"
        ).fetchall()
        for r in prows:
            sym = (r["symbol"] or "").upper()
            if not sym:
                continue
            positions_by_user.setdefault(r["user_id"], []).append({
                "symbol": sym,
                "side": r["side"],
                "entry_price": r["entry_price"],
                "stop_price": r["stop_price"],
                "source": r["source"],
            })

        wrows = conn.execute(
            "SELECT w.user_id AS user_id, wi.sym AS sym FROM watchlist_items wi "
            "JOIN watchlists w ON w.id = wi.watchlist_id"
        ).fetchall()
        for r in wrows:
            sym = (r["sym"] or "").upper()
            if not sym:
                continue
            watch_by_user.setdefault(r["user_id"], set()).add(sym)
    finally:
        conn.close()

    all_users = set(positions_by_user) | set(watch_by_user)
    return {
        uid: {
            "positions": positions_by_user.get(uid, []),
            "watch_syms": watch_by_user.get(uid, set()),
        }
        for uid in all_users
    }


def _collect_earnings_window(today: date, days: int) -> dict[str, str]:
    """{SYMBOL: earliest report date (YYYY-MM-DD)} across the next `days`
    calendar days. Reuses calendar_alerts' per-date reporter lookup
    (calendar_weekly cache, Finnhub fallback) -- one call per day in the
    (small) window, never per-ticker."""
    from api.services.calendar_alerts import _get_reporters_for_date

    out: dict[str, str] = {}
    for offset in range(0, max(0, days) + 1):
        d = today + timedelta(days=offset)
        d_str = d.isoformat()
        try:
            reporters = _get_reporters_for_date(d_str)
        except Exception as e:  # noqa: BLE001
            _log.debug("[awareness] earnings lookup failed for %s: %s", d_str, e)
            continue
        for sym in reporters:
            if sym not in out:  # keep the EARLIEST date per symbol
                out[sym] = d_str
    return out


def _build_market_scan_ctx(user_ctxs: dict) -> dict:
    """The ONE shared market-wide computation per cycle: regime (+ prior
    label from the durable snapshot ledger), an earnings window, and cached
    live prices for every symbol any user currently holds. No per-user or
    per-position network fetches happen here."""
    from api.routers.live_prices import cache as _px_cache, _px_key
    from api.services.voice_regime_classifier import get_current_regime

    all_syms: set[str] = set()
    for ctx in user_ctxs.values():
        for pos in ctx["positions"]:
            if pos["symbol"]:
                all_syms.add(pos["symbol"])

    live_prices: dict[str, float] = {}
    for sym in all_syms:
        hit = _px_cache.get(_px_key(sym))
        price = (hit or {}).get("price") if hit else None
        if price:
            live_prices[sym] = float(price)

    prev_label = regime_snapshots.get_last_label()
    current = get_current_regime()
    label = current.get("regime")
    confidence = current.get("confidence", 0.5)
    if label:
        regime_snapshots.record_snapshot(label, confidence)

    today = date.today()
    days = int(os.environ.get("AWARENESS_EARNINGS_PROXIMITY_DAYS", "3"))
    earnings_by_symbol = _collect_earnings_window(today, days)

    return {
        "live_prices": live_prices,
        "regime": {"label": label, "confidence": confidence, "prev_label": prev_label},
        "earnings_by_symbol": earnings_by_symbol,
        "today": today,
    }


def _fire_candidate(user_id: str, candidate: InsightCandidate) -> bool:
    """Score -> add_insight (dedup/cap/cooldown enforced there) -> also
    away-deliver (email/Discord/in-app) when importance clears the floor."""
    from api.services.voice_proactive_service import add_insight

    importance = rules.compute_relevance_score(
        candidate.base_signal, candidate.personal_multiplier, candidate.urgency,
    )
    insight_id = add_insight(
        user_id,
        kind=candidate.kind,
        headline=candidate.headline,
        symbol=candidate.dedup_key,
        body=candidate.body,
        importance=importance,
    )
    if insight_id is None:
        return False  # suppressed by daily cap / per-symbol cooldown

    if importance >= _DELIVER_IMPORTANCE_FLOOR:
        try:
            from api.services.watchlist_alert_service import deliver_alert_payload
            deliver_alert_payload(
                user_id=user_id,
                sym=candidate.symbol or "",
                title=candidate.headline,
                message=candidate.body or candidate.headline,
                source="awareness_engine",
                extra_data={"kind": candidate.kind},
            )
        except Exception as e:  # noqa: BLE001
            _log.warning("[awareness] away-delivery failed for %s: %s", user_id, e)
    return True


def run_awareness_scan() -> dict:
    """The scan cycle entry point. Returns a small summary dict for logging."""
    if not _enabled():
        return {"enabled": False, "scanned_users": 0, "fired": 0}

    user_ctxs = _bulk_load_user_contexts()
    scan_ctx = _build_market_scan_ctx(user_ctxs)

    fired = 0
    for user_id, user_ctx in user_ctxs.items():
        candidates: list[InsightCandidate] = []
        candidates += rules.rule_stop_watch(scan_ctx, user_ctx)
        candidates += rules.rule_earnings_proximity(scan_ctx, user_ctx)
        candidates += rules.rule_regime_flip(scan_ctx, user_ctx)
        for candidate in candidates:
            try:
                if _fire_candidate(user_id, candidate):
                    fired += 1
            except Exception as e:  # noqa: BLE001
                _log.warning("[awareness] fire failed user=%s kind=%s: %s",
                             user_id, candidate.kind, e)

    return {"enabled": True, "scanned_users": len(user_ctxs), "fired": fired}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_awareness_engine.py -q`
Expected: 9 passed.

- [ ] **Step 5: Run the full awareness suite together**

Run: `python -m pytest tests/test_awareness_rules.py tests/test_awareness_regime_snapshots.py tests/test_awareness_engine.py -q`
Expected: 33 passed.

- [ ] **Step 6: Commit**

```
git add api/services/awareness/engine.py tests/test_awareness_engine.py
git commit -m "feat(awareness): engine.py -- scan cycle orchestrator (shared scan, bulk per-user, dedup-fire, away-delivery)"
```

---

### Task 7: Scheduler wiring — double flag gate in `api/main.py`

**Files:**
- Edit: `api/main.py`

**Interfaces:**
- New scheduler job `id="awareness_engine_scan"`, registered via the existing `_add_compass_job` helper (~line 1928), placed near the `_voice_window_scan` jobs (~line 2349-2363).
- New init-schema call for `regime_snapshots` alongside the existing `indicator_alert_service.init_schema()` call (~line 977).

**Note on TDD scope:** this task is scheduler *glue* inside `api/main.py`'s monolithic startup function — every existing `_add_compass_job(...)` call site in this file (broker sync, voice window scans, daily focus, nightly consolidate) is wired the same way with **no dedicated unit test**, because triggering real APScheduler registration requires full app startup (DB, external services). The actual logic being scheduled (`run_awareness_scan`) is already fully unit-tested in Task 6. Verification here follows the repo's own precedent for this class of change (the documented `grep -c broker_sync api/main.py` invariant) — a source-grep check plus a local manual smoke test, not a pytest file.

- [ ] **Step 1: Add the `regime_snapshots` schema init**

In `api/main.py`, immediately after the existing indicator-alerts init block (~line 977-981), add:

```python
    # Awareness Engine (M1): durable regime-label ledger. Cheap + idempotent;
    # initialized unconditionally (like indicator_alert_service) so local
    # dev/tests never need AWARENESS_ENGINE_ENABLED=1 just to read/write it.
    try:
        from api.services.awareness import regime_snapshots as _awareness_regime_snapshots
        _awareness_regime_snapshots.init_schema()
        logging.getLogger(__name__).info("[startup] awareness regime_snapshots schema ready")
    except Exception:
        logging.getLogger(__name__).exception(
            "[startup] awareness regime_snapshots schema init failed"
        )
```

- [ ] **Step 2: Add the scheduler job**

In `api/main.py`, immediately after the three `_add_compass_job(lambda: _voice_window_scan(...))` calls (~line 2349-2363), add:

```python
        def _awareness_engine_scan():
            import os as _os_aw
            if _os_aw.environ.get("AWARENESS_ENGINE_ENABLED", "0") != "1":
                print("[awareness] AWARENESS_ENGINE_ENABLED not set -- skipping scan "
                      "(set AWARENESS_ENGINE_ENABLED=1 alongside COMPASS_AUTOMATION_ENABLED=1)")
                return
            try:
                from api.services.awareness.engine import run_awareness_scan
                result = run_awareness_scan()
                print(f"[awareness] scan complete: {result}")
            except Exception as e:
                print(f"[awareness] scan failed: {e}")

        # Calm/surgical cadence: every 20 minutes, weekday market-adjacent
        # hours only. Daily caps + per-symbol cooldowns (existing
        # add_insight) do the rest of the noise control.
        _add_compass_job(_awareness_engine_scan,
                           trigger=CronTrigger(day_of_week="mon-fri",
                                               hour="4-20", minute="*/20"),
                           id="awareness_engine_scan",
                           max_instances=1, replace_existing=True)
```

- [ ] **Step 3: Verify via source grep (matches the repo's own `broker_sync` invariant style)**

Run: `grep -n "awareness_engine_scan\|AWARENESS_ENGINE_ENABLED\|regime_snapshots" api/main.py`
Expected output includes all of:
- `_awareness_regime_snapshots.init_schema()`
- `def _awareness_engine_scan():`
- the `AWARENESS_ENGINE_ENABLED` check inside that function
- the `_add_compass_job(_awareness_engine_scan, ...)` registration with `id="awareness_engine_scan"`

Also re-run the existing locked invariant to confirm this edit didn't disturb it:
Run: `grep -c broker_sync api/main.py`
Expected: `>= 7` (unchanged from before this edit).

- [ ] **Step 4: Local manual smoke test**

```
$env:AUTH_DB_PATH="C:\Users\Patrick\uct-dashboard\.worktrees\awareness-m1\_tmp_auth.db"
$env:COMPASS_AUTOMATION_ENABLED="1"
$env:AWARENESS_ENGINE_ENABLED="1"
python -m uvicorn api.main:app --port 8099
```
Expected in startup logs: `[startup] awareness regime_snapshots schema ready` and the job registers without error (no `[startup] Compass automation PAUSED` line for `awareness_engine_scan`). Ctrl+C to stop; delete `_tmp_auth.db*`.

- [ ] **Step 5: Run the full backend suite to confirm no regressions**

Run: `python -m pytest tests/ -q` — confirm no new failures introduced by the `api/main.py` edit (compare against the known pre-existing baseline failures).

- [ ] **Step 6: Commit**

```
git add api/main.py
git commit -m "feat(awareness): scheduler wiring -- double-gated (COMPASS_AUTOMATION_ENABLED + AWARENESS_ENGINE_ENABLED) 20min scan"
```

---

### Task 8: Frontend — revive `CompassTodayTile` as a grouped dismissible feed, mount on Dashboard

**Files:**
- Edit: `app/src/components/tiles/CompassTodayTile.jsx`
- Edit: `app/src/components/tiles/CompassTodayTile.module.css`
- Create: `app/src/components/tiles/CompassTodayTile.test.jsx`
- Edit: `app/src/pages/Dashboard.jsx`

**Interfaces:**
- `CompassTodayTile` (default export, no props) — fetches `GET /api/voice/insights?limit=20` (existing), renders `null` while loading and when there is nothing to show (no `daily_focus` insight AND zero undismissed non-focus insights). Otherwise renders a `TileCard` with: the existing intervention banner + "today's focus" block + Talk-to-Compass footer (unchanged), PLUS a new grouped, dismissible feed of undismissed non-focus insights (grouped by `kind`), each row wired to the existing `POST /api/voice/insights/{id}/dismiss`.

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/components/tiles/CompassTodayTile.test.jsx
import { renderWithProviders, screen, fireEvent, waitFor } from '../../test-utils'
import { vi } from 'vitest'

const h = vi.hoisted(() => ({ data: undefined }))

vi.mock('swr', () => ({
  default: () => ({
    data: h.data,
    mutate: vi.fn(),
  }),
}))

vi.mock('../../hooks/useRealtimeSession', () => ({
  default: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
}))

import CompassTodayTile from './CompassTodayTile'

beforeEach(() => {
  h.data = undefined
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
})

test('renders nothing while loading', () => {
  h.data = undefined
  const { container } = renderWithProviders(<CompassTodayTile />)
  expect(container.firstChild).toBeNull()
})

test('renders nothing when there is no focus and no undismissed insights', () => {
  h.data = { insights: [] }
  const { container } = renderWithProviders(<CompassTodayTile />)
  expect(container.firstChild).toBeNull()
})

test("renders today's focus block", () => {
  h.data = {
    insights: [{ id: 1, kind: 'daily_focus', headline: 'Focus', body: 'Stay disciplined.', dismissed_at: null }],
  }
  renderWithProviders(<CompassTodayTile />)
  expect(screen.getByText("Today's focus")).toBeInTheDocument()
  expect(screen.getByText('Stay disciplined.')).toBeInTheDocument()
})

test('groups noticed insights by kind and shows dismiss buttons', () => {
  h.data = {
    insights: [
      { id: 2, kind: 'stop_hit', symbol: 'NVDA', headline: 'NVDA is AT or THROUGH its stop', body: 'Long NVDA...', dismissed_at: null },
      { id: 3, kind: 'earnings_proximity', symbol: 'AAPL', headline: 'AAPL reports earnings today', body: 'You own AAPL...', dismissed_at: null },
    ],
  }
  renderWithProviders(<CompassTodayTile />)
  expect(screen.getByText('At Stop')).toBeInTheDocument()
  expect(screen.getByText('Earnings')).toBeInTheDocument()
  expect(screen.getAllByLabelText(/Dismiss:/)).toHaveLength(2)
})

test('excludes dismissed insights from the feed', () => {
  h.data = {
    insights: [
      { id: 4, kind: 'stop_proximity', symbol: 'TSLA', headline: 'TSLA nearing stop', body: null, dismissed_at: '2026-07-01T00:00:00Z' },
    ],
  }
  const { container } = renderWithProviders(<CompassTodayTile />)
  expect(container.firstChild).toBeNull()
})

test('clicking dismiss posts to the dismiss endpoint', async () => {
  h.data = {
    insights: [
      { id: 5, kind: 'stop_hit', symbol: 'MSFT', headline: 'MSFT is AT or THROUGH its stop', body: null, dismissed_at: null },
    ],
  }
  renderWithProviders(<CompassTodayTile />)
  fireEvent.click(screen.getByLabelText(/Dismiss:/))
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/voice/insights/5/dismiss',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/components/tiles/CompassTodayTile.test.jsx`
Expected: FAIL — current component always renders `TileCard` (never `null`), has no grouped feed, no dismiss buttons, no "At Stop"/"Earnings" group labels.

- [ ] **Step 3: Rewrite the component**

Replace the full contents of `app/src/components/tiles/CompassTodayTile.jsx`:

```jsx
/**
 * CompassTodayTile — "Compass noticed" surface on the main Dashboard.
 *
 * Shows, when there is something to show:
 *   - Today's focus message (composed at 7:30 AM ET, otherwise live)
 *   - Active intervention count (gold warning if any are firing)
 *   - A grouped, dismissible feed of what Compass noticed today (stop
 *     watches, earnings proximity, regime flips, etc. — Awareness Engine
 *     M1 producers, plus any existing insight kinds) grouped by kind
 *   - A "Talk to Compass" CTA that opens a Realtime voice session
 *
 * Renders NOTHING (returns null) while loading or when there is no focus
 * message and zero undismissed insights — this is a calm/surgical surface,
 * not permanent dashboard chrome.
 */
import { useContext, useMemo, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import TileCard from '../TileCard'
import { VoiceContext } from '../../context/VoiceContext'
import useRealtimeSession from '../../hooks/useRealtimeSession'
import UIcon from '../ui/UIcon'
import styles from './CompassTodayTile.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

const KIND_LABELS = {
  stop_hit: 'At Stop',
  stop_proximity: 'Nearing Stop',
  earnings_proximity: 'Earnings',
  regime_flip: 'Regime',
  regime_shift: 'Regime',
  watchlist_alert: 'Watchlist',
  scanner_match: 'Scanner',
  mistake_pattern: 'Discipline',
  drift_warning: 'Discipline',
}

function kindLabel(kind) {
  return KIND_LABELS[kind] || 'Compass'
}

function groupByKind(insights) {
  const groups = new Map()
  for (const ins of insights) {
    const key = ins.kind || 'other'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(ins)
  }
  return [...groups.entries()]
}

export default function CompassTodayTile() {
  const { data, mutate } = useSWR(
    '/api/voice/insights?limit=20',
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: true },
  )

  const insights = data?.insights || []
  const todayFocus = insights.find((i) => i.kind === 'daily_focus' && !i.dismissed_at)
  const noticed = useMemo(
    () => insights.filter((i) => i.kind !== 'daily_focus' && !i.dismissed_at),
    [insights],
  )

  // Still loading, OR loaded with nothing to show — render nothing (calm,
  // not another empty tile on an already-busy dashboard).
  if (!data || (!todayFocus && noticed.length === 0)) {
    return null
  }

  return (
    <TileCard icon="compass" title="Compass · Today">
      <CompassTodayBody todayFocus={todayFocus} noticed={noticed} mutate={mutate} />
    </TileCard>
  )
}

function CompassTodayBody({ todayFocus, noticed, mutate }) {
  const voice = useContext(VoiceContext)
  const [dismissing, setDismissing] = useState(() => new Set())

  const interventionKinds = new Set(['mistake_pattern', 'drift_warning'])
  const recentInterventionCount = noticed.filter((i) => interventionKinds.has(i.kind)).length

  const handleDismiss = useCallback(async (id) => {
    setDismissing((prev) => new Set(prev).add(id))
    // Optimistic: mark it dismissed locally so it drops out of `noticed`
    // immediately, then confirm with the server and revalidate.
    mutate(
      (current) => {
        if (!current?.insights) return current
        return {
          ...current,
          insights: current.insights.map((i) =>
            i.id === id ? { ...i, dismissed_at: new Date().toISOString() } : i,
          ),
        }
      },
      { revalidate: false },
    )
    try {
      await fetch(`/api/voice/insights/${id}/dismiss`, {
        method: 'POST',
        credentials: 'include',
      })
    } finally {
      mutate()
    }
  }, [mutate])

  const inVoiceSession = !!voice
    && voice.mode === 'c'
    && voice.status !== 'idle'
    && voice.status !== 'error'

  const groups = groupByKind(noticed)

  return (
    <div className={styles.body}>
      {recentInterventionCount > 0 && (
        <div className={styles.interventionBanner}>
          <UIcon name="warning" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />{recentInterventionCount} active{' '}
          {recentInterventionCount === 1 ? 'intervention' : 'interventions'}
          {' — '}
          <Link to="/journal" className={styles.interventionLink}>
            review on Compass
          </Link>
        </div>
      )}

      {todayFocus && (
        <div className={styles.focusBlock}>
          <div className={styles.focusLabel}>Today's focus</div>
          <div className={styles.focusBody}>{todayFocus.body || todayFocus.headline}</div>
        </div>
      )}

      {groups.length > 0 && (
        <div className={styles.feedSection}>
          {groups.map(([kind, items]) => (
            <div key={kind} className={styles.feedGroup}>
              <div className={styles.feedGroupLabel}>{kindLabel(kind)}</div>
              {items.map((ins) => (
                <div key={ins.id} className={styles.feedItem}>
                  <div className={styles.feedItemMain}>
                    <div className={styles.feedItemHeadline}>
                      {ins.symbol && <span className={styles.feedItemSym}>{ins.symbol}</span>}
                      {ins.headline}
                    </div>
                    {ins.body && <div className={styles.feedItemBody}>{ins.body}</div>}
                  </div>
                  <button
                    type="button"
                    className={styles.dismissBtn}
                    aria-label={`Dismiss: ${ins.headline}`}
                    disabled={dismissing.has(ins.id)}
                    onClick={() => handleDismiss(ins.id)}
                  >
                    <UIcon name="x" size={12} />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className={styles.footer}>
        <TalkButton inSession={inVoiceSession} voiceAvailable={!!voice} />
        <Link to="/journal" className={styles.compassTabLink}>
          Open Compass tab →
        </Link>
      </div>
    </div>
  )
}


function TalkButton({ inSession, voiceAvailable }) {
  if (!voiceAvailable) return null
  return <TalkButtonInner inSession={inSession} />
}


function TalkButtonInner({ inSession }) {
  const { connect, disconnect } = useRealtimeSession()
  return (
    <button
      type="button"
      onClick={() => (inSession ? disconnect() : connect('compass'))}
      className={`${styles.talkBtn} ${inSession ? styles.talkBtnActive : ''}`}
      aria-label={inSession ? 'End voice conversation' : 'Talk to Compass'}
    >
      {inSession ? '◉ End call' : <><UIcon name="compass" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Talk to Compass</>}
    </button>
  )
}
```

**Adaptation note:** before writing, read the CURRENT `CompassTodayTile.jsx` and its module.css — reuse its existing class names (`body`, `interventionBanner`, `focusBlock`, `talkBtn`, etc.), its `VoiceContext`/`useRealtimeSession` import paths, and its `TileCard`/`UIcon` conventions EXACTLY as they exist. The JSX above is the target shape; the imports and small helpers must match the real file's current idioms (this component already exists — this is a rewrite, not a from-scratch file).

- [ ] **Step 4: Add the feed styles**

Append to `app/src/components/tiles/CompassTodayTile.module.css`:

```css
.feedSection {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.feedGroup {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.feedGroupLabel {
  font-size: 10px;
  color: var(--text-muted);
  letter-spacing: 0.6px;
  text-transform: uppercase;
  font-weight: 700;
}

.feedItem {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border);
  border-radius: 4px;
}

.feedItemMain {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.feedItemHeadline {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-bright);
  line-height: 1.4;
}

.feedItemSym {
  color: var(--ut-gold, #c9a84c);
  font-weight: 700;
  margin-right: 6px;
}

.feedItemBody {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
}

.dismissBtn {
  flex-shrink: 0;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px;
  border-radius: 3px;
  line-height: 0;
}

.dismissBtn:hover:not(:disabled) {
  color: var(--text-bright);
  background: rgba(255, 255, 255, 0.06);
}

.dismissBtn:disabled {
  opacity: 0.4;
  cursor: default;
}
```

- [ ] **Step 5: Mount on Dashboard**

In `app/src/pages/Dashboard.jsx`, add the import:

```jsx
import CompassTodayTile from '../components/tiles/CompassTodayTile'
```

Desktop — after `<DeskVideoRail />` inside `.desktopOnly` (renders null internally when empty, so it never displaces `JournalSnapshotTile` in the rail above):

```jsx
          <DeskVideoRail />
          <CompassTodayTile />
        </div>
```

Mobile — after `<DeskVideoRail />` inside the `<PullToRefresh>` stack (last item, same self-hiding behavior):

```jsx
            {/* From the Desk — video discovery rail */}
            <DeskVideoRail />
            <CompassTodayTile />
          </PullToRefresh>
```

(Verify the real Dashboard.jsx structure before editing — match the actual surrounding JSX.)

- [ ] **Step 6: Run test to verify it passes**

Run: `cd app && npx vitest run src/components/tiles/CompassTodayTile.test.jsx`
Expected: 6 passed.

- [ ] **Step 7: Run the full frontend suite to confirm no regressions**

Run: `cd app && npm test`
Expected: all existing tests still pass (no change to `Dashboard.test.jsx` behavior since the tile renders `null` in every test fixture that doesn't mock `/api/voice/insights`).

- [ ] **Step 8: Commit**

```
git add app/src/components/tiles/CompassTodayTile.jsx app/src/components/tiles/CompassTodayTile.module.css app/src/components/tiles/CompassTodayTile.test.jsx app/src/pages/Dashboard.jsx
git commit -m "feat(awareness): revive CompassTodayTile as a grouped dismissible 'Compass noticed' feed, mount on Dashboard"
```

---

### Task 9: Docs + activation notes (no code)

**Files:**
- Edit: `CLAUDE.md`

- [ ] **Step 1: Add a CLAUDE.md section**

Append a new `## Awareness Engine — Milestone 1 (dark, flag-gated)` section to `CLAUDE.md`, modeled on the existing "Compass Brain Bridge" section, covering: what it watches (R1/R2 stops, R4 regime flip, R5 earnings proximity), the two flags (`AWARENESS_ENGINE_ENABLED` + existing `COMPASS_AUTOMATION_ENABLED`), the `regime_snapshots` table, the broker placeholder-stop skip, and the CompassTodayTile revival + Dashboard mount. Include this exact activation note:

> **Activation:** both `COMPASS_AUTOMATION_ENABLED=1` AND `AWARENESS_ENGINE_ENABLED=1` must be set in Railway for the scan to run at all (the job registers only under the first; the job function itself checks the second). Rollback = unset either one — no code change, no rebuild.

- [ ] **Step 2: Commit**

```
git add CLAUDE.md
git commit -m "docs: Awareness Engine M1 -- architecture, flags, activation notes"
```

---

## Self-Review vs. spec §5.4 M1 scope

- **Watches stops (R1/R2):** Task 2 — at-stop + near-stop, broker placeholder skip, cached-price-only (never fetches per-position). ✓
- **Earnings-proximity (R5):** Task 5 — owned + watched, 3-day default window, composite cooldown key. ✓
- **Regime-flip (R4):** Tasks 3 + 4 — new durable `regime_snapshots` ledger (the missing piece per recon) + the flip rule that reads it. ✓
- **Writes via existing `add_insight`:** Task 6's `_fire_candidate` — no new queue, no new cap/cooldown logic. ✓
- **Upgrades the tile feed:** Task 8 — `CompassTodayTile` goes from a single "last noticed" line to a grouped, dismissible feed; mounted for the first time (it was built but never mounted). ✓
- **Away-delivery via existing email/Discord:** Task 6 — `deliver_alert_payload` fires for importance ≥ 8, same channel fan-out as every other alert producer. ✓
- **Gated behind `COMPASS_AUTOMATION_ENABLED` + new `AWARENESS_ENGINE_ENABLED`, both default off:** Task 7 — double-gated (external registration + internal check). ✓
- **One shared market scan per cycle → per-user filter:** Task 6 — `_build_market_scan_ctx` runs once; `_bulk_load_user_contexts` is two queries total, not N+1. ✓
- **Deterministic relevance score → importance:** Task 1 — pure, tested, clamped 1-10. ✓
- **Daily caps + per-symbol cooldowns:** inherited unchanged from `add_insight` (not reimplemented). ✓
- **Calm/surgical:** 20-minute cadence, 3-day earnings window, 3% near-stop band, importance-floor-gated away-delivery.
- **Type/interface consistency:** `InsightCandidate` (Task 1) is the single currency every rule (Tasks 2/4/5) returns and `engine.py` (Task 6) consumes; `scan_ctx`/`user_ctx` shapes are identical across all three rule functions and their tests.
- **Out of scope for M1 (explicitly, per spec §5.4 "First milestone"):** R3 (watchlist setup trigger), R6 (leading sector rotation), R7 (catalyst on owned/watched), R8 (tilt/behavior), R9 (big move), R10 (user technical alerts), the `awareness_preferences` learning table, and real web-push — all correctly deferred to later milestones.

---

### Critical Files for Implementation
- api/services/awareness/rules.py
- api/services/awareness/engine.py
- api/services/awareness/regime_snapshots.py
- api/main.py
- app/src/components/tiles/CompassTodayTile.jsx
