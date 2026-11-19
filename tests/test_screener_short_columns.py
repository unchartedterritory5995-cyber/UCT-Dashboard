"""The Screener's two short-interest columns (`short_float_pct`, `short_ratio`) and their ONE
writer, `api/services/screener/short_columns.py`.

What is held here:
  * a stock the held FINRA list has takes the list's figure: days to cover as the list gives it,
    percent of float as the list's shares short over TONIGHT'S float;
  * a stock the list does not have, every stock when no list is held (never built, refused by the
    data plan, failed, or unreadable), and one column the list cannot give for a stock it has,
    take the nightly export's figure, as before;
  * a number nobody has is ABSENT (NULL in the row), never 0; a real 0 is a 0;
  * units do not move: the percent is a percent (30.0, never 0.30), the ratio is days;
  * one `[screener-short]` line per read with the counts and the median absolute difference
    between the two sources, and no ticker in it; the same counts are in the build's stats;
  * the read is READ ONLY: every function of `short_data` that could start a build or reach the
    vendor is replaced by one that fails the test if called.

No test here reaches a vendor: the list is put in place by hand or stubbed at its accessor.
"""
from __future__ import annotations

import datetime
import importlib
import inspect
import json
import logging
import re
import time

import pytest

from api.services import short_data as sd
from api.services.screener import finviz_universe as fv
from api.services.screener import short_columns as sc

DAY, PREV = "2026-10-30", "2026-10-15"
LOGGER = "api.services.screener.short_columns"

# What the nightly export holds. A key that is absent is a figure the export does not have.
EXPORT = {
    "AAA": {"float_shares": 10_000_000.0, "short_float_pct": 28.5, "short_ratio": 5.5, "inst_pct": 40.0},
    "BBB": {"float_shares": 2_000_000.0, "short_float_pct": 31.0, "short_ratio": 1.0},
    "CCC": {"short_float_pct": 12.0},                                  # no float on file, no ratio
    "EEE": {"float_shares": 7_000_000.0, "short_ratio": 2.2},          # no percent
    "FFF": {"float_shares": 4_000_000.0, "short_float_pct": 4.4, "short_ratio": 3.3},
    "GGG": {},                                                         # a row with nothing in it
    "ZERO": {"float_shares": 5_000_000.0, "short_float_pct": 0.3},
    "OVER": {"float_shares": 1_000_000.0, "short_float_pct": 95.0, "short_ratio": 2.9},
}
# What the held FINRA list holds: (shares short, days to cover). HHH is in neither source.
LISTED = {
    "AAA": (3_000_000, 6.0),
    "BBB": (600_000, 1.2),
    "CCC": (900_000, 9.0),
    "EEE": (700_000, None),         # the report gave no days to cover
    "ZERO": (0, 0.0),               # nobody is short: a real zero
    "OVER": (1_200_000, 2.0),       # 120% of tonight's float: not the same share count
}
TARGETS = ["AAA", "BBB", "CCC", "EEE", "FFF", "GGG", "HHH", "ZERO", "OVER"]


def _write_export(tmp_path, monkeypatch, rows=None, *, as_of=None, missing_headers=()):
    rows = dict(EXPORT if rows is None else rows)
    for i in range(fv._MIN_ROWS):
        rows.setdefault(f"PAD{i}", {})
    path = tmp_path / "finviz.json"
    path.write_text(json.dumps({"as_of": as_of or fv._now_iso(), "missing_headers": list(missing_headers),
                                "rows": rows}))
    monkeypatch.setenv("SCREENER_FINVIZ_ARTIFACT", str(path))
    return path


def _held(listed=None):
    """The list as `short_data` holds it, assembled by its own pure assembler (no vendor)."""
    listed = LISTED if listed is None else listed
    rows = [{"ticker": sym.replace("-", "."), "settlement_date": DAY, "short_interest": short,
             "avg_daily_volume": 1_000_000, "days_to_cover": dtc} for sym, (short, dtc) in listed.items()]
    return sd.assemble_market(DAY, rows, PREV, [], frozenset(listed) | {"HHH", "FFF", "GGG"}, {}, "missing",
                              vendor_rows=len(rows), read_at="2026-11-18T08:00:00+00:00")


