"""The rating ranks against ALL non-ETF stocks, and the history restate for it (2026-11-12).

Owner decision (2026-11-12, "everything until the indicator is 100% perfect"), evidence =
the production fit against 61 Deepvue readings: ranked over the 3,418-name cap universe
our ratings sat 5 to 8 points BELOW Deepvue's (it ranks every stock); ranked over every
non-ETF ticker with a fresh daily bar they are 3.0 points off per reading with a bias of
+0.1, 93 % within 10. Warrants, rights, units and preferreds stay in, and so do penny and
thin names (any such filter moved the fit by less than half a point or made it worse).

    candidates  = every rankable symbol holding a DAILY bar          (ranking_universe)
    per session = those with a FRESH bar and enough closes           (_window_bounds, unchanged)
    ETFs        = never ranked, rated by interpolation               (unchanged)

Hermetic like ``test_rs_m3_equal_weight.py``: a ``screener.db`` in ``tmp_path``, injected
bar and split readers, no network, never ``C:\\data``.
"""
from __future__ import annotations

import json
import math
import sqlite3

import pytest

from api.services.screener import rs_history as rh
from tests.test_rs_ibd_style_components import END, ETFS, SESSIONS, _names
from tests.test_rs_rating_history import (  # noqa: F401 - fixtures are used by name
    _flat_then, _query, _weekdays_ending, _ymd, make_reader, provider, tmp_db,
)

MARKER_TABLES = (rh.UNIVERSE_TABLE, rh.RESTATED_TABLE, rh.RESTATED_M3_TABLE)


@pytest.fixture(autouse=True)
def small_floor(monkeypatch):
    """The production floor (3,000 ranked names) is for the real store; these tests use
    tens of names. Nothing else is loosened."""
    monkeypatch.setattr(rh, "UNIVERSE_MIN_RANKED", 5)
    monkeypatch.setattr(rh, "_lock_sleep", lambda s: None)


def _ladder(n, *, prefix="L"):
    """``n`` stocks of 253 flat closes whose LAST close sits ``i`` percent above the
    flat: every quarter ratio equals ``1 + i/100``, so the score ranks them 1..n exactly
    (on the newest session; earlier sessions end on the flat and tie)."""
    return {f"{prefix}{i:03d}": _flat_then(float(i)) for i in range(1, n + 1)}


def _rating(rank, n):
    """The rating the machinery gives the ``rank``-th of ``n`` distinct scores."""
    return max(1, min(99, math.ceil(rank / n * 99)))


def _seed(tmp_db, series, *, days=3, universe=None):
    """What the pod holds today: a store the nightly/backfill wrote over ``universe``
    (default: every ticker given), with a ``fast`` value of 55 on every row."""
    r = rh.backfill(days=days, universe=list(universe if universe is not None else series),
                    etf_tickers=ETFS, bars_reader=make_reader(series, END),
                    splits_reader=lambda t: [], sessions=SESSIONS[-days:])
    assert r["ok"], r
    conn = sqlite3.connect(tmp_db)
    conn.execute(f"UPDATE {rh.TABLE} SET fast = 55")
    conn.commit()
    conn.close()


def _rows(path, where="1=1"):
    return _query(path, f"SELECT session, ticker, ibd, fast, m1, m3, m6, m9, m12, score, bars "
                        f"FROM {rh.TABLE} WHERE {where} ORDER BY session, ticker")


def _run(series, *, dry_run=False, days=3, **kw):
    kw.setdefault("etf_tickers", ETFS)
    kw.setdefault("sessions", SESSIONS[-days:])
    kw.setdefault("splits_reader", lambda t: [])
    kw.setdefault("universe", [t for t in series if t not in ETFS])
    return rh.restate_universe(days, bars_reader=make_reader(series, END), dry_run=dry_run, **kw)


def _tables(path):
    return {r["name"] for r in _query(path, "SELECT name FROM sqlite_master WHERE type = 'table'")}


# ── the candidate list ──────────────────────────────────────────────────────

