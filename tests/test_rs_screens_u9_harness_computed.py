"""RS screens unit U9: the Leader score test with each formation date's ratings
COMPUTED from bars in memory (``--ratings computed``, the default).

Why the mode exists: the stored rating history holds about a year, and five more years
of it would be about 12 million rows on a volume with no backup. A rating is a pure
function of daily bars the store already holds, so the harness computes it.

What is held here:
  * NO SECOND RATING: on a store the REAL nightly job rated, the computed rating and
    score equal the stored ones for every symbol on every common session, and the
    window builder equals the rating job's own;
  * POINT IN TIME: a bar after a session cannot change that session's ratings, and
    nothing in the holdout can change a development result;
  * the holdout is the newest 252 sessions of the BARS calendar, locked the same way;
  * the output carries the stored-against-computed check and the verdict says so
    BEFORE pass or fail when they disagree;
  * read-only: every database (now up to three) is opened ``mode=ro`` and only
    ``--out`` is written.
"""
from __future__ import annotations

import builtins
import hashlib
import json
import random
import shutil
import sqlite3

import pytest

from api.services import cap_universe, industry_map
from api.services.rs_leader_test import __main__ as cli
from api.services.rs_leader_test import data, ratings as rt, run, spec
from api.services.screener import rs_history as rh
from tests import rs_leader_test_fixture as fx

# ───────────────────────── a store the real nightly job rated ───────────────

NB = 600                                 # sessions of bars in the rated store
STOCKS, OTHERS = 60, 60                  # with a row today / in the bars store only
SPLIT_AT, STALE_AT, RELIST_AT, YOUNG_AT = 450, 400, 400, 560
#: The sessions the nightly job is run for: every fifth from 255 (the harness's own
#: formation grid), one that is not on the grid inside development, and the newest.
RATED = sorted({*range(255, NB, 5), 346, NB - 1})
DEV_END = NB - spec.HOLDOUT_SESSIONS - 1          # 347: the last development session


def _walk(seed, drift, start, n=NB):
    rng = random.Random(seed)
    out = [start]
    for _ in range(n - 1):
        out.append(out[-1] * (1.0 + drift + rng.gauss(0, 0.015)))
    return out


def _rows(closes, first=0, volume=3_000_000):
    return fx.bars(closes, spread=0.02, volume=volume, first=first)


def _iso(k):
    return fx.DAYS[k].isoformat()