# Everything of `short_data` the Screener's reader may run, and the pure arithmetic this file uses
# to put a list in place (`assemble_market` and what it calls: no vendor, no thread, no disk).
# Every OTHER function of the module is a builder, a vendor read or a writer as far as this file is
# concerned, and fails the test if it is called.
READ_ONLY = {"held_market_rows", "_held_market", "_load_disk", "_market_block", "publication_estimate",
             "pct_of_float", "_iso", "_num", "_disk_path", "_data_dir", "reset_for_tests",
             "assemble_market", "house_symbol", "change_of", "_now_iso"}


@pytest.fixture
def no_builds(monkeypatch, tmp_path):
    """`short_data` with nothing held, its disk under tmp, and every function that is not on the
    read-only list replaced by one that records the call and raises. Yields the list of calls."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    sd.reset_for_tests()
    called: list[str] = []
    guarded = []
    for name, fn in inspect.getmembers(sd, inspect.isfunction):
        if fn.__module__ != sd.__name__ or name in READ_ONLY:
            continue

        def boom(*a, _name=name, **k):
            called.append(_name)
            raise AssertionError(f"short_data.{_name} was called from a Screener read")
        monkeypatch.setattr(sd, name, boom)
        guarded.append(name)
    # the builders the brief names are all behind the guard, by name
    for must in ("_start_market_job", "_market_bg", "build_market", "get_market", "warm_market", "get_stock",
                 "build_stock", "_stock_bg", "_vendor_page", "_vendor_rows", "_newest_day", "_report",
                 "start_market_warmer", "_warm_loop", "_read", "_section", "read_floats", "_save_disk"):
        assert must in guarded, must
    yield called
    monkeypatch.undo()
    sd.reset_for_tests()


def _hold(held):
    with sd._lock:
        sd._market.update({"held": held, "loaded": True, "checked": time.time()})


@pytest.fixture
def world(no_builds, tmp_path, monkeypatch):
    """The export on disk and the list held in memory. Yields the builder-call list."""
    _write_export(tmp_path, monkeypatch)
    _hold(_held())
    return no_builds


def _read(targets=TARGETS, failures=None):
    receipt: dict = {}
    out = sc.read_short_columns(targets, failures=failures, receipt=receipt)
    return out, receipt


# ── the list wins; units ─────────────────────────────────────────────────────────────────────

def test_a_stock_the_list_has_takes_the_lists_figures_not_the_exports(world):
    out, receipt = _read()
    # AAA: 3,000,000 short over tonight's 10,000,000 float; the export said 28.5% and 5.5 days
    assert out["AAA"] == {"short_float_pct": 30.0, "short_ratio": 6.0}
    assert out["BBB"] == {"short_float_pct": 30.0, "short_ratio": 1.2}
    assert receipt["list"] == "held" and receipt["settlement_date"] == DAY
    assert receipt["publication_estimate"] == sd.publication_estimate(DAY)
    assert receipt["list_read_at"] == "2026-11-18T08:00:00+00:00"
    assert world == []


def test_the_percent_is_a_percent_and_the_ratio_is_days_the_units_do_not_move(world, tmp_path, monkeypatch):
    """`short_float_pct` is on the 0-100 scale from BOTH sources (30.0 means 30%, never 0.30) and
    `short_ratio` is days to cover from both, so the filter, the column view and the Watchlist
    fact columns read the same thing they read before."""
    out, _ = _read()
    short, dtc = LISTED["AAA"]
    assert out["AAA"]["short_float_pct"] == pytest.approx(short / EXPORT["AAA"]["float_shares"] * 100.0)
    assert out["AAA"]["short_float_pct"] != pytest.approx(short / EXPORT["AAA"]["float_shares"])   # not a fraction
    assert out["AAA"]["short_ratio"] == dtc
    # the export's leg is the same scale: FFF is not in the list
    assert out["FFF"] == {"short_float_pct": 4.4, "short_ratio": 3.3}
    # one row's three numbers agree: percent x float = FINRA's shares short
    assert out["AAA"]["short_float_pct"] / 100.0 * EXPORT["AAA"]["float_shares"] == pytest.approx(short)

    # what reads the columns still means the same thing
    from api.services.screener import filters, snapshot_db
    import api.routers.watchlists as wl
    assert filters.FILTERS["short_float_pct"]["unit"] == "%"
    assert filters.FILTERS["short_float_pct"]["label"] == "Short % of Float"
    assert filters.FILTERS["short_ratio"]["label"] == "Short Ratio (Days to Cover)"
    assert filters.FILTERS["short_ratio"].get("unit") is None
    view = filters.VIEWS["ownership"]["columns"]
    assert "short_float_pct" in view and "short_ratio" in view
    assert {"short_float_pct", "short_ratio"} <= set(wl._FACT_FIELDS)

    # and a member's "over 20%" / "5 days or more" finds the stock, through the real scan
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "scan.db"))
    importlib.reload(snapshot_db)
    snapshot_db.init_db()
    snapshot_db.upsert_rows([{"ticker": t, **out[t], "snapshot_date": "2026-11-18", "built_at": 1}
                             for t in ("AAA", "FFF", "GGG")])
    from api.services.screener import query
    importlib.reload(query)

    def tickers(spec):
        return sorted(r["ticker"] for r in query.run_scan(spec)["rows"])
    assert tickers({"filters": [{"key": "short_float_pct", "op": "gte", "min": 20}]}) == ["AAA"]
    assert tickers({"filters": [{"key": "short_float_pct", "op": "lte", "max": 5}]}) == ["FFF"]   # GGG is NULL
    assert tickers({"filters": [{"key": "short_ratio", "op": "gte", "min": 5}]}) == ["AAA"]


def test_a_class_share_is_found_under_the_house_spelling(world):
    _hold(_held({"BRK-B": (1_500_000, 0.5)}))
    out, receipt = _read(["BRK.B", "BRK-B"])
    assert out["BRK.B"] == {"short_ratio": 0.5} == out["BRK-B"]
    assert receipt["in_list"] == 2


# ── the export is the fallback ───────────────────────────────────────────────────────────────

def test_a_stock_the_list_does_not_have_takes_the_exports_figures(world):
    out, receipt = _read()
    assert out["FFF"] == {"short_float_pct": EXPORT["FFF"]["short_float_pct"],
                          "short_ratio": EXPORT["FFF"]["short_ratio"]}
    assert receipt["in_list"] == 6


def test_one_column_the_list_cannot_give_takes_the_exports_and_the_other_stays_the_lists(world):
    out, _ = _read()
    # CCC: no float tonight, so no percent from the list; its days to cover is the list's
    assert out["CCC"] == {"short_float_pct": 12.0, "short_ratio": 9.0}
    # EEE: the report has no days to cover; its percent is the list's
    assert out["EEE"] == {"short_float_pct": 10.0, "short_ratio": 2.2}


def test_a_percent_over_the_screeners_bound_is_not_written_from_the_list(world):
    """1,200,000 short over a 1,000,000 float is 120%: the two figures are not the same share
    count. The Screener holds the column to [0, 100], so the list's figure is withheld and counted
    and the export's stands, as it did before. Its days to cover is still the list's."""
    out, receipt = _read()
    assert sc.PCT_MAX == 100.0
    assert out["OVER"] == {"short_float_pct": 95.0, "short_ratio": 2.0}
    assert receipt["withheld"] == 1
    # the Terminal's own guard (150%) is counted the same way
    _hold(_held({"OVER": (1_600_000, 2.0)}))
    out, receipt = _read(["OVER"])
    assert out["OVER"]["short_float_pct"] == 95.0 and receipt["withheld"] == 1


@pytest.mark.parametrize("answer, state", [
    (None, "not_held"),
    ({"status": "unavailable", "reason": "refused", "http_status": 403, "source": "x"}, "unavailable"),
    ({"status": "failed", "reason": "error", "http_status": None, "source": "x"}, "failed"),
])
def test_with_no_list_held_every_stock_takes_the_exports_figures(no_builds, tmp_path, monkeypatch, answer, state):
    """Never built, refused by the data plan, or failed: the Screener shows what it showed before."""
    _write_export(tmp_path, monkeypatch)
    if answer is not None:
        with sd._lock:
            sd._market.update({"loaded": True, "block": (time.time() + 600, answer)})
    assert sd.held_market_rows() == (answer, "not_held")
    out, receipt = _read()
    for sym in TARGETS:
        want = {k: v for k, v in EXPORT.get(sym, {}).items() if k in ("short_float_pct", "short_ratio")}
        assert out[sym] == want, sym
    assert receipt["list"] == state and receipt["settlement_date"] is None and receipt["in_list"] == 0
    assert receipt["short_float_pct"]["list"] == 0 == receipt["short_ratio"]["list"]
    assert receipt["short_float_pct"]["export"] == 6 and receipt["short_ratio"]["export"] == 5
    assert receipt["short_float_pct"]["median_abs_diff"] is None
    assert no_builds == []


def test_a_list_that_cannot_be_read_is_counted_and_the_exports_figures_survive(world, monkeypatch):
    def gone():
        raise RuntimeError("the list is gone")
    monkeypatch.setattr(sd, "held_market_rows", gone)
    failures: dict = {}
    out, receipt = _read(failures=failures)
    assert out["AAA"] == {"short_float_pct": 28.5, "short_ratio": 5.5}
    assert receipt["list"] == "error" and failures["short_columns"] == {"list_error:RuntimeError": 1}


def test_a_list_held_only_on_disk_is_read_without_a_build(no_builds, tmp_path, monkeypatch):
    """After a restart the web process holds nothing in memory: the copy the last build left on the
    data volume is what the snapshot reads, and reading it starts nothing."""
    _write_export(tmp_path, monkeypatch)
    path = tmp_path / "short_data" / f"market_v{sd.DISK_VERSION}.json"
    path.parent.mkdir()
    path.write_text(json.dumps({"held": _held(), "checked": time.time()}))
    out, receipt = _read()
    assert receipt["list"] == "held" and out["AAA"] == {"short_float_pct": 30.0, "short_ratio": 6.0}
    assert no_builds == []


# ── a missing number is missing ──────────────────────────────────────────────────────────────

def test_a_number_nobody_has_is_absent_never_zero_and_a_real_zero_is_a_zero(world):
    out, _ = _read(TARGETS + ["not a symbol!"])
    assert out["GGG"] == {} and out["HHH"] == {} and out["NOT A SYMBOL!"] == {}
    for row in out.values():
        for value in row.values():
            assert value is not None                 # absent, not None-valued
    # nobody short: the list says 0 shares and 0 days, and that is what the row says
    assert out["ZERO"] == {"short_float_pct": 0.0, "short_ratio": 0.0}
    # the empty state reaches the row as NULL
    from api.services.screener import snapshot_builder
    bars = [{"t": 20261116 + i, "o": 10.0, "h": 10.5, "l": 9.5, "c": 10.0, "v": 1000} for i in range(3)]
    row = snapshot_builder.build_row("GGG", bars, None, None, market_row=out["GGG"])
    assert row["short_float_pct"] is None and row["short_ratio"] is None
    row = snapshot_builder.build_row("ZERO", bars, None, None, market_row=out["ZERO"])
    assert row["short_float_pct"] == 0.0 and row["short_ratio"] == 0.0


def test_figures_that_are_not_numbers_are_dropped_not_written(no_builds, tmp_path, monkeypatch):
    _write_export(tmp_path, monkeypatch, {
        "AAA": {"float_shares": True, "short_float_pct": "12", "short_ratio": None},
        "BBB": {"float_shares": 0, "short_float_pct": -3.0, "short_ratio": float("nan")},
        "CCC": {"float_shares": 1_000_000.0, "short_float_pct": 2.0, "short_ratio": 1.0}})
    held = _held({"AAA": (3_000_000, 6.0), "BBB": (600_000, 1.2), "CCC": (900_000, 9.0)})
    held["rows"][0]["days_to_cover"] = "6"           # not a number
    held["rows"][1]["short_interest"] = None
    held["rows"][2]["days_to_cover"] = -1.0          # not a day count
    _hold(held)
    out, _ = _read(["AAA", "BBB", "CCC"])
    assert out["AAA"] == {} and out["BBB"] == {"short_ratio": 1.2}
    assert out["CCC"] == {"short_float_pct": 90.0, "short_ratio": 1.0}


# ── the receipt and the one log line ─────────────────────────────────────────────────────────

def test_one_log_line_says_how_many_took_each_source_and_how_far_apart_they_are(world, caplog):
    with caplog.at_level(logging.INFO, logger=LOGGER):
        out, receipt = _read()
    lines = [r.getMessage() for r in caplog.records if r.name == LOGGER]
    assert len(lines) == 1 and lines[0].startswith("[screener-short] ")
    assert receipt["targets"] == 9 and receipt["in_list"] == 6 and receipt["withheld"] == 1
    # percent: the list for AAA BBB EEE ZERO; the export for CCC FFF OVER (CCC and OVER are IN the
    # list); nothing for GGG HHH. Both sources have one for AAA (1.5 apart), BBB (1.0), ZERO (0.3).
    assert receipt["short_float_pct"] == {"list": 4, "export": 3, "export_in_list": 2, "none": 2, "both": 3,
                                          "median_abs_diff": 1.0}
    # ratio: the list for AAA BBB CCC ZERO OVER; the export for EEE FFF (EEE is in the list);
    # nothing for GGG HHH. Both for AAA (0.5 apart), BBB (0.2), OVER (0.9).
    assert receipt["short_ratio"] == {"list": 5, "export": 2, "export_in_list": 1, "none": 2, "both": 3,
                                      "median_abs_diff": 0.5}
    # every stock is counted once per column
    for col in ("short_float_pct", "short_ratio"):
        t = receipt[col]
        assert t["list"] + t["export"] + t["none"] == receipt["targets"]
        assert sum(1 for row in out.values() if col in row) == t["list"] + t["export"]
    assert lines[0] == "[screener-short] " + sc.log_text(receipt)
    assert lines[0] == (
        "[screener-short] list=held settlement=2026-10-30 targets=9 in_list=6 withheld=1 | "
        "short_float_pct list=4 export=3 export_in_list=2 none=2 both=3 median_abs_diff=1.0 | "
        "short_ratio list=5 export=2 export_in_list=1 none=2 both=3 median_abs_diff=0.5")
    # counts only: no ticker is in the line
    assert not re.search(r"\b[A-Z]{2,5}\b", lines[0])
    for sym in TARGETS:
        assert sym not in lines[0].split()


# ── the export's own leg ─────────────────────────────────────────────────────────────────────

def test_the_exports_leg_reads_three_figures_and_counts_a_missing_or_stale_file(tmp_path, monkeypatch):
    _write_export(tmp_path, monkeypatch)
    assert fv.read_short_export(["aaa", "CCC", "GGG", "HHH"]) == {
        "AAA": {"short_float_pct": 28.5, "short_ratio": 5.5, "float_shares": 10_000_000.0},
        "CCC": {"short_float_pct": 12.0}, "GGG": {}, "HHH": {}}
    # a header the pull did not find is absent from every stock
    _write_export(tmp_path, monkeypatch, missing_headers=["short_ratio"])
    assert fv.read_short_export(["AAA"]) == {"AAA": {"short_float_pct": 28.5, "float_shares": 10_000_000.0}}
    # stale: served and counted, under this reader's own name
    old = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=6)).isoformat()
    _write_export(tmp_path, monkeypatch, as_of=old)
    failures: dict = {}
    assert fv.read_short_export(["FFF"], failures)["FFF"]["short_ratio"] == 3.3
    assert list(failures) == ["short_columns"] and list(failures["short_columns"]) == ["export_stale:6d"]
    # missing: nothing, counted once
    monkeypatch.setenv("SCREENER_FINVIZ_ARTIFACT", str(tmp_path / "nope.json"))
    failures = {}
    assert fv.read_short_export(["AAA"], failures) == {}
    assert failures == {"short_columns": {"export_missing": 1}}


def test_with_no_export_the_list_still_gives_days_to_cover_and_the_percent_is_absent(no_builds, tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_FINVIZ_ARTIFACT", str(tmp_path / "nope.json"))
    _hold(_held())
    failures: dict = {}
    out, receipt = _read(failures=failures)
    assert out["AAA"] == {"short_ratio": 6.0} and out["FFF"] == {}
    assert receipt["short_float_pct"]["none"] == 9 and receipt["short_ratio"]["list"] == 5
    assert failures == {"short_columns": {"export_missing": 1}}


# ── the nightly build ────────────────────────────────────────────────────────────────────────

def _weekday_ymds(n):
    out, d = [], datetime.date.today()
    while len(out) < n:
        if d.weekday() < 5:
            out.append(int(d.strftime("%Y%m%d")))
        d -= datetime.timedelta(days=1)
    return list(reversed(out))


def _build(monkeypatch, tmp_path, tickers):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    from api.services.screener import snapshot_builder as sb
    from api.services.screener import (earnings_dates, earnings_context, analyst_pass, insider_capture,
                                       context_joins as cj)
    import api.services.bars_sqlite as bs
    bars = [(ymd, 100.0, 100.5, 99.5, 100.0, 1000) for ymd in _weekday_ymds(60)]
    monkeypatch.setattr(sb, "_load_universe", lambda: list(tickers))
    monkeypatch.setattr(bs, "get_bars", lambda t, tf, n: bars)
    monkeypatch.setattr(sb, "_read_rs_map", lambda: {})
    monkeypatch.setattr(sb, "_read_bulk_fundamentals", lambda t, failures=None: {})
    monkeypatch.setattr(sb, "_read_ratings", lambda t, failures=None: {})
    monkeypatch.setattr(sb, "_read_fundamentals", lambda t, price=None, failures=None: {})
    monkeypatch.setattr(sb, "_read_spy_closes", lambda: [])
    for fn in ("read_breadth_flags", "read_uct20", "read_index_flags", "read_etf_flags"):
        monkeypatch.setattr(cj, fn, lambda targets, failures=None: {})
    for mod, fn in ((earnings_dates, "read_earnings_dates"), (earnings_context, "read_last_report_move"),
                    (earnings_context, "read_implied_context"), (analyst_pass, "read_analyst_fields"),
                    (insider_capture, "read_insider_fields")):
        monkeypatch.setattr(mod, fn, lambda targets, failures=None: {})
    return sb.run_build(max_tickers=len(tickers))


def test_the_nightly_build_writes_the_lists_figures_and_never_starts_a_short_interest_build(
        world, tmp_path, monkeypatch, caplog):
    """The whole path: the real builder, the real reader, the real read-only accessor over a held
    list, the real export reader. Every other function of `short_data` fails the test if called."""
    from api.services.screener import snapshot_db
    reads = []
    real = sc.read_short_columns

    def counted(targets, failures=None, receipt=None):
        reads.append(len(list(targets)))
        return real(targets, failures=failures, receipt=receipt)
    monkeypatch.setattr(sc, "read_short_columns", counted)
    with caplog.at_level(logging.INFO, logger=LOGGER):
        stats = _build(monkeypatch, tmp_path, TARGETS)
    assert stats["built"] == len(TARGETS)
    assert world == [], f"the snapshot build called short_data builders: {world}"
    with sd._lock:
        assert sd._market["inflight"] is None
    assert reads == [len(TARGETS)]                                   # one read per build, never per stock
    lines = [r.getMessage() for r in caplog.records if r.name == LOGGER]
    assert len(lines) == 1 and lines[0].startswith("[screener-short] list=held settlement=2026-10-30 targets=9")

    aaa = snapshot_db.get_row("AAA")
    assert (aaa["short_float_pct"], aaa["short_ratio"]) == (30.0, 6.0)      # the list, not 28.5 / 5.5
    assert aaa["float_shares"] == 10_000_000.0 and aaa["inst_pct"] == 40.0  # the export's other columns still land
    assert aaa["short_float_pct"] / 100.0 * aaa["float_shares"] == pytest.approx(LISTED["AAA"][0])
    fff = snapshot_db.get_row("FFF")
    assert (fff["short_float_pct"], fff["short_ratio"]) == (4.4, 3.3)       # not in the list: the export
    for sym in ("GGG", "HHH"):
        row = snapshot_db.get_row(sym)
        assert row is not None and row["short_float_pct"] is None and row["short_ratio"] is None
    zero = snapshot_db.get_row("ZERO")
    assert (zero["short_float_pct"], zero["short_ratio"]) == (0.0, 0.0)

    # what the read did is kept in the build's stats, counts only
    assert stats["short_columns"]["list"] == "held" and stats["short_columns"]["settlement_date"] == DAY
    assert stats["short_columns"]["short_float_pct"]["list"] == 4
    assert stats["short_columns"]["short_ratio"]["median_abs_diff"] == 0.5
    assert "short_columns" not in stats["sources"]                    # nothing degraded


def test_the_build_falls_back_to_the_export_when_nothing_is_held_and_still_starts_nothing(
        no_builds, tmp_path, monkeypatch):
    from api.services.screener import snapshot_db
    _write_export(tmp_path, monkeypatch)
    stats = _build(monkeypatch, tmp_path, ["AAA", "GGG"])
    assert stats["built"] == 2 and no_builds == []
    aaa = snapshot_db.get_row("AAA")
    assert (aaa["short_float_pct"], aaa["short_ratio"]) == (28.5, 5.5)
    assert snapshot_db.get_row("GGG")["short_float_pct"] is None
    assert stats["short_columns"]["list"] == "not_held"


def test_a_reader_that_raises_costs_only_its_two_columns_and_is_reported(world, tmp_path, monkeypatch):
    from api.services.screener import snapshot_db

    def boom(targets, failures=None, receipt=None):
        raise RuntimeError("dead")
    monkeypatch.setattr(sc, "read_short_columns", boom)
    stats = _build(monkeypatch, tmp_path, ["AAA"])
    assert stats["built"] == 1 and stats["sources"]["short_columns"] == {"RuntimeError": 1}
    aaa = snapshot_db.get_row("AAA")
    assert aaa["short_float_pct"] is None and aaa["float_shares"] == 10_000_000.0
    assert stats["short_columns"] == {}


def test_the_two_columns_have_exactly_one_writer_among_the_builders_readers(world):
    """The export's reader, whose dict is merged into a row as it stands, no longer carries the two
    columns; the new reader carries those two and nothing else."""
    export_row = fv.read_finviz_fields(["AAA"])["AAA"]
    short_row = sc.read_short_columns(["AAA"])["AAA"]
    assert set(short_row) == {"short_float_pct", "short_ratio"}
    assert not (set(export_row) & set(short_row))
    assert export_row["float_shares"] == 10_000_000.0
    # and the census the population rail reads sees this module as their writer
    import pathlib
    from tests.test_scalar_population_rail import _assigned_string_keys
    assert {"short_float_pct", "short_ratio"} <= _assigned_string_keys(pathlib.Path(sc.__file__))
