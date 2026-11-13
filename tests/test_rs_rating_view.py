"""The RS Rating Reading (Deepvue round 2, 2026-11-08; `rsLine` `compute.rev` 5).

`view: "rating"` plots the stock's stored daily IBD-style rating (the nightly
`rs_rating_history` row) at each bar's session, with its 21-session average, and
`payload.ratingHistory` says where it stands and how far it moved in 20 stored
sessions. What this file holds:

* the golden case `rs_rating_view.json`, hand-checkable, through the real
  provider and a real SQLite history in `tmp_path`;
* the blanking (every other family under this view; these two columns under
  every other view), daily only, the empty / dark / short / stale states;
* the read: none at all unless the Reading, the timeframe and the flag all
  allow it, then ONE bounded query on the `(ticker, session)` index;
* the rev triangle at 5, and the alert no-move rail: RS alerts compute from
  `compute_phase1_columns` / `compute_mansfield_columns`, which rev 5 leaves
  byte-identical.

Hermetic: the provider suite's `_hermetic_reads` (no industry map, an empty
evidence dir), an injected bar reader, a stubbed cache, `SCREENER_DB_PATH` in
`tmp_path`. No network, never `C:\\data`.
"""
from __future__ import annotations

import copy
import datetime as _dt
import json
import pathlib
import re
import sqlite3

import pytest

from api.routers import signature as sig
from api.services import relative_strength as rsmod
from api.services import rs_benchmarks as rb
from api.services.screener import rs_history
from api.services.screener import snapshot_db
from api.services.signature import registry_defs as rd
from api.services.signature import rs_provider as rsp
from tests.test_indicator_golden import _rs_event_inputs, load_case
from tests.test_rs_columns_provider import _hermetic_reads, _no_cache  # noqa: F401 - fixtures by name

NB = "\u00a0"
ROOT = pathlib.Path(__file__).resolve().parent.parent


@pytest.fixture
def v4_row(monkeypatch):
    monkeypatch.setitem(rd._BY_ID, "rsLine", rd._rs_line_row(True, True))
    monkeypatch.setattr(rd, "RS_V2_ENABLED", True)
    monkeypatch.setattr(rsp, "_rs_data_generation", lambda now=None: "r-|e-")
    monkeypatch.setattr(rb, "_custom_warmed", {})
    _no_cache(monkeypatch)


@pytest.fixture
def history(tmp_path, monkeypatch):
    """A real, empty `screener.db` with the flag on: tests seed it with `_store`."""
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    monkeypatch.setenv("RS_HISTORY_ENABLED", "1")
    return tmp_path / "screener.db"


def _store(ratings: dict, ticker="NVDA"):
    """Write ``{session: ibd}`` rows for ``ticker`` through the module's own writer."""
    for s, ibd in ratings.items():
        rs_history.store_rows(s, {ticker: {"ibd": ibd, "m1": 50, "m3": 50, "m6": 50, "m9": 50, "m12": 50,
                                           "score": 1.0, "bars": 253}})


def _bars(days, start, step):
    out, c = [], float(start)
    for i, t in enumerate(days):
        o = c
        c = c * (1.0 + step * (1 if i % 3 else -1))
        out.append({"t": int(t), "o": o, "h": max(o, c) * 1.002, "l": min(o, c) * 0.998, "c": c, "v": 1000})
    return out


def _weekdays(n, end=_dt.date(2026, 11, 6)):
    out, d = [], end
    while len(out) < n:
        if d.weekday() < 5:
            out.append(int(d.strftime("%Y%m%d")))
        d -= _dt.timedelta(days=1)
    return sorted(out)


def _lane(monkeypatch, days, inputs=None, tf="D", sym="NVDA"):
    store = {"NVDA": _bars(days, 100.0, 0.01), "SPY": _bars(days, 400.0, 0.004),
             "RSP": _bars(days, 150.0, 0.004), "XLK": _bars(days, 200.0, 0.005)}
    monkeypatch.setattr(sig, "_rs_warm_bars", lambda t, tf_: None)
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", lambda s, tf_, count: list(store.get(s.upper(), []))[-count:])
    return sig._rs_line_provider(sym, tf, dict(inputs or {}))


def _spy_series(monkeypatch):
    calls = []
    real = rs_history.rating_series

    def spy(ticker, upto=None, limit=300):
        calls.append({"ticker": ticker, "upto": upto, "limit": limit})
        return real(ticker, upto=upto, limit=limit)
    monkeypatch.setattr(rs_history, "rating_series", spy)
    return calls


# ── the golden case ─────────────────────────────────────────────────────────

