"""3M component rank = the equal-weighted average of the 1-, 2- and 3-month returns,
and the history restate for it (2026-11-12).

Evidence (production fit against 61 Deepvue readings, 2026-11-12): against the plain
63-bar return the 3M rank's Spearman went 0.856 -> 0.994 and the mean miss 10.2 -> 6.9
points; Deepvue documents its 3M as "equal weighted". ``m1`` stays the plain 21-bar
return and ``m6``/``m9``/``m12`` stay the IBD-style blends (PR #1120).

    m3 = (R21 + R42 + R63) / 3          Rn = close / close[-n]

Averaging the ratios or the percentage returns orders the stocks identically (one is a
linear map of the other); the ratio form is used to match the IBD-style blends.

Hermetic like ``test_rs_ibd_style_components.py``: a ``screener.db`` in ``tmp_path``,
injected bar and split readers, no network, never ``C:\\data``.
"""
from __future__ import annotations

import json
import random
import sqlite3

import pytest

from api.services import rs_weighted_return as rsw
from api.services.screener import rs_history as rh
from tests.test_rs_ibd_style_components import (
    END, ETFS, SESSIONS, _all, _names, _ref_b, _small, _anchored,
)
from tests.test_rs_rating_history import (  # noqa: F401 - fixtures are used by name
    _query, make_reader, provider, tmp_db,
)


def _anch3(r21, r42, r63, n=130):
    """``n`` closes ending at 200 whose 21/42/63-bar ratios are exactly the arguments."""
    c = [100.0] * n
    c[-1] = 200.0
    for bars, r in ((21, r21), (42, r42), (63, r63)):
        c[-1 - bars] = 200.0 / r
    return c


def _ref_m3_returns(closes):
    """An independent reference built from PERCENTAGE returns (not ratios): the mean of
    the 21-, 42- and 63-bar returns, nothing without the 63-bar window."""
    if len(closes) <= 63:
        return None
    rets = []
    for n in (21, 42, 63):
        if closes[-1 - n] <= 0:
            return None
        rets.append((closes[-1] / closes[-1 - n] - 1.0) * 100.0)
    return sum(rets) / 3.0


# ── the arithmetic ──────────────────────────────────────────────────────────

def test_the_table_is_the_owner_decision():
    assert dict(rsw.EQUAL_WEIGHT_COMPONENT_TERMS) == {"m3": ((63, 1), (42, 1), (21, 1))}
    assert dict(rsw.BLENDED_COMPONENT_TERMS)["m3"] == ((63, 1), (42, 1), (21, 1))
    assert {k for k, _t in rsw.BLENDED_COMPONENT_TERMS} == {"m3", "m6", "m9", "m12"}, "m1 stays plain"
    assert dict(rsw.IBD_STYLE_COMPONENT_TERMS) == {
        "m6": ((63, 2), (126, 1)), "m9": ((63, 2), (126, 1), (189, 1)),
        "m12": ((63, 2), (126, 1), (189, 1), (252, 1))}, "the long blends are unchanged"
    assert rh.RESTATE_KINDS["m3"] == (("m3",), "m3_eqwt_v1", "rs_history_restated_m3")
    assert rh.RESTATE_KINDS["long"] == (("m6", "m9", "m12"), "ibd_style_v1", "rs_history_restated")
    assert rh.RESTATE_KINDS["m3"][2] != rh.RESTATE_KINDS["long"][2], "separate marker tables"
    assert rh.COMPONENTS == (("m1", 21), ("m3", 63), ("m6", 126), ("m12", 252)), "the screener's four stay four"


def test_the_average_equals_the_hand_derived_value():
    c = _anch3(1.2, 1.5, 2.0)
    v = rh.component_values(c)
    assert v["m3"] == pytest.approx((1.2 + 1.5 + 2.0) / 3)
    assert v["m1"] == pytest.approx(rsw.period_return(c, 21)), "1M is still the plain percentage return"
    # equal weights: swapping which window holds which ratio does not change the mean
    assert rh.component_values(_anch3(2.0, 1.5, 1.2))["m3"] == pytest.approx(v["m3"])