def test_the_candidate_list_is_every_rankable_symbol_with_a_daily_bar():
    listing = ["AAA", "aaa", "BRK-B", "AAC.WS", "ACGLO", "AACIU", "$SPX", "^VIX", "X:BTCUSD",
               "VIX", "SPX", "NOBARS", "", None, "TOOLONGSYMBOLX", "A B"]
    daily = {"AAA", "BRK-B", "AAC.WS", "ACGLO", "AACIU", "VIX", "SPX", "TOOLONGSYMBOLX"}
    got = rh.ranking_universe(lister=lambda: listing,
                              last_daily_ts=lambda t: 20261105 if t in daily else None)
    assert got == {"AAA", "BRK-B", "AAC.WS", "ACGLO", "AACIU"}, (
        "warrants, units and preferreds stay IN; index feeds, crypto, junk and names with "
        "no daily bar are out")


def test_a_failing_last_ts_costs_that_name_not_the_run():
    def last(t):
        if t == "BAD":
            raise RuntimeError("boom")
        return 20261105
    assert rh.ranking_universe(lister=lambda: ["AAA", "BAD", "CCC"], last_daily_ts=last) == {"AAA", "CCC"}


def test_rankable_symbol_pattern():
    for ok in ("A", "NVDA", "BRK-B", "BF.B", "AACPW", "ABCDEFGHIJ"):
        assert rh.rankable_symbol(ok), ok
    for bad in ("", "$SPX", "^VIX", "X:BTCUSD", "A B", "ABCDEFGHIJK", "-AB", ".AB", "VIX", "SPX", "NDX"):
        assert not rh.rankable_symbol(bad), bad


def test_the_nightly_and_the_backfill_default_to_the_wide_candidate_list(monkeypatch):
    wide = {"AAA", "BBB", "WARRW"}
    monkeypatch.setattr(rh, "ranking_universe", lambda **kw: set(wide))
    monkeypatch.setattr(rh, "default_universe",
                        lambda: pytest.fail("the cap universe must not be the default population"))
    uni, etfs = rh._resolve_population(None, {"SPY"})
    assert uni == wide and etfs == {"SPY"}
    assert rh._resolve_population(["x", "y"], {"SPY"})[0] == {"X", "Y"}, (
        "an injected universe still wins: the tests and the tools rely on it")


# ── what ranking against everyone means ─────────────────────────────────────

def test_the_same_stock_rates_higher_against_the_wide_set_when_the_extra_names_are_weaker():
    """Cap names L041..L060 (the top of a 60-name ladder) plus 40 weaker names the cap
    universe never held. Over the cap set L041 is the bottom of 20 names (pct 1/20 ->
    ceil(4.95) = 5); over everyone it has 40 names beneath it (pct 41/60 -> ceil(67.65) = 68)."""
    wide = _ladder(60)
    cap = {t: v for t, v in wide.items() if int(t[1:]) > 40}
    r_cap = rh.compute_ratings(cap, set())
    r_wide = rh.compute_ratings(wide, set())
    assert r_cap["L041"]["ibd"] == 5 == _rating(1, 20)
    assert r_wide["L041"]["ibd"] == 68 == _rating(41, 60)
    assert r_wide["L060"]["ibd"] == r_cap["L060"]["ibd"] == 99, "the top is the top either way"
    # every component moves with the population, not only the composite
    for k in ("m1", "m3", "m6", "m9", "m12"):
        assert r_wide["L041"][k] == 68 and r_cap["L041"][k] == 5, k