def _sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture(scope="module")
def rated(tmp_path_factory):
    """bars.db, screener.db and industry_map.db, the ratings written by
    ``rs_history.nightly_job`` itself for every session in :data:`RATED`."""
    d = tmp_path_factory.mktemp("rated")
    bars_db, screener_db, industry_db = d / "bars.db", d / "screener.db", d / "industry_map.db"
    liquid_etf = sorted(cap_universe.etf_symbols() - {"SPY", "QQQ", "IWM", "RSP"})[0]
    series = {"SPY": _rows(fx.closes(fx.BENCH_DRIFT, 300.0, NB), volume=50_000_000),
              "QQQ": _rows(_walk(901, 0.0004, 400.0)),
              "EFA1": _rows(_walk(902, 0.0002, 60.0)),          # an ETF by today's row
              "EIM1": _rows(_walk(903, 0.0009, 45.0)),          # an ETF by the industry map only
              liquid_etf: _rows(_walk(904, 0.0006, 90.0)),      # an ETF by the liquid-ETF list
              "$SPX": _rows(_walk(905, 0.0003, 4000.0)),        # not a rankable symbol
              "X:BTCUSD": _rows(_walk(906, 0.001, 30000.0)),    # not a rankable symbol
              "SPX": _rows(_walk(907, 0.0003, 4000.0))}         # an index, by name
    classes = {"SPY": (1, "Exchange Traded Fund", "Funds"), "EFA1": (1, "Exchange Traded Fund", "Funds"),
               # today's row calls this one a stock; the industry map knows it is a fund
               "EIM1": (0, "Industry 0", "Sector 0")}
    for i in range(STOCKS):
        series[f"S{i:02d}"] = _rows(_walk(i, 0.0002 + 0.00003 * i, 30.0 + i))
        classes[f"S{i:02d}"] = (0, f"Industry {i % 4}", f"Sector {i % 2}")
    for i in range(OTHERS):
        series[f"U{i:02d}"] = _rows(_walk(200 + i, 0.0001 + 0.00002 * i, 20.0 + i))
    series["YOUNG"] = _rows(_walk(301, 0.002, 25.0, NB - YOUNG_AT), first=YOUNG_AT)
    series["STALE"] = _rows(_walk(302, 0.001, 40.0, STALE_AT + 1))
    series["RECYC"] = (_rows(_walk(303, 0.0, 5.0, 201))                     # an earlier security ...
                       + _rows(_walk(304, 0.001, 80.0, NB - RELIST_AT), first=RELIST_AT))   # ... then this one
    split = _walk(305, 0.0008, 120.0)
    series["SPLT"] = _rows([c if k < SPLIT_AT else c / 2.0 for k, c in enumerate(split)])
    series["ADJD"] = _rows(_walk(306, 0.0007, 70.0))
    series["UNKN"] = _rows(_walk(307, 0.0005, 33.0))
    hole = _rows(_walk(308, 0.0006, 55.0))
    for k in (500, 510):
        ts, o, h, l, _c, v = hole[k]
        hole[k] = (ts, o, h, l, 0.0, v)
    series["HOLE"] = hole
    memo = {t: [] for t in series if t != "UNKN"}
    memo["SPLT"] = [(_iso(SPLIT_AT), 2.0)]         # declared and still in the closes
    memo["ADJD"] = [(_iso(300), 3.0)]              # declared and already adjusted

    with sqlite3.connect(str(bars_db)) as conn:
        conn.execute("CREATE TABLE ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, ts INTEGER NOT NULL, "
                     "o REAL, h REAL, l REAL, c REAL, v INTEGER, PRIMARY KEY (ticker, tf, ts)) WITHOUT ROWID")
        for t, rows in series.items():
            conn.executemany("INSERT INTO ohlcv VALUES (?, 'D', ?, ?, ?, ?, ?, ?)", [(t, *r) for r in rows])
        # a symbol with intraday bars only is in the store and has no daily series
        conn.execute("INSERT INTO ohlcv VALUES ('INTRA', '5', 1700000000, 1, 1, 1, 1, 1)")
        conn.commit()
    with sqlite3.connect(str(industry_db)) as conn:
        conn.execute("CREATE TABLE industry_map (ticker TEXT PRIMARY KEY, sector TEXT, industry TEXT, "
                     "source TEXT, fetched_at INTEGER NOT NULL)")
        conn.executemany("INSERT INTO industry_map VALUES (?, ?, ?, 'test', 1)",
                         [("EIM1", "Financial", "Exchange Traded Fund"), ("S00", "Technology", "Software")])
        conn.commit()
    with sqlite3.connect(str(screener_db)) as conn:
        conn.execute("CREATE TABLE screener_rows (ticker TEXT PRIMARY KEY, is_etf INTEGER, "
                     "industry TEXT, sector TEXT)")
        conn.executemany("INSERT INTO screener_rows VALUES (?, ?, ?, ?)", [(t, *c) for t, c in classes.items()])
        conn.execute("CREATE TABLE declared_split_lists (ticker TEXT PRIMARY KEY, splits TEXT NOT NULL, "
                     "fetched_at REAL NOT NULL)")
        conn.executemany("INSERT INTO declared_split_lists VALUES (?, ?, 1.0)",
                         [(t, json.dumps(v)) for t, v in memo.items()])
        conn.commit()

    def reader(ticker, n, to_key):
        return [r for r in series.get(ticker, ()) if r[0] <= to_key][-n:]

    mp = pytest.MonkeyPatch()
    try:
        mp.setenv("SCREENER_DB_PATH", str(screener_db))
        mp.setattr(industry_map, "_DB_PATH", str(industry_db))
        mp.setattr(industry_map, "_INIT_DONE", False)
        # the rating job's own population and its own ETF list
        universe = rh.ranking_universe(lister=lambda: sorted(series),
                                       last_daily_ts=lambda t: series[t][-1][0])
        etfs = rh.default_etf_tickers()
        for k in RATED:
            receipt = rh.nightly_job(_iso(k), universe=universe, etf_tickers=etfs, bars_reader=reader,
                                     fast_map={}, splits_reader=memo.get, data_dir=str(d))
            assert receipt["ok"], receipt
    finally:
        mp.undo()
    with sqlite3.connect(str(screener_db)) as conn:
        conn.execute("PRAGMA journal_mode=DELETE")      # the nightly's connection left it in WAL
    stored = {}
    with sqlite3.connect(str(screener_db)) as conn:
        for s, t, ibd, score in conn.execute("SELECT session, ticker, ibd, score FROM rs_rating_history"):
            stored.setdefault(s, {})[t] = (ibd, score)
    return {"bars": bars_db, "screener": screener_db, "industry": industry_db, "etfs": set(etfs),
            "universe": set(universe), "stored": stored, "liquid_etf": liquid_etf, "dir": d}


def _series(store, etfs, *, with_etfs=True):
    """The harness's own read: every rankable symbol's closes, kept once."""
    declared = store.declared_splits()
    series = {}
    for t in store.tickers():
        if not rh.rankable_symbol(t) or (t in etfs and not with_etfs):
            continue
        rows = store.daily_rows(t, 0)
        if rows:
            rt.add_symbol(series, t, rows, declared.get(t))
    return series


@pytest.fixture(scope="module")
def rated_series(rated):
    with data.Store(rated["bars"], rated["screener"], ratings="computed", unlock_holdout=True,
                    industry_db=rated["industry"]) as store:
        etfs, sources = store.etf_tickers()
        return {"all": _series(store, etfs), "stocks": _series(store, etfs, with_etfs=False),
                "etfs": etfs, "sources": sources}


# ───────────────────────── no second rating ─────────────────────────────────

