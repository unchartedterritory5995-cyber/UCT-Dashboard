"""RS screens unit U12, item W2: a steadier UCT RS Leaders list.

The list was "the 50 qualifiers with the highest RS Rating score", so a stock ranked 50th
today and 52nd tomorrow left it and came back the day after. The rule now
(``rs_leaders_list.members``):

  * a stock already on the list stays while it qualifies and ranks 65 or better;
  * a stock not on it enters at 50 or better, always (no top-50 stock is ever left off);
  * so the list holds 50 to 65 names;
  * a stock that stops qualifying leaves at once;
  * the first session (no earlier record) is the plain top 50.

``rs_post_pass`` runs it after the rating columns are written and stores two columns,
``rs_leaders_member`` (0/1) and ``rs_leaders_days`` (consecutive stored sessions on the
list), plus the session's record in ``rs_leaders_members``. The qualifiers are the
starter's own filters, evaluated by the scan's own WHERE.

Why each rail exists:
  * the hold band must really hold (a cap applied to "the 50 best-ranked" silently undoes it),
    and a top-50 stock must never wait (a cap of 50 with held seats leaves a 44th-ranked stock off);
  * the gate is the screen's, so a rule added to the screen must reach the list untyped;
  * "already on the list" is yesterday's record, so two passes in one day agree;
  * a pass that cannot compute the list blanks it: yesterday's members never stand beside
    today's ratings.

Hermetic: a ``screener.db`` in ``tmp_path``; no network, no bars store.
"""
from __future__ import annotations

from contextlib import closing

import pytest

from api.services.screener import filters as F
from api.services.screener import query, rs_leaders_list as ll
from api.services.screener import rs_history as rh
from api.services.screener import rs_post_pass as pp
from api.services.screener import rs_screens, saved_screens, snapshot_db

S1, S2, S3 = "2026-11-10", "2026-11-11", "2026-11-12"
RULE = dict(enter=50, hold=65, cap=65)


# ───────────────────────── the rule, as a pure function ─────────────────────────

def _a(lo, hi):
    return [f"A{i:02d}" for i in range(lo, hi + 1)]


def _x(lo, hi):
    """Fillers: qualifiers that are never ranked 50 or better, so never on the list."""
    return [f"X{i:02d}" for i in range(lo, hi + 1)]


#: THREE SESSIONS, each ``(the qualifiers in order, strongest first; who is listed, in
#: order; why)``. Rank = position, counted from 1.
#:
#: Session 1 is the first: no record, the plain top 50.
#: Session 2: GONE stops qualifying and FADE falls to 66, so two seats are free; NEW1 (49th)
#:   and EDGE (exactly 50th) take them, LATE (51st) does not.
#: Session 3: A48 slips to 60th and EDGE to exactly 65th and both HOLD their places; LATE
#:   (49th) and GONE (qualifying again, 50th) rank inside the top 50 and JOIN at once, so the
#:   list holds 52.
SESSIONS = [
    (_a(1, 48) + ["FADE", "GONE", "NEW1", "EDGE", "LATE"] + _x(54, 70),
     _a(1, 48) + ["FADE", "GONE"]),
    (_a(1, 48) + ["NEW1", "EDGE", "LATE"] + _x(52, 65) + ["FADE"] + _x(67, 70),
     _a(1, 48) + ["NEW1", "EDGE"]),
    (_a(1, 47) + ["NEW1", "LATE", "GONE"] + _x(51, 59) + ["A48"] + _x(61, 64) + ["EDGE", "FADE"],
     _a(1, 47) + ["NEW1", "LATE", "GONE", "A48", "EDGE"]),
]
RANKS_3 = {"NEW1": 48, "LATE": 49, "GONE": 50, "A48": 60, "EDGE": 65}


