"""RS screens unit U9, part 3: the shadow Leader score in the rating post-pass.

After the exact places, and only while ``RS_LEADER_SHADOW_ENABLED`` is on,
``rs_post_pass.run`` hands over to ``rs_leader_shadow.run``: the score and its four
parts go to the side table ``rs_leader_shadow`` and one row per stock on the RS liquid
floor per rating session goes to ``rs_leader_score_history``, with whether the stock
passed the UCT RS Leaders gate.

Why each rail exists:
  * the stored score must be the pre-registered one (the hand-worked 62.28125 of
    ``tests/test_rs_screens_u9_score.py``, end to end through the database);
  * ``qualifies`` must mean what the screen means, so it is compared with the scan the
    starter runs, row for row, never with a second copy of the rule;
  * a score must never mix two builds or two sessions, and the record for a session
    must be the same however often the pass runs;
  * the post-pass receipt is served to members: nothing about the score may be in it.

Hermetic: a ``screener.db`` in ``tmp_path``; rating rows through ``rs_history.store_rows``.
"""
from __future__ import annotations

import json
from contextlib import closing

import pytest

from api.services.screener import query, rs_leader_shadow as sh, rs_screens, saved_screens
from api.services.screener import rs_history as rh
from api.services.screener import rs_post_pass as pp
from api.services.screener import snapshot_db

S = "2026-11-12"
PREV = "2026-11-11"
ASOF = "20261112"
SHADOW_WORDS = ("shadow", "leader_score", "rs_ls_", "steady", "rs_line_below")


@pytest.fixture(autouse=True)
def db(tmp_path, monkeypatch):
    path = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")
    monkeypatch.setenv("RS_LEADER_SHADOW_ENABLED", "1")
    monkeypatch.delenv("RS_RANK_IBD_ENABLED", raising=False)
    monkeypatch.setattr(query, "stale_gate", lambda conn: None)
    snapshot_db.init_db()
    sh._LAST.clear()
    return path


def _row(ticker, industry, sector, **kw):
    """A screener row on the liquid floor that passes the UCT RS Leaders gate, unless
    ``kw`` says otherwise."""
    return {"ticker": ticker, "price": 50.0, "dollar_vol_30d": 50_000_000.0, "is_etf": 0,
            "security_type": "Stock", "industry": industry, "sector": sector,
            "chg_pct_1m": 0.0, "px_below_high_pct": 0.0, "bars_asof": ASOF,
            "adr_pct": 4.0, "market_cap": 5e9, "rs_rank": 90, "pct_vs_sma200": 12.0,
            "sma200_rising": 1, "dist_52w_high_pct": -3.0, "rs_line_above_ma": 1, **kw}


def _hist(score, ibd=90):
    return {"ibd": ibd, "m1": 41, "m3": 43, "m6": 46, "m9": 49, "m12": 50, "score": score,
            "bars": 260, "v1": 1.0, "v3": 1.0, "v6": 1.0, "v9": 1.0, "v12": 1.0}


def universe(**overrides):
    """The 16 stocks of the score test's hand-worked case: two industries of 8, each its
    own sector, rating scores 1 to 16 (B1..B8 then A1..A8)."""
    rows = [_row(f"A{i}", "a", "A") for i in range(1, 9)] + [_row(f"B{i}", "b", "B") for i in range(1, 9)]
    for r in rows:
        r.update(overrides.get(r["ticker"], {}))
    return rows


def scores():
    out = {f"A{i}": _hist(8.0 + i) for i in range(1, 9)}
    out.update({f"B{i}": _hist(float(i)) for i in range(1, 9)})
    return out


def seed(rows=None, *, session=S, inputs=None, history=True):
    rows = universe() if rows is None else rows
    snapshot_db.upsert_rows(rows)
    if history:
        rh.store_rows(session, scores())
    side = {r["ticker"]: {"rs_steady": 0.3, "rs_line_below_high_pct": 0.0, "bars_asof": r["bars_asof"]}
            for r in rows}
    side.update(inputs or {})
    sh.write_inputs(side)