def test_the_fixture_was_rated_by_the_real_job_and_is_not_trivial(rated):
    stored = rated["stored"]
    assert sorted(stored) == [_iso(k) for k in RATED] and len(RATED) == 71
    newest = stored[_iso(NB - 1)]
    assert len({v[0] for v in newest.values() if v[0] is not None}) > 60, "the ratings must vary"
    assert {"$SPX", "X:BTCUSD", "SPX", "INTRA"}.isdisjoint(rated["universe"])
    assert not ({"$SPX", "X:BTCUSD", "SPX", "INTRA", "STALE", "SPLT"} & set(newest))
    assert "SPLT" in stored[_iso(445)] and "SPLT" not in stored[_iso(450)], "the split guard bit"
    assert "STALE" in stored[_iso(400)] and "STALE" not in stored[_iso(410)]
    assert newest["YOUNG"] == (None, None), "40 closes: a row, and no rating yet"
    assert stored[_iso(RELIST_AT + 5)]["RECYC"] == (None, None), "six closes of the new listing"
    assert stored[_iso(NB - 1)]["RECYC"][0] is not None
    assert {"SPY", "QQQ", "EFA1", "EIM1", rated["liquid_etf"]} <= rated["etfs"]
    assert all(newest[t][0] is not None for t in ("EIM1", "EFA1", "ADJD", "UNKN", "HOLE"))


def test_the_etf_list_is_the_rating_jobs_own_four_sources(rated, rated_series, monkeypatch):
    assert rated_series["etfs"] == rated["etfs"], "the harness and the rating job disagree on what is an ETF"
    assert rated_series["sources"] == {"industry_map": 1, "benchmarks": 15, "liquid_etf_list": 100,
                                       "screener_rows": 2}
    # the same call the nightly makes, on the same three stores
    monkeypatch.setenv("SCREENER_DB_PATH", str(rated["screener"]))
    monkeypatch.setattr(industry_map, "_DB_PATH", str(rated["industry"]))
    assert rated_series["etfs"] == rh.default_etf_tickers()
    with data.Store(rated["bars"], rated["screener"], ratings="computed") as store:
        etfs, sources = store.etf_tickers()
    assert sources["industry_map"] is None and "EIM1" not in etfs, "without --industry-db it is not known"
    assert etfs == rated["etfs"] - {"EIM1"}


def test_computed_ratings_and_scores_equal_the_stored_ones_on_every_session(rated, rated_series):
    """Every symbol, every stored session, rating AND unrounded score: 71 sessions of
    about 130 symbols, among them a recycled symbol, a split the guard refuses, a
    declared split already adjusted, a stale name, a young one and two bad closes."""
    compared = 0
    for session, stored in rated["stored"].items():
        got = rt.rate(rated_series["all"], rated_series["etfs"], session)
        assert set(got) == set(stored), (session, set(got) ^ set(stored))
        for t, (ibd, score) in stored.items():
            assert got[t][0] == ibd, (session, t, got[t], (ibd, score))
            assert got[t][1] == score, (session, t)
            compared += 1
    assert compared > 8500


def test_leaving_the_etfs_out_changes_no_stocks_rating(rated, rated_series):
    """The harness keeps no ETF's closes. An ETF is rated off the stocks' distribution
    and never moves it, so every stock's rating and score are the stored ones still."""
    assert set(rated_series["all"]) - set(rated_series["stocks"]) == {
        "SPY", "QQQ", "EFA1", "EIM1", rated["liquid_etf"]}
    for session in (_iso(255), _iso(346), _iso(450), _iso(NB - 1)):
        got = rt.rate(rated_series["stocks"], rated_series["etfs"], session)
        stored = {t: v for t, v in rated["stored"][session].items() if t not in rated["etfs"]}
        assert got == stored, session


def test_the_window_builder_is_the_rating_jobs_own(rated, rated_series, monkeypatch):
    """`ratings.windows` against `rs_history._universe_windows`, session by session:
    the same windows and the same suspects. And the saving is real: the split detector
    is asked only for a symbol with a declared split inside the closes it judges."""
    etfs = rated_series["etfs"]
    theirs_in = {t: (ts, closes, declared) for t, (ts, closes, declared, _d) in rated_series["all"].items()}
    asked = []
    real = rh.window_split_suspect

    def _spy(ts_win, closes_win, declared):
        asked.append(declared)
        return real(ts_win, closes_win, declared)
    for k in (255, 300, 346, 449, 450, 455, 599):
        want, want_suspects, _n = rh._universe_windows(theirs_in, etfs, _iso(k))
        monkeypatch.setattr(rh, "window_split_suspect", _spy)
        asked.clear()
        got, suspects = rt.windows(rated_series["all"], data.ymd(_iso(k)))
        monkeypatch.setattr(rh, "window_split_suspect", real)
        assert suspects == want_suspects, k
        assert {t: list(v) for t, v in got.items()} == {t: list(v) for t, v in want.items()}, k
        assert len(asked) <= 2, "the detector was asked about a symbol with no split in reach"
        assert suspects == ({"SPLT"} if k >= SPLIT_AT else set()), k
    # ADJD's split (session 300) is inside its window at 346: asked, and found adjusted
    asked.clear()
    monkeypatch.setattr(rh, "window_split_suspect", _spy)
    rt.windows(rated_series["all"], data.ymd(_iso(346)))
    assert asked == [[(_iso(300), 3.0)]]


