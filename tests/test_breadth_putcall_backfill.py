"""CBOE Put/Call fill (2026-10-08): the value belongs to exactly its session, unpublished stays null."""
from unittest.mock import patch

from api.services import breadth_putcall_backfill as pc


class _R:
    def __init__(self, code, body):
        self.status_code, self._b = code, body

    def json(self):
        return self._b


def test_fetch_reads_the_equity_ratio_for_exactly_that_date():
    """⭐ EQUITY, never TOTAL (owner 2026-11-19): the column is one equity series 2003→today."""
    seen = []

    def get(url, **kw):
        seen.append(url)
        return _R(200, {"ratios": [{"name": "INDEX PUT/CALL RATIO", "value": "0.93"},
                                   {"name": "TOTAL PUT/CALL RATIO", "value": "0.87"},
                                   {"name": "EQUITY PUT/CALL RATIO", "value": "0.58"}]})
    assert pc.fetch_for_date("2026-10-07", get=get) == 0.58
    assert seen == ["https://cdn.cboe.com/data/us/options/market_statistics/daily/2026-10-07_daily_options"]


def test_unpublished_or_absurd_is_none():
    assert pc.fetch_for_date("2026-10-08", get=lambda u, **k: _R(403, {})) is None
    assert pc.fetch_for_date("x", get=lambda u, **k: _R(200, {"ratios": [{"name": "EQUITY PUT/CALL RATIO",
                                                                          "value": "9.0"}]})) is None


def test_a_day_with_only_the_total_ratio_is_not_a_reading():
    body = {"ratios": [{"name": "TOTAL PUT/CALL RATIO", "value": "0.87"}]}
    assert pc.fetch_for_date("2026-10-07", get=lambda u, **k: _R(200, body)) is None


def test_a_collector_push_never_writes_the_column():
    """The PC collector still reads TOTAL: its value is dropped, the stored equity value kept."""
    assert pc.keep_stored("d", {"a": 1, "cboe_putcall": 0.87}, existing={"cboe_putcall": 0.58}) == \
        {"a": 1, "cboe_putcall": 0.58}
    assert pc.keep_stored("d", {"a": 1, "cboe_putcall": 0.87}, existing={}) == {"a": 1}
    assert pc.keep_stored("d", {"a": 1, "cboe_putcall": None}, existing={"cboe_putcall": 0.58}) == \
        {"a": 1, "cboe_putcall": 0.58}
    same = {"a": 1}
    assert pc.keep_stored("d", same, existing={"cboe_putcall": 0.58}) is same


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
