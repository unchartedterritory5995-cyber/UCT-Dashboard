"""RS screens unit U1, part C and D(a): the rating post-pass over ``screener_rows``.

``api/services/screener/rs_post_pass.py`` puts every screener row's rating columns on ONE
stored session, stamps which, and gives each liquid stock its exact place in the RS Rating
order (the unrounded score, so the dozens of names sharing a 99 are told apart).

Why each rail exists:
  * a row carried the PREVIOUS session's rating beside today's bars, and a table could mix
    two rating sessions with nothing saying so;
  * the build upserts whole rows (INSERT OR REPLACE), so anything a single nightly pass
    wrote was wiped by the next build: the pass runs at the end of every build;
  * everything is dark behind ``RS_SCREENS_ENABLED``: off, no value, table or receipt.

Hermetic: a ``screener.db`` in ``tmp_path``; the rating history rows are written with
``rs_history.store_rows``; no network, no bars store.
"""
from __future__ import annotations

from contextlib import closing
from datetime import date, timedelta

import pytest

import api.services.screener.snapshot_builder as b
from api.services.screener import rs_history as rh
from api.services.screener import rs_post_pass as pp
from api.services.screener import snapshot_db

S = "2026-11-12"
PREV = "2026-11-11"
RATING_COLS = ("rs_rating_ibd", "rs_rating_chg_5", "rs_rating_chg_20", "rs_rating_1m",
               "rs_rating_3m", "rs_rating_6m", "rs_rating_9m", "rs_rating_12m")
PLACE_COLS = ("rs_rating_pos", "rs_rating_pos_n", "rs_pos_1m", "rs_pos_3m", "rs_pos_6m",
              "rs_pos_12m", "rs_rating_pos_prev20")


@pytest.fixture(autouse=True)
def db(tmp_path, monkeypatch):
    path = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")
    monkeypatch.delenv("RS_RANK_IBD_ENABLED", raising=False)
    snapshot_db.init_db()
    return path


def _row(ticker, **kw):
    """A screener row on the liquid floor unless ``kw`` says otherwise."""
    return {"ticker": ticker, "price": 50.0, "dollar_vol_30d": 50_000_000.0, "is_etf": 0,
            "security_type": "Stock", **kw}


def _hist(ibd, score, *, m12=50, v1=1.0, v3=1.0, v6=1.0, v12=1.0, **kw):
    """One ``rs_rating_history`` row: a full year of history unless ``m12`` is None."""
    return {"ibd": ibd, "m1": 41, "m3": 43, "m6": 46, "m9": 49, "m12": m12, "score": score,
            "bars": 260, "v1": v1, "v3": v3, "v6": v6, "v9": 1.0, "v12": v12, **kw}


def _rows():
    with closing(snapshot_db.connect()) as conn:
        return {r["ticker"]: dict(r) for r in conn.execute("SELECT * FROM screener_rows")}


def _tables():
    with closing(snapshot_db.connect()) as conn:
        return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}


def _history():
    with closing(snapshot_db.connect()) as conn:
        return [tuple(r) for r in conn.execute(
            f"SELECT session, ticker, pos, n FROM {pp.POS_TABLE} ORDER BY session, pos")]


# ───────────────────────── the flag ─────────────────────────

def test_flag_off_the_pass_changes_nothing_and_creates_nothing(monkeypatch):
    snapshot_db.upsert_rows([_row("AAA", rs_rating_ibd=70), _row("BBB")])
    rh.store_rows(S, {"AAA": _hist(99, 1.9), "BBB": _hist(80, 1.4)})
    before_rows, before_tables = _rows(), _tables()
    monkeypatch.setenv("RS_SCREENS_ENABLED", "0")
    r = pp.run(S)
    assert r["enabled"] is False and r["ok"] is False and r["reason"] == "disabled"
    assert _rows() == before_rows
    assert _tables() == before_tables, "a dark pass created a table"
    assert pp.last_run() is None
    monkeypatch.delenv("RS_SCREENS_ENABLED")
    assert pp.enabled() is False, "the default is off"
    monkeypatch.setenv("RS_SCREENS_ENABLED", "true")
    assert pp.enabled() is False, "only the literal 1 arms it"


# ───────────────────────── one session, and which ─────────────────────────

