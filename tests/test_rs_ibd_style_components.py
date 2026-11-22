"""IBD-style 6M / 9M / 12M component ranks and their history restate (2026-11-11).

Owner decision from the 61-name Deepvue fit (production, 2026-11-11): ``m1`` and
``m3`` stay percentiles of the plain 21- and 63-bar returns; ``m6``, ``m9`` and
``m12`` become percentiles of a recency-weighted close-ratio (newest quarter
double):

    m6  = (2 R63 + R126) / 3
    m9  = (2 R63 + R126 + R189) / 4
    m12 = (2 R63 + R126 + R189 + R252) / 5            Rn = close / close[-n]

A component needs its WHOLE window (a 150-bar stock has no 9M or 12M rank, as
before). ``rs_history --restate-ranks`` rewrites those three columns for the sessions
already stored, after a check that ``ibd``/``m1``/``m3`` still agree with today's bars.

Hermetic like ``test_rs_history_m9.py``: a ``screener.db`` in ``tmp_path``, injected
bar and split readers, no network, never ``C:\\data``.
"""
from __future__ import annotations

import json
import random
import sqlite3
from datetime import date

import pytest

from api.services import rs_weighted_return as rsw
from api.services.screener import rs_history as rh
from tests.test_rs_history_m9 import _walk
from tests.test_rs_rating_history import (  # noqa: F401 - fixtures are used by name
    _query, _weekdays_ending, make_reader, provider, tmp_db,
)

END = date(2026, 11, 5)
SESSIONS = [date(2026, 11, 3), date(2026, 11, 4), END]


def _anchored(r63, r126, r189, r252, n=253):
    """``n`` closes ending at 200 whose 63/126/189/252-bar ratios are exactly the
    arguments (the reference closes sit at 200 / r)."""
    c = [100.0] * n
    c[-1] = 200.0
    for bars, r in ((63, r63), (126, r126), (189, r189), (252, r252)):
        if len(c) > bars:
            c[-1 - bars] = 200.0 / r
    return c


def _ref_b(closes):
    """An independent copy of method "B" from the production fit script
    (``u5b_fit_pod.py``): ratios, newest quarter doubled, a missing term dropped,
    nothing without R63. Used only to prove the shipped path agrees with the method
    the 61 Deepvue readings were scored against."""
    def r(n):
        if len(closes) <= n or closes[-1 - n] <= 0:
            return None
        return closes[-1] / closes[-1 - n]
    R = {n: r(n) for n in (63, 126, 189, 252)}

    def avg(parts):
        parts = [(w, v) for w, v in parts if v is not None]
        return sum(w * v for w, v in parts) / sum(w for w, _ in parts) if parts else None
    if R[63] is None:
        return {"m6": None, "m9": None, "m12": None}
    return {"m6": avg([(2, R[63]), (1, R[126])]),
            "m9": avg([(2, R[63]), (1, R[126]), (1, R[189])]),
            "m12": avg([(2, R[63]), (1, R[126]), (1, R[189]), (1, R[252])])}


# ── the arithmetic ──────────────────────────────────────────────────────────

def test_the_table_is_the_owner_decision():
    assert dict(rsw.IBD_STYLE_COMPONENT_TERMS) == {
        "m6": ((63, 2), (126, 1)),
        "m9": ((63, 2), (126, 1), (189, 1)),
        "m12": ((63, 2), (126, 1), (189, 1), (252, 1)),
    }
    assert rh.RESTATE_COLUMNS == ("m6", "m9", "m12")
    assert rh.RESTATE_COMPARED == ("ibd", "m1"), "m3 changed meaning later, so it is compared only once marked"
    assert rh.COMPONENTS == (("m1", 21), ("m3", 63), ("m6", 126), ("m12", 252)), "the screener's four stay four"


def test_the_blend_equals_the_hand_derived_values():
    c = _anchored(2.0, 4.0, 5.0, 10.0)
    v = rh.component_values(c)
    assert v["m6"] == pytest.approx((2 * 2.0 + 4.0) / 3)
    assert v["m9"] == pytest.approx((2 * 2.0 + 4.0 + 5.0) / 4)
    assert v["m12"] == pytest.approx((2 * 2.0 + 4.0 + 5.0 + 10.0) / 5)
    # 1M is still the plain percentage return, not a ratio; 3M is the equal-weighted ratio average
    assert v["m1"] == pytest.approx(rsw.period_return(c, 21))
    assert v["m3"] == pytest.approx(2.0)                 # R21 = R42 = R63 = 2.0 here
    assert list(v) == ["m1", "m3", "m6", "m9", "m12"]


