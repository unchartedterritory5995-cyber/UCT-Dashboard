"""The screener's RS Exit Warning columns (2026-11-13): the chart's rsExit maths
(PR #1136), one implementation, read into five nightly columns.

    rs_exit_last             Quick Break | Quicksand | Grateful Dead Break (newest; worse on a tie)
    rs_exit_bars_ago         sessions since that newest warning (0 = the newest bar)
    rs_quick_break_bars_ago  sessions since the last Quick Break
    rs_quicksand_bars_ago    sessions since the last Quicksand
    rs_dead_break_bars_ago   sessions since the last Grateful Dead Break

The hand-derived rows are #1136's own fixtures (`tests/test_rs_exit_math.py` CLOSES,
`tests/test_rs_exit_rows.py`'s Quicksand and tie series) at fast 2 / slow 3, the
lengths those fixtures were worked out on paper for. The production lengths
(daily 21 / 50) are then checked against the chart provider's own legend on a
realistic series, so the screener and the chart name the same warning.
"""
from __future__ import annotations

import importlib
import random

import pytest

from api.services import relative_strength as rsm
from api.services.screener import filters
from api.services.screener import rs_columns as rc


def _bars(closes, start_t=1_000):
    return [{"t": start_t + i, "o": c, "h": c, "l": c, "c": float(c), "v": 1} for i, c in enumerate(closes)]


def _exit(values):
    return {k: values[k] for k in rc.EXIT_COLUMNS}


@pytest.fixture
def paper_lengths(monkeypatch):
    """#1136's fixtures were derived at fast 2 / slow 3; the window rule follows (slow + 1)."""
    monkeypatch.setattr(rc, "EXIT_FAST", 2)
    monkeypatch.setattr(rc, "EXIT_SLOW", 3)
    monkeypatch.setattr(rc, "EXIT_MIN_BARS", 4)


# ── hand-derived rows (#1136's fixtures) ─────────────────────────────────────

def test_the_math_fixture_quick_breaks_and_dead_breaks_no_quicksand(paper_lengths):
    # tests/test_rs_exit_math.py CLOSES vs a flat 100 benchmark: Quick Break at i3, i5, i7;
    # Grateful Dead at i3, i5; no Quicksand (every dip recovers above the fast average first).
    closes = [100.0, 100.0, 100.0, 80.0, 92.0, 60.0, 72.0, 40.0]
    got = _exit(rc.collect_one(_bars(closes), _bars([100.0] * 8)))
    assert got == {"rs_exit_last": "Quick Break", "rs_exit_bars_ago": 0,
                   "rs_quick_break_bars_ago": 0, "rs_quicksand_bars_ago": None,
                   "rs_dead_break_bars_ago": 2}


def test_a_quicksand_on_the_newest_bar_is_named_and_aged_zero(paper_lengths):
    # tests/test_rs_exit_rows.py: RS .9 flat, a Quick Break at .5 (i3; fast 2 = .7) that is also a
    # Grateful Dead Break (slow 3 = .7667 after .9 >= .9), then .4 < .5 on i4: Quicksand.
    got = _exit(rc.collect_one(_bars([90.0, 90.0, 90.0, 50.0, 40.0]), _bars([100.0] * 5)))
    assert got == {"rs_exit_last": "Quicksand", "rs_exit_bars_ago": 0,
                   "rs_quick_break_bars_ago": 1, "rs_quicksand_bars_ago": 0,
                   "rs_dead_break_bars_ago": 1}


def test_two_warnings_on_one_bar_name_the_worse(paper_lengths):
    # tests/test_rs_exit_rows.py: RS 1 1 1 .8 .92 -> Quick Break and Grateful Dead both at i3.
    got = _exit(rc.collect_one(_bars([100.0, 100.0, 100.0, 80.0, 92.0]), _bars([100.0] * 5)))
    assert got["rs_exit_last"] == "Grateful Dead Break"
    assert got["rs_exit_bars_ago"] == 1
    assert got["rs_quick_break_bars_ago"] == 1 and got["rs_dead_break_bars_ago"] == 1


def test_a_quiet_line_is_blank_not_zero(paper_lengths):
    got = _exit(rc.collect_one(_bars([100.0] * 8), _bars([100.0] * 8)))
    assert got == {k: None for k in rc.EXIT_COLUMNS}


def test_under_the_window_every_exit_column_is_blank_even_after_a_crash():
    # Production lengths: 51 bars are needed. 50 bars that end in a collapse still say nothing.
    closes = [100.0] * 45 + [60.0, 50.0, 40.0, 30.0, 20.0]
    got = _exit(rc.collect_one(_bars(closes), _bars([100.0] * 50)))
    assert got == {k: None for k in rc.EXIT_COLUMNS}
    assert rc.EXIT_MIN_BARS == 51 and (rc.EXIT_FAST, rc.EXIT_SLOW) == (21, 50)