def test_the_table_is_what_its_comments_say():
    one, two, three = (ranked for ranked, _listed in SESSIONS)
    assert (one.index("GONE") + 1, one.index("NEW1") + 1) == (50, 51)
    assert (two.index("EDGE") + 1, two.index("LATE") + 1, two.index("FADE") + 1) == (50, 51, 66)
    assert "GONE" not in two
    assert {t: three.index(t) + 1 for t in ("LATE", "GONE", "A48", "EDGE", "FADE")} == \
        {"LATE": 49, "GONE": 50, "A48": 60, "EDGE": 65, "FADE": 66}
    for ranked, _listed in SESSIONS:
        assert len(set(ranked)) == len(ranked)


def test_the_rule_over_three_sessions():
    prior = None
    for n, (ranked, want) in enumerate(SESSIONS, 1):
        got = ll.members(ranked, prior, **RULE)
        assert [t for t, _rank in got] == want, f"session {n}"
        assert [rank for _t, rank in got] == [ranked.index(t) + 1 for t in want], f"session {n}: ranks"
        assert 50 <= len(got) <= 65
        prior = {t for t, _rank in got}
    assert dict(got)["A48"] == 60 and dict(got)["EDGE"] == 65


@pytest.mark.parametrize("case, ranked, prior, want", [
    ("the first session is the plain top 50", [f"T{i:02d}" for i in range(1, 71)], None,
     [f"T{i:02d}" for i in range(1, 51)]),
    ("an empty record is a first session too", [f"T{i:02d}" for i in range(1, 71)], set(),
     [f"T{i:02d}" for i in range(1, 51)]),
    ("fewer than 50 qualify: all of them", ["A", "B", "C"], None, ["A", "B", "C"]),
    ("a listed stock at 65 stays, at 66 leaves",
     _x(1, 64) + ["KEEP", "DROP"], {"KEEP", "DROP"}, _x(1, 50) + ["KEEP"]),
    ("a stock that stops qualifying leaves at once", ["A", "B"], {"A", "B", "GONE"}, ["A", "B"]),
    ("nobody qualifies", [], {"A"}, []),
])
def test_the_rule_case_by_case(case, ranked, prior, want):
    assert [t for t, _r in ll.members(ranked, prior, **RULE)] == want, case


def test_a_listed_stock_holds_its_place_and_a_top_50_newcomer_never_waits():
    """THE reason for the unit, both halves. Fifty listed stocks, one of them now 52nd. Cut
    to "the 50 best-ranked" it would be gone (ranks 1 to 50 always fill the list): it holds.
    And the newcomer at 50th joins the same day: a list capped at 50 with held seats would
    keep a top-50 stock off it, so the list is 51 names today."""
    yesterday = [f"T{i:02d}" for i in range(1, 51)]
    today = yesterday[:49] + ["NEWC", "X51", "T50"]              # T50 is 52nd, NEWC 50th
    got = [t for t, _r in ll.members(today, set(yesterday), **RULE)]
    assert "T50" in got and "NEWC" in got and "X51" not in got and len(got) == 51
    # the next session T50 is 66th: it leaves; OTHER (51st, never listed) does not join
    later = yesterday[:49] + ["NEWC", "OTHER"] + _x(52, 65) + ["T50"]
    got = [t for t, _r in ll.members(later, set(got), **RULE)]
    assert "T50" not in got and "NEWC" in got and "OTHER" not in got and len(got) == 50


def test_every_top_50_stock_is_listed_whoever_holds():
    """The promise in one line: whatever yesterday's list was, today's holds every stock
    ranked 50th or better, nobody ranked past 65th, and past 50th only yesterday's members."""
    ranked = [f"R{i:02d}" for i in range(1, 91)]
    for prior in (None, set(ranked[:50]), set(ranked[15:65]), set(ranked[40:90]), {"GONE1", "GONE2"}):
        got = dict(ll.members(ranked, prior, **RULE))
        assert set(ranked[:50]) <= set(got), prior
        assert max(got.values()) <= 65 and len(got) <= 65, prior
        assert set(got) - set(ranked[:50]) == {t for t in (prior or ()) if t in ranked[50:65]}, prior