def test_a_young_stock_has_no_3m_value_until_it_reaches_the_63_bar_window():
    assert rh.component_values([100.0] * 63 + [110.0])["m3"] is not None            # 64 closes
    assert rh.component_values([100.0] * 62 + [110.0])["m3"] is None                # 63 closes
    assert rh.component_values([100.0] * 40)["m3"] is None, "not built from its 1M and 2M terms alone"


def test_an_unusable_reference_close():
    c = _anch3(1.2, 1.5, 2.0)
    c[-1 - 42] = 0.0                                                                  # R42 has no positive reference
    assert rh.component_values(c)["m3"] == pytest.approx((1.2 + 2.0) / 2), "a later term is dropped, weights renormalised"
    c2 = _anch3(1.2, 1.5, 2.0)
    c2[-1 - 63] = 0.0                                                                 # the required 63-bar term is gone
    assert rh.component_values(c2)["m3"] is None
    c3 = _anch3(1.2, 1.5, 2.0)
    c3[-1 - 21] = 0.0
    assert rh.component_values(c3)["m3"] == pytest.approx((1.5 + 2.0) / 2)


def test_the_shipped_path_agrees_with_an_independent_returns_based_reference():
    rng = random.Random(1112)
    for _ in range(60):
        c, p = [], 100.0
        for _i in range(rng.choice([300, 130, 80, 64])):
            p *= 1.0 + rng.uniform(-0.04, 0.045)
            c.append(round(p, 4))
        got = rh.component_values(c)["m3"]
        want = _ref_m3_returns(c)
        assert (got is None) == (want is None)
        if want is not None:
            assert (got - 1.0) * 100.0 == pytest.approx(want), "ratio form and return form agree exactly"


def test_the_long_components_did_not_move():
    rng = random.Random(7)
    for _ in range(20):
        c, p = [], 100.0
        for _i in range(rng.choice([300, 260, 253])):
            p *= 1.0 + rng.uniform(-0.04, 0.045)
            c.append(round(p, 4))
        got, want = rh.component_values(c), _ref_b(c)
        for k in ("m6", "m9", "m12"):
            assert got[k] == pytest.approx(want[k]), k


# ── ranking ─────────────────────────────────────────────────────────────────

def _same_63_different_path():
    """Two stocks with the same plain 63-bar return (+30 %) and different paths: EARLY
    made it in the first 21 bars of the quarter and has been flat since; LATE made it
    in the last 21."""
    early = [100.0] * 80 + [100.0 + 30.0 * i / 21 for i in range(1, 22)] + [130.0] * 42
    late = [100.0] * 80 + [100.0] * 42 + [100.0 + 30.0 * i / 21 for i in range(1, 22)]
    return early, late


def test_the_equal_weighted_rank_rewards_the_recent_part_of_the_quarter_where_plain_returns_tie():
    early, late = _same_63_different_path()
    assert len(early) == len(late)
    assert rsw.period_return(early, 63) == pytest.approx(rsw.period_return(late, 63)), "a plain 63-bar rank ties them"
    flat = [100.0] * len(early)
    out = rh.compute_ratings({"EARLY": early, "LATE": late, "FLAT": flat}, set())
    assert out["LATE"]["m3"] > out["EARLY"]["m3"] > out["FLAT"]["m3"]


def test_stored_m3_is_the_percentile_of_the_reference_average_and_1m_is_still_plain():
    rng = random.Random(99)
    series = {}
    for i in range(40):
        c, p = [], 100.0
        for _i in range(130):
            p *= 1.0 + rng.uniform(-0.03, 0.035) + (i - 20) / 9000.0
            c.append(p)
        series[f"S{i:02d}"] = c
    out = rh.compute_ratings(series, set())
    ref = {t: _ref_m3_returns(c) for t, c in series.items()}
    pct = rh.percentile_ranks(ref)
    plain1 = rh.percentile_ranks({t: rsw.period_return(c, 21) for t, c in series.items()})
    for t in series:
        assert out[t]["m3"] == rh.rating_from_pct(pct[t]), t
        assert out[t]["m1"] == rh.rating_from_pct(plain1[t]), t


