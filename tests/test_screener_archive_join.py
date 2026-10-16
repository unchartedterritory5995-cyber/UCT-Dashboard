"""Screener archive join -- display-only trader-archive context as snapshot columns.

SYNTHETIC data only (the repo is public).

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. the source answering while WISDOM_ARCHIVE_ENABLED is off (must be {}: never a guessed 0);
2. a dead or empty store answering anything but {} (and being COUNTED, not silent);
3. a healthy store failing to answer for the whole target list (an uncalled name is a REAL 0);
4. the newest call losing to an older one, or the trader count double-counting a trader;
5. the setup edge being keyed on anything but the best detection's mapped setup, or appearing
   for an unmapped detector (never a guessed setup);
6. a raw win rate standing in for the control-relative edge;
7. a price level reaching the row (display context carries no entry/stop/target).
"""
from __future__ import annotations

import json

import pytest

from api.services.screener import archive_join
from api.services.wisdom.core import store

NOW = "2026-10-16T00:00:00+00:00"


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")
    store.init_db()


def _call(cid, ticker, author, setup, posted, r20, entry=10.0, stop=9.0):
    with store.write() as conn:
        conn.execute(
            "INSERT INTO wisdom_archive_calls (call_id, record_id, author_id, ticker, direction, setup, "
            "action, posted, entry, stop, outcome_json, sha, imported_at) "
            "VALUES (?, ?, ?, ?, 'long', ?, 'entry', ?, ?, ?, ?, 'aaaaaaaaaaaaaaaa', ?)",
            (cid, cid.split("#")[0], author, ticker, setup, posted, entry, stop,
             json.dumps({"r20": r20, "status": "scored"} if r20 is not None else {}), NOW))


def _setup(sid, mean_edge_r, med_edge20, n_scored, win20=0.9):
    stats = {"all": {"n": n_scored + 5, "n_scored": n_scored, "win20": win20,
                     "mean_edgeR": mean_edge_r, "med_edge20": med_edge20}}
    with store.write() as conn:
        conn.execute(
            "INSERT INTO wisdom_archive_setups (setup_id, name, stats_json, sha, imported_at) "
            "VALUES (?, ?, ?, 'bbbbbbbbbbbbbbbb', ?)", (sid, sid, json.dumps(stats), NOW))


def _seed():
    _call("t1#0", "ZZTA", "tsdr", "kicker", "2025-01-02", 0.05)
    _call("t2#0", "ZZTA", "tsdr", "oops", "2025-03-04", 0.12)       # newest, same trader
    _call("t3#0", "ZZTA", "bracco", "kicker", "2024-06-01", -0.03)
    _call("t4#0", "ZZTB", "manrav", "flag_htf", "2025-02-02", None)  # immature: no r20
    _setup("flag_htf", 0.31, 0.024, 120)
    _setup("kicker", -0.05, -0.01, 140)


# ── 1. the flag ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw", ["0", "", "false"])
def test_flag_off_answers_nothing(wisdom_db, monkeypatch, raw):
    _seed()
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", raw)
    failures: dict = {}
    assert archive_join.read_archive_fields(["ZZTA", "ZZTB"], failures=failures) == {}
    assert failures == {}                     # off is a decision, not a failure


# ── 2. dead / empty ──────────────────────────────────────────────────────────

def test_an_empty_store_is_counted_and_answers_nothing(wisdom_db):
    failures: dict = {}
    assert archive_join.read_archive_fields(["ZZTA"], failures=failures) == {}
    assert failures == {"archive_join": {"empty": 1}}