def test_the_pass_applies_the_rule_with_no_cut_at_50(db, monkeypatch):
    """The run hands the rule the screen's own two ranks and a cap the bands cannot reach."""
    seen = {}
    real = ll.members
    monkeypatch.setattr(ll, "members", lambda ranked, prior, **kw: seen.update(kw) or real(ranked, prior, **kw))
    _write(["AAA", "BBB"])
    ll.run(S1, record=True)
    assert seen == {"enter": rs_screens.LEADERS_TOP_N, "hold": rs_screens.LEADERS_HOLD_RANK,
                    "cap": rs_screens.LEADERS_HOLD_RANK}
    assert seen["cap"] >= seen["hold"] > seen["enter"]


def test_the_three_numbers_are_three_separate_rules():
    """At 50 / 65 / 50 the join rank and the cap are the same number, so a newcomer ranked
    past the join rank can never find a free seat and that rule cannot be seen on its own
    (mutation W2-c survived the table above). With a cap wider than the join rank each of
    the three is visible."""
    rule = dict(enter=3, hold=5, cap=4)
    # a seat is free and the best newcomer ranks 4th: past the join rank, it does not enter
    assert [t for t, _r in ll.members(["A", "B", "C", "N4"], {"A", "B", "C"}, **rule)] == ["A", "B", "C"]
    # at the join rank it does
    assert [t for t, _r in ll.members(["A", "B", "N3", "C"], {"A", "B", "C"}, **rule)] == ["A", "B", "N3", "C"]
    # the hold rank: 5th stays, 6th leaves
    assert [t for t, _r in ll.members(["N1", "N2", "N3", "X", "A", "B"], {"A", "B"}, **rule)] == ["N1", "N2", "N3", "A"]
    # the cap: three listed stocks hold, so one newcomer of two gets the fourth seat
    assert [t for t, _r in ll.members(["N1", "N2", "A", "B", "C"], {"A", "B", "C"}, **rule)] == ["N1", "A", "B", "C"]
    assert [t for t, _r in ll.members(["N1", "N2", "A", "B", "C"], {"A", "B", "C"}, enter=3, hold=5, cap=0)] == []


def test_days_count_consecutive_sessions_and_stop_at_a_gap():
    history = [{"A", "B"}, {"A", "B", "C"}, {"B"}, {"A", "B"}]      # newest first
    assert ll.days_on_list(["A", "B", "C", "NEW"], history) == {"A": 3, "B": 5, "C": 1, "NEW": 1}
    assert ll.days_on_list(["A"], []) == {"A": 1}


# ───────────────────────── the gate is the screen's own ─────────────────────────

@pytest.fixture
def db(tmp_path, monkeypatch):
    from api.services.signature import registry_defs
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")
    monkeypatch.delenv("RS_RANK_IBD_ENABLED", raising=False)
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", True)
    monkeypatch.setattr(query, "stale_gate", lambda conn: None)
    snapshot_db.init_db()
    return tmp_path


def _leader(ticker, score, **kw):
    """A row that passes every rule of UCT RS Leaders unless ``kw`` says otherwise."""
    return {"ticker": ticker, "security_type": "Stock", "is_etf": 0, "price": 50.0,
            "dollar_vol_30d": 5e7, "adr_pct": 4.0, "market_cap": 2e9, "rs_rank": 90,
            "pct_vs_sma200": 12.0, "sma200_rising": 1, "dist_52w_high_pct": -5.0,
            "rs_line_above_ma": 1, "rs_rating_score": score, "snapshot_date": "2026-11-13",
            "built_at": 1, **kw}


def _write(ranked, extra=()):
    """The WHOLE table as a build leaves it: one qualifying row per name, scored in
    ``ranked``'s order, both list columns blank (the build's INSERT OR REPLACE), and no
    row left over from the session before."""
    with closing(snapshot_db.connect()) as conn:
        conn.execute("DELETE FROM screener_rows")
        conn.commit()
    snapshot_db.upsert_rows([_leader(t, 5.0 - 0.01 * i) for i, t in enumerate(ranked)] + list(extra))


