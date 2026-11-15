"""The 9M component rank in the rating history (Deepvue round 2, 2026-11-08).

`rs_history` stores ``m9``: the 1-99 percentile of the plain 189-bar return,
ranked exactly like ``m1/m3/m6/m12``. A table written before round 2 has no
``m9`` column; ``ensure_schema`` adds it by an idempotent ``ALTER`` (old rows read
null), reads never alter, and ``--fill-column m9`` fills the stored sessions
without rewriting anything else, refusing when today's bars or split guard
would change another stored value.

Hermetic like ``test_rs_rating_history.py`` (whose fixtures and readers are
reused): a ``screener.db`` in ``tmp_path``, injected bar and split readers, no
network, never ``C:\\data``.
"""
from __future__ import annotations

import sqlite3
from datetime import date

import pytest

from api.services.screener import rs_history as rh
from api.services.screener import snapshot_db
from tests.test_rs_rating_history import (  # noqa: F401 - fixtures are used by name
    _query, _weekdays_ending, make_reader, provider, tmp_db,
)

END = date(2026, 11, 5)
SESSIONS = [date(2026, 11, 3), date(2026, 11, 4), END]
PRE_ROUND2_SQL = f"""
CREATE TABLE {rh.TABLE} (
    session TEXT NOT NULL,
    ticker TEXT NOT NULL,
    ibd INTEGER, fast INTEGER,
    m1 INTEGER, m3 INTEGER, m6 INTEGER, m12 INTEGER,
    score REAL, bars INTEGER,
    PRIMARY KEY (session, ticker)
)"""
OLD_COLS = "session, ticker, ibd, fast, m1, m3, m6, m12, score, bars"