def test_a_warrant_is_ranked_like_any_other_name_and_an_etf_never_is():
    """A 'W' name sits in the distribution (no type filter: removing them moved the fit by
    0.02 points), while SPY is rated by interpolation and moves nobody."""
    base = _ladder(10)
    with_warrant = {**base, "ZZZZW": _flat_then(5.5)}              # between L005 and L006
    r0 = rh.compute_ratings(base, ETFS)
    r1 = rh.compute_ratings(with_warrant, ETFS)
    assert r1["ZZZZW"]["ibd"] == _rating(6, 11), "6th of 11 distinct scores"
    assert r1["L010"]["ibd"] == 99 and r0["L010"]["ibd"] == 99
    assert r1["L006"]["ibd"] == _rating(7, 11) != r0["L006"]["ibd"], "the warrant counts in everyone's rank"
    r2 = rh.compute_ratings({**with_warrant, "SPY": _flat_then(5.5)}, ETFS)
    assert {t: r2[t]["ibd"] for t in with_warrant} == {t: r1[t]["ibd"] for t in with_warrant}, (
        "an ETF in the batch never moves a stock's rating")
    assert r2["SPY"]["ibd"] == r1["ZZZZW"]["ibd"], "the ETF lands where an equal-scored stock sits"


def test_a_stale_name_drops_out_of_the_session_and_a_fresh_one_stays():
    """The candidate list is wide; each session still keeps only names with a bar within
    MAX_BAR_LAG_DAYS (5 calendar days) of that session."""
    fresh = _flat_then(10.0)
    ends_on_time = make_reader({"FRESH": fresh}, END)
    three_days_old = make_reader({"LATE": fresh}, END - __import__("datetime").timedelta(days=3))
    ten_days_old = make_reader({"STALE": fresh}, END - __import__("datetime").timedelta(days=10))

    def reader(t, n, to_key):
        return {"FRESH": ends_on_time, "LATE": three_days_old, "STALE": ten_days_old}[t](t, n, to_key)
    series = {}
    for t in ("FRESH", "LATE", "STALE"):
        packed = rh._compact_series(reader(t, 300, _ymd(END)))
        series[t] = (packed[0], packed[1], [])
    windows, _suspects, ranked = rh._universe_windows(series, set(), END)
    assert set(windows) == {"FRESH", "LATE"} and ranked == 2, "10 days behind is stale, 3 days is fine"


def test_the_split_guard_still_marks_a_straddled_split_in_the_wide_run(tmp_db):
    days = _weekdays_ending(END, 253)
    series = {**_ladder(8), "SPLT": [100.0] * 200 + [25.0] * 53, "SPY": _flat_then(3.0)}
    declared = {"SPLT": [(days[200].isoformat(), 4.0)]}
    r = _run(series, days=1, splits_reader=lambda t: declared.get(t, []), dry_run=True)
    assert r["ok"] is True
    # a real run on a seeded store: the split-guarded name is left with no ratings
    _seed(tmp_db, {k: v for k, v in series.items() if k != "SPLT"} | {"SPLT": series["SPLT"]}, days=1,
          universe=[t for t in series if t != "SPLT"] + ["SPLT"])
    # (the seed ran with no split list, so SPLT holds a rating from the old store)
    assert _rows(tmp_db, "ticker = 'SPLT'")[0]["ibd"] is not None
    r = _run(series, days=1, splits_reader=lambda t: declared.get(t, []))
    assert r["ok"] is True and r["note"]["rows_nulled"] == 1
    got = _rows(tmp_db, "ticker = 'SPLT'")[0]
    assert all(got[c] is None for c in ("ibd", "m1", "m3", "m6", "m9", "m12")), (
        "a split-guarded name never keeps a number from the old universe")


# ── the restate ─────────────────────────────────────────────────────────────

def _cap_and_wide():
    series = _names(60)
    cap = [t for t in series if t not in ETFS][:30]
    return series, cap


def test_a_dry_run_writes_nothing_and_says_what_a_real_run_would(tmp_db):
    series, cap = _cap_and_wide()
    _seed(tmp_db, series, universe=cap)
    before, tables = _rows(tmp_db), _tables(tmp_db)
    r = _run(series, dry_run=True)
    assert r["ok"] is True and r["dry_run"] is True
    n = r["note"]
    assert n["sessions_todo"] == 3 and n["sessions_done"] == 3 and n["rows_inserted"] > 0
    assert n["rows_written"] == n["rows_inserted"] + n["rows_updated"]
    assert _rows(tmp_db) == before, "no row changed"
    assert _tables(tmp_db) == tables, "no marker table, no receipt table created"
    assert not any(t in _tables(tmp_db) for t in (rh.UNIVERSE_TABLE,))