def test_an_etf_interpolates_its_3m_without_moving_a_stock():
    a, b, f = _anch3(1.9, 2.0, 2.0), _anch3(1.1, 1.2, 1.3), _anch3(1.0, 1.0, 1.0)
    base = rh.compute_ratings({"A": a, "B": b, "F": f}, set())
    mid = _anch3(1.5, 1.6, 1.7)
    with_etf = rh.compute_ratings({"A": a, "B": b, "F": f, "XLK": mid}, {"XLK"})
    for t in ("A", "B", "F"):
        assert with_etf[t]["m3"] == base[t]["m3"], "an ETF never moves a stock's rank"
    assert with_etf["B"]["m3"] < with_etf["XLK"]["m3"] <= with_etf["A"]["m3"]


def test_the_composite_rating_is_untouched():
    a, b = _anchored(2.0, 4.0, 5.0, 10.0), _anchored(1.5, 1.5, 1.5, 1.5)
    out = rh.compute_ratings({"A": a, "B": b}, set())
    assert out["A"]["ibd"] == 99 and out["B"]["ibd"] == 50
    assert out["A"]["score"] == round(rh.ibd_score(a), 6)


# ── the restate ─────────────────────────────────────────────────────────────

def _seed_old_m3(tmp_db, series, days=3, long_marked=True):
    """Backfill ``days`` sessions (the nightly's NEW meaning), note the answer key for
    m3, then put the OLD meaning into m3 (a constant) and drop the m3 marker table: the
    store the pod holds when this ships. ``long_marked`` records the m6/m9/m12 restate
    as done for every session, like production."""
    r = rh.backfill(days=days, universe=list(series), etf_tickers=ETFS,
                    bars_reader=make_reader(series, END), splits_reader=lambda t: [],
                    sessions=SESSIONS[-days:])
    assert r["ok"], r
    want = {(x["session"], x["ticker"]): x["m3"] for x in
            _query(tmp_db, f"SELECT session, ticker, m3 FROM {rh.TABLE}")}
    conn = sqlite3.connect(tmp_db)
    conn.execute(f"UPDATE {rh.TABLE} SET m3 = 7")
    conn.execute(f"DROP TABLE IF EXISTS {rh.RESTATED_M3_TABLE}")
    conn.execute(f"DROP TABLE IF EXISTS {rh.RESTATED_TABLE}")
    if long_marked:
        conn.execute(rh._restated_sql(rh.RESTATED_TABLE))
        for s in SESSIONS[-days:]:
            conn.execute(f"INSERT INTO {rh.RESTATED_TABLE} (session, method, restated_at, rows) VALUES (?, ?, 0, 0)",
                         (s.isoformat(), rh.RESTATE_METHOD))
    conn.commit()
    conn.close()
    return want


def _restate_m3(series, **kw):
    kw.setdefault("etf_tickers", ETFS)
    kw.setdefault("sessions", SESSIONS)
    kw.setdefault("splits_reader", lambda t: [])
    return rh.restate_ranks(3, bars_reader=make_reader(series, END), kind="m3", **kw)


def test_the_m3_restate_rewrites_only_m3_and_equals_a_fresh_backfill(tmp_db):
    series = _small()
    want = _seed_old_m3(tmp_db, series)
    before = _all(tmp_db)
    r = _restate_m3(series)
    note = r["note"]
    assert r["ok"] is True and "reason" not in note, note
    assert note["columns"] == ["m3"] and note["method"] == "m3_eqwt_v1"
    assert (note["sessions"], note["sessions_stored"], note["sessions_todo"], note["sessions_done"]) == (3, 3, 3, 3)
    assert (note["drift"], note["hard"], note["rows_nulled"]) == (0, 0, 0)
    after = _all(tmp_db)
    for b, a in zip(before, after):
        for col in ("session", "ticker", "ibd", "fast", "m1", "m6", "m9", "m12", "score", "bars"):
            assert a[col] == b[col], f"{col} must not move ({a['ticker']} {a['session']})"
    assert {(x["session"], x["ticker"]): x["m3"] for x in after} == want
    assert _query(tmp_db, f"SELECT COUNT(*) AS n FROM {rh.RESTATED_M3_TABLE}")[0]["n"] == 3
    again = _restate_m3(series)
    assert again["ok"] and again["note"]["reason"] == "nothing_to_do" and again["rows"] == 0