def _walk(n, start, steps):
    """``n`` closes: a piecewise drift, one rate per equal slice of ``steps`` (exact
    arithmetic, no randomness), so every component window reads a different return."""
    out, c = [], float(start)
    per = max(1, n // len(steps))
    for i in range(n):
        c *= 1.0 + steps[min(i // per, len(steps) - 1)]
        out.append(round(c, 6))
    return out


def _series():
    # AAA led nine months ago and faded; BBB lagged then ran; CCC steady; DDD weak.
    return {"AAA": _walk(300, 100, [0.004, 0.003, -0.001, -0.002]),
            "BBB": _walk(300, 100, [-0.002, -0.001, 0.003, 0.004]),
            "CCC": _walk(300, 100, [0.001, 0.001, 0.001, 0.001]),
            "DDD": _walk(300, 100, [-0.001, -0.001, -0.0015, -0.001]),
            "SPY": _walk(300, 400, [0.0008, 0.0008, 0.0008, 0.0008])}


def _strip_m9(path):
    """Rebuild the table in its pre-round-2 shape (no ``m9``), keeping every row:
    the store the pod holds today."""
    conn = sqlite3.connect(path)
    try:
        conn.execute(f"ALTER TABLE {rh.TABLE} RENAME TO old_rsh")
        conn.execute(PRE_ROUND2_SQL)
        conn.execute(f"INSERT INTO {rh.TABLE} ({OLD_COLS}) SELECT {OLD_COLS} FROM old_rsh")
        conn.execute("DROP TABLE old_rsh")
        conn.execute(rh._INDEX_SQL)
        conn.commit()
    finally:
        conn.close()


def _cols(path):
    conn = sqlite3.connect(path)
    try:
        return [r[1] for r in conn.execute(f"PRAGMA table_info({rh.TABLE})")]
    finally:
        conn.close()


def _m9_all_null(path):
    if "m9" not in _cols(path):
        return True
    return not _query(path, f"SELECT 1 FROM {rh.TABLE} WHERE m9 IS NOT NULL")


def _rows(path, cols=OLD_COLS):
    return _query(path, f"SELECT {cols} FROM {rh.TABLE} ORDER BY session, ticker")


def _seed(tmp_db, tmp_path, series=None, splits=None):
    """Backfill three sessions (which now writes m9), note the m9 each row got, and
    strip the column: the store as the pod holds it, plus the answer key."""
    series = series or _series()
    r = rh.backfill(days=3, universe=list(series), etf_tickers={"SPY"},
                    bars_reader=make_reader(series, END), sessions=SESSIONS, data_dir=str(tmp_path),
                    splits_reader=splits or (lambda t: []))
    assert r["ok"], r
    want = {(x["session"], x["ticker"]): x["m9"] for x in _rows(tmp_db, "session, ticker, m9")}
    _strip_m9(tmp_db)
    assert "m9" not in _cols(tmp_db)
    return series, want


# ── the arithmetic ──────────────────────────────────────────────────────────

def test_m9_is_the_plain_189_bar_return_and_none_when_short():
    closes = [100.0] + [80.0] * 189 + [120.0]               # 191 closes; closes[-190] == 80
    assert len(closes) == 191
    assert rh.plain_returns(closes)["m9"] == pytest.approx(50.0)
    assert rh.plain_returns(closes[-190:])["m9"] == pytest.approx(50.0), "190 closes is the minimum"
    assert rh.plain_returns(closes[-189:])["m9"] is None, "189 closes cannot reach 189 bars back"
    assert [c for c, _n in rh.STORED_COMPONENTS] == ["m1", "m3", "m6", "m9", "m12"]
    assert dict(rh.STORED_COMPONENTS)["m9"] == 189
    assert rh.COMPONENTS == (("m1", 21), ("m3", 63), ("m6", 126), ("m12", 252)), \
        "the screener's four stay four: m9 is a chart column, not a screener one"


def test_m9_is_ranked_like_the_other_components_over_the_same_population():
    a = [100.0] * 63 + [50.0] * 126 + [100.0] * 64       # +100% over 189 bars
    b = [100.0] * 63 + [80.0] * 126 + [100.0] * 64       # +25%
    c = [100.0] * 253                                    # 0%
    etf = [100.0] * 63 + [40.0] * 126 + [100.0] * 64     # +150%, rated, never ranked
    out = rh.compute_ratings({"A": a, "B": b, "C": c, "XLK": etf}, {"XLK"})
    assert (out["A"]["m9"], out["B"]["m9"], out["C"]["m9"]) == (99, 66, 33)
    assert out["XLK"]["m9"] == 99, "an ETF above the top reads the top percentile"
    assert out["A"]["m3"] == out["B"]["m3"] == out["C"]["m3"], "the 3M window saw no difference"
    young = rh.compute_ratings({"A": a, "YOUNG": [100.0] * 150}, set())
    assert young["YOUNG"]["m9"] is None and young["YOUNG"]["m6"] is not None


# ── the schema ──────────────────────────────────────────────────────────────

def test_the_alter_adds_m9_once_and_existing_rows_stay_null(tmp_db):
    conn = sqlite3.connect(tmp_db)
    conn.execute(PRE_ROUND2_SQL)
    conn.execute(f"INSERT INTO {rh.TABLE} ({OLD_COLS}) VALUES ('2026-11-04', 'AAA', 90, 80, 1, 2, 3, 4, 1.2, 253)")
    conn.commit()
    conn.close()
    before = _rows(tmp_db)
    with snapshot_db.connect() as c:
        rh.ensure_schema(c)
        rh.ensure_schema(c)                                  # idempotent: no second ALTER
    # Pin moved 2026-11-14 (RS screens U1): the same ALTER now also adds v1..v12 after m9.
    assert _cols(tmp_db)[-6:] == ["m9", "v1", "v3", "v6", "v9", "v12"] and _cols(tmp_db).count("m9") == 1
    assert _rows(tmp_db) == before, "the ALTER rewrites no existing value"
    assert _query(tmp_db, f"SELECT m9 FROM {rh.TABLE}") == [{"m9": None}]
    assert _query(tmp_db, "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_rsh_ticker'")


def test_reads_on_a_pre_round2_table_answer_m9_none_and_never_alter_it(tmp_db):
    conn = sqlite3.connect(tmp_db)
    conn.execute(PRE_ROUND2_SQL)
    conn.execute(f"INSERT INTO {rh.TABLE} ({OLD_COLS}) VALUES ('2026-11-04', 'AAA', 90, 80, 1, 2, 3, 4, 1.2, 253)")
    conn.commit()
    conn.close()
    got = rh.read_fields(["AAA"])["AAA"]
    assert (got["ibd"], got["m12"], got["m9"]) == (90, 4, None)
    hist = rh.ticker_history("AAA")
    assert hist[0]["m9"] is None and hist[0]["m12"] == 4
    assert rh.rating_series("AAA") == [("2026-11-04", 90)]
    assert "m9" not in _cols(tmp_db), "a read never alters the table"


def test_the_nightly_fills_m9_for_a_new_session(tmp_db):
    series = _series()
    r = rh.nightly_job(END, universe=list(series), etf_tickers={"SPY"}, bars_reader=make_reader(series, END),
                       fast_map={}, splits_reader=lambda t: [])
    assert r["ok"]
    rows = {x["ticker"]: x for x in _query(tmp_db, f"SELECT * FROM {rh.TABLE}")}
    assert all(rows[t]["m9"] is not None for t in rows)
    m9 = {t: rows[t]["m9"] for t in ("AAA", "BBB", "CCC", "DDD")}
    assert len(set(m9.values())) == 4, m9
    # 2026-11-11: m9 is the recency-weighted blend (newest quarter double), so the
    # name that LED nine months ago and faded (AAA) is now the weakest, not DDD.
    names = ("AAA", "BBB", "CCC", "DDD")
    expected = sorted(names, key=lambda t: rh.component_values(series[t])["m9"])
    assert sorted(names, key=lambda t: m9[t]) == expected
    assert expected[0] == "AAA" and m9["AAA"] == min(m9.values()), "the faded leader ranks lowest"
    assert rh.read_fields(["BBB"])["BBB"]["m9"] == rows["BBB"]["m9"]


# ── --fill-column m9 ────────────────────────────────────────────────────────

def test_fill_column_fills_only_m9_and_rewrites_nothing_else(tmp_db, tmp_path):
    series, want = _seed(tmp_db, tmp_path)
    # the nightly's session keeps its fast rating through the fill
    conn = sqlite3.connect(tmp_db)
    conn.execute(f"UPDATE {rh.TABLE} SET fast = 77 WHERE session = '2026-11-05' AND ticker = 'AAA'")
    conn.commit()
    conn.close()
    before = _rows(tmp_db)
    r = rh.fill_column("m9", 3, etf_tickers={"SPY"}, bars_reader=make_reader(series, END),
                       sessions=SESSIONS, splits_reader=lambda t: [])
    note = r["note"]
    assert r["ok"] is True and "reason" not in note, note
    assert (note["sessions"], note["sessions_stored"], note["sessions_todo"], note["sessions_filled"]) == (3, 3, 3, 3)
    assert note["mismatches"] == {"window": 0, "guard": 0, "values": 0}
    assert note["rows_filled"] == len(want) and r["rows"] == len(want)
    assert _rows(tmp_db) == before, "no other column moved, fast included"
    got = {(x["session"], x["ticker"]): x["m9"] for x in _rows(tmp_db, "session, ticker, m9")}
    assert got == want, "the fill ranks m9 exactly as the backfill would have"
    again = rh.fill_column("m9", 3, etf_tickers={"SPY"}, bars_reader=make_reader(series, END),
                           sessions=SESSIONS, splits_reader=lambda t: [])
    assert again["ok"] and again["note"]["reason"] == "nothing_to_do" and again["rows"] == 0


def test_fill_column_dry_run_checks_and_writes_nothing(tmp_db, tmp_path):
    series, want = _seed(tmp_db, tmp_path)
    before = _rows(tmp_db)
    runs_before = _query(tmp_db, f"SELECT COUNT(*) AS n FROM {rh.RUNS_TABLE}")[0]["n"]
    r = rh.fill_column("m9", 3, etf_tickers={"SPY"}, bars_reader=make_reader(series, END),
                       sessions=SESSIONS, splits_reader=lambda t: [], dry_run=True)
    assert r["ok"] is True and r["dry_run"] is True
    assert r["note"]["sessions_filled"] == 3 and r["note"]["rows_filled"] == len(want)
    assert "m9" not in _cols(tmp_db), "a dry run adds no column"
    assert _rows(tmp_db) == before
    assert _query(tmp_db, f"SELECT COUNT(*) AS n FROM {rh.RUNS_TABLE}")[0]["n"] == runs_before, "no receipt"


def test_fill_column_refuses_when_todays_bars_would_change_another_value(tmp_db, tmp_path):
    series, _want = _seed(tmp_db, tmp_path)
    moved = dict(series)
    moved["DDD"] = _walk(300, 100, [0.01, 0.01, 0.01, 0.01])  # DDD re-adjusted: a different stock now
    before = _rows(tmp_db)
    r = rh.fill_column("m9", 3, etf_tickers={"SPY"}, bars_reader=make_reader(moved, END),
                       sessions=SESSIONS, splits_reader=lambda t: [])
    note = r["note"]
    assert r["ok"] is False and note["reason"] == "would_change_other_values"
    assert note["mismatches"]["values"] > 0 and note["sessions_filled"] == 0 and note["rows_filled"] == 0
    ex = note["examples"][0]
    assert ex["kind"] == "values" and "stored_vs_now" in ex and ex["session"] in {s.isoformat() for s in SESSIONS}
    assert _rows(tmp_db) == before, "a refused run writes no value"
    assert _m9_all_null(tmp_db), "the receipt's schema check may add the empty column; no value is written"


def test_fill_column_refuses_when_todays_split_guard_would_skip_a_stored_name(tmp_db, tmp_path):
    days = _weekdays_ending(END, 300)
    series = dict(_series())
    series["SPLT"] = [100.0] * 250 + [50.0] * 50             # an unadjusted 2:1 the store rated unguarded
    _seed(tmp_db, tmp_path, series=series, splits=lambda t: [])
    declared = {"SPLT": [(days[250].isoformat(), 2.0)]}
    r = rh.fill_column("m9", 3, etf_tickers={"SPY"}, bars_reader=make_reader(series, END),
                       sessions=SESSIONS, splits_reader=lambda t: declared.get(t, []))
    assert r["ok"] is False and r["note"]["reason"] == "would_change_other_values"
    assert r["note"]["mismatches"]["guard"] == 3, "SPLT, once per stored session"
    assert {e["ticker"] for e in r["note"]["examples"] if e["kind"] == "guard"} == {"SPLT"}
    assert _m9_all_null(tmp_db)


def test_fill_column_refuses_a_stored_name_with_no_bars_today(tmp_db, tmp_path):
    series, _want = _seed(tmp_db, tmp_path)
    gone = {k: v for k, v in series.items() if k != "CCC"}
    r = rh.fill_column("m9", 3, etf_tickers={"SPY"}, bars_reader=make_reader(gone, END),
                       sessions=SESSIONS, splits_reader=lambda t: [])
    assert r["ok"] is False and r["note"]["mismatches"]["window"] == 3


def test_fill_column_is_bounded_and_resumes_newest_first(tmp_db, tmp_path):
    series, want = _seed(tmp_db, tmp_path)
    kw = dict(etf_tickers={"SPY"}, bars_reader=make_reader(series, END), sessions=SESSIONS,
              splits_reader=lambda t: [])
    first = rh.fill_column("m9", 3, max_sessions=1, **kw)
    assert first["ok"] and first["note"]["sessions_filled"] == 1
    filled = {x["session"] for x in _query(tmp_db, f"SELECT session FROM {rh.TABLE} WHERE m9 IS NOT NULL")}
    assert filled == {"2026-11-05"}, "newest first"
    rest = rh.fill_column("m9", 3, **kw)
    assert rest["note"]["sessions_todo"] == 2 and rest["note"]["sessions_filled"] == 2
    got = {(x["session"], x["ticker"]): x["m9"] for x in _rows(tmp_db, "session, ticker, m9")}
    assert got == want


def test_fill_column_refuses_an_unknown_column_and_a_bad_depth(tmp_db):
    assert rh.fill_column("ibd", 3)["note"]["reason"].startswith("column must be one of")
    assert rh.fill_column("m9", 0)["note"]["reason"].startswith("days must be")
    assert rh.fill_column("m9", 3, sessions=SESSIONS)["note"]["reason"] == "nothing_to_do", "no table yet"
    assert not _query(tmp_db, f"SELECT 1 FROM {rh.TABLE}"), "nothing rated, nothing written"


def test_the_fill_column_command_line(tmp_db, monkeypatch, capsys):
    seen = {}

    def fake(column, days, **kw):
        seen.update(column=column, days=days, **kw)
        return {"ok": True, "dry_run": kw["dry_run"], "duration_ms": 1.0,
                "note": {"sessions": 252, "sessions_stored": 252, "sessions_todo": 252, "sessions_filled": 252,
                         "rows_filled": 900, "mismatches": {"window": 0, "guard": 0, "values": 0}}}
    monkeypatch.setattr(rh, "fill_column", fake)
    monkeypatch.setattr(rh, "backfill", lambda *a, **k: pytest.fail("--fill-column never runs the backfill"))
    assert rh.main(["--backfill-days", "252", "--fill-column", "m9", "--dry-run"]) == 0
    assert seen == {"column": "m9", "days": 252, "dry_run": True, "max_sessions": None,
                    "split_fetch_budget": rh.AUTO_BUDGET}
    out = capsys.readouterr().out
    assert "rs_history fill m9 (dry run)" in out and "would_fill=252" in out
    assert out.strip().splitlines()[-1].startswith("receipt {")
    assert rh.main(["--backfill-days", "252", "--fill-column", "m9"]) == 0 and seen["dry_run"] is False
    assert rh.main(["--backfill-days", "252", "--fill-column", "ibd"]) == 2, "only a fillable column"
