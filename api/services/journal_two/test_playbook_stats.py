"""P3 Milestone B, Task B1 — all-setups Playbook aggregate.

`get_playbook_stats` produces one record per setup present in the (scoped)
closed-equity trade set, adding profit factor + expectancy + exit-efficiency to
the per-setup output that `setup_stats.get_setup_stats` (one setup) and
`analytics._attribution_section.bySetup` (all setups, no PF/exp/exit) stop short
of. Scope-aware via a FilterSpec `spec` kwarg; blank-setup trades EXCLUDED (v1).

Equity-only (no option expirations) → dodges test_options.py's time-brittle
past-expiration fixtures.
"""
from __future__ import annotations

import importlib
import os
import sqlite3
import tempfile
import uuid
from datetime import datetime, timezone

import pytest


@pytest.fixture
def db_conn(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()
    os.unlink(tmp.name)


def _seed_account(db_conn, user_id="u_pb"):
    from api.services.journal_two import accounts as accounts_service
    return accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)


def _insert_trade(
    conn, *, user_id, account_id,
    setup="VCP", symbol="NVDA", side="Long",
    result="Win", pnl=100, r=1.5, exit_iso=None,
    mistake_tags=None, emotion_tags=None,
):
    """Insert one closed equity trade; returns the row id (== trade_ref suffix
    `id:<row id>` for a manual/non-broker row)."""
    tid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    exit_iso = exit_iso or now
    conn.execute(
        """
        INSERT INTO j2_trades (
            id, user_id, position_id, symbol, side, shares,
            entry_price, entry_date, exit_price, exit_date,
            original_stop, setup, notes, pnl_dollar, pnl_percent,
            r_multiple, hold_days, result, context_at_entry,
            account_id, created_at, trading_day_et, hour_et,
            mistake_tags, emotion_tags
        ) VALUES (?, ?, 'manual', ?, ?, 100, 500, ?, 510, ?,
                  490, ?, NULL, ?, 0.02, ?, 1, ?, '{}', ?, ?, NULL, NULL, ?, ?)
        """,
        (
            tid, user_id, symbol, side, exit_iso, exit_iso,
            setup, pnl, r, result, account_id, now,
            mistake_tags, emotion_tags,
        ),
    )
    conn.commit()
    return tid


def _by_setup(rows):
    return {r["setup"]: r for r in rows}


# ── Empty ────────────────────────────────────────────────────────────────────


def test_no_trades_returns_empty_list(db_conn):
    from api.services.journal_two import playbook_stats
    acc = _seed_account(db_conn)
    out = playbook_stats.get_playbook_stats("u_pb", acc["id"], conn=db_conn)
    assert out == []


# ── PF / expectancy / win-rate / avg-R per setup ─────────────────────────────


def test_two_setups_pf_expectancy_winrate(db_conn):
    from api.services.journal_two import playbook_stats
    acc = _seed_account(db_conn)
    # VCP: 2 wins (+300,+100), 1 loss (-100) → PF 400/100=4.0, WR 2/3,
    #      expectancy $100, avgR (2+1-1)/3, totalR 2.0
    _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="VCP", result="Win", pnl=300, r=2.0)
    _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="VCP", result="Win", pnl=100, r=1.0)
    _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="VCP", result="Loss", pnl=-100, r=-1.0)
    # EP: 1 win (+200), 1 loss (-100) → PF 200/100=2.0, WR 1/2,
    #     expectancy $50, avgR (1.5-1.0)/2=0.25, totalR 0.5
    _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="EP", result="Win", pnl=200, r=1.5)
    _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="EP", result="Loss", pnl=-100, r=-1.0)

    out = _by_setup(playbook_stats.get_playbook_stats("u_pb", acc["id"], conn=db_conn))
    assert set(out.keys()) == {"VCP", "EP"}

    vcp = out["VCP"]
    assert vcp["tradeCount"] == 3
    assert vcp["winCount"] == 2
    assert vcp["lossCount"] == 1
    assert abs(vcp["winRate"] - (2 / 3)) < 1e-9
    assert vcp["profitFactor"] == 4.0
    assert vcp["expectancy"] == 100.0            # mean pnl_dollar over the 3 trades
    assert abs(vcp["avgR"] - (2.0 / 3)) < 1e-4   # mean R (rounded 4dp) over 3 non-null R
    assert abs(vcp["expectancyR"] - (2.0 / 3)) < 1e-4
    assert abs(vcp["totalR"] - 2.0) < 1e-9

    ep = out["EP"]
    assert ep["tradeCount"] == 2
    assert ep["profitFactor"] == 2.0
    assert ep["expectancy"] == 50.0
    assert abs(ep["winRate"] - 0.5) < 1e-9
    assert abs(ep["avgR"] - 0.25) < 1e-9


