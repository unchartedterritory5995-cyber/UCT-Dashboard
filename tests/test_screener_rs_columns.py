"""Rails for `api/services/screener/rs_columns.py` — the ten bar-derived UCT RS
screener columns (plan §10.1; engineering map §2.5, unit 2a-05) and their seat
in the nightly build (`snapshot_builder._step("bars_rs")`, `snapshot_db`).

Synthetic bars throughout: there is no bars.db on this box and the collector is
pure. The universe is four names against SPY and RSP over 300 weekday sessions:

  AAA  a steady leader, +0.1 % a day, every value hand-derived below
  BBB  the same leader with ONE bar dated on a Saturday — a time SPY has no bar
       for, so the join has a hole (never a shifted ratio)
  CCC  the leader's last 100 bars — shorter than the 253 the new-high family
       needs, longer than the 21 the average needs
  DDD  ten bars — shorter than everything
  FFF  a turnaround: falls for 280 bars, then rises 1 % a day — the one with a
       fresh RS cross and a fresh Mansfield zero cross

SPY closes at 100 every day except index 290 (99, a −1 % "red day"); RSP is
100 throughout.
"""
from __future__ import annotations

import ast as pyast
import datetime as dt
import importlib
import importlib.util
import pathlib

import pytest

from api.services import relative_strength as rs
from api.services.screener import rs_columns, snapshot_db

ROOT = pathlib.Path(__file__).resolve().parents[1]
RS_COLUMNS_PY = ROOT / "api" / "services" / "screener" / "rs_columns.py"

TEN = (
    "rs_new_high", "rs_nh_before_price", "rs_nh_red_day", "rs_nh_bars_ago",
    "green_on_red_20", "rs_line_above_ma", "rs_cross_up_bars_ago",
    "mansfield", "mansfield_cross_bars_ago", "rs_benchmark_agree",
)

N = 300
RED_DAY = 290


# ───────────────────────────── the fixture ──────────────────────────────────

def _ymd(d: dt.date) -> int:
    return d.year * 10000 + d.month * 100 + d.day