def test_the_golden_case_through_the_real_provider(v4_row, history, monkeypatch):
    case = load_case("rs_rating_view")
    assert case["kind"] == "rs_rating_view" and len(case["sessions"]) == 30
    _store(case["stored"])
    calls = _spy_series(monkeypatch)
    env = _lane(monkeypatch, case["sessions"], {"view": "rating"})
    assert env["columns"]["ratingLine"] == case["expected"]["ratingLine"]
    assert env["columns"]["ratingMa"] == case["expected"]["ratingMa"]
    assert env["payload"]["ratingHistory"] == case["expected"]["block"]
    assert len(calls) == 1 and calls[0]["limit"] == 30 + 20 and calls[0]["upto"] == "20261106", calls


def test_the_golden_numbers_are_the_arithmetic_the_note_states():
    """The fixture checked against its own prose, so a regenerated file that
    drifts from the hand arithmetic reds here, not only downstream."""
    case = load_case("rs_rating_view")
    vals = [case["stored"][str(t)] for t in case["sessions"] if str(t) in case["stored"]]
    assert vals == list(range(60, 84))
    line = case["expected"]["ratingLine"]
    assert line[:5] == [None] * 5 and line[17] is None and line[5] == 60 and line[29] == 83
    ma = case["expected"]["ratingMa"]
    assert [i for i, v in enumerate(ma) if v is not None] == [26, 27, 28, 29]
    assert ma[26:] == [sum(vals[k - 20:k + 1]) / 21 for k in range(20, 24)] == [70.0, 71.0, 72.0, 73.0]


# ── blanking ────────────────────────────────────────────────────────────────

def test_the_rating_view_blanks_every_other_family_and_keeps_event_columns(v4_row, history, monkeypatch):
    days = _weekdays(300)
    _store({str(t): 50 + (i % 40) for i, t in enumerate(days[-260:])})
    env = _lane(monkeypatch, days, {"view": "rating"})
    cols = env["columns"]
    assert sum(1 for v in cols["ratingLine"] if v is not None) == 260
    assert sum(1 for v in cols["ratingMa"] if v is not None) == 240
    for view, keys in rsp._RS_VIEW_FAMILIES.items():
        if view == "rating":
            continue
        for k in keys:
            assert all(v is None for v in cols[k]), (view, k)
    ratio = _lane(monkeypatch, days, {"view": "ratio"})["columns"]
    for k in ("rsNH", "crossUp", "crossDown", "mansfieldCrossUp"):
        assert cols[k] == ratio[k], f"{k}: an event column moved with the Reading"
    assert set(cols) == set(rd._rs_line_row(True, True)["columns"])


@pytest.mark.parametrize("view", ["ratio", "mansfield", "rotation", "quality", "vars"])
def test_every_other_view_blanks_the_rating_columns_and_reads_no_history(view, v4_row, history, monkeypatch):
    days = _weekdays(300)
    _store({str(t): 70 for t in days[-30:]})
    calls = _spy_series(monkeypatch)
    env = _lane(monkeypatch, days, {"view": view})
    assert all(v is None for k in rd.RS_RATING_WIRE_COLUMNS for v in env["columns"][k])
    assert calls == [], f"{view}: the history is read only under the RS Rating Reading"
    block = env["payload"]["ratingHistory"]
    assert block["reason"] == "not the chosen reading" and block["value"] is None


@pytest.mark.parametrize("tf", ["W", "M", "5", "60"])
def test_daily_charts_only(tf, v4_row, history, monkeypatch):
    days = _weekdays(300)
    _store({str(t): 70 for t in days[-30:]})
    calls = _spy_series(monkeypatch)
    env = _lane(monkeypatch, days, {"view": "rating"}, tf=tf)
    assert all(v is None for k in rd.RS_RATING_WIRE_COLUMNS for v in env["columns"][k])
    assert env["payload"]["ratingHistory"]["reason"] == "daily charts only"
    assert env["payload"]["ratingHistory"]["summary"] == "daily charts only"
    assert calls == []


# ── the empty, dark, short and stale states ─────────────────────────────────

def test_no_table_is_not_yet_rated_and_creates_nothing(v4_row, history, monkeypatch):
    env = _lane(monkeypatch, _weekdays(300), {"view": "rating"})
    assert env["payload"]["ratingHistory"]["reason"] == "not yet rated"
    assert all(v is None for v in env["columns"]["ratingLine"])
    assert not history.exists() or not sqlite3.connect(history).execute(
        "SELECT 1 FROM sqlite_master WHERE name = ?", (rs_history.TABLE,)).fetchone(), "a read creates no table"