def test_profit_factor_none_when_no_losses(db_conn):
    from api.services.journal_two import playbook_stats
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="VCP", result="Win", pnl=200, r=1.0)
    _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="VCP", result="Win", pnl=100, r=1.0)
    out = _by_setup(playbook_stats.get_playbook_stats("u_pb", acc["id"], conn=db_conn))
    assert out["VCP"]["profitFactor"] is None   # no losing denominator
    assert out["VCP"]["expectancy"] == 150.0


# ── Blank-setup exclusion (v1 documented choice) ─────────────────────────────


def test_blank_setup_trades_excluded(db_conn):
    from api.services.journal_two import playbook_stats
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="VCP", result="Win", pnl=100, r=1.0)
    _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup=None, result="Win", pnl=100, r=1.0)
    _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="", result="Loss", pnl=-50, r=-1.0)
    out = playbook_stats.get_playbook_stats("u_pb", acc["id"], conn=db_conn)
    assert {r["setup"] for r in out} == {"VCP"}


# ── Exit efficiency (excursion join, coverage counts) ────────────────────────


def test_exit_efficiency_null_without_excursions(db_conn):
    from api.services.journal_two import playbook_stats
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="VCP", result="Win", pnl=100, r=1.0)
    _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="VCP", result="Loss", pnl=-50, r=-1.0)
    out = _by_setup(playbook_stats.get_playbook_stats("u_pb", acc["id"], conn=db_conn))
    vcp = out["VCP"]
    assert vcp["exitEfficiency"] is None
    assert vcp["exitEffCoverage"] == {"eligible": 2, "computed": 0}


def test_exit_efficiency_value_with_excursion(db_conn):
    from api.services.journal_two import playbook_stats
    from api.services.journal_two.excursions_store import upsert_excursion
    acc = _seed_account(db_conn)
    t1 = _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="VCP", result="Win", pnl=100, r=1.0)
    _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="VCP", result="Loss", pnl=-50, r=-1.0)
    # A REAL excursion (non-insufficient/underlying) keyed on the manual trade's
    # stable ref `id:<row id>`.
    upsert_excursion(
        "u_pb", f"id:{t1}",
        {"symbol": "NVDA", "exit_efficiency": 0.7, "missed_r": 0.5,
         "data_quality": "intraday_5m"},
        db_conn,
    )
    out = _by_setup(playbook_stats.get_playbook_stats("u_pb", acc["id"], conn=db_conn))
    vcp = out["VCP"]
    assert vcp["exitEfficiency"] == 0.7          # mean over the one computed efficiency
    assert vcp["exitEffCoverage"] == {"eligible": 2, "computed": 1}


def test_insufficient_excursion_not_counted_as_computed(db_conn):
    """Mirror P2: an 'insufficient'/'underlying' excursion is NOT a real equity
    excursion → excluded from both the mean and the computed count."""
    from api.services.journal_two import playbook_stats
    from api.services.journal_two.excursions_store import upsert_excursion
    acc = _seed_account(db_conn)
    t1 = _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="VCP", result="Win", pnl=100, r=1.0)
    upsert_excursion(
        "u_pb", f"id:{t1}",
        {"symbol": "NVDA", "exit_efficiency": None, "data_quality": "insufficient"},
        db_conn,
    )
    out = _by_setup(playbook_stats.get_playbook_stats("u_pb", acc["id"], conn=db_conn))
    vcp = out["VCP"]
    assert vcp["exitEfficiency"] is None
    assert vcp["exitEffCoverage"] == {"eligible": 1, "computed": 0}