def test_every_row_ends_on_one_rating_session_and_the_stamp_says_which():
    """AAA was built before the rating job (it holds the previous session's numbers), BBB
    after it, CCC has left the rated population. After the pass all three describe S."""
    for k in range(6):                                   # S and five stored sessions before it
        key = (date.fromisoformat(S) - timedelta(days=5 - k)).isoformat()
        rh.store_rows(key, {"AAA": _hist(60 + k, 1.2 + k / 100), "BBB": _hist(90, 1.7)})
    snapshot_db.upsert_rows([
        _row("AAA", rs_rating_ibd=64, rs_rating_chg_5=9, rs_rating_1m=7, rs_rating_12m=7),
        _row("BBB", rs_rating_ibd=90, rs_rating_1m=41),
        _row("CCC", rs_rating_ibd=55, rs_rating_chg_20=-3, rs_rating_6m=12),
    ])
    r = pp.run(S)
    assert r["ok"] and r["rewritten"] and r["session"] == S and r["rating_session"] == S
    assert (r["rows"], r["rated"], r["no_row"]) == (3, 2, 1)
    rows = _rows()
    assert [rows["AAA"][c] for c in RATING_COLS] == [65, 5, None, 41, 43, 46, 49, 50]
    assert [rows["BBB"][c] for c in RATING_COLS] == [90, 0, None, 41, 43, 46, 49, 50]
    assert [rows["CCC"][c] for c in RATING_COLS] == [None] * 8, "another session's rating survived"
    assert rows["AAA"]["rs_rating_session"] == S and rows["BBB"]["rs_rating_session"] == S
    assert rows["CCC"]["rs_rating_session"] is None, "a row with no rating says no session"
    assert {x["rs_rating_session"] for x in rows.values()} - {None} == {S}
    assert rows["AAA"]["rs_rating_score"] == pytest.approx(1.25)
    # nothing but the rating family and the pass's own columns moved
    assert rows["AAA"]["price"] == 50.0 and rows["AAA"]["security_type"] == "Stock"


def test_the_session_defaults_to_the_screeners_settled_session(monkeypatch):
    monkeypatch.setattr(b, "settled_session", lambda now=None: date.fromisoformat(S))
    rh.store_rows(S, {"AAA": _hist(70, 1.3)})
    snapshot_db.upsert_rows([_row("AAA")])
    r = pp.run()
    assert r["session"] == S and r["rewritten"]
    monkeypatch.setattr(b, "settled_session", lambda now=None: None)
    r = pp.run()
    assert r["ok"] is False and r["reason"] == "no_session"


def test_a_session_not_stored_yet_rewrites_nothing_and_stamps_only_what_it_can_verify():
    """03:00 ET: the build has just read the newest stored session (PREV) and the rating
    job for S has not run. AAA holds PREV's numbers and is stamped PREV; OLD holds an
    older session's and gets no stamp; no rating, score or place is written."""
    rh.store_rows(PREV, {"AAA": _hist(70, 1.3), "OLD": _hist(40, 0.9)})
    snapshot_db.upsert_rows([
        _row("AAA", rs_rating_ibd=70, rs_rating_1m=41, rs_rating_3m=43, rs_rating_6m=46,
             rs_rating_9m=49, rs_rating_12m=50),
        _row("OLD", rs_rating_ibd=38, rs_rating_1m=41, rs_rating_3m=43, rs_rating_6m=46,
             rs_rating_9m=49, rs_rating_12m=50, rs_rating_session="2026-11-07"),
        _row("NONE"),
    ])
    before = _rows()
    r = pp.run(S)
    assert r["ok"] and r["rewritten"] is False and r["reason"] == "session_not_stored"
    assert r["session"] == S and r["rating_session"] == PREV
    assert (r["stamped"], r["unstamped"]) == (1, 2)
    after = _rows()
    assert after["AAA"]["rs_rating_session"] == PREV
    assert after["OLD"]["rs_rating_session"] is None, "a stamp the numbers do not match"
    assert after["NONE"]["rs_rating_session"] is None
    for t in before:
        assert {k: v for k, v in after[t].items() if k != "rs_rating_session"} == \
               {k: v for k, v in before[t].items() if k != "rs_rating_session"}, t
    assert pp.POS_TABLE not in _tables()


def test_an_empty_table_is_a_named_reason_not_an_error():
    rh.store_rows(S, {"AAA": _hist(70, 1.3)})
    r = pp.run(S)
    assert r["ok"] is False and r["reason"] == "no_rows" and "error" not in r


# ───────────────────────── the exact places ─────────────────────────