def _side():
    with closing(snapshot_db.connect()) as conn:
        return {r["ticker"]: dict(r) for r in conn.execute(f"SELECT * FROM {sh.TABLE}")}


def _history(session=None):
    with closing(snapshot_db.connect()) as conn:
        if conn.execute("SELECT 1 FROM sqlite_master WHERE name = ?", (sh.HISTORY_TABLE,)).fetchone() is None:
            return {}
        sql = f"SELECT * FROM {sh.HISTORY_TABLE}" + (" WHERE session = ?" if session else "")
        return {(r["session"], r["ticker"]): dict(r)
                for r in conn.execute(sql, (session,) if session else ())}


def _tables():
    with closing(snapshot_db.connect()) as conn:
        return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}


# ───────────────────────── the stored score ─────────────────────────

def test_the_pass_stores_the_hand_worked_score_and_its_parts():
    """A1, 5% under its price high and 10% under its RS-line high: Strength 53.125,
    Steady 50, High 70, Group 96.875, score 62.28125 (worked in the score test)."""
    seed(universe(A1={"px_below_high_pct": -5.0}),
         inputs={"A1": {"rs_steady": 0.3, "rs_line_below_high_pct": -10.0, "bars_asof": ASOF}})
    r = pp.run(S)
    assert r["ok"] and r["rewritten"]
    a1 = _side()["A1"]
    assert a1["rs_ls_strength"] == pytest.approx(53.125)
    assert a1["rs_ls_steady"] == pytest.approx(50.0)
    assert a1["rs_ls_high"] == pytest.approx(70.0)
    assert a1["rs_ls_group"] == pytest.approx(96.875)
    assert a1["rs_leader_score"] == pytest.approx(62.28125, abs=1e-4)
    assert a1["score_session"] == S and a1["bars_asof"] == int(ASOF)
    assert a1["rs_steady"] == 0.3 and a1["rs_line_below_high_pct"] == -10.0, "the inputs stay"
    h = _history(S)[(S, "A1")]
    assert (h["score"], h["strength"], h["steady"], h["high"], h["group_part"]) == (
        a1["rs_leader_score"], a1["rs_ls_strength"], a1["rs_ls_steady"], a1["rs_ls_high"],
        a1["rs_ls_group"])
    assert len(_history(S)) == 16 and len(_side()) == 16
    last = sh.last_run()
    assert (last["rows"], last["floor"], last["scored"], last["history_rows"]) == (16, 16, 16, 16)


def test_nothing_is_a_screener_rows_column_and_no_receipt_names_it():
    seed()
    receipt = pp.run(S)
    with closing(snapshot_db.connect()) as conn:
        columns = {r[1] for r in conn.execute("PRAGMA table_info(screener_rows)")}
        row = dict(conn.execute("SELECT * FROM screener_rows WHERE ticker = 'A1'").fetchone())
    from api.services.screener import filters
    assert not (set(filters.RS_SHADOW_KEYS) & columns)
    assert not (set(filters.RS_SHADOW_KEYS) & set(row))
    for said in (json.dumps(receipt, default=str), json.dumps(pp.last_run(), default=str),
                 json.dumps(snapshot_db.status(), default=str)):
        for word in SHADOW_WORDS:
            assert word not in said.lower(), word
    assert _side()["A1"]["rs_leader_score"] is not None, "and yet it was computed"


# ───────────────────────── qualifies: the screen's own gate ─────────────────────────

FAILS = {
    "A2": {"rs_rank": 79},                          # RS Rating under 80
    "A3": {"adr_pct": 2.99},                        # daily range under 3%
    "A4": {"market_cap": 299_000_000.0},            # under $300M
    "A5": {"pct_vs_sma200": 0.0},                   # not above the 200-day
    "A6": {"sma200_rising": 0},                     # the 200-day is not rising
    "A7": {"dist_52w_high_pct": -25.01},            # over 25% under its high
    "A8": {"rs_line_above_ma": 0},                  # RS line under its average
    "B1": {"rs_flag": "buyout_pending"},            # pinned at a deal price
    "B2": {"security_type": "ETF"},                 # a fund by type
    "B3": {"rs_rank": None},                        # no rating at all
}