def test_a_component_needs_its_whole_window():
    assert rh.component_values(_anchored(2, 4, 5, 10, n=253))["m12"] is not None
    short = rh.component_values(_anchored(2, 4, 5, 10, n=252))      # one close short of 252 bars back
    assert short["m12"] is None and short["m9"] is not None and short["m6"] is not None
    young = rh.component_values([100.0] * 149 + [120.0])           # 150 closes
    assert young["m6"] is not None and young["m9"] is None and young["m12"] is None
    edge = rh.component_values([100.0] * 126 + [120.0])            # 127 closes: reaches 126 bars back
    assert edge["m6"] is not None
    assert rh.component_values([100.0] * 125 + [120.0])["m6"] is None, "126 closes cannot reach 126 bars back"
    assert rh.component_values([100.0] * 64)["m6"] is None
    assert rh.component_values([100.0] * 64)["m3"] is not None


def test_an_unusable_interior_term_is_dropped_and_the_weights_renormalised():
    c = _anchored(2.0, 4.0, 5.0, 10.0)
    c[-127] = 0.0                                                   # R126 has no positive reference
    v = rh.component_values(c)
    assert v["m6"] == pytest.approx(2.0)                            # only R63 survives
    assert v["m9"] == pytest.approx((2 * 2.0 + 5.0) / 3)
    assert v["m12"] == pytest.approx((2 * 2.0 + 5.0 + 10.0) / 4)
    c2 = _anchored(2.0, 4.0, 5.0, 10.0)
    c2[-64] = 0.0                                                   # no R63: nothing at any horizon
    v2 = rh.component_values(c2)
    assert v2["m6"] is None and v2["m9"] is None and v2["m12"] is None


def test_the_shipped_path_agrees_with_the_method_the_deepvue_fit_scored():
    rng = random.Random(61)
    for _ in range(40):
        c, p = [], 100.0
        for _i in range(rng.choice([300, 260, 253])):
            p *= 1.0 + rng.uniform(-0.04, 0.045)
            c.append(round(p, 4))
        got, want = rh.component_values(c), _ref_b(c)
        for k in ("m6", "m9", "m12"):
            assert got[k] == pytest.approx(want[k]), k


# ── ranking ─────────────────────────────────────────────────────────────────

def _flat_filler(n=253):
    return [100.0] * n


def test_long_ranks_follow_the_blend_but_short_ranks_stay_plain():
    # P surged lately; Q jumped 12 months ago and has been flat since.
    p = [100.0] * 190 + [100.0 + 50.0 * i / 63 for i in range(1, 64)]
    q = [50.0] * 63 + [150.0] * 190
    f = _flat_filler(len(q))
    assert len(p) == len(q) == 253
    out = rh.compute_ratings({"P": p, "Q": q, "F": f}, set())
    # plain 12M return: Q +200%, P +50%  -> a plain rank would put Q on top
    assert rsw.period_return(q, 252) > rsw.period_return(p, 252)
    assert out["P"]["m12"] > out["Q"]["m12"] > out["F"]["m12"], "the blend puts the recent surge on top"
    assert out["P"]["m3"] > out["Q"]["m3"], "3M is a short average: P is up 50% lately, Q flat"
    assert out["P"]["m6"] > out["Q"]["m6"] and out["P"]["m9"] > out["Q"]["m9"]


def test_ties_share_the_mean_position_and_an_etf_interpolates_without_moving_a_stock():
    a = _anchored(2.0, 4.0, 5.0, 10.0)
    b = _anchored(1.5, 1.5, 1.5, 1.5)
    twin = list(a)
    base = rh.compute_ratings({"A": a, "ATWIN": twin, "B": b, "F": _flat_filler()}, set())
    assert base["A"]["m12"] == base["ATWIN"]["m12"], "equal blends tie"
    mid = _anchored(1.8, 3.0, 4.0, 8.0)                  # blend between B's and A's
    with_etf = rh.compute_ratings({"A": a, "ATWIN": twin, "B": b, "F": _flat_filler(), "XLK": mid}, {"XLK"})
    for t in ("A", "ATWIN", "B", "F"):
        assert with_etf[t]["m12"] == base[t]["m12"] and with_etf[t]["m6"] == base[t]["m6"], \
            "an ETF never moves a stock's rating"
    assert with_etf["B"]["m12"] < with_etf["XLK"]["m12"] <= with_etf["A"]["m12"], "interpolated between the two stocks"