def test_places_run_1_to_n_on_the_floor_with_no_ties_and_are_null_off_it():
    hist = {
        "TOP": _hist(99, 1.90), "MID": _hist(99, 1.85), "LOW": _hist(72, 1.10),
        "FUND": _hist(99, 2.50),                          # an ETF: rated, never ranked
        "CHEAP": _hist(99, 2.40), "THIN": _hist(99, 2.30),
        "YOUNG": _hist(99, 2.20, m12=None),               # under a year of history
        "NOSCORE": _hist(None, None),
    }
    rh.store_rows(S, hist)
    snapshot_db.upsert_rows([
        _row("TOP"), _row("MID"), _row("LOW"),
        _row("FUND", is_etf=1, security_type="ETF"),
        _row("CHEAP", price=9.99), _row("THIN", dollar_vol_30d=19_999_999.0),
        _row("YOUNG"), _row("NOSCORE"), _row("UNRATED"),
        _row("NOPRICE", price=None), _row("NOVOL", dollar_vol_30d=None),
    ])
    rh.store_rows(S, {"NOPRICE": _hist(99, 2.1), "NOVOL": _hist(99, 2.0)}, replace=False)
    r = pp.run(S)
    rows = _rows()
    assert {t: rows[t]["rs_rating_pos"] for t in ("TOP", "MID", "LOW")} == {"TOP": 1, "MID": 2, "LOW": 3}
    on = [t for t in rows if rows[t]["rs_rating_pos"] is not None]
    assert sorted(rows[t]["rs_rating_pos"] for t in on) == [1, 2, 3], "dense, no ties"
    assert {rows[t]["rs_rating_pos_n"] for t in on} == {3} and r["ranked"] == 3
    for t in ("FUND", "CHEAP", "THIN", "YOUNG", "NOSCORE", "UNRATED", "NOPRICE", "NOVOL"):
        assert [rows[t][c] for c in PLACE_COLS] == [None] * len(PLACE_COLS), t
    # off the floor is not unrated: the rating and the score still land
    assert rows["CHEAP"]["rs_rating_ibd"] == 99 and rows["CHEAP"]["rs_rating_score"] == 2.40
    assert rows["FUND"]["rs_rating_session"] == S


def test_the_floor_is_10_dollars_and_20_million_and_lives_in_one_place():
    assert pp.LIQUID_FLOOR == {"price_min": 10.0, "dollar_vol_30d_min": 20_000_000.0,
                               "exclude_etfs": True, "full_year_column": "rs_rating_12m"}
    ok = {"price": 10.0, "dollar_vol_30d": 20_000_000.0, "is_etf": 0, "rs_rating_12m": 1}
    assert pp.on_liquid_floor(ok), "the floor is inclusive"
    assert pp.on_liquid_floor({**ok, "is_etf": None}), "an unknown type is not an ETF"
    for worse in ({"price": 9.99}, {"dollar_vol_30d": 19_999_999.99}, {"is_etf": 1},
                  {"rs_rating_12m": None}, {"price": None}, {"dollar_vol_30d": None}):
        assert not pp.on_liquid_floor({**ok, **worse}), worse


def test_ties_break_by_the_3_month_value_then_dollar_volume_then_ticker():
    """Five names share one score. The 3-month value splits the first from the rest, a
    missing one sorts last; dollar volume splits the next; the ticker settles the last two."""
    rh.store_rows(S, {
        "ZED": _hist(99, 1.5, v3=1.40),
        "BIG": _hist(99, 1.5, v3=1.20), "ABC": _hist(99, 1.5, v3=1.20), "ABD": _hist(99, 1.5, v3=1.20),
        "NOV3": _hist(99, 1.5, v3=None),
        "LEAD": _hist(99, 1.6, v3=0.5),                   # a higher score beats every tie rule
    })
    snapshot_db.upsert_rows([
        _row("ZED", dollar_vol_30d=21e6), _row("BIG", dollar_vol_30d=90e6),
        _row("ABD", dollar_vol_30d=30e6), _row("ABC", dollar_vol_30d=30e6),
        _row("NOV3", dollar_vol_30d=500e6), _row("LEAD"),
    ])
    pp.run(S)
    rows = _rows()
    order = sorted(rows, key=lambda t: rows[t]["rs_rating_pos"])
    assert order == ["LEAD", "ZED", "BIG", "ABC", "ABD", "NOV3"]
    assert [rows[t]["rs_rating_pos"] for t in order] == [1, 2, 3, 4, 5, 6]