def _rows():
    with closing(snapshot_db.connect()) as conn:
        return {r["ticker"]: dict(r) for r in conn.execute(
            "SELECT ticker, rs_leaders_member, rs_leaders_days, rs_rating_score FROM screener_rows")}


def _record():
    with closing(snapshot_db.connect()) as conn:
        if not ll._table_exists(conn):
            return {}
        out = {}
        for s, t, rank in conn.execute(f"SELECT session, ticker, rank FROM {ll.TABLE} ORDER BY session, rank"):
            out.setdefault(s, []).append((t, rank))
        return out


def _listed():
    return sorted(t for t, r in _rows().items() if r["rs_leaders_member"] == 1)


def test_the_qualifier_is_the_starters_own_filters_minus_membership(db):
    served = saved_screens._stocks_only(rs_screens.leaders())["spec"]["filters"]
    gate = ll.qualifier_filters()
    assert gate == [f for f in served if f["key"] != "rs_leaders_member"]
    assert {"key": "rs_leaders_member", "op": "eq", "value": 1} in served
    keys = [f["key"] for f in gate]
    assert keys == ["price", "dollar_vol_30d", "adr_pct", "market_cap", "rs_rank", "pct_vs_sma200",
                    "sma200_rising", "dist_52w_high_pct", "rs_line_above_ma", "rs_flag", "security_type"]
    gate[0]["min"] = -1
    assert ll.qualifier_filters()[0]["min"] == 10, "a fresh copy each call"


@pytest.mark.parametrize("why, miss", [
    ("under $10", {"price": 9.0}),
    ("under $20M traded", {"dollar_vol_30d": 1e7}),
    ("a quiet stock", {"adr_pct": 2.0}),
    ("too small", {"market_cap": 1e8}),
    ("RS Rating under 80", {"rs_rank": 79}),
    ("under its 200-day line", {"pct_vs_sma200": -1.0}),
    ("a falling 200-day line", {"sma200_rising": 0}),
    ("far below its high", {"dist_52w_high_pct": -40.0}),
    ("RS line under its average", {"rs_line_above_ma": 0}),
    ("a buyout name", {"rs_flag": "buyout_pending"}),
    ("a fund", {"security_type": "ETF"}),
    ("no score to rank by", {"rs_rating_score": None}),
    ("a rule's column is blank", {"adr_pct": None}),
])
def test_every_rule_of_the_screen_keeps_a_stock_off_the_list(db, why, miss):
    """The strongest row in the table misses ONE rule of the screen. It is not ranked, so
    it is not listed, and the two that pass are."""
    snapshot_db.upsert_rows([_leader("MISS", 9.9, **miss), _leader("AAA", 2.0), _leader("BBB", 1.0)])
    with closing(snapshot_db.connect()) as conn:
        assert ll.ranked_qualifiers(conn) == ["AAA", "BBB"], why
    out = ll.run(S1, record=True)
    assert _listed() == ["AAA", "BBB"] and out["qualifiers"] == 2, why
    assert _rows()["MISS"]["rs_leaders_member"] == 0, "checked, and not on the list"


def test_a_rule_added_to_the_screen_reaches_the_list_untyped(db, monkeypatch):
    """Nothing in `rs_leaders_list` names a threshold: raise the screen's own rating floor
    and its market value floor and the list follows on the next pass."""
    snapshot_db.upsert_rows([_leader("AAA", 3.0, rs_rank=99), _leader("BBB", 2.0, rs_rank=85),
                             _leader("CCC", 1.0, rs_rank=99, market_cap=4e8)])
    ll.run(S1, record=False)
    assert _listed() == ["AAA", "BBB", "CCC"]
    monkeypatch.setattr(rs_screens, "LEADERS_MIN_RATING", 90)
    ll.run(S1, record=False)
    assert _listed() == ["AAA", "CCC"]
    monkeypatch.setattr(rs_screens, "LEADERS_MIN_MARKET_CAP", 1_000_000_000)
    ll.run(S1, record=False)
    assert _listed() == ["AAA"]


