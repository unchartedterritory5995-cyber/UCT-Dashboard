"""Phase 8, Package 8C (persistence bridge) — the narrow, owner-authorized
schema change: ONE new nullable column, `eligibility_json`, on
`pattern_detections`.

These tests exercise the REAL SQLite write/read path end-to-end (detector
fixture -> canonical_adapter -> memory.store_detection -> real DB row ->
memory._row_to_detection), not just in-memory dict manipulation. Isolation
comes from the repo-root conftest.py's env redirect (same mechanism every
other pattern_engine DB test already relies on) -- nothing here touches
`C:\\data` or any real patterns.db.

Scope, matching the authorization exactly: `eligibility_json` only. `event`/
`criteria`/`gate_trace` remain in-memory-only (no column exists for them) --
several tests below assert this absence explicitly, not just by omission.
"""
import time

import pytest

from api.services.pattern_engine import memory, pattern_db
from api.services.pattern_engine.canonical_adapter import (
    adapt_high_tight_flag,
    adapt_power_earnings_gap,
)
from api.services.pattern_engine.detectors.uct.high_tight_flag import detect_high_tight_flag
from api.services.pattern_engine.detectors.uct.power_earnings_gap import detect_power_earnings_gap
from api.services.pattern_engine.pattern_db import get_connection, init_db
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


def _one_firing_detection(family, detect_fn, sym, tf):
    for fx in load_all_fixtures(family, include_internal=False):
        if not fx.expected_fires:
            continue
        ctx = fx.context if fx.context is not None else build_context(fx.bars, sym="TEST")
        detections = detect_fn(fx.bars, ctx)
        if detections:
            d = max(detections, key=lambda x: x["confidence"])
            d = dict(d)
            d["sym"], d["tf"] = sym, tf
            return d
    raise AssertionError(f"no firing {family} fixture found")


# ─── Schema / migration mechanics ─────────────────────────────────────────

def test_eligibility_json_column_exists_after_init():
    init_db()
    conn = get_connection()
    try:
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(pattern_detections)")}
        assert "eligibility_json" in cols
    finally:
        conn.close()


def test_alter_is_idempotent_across_repeated_calls():
    """CREATE TABLE IF NOT EXISTS in _SCHEMA is a no-op on an existing table
    -- _apply_pattern_alters is the actual mechanism that lands the column,
    and it must tolerate being run twice against the same already-altered
    table (exactly what happens on process restart against a live DB)."""
    conn = get_connection()
    try:
        pattern_db._apply_pattern_alters(conn)  # already applied once by init_db()
        pattern_db._apply_pattern_alters(conn)  # must not raise
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(pattern_detections)")}
        assert "eligibility_json" in cols
    finally:
        conn.close()


# ─── Round-trip: detector -> adapter -> real DB -> read back ──────────────

def test_htf_eligibility_round_trips_through_the_real_db():
    d = _one_firing_detection("high_tight_flag", detect_high_tight_flag, "AAPL", "D")
    d["id"] = f"8c-htf-{d['id']}"
    adapted = adapt_high_tight_flag(d)

    memory.store_detection(adapted)
    got = memory.get_detection_by_id(adapted["id"])

    assert got is not None
    assert got["eligibility"] == adapted["eligibility"]
    # Every pre-existing field survives the round-trip unchanged too.
    for key in ("pattern_id", "confidence", "status", "direction", "geometry", "levels", "narrative"):
        assert got[key] == adapted[key]


def test_peg_eligibility_round_trips_but_event_and_gate_trace_do_not():
    """The documented persistence gap, proven directly rather than merely
    asserted in prose: `event`/`gate_trace` are real, correct, in-memory
    canonical data (proven in Gate 1/8B) that this package's schema has NO
    column for -- so they must NOT survive a real DB round-trip, and a
    consumer reading a stored detection must not silently assume they will."""
    d = _one_firing_detection("power_earnings_gap", detect_power_earnings_gap, "MSFT", "D")
    d["id"] = f"8c-peg-{d['id']}"
    adapted = adapt_power_earnings_gap(d)
    assert "event" in adapted and "gate_trace" in adapted  # sanity: adapter did its job

    memory.store_detection(adapted)
    got = memory.get_detection_by_id(adapted["id"])

    assert got is not None
    assert got["eligibility"] == adapted["eligibility"]
    assert "event" not in got, "event has no persisted column -- must not silently survive"
    assert "gate_trace" not in got, "gate_trace has no persisted column -- must not silently survive"