def test_a_ticker_with_no_rows_is_not_yet_rated(v4_row, history, monkeypatch):
    days = _weekdays(300)
    _store({str(t): 70 for t in days[-30:]}, ticker="AMD")
    env = _lane(monkeypatch, days, {"view": "rating"})
    assert env["payload"]["ratingHistory"]["reason"] == "not yet rated"
    assert all(v is None for v in env["columns"]["ratingLine"])


def test_with_the_history_flag_off_nothing_is_read(v4_row, history, monkeypatch):
    days = _weekdays(300)
    _store({str(t): 70 for t in days[-30:]})
    monkeypatch.delenv("RS_HISTORY_ENABLED")
    calls = _spy_series(monkeypatch)
    env = _lane(monkeypatch, days, {"view": "rating"})
    assert calls == [] and env["payload"]["ratingHistory"]["reason"] == "the rating history is not switched on"


def test_a_short_history_states_its_length_and_draws_no_average(v4_row, history, monkeypatch):
    days = _weekdays(300)
    _store({str(t): 80 + (i % 3) for i, t in enumerate(days[-12:])})
    env = _lane(monkeypatch, days, {"view": "rating"})
    b = env["payload"]["ratingHistory"]
    assert b["reason"] is None and b["change20"] is None and b["average"] is None
    assert b["summary"] == f"{b['value']}, 12{NB}sessions of history"
    assert all(v is None for v in env["columns"]["ratingMa"])
    one = {str(days[-1]): 77}
    rs_history_db = sqlite3.connect(history)
    rs_history_db.execute(f"DELETE FROM {rs_history.TABLE}")
    rs_history_db.commit()
    rs_history_db.close()
    _store(one)
    assert _lane(monkeypatch, days, {"view": "rating"})["payload"]["ratingHistory"]["summary"] == f"77, 1{NB}session of history"


def test_a_rating_older_than_the_newest_bar_says_as_of(v4_row, history, monkeypatch):
    days = _weekdays(300)
    _store({str(t): 60 + i for i, t in enumerate(days[-31:-1])})       # nothing for the newest bar yet
    env = _lane(monkeypatch, days, {"view": "rating"})
    b = env["payload"]["ratingHistory"]
    assert b["stale"] is True and b["asof"] == "2026-11-05"
    assert b["summary"] == f"89, up{NB}20 in 20{NB}sessions · as of Nov{NB}5"
    assert env["columns"]["ratingLine"][-1] is None and env["columns"]["ratingLine"][-2] == 89


def test_a_fall_and_a_flat_read_in_plain_words(v4_row, history, monkeypatch):
    days = _weekdays(300)
    _store({str(t): 90 - i for i, t in enumerate(days[-25:])})
    assert _lane(monkeypatch, days, {"view": "rating"})["payload"]["ratingHistory"]["summary"] == \
        f"66, down{NB}20 in 20{NB}sessions"
    db = sqlite3.connect(history)
    db.execute(f"DELETE FROM {rs_history.TABLE}")
    db.commit()
    db.close()
    _store({str(t): 55 for t in days[-25:]})
    assert _lane(monkeypatch, days, {"view": "rating"})["payload"]["ratingHistory"]["summary"] == \
        f"55, unchanged in 20{NB}sessions"


def test_a_short_rated_row_is_a_gap_and_breaks_the_average_window(v4_row, history, monkeypatch):
    days = _weekdays(300)
    rows = {str(t): 70 for t in days[-25:]}
    rows[str(days[-3])] = None                                       # stored, rated short
    _store(rows)
    env = _lane(monkeypatch, days, {"view": "rating"})
    line, ma = env["columns"]["ratingLine"], env["columns"]["ratingMa"]
    assert line[-3] is None and line[-2] == 70
    assert ma[-1] is None and ma[-4] == 70.0, "an average over a gap is not a 21-session average"


# ── the read ────────────────────────────────────────────────────────────────

def test_the_series_read_walks_the_ticker_session_index(history):
    _store({"2026-11-05": 70, "2026-11-06": 71})
    conn = sqlite3.connect(history)
    try:
        # The statements the reader RUNS (one spelling, in rs_history): the walk, and the same
        # walk aggregated into one result row. Both must be the bounded index walk.
        plans = {}
        for name, sql, args in (
                ("walk", rs_history.rating_series_sql(True), ("NVDA", "2026-11-06", 50)),
                ("walk, newest", rs_history.rating_series_sql(False), ("NVDA", 50)),
                ("one step", rs_history.rating_series_one_step_sql(True), ("NVDA", "2026-11-06", 50)),
                ("one step, newest", rs_history.rating_series_one_step_sql(False), ("NVDA", 50))):
            plans[name] = " ".join(str(r[-1]) for r in conn.execute("EXPLAIN QUERY PLAN " + sql, args).fetchall())
    finally:
        conn.close()
    for name, plan in plans.items():
        assert "idx_rsh_ticker" in plan and "TEMP B-TREE" not in plan, (name, plan)
    assert rs_history.rating_series("nvda", upto="2026-11-05") == [("2026-11-05", 70)]
    assert rs_history.rating_series("NVDA", limit=1) == [("2026-11-06", 71)]
    assert rs_history.rating_series("NVDA", limit=10 ** 9) == [("2026-11-05", 70), ("2026-11-06", 71)]
    assert rs_history.rating_series("", limit=5) == [] and rs_history.rating_series("NVDA", limit=0) == []