def test_a_bar_after_the_session_cannot_change_its_ratings(rated_series):
    """Multiply every close after session 400 by a different number for each symbol and
    append nothing else: the ratings of session 400 and of every earlier session are
    the same to the last digit. The session after it is not (the control)."""
    from array import array
    line = data.ymd(_iso(400))
    ruined = {}
    for n, (t, (ts, closes, declared, days)) in enumerate(rated_series["stocks"].items()):
        factor = 0.2 + (n % 9)
        ruined[t] = (ts, array("d", [c if d <= line else c * factor for d, c in zip(ts, closes)]),
                     declared, days)
    etfs = rated_series["etfs"]
    for k in (255, 346, 399, 400):
        assert rt.rate(ruined, etfs, _iso(k)) == rt.rate(rated_series["stocks"], etfs, _iso(k)), k
    assert rt.rate(ruined, etfs, _iso(401)) != rt.rate(rated_series["stocks"], etfs, _iso(401))
    # and a bar AT the session is read: move one stock's close on the day itself
    moved = dict(rated_series["stocks"])
    ts, closes, declared, days = moved["S10"]
    bumped = array("d", closes)
    bumped[list(ts).index(line)] *= 1.5
    moved["S10"] = (ts, bumped, declared, days)
    assert rt.rate(moved, etfs, _iso(400))["S10"] != rt.rate(rated_series["stocks"], etfs, _iso(400))["S10"]


# ───────────────────────── the cross-check the output carries ───────────────

def _first_criterion(lines):
    return next(n for n, l in enumerate(lines) if l.split()[0] in ("PASS", "FAIL"))


@pytest.fixture(scope="module")
def rated_unlocked(rated):
    return run.run_test(rated["bars"], rated["screener"], industry_db=rated["industry"], unlock_holdout=True)


def test_every_common_session_agrees_and_the_output_says_so(rated, rated_unlocked):
    r = rated_unlocked
    assert r["ratings"]["mode"] == "computed" and "four sources" in r["ratings"]["etf_list"]
    # the universe: 60 stocks with a row today. SPY and EFA1 are funds by that row, and
    # EIM1, which the row calls a stock, is one by the industry map: never in the universe
    assert r["counts"]["symbols_classified"] == 63 and r["counts"]["symbols_not_a_stock_or_unknown"] == 3
    assert r["counts"]["symbols_not_rankable"] == 3          # $SPX, X:BTCUSD and the index SPX
    # every symbol of the bars store is walked once; INTRA has no daily bar and is no candidate
    assert r["counts"]["symbols_in_bars_store"] == 136
    assert r["counts"]["symbols_rating_candidates"] == 136 - 3 - 1 - 5
    assert r["counts"]["symbols_etf_not_rated"] == 5
    assert "as held today" in r["ratings"]["held_today"]
    check = r["ratings_cross_check"]
    # every stored session on the formation grid, and the newest one whatever it is
    grid = [_iso(k) for k in RATED if k % 5 == 0]
    assert [c["session"] for c in check["sessions"]] == sorted(grid + [_iso(NB - 1)])
    assert check["sessions_compared"] == len(grid) + 1 == 70
    assert (check["stored_sessions"], check["stored_sessions_readable"]) == (71, 71)
    for c in check["sessions"]:
        assert c["equal_share"] == 1.0 and c["equal"] == c["stocks"] > 100, c["session"]
        assert (c["only_stored"], c["only_computed"], c["largest"]) == (0, 0, []), c["session"]
    assert check["newest"]["session"] == _iso(NB - 1) and check["agrees"] is True
    assert check["overall_equal_share"] == 1.0 and check["min_agreement"] == 0.99
    lines = r["verdict_lines"]
    said = [n for n, l in enumerate(lines) if l.startswith("Ratings cross-check: 100.0% of ")]
    assert len(said) == 1 and said[0] < _first_criterion(lines)
    assert lines[said[0]].endswith(f"stocks have the stored rating on {_iso(NB - 1)} (70 sessions compared).")
    assert not any(l.startswith("WARNING") for l in lines)


def test_locked_only_stored_sessions_before_the_holdout_are_compared(rated):
    """The newest stored session a locked run may read is session 346, which is not a
    formation date: it is compared all the same, and it is the one the verdict quotes."""
    r = run.run_test(rated["bars"], rated["screener"], industry_db=rated["industry"])
    check = r["ratings_cross_check"]
    assert r["sessions"]["last_date_read"] == _iso(DEV_END)
    assert [c["session"] for c in check["sessions"]] == [_iso(k) for k in RATED if k <= DEV_END]
    assert check["newest"]["session"] == _iso(346) and check["agrees"] is True
    assert (check["stored_sessions"], check["stored_sessions_readable"]) == (71, 20)
    assert any(l.endswith(f"on {_iso(346)} (20 sessions compared).") for l in r["verdict_lines"])