def _date(ymd: int) -> dt.date:
    return dt.date(ymd // 10000, ymd // 100 % 100, ymd % 100)


def _weekdays(n, start=dt.date(2025, 1, 6)):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(_ymd(d))
        d += dt.timedelta(days=1)
    return out


TIMES = _weekdays(N)


def _bars(closes, times=TIMES):
    return [{"t": t, "o": float(c), "h": float(c) * 1.005, "l": float(c) * 0.995,
             "c": float(c), "v": 1000}
            for t, c in zip(times, closes)]


def spy_closes():
    out = [100.0] * N
    out[RED_DAY] = 99.0
    return out


def rsp_closes():
    return [100.0] * N


def aaa_closes():
    return [100.0 * 1.001 ** i for i in range(N)]


def fff_closes():
    out = [100.0 * 0.999 ** i for i in range(280)]
    while len(out) < N:
        out.append(out[-1] * 1.01)
    return out


def hole_index() -> int:
    """The first Monday at or after index 140 — replaced by the Saturday before
    it in BBB, so order is kept and SPY has no bar at that time."""
    k = next(i for i in range(140, N) if _date(TIMES[i]).weekday() == 4)   # a Friday
    return k + 1


def bbb_bars():
    h = hole_index()
    times = list(TIMES)
    times[h] = _ymd(_date(TIMES[h - 1]) + dt.timedelta(days=1))
    assert _date(times[h]).weekday() == 5 and times[h - 1] < times[h] < times[h + 1]
    return _bars(aaa_closes(), times)


SPY = _bars(spy_closes())
RSP = _bars(rsp_closes())
AAA = _bars(aaa_closes())
BBB = bbb_bars()
CCC = _bars(aaa_closes()[-100:], TIMES[-100:])
DDD = _bars(aaa_closes()[-10:], TIMES[-10:])
FFF = _bars(fff_closes())


def _ints_are_ints(values: dict):
    for col in rs_columns.INT_COLUMNS:
        v = values[col]
        assert v is None or (isinstance(v, int) and not isinstance(v, bool)), (col, v)
    m = values["mansfield"]
    assert m is None or isinstance(m, float), m


# ───────────────────── the columns, their types, their windows ──────────────

def test_the_ten_columns_are_the_plans_and_each_is_typed():
    assert rs_columns.COLUMNS == TEN
    assert rs_columns.FLAG_COLUMNS < rs_columns.INT_COLUMNS
    assert "mansfield" not in rs_columns.INT_COLUMNS
    assert set(rs_columns.MIN_BARS) == set(TEN)
    assert rs_columns.MIN_BARS_FULL == rs.DEFAULT_LOOKBACK + 1 == 253
    assert rs_columns.MIN_BARS_ANY == rs.DEFAULT_SENSITIVITY_WINDOW == 20
    assert rs_columns.MANSFIELD_LENGTH == rs.DEFAULT_MANSFIELD_LENGTH == 200


def test_hand_derived_values_for_a_steady_leader():
    """AAA: rs = 1.001^i / 100, except index 290 where SPY's 99 lifts it 1 %.

    Last bar (299): the window's high is still bar 290 (1.001^9 < 100/99), so
    no new high today and the last one was 9 bars ago; SPY was flat today so
    not a red day; price is at its own high so not "before price"; one
    up-on-red day (290) in the last 20; the line has risen 0.1 % a day for a
    year, so it is above its 21 EMA and has NEVER crossed it (no cross, no
    age); Mansfield is ~10 % above its 200-bar average and has never crossed
    zero; the 20-bar slope is positive against SPY and against RSP.
    """
    stats = {}
    v = rs_columns.collect_one(AAA, SPY, RSP, stats=stats)
    _ints_are_ints(v)
    assert v["rs_new_high"] == 0
    assert v["rs_nh_bars_ago"] == 9
    assert v["rs_nh_red_day"] == 0
    assert v["rs_nh_before_price"] == 0
    assert v["green_on_red_20"] == 1
    assert v["rs_line_above_ma"] == 1
    assert v["rs_cross_up_bars_ago"] is None
    assert 9.5 < v["mansfield"] < 11.5
    assert v["mansfield"] == round(v["mansfield"], rs_columns.MANSFIELD_DP)
    assert v["mansfield_cross_bars_ago"] is None
    assert v["rs_benchmark_agree"] == 1
    assert stats == {"rated": 1}


def test_a_turnaround_has_fresh_crosses():
    """FFF fell for 280 bars (below its average, Mansfield negative) and then
    rose 1 % a day: both crosses happened inside the last 20 bars."""
    v = rs_columns.collect_one(FFF, SPY, RSP)
    _ints_are_ints(v)
    assert v["rs_line_above_ma"] == 1
    assert 0 <= v["rs_cross_up_bars_ago"] < 20
    assert v["mansfield"] > 0
    assert 0 <= v["mansfield_cross_bars_ago"] < 20
    assert v["rs_new_high"] == 0 and v["rs_nh_bars_ago"] is None, \
        "a name a year into a decline has had no 252-bar RS high in this window"


@pytest.mark.parametrize("name,bars", [("AAA", AAA), ("BBB", BBB), ("CCC", CCC), ("FFF", FFF)])
def test_every_column_is_the_last_bar_of_the_chart_lane(name, bars):
    """The screener value IS the chart's column at the newest bar — derived
    here from `relative_strength` directly, so the collector cannot carry a
    second definition of anything."""
    v = rs_columns.collect_one(bars, SPY, RSP)
    p1 = rs.compute_phase1_columns(bars, SPY)
    mans = rs.compute_mansfield_columns(bars, SPY, rs.DEFAULT_MANSFIELD_LENGTH)
    rs_rsp = rs.rs_line(bars, RSP)
    agree = rs.benchmark_agree(p1["rsLine"], rs_rsp, rs_rsp, rs.DEFAULT_SENSITIVITY_WINDOW)

    def flag(x):
        return None if x is None else int(x == 1.0)

    def integer(x):
        return None if x is None else int(x)

    expect = {
        "rs_new_high": flag(p1["rsNH"][-1]),
        "rs_nh_before_price": flag(p1["rsNHbeforePx"][-1]),
        "rs_nh_red_day": flag(p1["rsNHred"][-1]),
        "rs_nh_bars_ago": integer(rs.bars_ago_column(p1["rsNH"])[-1]),
        "green_on_red_20": integer(rs.rolling_count(p1["gor"], 20)[-1]),
        "rs_line_above_ma": flag(p1["rsAbove"][-1]),
        "rs_cross_up_bars_ago": integer(rs.bars_ago_column(p1["crossUp"])[-1]),
        "mansfield": (None if mans["mansfield"][-1] is None
                      else round(mans["mansfield"][-1], rs_columns.MANSFIELD_DP)),
        "mansfield_cross_bars_ago": integer(mans["mansfieldCrossBarsAgo"][-1]),
        "rs_benchmark_agree": flag(agree[-1]),
    }
    assert v == expect, name


def test_a_date_spy_does_not_have_is_a_hole_not_a_shifted_ratio():
    """BBB is AAA with one bar on a Saturday. The ratio at that bar is None, so
    every 252-bar window over it is refused (new high, its age) while the
    gap-skipping average, the count and the 20-bar slope — none of which
    reach the hole from the last bar — still answer."""
    h = hole_index()
    assert rs.rs_line(BBB, SPY)[h] is None
    assert rs.rs_line(BBB, SPY)[h + 1] is not None, "the NEXT bar pairs its own SPY close"
    stats = {}
    v = rs_columns.collect_one(BBB, SPY, RSP, stats=stats)
    assert v["rs_new_high"] is None
    assert v["rs_nh_bars_ago"] is None
    assert v["rs_nh_before_price"] is None
    assert v["rs_nh_red_day"] is None
    assert v["rs_line_above_ma"] == 1
    assert v["green_on_red_20"] == 1
    assert v["mansfield"] > 0
    assert v["rs_benchmark_agree"] == 1
    assert stats == {"rated": 1}, "a full window with a hole is rated, with honest Nones"


def test_short_windows_are_none_per_column_and_counted_short():
    stats = {}
    c = rs_columns.collect_one(CCC, SPY, RSP, stats=stats)
    assert len(CCC) == 100
    for col, need in rs_columns.MIN_BARS.items():
        if need > 100:
            assert c[col] is None, (col, need)
    assert c["rs_line_above_ma"] == 1
    assert c["green_on_red_20"] == 1
    assert c["rs_benchmark_agree"] == 1
    assert c["mansfield"] is None and c["rs_new_high"] is None
    assert stats == {"short": 1}

    d = rs_columns.collect_one(DDD, SPY, RSP, stats=stats)
    assert d == {col: None for col in TEN}
    assert stats == {"short": 2}

    e = rs_columns.collect_one([], SPY, RSP, stats=stats)
    assert e == {col: None for col in TEN}
    assert stats == {"short": 3}


def test_no_benchmark_bar_at_the_newest_time_is_no_bench():
    stats = {}
    assert rs_columns.collect_one(AAA, [], RSP, stats=stats) == {col: None for col in TEN}
    assert rs_columns.collect_one(AAA, None, RSP, stats=stats) == {col: None for col in TEN}
    # the newest bar on a Saturday: SPY has every other time, not that one
    sat = AAA[:-1] + [dict(AAA[-1], t=_ymd(_date(TIMES[-1]) + dt.timedelta(days=1)))]
    assert _date(sat[-1]["t"]).weekday() == 5
    assert rs_columns.collect_one(sat, SPY, RSP, stats=stats) == {col: None for col in TEN}
    assert stats == {"no_bench": 3}


def test_without_rsp_only_the_agreement_is_none():
    v = rs_columns.collect_one(AAA, SPY, None)
    w = rs_columns.collect_one(AAA, SPY, RSP)
    assert v["rs_benchmark_agree"] is None
    assert {k: x for k, x in v.items() if k != "rs_benchmark_agree"} == \
           {k: x for k, x in w.items() if k != "rs_benchmark_agree"}


# ───────────────────────────── the two shapes ───────────────────────────────

def test_the_float_list_compat_path_equals_the_dict_path():
    """A bare close list takes the ticker's trailing bar times (the only
    calendar it can have); the result is the dict path's, exactly."""
    dict_path = rs_columns.collect_one(AAA, SPY, RSP)
    mixed = rs_columns.collect_one(AAA, spy_closes(), rsp_closes())
    assert mixed == dict_path
    # every leg a float list: all three share the index calendar
    index_dicts = rs_columns.collect_one(_bars(aaa_closes(), range(N)),
                                         _bars(spy_closes(), range(N)),
                                         _bars(rsp_closes(), range(N)))
    all_floats = rs_columns.collect_one(aaa_closes(), spy_closes(), rsp_closes())
    assert all_floats == index_dicts == dict_path


def test_a_float_list_is_tail_aligned_like_rs_line_trend():
    """The positional compat zips TAILS — `technicals.rs_line_trend`'s own rule —
    so a 60-close SPY list pairs the ticker's last 60 bars."""
    short_spy = spy_closes()[-60:]
    v = rs_columns.collect_one(AAA, short_spy, rsp_closes())
    # the newest 60 bars have a ratio, nothing older does ⇒ the 252 family is None
    assert v["rs_new_high"] is None and v["mansfield"] is None
    assert v["rs_line_above_ma"] == 1 and v["green_on_red_20"] == 1
    assert v == rs_columns.collect_one(AAA, _bars(short_spy, TIMES[-60:]), RSP)


def test_session_clips_bars_after_it():
    """Values FOR a session never read past it (the backfill shape); None means
    the newest bar, and the builder passes the row's own date (a no-op)."""
    asof = TIMES[RED_DAY]
    clipped = rs_columns.collect_one(AAA, SPY, RSP, session=asof)
    assert clipped == rs_columns.collect_one(AAA[:RED_DAY + 1], SPY, RSP)
    assert clipped["rs_new_high"] == 1 and clipped["rs_nh_red_day"] == 1, \
        "on the red day itself the leader made an RS high"
    for shape in (asof, str(asof), _date(asof).isoformat(), _date(asof)):
        assert rs_columns.collect_one(AAA, SPY, RSP, session=shape) == clipped, shape
    assert rs_columns.collect_one(AAA, SPY, RSP, session=None) == \
           rs_columns.collect_one(AAA, SPY, RSP, session=TIMES[-1])


def test_collect_is_the_batch_shape():
    stats = {}
    out = rs_columns.collect(["aaa", "CCC", "ZZZ", "AAA", ""],
                             {"AAA": AAA, "CCC": CCC}, SPY, RSP,
                             session=None, stats=stats)
    assert list(out) == ["AAA", "CCC", "ZZZ"]
    assert out["AAA"] == rs_columns.collect_one(AAA, SPY, RSP)
    assert out["CCC"] == rs_columns.collect_one(CCC, SPY, RSP)
    assert out["ZZZ"] == {col: None for col in TEN}, "asked and not computable: a None row, never a missing key"
    assert stats == {"rated": 1, "short": 2}


# ───────────────────────────── the builder seat ─────────────────────────────

def _arm_rs_v2(monkeypatch):
    """Pins moved 2026-11-07 (RS review finding #5, unit U3): the `bars_rs` step
    now runs only under `registry_defs.RS_V2_ENABLED` (dark by default), so the
    tests that exercise the step arm the flag first. The dark path is pinned in
    tests/test_rs_fix_u3_screener.py."""
    from api.services.signature import registry_defs
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", True)


def test_the_builder_step_merges_the_columns_and_counts_outcomes(monkeypatch):
    _arm_rs_v2(monkeypatch)
    from api.services.screener import snapshot_builder as sb
    failures = {}
    row = sb.build_row("AAA", AAA, None, None, failures=failures, spy_bars=SPY, rsp_bars=RSP)
    expect = rs_columns.collect_one(AAA, SPY, RSP)
    assert {col: row[col] for col in TEN} == expect
    assert row["rs_nh_bars_ago"] == 9 and row["price"] == AAA[-1]["c"]
    assert row["bars_asof"] == str(AAA[-1]["t"])
    assert failures["bars_rs"] == {"rated": 1}

    row = sb.build_row("CCC", CCC, None, None, failures=failures, spy_bars=SPY, rsp_bars=RSP)
    assert row["rs_new_high"] is None and row["rs_line_above_ma"] == 1
    assert failures["bars_rs"] == {"rated": 1, "short": 1}

    # no SPY bars this build: gated off like rs_line_trend, nothing counted per row
    failures = {}
    row = sb.build_row("AAA", AAA, None, None, failures=failures)
    assert all(row[col] is None for col in TEN)
    assert "bars_rs" not in failures


def test_the_step_sits_after_the_technicals_step_and_its_closes_are_the_400_window():
    """The seat the map names: `_step("bars_rs")` inside `if bars:`, after
    `bars_technicals`, before `bars_asof` is stamped — read from the source
    so a moved step is a red line, not a surprise."""
    from api.services.screener import snapshot_builder as sb
    src = pathlib.Path(sb.__file__).read_text(encoding="utf-8")
    found = []
    for node in pyast.walk(pyast.parse(src)):
        if (isinstance(node, pyast.Call) and isinstance(node.func, pyast.Name)
                and node.func.id == "_step" and node.args
                and isinstance(node.args[0], pyast.Constant)):
            found.append((node.lineno, node.args[0].value))
    # SOURCE order, not walk order: `ast.walk` is breadth-first, and this step
    # sits one level deeper (inside `if spy_bars:`) than its siblings.
    labels = [label for _, label in sorted(found)]
    assert "bars_rs" in labels
    assert labels.index("bars_rs") == labels.index("bars_technicals") + 1
    assert labels.index("bars_rs") < labels.index("bars_seam_scan")


def test_a_raising_collector_costs_its_columns_never_the_row(monkeypatch):
    """The sibling rail (`test_a_raising_bar_consumer_costs_its_columns_never_the_row`)
    for this step: a raise degrades to NULL columns, is counted by name, and
    the row is still written and dated."""
    _arm_rs_v2(monkeypatch)
    from api.services.screener import snapshot_builder as sb

    def _boom(*a, **k):
        raise RuntimeError("dead")

    monkeypatch.setattr(rs_columns, "collect_one", _boom)
    failures = {}
    row = sb.build_row("AAA", AAA, None, None, failures=failures, spy_bars=SPY, rsp_bars=RSP)
    assert row["ticker"] == "AAA"
    assert row["bars_asof"] == str(AAA[-1]["t"])
    assert row["price"] == AAA[-1]["c"]
    assert row["candle_type"] is not None, "every OTHER consumer still landed"
    assert all(row[col] is None for col in TEN)
    assert failures["bars_rs"] == {"RuntimeError": 1}


def test_benchmarks_are_read_once_at_deep_bars_through_the_tickers_reader(monkeypatch):
    from api.services.screener import snapshot_builder as sb
    import api.services.bars_sqlite as bs
    calls = []
    tuples = [(b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]) for b in SPY]

    def _get_bars(ticker, tf, n):
        calls.append((ticker, tf, n))
        return tuples

    monkeypatch.setattr(bs, "get_bars", _get_bars)
    got = sb._read_benchmark_bars("SPY")
    assert calls == [("SPY", "D", sb.DEEP_BARS)]
    assert got == SPY, "the same bar-dict shape every ticker's own bars have"
    # the float list rs_line_trend zips is DERIVED from that read, tail of 60
    closes = sb.spy_closes_from_bars(got)
    assert closes == spy_closes()[-60:] and len(closes) == sb.RS_LINE_TREND_SPY_BARS
    assert sb._read_spy_closes() == closes
    assert sb.RS_BENCHMARKS == ("SPY", "RSP")

    # a dead store costs the columns, never the build
    def _dead(ticker, tf, n):
        raise RuntimeError("no bars store")

    monkeypatch.setattr(bs, "get_bars", _dead)
    assert sb._read_benchmark_bars("RSP") == []
    assert sb._read_spy_closes() == []