def test_ties_fall_to_the_ticker_and_the_scans_stale_gate_applies(db, monkeypatch):
    snapshot_db.upsert_rows([_leader("ZZZ", 2.0), _leader("AAA", 2.0), _leader("OLD", 9.0)])
    with closing(snapshot_db.connect()) as conn:
        assert ll.ranked_qualifiers(conn) == ["OLD", "AAA", "ZZZ"]
    # a row the scan leaves out because its bars stopped is not ranked either
    monkeypatch.setattr(query, "stale_gate", lambda conn: {
        "sql": "ticker != ?", "params": ["OLD"], "max_sessions": 10, "reference": 20261113})
    with closing(snapshot_db.connect()) as conn:
        assert ll.ranked_qualifiers(conn) == ["AAA", "ZZZ"]


# ───────────────────────── three sessions on a real table ─────────────────────────

def test_three_sessions_through_the_table(db):
    """The same three sessions, each written as a build leaves the table and run through
    the scan's own WHERE: the columns, the days and the stored record."""
    want_days = [
        {t: 1 for t in SESSIONS[0][1]},
        {**{t: 2 for t in _a(1, 48)}, "NEW1": 1, "EDGE": 1},
        {**{t: 3 for t in _a(1, 47)}, "A48": 3, "NEW1": 2, "EDGE": 2, "LATE": 1, "GONE": 1},
    ]
    receipts = []
    for session, (ranked, want), days in zip((S1, S2, S3), SESSIONS, want_days):
        _write(ranked, extra=[_leader("NOQUAL", 9.0, rs_rank=10)])
        assert {r["rs_leaders_member"] for r in _rows().values()} == {None}, "a build blanks the column"
        receipts.append(ll.run(session, record=True))
        rows = _rows()
        assert sorted(t for t, r in rows.items() if r["rs_leaders_member"] == 1) == sorted(want), session
        assert {t: r["rs_leaders_days"] for t, r in rows.items() if r["rs_leaders_member"] == 1} == days, session
        off = [r for t, r in rows.items() if t not in want]
        assert off and all(r["rs_leaders_member"] == 0 and r["rs_leaders_days"] is None for r in off), session
        assert [t for t, _rank in _record()[session]] == want, session
    assert dict(_record()[S3]) == {**{t: i for i, t in enumerate(_a(1, 47), 1)}, **RANKS_3}
    assert [(r["members"], r["qualifiers"], r["held"], r["entered"], r["left"], r["prior_session"], r["recorded"])
            for r in receipts] == [(50, 70, 0, 50, 0, None, True),
                                   (50, 70, 48, 2, 2, S1, True),
                                   (52, 66, 50, 2, 0, S2, True)]
    # every row is answered (66 qualifiers and the one that does not qualify), 52 carry days
    assert receipts[2]["populated"] == {"rs_leaders_member": 67, "rs_leaders_days": 52}


def test_a_second_pass_in_one_session_reads_the_same_yesterday(db):
    """`rs_post_pass` runs after every build and again after the rating job. Each pass of
    session 2 must read SESSION 1 as "already on the list", never its own first answer."""
    _write(SESSIONS[0][0])
    ll.run(S1, record=True)
    _write(SESSIONS[1][0])
    first = ll.run(S2, record=True)
    listed, days = _listed(), {t: r["rs_leaders_days"] for t, r in _rows().items()}
    again = ll.run(S2, record=True)
    assert again == first and _listed() == listed
    assert {t: r["rs_leaders_days"] for t, r in _rows().items()} == days, "days did not grow on a second pass"
    assert sorted(_record()) == [S1, S2] and len(_record()[S2]) == 50