def _ruin_ratings(rated, tmp_path, session, n):
    """Move ``n`` stocks' stored ratings on one session: the first four by 7 points,
    the rest by 3 (toward the middle, so every rating stays between 1 and 99)."""
    db = shutil.copy(rated["screener"], tmp_path / "screener.db")
    with sqlite3.connect(str(db)) as conn:
        done = 0
        for i in range(n):
            by = 7 if i < 4 else 3
            done += conn.execute(
                "UPDATE rs_rating_history SET ibd = CASE WHEN ibd > 50 THEN ibd - ? ELSE ibd + ? END "
                "WHERE session = ? AND ticker = ?", (by, by, session, f"S{i:02d}")).rowcount
        conn.commit()
    assert done == n
    return db


def test_a_disagreement_is_said_before_pass_or_fail(rated, tmp_path):
    """Twelve stocks' stored ratings on the newest readable session are off what the bars
    give (four by 7 points, eight by 3): about 90% agree, under the 99% bar. The ten
    largest differences are named, largest first."""
    db = _ruin_ratings(rated, tmp_path, _iso(346), 12)
    r = run.run_test(rated["bars"], db, industry_db=rated["industry"])
    check = r["ratings_cross_check"]
    newest = check["newest"]
    assert check["agrees"] is False and newest["session"] == _iso(346)
    assert newest["stocks"] - newest["equal"] == 12 and newest["equal_share"] < 0.93
    assert len(newest["largest"]) == 10 == rt.EXAMPLES
    assert [abs(d["stored"] - d["computed"]) for d in newest["largest"]] == [7, 7, 7, 7, 3, 3, 3, 3, 3, 3]
    assert [d["ticker"] for d in newest["largest"]] == [f"S{i:02d}" for i in range(10)]
    lines = r["verdict_lines"]
    warn = [n for n, l in enumerate(lines) if l.startswith("WARNING  Ratings cross-check: only ")]
    assert len(warn) == 1 and warn[0] < _first_criterion(lines), "it must be read before PASS or FAIL"
    text = lines[warn[0]]
    assert f"have the stored rating on {_iso(346)} (needs 99%)" in text
    assert "S00" in text and "stored" in text and "computed" in text
    # the other sessions still agree, and the whole-run share says how much is off
    assert sum(1 for c in check["sessions"] if c["equal_share"] == 1.0) == 19
    assert 0.99 < check["overall_equal_share"] < 1.0


def test_the_bar_is_99_percent_of_the_stocks_on_that_session(rated, tmp_path):
    """One stock of about 126 off is 99.2% (agrees); two are 98.4% (does not)."""
    one = run.run_test(rated["bars"], _ruin_ratings(rated, tmp_path, _iso(346), 1),
                       industry_db=rated["industry"], from_date=_iso(330))["ratings_cross_check"]
    assert one["newest"]["stocks"] - one["newest"]["equal"] == 1
    assert 0.99 <= one["newest"]["equal_share"] < 1.0 and one["agrees"] is True
    two = run.run_test(rated["bars"], _ruin_ratings(rated, tmp_path, _iso(346), 2),
                       industry_db=rated["industry"], from_date=_iso(330))["ratings_cross_check"]
    assert two["newest"]["equal_share"] < 0.99 and two["agrees"] is False


def test_a_stock_rated_one_way_only_is_counted_apart(rated_series, rated):
    session = _iso(346)
    stored = dict(rated["stored"][session])
    computed = rt.rate(rated_series["stocks"], rated_series["etfs"], session)
    del stored["S05"]
    stored["GONE"] = (55, 1.0)
    stored["EIM1"] = (1, 0.1)                        # an ETF: never part of the comparison
    c = rt.compare(session, stored, computed, rated_series["etfs"])
    assert (c["only_stored"], c["only_computed"]) == (1, 1) and c["equal_share"] == 1.0
    assert rt.compare(session, {}, {}, set()) == {
        "session": session, "stocks": 0, "equal": 0, "equal_share": None, "only_stored": 0,
        "only_computed": 0, "largest": []}


def test_with_no_stored_ratings_the_check_is_not_done_and_that_is_said(rated, tmp_path):
    db = shutil.copy(rated["screener"], tmp_path / "screener.db")
    with sqlite3.connect(str(db)) as conn:
        conn.execute("DROP TABLE rs_rating_history")
        conn.commit()
    r = run.run_test(rated["bars"], db, industry_db=rated["industry"], from_date=_iso(330))
    check = r["ratings_cross_check"]
    assert check["sessions_compared"] == 0 and check["newest"] is None and check["agrees"] is None
    assert check["note"] == "this database holds no stored ratings"
    lines = r["verdict_lines"]
    said = [n for n, l in enumerate(lines) if l.startswith("Ratings cross-check: NOT DONE.")]
    assert len(said) == 1 and said[0] < _first_criterion(lines)
    assert r["development"]["formation_dates"] == 4, "the test itself ran on computed ratings"