def test_the_composite_rating_is_untouched():
    a = _anchored(2.0, 4.0, 5.0, 10.0)
    b = _anchored(1.5, 1.5, 1.5, 1.5)
    out = rh.compute_ratings({"A": a, "B": b}, set())
    assert rh.ibd_score(a) > rh.ibd_score(b)
    assert out["A"]["ibd"] == 99 and out["B"]["ibd"] == 50
    assert out["A"]["score"] == round(rh.ibd_score(a), 6)


# ── the restate ─────────────────────────────────────────────────────────────

def _names(n=120):
    rate = lambda i, k: ((i * 7 + k * 3) % 11 - 5) / 2500.0     # noqa: E731 - small distinct drifts
    out = {f"S{i:03d}": _walk(300, 100, [rate(i, 0), rate(i, 1), rate(i, 2), rate(i, 3)]) for i in range(n)}
    out["SPY"] = _walk(300, 400, [0.0008] * 4)
    out["XLK"] = _walk(300, 200, [0.0012] * 4)                  # a second ETF: rated, never ranked
    return out


def _small():
    return {"AAA": _walk(300, 100, [0.004, 0.003, -0.001, -0.002]),
            "BBB": _walk(300, 100, [-0.002, -0.001, 0.003, 0.004]),
            "CCC": _walk(300, 100, [0.001, 0.001, 0.001, 0.001]),
            "DDD": _walk(300, 100, [-0.001, -0.001, -0.0015, -0.001]),
            "SPY": _walk(300, 400, [0.0008] * 4)}


ETFS = {"SPY", "XLK"}


def _seed_old(tmp_db, series, days=3):
    """Backfill ``days`` sessions, note the answer key for m6/m9/m12, then put the OLD
    meaning (plain-return ranks) into those columns and drop any restate record: the
    store the pod holds today."""
    r = rh.backfill(days=days, universe=list(series), etf_tickers=ETFS,
                    bars_reader=make_reader(series, END), splits_reader=lambda t: [],
                    sessions=SESSIONS[-days:])
    assert r["ok"], r
    want = {(x["session"], x["ticker"]): (x["m6"], x["m9"], x["m12"]) for x in
            _query(tmp_db, f"SELECT session, ticker, m6, m9, m12 FROM {rh.TABLE}")}
    conn = sqlite3.connect(tmp_db)
    conn.execute(f"UPDATE {rh.TABLE} SET m6 = 1, m9 = 2, m12 = 3")
    conn.execute(f"DROP TABLE IF EXISTS {rh.RESTATED_TABLE}")
    conn.commit()
    conn.close()
    return want


def _all(path, cols="session, ticker, ibd, fast, m1, m3, m6, m9, m12, score, bars"):
    return _query(path, f"SELECT {cols} FROM {rh.TABLE} ORDER BY session, ticker")


def _restate(series, **kw):
    kw.setdefault("etf_tickers", ETFS)
    kw.setdefault("sessions", SESSIONS)
    kw.setdefault("splits_reader", lambda t: [])
    return rh.restate_ranks(3, bars_reader=make_reader(series, END), **kw)


def test_restate_rewrites_only_the_three_columns_and_matches_what_the_nightly_would_have_stored(tmp_db):
    series = _small()
    want = _seed_old(tmp_db, series)
    conn = sqlite3.connect(tmp_db)
    conn.execute(f"UPDATE {rh.TABLE} SET fast = 77 WHERE session = '2026-11-05' AND ticker = 'AAA'")
    conn.commit()
    conn.close()
    before = _all(tmp_db)
    r = _restate(series)
    note = r["note"]
    assert r["ok"] is True and "reason" not in note, note
    assert (note["sessions"], note["sessions_stored"], note["sessions_todo"], note["sessions_done"]) == (3, 3, 3, 3)
    assert (note["drift"], note["hard"], note["rows_nulled"]) == (0, 0, 0)
    after = _all(tmp_db)
    for b, a in zip(before, after):
        for col in ("session", "ticker", "ibd", "fast", "m1", "m3", "score", "bars"):
            assert a[col] == b[col], f"{col} must not move ({a['ticker']} {a['session']})"
    got = {(x["session"], x["ticker"]): (x["m6"], x["m9"], x["m12"]) for x in after}
    assert got == want, "the restate ranks the long columns exactly as a fresh backfill would"
    assert _query(tmp_db, f"SELECT COUNT(*) AS n FROM {rh.RESTATED_TABLE}")[0]["n"] == 3
    again = _restate(series)
    assert again["ok"] and again["note"]["reason"] == "nothing_to_do" and again["rows"] == 0