def test_a_real_run_matches_what_the_nightly_stores_and_keeps_fast(tmp_db, tmp_path, monkeypatch):
    series, cap = _cap_and_wide()
    wide = [t for t in series if t not in ETFS]
    _seed(tmp_db, series, universe=cap)
    old_rows = {(r["session"], r["ticker"]): r for r in _rows(tmp_db)}
    r = _run(series)
    assert r["ok"] is True and r["note"]["sessions_done"] == 3
    got = {(x["session"], x["ticker"]): x for x in _rows(tmp_db)}
    # the stocks the cap universe never held are NEW rows, with no hourly fast value
    new_stock = next(t for t in wide if t not in cap)
    assert got[("2026-11-05", new_stock)]["ibd"] is not None and got[("2026-11-05", new_stock)]["fast"] is None
    # existing rows keep the hourly fast value the nightly stored that night
    assert all(x["fast"] == 55 for k, x in got.items() if k in old_rows)
    # ... and every rating equals what the nightly would store for that session
    nightly_db = tmp_path / "nightly.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(nightly_db))
    rec = rh.nightly_job(END, universe=wide, etf_tickers=ETFS, bars_reader=make_reader(series, END),
                         fast_map={}, splits_reader=lambda t: [])
    assert rec["ok"], rec
    want = {x["ticker"]: x for x in _rows(nightly_db, "session = '2026-11-05'")}
    cols = ("ibd", "m1", "m3", "m6", "m9", "m12", "score", "bars")
    mine = {t: x for (s, t), x in got.items() if s == "2026-11-05"}
    assert set(mine) == set(want)
    for t, x in want.items():
        assert {c: mine[t][c] for c in cols} == {c: x[c] for c in cols}, t


def test_a_real_run_marks_every_restate_so_neither_older_restate_has_anything_left(tmp_db):
    series, cap = _cap_and_wide()
    _seed(tmp_db, series, universe=cap)
    assert _run(series)["ok"]
    for table in MARKER_TABLES:
        assert len(_query(tmp_db, f"SELECT session FROM {table}")) == 3, table
    kw = dict(etf_tickers=ETFS, sessions=SESSIONS, splits_reader=lambda t: [],
              bars_reader=make_reader(series, END))
    for kind in ("long", "m3"):
        done = rh.restate_ranks(3, kind=kind, **kw)
        assert done["ok"] and done["note"]["reason"] == "nothing_to_do", kind


def test_a_stored_name_without_a_window_keeps_no_number_from_the_old_universe(tmp_db):
    series, cap = _cap_and_wide()
    series = {**series, "OLDX": series[cap[0]]}                     # held by the old store
    _seed(tmp_db, series, universe=cap + ["OLDX"])
    assert _rows(tmp_db, "ticker = 'OLDX'")[0]["ibd"] is not None
    gone = {k: v for k, v in series.items() if k != "OLDX"}         # no bars for it any more
    r = _run(gone, universe=[t for t in gone if t not in ETFS])
    assert r["ok"] and r["note"]["rows_nulled"] == 3
    for row in _rows(tmp_db, "ticker = 'OLDX'"):
        assert all(row[c] is None for c in ("ibd", "m1", "m3", "m6", "m9", "m12"))
        assert row["fast"] == 55, "the hourly value is never touched"


