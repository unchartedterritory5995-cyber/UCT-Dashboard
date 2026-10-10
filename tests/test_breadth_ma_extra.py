"""20/150-day SMA history for US/NYSE/Nasdaq (2026-10-10)."""
import json

import numpy as np

from api.services import breadth_ma_extra as mae
from api.services import breadth_nhnl_intraday as nhi


class _Cls:
    def classify(self, sym, d):
        return ("us", "nyse", "us:all", "nyse:all")


def test_measure_counts_close_above_the_20_and_150_day_simple_average():
    ring = nhi.Ring()
    out = None
    for i in range(160):
        c = 10.0 if i < 159 else 12.0
        frame = {"AAA": {"h": c, "l": c, "c": c, "v": 1}, "BBB": {"h": 10.0, "l": 8.0, "c": 9.0 if i == 159 else 10.0, "v": 1}}
        out = mae.measure(ring, "2025-%03d" % i, frame, _Cls())
    assert out["nyse"][:2] == [50.0, 50.0] and out["nyse"][2:] == [2, 2]
    assert "nasdaq" not in out and "us:all" not in out


def test_override_history_fills_sessions_the_canonical_never_stored(tmp_path, monkeypatch):
    monkeypatch.setattr(mae, "SERIES_PATH", str(tmp_path / "s.json"))
    monkeypatch.setattr(mae, "_restore_from_r2", lambda: False)
    (tmp_path / "s.json").write_text(json.dumps({"rows": {"nasdaq": {
        "2026-10-08": [35.98, 37.29, 3300, 3100], "2026-10-09": [40.0, 38.0, 3301, 3101]}}}))
    mae._view.clear()
    out = mae.override_history("pct_above_150sma", "nasdaq", {})
    assert out == {"2026-10-08": {"o": None, "h": None, "l": None, "c": 37.29},
                   "2026-10-09": {"o": None, "h": None, "l": None, "c": 38.0}}
    assert mae.override_history("pct_above_50sma", "nasdaq", {"x": 1}) == {"x": 1}
    assert mae.override_history("pct_above_20sma", "uct", {}) == {}
    assert mae.token().startswith(":ma-")
    mae._view.clear()
