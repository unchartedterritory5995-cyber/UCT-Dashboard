"""CBOE Put/Call fill (2026-10-08): the value belongs to exactly its session, unpublished stays null."""
from unittest.mock import patch

from api.services import breadth_putcall_backfill as pc


class _R:
    def __init__(self, code, body):
        self.status_code, self._b = code, body

    def json(self):
        return self._b


def test_fetch_reads_the_total_ratio_for_exactly_that_date():
    seen = []

    def get(url, **kw):
        seen.append(url)
        return _R(200, {"ratios": [{"name": "INDEX PUT/CALL RATIO", "value": "0.93"},
                                   {"name": "TOTAL PUT/CALL RATIO", "value": "0.87"}]})
    assert pc.fetch_for_date("2026-10-07", get=get) == 0.87
    assert seen == ["https://cdn.cboe.com/data/us/options/market_statistics/daily/2026-10-07_daily_options"]


def test_unpublished_or_absurd_is_none():
    assert pc.fetch_for_date("2026-10-08", get=lambda u, **k: _R(403, {})) is None
    assert pc.fetch_for_date("x", get=lambda u, **k: _R(200, {"ratios": [{"name": "TOTAL PUT/CALL RATIO",
                                                                          "value": "9.0"}]})) is None


def test_fill_patches_only_missing_sessions_and_leaves_unpublished_null():
    from api.services import breadth_monitor as bm
    hist = [{"date": "2026-10-08", "cboe_putcall": None}, {"date": "2026-10-07", "cboe_putcall": None},
            {"date": "2026-10-06", "cboe_putcall": 0.9}]
    patched = {}
    with patch.object(bm, "get_history", return_value=hist), \
         patch.object(bm, "patch_fields", side_effect=lambda d, v: patched.update({d: v}) or True):
        out = pc.fill(fetch=lambda d: {"2026-10-07": 0.87}.get(d))
    assert patched == {"2026-10-07": {"cboe_putcall": 0.87}}
    assert out["filled"] == 1 and out["unpublished"] == ["2026-10-08"]
