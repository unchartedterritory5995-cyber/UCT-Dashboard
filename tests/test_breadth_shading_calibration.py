"""tools/breadth/calibrate_breadth_shading.py — the share-of-universe ranking, the window rule and
the floors (owner 2026-11-19). Synthetic values only."""
from __future__ import annotations

import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "tools", "breadth"))
import calibrate_breadth_shading as cb  # noqa: E402

SPEC = {"pcts": {"notable": 25, "strong": 10, "extreme": 3},
        "cols": {"dn": {"bull": "low", "sides": "high", "per": "universe_count",
                        "floors": {"high": 500}, "shareFloors": {"high": 0.19}},
                 "pct": {"bull": "high", "sides": "both"}}}


def _rows(n=200, universe_count=lambda i: 2000):
    return [{"date": f"2010-{1 + i // 28 % 12:02d}-{1 + i % 28:02d}", "dn": 10 * (i % 50),
             "universe_count": universe_count(i), "pct": i % 100} for i in range(n)]


def test_count_columns_are_calibrated_on_their_share_under_a_distinct_key():
    cut = cb.build_cutoffs(_rows(), SPEC)
    assert "dn/universe_count" in cut["cols"] and "dn" not in cut["cols"]
    assert "pct" in cut["cols"]                                    # percent columns stay raw
    assert cut["cols"]["dn/universe_count"]["hi"][0] <= 1.0        # shares, not counts
    assert cut["per"] == ["universe_count"]


def test_a_universe_that_doubles_in_size_ranks_the_same_shares_the_same():
    small = cb.build_cutoffs(_rows(universe_count=lambda i: 2000), SPEC)
    double = [dict(r, dn=r["dn"] * 2, universe_count=4000) for r in _rows()]
    big = cb.build_cutoffs(double, SPEC)
    assert small["cols"]["dn/universe_count"] == big["cols"]["dn/universe_count"]


def test_shade_value_is_the_share_and_needs_a_universe_count():
    c = SPEC["cols"]["dn"]
    assert cb.shade_value(c, "dn", {"dn": 300, "universe_count": 1500}) == 0.2
    assert cb.shade_value(c, "dn", {"dn": 300}) is None
    assert cb.shade_value(c, "dn", {"dn": 300, "universe_count": 0}) is None
    assert cb.shade_value(SPEC["cols"]["pct"], "pct", {"pct": 42}) == 42


def test_floors_raw_on_uct_share_elsewhere():
    grid = cb.GRID
    cut = {"grid": grid, "cols": {"dn/universe_count": {"n": 100, "mid": 0.05, "lo": [0] * len(grid),
                                                        "hi": [0.9] * len(grid)}}}
    row = {"dn": 520, "universe_count": 4000}                     # 13%: rare nowhere
    assert cb.shade(row, "dn", SPEC, cut, "uct") == ("bear", 2)   # raw 520 >= 500
    assert cb.shade(row, "dn", SPEC, cut, "nasdaq") is None       # 13% < 19%
    assert cb.shade({"dn": 400, "universe_count": 2000}, "dn", SPEC, cut, "nasdaq") == ("bear", 2)


def test_the_window_rule_is_each_universe_full_history_from_2008():
    assert cb.WINDOW_FLOOR == "2008-01-02"
    shipped = json.load(open(cb.OUT, encoding="utf-8"))
    assert {u: shipped[u]["from"] for u in ("uct", "us", "nasdaq", "nyse")} == {
        "uct": "2008-01-02", "us": "2008-01-02", "nasdaq": "2008-01-02", "nyse": "2009-06-11"}


def _export(path, obj):
    import base64
    import gzip
    body = base64.b64encode(gzip.compress(json.dumps(obj).encode())).decode()
    path.write_text(f"===BEGIN===\n{body}\n===END===\n", encoding="utf-8")


def test_uct_is_calibrated_on_the_rows_the_sheet_shows_and_nothing_laid_over(tmp_path):
    """2026-11-22: the cutoffs describe the cells. No `uct_backtest` overlay (today's list run backward)."""
    deep = [{"date": "2026-02-02", "up_4pct_today": 1, "universe_count": 10, "vix": 20},
            {"date": "2026-02-03", "_live": True, "up_4pct_today": 5, "universe_count": 10}]
    _export(tmp_path / "deep.txt", deep)
    rows = cb.load_rows("uct", str(tmp_path / "deep.txt"))
    assert [r["date"] for r in rows] == ["2026-02-02"]                 # the live row is not history
    assert rows[0]["up_4pct_today"] == 1 and rows[0]["universe_count"] == 10
    import pytest
    with pytest.raises(SystemExit):
        cb.load_rows("uct", str(tmp_path / "deep.txt"), str(tmp_path / "bt.txt"))


def test_back_tested_uct_sessions_are_never_ranked_and_never_shaded():
    """A `_reconstructed` UCT row is today's list run backward: its per-universe cells are unshaded
    and it is left out of the per-universe cutoffs; market-wide columns are unaffected."""
    spec = {"pcts": SPEC["pcts"], "cols": {**SPEC["cols"], "vix": {"bull": "low", "sides": "both"}}}
    real = [dict(r, date=r["date"].replace("2010", "2026")) for r in _rows()]
    fake = [dict(r, _reconstructed=True, dn=r["dn"] * 50, pct=99, vix=r["pct"]) for r in _rows()]
    cut = cb.build_cutoffs(fake + real, spec, "uct")
    assert cut["cols"]["dn/universe_count"] == cb.build_cutoffs(real, spec, "uct")["cols"]["dn/universe_count"]
    assert cut["cols"]["pct"] == cb.build_cutoffs(real, spec, "uct")["cols"]["pct"]
    assert cut["cols"]["vix"]["n"] == len(fake)                       # market-wide: the whole window
    assert cut["from"] == "2010-01-01" and cut["ranked_from"] == "2026-01-01"
    hot = dict(fake[0], dn=1999, pct=100)
    assert cb.shade(hot, "dn", spec, cut, "uct") is None
    assert cb.shade(hot, "pct", spec, cut, "uct") is None
    assert cb.shade(dict(hot, _reconstructed=False), "pct", spec, cut, "uct") is not None
    # another universe never carries the flag's meaning
    assert not cb.is_backtested_cell("pct", hot, "nasdaq")