def test_restate_is_resumable_one_session_at_a_time(tmp_db):
    series = _small()
    want = _seed_old(tmp_db, series)
    first = _restate(series, max_sessions=1)
    assert first["ok"] and first["note"]["sessions_done"] == 1
    done = {x["session"] for x in _query(tmp_db, f"SELECT session FROM {rh.RESTATED_TABLE}")}
    assert done == {"2026-11-05"}, "newest first"
    mid = {(x["session"], x["ticker"]): (x["m6"], x["m9"], x["m12"]) for x in _all(tmp_db)}
    assert mid[("2026-11-05", "AAA")] == want[("2026-11-05", "AAA")]
    assert mid[("2026-11-03", "AAA")] == (1, 2, 3), "an older session is untouched until its turn"
    rest = _restate(series)
    assert rest["ok"] and rest["note"]["sessions_restated_before"] == 1 and rest["note"]["sessions_done"] == 2
    final = {(x["session"], x["ticker"]): (x["m6"], x["m9"], x["m12"]) for x in _all(tmp_db)}
    assert final == want


def test_restate_dry_run_checks_and_writes_nothing(tmp_db):
    series = _small()
    _seed_old(tmp_db, series)
    before = _all(tmp_db)
    runs_before = _query(tmp_db, f"SELECT COUNT(*) AS n FROM {rh.RUNS_TABLE}")[0]["n"]
    r = _restate(series, dry_run=True)
    assert r["ok"] is True and r["dry_run"] is True
    assert r["note"]["sessions_done"] == 3 and r["note"]["rows_written"] == 15
    assert _all(tmp_db) == before
    assert not _query(tmp_db, f"SELECT name FROM sqlite_master WHERE name = '{rh.RESTATED_TABLE}'"), \
        "a dry run creates no restate table"
    assert _query(tmp_db, f"SELECT COUNT(*) AS n FROM {rh.RUNS_TABLE}")[0]["n"] == runs_before, "and no receipt"


def test_restate_refuses_when_todays_bars_would_change_an_unchanged_column(tmp_db):
    series = _small()
    _seed_old(tmp_db, series)
    moved = dict(series)
    moved["DDD"] = _walk(300, 100, [0.01, 0.01, 0.01, 0.01])        # re-adjusted: a different stock now
    before = _all(tmp_db)
    r = _restate(moved)
    note = r["note"]
    assert r["ok"] is False and note["reason"] == "would_change_other_values"
    assert note["mismatches"]["values"] > 0 and note["sessions_done"] == 0 and note["rows_written"] == 0
    assert note["over_allowance"]["hard"] is True
    assert note["examples"][0]["kind"] == "values" and "stored_vs_now" in note["examples"][0]
    assert _all(tmp_db) == before, "a refused run writes no value"
    assert not _query(tmp_db, f"SELECT name FROM sqlite_master WHERE name = '{rh.RESTATED_TABLE}'")


def test_restate_refuses_a_name_the_split_guard_would_skip_and_one_with_no_bars_today(tmp_db):
    series = dict(_small())
    series["SPLT"] = [100.0] * 250 + [50.0] * 50
    _seed_old(tmp_db, series)
    days = _weekdays_ending(END, 300)
    declared = {"SPLT": [(days[250].isoformat(), 2.0)]}
    r = _restate(series, splits_reader=lambda t: declared.get(t, []))
    assert r["ok"] is False and r["note"]["reason"] == "would_change_other_values"
    assert r["note"]["mismatches"]["guard"] == 3
    assert {e["ticker"] for e in r["note"]["examples"] if e["kind"] == "guard"} == {"SPLT"}
    gone = {k: v for k, v in series.items() if k != "CCC"}
    r2 = _restate(gone, splits_reader=lambda t: [])
    assert r2["ok"] is False and r2["note"]["mismatches"]["window"] == 3
    assert (1, 2, 3) == tuple(_query(tmp_db, f"SELECT m6, m9, m12 FROM {rh.TABLE} LIMIT 1")[0].values())


