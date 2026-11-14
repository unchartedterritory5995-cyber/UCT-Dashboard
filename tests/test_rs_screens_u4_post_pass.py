"""RS screens unit U4, part B: three changes to the rating post-pass (``rs_post_pass``).

1. NO BLANK WINDOW. Between the 03:00 ET build and the 04:15 ET rating job the settled
   session is not stored, and the pass used to leave every place NULL: a screen that
   filters on a place (Top RS Rating) would have been empty for 75 minutes every night,
   and all day when the rating job failed. The places are now computed from the ratings
   the rows already carry (the newest stored session) and that session is stamped.
   A row is still never stamped with a session its numbers are not from.
2. SHORTER BOARDS INCLUDE YOUNG STOCKS. The overall place needs a full year of history;
   a 1, 3, 6 or 12-month place needs only liquidity and that window's own value.
3. ``rs_rating_prev20``: the RS Rating 20 stored sessions earlier, from the same history
   read that gives ``rs_rating_chg_20``; NULL when unknown.

Hermetic, as ``tests/test_rs_screens_u1_post_pass.py`` is (its row and history builders
are reused): a ``screener.db`` in ``tmp_path``, history written with ``rs_history.store_rows``.
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest

import api.services.screener.snapshot_builder as b
from api.services.screener import identities
from api.services.screener import rs_history as rh
from api.services.screener import rs_post_pass as pp
from api.services.screener import snapshot_db
from tests.test_rs_screens_u1_post_pass import (PLACE_COLS, PREV, RATING_COLS, S, _hist,
                                                _history, _row, _rows, _sessions, _tables)

PERIOD_COLS = ("rs_pos_1m", "rs_pos_3m", "rs_pos_6m", "rs_pos_12m")
#: The rating columns of a row the 03:00 build wrote from a `_hist()` history row.
CARRIED = {"rs_rating_1m": 41, "rs_rating_3m": 43, "rs_rating_6m": 46, "rs_rating_9m": 49,
           "rs_rating_12m": 50}


@pytest.fixture(autouse=True)
def db(tmp_path, monkeypatch):
    path = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")
    monkeypatch.delenv("RS_RANK_IBD_ENABLED", raising=False)
    snapshot_db.init_db()
    return path


# ───────────────────────── 1. no blank window ─────────────────────────

def _before_the_rating_job():
    """03:00 ET: PREV is the newest stored session and the build has just written its
    numbers onto AAA and BBB. OLD holds an older session's rating; NONE has none."""
    rh.store_rows(PREV, {"AAA": _hist(70, 1.3, v1=1.0, v3=2.0, v6=1.0, v12=1.0),
                         "BBB": _hist(90, 1.7, v1=2.0, v3=1.0, v6=2.0, v12=2.0),
                         "OLD": _hist(40, 0.9)})
    snapshot_db.upsert_rows([
        _row("AAA", rs_rating_ibd=70, **CARRIED),
        _row("BBB", rs_rating_ibd=90, **CARRIED),
        _row("OLD", rs_rating_ibd=38, **CARRIED, rs_rating_session="2026-11-07",
             rs_rating_pos=7, rs_rating_score=9.9),
        _row("NONE"),
    ])


def test_before_the_rating_job_the_places_come_from_the_ratings_the_rows_carry():
    _before_the_rating_job()
    before = _rows()
    r = pp.run(S)
    assert r["ok"] and r["rewritten"] is False and r["reason"] == "session_not_stored"
    assert r["session"] == S and r["rating_session"] == PREV
    assert (r["stamped"], r["unstamped"], r["ranked"]) == (2, 2, 2)
    rows = _rows()
    assert {t: rows[t]["rs_rating_session"] for t in rows} == \
        {"AAA": PREV, "BBB": PREV, "OLD": None, "NONE": None}
    assert (rows["BBB"]["rs_rating_pos"], rows["AAA"]["rs_rating_pos"]) == (1, 2)
    assert rows["AAA"]["rs_rating_pos_n"] == rows["BBB"]["rs_rating_pos_n"] == 2
    assert (rows["AAA"]["rs_rating_score"], rows["BBB"]["rs_rating_score"]) == (1.3, 1.7)
    assert [rows["AAA"][c] for c in PERIOD_COLS] == [2, 1, 2, 2]
    assert [rows["BBB"][c] for c in PERIOD_COLS] == [1, 2, 1, 1]
    # no rating column moved on any row: the pass rewrites ratings only onto a stored session
    for t in before:
        assert {c: rows[t][c] for c in RATING_COLS} == {c: before[t][c] for c in RATING_COLS}, t
        assert rows[t]["price"] == before[t]["price"]
    assert r["populated"]["rs_rating_pos"] == 2 and r["populated"]["rs_rating_session"] == 2