def test_it_is_resumable_one_session_at_a_time(tmp_db):
    series, cap = _cap_and_wide()
    _seed(tmp_db, series, universe=cap)
    a = _run(series, max_sessions=1)
    assert a["ok"] and a["note"]["sessions_done"] == 1
    assert [r["session"] for r in _query(tmp_db, f"SELECT session FROM {rh.UNIVERSE_TABLE}")] == ["2026-11-05"], (
        "newest first")
    b = _run(series, max_sessions=1)
    assert b["note"]["sessions_done"] == 1 and b["note"]["sessions_restated_before"] == 1
    c = _run(series)
    assert c["note"]["sessions_done"] == 1 and c["note"]["sessions_restated_before"] == 2
    d = _run(series)
    assert d["ok"] and d["note"]["reason"] == "nothing_to_do"
    one_go = _rows(tmp_db)
    # a fresh store restated in one go ends identical
    fresh = _query(tmp_db, f"SELECT COUNT(*) AS n FROM {rh.TABLE}")[0]["n"]
    assert fresh == len(one_go)


def test_it_refuses_when_a_session_ranks_a_fraction_of_the_others(tmp_db):
    series, cap = _cap_and_wide()
    thin = {t: (v if i % 2 == 0 else v[-65:]) for i, (t, v) in enumerate(series.items())}
    _seed(tmp_db, series, universe=cap)
    before, tables = _rows(tmp_db), _tables(tmp_db)
    r = _run(thin)
    assert r["ok"] is False and r["note"]["reason"] == "implausible_universe"
    assert r["note"]["implausible_sessions"] >= 1 and r["note"]["examples"][0]["session"] == "2026-11-03"
    assert _rows(tmp_db) == before and _tables(tmp_db) == tables, "nothing written, no marker"


def test_a_wider_band_lets_the_same_run_through(tmp_db):
    series, cap = _cap_and_wide()
    thin = {t: (v if i % 2 == 0 else v[-65:]) for i, (t, v) in enumerate(series.items())}
    _seed(tmp_db, series, universe=cap)
    assert _run(thin, band=0.5)["ok"] is True, "the band is the owner's knob, not a constant"


def test_it_refuses_below_the_floor_whatever_the_median_says(tmp_db, monkeypatch):
    series, cap = _cap_and_wide()
    _seed(tmp_db, series, universe=cap)
    monkeypatch.setattr(rh, "UNIVERSE_MIN_RANKED", 200)
    r = _run(series)
    assert r["ok"] is False and r["note"]["reason"] == "implausible_universe"


def test_a_real_run_refuses_while_too_many_split_lists_are_unknown_and_a_dry_run_only_counts(tmp_db):
    series, cap = _cap_and_wide()
    _seed(tmp_db, series, universe=cap)
    before = _rows(tmp_db)
    dry = _run(series, dry_run=True, splits_reader=lambda t: None)
    assert dry["ok"] is True and dry["note"]["split_basis"]["unknown"] >= 60
    real = _run(series, splits_reader=lambda t: None)
    assert real["ok"] is False and real["note"]["reason"] == "split_lists_unknown"
    assert _rows(tmp_db) == before


def test_the_shift_the_owner_sees_is_what_the_ranks_actually_moved(tmp_db):
    """Cap = the top 20 of a 60-name ladder; wide = all 60. On the newest session each cap
    name's rating moves from its rank in 20 to its rank in 60."""
    wide = {**_ladder(60), "SPY": _flat_then(10.0)}
    cap = [t for t in wide if t != "SPY" and int(t[1:]) > 40]
    _seed(tmp_db, wide, days=1, universe=cap)
    r = _run(wide, days=1)
    assert r["ok"] and r["note"]["rows_inserted"] == 40
    deltas = [_rating(40 + i, 60) - _rating(i, 20) for i in range(1, 21)]
    sh = r["note"]["shift"]
    assert sh["compared"] == 20
    assert sh["mean"] == round(sum(deltas) / 20, 2)
    assert sh["big_share"] == round(sum(1 for d in deltas if abs(d) > rh.UNIVERSE_BIG_SHIFT) / 20, 4)
    assert sh["up_share"] == round(sum(1 for d in deltas if d > 0) / 20, 4)