def test_a_dead_store_is_counted_and_answers_nothing(wisdom_db, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("store gone")

    monkeypatch.setattr(store, "read", boom)
    failures: dict = {}
    assert archive_join.read_archive_fields(["ZZTA"], failures=failures) == {}
    assert failures == {"archive_join": {"RuntimeError": 1}}


# ── 3-4. per-ticker context ──────────────────────────────────────────────────

def test_a_healthy_store_answers_every_target(wisdom_db):
    _seed()
    out = archive_join.read_archive_fields(["zzta", "ZZTB", "NOPE"])
    assert set(out) == {"ZZTA", "ZZTB", "NOPE"}
    a = out["ZZTA"]
    assert a["archive_calls_n"] == 3 and a["archive_traders_n"] == 2       # tsdr counted once
    assert a["archive_last_call_date"] == "2025-03-04" and a["archive_last_setup"] == "oops"
    assert a["archive_last_r20"] == 12.0
    assert out["ZZTB"]["archive_last_r20"] is None                           # immature stays None
    assert out["NOPE"] == {"archive_calls_n": 0, "archive_traders_n": 0}     # a REAL zero


# ── 5-6. the setup edge ──────────────────────────────────────────────────────

def test_the_edge_follows_the_best_detections_mapped_setup(wisdom_db):
    _seed()
    out = archive_join.read_archive_fields(
        ["ZZTA", "ZZTB", "ZZTC"],
        best_ids={"ZZTA": "bull_flag", "ZZTB": "uct_kicker", "ZZTC": "not_a_detector"})
    assert out["ZZTA"]["archive_setup"] == "flag_htf"
    assert out["ZZTA"]["archive_setup_edge_r"] == 0.31
    assert out["ZZTA"]["archive_setup_edge_20d"] == 2.4
    assert out["ZZTA"]["archive_setup_n"] == 120
    assert out["ZZTB"]["archive_setup"] == "kicker" and out["ZZTB"]["archive_setup_edge_r"] == -0.05
    assert "archive_setup" not in out["ZZTC"]                                # unmapped: absent
    # control: the edge is NOT the ticker's own last setup (ZZTA's newest call is an oops)
    assert out["ZZTA"]["archive_setup"] != out["ZZTA"]["archive_last_setup"]


def test_a_raw_win_rate_never_stands_in_for_the_edge(wisdom_db):
    _seed()
    out = archive_join.read_archive_fields(["ZZTA"], best_ids={"ZZTA": "bull_flag"})["ZZTA"]
    assert not any("win" in k for k in out)
    assert out["archive_setup_edge_r"] != 0.9                                # the seeded win20


# ── 7. no price levels ───────────────────────────────────────────────────────

def test_no_price_level_reaches_the_row(wisdom_db):
    _seed()
    out = archive_join.read_archive_fields(["ZZTA"], best_ids={"ZZTA": "bull_flag"})["ZZTA"]
    assert not any(w in k for k in out for w in ("entry", "stop", "target", "price", "px"))
    assert set(out) <= set(archive_join_columns())


def archive_join_columns():
    from api.services.screener import snapshot_db

    return [c for c in snapshot_db.COLUMNS if c.startswith("archive_")]


def test_every_emitted_key_is_a_declared_column(wisdom_db):
    _seed()
    out = archive_join.read_archive_fields(["ZZTA", "NOPE"], best_ids={"ZZTA": "bull_flag"})
    emitted = set().union(*(set(r) for r in out.values()))
    assert emitted == set(archive_join_columns())                            # and all of them, once


# ── the "Names the team has called" starter ──────────────────────────────────

def test_the_team_starter_is_hidden_while_the_archive_is_off(monkeypatch):
    from api.services.screener import saved_screens

    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "0")
    assert "starter_team_called" not in {s["id"] for s in saved_screens.starters()}


def test_the_team_starter_is_a_valid_executable_spec_while_on(monkeypatch):
    """The same checks test_screener_saved / test_screener_builder run over every
    starter, applied with the gate ON (those suites run with it off, so they
    would never see this one)."""
    from api.services.screener import filters, saved_screens, snapshot_db

    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")
    s = next(x for x in saved_screens.starters() if x["id"] == "starter_team_called")
    spec = s["spec"]
    assert spec["view"] in filters.VIEWS
    assert spec["sort"]["key"] in filters.FILTERS and spec["sort"]["key"] in snapshot_db.COLUMNS
    for f in spec["filters"]:
        assert f["key"] in filters.FILTERS and filters.is_valid_op(f["key"], f["op"])
        for operand in filters.OP_OPERANDS[f["op"]]:
            assert operand in f
    assert saved_screens.STOCKS_ONLY["key"] in {f["key"] for f in spec["filters"]}  # stocks-only applied
    # the view shows every archive column, so the starter lands somewhere that explains itself
    assert set(archive_join_columns()) <= set(filters.VIEWS["team"]["columns"])


def test_a_setup_with_no_scored_calls_publishes_no_edge(wisdom_db):
    """An edge resting on zero scored calls is not a measurement: the columns stay absent."""
    _seed()
    _setup("vcp", 0.5, 0.03, 0)
    out = archive_join.read_archive_fields(["ZZTA"], best_ids={"ZZTA": "vcp"})["ZZTA"]
    assert not any(k.startswith("archive_setup") for k in out)