# ── Rule adherence (adherence join, coverage, adhered-vs-not split) — P5-A5 ──


def test_adherence_null_without_records(db_conn):
    """A setup with zero adherence records → adherence None + computed 0, and an
    honest null-null split (no fabricated buckets)."""
    from api.services.journal_two import playbook_stats
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="VCP", result="Win", pnl=100, r=1.0)
    _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="VCP", result="Loss", pnl=-50, r=-1.0)
    out = _by_setup(playbook_stats.get_playbook_stats("u_pb", acc["id"], conn=db_conn))
    vcp = out["VCP"]
    assert vcp["adherence"] is None
    assert vcp["adherenceCoverage"] == {"eligible": 2, "computed": 0}
    assert vcp["adherenceVsExpectancy"] == {
        "adhered": {"expectancy": None, "n": 0},
        "notAdhered": {"expectancy": None, "n": 0},
    }


def test_adherence_mean_and_coverage(db_conn):
    """adherence = mean adherencePct over trades WITH a record; eligible ==
    tradeCount (matches exitEffCoverage.eligible), computed == #records."""
    from api.services.journal_two import playbook_stats
    from api.services.journal_two.adherence_store import upsert_adherence
    acc = _seed_account(db_conn)
    t1 = _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="VCP", result="Win", pnl=100, r=1.0)
    t2 = _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="VCP", result="Win", pnl=200, r=2.0)
    # A third trade with NO adherence record → counts toward eligible, not computed.
    _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="VCP", result="Loss", pnl=-50, r=-1.0)
    upsert_adherence("u_pb", f"id:{t1}", "VCP", ["a", "b", "c", "d"], 4, db_conn)  # 1.0
    upsert_adherence("u_pb", f"id:{t2}", "VCP", ["a", "b"], 4, db_conn)            # 0.5
    out = _by_setup(playbook_stats.get_playbook_stats("u_pb", acc["id"], conn=db_conn))
    vcp = out["VCP"]
    assert vcp["adherence"] == 0.75  # mean(1.0, 0.5) — fraction 0..1, matches winRate unit
    assert vcp["adherenceCoverage"] == {"eligible": 3, "computed": 2}


def test_adherence_vs_expectancy_split(db_conn):
    """2 high-adherence winners vs 1 low-adherence loser → adhered expectancy >
    notAdhered, correct n's; expectancy in the record's dollars unit."""
    from api.services.journal_two import playbook_stats
    from api.services.journal_two.adherence_store import upsert_adherence
    acc = _seed_account(db_conn)
    t1 = _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="VCP", result="Win", pnl=300, r=2.0)
    t2 = _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="VCP", result="Win", pnl=100, r=1.0)
    t3 = _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="VCP", result="Loss", pnl=-200, r=-2.0)
    upsert_adherence("u_pb", f"id:{t1}", "VCP", ["a", "b", "c", "d"], 4, db_conn)  # 1.0  → adhered
    upsert_adherence("u_pb", f"id:{t2}", "VCP", ["a", "b", "c", "d"], 4, db_conn)  # 1.0  → adhered
    upsert_adherence("u_pb", f"id:{t3}", "VCP", ["a"], 4, db_conn)                 # 0.25 → broke rules
    out = _by_setup(playbook_stats.get_playbook_stats("u_pb", acc["id"], conn=db_conn))
    vcp = out["VCP"]
    ave = vcp["adherenceVsExpectancy"]
    assert ave["adhered"] == {"expectancy": 200.0, "n": 2}       # mean(300, 100)
    assert ave["notAdhered"] == {"expectancy": -200.0, "n": 1}   # mean(-200)
    assert ave["adhered"]["expectancy"] > ave["notAdhered"]["expectancy"]
    assert vcp["adherence"] == 0.75  # mean(1.0, 1.0, 0.25)
    assert vcp["adherenceCoverage"] == {"eligible": 3, "computed": 3}