def test_the_two_restates_keep_independent_markers(tmp_db):
    series = _small()
    _seed_old_m3(tmp_db, series)
    assert _restate_m3(series)["ok"]
    long_rows = _query(tmp_db, f"SELECT session, method FROM {rh.RESTATED_TABLE} ORDER BY session")
    assert [x["method"] for x in long_rows] == ["ibd_style_v1"] * 3, "the m3 restate left the long markers alone"
    m3_rows = _query(tmp_db, f"SELECT session, method FROM {rh.RESTATED_M3_TABLE} ORDER BY session")
    assert [x["method"] for x in m3_rows] == ["m3_eqwt_v1"] * 3
    assert rh.restate_ranks(3, bars_reader=make_reader(series, END), etf_tickers=ETFS, sessions=SESSIONS,
                            splits_reader=lambda t: [])["note"]["reason"] == "nothing_to_do", \
        "the long restate still reads its own marker table as done"


def test_the_m3_restate_is_resumable_one_session_at_a_time(tmp_db):
    series = _small()
    want = _seed_old_m3(tmp_db, series)
    first = _restate_m3(series, max_sessions=1)
    assert first["ok"] and first["note"]["sessions_done"] == 1
    assert {x["session"] for x in _query(tmp_db, f"SELECT session FROM {rh.RESTATED_M3_TABLE}")} == {"2026-11-05"}
    mid = {(x["session"], x["ticker"]): x["m3"] for x in _all(tmp_db)}
    assert mid[("2026-11-05", "AAA")] == want[("2026-11-05", "AAA")]
    assert mid[("2026-11-03", "AAA")] == 7, "an older session keeps its old number until its turn"
    rest = _restate_m3(series)
    assert rest["ok"] and rest["note"]["sessions_restated_before"] == 1 and rest["note"]["sessions_done"] == 2
    assert {(x["session"], x["ticker"]): x["m3"] for x in _all(tmp_db)} == want


def test_the_m3_dry_run_writes_nothing(tmp_db):
    series = _small()
    _seed_old_m3(tmp_db, series)
    before = _all(tmp_db)
    runs_before = _query(tmp_db, f"SELECT COUNT(*) AS n FROM {rh.RUNS_TABLE}")[0]["n"]
    r = _restate_m3(series, dry_run=True)
    assert r["ok"] is True and r["dry_run"] is True
    assert r["note"]["sessions_done"] == 3 and r["note"]["rows_written"] == 15
    assert _all(tmp_db) == before
    assert not _query(tmp_db, f"SELECT name FROM sqlite_master WHERE name = '{rh.RESTATED_M3_TABLE}'"), \
        "a dry run creates no marker table"
    assert _query(tmp_db, f"SELECT COUNT(*) AS n FROM {rh.RUNS_TABLE}")[0]["n"] == runs_before, "and no receipt"


def test_the_m3_restate_compares_the_long_columns_only_for_sessions_that_hold_the_new_meaning(tmp_db):
    series = _small()
    _seed_old_m3(tmp_db, series, long_marked=False)
    conn = sqlite3.connect(tmp_db)
    conn.execute(f"UPDATE {rh.TABLE} SET m6 = 1, m9 = 2, m12 = 3")        # an OLD-meaning long store
    conn.commit()
    conn.close()
    r = _restate_m3(series, max_drift_share=0.0)
    assert r["ok"] is True, r["note"]                                       # old m6/m9/m12 are not compared


def test_the_m3_restate_refuses_when_a_marked_long_column_disagrees_with_todays_bars(tmp_db):
    series = _small()
    _seed_old_m3(tmp_db, series, long_marked=True)
    conn = sqlite3.connect(tmp_db)
    conn.execute(f"UPDATE {rh.TABLE} SET m12 = CASE WHEN m12 > 50 THEN m12 - 9 ELSE m12 + 9 END "
                 "WHERE ticker = 'CCC'")
    conn.commit()
    conn.close()
    before = _all(tmp_db)
    r = _restate_m3(series)
    assert r["ok"] is False and r["note"]["reason"] == "would_change_other_values"
    assert r["note"]["mismatches"]["values"] == 3 and r["note"]["examples"][0]["stored_vs_now"].get("m12")
    assert _all(tmp_db) == before, "a refused run writes nothing"
    assert not _query(tmp_db, f"SELECT name FROM sqlite_master WHERE name = '{rh.RESTATED_M3_TABLE}'")