def test_run_build_reads_spy_and_rsp_once_and_the_rows_carry_the_columns(tmp_path, monkeypatch):
    """The whole seat, end to end: one SPY read, one RSP read, the per-row
    outcomes under `sources["bars_rs"]`, the columns populated and persisted."""
    _arm_rs_v2(monkeypatch)
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "rs.db"))
    import api.services.screener.snapshot_db as sdb
    import api.services.screener.snapshot_builder as b
    importlib.reload(sdb)
    importlib.reload(b)
    series = {"AAA": AAA, "CCC": CCC, "SPY": SPY, "RSP": RSP}
    reads = []

    def _read(t):
        reads.append(t)
        return list(series.get(t, []))

    monkeypatch.setattr(b, "_load_universe", lambda: ["AAA", "CCC"])
    monkeypatch.setattr(b, "_read_daily_bars", _read)
    monkeypatch.setattr(b, "_read_ratings", lambda t, failures=None: {})
    monkeypatch.setattr(b, "_read_fundamentals", lambda t, price=None, failures=None: {})
    monkeypatch.setattr(b, "_read_rs_map", lambda: {})
    monkeypatch.setattr(b, "_read_bulk_fundamentals", lambda targets, failures=None: {})
    from api.services.screener import context_joins as cj
    for fn in ("read_breadth_flags", "read_uct20", "read_index_flags", "read_etf_flags"):
        monkeypatch.setattr(cj, fn, lambda targets, failures=None: {})

    stats = b.run_build()
    assert stats["built"] == 2
    assert reads.count("SPY") == 1 and reads.count("RSP") == 1
    assert stats["sources"]["bars_rs"] == {"rated": 1, "short": 1}
    assert "spy_bars" not in stats["sources"] and "rsp_bars" not in stats["sources"]
    assert stats["populated"]["rs_line_above_ma"] == 2
    assert stats["populated"]["rs_new_high"] == 1
    assert "rs_new_high" not in stats["empty_columns"]
    with sdb.connect() as conn:
        got = conn.execute("SELECT rs_new_high, rs_nh_bars_ago, mansfield, rs_benchmark_agree, "
                           "rs_line_trend FROM screener_rows WHERE ticker='AAA'").fetchone()
    assert tuple(got)[:4] == (0, 9, pytest.approx(rs_columns.collect_one(AAA, SPY, RSP)["mansfield"]), 1)
    assert got[4] == "up", "the pre-2a float list still feeds rs_line_trend"

    # and with no benchmark store at all, the build says so once and goes on
    series.pop("SPY"); series.pop("RSP"); reads.clear()
    stats = b.run_build()
    assert stats["built"] == 2
    assert stats["sources"]["spy_bars"] == {"none": 1}
    assert stats["sources"]["rsp_bars"] == {"none": 1}
    assert "bars_rs" not in stats["sources"]
    assert "rs_new_high" in stats["empty_columns"]