def test_each_period_has_its_own_places_on_the_same_floor():
    """Each period is ordered by its own stored value; a name without that value has no
    place for that period and keeps its others; an off-floor name has none at all."""
    rh.store_rows(S, {
        "AAA": _hist(90, 1.5, v1=5.0, v3=1.1, v6=1.3, v12=1.9),
        "BBB": _hist(80, 1.4, v1=9.0, v3=1.3, v6=1.1, v12=1.5),
        "CCC": _hist(70, 1.3, v1=7.0, v3=1.2, v6=None, v12=1.7),
        "OFF": _hist(99, 1.9, v1=99.0, v3=9.0, v6=9.0, v12=9.0),
    })
    snapshot_db.upsert_rows([_row("AAA"), _row("BBB"), _row("CCC"), _row("OFF", price=5.0)])
    pp.run(S)
    rows = _rows()
    got = {t: tuple(rows[t][c] for c in ("rs_pos_1m", "rs_pos_3m", "rs_pos_6m", "rs_pos_12m"))
           for t in rows}
    assert got == {"AAA": (3, 3, 1, 1), "BBB": (1, 1, 2, 3), "CCC": (2, 2, None, 2),
                   "OFF": (None, None, None, None)}
    assert rows["CCC"]["rs_rating_pos"] == 3, "the overall place does not need the 6-month value"


def test_a_session_stored_before_the_values_existed_has_an_overall_place_only():
    rh.store_rows(S, {"AAA": _hist(90, 1.5, v1=None, v3=None, v6=None, v12=None),
                      "BBB": _hist(80, 1.4, v1=None, v3=None, v6=None, v12=None)})
    snapshot_db.upsert_rows([_row("AAA"), _row("BBB")])
    pp.run(S)
    rows = _rows()
    assert (rows["AAA"]["rs_rating_pos"], rows["BBB"]["rs_rating_pos"]) == (1, 2)
    assert all(rows[t][c] is None for t in rows for c in ("rs_pos_1m", "rs_pos_3m", "rs_pos_6m", "rs_pos_12m"))


# ───────────────────────── the history and "a month ago" ─────────────────────────

def _sessions(n):
    return [(date(2026, 9, 1) + timedelta(days=i)).isoformat() for i in range(n)]


def test_prev20_is_null_until_20_earlier_sessions_exist_then_reads_that_place():
    snapshot_db.upsert_rows([_row("AAA"), _row("BBB"), _row("CCC")])
    keys = _sessions(22)
    for i, key in enumerate(keys):
        # session 0: AAA, BBB, CCC. Session 1: CCC, BBB, AAA. Later: BBB, AAA, CCC.
        scores = ({"AAA": 1.9, "BBB": 1.5, "CCC": 1.1} if i == 0 else
                  {"AAA": 1.1, "BBB": 1.5, "CCC": 1.9} if i == 1 else
                  {"AAA": 1.5, "BBB": 1.9, "CCC": 1.1})
        rh.store_rows(key, {t: _hist(50, s) for t, s in scores.items()})
        r = pp.run(key)
        rows = _rows()
        if i < 20:
            assert r["prev20_session"] is None
            assert all(rows[t]["rs_rating_pos_prev20"] is None for t in rows), (i, key)
    assert r["prev20_session"] == keys[1]                # the 22nd session reads the 2nd
    assert {t: rows[t]["rs_rating_pos_prev20"] for t in rows} == {"AAA": 3, "BBB": 2, "CCC": 1}
    pp.run(keys[20])                                     # and the 21st reads the 1st
    rows = _rows()
    assert {t: rows[t]["rs_rating_pos_prev20"] for t in rows} == {"AAA": 1, "BBB": 2, "CCC": 3}


def test_a_name_off_the_floor_then_or_now_has_no_earlier_place():
    snapshot_db.upsert_rows([_row("AAA"), _row("NEW", price=5.0), _row("LEFT")])
    keys = _sessions(21)
    for i, key in enumerate(keys):
        rh.store_rows(key, {"AAA": _hist(50, 1.5), "NEW": _hist(60, 1.6), "LEFT": _hist(40, 1.2)})
        if i == 20:                                      # NEW reaches $10 today, LEFT falls under it
            snapshot_db.upsert_rows([_row("AAA"), _row("NEW"), _row("LEFT", price=5.0)])
        pp.run(key)
    rows = _rows()
    assert rows["NEW"]["rs_rating_pos"] == 1 and rows["NEW"]["rs_rating_pos_prev20"] is None
    assert rows["AAA"]["rs_rating_pos"] == 2 and rows["AAA"]["rs_rating_pos_prev20"] == 1
    assert _history()[:2] == [(keys[0], "AAA", 1, 2), (keys[0], "LEFT", 2, 2)]
    assert rows["LEFT"]["rs_rating_pos"] is None and rows["LEFT"]["rs_rating_pos_prev20"] is None,         "a row off the floor carries no place, old or new"