def test_a_row_is_never_stamped_or_placed_with_a_session_its_numbers_are_not_from():
    """OLD's rating is not PREV's (38 against a stored 40): no stamp, no score, no place,
    and what an earlier pass left on it is cleared rather than kept beside the wrong date."""
    _before_the_rating_job()
    pp.run(S)
    old = _rows()["OLD"]
    assert old["rs_rating_session"] is None and old["rs_rating_score"] is None
    assert [old[c] for c in PLACE_COLS] == [None] * len(PLACE_COLS)
    assert old["rs_rating_ibd"] == 38, "its own rating is left exactly as the build wrote it"
    none = _rows()["NONE"]
    assert none["rs_rating_session"] is None and none["rs_rating_pos"] is None


def test_the_carried_places_write_no_history_and_replace_none():
    """The stored places for a session are the record the rating job's pass made. A pass
    before the next rating job recomputes places on today's floor and must not rewrite it."""
    rh.store_rows(PREV, {"AAA": _hist(70, 1.3), "BBB": _hist(90, 1.7), "CCC": _hist(80, 1.5)})
    snapshot_db.upsert_rows([_row(t, rs_rating_ibd=i, **CARRIED)
                             for t, i in (("AAA", 70), ("BBB", 90), ("CCC", 80))])
    pp.run(PREV)                                         # the rating job's pass: stored
    stored = _history()
    assert stored == [(PREV, "BBB", 1, 3), (PREV, "CCC", 2, 3), (PREV, "AAA", 3, 3)]
    # the next build: BBB has fallen under $10; the rows still carry PREV's ratings
    snapshot_db.upsert_rows([_row("AAA", rs_rating_ibd=70, **CARRIED),
                             _row("BBB", rs_rating_ibd=90, price=9.0, **CARRIED),
                             _row("CCC", rs_rating_ibd=80, **CARRIED)])
    r = pp.run(S)
    rows = _rows()
    assert r["reason"] == "session_not_stored" and r["ranked"] == 2
    assert {t: rows[t]["rs_rating_pos"] for t in rows} == {"AAA": 2, "BBB": None, "CCC": 1}
    assert rows["BBB"]["rs_rating_session"] == PREV, "off the floor is still a dated rating"
    assert _history() == stored, "a carried ranking rewrote the stored one"


def test_no_history_table_is_created_by_a_pass_before_the_first_rating_run():
    _before_the_rating_job()
    pp.run(S)
    assert pp.POS_TABLE not in _tables()
    assert all(v["rs_rating_pos_prev20"] is None for v in _rows().values())


def test_once_the_session_is_stored_the_pass_moves_every_row_onto_it():
    _before_the_rating_job()
    pp.run(S)
    rh.store_rows(S, {"AAA": _hist(95, 1.9), "BBB": _hist(60, 1.1), "OLD": _hist(41, 0.9)})
    r = pp.run(S)
    rows = _rows()
    assert r["rewritten"] and r["rating_session"] == S and r["reason"] is None
    assert {t: rows[t]["rs_rating_session"] for t in ("AAA", "BBB", "OLD")} == dict.fromkeys(("AAA", "BBB", "OLD"), S)
    assert [rows[t]["rs_rating_pos"] for t in ("AAA", "BBB", "OLD")] == [1, 2, 3]
    assert rows["AAA"]["rs_rating_ibd"] == 95


def test_a_month_ago_is_counted_back_from_the_session_the_places_are_from():
    """21 sessions stored and ranked; the 22nd build runs before its rating job. The carried
    places are the 21st session's, so "a month ago" is 20 stored sessions before THAT."""
    snapshot_db.upsert_rows([_row("AAA"), _row("BBB")])
    keys = _sessions(22)
    for i, key in enumerate(keys[:21]):
        scores = {"AAA": 1.9, "BBB": 1.5} if i == 0 else {"AAA": 1.5, "BBB": 1.9}
        rh.store_rows(key, {t: _hist(50, s) for t, s in scores.items()})
        pp.run(key)
    rows = _rows()
    assert (rows["AAA"]["rs_rating_pos"], rows["AAA"]["rs_rating_pos_prev20"]) == (2, 1)
    r = pp.run(keys[21])                                 # not stored yet
    rows = _rows()
    assert r["reason"] == "session_not_stored" and r["rating_session"] == keys[20]
    assert r["prev20_session"] == keys[0]
    assert {t: (rows[t]["rs_rating_pos"], rows[t]["rs_rating_pos_prev20"]) for t in rows} == \
        {"AAA": (2, 1), "BBB": (1, 2)}