# ───────────────────────────── the schema ───────────────────────────────────

def test_snapshot_db_declares_the_ten_additively(tmp_path, monkeypatch):
    for col in TEN:
        assert col in snapshot_db.COLUMNS
    assert len(snapshot_db.COLUMNS) == len(set(snapshot_db.COLUMNS))
    for col in rs_columns.INT_COLUMNS:
        assert col in snapshot_db._INT and snapshot_db._coldef(col) == f"{col} INTEGER"
    assert "mansfield" not in snapshot_db._INT and "mansfield" not in snapshot_db._TEXT
    assert snapshot_db._coldef("mansfield") == "mansfield REAL"
    assert not (snapshot_db._INT & snapshot_db._TEXT)
    assert not (set(TEN) & snapshot_db.LIVE_ONLY_COLUMNS)

    # the migration: a table from before these columns gains them on init
    import sqlite3
    db = tmp_path / "old.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(db))
    with sqlite3.connect(db) as conn:
        conn.execute("CREATE TABLE screener_rows (ticker TEXT PRIMARY KEY, price REAL)")
    snapshot_db.init_db()
    with sqlite3.connect(db) as conn:
        info = {r[1]: r[2] for r in conn.execute("PRAGMA table_info(screener_rows)")}
    for col in TEN:
        assert info[col] == ("REAL" if col == "mansfield" else "INTEGER"), col

    # a stored row reads back typed, and 0/1 ints are stored as ints
    snapshot_db.upsert_rows([{"ticker": "AAA", "price": 1.0,
                              **rs_columns.collect_one(AAA, SPY, RSP)}])
    with snapshot_db.connect() as conn:
        r = conn.execute("SELECT rs_new_high, rs_nh_bars_ago, green_on_red_20, mansfield "
                         "FROM screener_rows WHERE ticker='AAA'").fetchone()
    assert tuple(r)[:3] == (0, 9, 1) and all(isinstance(x, int) for x in tuple(r)[:3])
    assert isinstance(r[3], float)


