"""Excursion nightly backfill job — batch orchestrator + status state
(Journal A+ Phase 2, Task 4).

`run_backfill` is driven with an INJECTED `bar_fetch` (synthetic sorted bars) and
an in-memory conn, so these tests never touch the network. Covers: both closed
trades computed + upserted, idempotent existing_refs skip, force recompute, a
per-row compute that RAISES is caught (counted, run continues), closed option
strategies, and get_state() reflecting the last run.

DB fixture mirrors test_excursion_engine.py: `:memory:` + `ensure_schema`.
"""
import sqlite3

from api.services.journal_two import db as j2db
from api.services.journal_two import excursion_jobs
from api.services.journal_two.excursions_store import get_excursion, upsert_excursion


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    j2db.ensure_schema(conn)
    return conn


def _seed_trade(conn, tid, *, user_id="u1", symbol="NVDA", side="Long",
                entry_price=100.0, original_stop=95.0, exit_price=110.0,
                entry_date="2026-01-05T09:30:00+00:00",
                exit_date="2026-01-05T15:00:00+00:00",
                source="manual", external_id=None):
    conn.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, "
        "entry_price, entry_date, exit_price, exit_date, original_stop, "
        "pnl_dollar, pnl_percent, hold_days, result, context_at_entry, created_at, "
        "source, external_id) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (tid, user_id, "p1", symbol, side, 100, entry_price, entry_date, exit_price,
         exit_date, original_stop, 1000.0, 10.0, 0, "Win", "{}",
         "2026-01-05T00:00:00Z", source, external_id),
    )
    conn.commit()


def _seed_option_strategy(conn, sid, *, user_id="u1", underlying="CRWV",
                          status="closed",
                          entry_date="2026-01-05T09:30:00+00:00",
                          closed_at="2026-01-05T15:00:00+00:00"):
    conn.execute(
        "INSERT INTO j2_option_strategies (id, user_id, account_id, underlying, "
        "strategy_type, direction, net_entry, entry_date, context_at_entry, "
        "status, closed_at, created_at, updated_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (sid, user_id, "a1", underlying, "long_call", "bullish", 500.0,
         entry_date, "{}", status, closed_at, "2026-01-05T00:00:00Z",
         "2026-01-05T00:00:00Z"),
    )
    conn.commit()


def _synthetic_fetch(symbol, entry_ts, exit_ts, tf_code):
    """3 in-window bars (favorable high 115, adverse low 96)."""
    mid = (entry_ts + exit_ts) // 2
    return [
        {"t": entry_ts, "h": 105.0, "l": 98.0},
        {"t": mid, "h": 115.0, "l": 104.0},
        {"t": exit_ts, "h": 112.0, "l": 96.0},
    ]


# ── both trades computed + upserted, counts correct ──────────────────────
def test_backfill_computes_both_trades():
    conn = _conn()
    _seed_trade(conn, "t1", symbol="NVDA")
    _seed_trade(conn, "t2", symbol="AMD")

    counts = excursion_jobs.run_backfill(
        user_id="u1", bar_fetch=_synthetic_fetch, conn=conn,
    )

    assert counts["trades_done"] == 2
    assert counts["options_done"] == 0
    assert counts["errors"] == 0
    assert counts["symbols"] == 2
    assert get_excursion("u1", "id:t1", conn) is not None
    assert get_excursion("u1", "id:t2", conn) is not None


# ── idempotent: 2nd run without force skips already-computed refs ─────────
def test_backfill_idempotent_skip():
    conn = _conn()
    _seed_trade(conn, "t1", symbol="NVDA")
    _seed_trade(conn, "t2", symbol="AMD")

    first = excursion_jobs.run_backfill(user_id="u1", bar_fetch=_synthetic_fetch, conn=conn)
    assert first["trades_done"] == 2

    second = excursion_jobs.run_backfill(user_id="u1", bar_fetch=_synthetic_fetch, conn=conn)
    assert second["trades_done"] == 0  # existing_refs skip


# ── force=True recomputes everything ─────────────────────────────────────
def test_backfill_force_recomputes():
    conn = _conn()
    _seed_trade(conn, "t1", symbol="NVDA")

    excursion_jobs.run_backfill(user_id="u1", bar_fetch=_synthetic_fetch, conn=conn)
    forced = excursion_jobs.run_backfill(
        user_id="u1", bar_fetch=_synthetic_fetch, conn=conn, force=True,
    )
    assert forced["trades_done"] == 1


# ── dead excursion residue is pruned by the run ──────────────────────────
def test_backfill_prunes_dead_excursion_rows():
    conn = _conn()
    _seed_trade(conn, "t1", symbol="NVDA")
    # Residue from a retired ref (broker re-slice) — machine data, no
    # attachments → the backfill's hygiene step collects it.
    upsert_excursion("u1", "ext:bk:RETIRED", {"symbol": "OLD"}, conn)

    counts = excursion_jobs.run_backfill(
        user_id="u1", bar_fetch=_synthetic_fetch, conn=conn,
    )
    assert counts["pruned"] == 1
    assert get_excursion("u1", "ext:bk:RETIRED", conn) is None
    assert get_excursion("u1", "id:t1", conn) is not None
    assert excursion_jobs.get_state()["pruned"] == 1