def test_the_03_00_build_itself_ends_with_places_not_blanks(monkeypatch):
    """End to end: a build over a session the rating job has not scored yet. Before this
    unit every place was NULL until 04:15 ET."""
    from tests.test_screener_rs_history_columns import _seed, _stub_build
    from tests.test_rs_screens_u1_post_pass import _liquid_bars
    keys = _seed()                                       # 21 sessions, 2026-01-01 .. 01-21
    settled = date.fromisoformat(keys[-1]) + timedelta(days=1)
    monkeypatch.setattr(b, "settled_session", lambda now=None: settled)
    monkeypatch.setattr(rh, "settled_session", lambda now=None: settled)
    _stub_build(monkeypatch, ["AAA", "BBB", "CCC"])
    monkeypatch.setattr(b, "_read_daily_bars", lambda t: _liquid_bars())
    stats = b.run_build()
    receipt = stats["rs_post_pass"]
    assert receipt["reason"] == "session_not_stored" and receipt["rewritten"] is False
    assert receipt["session"] == settled.isoformat() and receipt["rating_session"] == keys[-1]
    rows = _rows()
    assert rows["AAA"]["rs_rating_session"] == keys[-1]
    assert (rows["AAA"]["rs_rating_pos"], rows["AAA"]["rs_rating_pos_n"]) == (1, 1)
    assert rows["AAA"]["rs_rating_score"] == pytest.approx(1.1)
    assert rows["AAA"]["rs_rating_prev20"] == 50 and rows["AAA"]["rs_rating_chg_20"] == 20
    assert rows["CCC"]["rs_rating_session"] is None and rows["CCC"]["rs_rating_pos"] is None
    assert stats["populated"]["rs_rating_pos"] == 1


# ───────────────────────── 2. shorter boards include young stocks ─────────────────────────

def test_a_young_stock_has_period_places_and_no_overall_place():
    """YOUNG has under a year of history (no 12-month rank, no 12-month value): it is on
    the 1, 3 and 6-month boards, where its values rank, and on neither full-year board."""
    rh.store_rows(S, {
        "AAA": _hist(90, 1.5, v1=5.0, v3=1.1, v6=1.3, v12=1.9),
        "BBB": _hist(80, 1.4, v1=9.0, v3=1.3, v6=1.1, v12=1.5),
        "YOUNG": _hist(None, None, m12=None, v1=7.0, v3=9.9, v6=1.2, v12=None),
        "YTHIN": _hist(None, None, m12=None, v1=99.0, v3=99.0, v6=99.0, v12=None),
    })
    snapshot_db.upsert_rows([_row("AAA"), _row("BBB"), _row("YOUNG"),
                             _row("YTHIN", dollar_vol_30d=1_000_000.0)])
    r = pp.run(S)
    rows = _rows()
    got = {t: tuple(rows[t][c] for c in PERIOD_COLS) for t in rows}
    assert got == {"AAA": (3, 3, 1, 1), "BBB": (1, 2, 3, 2), "YOUNG": (2, 1, 2, None),
                   "YTHIN": (None, None, None, None)}
    assert (rows["YOUNG"]["rs_rating_pos"], rows["YOUNG"]["rs_rating_pos_n"]) == (None, None)
    assert rows["YOUNG"]["rs_rating_pos_prev20"] is None
    assert (rows["AAA"]["rs_rating_pos"], rows["BBB"]["rs_rating_pos"]) == (1, 2)
    assert rows["AAA"]["rs_rating_pos_n"] == 2 == r["ranked"], "the overall list does not grow"
    assert rows["AAA"]["rs_pos_1m"] == 3 > rows["AAA"]["rs_rating_pos_n"], \
        "a period board can be longer than the overall one"


def test_a_young_stock_is_on_the_period_boards_before_the_rating_job_too():
    """The same rule in the carried pass: YOUNG's row holds the newest stored session's
    numbers (no rating, no 12-month rank), so it is stamped and ranked on the 1-month
    board, ahead of AAA there, with no overall place."""
    rh.store_rows(PREV, {"AAA": _hist(70, 1.3, v1=1.0),
                         "YOUNG": _hist(None, None, m12=None, v1=5.0, v12=None)})
    young = {k: v for k, v in CARRIED.items() if k != "rs_rating_12m"}
    snapshot_db.upsert_rows([_row("AAA", rs_rating_ibd=70, **CARRIED), _row("YOUNG", **young)])
    r = pp.run(S)
    rows = _rows()
    assert r["reason"] == "session_not_stored" and r["stamped"] == 2 and r["ranked"] == 1
    assert (rows["YOUNG"]["rs_pos_1m"], rows["AAA"]["rs_pos_1m"]) == (1, 2)
    assert rows["YOUNG"]["rs_rating_pos"] is None and rows["YOUNG"]["rs_pos_12m"] is None
    assert rows["YOUNG"]["rs_rating_session"] == PREV