def test_qualifies_is_each_clause_of_the_starters_gate():
    seed(universe(**FAILS, B4={"rs_flag": "new_issue"}, B5={"rs_rank": 80, "adr_pct": 3.0,
                                                            "market_cap": 300_000_000.0,
                                                            "dist_52w_high_pct": -25.0}))
    pp.run(S)
    got = {t for (_s, t), h in _history(S).items() if h["qualifies"] == 1}
    assert got == {"A1", "B4", "B5", "B6", "B7", "B8"}
    assert all(h["qualifies"] in (0, 1) for h in _history(S).values())
    # row for row what the screen itself would list (its filters, without the top-50 cap)
    spec = {"filters": sh.leaders_gate(), "page_size": 200, "sort": {"key": "ticker", "dir": "asc"}}
    assert {r["ticker"] for r in query.run_scan(spec)["rows"]} == got


def test_the_gate_is_read_from_the_starter_never_retyped(monkeypatch):
    gate = sh.leaders_gate()
    served = next(s for s in saved_screens._starter_defs() + [saved_screens._stocks_only(rs_screens.leaders())]
                  if s["id"] == "starter_rs_leaders")["spec"]["filters"]
    assert gate == served
    assert {"key": "security_type", "op": "not_in", "values": ["ETF"]} in gate
    assert {"key": "rs_rank", "op": "gte", "min": 80} in gate
    # a change to the screen changes `qualifies` with it
    monkeypatch.setattr(rs_screens, "LEADERS_MIN_RATING", 95)
    seed(universe(A1={"rs_rank": 96}))
    pp.run(S)
    assert {t for (_s, t), h in _history(S).items() if h["qualifies"]} == {"A1"}


# ───────────────────────── one session, however often ─────────────────────────

def test_a_second_pass_leaves_the_same_record_and_a_stock_off_the_floor_leaves_it():
    seed()
    pp.run(S)
    first = _history(S)
    pp.run(S)
    assert _history(S) == first and len(first) == 16
    # B8 stops trading enough: off the floor, so out of the session's record on the next pass
    with closing(snapshot_db.connect()) as conn:
        conn.execute("UPDATE screener_rows SET dollar_vol_30d = 1000 WHERE ticker = 'B8'")
        conn.commit()
    pp.run(S)
    after = _history(S)
    assert len(after) == 15 and (S, "B8") not in after
    side = _side()["B8"]
    assert side["rs_leader_score"] is None and side["score_session"] is None
    # ... and everyone else was re-ranked against a floor of 15 (A8: 100 x 14.5 / 15),
    # stored to four places in the row and in the record alike
    assert _side()["A8"]["rs_ls_strength"] == 96.6667
    assert after[(S, "A8")]["strength"] == 96.6667


def test_only_the_pass_that_moved_the_ratings_records_the_session():
    """03:00 ET: the settled session is not stored yet, so the pass carries the previous
    session's ratings. The rows are scored (no blank window) and nothing is recorded:
    the stored record is the rating job's pass, as for the exact places."""
    rows = universe()
    for r in rows:                                   # the build read PREV's ratings
        h = scores()[r["ticker"]]
        r.update(rs_rating_ibd=h["ibd"], rs_rating_1m=41, rs_rating_3m=43, rs_rating_6m=46,
                 rs_rating_9m=49, rs_rating_12m=50)
    seed(rows, session=PREV)
    r = pp.run(S)
    assert r["ok"] and not r["rewritten"] and r["reason"] == "session_not_stored"
    side = _side()
    assert side["A1"]["rs_leader_score"] is not None and side["A1"]["score_session"] == PREV
    assert _history() == {} and sh.last_run()["history"] is False
    # the rating job stores S and its pass runs: now the session is recorded
    rh.store_rows(S, scores())
    pp.run(S)
    assert {s for s, _t in _history()} == {S} and _side()["A1"]["score_session"] == S


