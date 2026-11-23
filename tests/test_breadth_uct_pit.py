"""breadth_uct_pit — the point-in-time UCT history overlay (2026-11-22). Synthetic values only."""
from __future__ import annotations

import json

import pytest

from api.services import breadth_shade_rule as rule
from api.services import breadth_uct_pit as pit


def _write(tmp_path, monkeypatch, rows, version=pit.VERSION):
    p = tmp_path / "breadth_uct_pit_v1.json"
    ds = sorted(rows)
    p.write_text(json.dumps({"version": version, "first": ds[0], "last": ds[-1], "rows": rows}))
    monkeypatch.setattr(pit, "SERIES_PATH", str(p))
    pit._view.clear()
    return p


SERIES = {
    "2010-01-04": {"advancing": 10, "declining": 5, "adv_decline": 5, "universe_count": 20,
                   "new_ath": None, "members": 20, "ad_back": 7},
    "2010-01-05": {"advancing": 9, "declining": 2, "adv_decline": 7, "universe_count": 20,
                   "new_ath": None, "members": 20, "ad_back": 0},
}


def test_off_by_default_and_nothing_is_touched(tmp_path, monkeypatch):
    _write(tmp_path, monkeypatch, SERIES)
    monkeypatch.delenv("BREADTH_UCT_PIT", raising=False)
    rows = [{"date": "2010-01-04", "_reconstructed": True, "advancing": 1}]
    assert pit.overlay(rows) == 0
    assert rows == [{"date": "2010-01-04", "_reconstructed": True, "advancing": 1}]
    assert pit.token() == ""


def test_only_back_tested_rows_are_replaced(tmp_path, monkeypatch):
    _write(tmp_path, monkeypatch, SERIES)
    monkeypatch.setenv("BREADTH_UCT_PIT", "1")
    rows = [
        {"date": "2010-01-04", "_reconstructed": True, "advancing": 1, "new_ath": 3, "vix": 20},
        {"date": "2010-01-05", "advancing": 2},                       # a collector row: never touched
        {"date": "2010-01-06", "_reconstructed": True, "advancing": 4},  # not in the series: kept
    ]
    assert pit.overlay(rows) == 1
    assert rows[0]["advancing"] == 10 and rows[0]["_uct_pit"] is True
    assert rows[0]["new_ath"] is None                  # withheld: needs each stock's whole history
    assert rows[0]["vix"] == 20                        # market-wide: the row's own
    assert "members" not in rows[0] and "ad_back" not in rows[0]
    assert rows[1] == {"date": "2010-01-05", "advancing": 2}
    assert rows[2]["advancing"] == 4 and "_uct_pit" not in rows[2]
    assert pit.token().startswith("_ucp")


def test_the_ad_line_meets_the_collector_line_without_a_step(tmp_path, monkeypatch):
    _write(tmp_path, monkeypatch, SERIES)
    monkeypatch.setenv("BREADTH_UCT_PIT", "1")
    rows = [{"date": d, "_reconstructed": True} for d in sorted(SERIES)]
    pit.overlay(rows)
    pit.anchor_ad_line(rows, 1000)
    assert [r["adv_decline_cum"] for r in rows] == [993, 1000]
    # the line still moves by exactly the rebuilt net advances
    assert rows[1]["adv_decline_cum"] - rows[0]["adv_decline_cum"] == SERIES["2010-01-05"]["adv_decline"]
    assert all("_ad_back" not in r for r in rows)


def test_a_series_of_another_version_is_ignored(tmp_path, monkeypatch):
    _write(tmp_path, monkeypatch, SERIES, version="uct-pit-v0")
    monkeypatch.setenv("BREADTH_UCT_PIT", "1")
    assert not pit.active()
    assert pit.overlay([{"date": "2010-01-04", "_reconstructed": True}]) == 0


def test_a_rebuilt_row_is_shaded_and_ranked_again():
    assert rule.is_backtested_row({"_reconstructed": True}, "uct")
    assert not rule.is_backtested_row({"_reconstructed": True, "_uct_pit": True}, "uct")


def test_calibration_ranks_the_rebuilt_rows_as_the_monitor_serves_them(tmp_path, monkeypatch):
    p = _write(tmp_path, monkeypatch, SERIES)
    from tools.breadth import calibrate_breadth_shading as cal
    rows = [
        {"date": "2010-01-04", "_reconstructed": True, "universe_count": 99, "new_52w_highs": 1},
        {"date": "2010-01-05", "_reconstructed": True, "universe_count": 99, "new_52w_highs": 1},
        {"date": "2026-01-02", "universe_count": 50, "new_52w_highs": 5, "hi_ratio": 77.0},
    ]
    assert cal.apply_uct_pit(rows, str(p)) == 2
    assert rows[0]["_uct_pit"] and rows[0]["universe_count"] == 20
    assert rows[0]["hi_ratio"] == 5.0                 # re-derived from the rebuilt counts (1 of 20)
    assert rows[2]["hi_ratio"] == 77.0                # a collector row stays exactly as exported
    assert all("_ad_back" not in r for r in rows)
    assert not rule.is_backtested_row(rows[0], "uct")