def test_detection_without_eligibility_persists_null_not_a_fabricated_value():
    """A Detection that never went through an adapter (the normal case for
    every one of the 30+ live detectors today) must round-trip with
    eligibility_json NULL in the DB and an ABSENT `eligibility` key on read
    -- never a fabricated True/False."""
    d = _one_firing_detection("high_tight_flag", detect_high_tight_flag, "TSLA", "D")
    d["id"] = f"8c-raw-{d['id']}"
    assert "eligibility" not in d  # raw detector output, not adapted

    memory.store_detection(d)

    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT eligibility_json FROM pattern_detections WHERE id = ?", (d["id"],)
        ).fetchone()
        assert row["eligibility_json"] is None
    finally:
        conn.close()

    got = memory.get_detection_by_id(d["id"])
    assert "eligibility" not in got


# ─── Insert / update / upsert semantics ────────────────────────────────────

def test_upsert_updates_eligibility_when_resupplied():
    d = _one_firing_detection("high_tight_flag", detect_high_tight_flag, "NVDA", "D")
    d["id"] = "8c-upsert-a"
    first = adapt_high_tight_flag(d, now=1_800_000_000)
    memory.store_detection(first)

    second = adapt_high_tight_flag(d, now=1_800_003_600)  # same hash_key (sym/tf/pattern_id/start_t/end_t)
    second["id"] = "8c-upsert-a"  # UPSERT path keyed on hash_key, not id
    memory.store_detection(second)

    got = memory.get_detection_by_id("8c-upsert-a")
    assert got["eligibility"]["evaluated_at"] == 1_800_003_600


def test_upsert_overwrites_eligibility_to_null_on_a_plain_rescan():
    """Deliberate design decision, documented here as a test not just prose:
    eligibility is a POINT-IN-TIME evaluation (Phase-7 spec, Eligibility's
    own docstring) -- a later UPSERT that does NOT resupply it must clear
    the old value, exactly like every other field in this same UPSERT
    (confidence/geometry/etc. are all unconditionally overwritten, never
    conditionally preserved). A stale `eligible=True` surviving after a
    normal re-scan stopped supplying it would be actively misleading, worse
    than an honest NULL."""
    d = _one_firing_detection("high_tight_flag", detect_high_tight_flag, "AMD", "D")
    d["id"] = "8c-upsert-b"
    adapted = adapt_high_tight_flag(d)
    memory.store_detection(adapted)
    assert memory.get_detection_by_id("8c-upsert-b")["eligibility"] is not None

    plain_rescan = dict(d)  # same hash_key, no eligibility -- a normal detector re-fire
    plain_rescan["id"] = "8c-upsert-b"
    memory.store_detection(plain_rescan)

    got = memory.get_detection_by_id("8c-upsert-b")
    assert "eligibility" not in got


# ─── Legacy-row / migration safety (the regression this package fixed) ────

def test_legacy_pre_8c_row_migrates_without_column_count_mismatch(tmp_path, monkeypatch):
    """A legacy auth.db snapshot taken before eligibility_json existed has
    ONE FEWER column than the current local schema. The one-shot migration
    used to do a bare `INSERT ... SELECT *`, which requires matching column
    counts -- this pins the explicit-column-list fix that keeps it correct
    regardless of which side of this schema change either DB is on."""
    import sqlite3
    from api.services import auth_db

    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    pattern_db._initialized_paths.clear()

    legacy = sqlite3.connect(tmp_path / "auth.db")
    legacy.execute("""CREATE TABLE pattern_detections (
        id TEXT PRIMARY KEY, sym TEXT NOT NULL, tf TEXT NOT NULL,
        pattern_id TEXT NOT NULL, category TEXT NOT NULL, direction TEXT NOT NULL,
        start_t INTEGER NOT NULL, end_t INTEGER NOT NULL, confidence REAL NOT NULL,
        quality_json TEXT NOT NULL, geometry_json TEXT NOT NULL,
        levels_json TEXT NOT NULL, context_json TEXT NOT NULL,
        narrative_json TEXT NOT NULL, status TEXT NOT NULL,
        detected_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
        hash_key TEXT NOT NULL UNIQUE)""")  # 18 columns, no eligibility_json
    legacy.execute(
        "INSERT INTO pattern_detections VALUES ('legacy-1','AAPL','D','bull_flag',"
        "'classical','bullish',1,2,75,'{}','{}','{}','{}','{}','ready',10,10,'hk-legacy-1')")
    legacy.commit()
    legacy.close()

    init_db()  # must not raise, and must actually copy the row (not silently skip it)

    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT sym, eligibility_json FROM pattern_detections WHERE id='legacy-1'"
        ).fetchone()
        assert row is not None and row["sym"] == "AAPL"
        assert row["eligibility_json"] is None
    finally:
        conn.close()

    got = memory.get_detection_by_id("legacy-1")
    assert "eligibility" not in got