def test_a_pass_that_does_not_record_writes_the_columns_and_no_record(db):
    """The 03:00 ET build's pass carries yesterday's ratings: the list is shown, and the
    record waits for the pass that has the settled session's ratings."""
    _write(SESSIONS[0][0])
    ll.run(S1, record=True)
    _write(SESSIONS[1][0])
    out = ll.run(S2, record=False)
    assert out["recorded"] is False and out["prior_session"] == S1 and out["members"] == 50
    assert sorted(_listed()) == sorted(SESSIONS[1][1])
    assert sorted(_record()) == [S1], "a carried pass stored a record"


def test_an_empty_list_is_never_recorded_and_no_table_is_made_for_it(db):
    snapshot_db.upsert_rows([_leader("AAA", 2.0, rs_rank=10)])
    out = ll.run(S1, record=True)
    assert (out["members"], out["recorded"]) == (0, False)
    assert _rows()["AAA"]["rs_leaders_member"] == 0
    with closing(snapshot_db.connect()) as conn:
        assert not ll._table_exists(conn)


def test_the_record_keeps_400_sessions(db, monkeypatch):
    monkeypatch.setattr(ll, "KEEP_SESSIONS", 3)
    _write(["AAA", "BBB"])
    for day in ("2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"):
        ll.run(day, record=True)
    assert sorted(_record()) == ["2026-11-04", "2026-11-05", "2026-11-06"]
    assert _rows()["AAA"]["rs_leaders_days"] == 4, "today and the three sessions the record still holds"
    assert ll.KEEP_SESSIONS == 3 and pp.POS_KEEP_SESSIONS == 400


def test_a_failure_blanks_both_columns_and_never_raises(db, monkeypatch):
    _write(["AAA", "BBB"])
    ll.run(S1, record=True)
    assert _listed() == ["AAA", "BBB"]

    def boom(conn):
        raise RuntimeError("no plan")
    monkeypatch.setattr(ll, "ranked_qualifiers", boom)
    out = ll.run(S2, record=True)
    assert out == {"error": "RuntimeError: no plan", "populated": {"rs_leaders_member": 0, "rs_leaders_days": 0}}
    assert {(r["rs_leaders_member"], r["rs_leaders_days"]) for r in _rows().values()} == {(None, None)}
    assert sorted(_record()) == [S1], "yesterday's record stands"


# ───────────────────────── inside the rating pass ─────────────────────────

def _hist(ibd, score):
    return {"ibd": ibd, "m1": 41, "m3": 43, "m6": 46, "m9": 49, "m12": 50, "score": score,
            "bars": 260, "v1": 1.0, "v3": 1.0, "v6": 1.0, "v9": 1.0, "v12": 1.0}


def test_the_pass_runs_the_list_after_the_ratings_and_reports_it(db):
    """The order is the score THIS pass wrote: the rows arrive with yesterday's scores
    upside down, and the list follows the session's own."""
    names = ["AAA", "BBB", "CCC"]
    snapshot_db.upsert_rows([_leader(t, score, rs_rating_ibd=90) for t, score in zip(names, (1.0, 2.0, 3.0))])
    rh.store_rows(S1, {"AAA": _hist(99, 3.0), "BBB": _hist(95, 2.0), "CCC": _hist(90, 1.0)})
    r = pp.run(S1)
    assert r["ok"] and r["rewritten"]
    assert r["leaders"] == {"members": 3, "qualifiers": 3, "held": 0, "entered": 3, "left": 0,
                            "prior_session": None, "recorded": True}
    assert r["populated"]["rs_leaders_member"] == 3 and r["populated"]["rs_leaders_days"] == 3
    assert _record() == {S1: [("AAA", 1), ("BBB", 2), ("CCC", 3)]}
    assert ll.COLUMNS == pp.LEADERS_COLUMNS and pp.PASS_COLUMNS == pp.OWNED_COLUMNS + ll.COLUMNS
    assert set(pp.PASS_COLUMNS) == set(snapshot_db.POST_PASS_COLUMNS)
    assert set(r["populated"]) == set(snapshot_db.POST_PASS_COLUMNS)