def test_the_long_restate_compares_m3_only_once_the_session_is_m3_marked(tmp_db):
    series = _small()
    r0 = rh.backfill(days=3, universe=list(series), etf_tickers=ETFS, bars_reader=make_reader(series, END),
                     splits_reader=lambda t: [], sessions=SESSIONS)
    assert r0["ok"]
    conn = sqlite3.connect(tmp_db)
    conn.execute(f"UPDATE {rh.TABLE} SET m6 = 1, m9 = 2, m12 = 3, m3 = 7")   # old long AND old m3
    conn.execute(f"DROP TABLE IF EXISTS {rh.RESTATED_TABLE}")
    conn.execute(f"DROP TABLE IF EXISTS {rh.RESTATED_M3_TABLE}")
    conn.commit()
    conn.close()
    kw = dict(etf_tickers=ETFS, sessions=SESSIONS, splits_reader=lambda t: [])
    # unmarked m3 (old meaning) is NOT compared, so the long restate is not refused by it
    ok = rh.restate_ranks(3, bars_reader=make_reader(series, END), max_drift_share=0.0, **kw)
    assert ok["ok"] is True, ok["note"]
    # now mark m3 as restated while it still holds the old constant: the long restate must see it
    conn = sqlite3.connect(tmp_db)
    conn.execute(f"DROP TABLE IF EXISTS {rh.RESTATED_TABLE}")
    conn.execute(rh._restated_sql(rh.RESTATED_M3_TABLE))
    for s in SESSIONS:
        conn.execute(f"INSERT INTO {rh.RESTATED_M3_TABLE} (session, method, restated_at, rows) VALUES (?, ?, 0, 0)",
                     (s.isoformat(), rh.RESTATE_M3_METHOD))
    conn.commit()
    conn.close()
    bad = rh.restate_ranks(3, bars_reader=make_reader(series, END), **kw)
    assert bad["ok"] is False and bad["note"]["reason"] == "would_change_other_values"


# ── the lock retry ──────────────────────────────────────────────────────────

class _FakeConn:
    def __init__(self, fail_times, message="database is locked"):
        self.fail_times, self.message = fail_times, message
        self.writes = self.commits = self.rollbacks = 0

    def write(self):
        self.writes += 1
        if self.writes <= self.fail_times:
            raise sqlite3.OperationalError(self.message)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def test_a_locked_commit_is_retried_with_backoff_and_then_succeeds(monkeypatch):
    sleeps = []
    monkeypatch.setattr(rh, "_lock_sleep", sleeps.append)
    conn = _FakeConn(fail_times=2)
    rh._write_with_lock_retry(conn, conn.write, what="test")
    assert (conn.writes, conn.commits, conn.rollbacks) == (3, 1, 2)
    assert sleeps == [rh.LOCK_RETRY_BASE_S, rh.LOCK_RETRY_BASE_S * 2]


def test_a_lock_that_never_clears_raises_after_the_attempt_limit(monkeypatch):
    monkeypatch.setattr(rh, "_lock_sleep", lambda s: None)
    conn = _FakeConn(fail_times=99)
    with pytest.raises(sqlite3.OperationalError, match="locked"):
        rh._write_with_lock_retry(conn, conn.write, what="test")
    assert conn.writes == rh.LOCK_RETRY_ATTEMPTS and conn.commits == 0


def test_any_other_error_is_not_retried(monkeypatch):
    sleeps = []
    monkeypatch.setattr(rh, "_lock_sleep", sleeps.append)
    conn = _FakeConn(fail_times=99, message="disk I/O error")
    with pytest.raises(sqlite3.OperationalError, match="disk"):
        rh._write_with_lock_retry(conn, conn.write, what="test")
    assert conn.writes == 1 and sleeps == []


class _LockOnceConn:
    """A real connection behind a proxy whose first ``executemany`` per run raises
    'database is locked': the lock the first production restate met at session 249."""

    def __init__(self, real, tripped):
        self._real, self._tripped = real, tripped

    def executemany(self, *a, **k):
        if not self._tripped:
            self._tripped.append(1)
            raise sqlite3.OperationalError("database is locked")
        return self._real.executemany(*a, **k)

    def __getattr__(self, name):
        return getattr(self._real, name)