def _spy_connect(monkeypatch):
    """Every statement `rating_series` runs, and how many result rows python took from each."""
    seen = []
    real = rs_history.snapshot_db.connect

    class Cur:
        def __init__(self, cur, sql):
            self.cur, self.sql = cur, sql

        def fetchone(self):
            row = self.cur.fetchone()
            seen.append((self.sql, 0 if row is None else 1))
            return row

        def fetchall(self):
            rows = self.cur.fetchall()
            seen.append((self.sql, len(rows)))
            return rows

    class Conn:
        def __init__(self):
            self.conn = real()

        def execute(self, sql, params=()):
            return Cur(self.conn.execute(sql, params), sql)

        def close(self):
            self.conn.close()
    monkeypatch.setattr(rs_history.snapshot_db, "connect", Conn)
    return seen


def test_the_series_comes_back_in_one_result_row_however_long_it_is(history, monkeypatch):
    """⚡ 2026-11-13: python took one row PER SESSION from sqlite (up to 2,520), re-taking the
    GIL after each: `rs-rating` 0.5 to 1.8 s on the web pod. The walk is aggregated inside
    sqlite now; what python takes is ONE row."""
    days = _weekdays(400)
    stored = {str(t): (None if i % 37 == 5 else 1 + (i * 7) % 99) for i, t in enumerate(days)}
    _store(stored)
    want = [(f"{str(t)[:4]}-{str(t)[4:6]}-{str(t)[6:]}", stored[str(t)]) for t in days]
    seen = _spy_connect(monkeypatch)
    got = rs_history.rating_series("NVDA", limit=10 ** 9)
    assert got == want, "oldest first, a short-rated session kept as a gap"
    series_reads = [(sql, n) for sql, n in seen if rs_history.TABLE in sql and "sqlite_master" not in sql]
    assert series_reads == [(rs_history.rating_series_one_step_sql(False), 1)]
    # the same answers through the bounded form and a small limit
    assert rs_history.rating_series("NVDA", upto=str(days[-3]), limit=5) == want[-7:-2]
    assert rs_history.rating_series("NVDA", limit=3) == want[-3:]
    assert rs_history.rating_series("ZZZZ", limit=10) == []


def test_a_rating_that_is_not_a_stored_integer_is_read_row_by_row_never_through_text(history, monkeypatch):
    _store({"2026-11-05": 70, "2026-11-06": 71})
    conn = sqlite3.connect(history)
    conn.execute(f"UPDATE {rs_history.TABLE} SET ibd = 70.9 WHERE session = '2026-11-05'")
    conn.commit()
    conn.close()
    seen = _spy_connect(monkeypatch)
    assert rs_history.rating_series("NVDA", limit=10) == [("2026-11-05", 70), ("2026-11-06", 71)]
    series_reads = [(sql, n) for sql, n in seen if rs_history.TABLE in sql and "sqlite_master" not in sql]
    assert series_reads == [(rs_history.rating_series_one_step_sql(False), 1), (rs_history.rating_series_sql(False), 2)]


def test_a_sqlite_without_json_functions_still_answers_row_by_row(history, monkeypatch):
    _store({"2026-11-05": 70, "2026-11-06": 71})
    real = rs_history.snapshot_db.connect

    class NoJson:
        def __init__(self):
            self.conn = real()

        def execute(self, sql, params=()):
            if "json_group_array" in sql:
                raise sqlite3.OperationalError("no such function: json_group_array")
            return self.conn.execute(sql, params)

        def close(self):
            self.conn.close()
    monkeypatch.setattr(rs_history.snapshot_db, "connect", NoJson)
    assert rs_history.rating_series("NVDA", limit=10) == [("2026-11-05", 70), ("2026-11-06", 71)]