def test_the_history_keeps_its_newest_sessions(monkeypatch):
    monkeypatch.setattr(sh, "HISTORY_KEEP_SESSIONS", 3)
    seed(history=False)
    days = ["2026-11-06", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"]
    for d in days:
        rh.store_rows(d, scores())
        pp.run(d)
    assert sorted({s for s, _t in _history()}) == days[-3:]
    assert sh.HISTORY_KEEP_SESSIONS == 3 and len(_history()) == 3 * 16


def test_the_keep_constant_is_1300_sessions(monkeypatch):
    import importlib
    assert importlib.reload(sh).HISTORY_KEEP_SESSIONS == 1300


def test_an_empty_floor_never_replaces_a_stored_session():
    seed()
    pp.run(S)
    with closing(snapshot_db.connect()) as conn:
        conn.execute("UPDATE screener_rows SET price = 1.0")
        conn.commit()
    pp.run(S)
    assert len(_history(S)) == 16, "a table with no liquid row wiped the session's record"
    assert all(v["rs_leader_score"] is None for v in _side().values())


# ───────────────────────── blanks, never guesses ─────────────────────────

def test_inputs_from_another_build_are_not_used():
    """A2's side row was written from older bars than its screener row now holds: its two
    bar inputs are blank, so Steady, High and the score are, while Strength still stands."""
    seed(inputs={"A2": {"rs_steady": 0.9, "rs_line_below_high_pct": 0.0, "bars_asof": "20261111"}})
    pp.run(S)
    a2 = _side()["A2"]
    assert a2["rs_ls_steady"] is None and a2["rs_ls_high"] is None and a2["rs_leader_score"] is None
    assert a2["rs_ls_strength"] is not None and a2["rs_ls_group"] is not None
    assert a2["score_session"] is None
    h = _history(S)[(S, "A2")]
    assert h["score"] is None and h["strength"] is not None, "on the floor: recorded, with a blank score"
    assert _side()["A1"]["rs_leader_score"] is not None


def test_a_row_with_no_side_row_gets_one_and_a_ticker_that_left_is_removed():
    seed()
    snapshot_db.upsert_rows([_row("NEW", "a", "A")])            # built before the flag was armed
    rh.store_rows(S, {**scores(), "NEW": _hist(20.0)})
    sh.write_inputs({"GONE": {"rs_steady": 0.1, "rs_line_below_high_pct": 0.0, "bars_asof": ASOF}})
    pp.run(S)
    side = _side()
    assert "GONE" not in side and len(side) == 17
    assert side["NEW"]["rs_steady"] is None and side["NEW"]["rs_leader_score"] is None
    assert side["NEW"]["rs_ls_strength"] == pytest.approx(100 * 16.5 / 17, abs=1e-4)


def test_a_stock_listed_under_a_year_ago_is_on_the_floor_with_a_blank_score():
    """The reference set is the liquid floor WITHOUT the full-year test. A young stock has
    no rating score yet: it is in the record for the session (on the floor), it counts
    as a member of its industry, and its own score is blank."""
    seed()
    snapshot_db.upsert_rows([_row("YOUNG", "a", "A")])
    young = {**_hist(None, ibd=None), "m6": None, "m9": None, "m12": None}
    rh.store_rows(S, {**scores(), "YOUNG": young})
    sh.write_inputs({"YOUNG": {"rs_steady": 0.3, "rs_line_below_high_pct": 0.0, "bars_asof": ASOF}})
    pp.run(S)
    with closing(snapshot_db.connect()) as conn:
        row = dict(conn.execute("SELECT rs_rating_12m, rs_rating_pos, rs_rating_score FROM screener_rows "
                                "WHERE ticker = 'YOUNG'").fetchone())
    assert row == {"rs_rating_12m": None, "rs_rating_pos": None, "rs_rating_score": None}
    h = _history(S)
    assert len(h) == 17 and (S, "YOUNG") in h
    assert h[(S, "YOUNG")]["score"] is None and h[(S, "YOUNG")]["strength"] is None
    assert h[(S, "YOUNG")]["steady"] == 50.0 and h[(S, "YOUNG")]["high"] == 100.0
    # Steady is ranked over 17 stocks now, Strength still over the 16 that have a score
    assert h[(S, "A8")]["strength"] == pytest.approx(100 * 15.5 / 16, abs=1e-4)


def test_off_the_floor_is_blank_and_unrecorded():
    seed(universe(B1={"is_etf": 1, "security_type": "ETF"}, B2={"price": 9.99}))
    pp.run(S)
    side, hist = _side(), _history(S)
    for t in ("B1", "B2"):
        assert side[t]["rs_leader_score"] is None and side[t]["rs_ls_strength"] is None
        assert (S, t) not in hist
    assert len(hist) == 14


# ───────────────────────── the flag ─────────────────────────

def test_flag_off_the_post_pass_is_the_one_it_was(monkeypatch):
    seed()
    with closing(snapshot_db.connect()) as conn:
        conn.execute(f"DROP TABLE {sh.TABLE}")
        conn.commit()
    monkeypatch.delenv("RS_LEADER_SHADOW_ENABLED")
    monkeypatch.setattr(sh, "run", lambda *a, **k: pytest.fail("the shadow pass ran while dark"))
    before = _tables()
    r = pp.run(S)
    assert r["ok"] and r["ranked"] == 16
    # Pin moved 2026-11-14 (unit U12): the pass also keeps UCT RS Leaders' record
    # (`rs_leaders_list.TABLE`; this seed holds stocks that qualify). Still no shadow table.
    from api.services.screener import rs_leaders_list
    assert _tables() - before == {pp.POS_TABLE, pp.RUNS_TABLE, rs_leaders_list.TABLE}
    assert sh.TABLE not in _tables() and sh.HISTORY_TABLE not in _tables()


def test_flag_off_run_returns_before_it_opens_the_database(monkeypatch):
    monkeypatch.delenv("RS_LEADER_SHADOW_ENABLED")
    monkeypatch.setattr(snapshot_db, "connect", lambda *a, **k: pytest.fail("opened the database"))
    r = sh.run(S, record_history=True)
    assert r == {"ok": False, "enabled": False, "session": S, "history": False,
                 "started_at": r["started_at"], "reason": "disabled"}
    assert sh.last_run() == {}


def test_a_failing_shadow_pass_never_costs_the_post_pass(monkeypatch):
    seed()

    def _boom(*a, **k):
        raise RuntimeError("shadow")
    monkeypatch.setattr(sh, "run", _boom)
    r = pp.run(S)
    assert r["ok"] and r["rewritten"] and r["ranked"] == 16 and "error" not in r
    with closing(snapshot_db.connect()) as conn:
        assert conn.execute("SELECT rs_rating_pos FROM screener_rows WHERE ticker='A8'").fetchone()[0] == 1


def test_the_shadow_pass_runs_after_the_places_and_only_through_the_post_pass(monkeypatch):
    """It reads `rs_rating_score`, which only the post-pass writes: asked before the
    rewrite it would rank last session's numbers."""
    seed()
    seen = {}
    real = sh.run

    def _spy(session=None, *, record_history=False):
        with closing(snapshot_db.connect()) as conn:
            seen["score"] = conn.execute(
                "SELECT rs_rating_score, rs_rating_pos FROM screener_rows WHERE ticker='A8'").fetchone()
        seen["args"] = (session, record_history)
        return real(session, record_history=record_history)
    monkeypatch.setattr(sh, "run", _spy)
    pp.run(S)
    assert tuple(seen["score"]) == (16.0, 1) and seen["args"] == (S, True)