def test_restate_allows_a_little_drift_and_a_little_unrestatable_but_never_leaves_an_old_number(tmp_db):
    series = _names()
    want = _seed_old(tmp_db, series)
    conn = sqlite3.connect(tmp_db)
    # one stored rank off by exactly one point (drift), one off by three (hard): both inside 2 % of the rows
    conn.execute(f"UPDATE {rh.TABLE} SET m1 = m1 + 1 WHERE session = '2026-11-05' AND ticker = 'S010' AND m1 < 99")
    conn.execute(f"UPDATE {rh.TABLE} SET ibd = CASE WHEN ibd > 90 THEN ibd - 3 ELSE ibd + 3 END "
                 "WHERE session = '2026-11-05' AND ticker = 'S020'")
    conn.commit()
    conn.close()
    # no bars today for one stored ETF: it cannot be restated, and (an ETF) it moves nobody's rank
    gone = {k: v for k, v in series.items() if k != "XLK"}
    r = _restate(gone, max_drift_share=0.02)
    note = r["note"]
    assert r["ok"] is True, note
    assert note["drift"] == 1 and note["hard"] == 4, note          # S010 drift; S020 + XLK x3 sessions hard
    assert note["mismatches"] == {"window": 3, "guard": 0, "values": 1}
    assert note["hard"] <= 0.02 * note["checked"]
    rows = _all(tmp_db)
    assert all(x["m6"] is None and x["m9"] is None and x["m12"] is None for x in rows if x["ticker"] == "XLK"),         "a name that cannot be restated is NULL, never an old-meaning number"
    assert note["rows_nulled"] == 3
    got = {(x["session"], x["ticker"]): (x["m6"], x["m9"], x["m12"]) for x in rows if x["ticker"] != "XLK"}
    assert got == {k: v for k, v in want.items() if k[1] != "XLK"}


def test_restate_over_the_allowance_writes_nothing(tmp_db):
    series = _names()
    _seed_old(tmp_db, series)
    gone = {k: v for k, v in series.items() if k != "XLK"}
    before = _all(tmp_db)
    r = _restate(gone, max_drift_share=0.0)
    assert r["ok"] is False and r["note"]["reason"] == "would_change_other_values"
    assert _all(tmp_db) == before


def test_restate_rejects_bad_arguments_and_an_absent_table(tmp_db):
    assert _restate(_small(), max_drift_share=0.5)["note"]["reason"] == "max_drift_share must be 0 to 0.05"
    r = rh.restate_ranks(0)
    assert r["ok"] is False and "days must be" in r["note"]["reason"]
    empty = _restate(_small())
    assert empty["ok"] is True and empty["note"]["reason"] == "nothing_to_do"


def test_the_cli_reaches_the_restate_and_refuses_a_conflicting_mode(tmp_db, capsys, monkeypatch):
    seen = {}

    def fake(days, **kw):
        seen.update(days=days, **kw)
        return {"ok": True, "dry_run": kw["dry_run"], "duration_ms": 1.0,
                "note": {"sessions": 3, "sessions_stored": 3, "sessions_restated_before": 0, "sessions_todo": 3,
                         "sessions_done": 3, "rows_written": 9, "rows_nulled": 0, "checked": 9, "drift": 0,
                         "hard": 0, "mismatches": {"window": 0, "guard": 0, "values": 0}}}
    monkeypatch.setattr(rh, "restate_ranks", fake)
    assert rh.main(["--backfill-days", "252", "--restate-ranks", "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert "rs_history restate m6/m9/m12 (dry run)" in out and "receipt " in out
    assert seen["days"] == 252 and seen["dry_run"] is True and seen["max_drift_share"] == rh.RESTATE_DRIFT_SHARE
    assert json.loads(out.splitlines()[-1].split("receipt ", 1)[1])["ok"] is True
    assert rh.main(["--backfill-days", "252", "--restate-ranks", "--fill-column", "m9"]) == 2
    assert rh.main(["--backfill-days", "252", "--restate-ranks", "--max-drift-share", "0.9"]) == 2