def test_two_passes_for_one_session_leave_the_same_table_and_one_history_row_a_ticker():
    rh.store_rows(S, {"AAA": _hist(90, 1.5), "BBB": _hist(80, 1.4), "CCC": _hist(70, 1.3)})
    snapshot_db.upsert_rows([_row("AAA"), _row("BBB"), _row("CCC")])
    pp.run(S)
    first_rows, first_hist = _rows(), _history()
    pp.run(S)
    assert _rows() == first_rows
    assert _history() == first_hist == [(S, "AAA", 1, 3), (S, "BBB", 2, 3), (S, "CCC", 3, 3)]
    # a name that leaves the floor leaves the stored session too: no stale row, n follows
    snapshot_db.upsert_rows([_row("BBB", price=4.0)])
    pp.run(S)
    assert _history() == [(S, "AAA", 1, 2), (S, "CCC", 2, 2)]


def test_an_empty_ranking_never_replaces_a_stored_one():
    rh.store_rows(S, {"AAA": _hist(90, 1.5)})
    snapshot_db.upsert_rows([_row("AAA")])
    pp.run(S)
    snapshot_db.upsert_rows([_row("AAA", price=None)])   # a broken build: no liquid row at all
    r = pp.run(S)
    assert r["ranked"] == 0 and _history() == [(S, "AAA", 1, 1)]


def test_the_place_history_keeps_400_sessions(monkeypatch):
    assert pp.POS_KEEP_SESSIONS == 400 and pp.PREV_SESSIONS == 20
    monkeypatch.setattr(pp, "POS_KEEP_SESSIONS", 3)
    snapshot_db.upsert_rows([_row("AAA")])
    keys = _sessions(5)
    for key in keys:
        rh.store_rows(key, {"AAA": _hist(50, 1.5)})
        pp.run(key)
    assert [h[0] for h in _history()] == keys[-3:]


# ───────────────────────── rs_rank, the receipt ─────────────────────────

def test_rs_rank_follows_the_same_read_only_while_one_rating_everywhere_is_on(monkeypatch):
    rh.store_rows(S, {"AAA": _hist(91, 1.5), "SHORT": _hist(None, None, m12=None)})
    seed = [_row("AAA", rs_rank=40), _row("SHORT", rs_rank=33), _row("NONE", rs_rank=22)]
    snapshot_db.upsert_rows(seed)
    r = pp.run(S)
    assert r["rs_rank"] == "untouched"
    assert {t: x["rs_rank"] for t, x in _rows().items()} == {"AAA": 40, "SHORT": 33, "NONE": 22}
    monkeypatch.setenv("RS_RANK_IBD_ENABLED", "1")
    r = pp.run(S)
    rows = _rows()
    assert r["rs_rank"] == "ibd"
    assert rows["AAA"]["rs_rank"] == rows["AAA"]["rs_rating_ibd"] == 91
    assert rows["SHORT"]["rs_rank"] == 33 and rows["NONE"]["rs_rank"] == 22, \
        "an unrated row keeps the hourly rank the build wrote"


def test_the_receipt_is_stored_and_served_on_the_snapshot_status():
    rh.store_rows(S, {"AAA": _hist(90, 1.5)})
    snapshot_db.upsert_rows([_row("AAA"), _row("BBB")])
    r = pp.run(S, source="test")
    assert r["populated"] == {"rs_rating_session": 1, "rs_rating_score": 1, "rs_rating_pos": 1,
                              "rs_rating_pos_n": 1, "rs_pos_1m": 1, "rs_pos_3m": 1, "rs_pos_6m": 1,
                              "rs_pos_12m": 1, "rs_rating_pos_prev20": 0}
    assert set(r["populated"]) == set(pp.OWNED_COLUMNS) == set(snapshot_db.POST_PASS_COLUMNS)
    last = pp.last_run()
    assert last["session"] == S and last["source"] == "test" and last["ranked"] == 1
    assert snapshot_db.status()["rs_post_pass"] == last


