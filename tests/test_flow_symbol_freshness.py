"""Per-symbol freshness: the identity that makes a Search product cacheable.

⛔ WHY THE GLOBAL VERSION CANNOT BE THE KEY, measured 2026-09-08 over 151
samples of /api/flow/aggregate-health:

    pre-open   the tape version rolls every 5-9 MINUTES
    during RTH it rolls every 60 SECONDS, consecutively

It moves whenever ANY symbol ticks. So a per-ticker product keyed on it is
discarded once a minute however quiet that ticker is -- during exactly the hours
members use Search. `"<max_id>.<prune_generation>"` is keyed on the symbol's own
rows instead: a ticker that has not traded keeps its product, and one that HAS
invalidates immediately rather than up to 60 s late. Faster AND fresher.
"""
import sqlite3

import pytest

from api.flow_db import FlowDB


@pytest.fixture
def db(tmp_path):
    d = FlowDB(str(tmp_path / "flow.db"))
    return d


def _insert(d, symbol, created, source="stocks"):
    with d._conn() as conn:
        conn.execute(
            "INSERT INTO flow (Symbol, source, CreatedDate) VALUES (?,?,?)",
            (symbol, source, created))


def test_a_symbol_with_no_rows_is_zero_not_an_error(db):
    assert db.symbol_max_id("NOPE") == 0
    assert db.symbol_freshness("NOPE") == "0.0"


def test_an_insert_moves_that_symbols_freshness(db):
    _insert(db, "AMD", "09/08/2026")
    before = db.symbol_freshness("AMD")
    _insert(db, "AMD", "09/08/2026")
    assert db.symbol_freshness("AMD") != before


def test_an_insert_for_ANOTHER_symbol_does_NOT(db):
    """⛔ THE WHOLE POINT. Under the global version this is exactly what kept
    invalidating quiet tickers once a minute."""
    _insert(db, "AMD", "09/08/2026")
    _insert(db, "ALIT", "09/08/2026")
    quiet = db.symbol_freshness("ALIT")

    for _ in range(5):
        _insert(db, "AMD", "09/08/2026")

    assert db.symbol_freshness("ALIT") == quiet, (
        "a busy ticker invalidated a quiet one's product -- the defect this "
        "key exists to remove")
    # CONTROL: the busy one really did move, so the test above is not vacuous.
    assert db.symbol_freshness("AMD") != quiet


def test_source_is_part_of_the_identity(db):
    _insert(db, "SPY", "09/08/2026", source="stocks")
    stocks = db.symbol_freshness("SPY", "stocks")
    _insert(db, "SPY", "09/08/2026", source="indexes")
    assert db.symbol_freshness("SPY", "stocks") == stocks
    assert db.symbol_freshness("SPY", "indexes") != stocks


# ── The half that MAX(id) alone cannot see ───────────────────────────────────

def test_a_PRUNE_invalidates_even_though_MAX_id_did_not_move(db):
    """⛔ THE EXACTNESS ARGUMENT, AS A TEST. `prune_old_trade_days` deletes by
    CreatedDate, so it can remove a MID-RANGE id and move neither MIN nor MAX.
    Keyed on MAX(id) alone, a cached product would go on declaring itself
    current while describing rows that no longer exist."""
    _insert(db, "AMD", "01/02/2020")      # old day -- will be pruned
    _insert(db, "AMD", "09/08/2026")      # newest id, survives
    max_before = db.symbol_max_id("AMD")
    fresh_before = db.symbol_freshness("AMD")

    db.prune_old_trade_days(retain_days=1, dry_run=False, max_days=50)

    # The premise: MAX(id) genuinely did NOT move, so this is the blind spot.
    assert db.symbol_max_id("AMD") == max_before, (
        "the fixture did not reproduce a mid-range delete -- this test proves "
        "nothing about prunes")
    assert db.symbol_freshness("AMD") != fresh_before, (
        "a prune left the freshness identity unchanged: every cached product "
        "now describes rows that are gone")


def test_a_dry_run_prune_does_NOT_bump_the_generation(db):
    _insert(db, "AMD", "01/02/2020")
    _insert(db, "AMD", "09/08/2026")
    before = db.prune_generation()
    db.prune_old_trade_days(retain_days=1, dry_run=True, max_days=50)
    assert db.prune_generation() == before, "a dry run invalidated every product"


def test_a_prune_that_deletes_NOTHING_does_not_bump_either(db):
    """Otherwise the nightly job would invalidate the whole cache every night
    for no reason."""
    _insert(db, "AMD", "09/08/2026")
    before = db.prune_generation()
    db.prune_old_trade_days(retain_days=3650, dry_run=False, max_days=50)
    assert db.prune_generation() == before


def test_the_generation_survives_a_reopen(db, tmp_path):
    """It is durable state, not a process counter -- a restart must not silently
    reset it and re-validate products a prune already invalidated."""
    _insert(db, "AMD", "01/02/2020")
    _insert(db, "AMD", "09/08/2026")
    db.prune_old_trade_days(retain_days=1, dry_run=False, max_days=50)
    gen = db.prune_generation()
    assert gen > 0

    again = FlowDB(str(tmp_path / "flow.db"))
    assert again.prune_generation() == gen


# ── It has to be cheap enough to run on the request path ─────────────────────

def test_the_probe_uses_the_symbol_index_and_no_row_count(db):
    """⛔ COUNT(*) IS THE ENTIRE COST. It forces an O(rows-for-that-symbol) walk
    (MU: 1,136 ms) while MAX(id) is a single seek (0.64 ms, FLAT). A future
    'improvement' that adds a count would put a second of latency on every
    Search during RTH."""
    with db._conn() as conn:
        plan = conn.execute(
            "EXPLAIN QUERY PLAN SELECT MAX(id) FROM flow WHERE Symbol=? AND source=?",
            ("AMD", "stocks")).fetchall()
    text = " ".join(str(r) for r in plan)
    assert "idx_flow_symbol" in text, f"the probe stopped using the index: {text}"
    assert "SCAN" not in text.upper().replace("SCAN TABLE SQLITE", ""), (
        f"the probe degraded to a scan: {text}")