def test_a_lock_in_the_middle_of_a_real_restate_costs_a_wait_not_the_run(tmp_db, monkeypatch):
    series = _small()
    want = _seed_old_m3(tmp_db, series)
    waits, tripped = [], []
    monkeypatch.setattr(rh, "_lock_sleep", waits.append)
    real_connect = rh.snapshot_db.connect
    monkeypatch.setattr(rh.snapshot_db, "connect", lambda *a, **k: _LockOnceConn(real_connect(*a, **k), tripped))
    r = _restate_m3(series)
    assert tripped, "the lock was injected"
    assert r["ok"] is True and r["note"]["sessions_done"] == 3, r["note"]
    assert waits == [rh.LOCK_RETRY_BASE_S]
    monkeypatch.undo()
    assert {(x["session"], x["ticker"]): x["m3"] for x in _all(tmp_db)} == want
    assert _query(tmp_db, f"SELECT COUNT(*) AS n FROM {rh.RESTATED_M3_TABLE}")[0]["n"] == 3


# ── the command ─────────────────────────────────────────────────────────────

def test_the_cli_reaches_the_m3_restate_and_refuses_columns_alone(capsys, monkeypatch):
    seen = {}

    def fake(days, **kw):
        seen.update(days=days, **kw)
        return {"ok": True, "dry_run": kw["dry_run"], "duration_ms": 1.0,
                "note": {"sessions": 3, "sessions_stored": 3, "sessions_restated_before": 0, "sessions_todo": 3,
                         "sessions_done": 3, "rows_written": 9, "rows_nulled": 0, "checked": 9, "drift": 0,
                         "hard": 0, "mismatches": {"window": 0, "guard": 0, "values": 0}}}
    monkeypatch.setattr(rh, "restate_ranks", fake)
    assert rh.main(["--backfill-days", "260", "--restate-ranks", "--columns", "m3", "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert "rs_history restate m3 (dry run)" in out and seen["kind"] == "m3" and seen["days"] == 260
    assert rh.main(["--backfill-days", "260", "--restate-ranks"]) == 0
    assert seen["kind"] == "long" and "rs_history restate m6/m9/m12" in capsys.readouterr().out
    assert rh.main(["--backfill-days", "260", "--columns", "m3"]) == 2, "--columns only goes with --restate-ranks"
    assert rh.main(["--backfill-days", "260", "--restate-ranks", "--columns", "m4"]) == 2


# ── the words ───────────────────────────────────────────────────────────────

def test_the_methodology_says_what_the_3m_rank_is_and_reads_it_from_the_table(monkeypatch):
    from api.services.screener import methodology as M
    m = M.for_column("rs_rating_3m")
    assert "equal-weighted average of the one-, two- and three-month returns" in m["one_line"]
    assert "the close over the close 21, 42 and 63 sessions earlier" in m["how"]
    assert "63-session term there is no rank" in m["how"]
    assert "until 2026-11-12" in m["caveat"] and "plain" in m["caveat"], "a pre-change chart or saved screen reads on another basis"
    assert "recency" not in (m["one_line"] + m["how"]).lower() and "counts double" not in m["how"]
    # the 1M entry is still the plain return, and 6M still the recency-weighted blend
    assert "plain" in M.for_column("rs_rating_1m")["one_line"]
    assert "recency-weighted" in M.for_column("rs_rating_6m")["one_line"]
    # the prose is READ from the table: move a lookback and the sentence follows
    monkeypatch.setattr(rsw, "EQUAL_WEIGHT_COMPONENT_TERMS", (("m3", ((84, 1), (42, 1), (21, 1))),))
    moved = M.for_column("rs_rating_3m")["how"]
    assert "21, 42 and 84 sessions earlier" in moved and "84-session term there is no rank" in moved


def test_the_identity_band_calls_it_the_equal_weighted_three_month_percentile():
    from api.services.screener import identities
    src = open(identities.__file__, encoding="utf-8").read()
    assert '"rs_rating_3m", "the three-month equal-weighted-return percentile"' in src
    assert '"rs_rating_3m", "the three-month return percentile"' not in src