# ── one bad trade (compute raises) is caught; run continues ──────────────
def test_backfill_one_bad_trade_caught():
    conn = _conn()
    _seed_trade(conn, "t1", symbol="NVDA")
    _seed_trade(conn, "t2", symbol="BAD")

    def _fetch_with_one_boom(symbol, entry_ts, exit_ts, tf_code):
        if symbol == "BAD":
            raise RuntimeError("boom on BAD")
        return _synthetic_fetch(symbol, entry_ts, exit_ts, tf_code)

    counts = excursion_jobs.run_backfill(
        user_id="u1", bar_fetch=_fetch_with_one_boom, conn=conn,
    )
    # NVDA computed, BAD raised → counted as an error, not a crash
    assert counts["trades_done"] == 1
    assert counts["errors"] == 1
    assert get_excursion("u1", "id:t1", conn) is not None
    assert get_excursion("u1", "id:t2", conn) is None  # never stored → retriable


# ── closed option strategy → underlying excursion + idempotent ───────────
def test_backfill_closed_option_strategy():
    conn = _conn()
    _seed_option_strategy(conn, "s1", underlying="CRWV")
    _seed_option_strategy(conn, "s2", underlying="AAPL", status="open")  # excluded

    def opt_fetch(symbol, entry_ts, exit_ts, tf_code):
        mid = (entry_ts + exit_ts) // 2
        return [
            {"t": entry_ts, "h": 205.0, "l": 198.0},
            {"t": mid, "h": 260.0, "l": 250.0},
            {"t": exit_ts, "h": 240.0, "l": 190.0},
        ]

    counts = excursion_jobs.run_backfill(user_id="u1", bar_fetch=opt_fetch, conn=conn)
    assert counts["options_done"] == 1
    out = get_excursion("u1", "id:s1", conn)
    assert out is not None
    assert out["dataQuality"] == "underlying"
    assert get_excursion("u1", "id:s2", conn) is None  # open strategy excluded

    # 2nd run → skipped
    again = excursion_jobs.run_backfill(user_id="u1", bar_fetch=opt_fetch, conn=conn)
    assert again["options_done"] == 0


# ── get_state reflects the last run ──────────────────────────────────────
def test_get_state_after_run():
    conn = _conn()
    _seed_trade(conn, "t1", symbol="NVDA")
    excursion_jobs.run_backfill(user_id="u1", bar_fetch=_synthetic_fetch, conn=conn)

    state = excursion_jobs.get_state()
    assert state["tradesDone"] == 1
    assert state["startedAt"] is not None
    assert state["finishedAt"] is not None
    assert state["error"] is None
    # get_state returns a COPY — mutating it must not corrupt module state
    state["tradesDone"] = 999
    assert excursion_jobs.get_state()["tradesDone"] == 1


# ── limit caps the number of computes; skips don't count against it ───────
def test_backfill_limit_caps_computes():
    conn = _conn()
    _seed_trade(conn, "t1", symbol="NVDA")
    _seed_trade(conn, "t2", symbol="AMD")
    _seed_trade(conn, "t3", symbol="TSLA")

    first = excursion_jobs.run_backfill(
        user_id="u1", limit=2, bar_fetch=_synthetic_fetch, conn=conn,
    )
    assert first["trades_done"] == 2
    # exactly 2 of the 3 computed → 1 remains uncomputed (retriable)
    stored = [get_excursion("u1", f"id:{t}", conn) is not None for t in ("t1", "t2", "t3")]
    assert sum(stored) == 2

    # a follow-up run with NO limit computes the remaining one (skips don't count)
    second = excursion_jobs.run_backfill(user_id="u1", bar_fetch=_synthetic_fetch, conn=conn)
    assert second["trades_done"] == 1
    assert all(get_excursion("u1", f"id:{t}", conn) is not None for t in ("t1", "t2", "t3"))


# ── concurrency guard: an overlapping run is refused ─────────────────────
def test_backfill_concurrency_guard():
    # simulate an in-flight run by setting the flag directly, then call again
    excursion_jobs._state["running"] = True
    try:
        out = excursion_jobs.run_backfill(user_id="u1", bar_fetch=_synthetic_fetch)
        assert out == {"skipped": "already running"}
    finally:
        excursion_jobs._state["running"] = False

    # once the flag clears, a normal run proceeds (no conn needed — returns early
    # only when running; here it opens/uses its own path via injected conn)
    conn = _conn()
    _seed_trade(conn, "t1", symbol="NVDA")
    out2 = excursion_jobs.run_backfill(user_id="u1", bar_fetch=_synthetic_fetch, conn=conn)
    assert out2["trades_done"] == 1
    # flag is cleared again in the finally so subsequent runs aren't blocked
    assert excursion_jobs._state["running"] is False


# ── _enabled reads the env fresh ─────────────────────────────────────────
def test_enabled_env(monkeypatch):
    monkeypatch.delenv("EXCURSION_ENGINE_ENABLED", raising=False)
    assert excursion_jobs._enabled() is False
    monkeypatch.setenv("EXCURSION_ENGINE_ENABLED", "1")
    assert excursion_jobs._enabled() is True
    monkeypatch.setenv("EXCURSION_ENGINE_ENABLED", "yes")
    assert excursion_jobs._enabled() is True
    monkeypatch.setenv("EXCURSION_ENGINE_ENABLED", "0")
    assert excursion_jobs._enabled() is False