def test_the_read_is_bounded_by_the_chart_window(v4_row, history, monkeypatch):
    days = _weekdays(900)
    _store({str(t): 70 for t in days[-400:]})
    calls = _spy_series(monkeypatch)
    env = _lane(monkeypatch, days, {"view": "rating"})
    n = len(env["times"])
    assert calls == [{"ticker": "NVDA", "upto": str(days[-1]), "limit": n + 20}]
    assert rs_history.SERIES_MAX_SESSIONS == 2520


def test_the_series_read_time_is_counted_in_the_rating_stage(v4_row, history, monkeypatch):
    days = _weekdays(300)
    _store({str(t): 70 for t in days[-30:]})
    seen = {}
    real = rsp._record_timing
    monkeypatch.setattr(rsp, "_record_timing", lambda tier, t0, stages: seen.update(stages) or real(tier, t0, stages))
    calls = []
    monkeypatch.setattr(rs_history, "rating_series",
                        lambda *a, **k: calls.append(1) or __import__("time").sleep(0.02) or [])
    _lane(monkeypatch, days, {"view": "rating"})
    assert calls and seen["rating"] >= 20.0, seen


# ── the rev triangle and the alert no-move rail ─────────────────────────────

def test_the_three_lanes_agree_on_rev_5_and_the_view_enum_is_one_list():
    from api.services import alert_rev_migration as rev
    src = (ROOT / "app/src/components/chart/engine/nativeRegistry.js").read_text(encoding="utf-8")
    m = re.search(r"fn:\s*'rsLine'\s*,\s*rev:\s*(\d+)", src)
    assert m and int(m.group(1)) == 5
    row = rd._rs_line_row(True, True)
    assert row["version"] == row["compute"]["rev"] == rev.ADDRESS_REVS["rsLine"] == 5
    assert rd._rs_line_row(True)["compute"]["rev"] == 3, "the v3 row does not move"
    view = next(i for i in row["inputs"] if i["key"] == "view")
    assert view["options"] == list(rd.RS_VIEWS) and rd.RS_VIEWS[-1] == "rating"
    block = src.split("key: 'view', type: 'enum'", 1)[1].split("tooltip:", 1)[0]
    assert re.findall(r"\['(\w+)', '", block) == list(rd.RS_VIEWS)
    assert "['rating', 'RS Rating', { requiresServer: true }]" in block
    assert set(rsp._RS_VIEW_FAMILIES) == set(rd.RS_VIEWS)
    assert rsp._RS_VIEW_FAMILIES["rating"] == rd.RS_RATING_WIRE_COLUMNS == ("ratingLine", "ratingMa")


def test_rev_5_owes_no_alert_migration_phase1_and_mansfield_stay_byte_identical(v4_row, history, monkeypatch):
    """RS alerts compute from `compute_phase1_columns` / `compute_mansfield_columns`
    (`alert_rs_series.build_rs_series`), never from the wire. Both must reproduce
    their fixtures byte for byte, before and after a rating-view envelope runs,
    and the alert lane must name neither new column nor the Reading."""
    ev = load_case("rs_events_default")
    mf = load_case("rs_mansfield")
    before = copy.deepcopy((ev["bars"], ev["benchmarkBars"], mf["bars"], mf["benchmarkBars"]))
    got = rsmod.compute_phase1_columns(ev["bars"], ev["benchmarkBars"], _rs_event_inputs(ev), short_history=True)
    man = rsmod.compute_mansfield_columns(mf["bars"], mf["benchmarkBars"], mf["params"]["length"])
    days = _weekdays(300)
    _store({str(t): 70 for t in days[-30:]})
    _lane(monkeypatch, days, {"view": "rating"})
    again = rsmod.compute_phase1_columns(ev["bars"], ev["benchmarkBars"], _rs_event_inputs(ev), short_history=True)
    man2 = rsmod.compute_mansfield_columns(mf["bars"], mf["benchmarkBars"], mf["params"]["length"])
    assert (ev["bars"], ev["benchmarkBars"], mf["bars"], mf["benchmarkBars"]) == before
    for col, exp in ev["expected"].items():
        assert json.dumps(got[col]) == json.dumps(exp) == json.dumps(again[col]), col
    for col in rsmod.PHASE2A_COLUMNS:
        assert json.dumps(man[col]) == json.dumps(mf["expected"][col]) == json.dumps(man2[col]), col
    alert_src = (ROOT / "api/services/alert_rs_series.py").read_text(encoding="utf-8")
    assert "ratingLine" not in alert_src and "ratingMa" not in alert_src and "ratingHistory" not in alert_src
    rel_src = (ROOT / "api/services/relative_strength.py").read_text(encoding="utf-8")
    assert "rating_series" not in rel_src and "ratingLine" not in rel_src, "the maths module gained no rating read"