def test_without_the_industry_map_the_output_says_the_etf_list_is_short(rated):
    r = run.run_test(rated["bars"], rated["screener"], from_date=_iso(330))
    assert r["ratings"]["etf_sources"]["industry_map"] is None
    assert r["ratings"]["etf_list"].startswith("WITHOUT the industry map (--industry-db was not given)")
    assert r["ratings"]["etfs_known"] == len(rated["etfs"]) - 1


# ───────────────────────── a market whose answer is known ───────────────────

CAL = fx.N                                             # every bar date is a session
C_DEV_END = CAL - spec.HOLDOUT_SESSIONS - 1            # 1427
C_FIRST = spec.MIN_LISTING_BARS - 1                    # 252: the first session a date may use
C_DEV_K = [k for k in range(C_FIRST, C_DEV_END + 1) if k % 5 == 0]
C_DEV_K_21 = [k for k in C_DEV_K if k + 21 <= C_DEV_END]
C_HOLD_K = [k for k in range(C_DEV_END + 1, CAL) if k % 5 == 0]


@pytest.fixture(scope="module")
def market(tmp_path_factory):
    """The ordered market with 240 slow symbols in the bars store, so that every leader's
    rating COMPUTED from the bars is 80 or more."""
    return fx.build(tmp_path_factory.mktemp("computed"), "ordered", fillers=240)


@pytest.fixture(scope="module")
def market_run(market):
    return run.run_test(*market)


@pytest.fixture(scope="module")
def market_unlocked(market):
    return run.run_test(*market, unlock_holdout=True)


def test_the_default_is_computed_and_the_ordered_market_passes(market_run):
    r = market_run
    assert r["ratings"]["mode"] == "computed" and r["verdict"] == "PASS"
    dev = r["development"]
    assert [d["date"] for d in dev["dates"]] == [_iso(k) for k in C_DEV_K] and len(C_DEV_K) == 235
    assert all((d["floor"], d["qualifiers"], d["scored"]) == (52, 40, 40) for d in dev["dates"])
    by_date = dev["primary"]["by_date"]
    assert [p["date"] for p in by_date] == [_iso(k) for k in C_DEV_K_21]
    for p, k in zip(by_date, C_DEV_K_21):
        assert p["spread_pct"] == pytest.approx(fx.expected_spread_at(k), abs=1e-9), k
    c = r["judgement"]["criteria"]
    assert c["2_positive_in_3_of_4_years"]["positive"] == 4 and c["3_quintiles_in_order"]["spearman"] == 1.0
    counts = r["counts"]
    assert counts["symbols_in_bars_store"] == 57 + 240 + 1         # SPY, 56 others, the fillers, NOLIST
    assert counts["symbols_etf_not_rated"] == 2                     # SPY and ETFX
    assert counts["symbols_rating_candidates"] == 296
    assert counts["symbols_no_bars"] == 1 and counts["symbols_liquid_on_a_date"] == 52


def test_this_markets_stored_ratings_are_not_what_the_bars_give_and_the_verdict_says_so(market_run):
    """The fixture stores a flat 90 for every leader. The bars rank them from the low 80s
    to 99, so the cross-check must warn: the control for the agreeing store above."""
    check = market_run["ratings_cross_check"]
    assert check["agrees"] is False and check["newest"]["session"] == _iso(C_DEV_END)
    lines = market_run["verdict_lines"]
    assert lines[3].startswith("WARNING  Ratings cross-check: only ") and lines[4].startswith("PASS  1.")
    assert lines[2] == ("Ratings: computed from daily bars for each formation date, "
                        "with the rating job's own functions.")


def test_the_holdout_is_the_newest_252_sessions_of_the_bars_calendar(market, market_run):
    s, plan = market_run["sessions"], market_run["plan"]
    assert s["calendar"] == {"count": CAL - C_FIRST, "first": _iso(C_FIRST), "last": _iso(CAL - 1)}
    assert s["development"] == {"count": C_DEV_END - C_FIRST + 1, "first": _iso(C_FIRST), "last": _iso(C_DEV_END)}
    assert s["holdout"] == {"count": 252, "first": _iso(C_DEV_END + 1), "last": _iso(CAL - 1), "read": False}
    assert s["last_date_read"] == _iso(C_DEV_END) and market_run["holdout"] is None
    assert plan["calendar"]["count"] == CAL and plan["formation_dates"] == {"development": 235, "holdout": 0}
    assert plan["independent_blocks"] == {"development": 47, "holdout": 0}
    assert run.plan_lines(plan) == [
        "Ratings: computed from daily bars for each formation date.",
        f"Development sessions: 1,176 ({_iso(C_FIRST)} to {_iso(C_DEV_END)}).",
        f"Holdout: the newest 252 sessions ({_iso(C_DEV_END + 1)} to {_iso(CAL - 1)}), not read.",
        f"Formation dates: 235 in development ({_iso(255)} to {_iso(1425)}), "
        "spanning 47 non-overlapping 21-session windows."]
    with data.Store(*market, ratings="computed") as store:
        assert (store.first, store.cutoff, len(store.holdout)) == (C_FIRST, _iso(C_DEV_END), 252)
        assert store.daily_rows("L00", 0)[-1][0] == data.ymd(_iso(C_DEV_END))
        assert len(store.daily_rows("L00", 0)) == C_DEV_END + 1
        for k in (C_DEV_END + 1, CAL - 1):
            with pytest.raises(data.HoldoutLocked):
                store.ratings(_iso(k))
        assert store.readable_stored_sessions()[-1] == _iso(C_DEV_END)
    with data.Store(*market, ratings="computed", unlock_holdout=True) as store:
        assert store.cutoff == _iso(CAL - 1) and len(store.daily_rows("L00", 0)) == CAL