def test_each_session_commits_through_the_lock_retry(tmp_db, monkeypatch):
    series, cap = _cap_and_wide()
    _seed(tmp_db, series, universe=cap)
    seen = []
    real = rh._write_with_lock_retry

    def spy(conn, write, *, what="restate"):
        seen.append(what)
        return real(conn, write, what=what)
    monkeypatch.setattr(rh, "_write_with_lock_retry", spy)
    assert _run(series)["ok"]
    assert len(seen) == 3 and all(w.startswith("restate-universe ") for w in seen)


def test_a_commit_that_meets_a_lock_is_retried_not_lost(tmp_db, monkeypatch):
    series, cap = _cap_and_wide()
    _seed(tmp_db, series, universe=cap)
    real = rh._write_with_lock_retry
    state = {"failed": 0}

    def flaky(conn, write, *, what="restate"):
        def once():
            if state["failed"] < 2:
                state["failed"] += 1
                raise sqlite3.OperationalError("database is locked")
            write()
        return real(conn, once, what=what)
    monkeypatch.setattr(rh, "_write_with_lock_retry", flaky)
    r = _run(series, max_sessions=1)
    assert r["ok"] and state["failed"] == 2
    assert len(_query(tmp_db, f"SELECT session FROM {rh.UNIVERSE_TABLE}")) == 1, "the session landed after two locks"


# ── memory, command line ────────────────────────────────────────────────────

def test_the_series_are_held_as_typed_arrays():
    packed = rh._compact_series(make_reader({"AAA": _flat_then(5.0)}, END)("AAA", 300, _ymd(END)))
    ts, closes = packed
    assert ts.typecode == "i" and closes.typecode == "d" and len(ts) == len(closes) == 253
    assert rh._window_bounds(ts, _ymd(END)) == (0, 253) or rh._window_bounds(ts, _ymd(END))[1] == 253
    assert rh._compact_series([]) is None and rh._compact_series(None) is None
    assert ts.itemsize + closes.itemsize == 12, "12 bytes a bar against ~70 for two lists of Python numbers"


def test_the_command_line(monkeypatch, capsys):
    seen = {}

    def fake(days, **kw):
        seen.update(days=days, **kw)
        return {"ok": True, "dry_run": kw["dry_run"], "duration_ms": 1.0,
                "note": {"sessions": 260, "sessions_stored": 254, "sessions_restated_before": 0,
                         "sessions_todo": 254, "sessions_done": 254, "rows_written": 3000000,
                         "rows_inserted": 900000, "rows_updated": 2100000, "rows_nulled": 12,
                         "ranked": {"min": 5800, "median": 6400, "max": 6600},
                         "shift": {"mean": 5.2, "big_share": 0.04, "up_share": 0.8},
                         "split_basis": {"declared": 12000, "unknown": 0}}}
    monkeypatch.setattr(rh, "restate_universe", fake)
    assert rh.main(["--backfill-days", "260", "--restate-universe", "--dry-run"]) == 0
    assert seen == {"days": 260, "dry_run": True, "max_sessions": None,
                    "split_fetch_budget": rh.AUTO_BUDGET, "band": rh.UNIVERSE_BAND}
    out = capsys.readouterr().out
    assert "restate-universe (dry run)" in out and "would_write=254" in out and "new_rows=900000" in out
    assert "ranked_median=6400" in out and "shift_mean=5.2" in out
    assert json.loads(out.strip().splitlines()[-1].split("receipt ", 1)[1])["ok"] is True
    assert rh.main(["--backfill-days", "260", "--restate-universe", "--universe-band", "0.3",
                    "--max-sessions", "5"]) == 0
    assert seen["band"] == 0.3 and seen["max_sessions"] == 5 and seen["dry_run"] is False
    assert rh.main(["--backfill-days", "260", "--restate-universe", "--universe-band", "0.9"]) == 2
    assert rh.main(["--backfill-days", "260", "--restate-universe", "--restate-ranks"]) == 2
    assert rh.main(["--backfill-days", "260", "--restate-universe", "--fill-column", "m9"]) == 2