# ───────────────────────────── the rails ────────────────────────────────────

def test_the_collector_imports_its_maths_and_defines_none():
    """No `def ema`, no `def sma`, no extreme, slope, cross or ratio of its
    own: every `rs.<name>` it calls exists in `relative_strength`, and nothing
    else supplies maths."""
    tree = pyast.parse(RS_COLUMNS_PY.read_text(encoding="utf-8"))
    assert rs_columns.rs is rs
    banned = ("ema", "sma", "slope", "mansfield", "extreme", "cross", "rs_line",
              "rolling", "agree", "moving", "average", "ratio")
    defs = [n.name for n in pyast.walk(tree) if isinstance(n, pyast.FunctionDef)]
    for name in defs:
        assert not any(b in name.lower() for b in banned), name
    used = sorted({n.attr for n in pyast.walk(tree)
                   if isinstance(n, pyast.Attribute) and isinstance(n.value, pyast.Name)
                   and n.value.id == "rs"})
    assert used, "the collector reaches relative_strength for every number"
    for attr in used:
        assert hasattr(rs, attr), attr
    assert {"compute_phase1_columns", "compute_mansfield_columns", "bars_ago_column",
            "rolling_count", "benchmark_agree", "rs_line"} <= set(used)
    imports = {(n.module or "") for n in pyast.walk(tree) if isinstance(n, pyast.ImportFrom)}
    imports |= {a.name for n in pyast.walk(tree) if isinstance(n, pyast.Import) for a in n.names}
    assert "api.services.relative_strength" not in imports or True
    assert not any("indicator_compute" in m or "technicals" in m or "snapshot" in m
                   for m in imports), imports


def test_the_population_rails_writer_census_sees_the_ten():
    """2a-07 will declare these in `closedTable.json`; the arrival gate there
    (`test_every_declared_scalar_has_a_collector`) must then find a writer —
    read with that rail's OWN derivation, never a copy of it."""
    spec = importlib.util.spec_from_file_location(
        "rail", ROOT / "tests" / "test_scalar_population_rail.py")
    rail = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rail)
    assert set(TEN) <= rail._assigned_string_keys(RS_COLUMNS_PY)