def test_unlocked_the_holdout_is_read_and_development_is_the_same(market_run, market_unlocked):
    r = market_unlocked
    assert r["sessions"]["holdout"]["read"] is True and r["verdict"] == "PASS"
    assert [d["date"] for d in r["holdout"]["dates"]] == [_iso(k) for k in C_HOLD_K]
    hold_21 = [k for k in C_HOLD_K if k + 21 <= CAL - 1]
    assert r["holdout"]["primary"]["top_minus_bottom_pct"] == pytest.approx(
        sum(fx.expected_spread_at(k) for k in hold_21) / len(hold_21), abs=1e-9)
    assert r["judgement"]["criteria"]["4_same_sign_in_holdout"]["met"] is True
    assert r["plan"]["formation_dates"] == {"development": 235, "holdout": len(C_HOLD_K)}
    assert run.plan_lines(r["plan"])[2].endswith("READ in this run.")
    # the embargo: nothing of the holdout reaches a development number
    assert r["development"] == market_run["development"]
    for key in ("1_spread_positive_interval_off_zero", "2_positive_in_3_of_4_years", "3_quintiles_in_order"):
        assert r["judgement"]["criteria"][key] == market_run["judgement"]["criteria"][key]


FROM = _iso(1000)


def _ruined(market, tmp_path, *, bars_after, tickers="%"):
    bars_db, screener_db = (shutil.copy(p, tmp_path / p.name) for p in market)
    with sqlite3.connect(str(bars_db)) as conn:
        n = conn.execute("UPDATE ohlcv SET o = o * 3, h = h * 3, l = l * 0.2, c = c * 0.4, v = 1 "
                         "WHERE ts > ? AND ticker LIKE ?", (data.ymd(bars_after), tickers)).rowcount
        conn.commit()
    assert n > 1000
    return bars_db, screener_db


def test_locked_nothing_after_the_last_development_session_is_read(market, tmp_path):
    """Ruin every bar of every symbol after the cutoff, and every stored rating after it:
    the locked run is the same to the last digit. (Run from session 1000 to keep it short.)"""
    clean = run.run_test(*market, from_date=FROM)
    bars_db, screener_db = _ruined(market, tmp_path, bars_after=_iso(C_DEV_END))
    with sqlite3.connect(str(screener_db)) as conn:
        conn.execute("UPDATE rs_rating_history SET ibd = 1 WHERE session > ?", (_iso(C_DEV_END),))
        conn.commit()
    ruined = run.run_test(bars_db, screener_db, from_date=FROM)
    strip = lambda r: {k: v for k, v in r.items() if k != "generated_at"}      # noqa: E731
    assert strip(ruined) == strip(clean)
    assert clean["development"]["formation_dates"] == len([k for k in C_DEV_K if k >= 1000]) == 86
    # unlocked, the ruin is seen: the control
    assert (run.run_test(bars_db, screener_db, from_date=FROM, unlock_holdout=True)["holdout"]
            != run.run_test(*market, from_date=FROM, unlock_holdout=True)["holdout"])


def test_a_bar_after_a_dates_window_cannot_change_that_date(market, tmp_path):
    """Ruin the ten fastest leaders' bars after session 1200. Every formation date whose
    21-session window had ended by then, and what every date up to then held, is the
    same; later dates are not."""
    clean = run.run_test(*market, from_date=FROM)["development"]
    ruined = run.run_test(*_ruined(market, tmp_path, bars_after=_iso(1200), tickers="L3%"),
                          from_date=FROM)["development"]
    by_c = {p["date"]: p["spread_pct"] for p in clean["primary"]["by_date"]}
    by_r = {p["date"]: p["spread_pct"] for p in ruined["primary"]["by_date"]}
    settled = [_iso(k) for k in C_DEV_K if 1000 <= k and k + 21 <= 1200]
    assert len(settled) == 36 and all(by_r[d] == by_c[d] for d in settled)
    held_r = {d["date"]: d for d in ruined["dates"]}
    for d in clean["dates"]:
        if d["date"] <= _iso(1200):
            assert {k: held_r[d["date"]][k] for k in ("floor", "qualifiers", "scored")} == \
                   {k: d[k] for k in ("floor", "qualifiers", "scored")}
    later = [_iso(k) for k in C_DEV_K_21 if k > 1200]
    assert sum(1 for d in later if by_r.get(d) != by_c[d]) > 30