def test_adherence_bucket_boundary_and_empty_bucket(db_conn):
    """0.8 is the inclusive adhered boundary; a bucket with no trades →
    {expectancy: None, n: 0}, never a fake split."""
    from api.services.journal_two import playbook_stats
    from api.services.journal_two.adherence_store import upsert_adherence
    acc = _seed_account(db_conn)
    t1 = _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="VCP", result="Win", pnl=100, r=1.0)
    upsert_adherence("u_pb", f"id:{t1}", "VCP", ["a", "b", "c", "d"], 5, db_conn)  # 0.8 exactly → adhered
    out = _by_setup(playbook_stats.get_playbook_stats("u_pb", acc["id"], conn=db_conn))
    vcp = out["VCP"]
    ave = vcp["adherenceVsExpectancy"]
    assert ave["adhered"] == {"expectancy": 100.0, "n": 1}
    assert ave["notAdhered"] == {"expectancy": None, "n": 0}


# ── Scope (FilterSpec) narrowing ─────────────────────────────────────────────


def test_scope_symbol_narrows(db_conn):
    from api.services.journal_two import playbook_stats
    from api.services.journal_two.filters import FilterSpec
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="VCP", symbol="NVDA", pnl=100, r=1.0)
    _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="VCP", symbol="NVDA", pnl=50, r=0.5)
    _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="VCP", symbol="AMD", pnl=25, r=0.25)
    out = _by_setup(playbook_stats.get_playbook_stats(
        "u_pb", acc["id"], spec=FilterSpec(symbol="nvda"), conn=db_conn,
    ))
    assert out["VCP"]["tradeCount"] == 2
    assert out["VCP"]["expectancy"] == 75.0


def test_scope_setups_narrows(db_conn):
    from api.services.journal_two import playbook_stats
    from api.services.journal_two.filters import FilterSpec
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="VCP", symbol="NVDA", pnl=100, r=1.0)
    _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="EP", symbol="TSLA", pnl=50, r=0.5)
    out = playbook_stats.get_playbook_stats(
        "u_pb", acc["id"], spec=FilterSpec(setups=["VCP"]), conn=db_conn,
    )
    assert {r["setup"] for r in out} == {"VCP"}


def test_scope_and_account_isolation(db_conn):
    from api.services.journal_two import playbook_stats
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="VCP", pnl=100, r=1.0)
    _insert_trade(db_conn, user_id="u_other", account_id=acc["id"], setup="EP", pnl=100, r=1.0)
    out = playbook_stats.get_playbook_stats("u_pb", acc["id"], conn=db_conn)
    assert {r["setup"] for r in out} == {"VCP"}


# ── lastFive ─────────────────────────────────────────────────────────────────


def test_last_five_chronological(db_conn):
    from api.services.journal_two import playbook_stats
    acc = _seed_account(db_conn)
    seq = [
        ("Win", 1.0, "2026-01-01T00:00:00+00:00"),
        ("Loss", -1.0, "2026-01-02T00:00:00+00:00"),
        ("Win", 1.0, "2026-01-03T00:00:00+00:00"),
        ("Loss", -1.0, "2026-01-04T00:00:00+00:00"),
        ("BE", 0.0, "2026-01-05T00:00:00+00:00"),
        ("Win", 1.0, "2026-01-06T00:00:00+00:00"),
        ("Loss", -1.0, "2026-01-07T00:00:00+00:00"),
    ]
    for result, r, iso in seq:
        _insert_trade(db_conn, user_id="u_pb", account_id=acc["id"], setup="VCP",
                      result=result, pnl=100 * r, r=r, exit_iso=iso)
    out = _by_setup(playbook_stats.get_playbook_stats("u_pb", acc["id"], conn=db_conn))
    assert out["VCP"]["lastFive"] == ["W", "L", "B", "W", "L"]