def test_a_failure_is_a_receipt_never_an_exception(monkeypatch):
    snapshot_db.upsert_rows([_row("AAA")])

    def boom(*a, **k):
        raise RuntimeError("history unreadable")
    monkeypatch.setattr(rh, "read_fields", boom)
    r = pp.run(S)
    assert r["ok"] is False and r["error"].startswith("RuntimeError: history unreadable")


# ───────────────────────── the build's end hook ─────────────────────────

def _liquid_bars(n=60):
    return [{"t": 20260100 + i, "o": 50.0, "h": 50.5, "l": 49.5, "c": 50.0, "v": 1_000_000}
            for i in range(n)]


def _build(monkeypatch, tickers=("AAA", "BBB", "CCC")):
    from tests.test_screener_rs_history_columns import _seed, _stub_build
    keys = _seed()                                       # AAA rated on 21 sessions, BBB on the newest
    newest = date.fromisoformat(keys[-1])
    monkeypatch.setattr(b, "settled_session", lambda now=None: newest)
    monkeypatch.setattr(rh, "settled_session", lambda now=None: newest)
    _stub_build(monkeypatch, list(tickers))
    monkeypatch.setattr(b, "_read_daily_bars", lambda t: _liquid_bars())
    return keys[-1]


def test_every_build_ends_with_the_pass_so_a_later_build_does_not_lose_the_columns(monkeypatch):
    newest = _build(monkeypatch)
    for n in (1, 2):                                     # the second build REPLACES every row
        stats = b.run_build()
        assert stats["built"] == 3 and stats["errors"] == 0
        rows = _rows()
        assert rows["AAA"]["rs_rating_session"] == newest, f"build {n} lost the stamp"
        assert rows["AAA"]["rs_rating_score"] == pytest.approx(1.1)
        assert (rows["AAA"]["rs_rating_pos"], rows["AAA"]["rs_rating_pos_n"]) == (1, 1), f"build {n}"
        assert rows["BBB"]["rs_rating_pos"] is None, "no 12-month rank, no place"
        assert rows["AAA"]["rs_rating_ibd"] == 70 and rows["AAA"]["rs_rating_chg_20"] == 20
        receipt = stats["rs_post_pass"]
        assert receipt["source"] == "build" and receipt["rewritten"] and receipt["ranked"] == 1
        assert stats["populated"]["rs_rating_pos"] == 1 and stats["populated"]["rs_rating_session"] == 2
        assert not (set(pp.OWNED_COLUMNS) & set(stats["empty_columns"]))


def test_flag_off_a_build_runs_no_pass_and_reports_as_it_did(monkeypatch):
    monkeypatch.setenv("RS_SCREENS_ENABLED", "0")
    _build(monkeypatch)
    stats = b.run_build()
    assert stats["built"] == 3 and "rs_post_pass" not in stats
    rows = _rows()
    assert all(rows[t][c] is None for t in rows for c in pp.OWNED_COLUMNS)
    assert pp.POS_TABLE not in _tables() and pp.RUNS_TABLE not in _tables()
    assert not (set(pp.OWNED_COLUMNS) & set(stats["empty_columns"])), \
        "the pass's columns are judged by the pass's receipt, never named as a build gap"
    assert all(stats["populated"][c] == 0 for c in pp.OWNED_COLUMNS)
    assert rows["AAA"]["rs_rating_ibd"] == 70, "the build's own rating read is untouched"


def test_a_pass_that_fails_never_fails_the_build(monkeypatch):
    _build(monkeypatch)

    def boom(*a, **k):
        raise RuntimeError("pass exploded")
    monkeypatch.setattr(pp, "run", boom)
    stats = b.run_build()
    assert stats["built"] == 3
    assert stats["rs_post_pass"] == {"error": "RuntimeError: pass exploded"}


# ───────────────────────── the schema ─────────────────────────

def test_the_nine_columns_are_declared_with_their_types():
    kinds = {"rs_rating_session": "TEXT", "rs_rating_score": "REAL"}
    for c in pp.OWNED_COLUMNS:
        assert snapshot_db.COLUMNS.count(c) == 1, c
        assert snapshot_db._coldef(c) == f"{c} {kinds.get(c, 'INTEGER')}", c
    assert len(pp.OWNED_COLUMNS) == 9
    assert not (snapshot_db.POST_PASS_COLUMNS & snapshot_db.LIVE_ONLY_COLUMNS)