def test_the_pass_before_the_rating_job_lists_and_records_nothing(db):
    """Session 2 is not stored yet (every 03:00 ET build). The rows keep session 1's
    ratings, the list is computed against session 1's record, and nothing is recorded."""
    rh.store_rows(S1, {"AAA": _hist(99, 3.0), "BBB": _hist(95, 2.0)})
    rows = [_leader("AAA", None, rs_rating_ibd=99, rs_rating_1m=41, rs_rating_3m=43, rs_rating_6m=46,
                    rs_rating_9m=49, rs_rating_12m=50, rs_rating_chg_5=None, rs_rating_chg_20=None),
            _leader("BBB", None, rs_rating_ibd=95, rs_rating_1m=41, rs_rating_3m=43, rs_rating_6m=46,
                    rs_rating_9m=49, rs_rating_12m=50, rs_rating_chg_5=None, rs_rating_chg_20=None)]
    snapshot_db.upsert_rows(rows)
    assert pp.run(S1)["leaders"]["recorded"] is True
    snapshot_db.upsert_rows(rows)                                   # the next night's build
    r = pp.run(S2)
    assert r["reason"] == "session_not_stored" and r["rating_session"] == S1
    assert r["leaders"]["recorded"] is False and r["leaders"]["prior_session"] == S1
    assert _listed() == ["AAA", "BBB"] and sorted(_record()) == [S1]
    assert {t: x["rs_leaders_days"] for t, x in _rows().items()} == {"AAA": 2, "BBB": 2}


def test_a_list_that_fails_costs_the_pass_nothing(db, monkeypatch):
    snapshot_db.upsert_rows([_leader("AAA", 1.0)])
    rh.store_rows(S1, {"AAA": _hist(99, 3.0)})
    monkeypatch.setattr(ll, "_run", lambda *a, **k: (_ for _ in ()).throw(ValueError("bad gate")))
    r = pp.run(S1)
    assert r["ok"] and r["rewritten"] and r["ranked"] == 1
    assert r["leaders"] == {"error": "ValueError: bad gate"}
    assert r["populated"]["rs_leaders_member"] == 0 and r["populated"]["rs_rating_pos"] == 1
    assert _rows()["AAA"]["rs_leaders_member"] is None


def test_flag_off_nothing_is_written_and_no_table_is_made(db, monkeypatch):
    _write(["AAA", "BBB"])
    monkeypatch.delenv("RS_SCREENS_ENABLED")
    called = []
    monkeypatch.setattr(ll, "run", lambda *a, **k: called.append(1))
    r = pp.run(S1)
    assert r["reason"] == "disabled" and called == [] and "leaders" not in r
    assert {x["rs_leaders_member"] for x in _rows().values()} == {None}
    with closing(snapshot_db.connect()) as conn:
        assert not ll._table_exists(conn)


# ───────────────────────── the schema and the registries ─────────────────────────

def test_the_two_columns_are_declared_whole_and_belong_to_the_pass():
    for c in ll.COLUMNS:
        assert snapshot_db.COLUMNS.count(c) == 1 and snapshot_db._coldef(c) == f"{c} INTEGER", c
        assert c in snapshot_db._INT and c in snapshot_db.POST_PASS_COLUMNS
        f = F.FILTERS[c]
        assert f["category"] == "relative_strength" and f["column"] == c and f.get("agent_omit") is True
        assert c in F.RS_SCREENS_KEYS and c in F.VIEWS["relative_strength"]["columns"]
    assert F.FILTERS["rs_leaders_member"]["type"] == "bool" and F.FILTERS["rs_leaders_days"]["type"] == "range"
    assert ll.COLUMNS == ("rs_leaders_member", "rs_leaders_days")
    assert (rs_screens.LEADERS_TOP_N, rs_screens.LEADERS_HOLD_RANK) == (50, 65)
    for v2 in (True, False):
        assert set(ll.COLUMNS) <= F.rs_dark_keys(v2_on=v2, history_on=True, v3_on=True, screens_on=False)


