"""breadth_universe_extras — Up Vol / HVC / >7xATR off UCT (2026-11-23). Synthetic values only."""
from __future__ import annotations

import json

from api.services import breadth_monitor as bm
from api.services import breadth_universe_extras as uex

SERIES = {"us": {"2015-03-02": {"up_vol_ratio": 1.5, "hvc_52w": 7, "atr_ext_7": 3}}}


def _write(tmp_path, monkeypatch, rows=SERIES, version=uex.VERSION):
    p = tmp_path / "x.json"
    p.write_text(json.dumps({"version": version, "rows": rows}))
    monkeypatch.setattr(uex, "SERIES_PATH", str(p))
    uex._view.clear()
    from api.services import breadth_universe_extras_forward as fwd
    monkeypatch.setattr(fwd, "STORE_PATH", str(tmp_path / "fwd.json"))
    monkeypatch.setattr(fwd, "_restore_from_r2", lambda: False)
    fwd._view.clear()


def test_off_by_default_the_columns_stay_blank(tmp_path, monkeypatch):
    _write(tmp_path, monkeypatch)
    monkeypatch.delenv("BREADTH_UNIVERSE_EXTRAS", raising=False)
    row = bm._finish_universe_row({"date": "2015-03-02", "up_vol_ratio": 9}, "us", None)
    assert row["up_vol_ratio"] is None and row["hvc_52w"] is None and row["atr_ext_7"] is None
    assert uex.token() == ""


def test_on_the_session_takes_its_rebuilt_values_and_ath_stays_blank(tmp_path, monkeypatch):
    _write(tmp_path, monkeypatch)
    monkeypatch.setenv("BREADTH_UNIVERSE_EXTRAS", "1")
    row = bm._finish_universe_row({"date": "2015-03-02"}, "us", None)
    assert (row["up_vol_ratio"], row["hvc_52w"], row["atr_ext_7"]) == (1.5, 7, 3)
    assert row["new_ath"] is None
    other = bm._finish_universe_row({"date": "2015-03-03"}, "us", None)      # not in the series
    assert other["up_vol_ratio"] is None
    nyse = bm._finish_universe_row({"date": "2015-03-02"}, "nyse", None)     # another universe
    assert nyse["hvc_52w"] is None
    assert uex.token().startswith("_uex")


def test_a_series_of_another_version_is_ignored(tmp_path, monkeypatch):
    _write(tmp_path, monkeypatch, version="universe-extras-v0")
    monkeypatch.setenv("BREADTH_UNIVERSE_EXTRAS", "1")
    assert uex.values("us", "2015-03-02") is None


def test_the_rebuilt_columns_are_ranked_per_universe():
    from api.services import breadth_shade_rule as rule
    assert rule.NOT_PER_UNIVERSE == frozenset({"new_ath"})