def test_from_date_bounds_the_dates_and_does_not_move_the_grid(market, market_run):
    """From 2023-07-04 (not a session on the grid): the first formation date is the next
    grid date, and every date is one the unbounded run also formed, with the same numbers."""
    day = "2023-07-04"
    assert day not in {d["date"] for d in market_run["development"]["dates"]}
    r = run.run_test(*market, from_date=day)
    dates = [d["date"] for d in r["development"]["dates"]]
    full = {d["date"]: d for d in market_run["development"]["dates"]}
    assert dates == [d for d in full if d >= day] and dates[0] > day and 60 < len(dates) < 80
    assert all(d == full[d["date"]] for d in r["development"]["dates"])
    assert r["plan"]["from_date"] == day and r["sessions"]["development"]["first"] >= day
    assert r["sessions"]["holdout"] == market_run["sessions"]["holdout"], "the holdout is the calendar's"
    # a date past the last development session leaves nothing to form
    late = run.run_test(*market, from_date=_iso(CAL - 5))
    assert late["development"]["formation_dates"] == 0 and late["verdict"] == "FAIL"
    assert late["sessions"]["development"]["count"] == 0
    # stored mode takes the bound too, on its own calendar
    stored = run.run_test(*market, ratings="stored", from_date=day)
    assert stored["development"]["dates"][0]["date"] > day and stored["ratings"]["mode"] == "stored"


# ───────────────────────── the command line, read-only ──────────────────────

def test_the_command_line_defaults_to_computed_and_prints_the_plan_first(market, tmp_path, capsys):
    args = cli._parser().parse_args(["--bars-db", "b", "--screener-db", "s", "--out", "o"])
    assert (args.ratings, args.from_date, args.industry_db) == ("computed", None, None)
    out = tmp_path / "r.json"
    code = cli.main(["--bars-db", str(market[0]), "--screener-db", str(market[1]), "--out", str(out),
                     "--from-date", "2023-07-04"])
    printed = capsys.readouterr().out.strip().splitlines()
    result = json.loads(out.read_text(encoding="utf-8"))
    assert result["ratings"]["mode"] == "computed" and result["plan"]["from_date"] == "2023-07-04"
    assert printed[:4] == run.plan_lines(result["plan"])
    assert printed[0] == "Ratings: computed from daily bars for each formation date."
    assert "non-overlapping 21-session windows" in printed[3] and "Formation dates: " in printed[3]
    assert printed[4:] == result["verdict_lines"] and printed[-1] == spec.CAVEAT
    # under four calendar years of dates the year rule cannot be asked: FAIL, exit 1
    assert code == 1 and "found 2" in result["judgement"]["criteria"]["2_positive_in_3_of_4_years"]["reason"]
    with pytest.raises(SystemExit):
        cli.main(["--bars-db", "b", "--screener-db", "s", "--out", str(out), "--from-date", "July 4"])
    with pytest.raises(SystemExit):
        cli.main(["--bars-db", "b", "--screener-db", "s", "--out", str(out), "--ratings", "guessed"])
    capsys.readouterr()


def test_a_computed_run_opens_three_databases_read_only_and_writes_only_out(rated, tmp_path, monkeypatch, capsys):
    paths = [rated["bars"], rated["screener"], rated["industry"]]
    before = {p: _sha(p) for p in paths}
    listing = sorted(p.name for p in rated["dir"].iterdir())
    out = tmp_path / "result.json"
    opened, written = [], []
    real_connect, real_open = sqlite3.connect, builtins.open

    def _connect(database, *a, **k):
        opened.append((str(database), k.get("uri", False)))
        return real_connect(database, *a, **k)

    def _open(file, mode="r", *a, **k):
        if any(c in str(mode) for c in "wax+"):
            written.append(str(file))
        return real_open(file, mode, *a, **k)
    monkeypatch.setattr(sqlite3, "connect", _connect)
    monkeypatch.setattr(builtins, "open", _open)
    code = cli.main(["--bars-db", str(paths[0]), "--screener-db", str(paths[1]), "--industry-db", str(paths[2]),
                     "--out", str(out), "--unlock-holdout"])
    monkeypatch.undo()
    assert code in (0, 1)
    assert len(opened) == 3, opened
    assert all(uri and name.startswith("file:") and name.endswith("?mode=ro") for name, uri in opened), opened
    assert written == [str(out)], "the harness opened something else for writing"
    assert {p: _sha(p) for p in paths} == before, "a database changed"
    assert sorted(p.name for p in rated["dir"].iterdir()) == listing, "a file appeared beside the databases"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["result.json"]
    result = json.loads(out.read_text(encoding="utf-8"))
    assert result["ratings_cross_check"]["agrees"] is True
    capsys.readouterr()


def test_a_missing_industry_map_is_an_exit_2_and_creates_nothing(rated, tmp_path, capsys):
    out = tmp_path / "x.json"
    assert cli.main(["--bars-db", str(rated["bars"]), "--screener-db", str(rated["screener"]),
                     "--industry-db", str(tmp_path / "nope.db"), "--out", str(out)]) == 2
    assert not out.exists() and not (tmp_path / "nope.db").exists()
    with pytest.raises(ValueError):
        data.Store(rated["bars"], rated["screener"], ratings="both")
    capsys.readouterr()