def test_the_starter_filters_on_membership_and_sorts_by_the_score(db):
    st = saved_screens._stocks_only(rs_screens.leaders())
    assert "rank" not in st["spec"]
    assert st["spec"]["sort"] == {"key": "rs_rating_score", "dir": "desc"}
    assert st["row"]["place"] == "index" and st["row"]["sort_label"] == "RS Rating"
    assert st["row"]["facts"] == ["days"]
    assert st["row"]["steady"] == {"key": "rs_leaders_member", "by": "rs_rating_score", "enter": 50, "hold": 65}
    # served: exactly the listed stocks, strongest first, whatever the rank among qualifiers
    _write(SESSIONS[0][0])
    ll.run(S1, record=True)
    _write(SESSIONS[1][0])
    ll.run(S2, record=True)
    _write(SESSIONS[2][0])
    ll.run(S3, record=True)
    out = query.run_scan({**st["spec"], "page_size": 100})
    assert [r["ticker"] for r in out["rows"]] == SESSIONS[2][1]
    assert out["total"] == len(SESSIONS[2][1]) == 52 and out["rank"] is None
    assert query.preview_count(st["spec"])["count"] == 52


def test_the_method_page_states_the_rule_from_the_constants(db, monkeypatch):
    from api.services.screener import methodology as M
    rule = next(s for s in M.rs_screens_section()["screens"] if s["id"] == "starter_rs_leaders")["rule"]
    assert ("A stock joins the list when it ranks in the top 50 of these by RS Rating score, "
            "and stays until it falls past 65th or stops passing a rule, so a stock at the edge "
            "does not come and go from one day to the next. The list therefore holds 50 to 65 stocks") in rule
    assert "place is free" not in rule and "at most" not in rule
    monkeypatch.setattr(rs_screens, "LEADERS_HOLD_RANK", 70)
    rule = next(s for s in M.rs_screens_section()["screens"] if s["id"] == "starter_rs_leaders")["rule"]
    assert "falls past 70th" in rule
    for col in ll.COLUMNS:
        m = M.for_column(col)
        assert m is not None and m["how"].endswith(M._RS_SCREENS_NOTE), col


def test_the_client_registries_name_both_and_state_the_rules_numbers():
    import json
    import re
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    src = (root / "app" / "src" / "pages" / "screener" / "columnDefs.js").read_text(encoding="utf-8")
    plain = (root / "app" / "src" / "pages" / "screener" / "focus" / "plainWords.js").read_text(encoding="utf-8")
    descs = {}
    for key in ll.COLUMNS:
        m = re.search(rf"\n  {key}: \{{ label: '([^']*)', fmt: ([^\n]*?),\s*\n    desc: '((?:[^'\\]|\\.)*)' \}},", src)
        assert m, f"{key} has no column definition"
        descs[key] = m.group(3)
        assert len(m.group(3)) > 60 and "—" not in m.group(3), key
        assert re.search(rf"\n  {key}: '[^']+',", plain), f"{key} has no plain name"
    assert f"top {rs_screens.LEADERS_TOP_N} of the stocks" in descs["rs_leaders_member"]
    assert f"falls past {rs_screens.LEADERS_HOLD_RANK}th" in descs["rs_leaders_member"]
    assert "1 means it joined today" in descs["rs_leaders_days"]
    table = json.loads((root / "app" / "src" / "components" / "chart" / "engine" / "ast"
                        / "closedTable.json").read_text(encoding="utf-8"))
    for key in ll.COLUMNS:
        assert key not in table["scalars"]
        why = table["_scalars_excluded"][key]
        assert "2026-11-14" in why and "RS_SCREENS_ENABLED" in why and "unit U12" in why, key