def test_the_lengths_are_the_charts_daily_auto_pair():
    assert (rc.EXIT_FAST, rc.EXIT_SLOW) == rsm.resolve_exit_lengths("D") == rsm.EXIT_AUTO_LENGTHS["D"]
    assert rc.EXIT_NAMES == ("Quick Break", "Quicksand", "Grateful Dead Break")


# ── one implementation: the screener equals the chart's legend ───────────────

def _walk(n, seed):
    rnd = random.Random(seed)
    out, c = [], 100.0
    for _ in range(n):
        c *= 1 + rnd.gauss(0.0, 0.025)
        out.append(c)
    return out


@pytest.mark.parametrize("seed", range(12))
def test_the_screener_names_what_the_charts_legend_names(seed):
    from api.services.signature import rs_provider
    win = _bars(_walk(400, seed))
    spy = _bars(_walk(400, 1000 + seed))
    got = rc.collect_one(win, spy)
    # the chart's own path: its column set from the bars (the join recomputed, no rs_values),
    # and its legend
    cols = rsm.compute_rs_exit_columns(win, spy, 21, 50)
    times = [b["t"] for b in win]
    leg = rs_provider._rs_exit_legend(cols, times, {"fastLength": 21, "slowLength": 50}, None)
    assert got["rs_exit_last"] == leg["lastLabel"]
    assert got["rs_exit_bars_ago"] == leg["barsAgo"]
    for col, event in rc.EXIT_AGE_EVENTS.items():
        fired = [i for i, v in enumerate(cols[event]) if v == 1.0]
        assert got[col] == (len(win) - 1 - fired[-1] if fired else None), (seed, col)
    # the newest warning is the youngest of the three ages
    ages = [got[c] for c in rc.EXIT_AGE_EVENTS if got[c] is not None]
    assert got["rs_exit_bars_ago"] == (min(ages) if ages else None)


def test_the_screener_reuses_the_rs_line_phase_one_drew(monkeypatch):
    """One join per ticker: the exit maths is handed phase 1's RS line (`rs_values`)."""
    seen = []
    real = rsm.compute_rs_exit_columns

    def spy_fn(*a, **kw):
        seen.append(kw.get("rs_values") is not None)
        return real(*a, **kw)
    monkeypatch.setattr(rsm, "compute_rs_exit_columns", spy_fn)
    rc.collect_one(_bars(_walk(120, 1)), _bars(_walk(120, 2)))
    assert seen == [True]


# ── the filter grammar: the two screens the brief names ──────────────────────

def _snapshot(tmp_path, monkeypatch, rows):
    from tests.test_screener_filters import _snapshot as snap
    return snap(tmp_path, monkeypatch, rows)


def test_quicksand_in_the_last_5_and_any_warning_in_the_last_10(tmp_path, monkeypatch):
    _snapshot(tmp_path, monkeypatch, [
        # a Grateful Dead Break yesterday HIDES a Quicksand 3 sessions ago in rs_exit_last
        {"ticker": "HID", "rs_exit_last": "Grateful Dead Break", "rs_exit_bars_ago": 1,
         "rs_quick_break_bars_ago": 6, "rs_quicksand_bars_ago": 3, "rs_dead_break_bars_ago": 1,
         "snapshot_date": "2026-11-13", "built_at": 1},
        {"ticker": "SAND", "rs_exit_last": "Quicksand", "rs_exit_bars_ago": 4,
         "rs_quick_break_bars_ago": 7, "rs_quicksand_bars_ago": 4, "rs_dead_break_bars_ago": 90,
         "snapshot_date": "2026-11-13", "built_at": 1},
        {"ticker": "OLD", "rs_exit_last": "Quicksand", "rs_exit_bars_ago": 9,
         "rs_quick_break_bars_ago": 12, "rs_quicksand_bars_ago": 9, "rs_dead_break_bars_ago": None,
         "snapshot_date": "2026-11-13", "built_at": 1},
        {"ticker": "STALE", "rs_exit_last": "Quick Break", "rs_exit_bars_ago": 10,
         "rs_quick_break_bars_ago": 10, "snapshot_date": "2026-11-13", "built_at": 1},
        # NULL is "nothing fired / not computed": never inside a window
        {"ticker": "CLEAN", "snapshot_date": "2026-11-13", "built_at": 1},
    ])
    from api.services.screener import query
    importlib.reload(query)

    def tickers(*fs):
        return sorted(r["ticker"] for r in query.run_scan({"filters": list(fs)})["rows"])

    # "Quicksand in the last 5 sessions" (0 = today .. 4)
    assert tickers({"key": "rs_quicksand_bars_ago", "op": "between", "min": 0, "max": 4}) == ["HID", "SAND"]
    # the same question asked of rs_exit_last alone misses HID: why the per-warning ages exist
    assert tickers({"key": "rs_exit_last", "op": "eq", "value": "Quicksand"},
                   {"key": "rs_exit_bars_ago", "op": "between", "min": 0, "max": 4}) == ["SAND"]
    # "any exit warning in the last 10 sessions" (0 .. 9)
    assert tickers({"key": "rs_exit_bars_ago", "op": "between", "min": 0, "max": 9}) == ["HID", "OLD", "SAND"]
    assert tickers({"key": "rs_dead_break_bars_ago", "op": "lte", "max": 4}) == ["HID"]
    assert tickers({"key": "rs_exit_last", "op": "eq", "value": "Grateful Dead Break"}) == ["HID"]