def test_the_floor_reads_liquidity_alone_when_asked():
    ok = {"price": 10.0, "dollar_vol_30d": 20_000_000.0, "is_etf": 0, "rs_rating_12m": None}
    assert pp.on_liquid_floor(ok, full_year=False)
    assert not pp.on_liquid_floor(ok), "the default is still the full-year floor"
    assert pp.on_liquid_floor({**ok, "rs_rating_12m": 1})
    for worse in ({"price": 9.99}, {"dollar_vol_30d": 19_999_999.99}, {"is_etf": 1},
                  {"price": None}, {"dollar_vol_30d": None}):
        assert not pp.on_liquid_floor({**ok, **worse}, full_year=False), worse


def test_no_identity_says_a_period_place_fits_inside_the_overall_count():
    """It was true while every board shared one population. A young stock on a 1-month
    board makes that board longer than the overall one, so the rule would blank real rows."""
    names = {i.name for i in identities.build_identities()}
    assert "rs_rating_pos_n_ge_rs_rating_pos" in names
    assert not {n for n in names if n.startswith("rs_rating_pos_n_ge_rs_pos_")}
    assert identities.proof_violations(
        {"rs_rating_pos_n": 2, "rs_rating_pos": 1, "rs_pos_1m": 3}) == []


# ───────────────────────── 3. the rating a month ago ─────────────────────────

def test_rs_rating_prev20_is_the_rating_20_stored_sessions_earlier():
    snapshot_db.upsert_rows([_row("AAA"), _row("BBB"), _row("NEW")])
    keys = _sessions(21)
    for i, key in enumerate(keys):
        hist = {"AAA": _hist(50 + i, 1.5), "BBB": _hist(90 - 2 * i, 1.2)}
        if i >= 15:
            hist["NEW"] = _hist(80, 1.4)                 # rated on the newest six sessions only
        rh.store_rows(key, hist)
        r = pp.run(key)
        if i < 20:
            assert all(v["rs_rating_prev20"] is None for v in _rows().values()), (i, key)
    rows = _rows()
    assert (rows["AAA"]["rs_rating_ibd"], rows["AAA"]["rs_rating_prev20"]) == (70, 50)
    assert (rows["BBB"]["rs_rating_ibd"], rows["BBB"]["rs_rating_prev20"]) == (50, 90)
    for t in ("AAA", "BBB"):
        assert rows[t]["rs_rating_prev20"] == rows[t]["rs_rating_ibd"] - rows[t]["rs_rating_chg_20"]
    assert rows["NEW"]["rs_rating_prev20"] is None, "no rating that day, no guess"
    assert r["populated"]["rs_rating_prev20"] == 2


def test_rs_rating_prev20_is_carried_too_and_blank_on_an_unverified_row():
    keys = _sessions(21)
    for i, key in enumerate(keys):
        rh.store_rows(key, {"AAA": _hist(50 + i, 1.5), "OLD": _hist(30, 0.8)})
    snapshot_db.upsert_rows([
        _row("AAA", rs_rating_ibd=70, rs_rating_chg_5=5, rs_rating_chg_20=20, **CARRIED),
        _row("OLD", rs_rating_ibd=31, rs_rating_chg_5=0, rs_rating_chg_20=0, **CARRIED,
             rs_rating_prev20=31),
    ])
    r = pp.run("2026-12-01")                             # nothing stored for it
    rows = _rows()
    assert r["reason"] == "session_not_stored" and r["rating_session"] == keys[-1]
    assert rows["AAA"]["rs_rating_prev20"] == 50
    assert rows["OLD"]["rs_rating_prev20"] is None, "an unverified row keeps no earlier rating"


def test_the_pass_owns_ten_columns_and_the_new_one_is_an_integer():
    assert "rs_rating_prev20" in pp.OWNED_COLUMNS and len(pp.OWNED_COLUMNS) == 10
    assert set(pp.OWNED_COLUMNS) == set(snapshot_db.POST_PASS_COLUMNS)
    assert snapshot_db._coldef("rs_rating_prev20") == "rs_rating_prev20 INTEGER"
    assert snapshot_db.COLUMNS.count("rs_rating_prev20") == 1
