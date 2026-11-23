"""breadth_uct_exposure_model — UCT Exp before the wire published it (2026-11-23). Synthetic values only."""
from __future__ import annotations

import json

from api.services import breadth_uct_exposure_model as uxm


def _write(tmp_path, monkeypatch, rows, version=uxm.VERSION):
    p = tmp_path / "breadth_uct_exposure_model_v1.json"
    p.write_text(json.dumps({"version": version, "rows": rows}))
    monkeypatch.setattr(uxm, "SERIES_PATH", str(p))
    uxm._view.clear()
    return p


SERIES = {"2010-01-04": 40.0, "2026-03-02": 110.0, "2026-08-21": 65.0, "2026-08-24": 15.0}


def test_off_by_default_and_nothing_is_touched(tmp_path, monkeypatch):
    _write(tmp_path, monkeypatch, SERIES)
    monkeypatch.delenv("BREADTH_UCT_EXP_MODEL", raising=False)
    rows = [{"date": "2010-01-04", "uct_exposure": None}]
    assert uxm.fill(rows) == 0
    assert rows == [{"date": "2010-01-04", "uct_exposure": None}]
    assert uxm.token() == ""


def test_only_blank_sessions_before_the_cutover_are_filled(tmp_path, monkeypatch):
    _write(tmp_path, monkeypatch, SERIES)
    monkeypatch.setenv("BREADTH_UCT_EXP_MODEL", "1")
    rows = [
        {"date": "2010-01-04", "uct_exposure": None},
        {"date": "2026-03-02"},                           # absent key: blank too
        {"date": "2026-08-21", "uct_exposure": 90.0},     # a published rating is never replaced
        {"date": "2026-08-24", "uct_exposure": None},     # the wire's era: never filled
        {"date": "2011-05-05", "uct_exposure": None},     # not in the series: stays blank
    ]
    assert uxm.fill(rows) == 2
    assert rows[0] == {"date": "2010-01-04", "uct_exposure": 40.0, uxm.MARK: True}
    assert rows[1][uxm.MARK] is True and rows[1]["uct_exposure"] == 110.0
    assert rows[2] == {"date": "2026-08-21", "uct_exposure": 90.0}
    assert rows[3] == {"date": "2026-08-24", "uct_exposure": None}
    assert rows[4] == {"date": "2011-05-05", "uct_exposure": None}
    assert uxm.token().startswith("_uxm")


def test_a_series_of_another_version_is_ignored(tmp_path, monkeypatch):
    _write(tmp_path, monkeypatch, SERIES, version="uct-exp-model-v0")
    monkeypatch.setenv("BREADTH_UCT_EXP_MODEL", "1")
    assert not uxm.active()
    assert uxm.fill([{"date": "2010-01-04"}]) == 0


def test_the_marker_travels_to_every_universe():
    from api.services import breadth_universe_monitor as bum
    assert uxm.MARK in bum.MARKET_WIDE_SUPPORT
    assert uxm.MARK in bum.market_wide_keys({"uct_exposure": 40.0, uxm.MARK: True})


def test_the_builder_maps_the_trend_state_like_calculate_exposure_v2():
    import numpy as np
    import pandas as pd
    from tools.breadth import uct_exposure_model as tool
    n = 260
    up = pd.DataFrame({"c": np.linspace(100, 200, n), "h": np.linspace(101, 201, n),
                       "l": np.linspace(99, 199, n), "v": np.full(n, 1e6)},
                      index=pd.bdate_range("2007-01-01", periods=n))
    m = tool.Machine(up, up)
    plain = {"phase": "Rally Attempt", "ftd_today": False, "restraint": False, "s2": False, "b4": False}
    assert m.exposure(n - 1, plain) == 100                                   # above its 50-day
    assert m.exposure(n - 1, {**plain, "phase": "Confirmed Uptrend"}) == 110
    assert m.exposure(n - 1, {**plain, "phase": "Confirmed Uptrend", "restraint": True}) == 65
    assert m.exposure(n - 1, {**plain, "s2": True}) == 40
    down = up.iloc[::-1].set_axis(up.index)
    m = tool.Machine(down, down)
    assert m.exposure(n - 1, plain) == 15                                    # under both averages
    assert m.exposure(n - 1, {**plain, "ftd_today": True}) == 40             # FTD floor
    assert m.exposure(n - 1, {**plain, "b4": True}) == 30                    # B4 floor