def test_rs_exit_last_is_an_enum_of_the_writers_own_names():
    f = filters.FILTERS["rs_exit_last"]
    assert f["type"] == "enum" and f["category"] == "relative_strength"
    assert [(p["label"], p.get("op"), p.get("value")) for p in f["presets"][1:]] == \
        [(n, "eq", n) for n in rc.EXIT_NAMES]
    assert not filters.is_valid_op("rs_exit_last", "gte")
    for key in rc.EXIT_AGE_EVENTS:
        assert filters.FILTERS[key]["type"] == "range", key


def test_the_exit_columns_are_dark_with_the_ten_and_seated_in_the_rs_view():
    dark_off = filters.rs_dark_keys(v2_on=False, history_on=True, v3_on=True)
    dark_on = filters.rs_dark_keys(v2_on=True, history_on=True, v3_on=True)
    for col in rc.EXIT_COLUMNS:
        assert col in dark_off and col not in dark_on, col
        assert col in filters.VIEWS["relative_strength"]["columns"], col
    # the rating gate does not darken them (they are not rating-history columns)
    assert not set(rc.EXIT_COLUMNS) & filters.rs_dark_keys(v2_on=True, history_on=False, v3_on=False)


def test_the_starters_screen_the_two_windows(monkeypatch):
    from api.services.screener import saved_screens as ss
    from api.services.signature import registry_defs
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", True)
    by_id = {s["id"]: s for s in ss.rs_starters()}
    any5 = by_id["starter_rs_exit_warning_5"]["spec"]["filters"][0]
    sand5 = by_id["starter_rs_quicksand_5"]["spec"]["filters"][0]
    assert any5 == {"key": "rs_exit_bars_ago", "op": "between", "min": 0, "max": 4}
    assert sand5 == {"key": "rs_quicksand_bars_ago", "op": "between", "min": 0, "max": 4}
    for sid in ("starter_rs_exit_warning_5", "starter_rs_quicksand_5"):
        d = by_id[sid]["description"]
        assert "not an order to sell" in d and "Webster" in d, sid
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", False)
    assert ss.rs_starters() == []


def test_the_methodology_credits_webster_and_never_says_sell_as_an_order():
    from api.services.screener import methodology
    entries = {m["column"]: m for m in methodology.all_methods()["methods"]}
    for col in rc.EXIT_COLUMNS:
        m = entries[col]
        assert "Webster" in m["how"] and "not an order to sell" in m["how"], col
        assert m["family"] == methodology.RS_FAMILY, col


# ── the watchlist's batch endpoint ───────────────────────────────────────────

def test_the_watchlist_batch_reads_the_two_columns_and_names_the_misses(tmp_path, monkeypatch):
    _snapshot(tmp_path, monkeypatch, [
        {"ticker": "SAND", "rs_exit_last": "Quicksand", "rs_exit_bars_ago": 3,
         "bars_asof": "20261112", "snapshot_date": "2026-11-13", "built_at": 1},
        {"ticker": "CLEAN", "snapshot_date": "2026-11-13", "built_at": 1},
    ])
    from api.routers import watchlists
    out = watchlists.rs_exit_batch(watchlists.RsExitBatchRequest(tickers=["sand", "CLEAN", "NOPE", "sand"]),
                                   user={"id": 1})
    assert out["results"]["SAND"] == {"last": "Quicksand", "bars_ago": 3, "asof": "20261112"}
    assert out["results"]["CLEAN"] == {"last": None, "bars_ago": None, "asof": None}
    assert out["missing"] == ["NOPE"]
    assert watchlists.rs_exit_batch(watchlists.RsExitBatchRequest(tickers=[]), user={"id": 1}) == \
        {"results": {}, "missing": []}
