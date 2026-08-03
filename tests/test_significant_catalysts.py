"""Tests for the shared significant-catalyst generator (extracted from Model Book).

Guards the refactor: direction="up" must reproduce the original Model Book
behavior; direction="down"/"both" add the News-widget path; the LLM-facing
`generate` maps to generic dicts and never raises.
"""
import json

from api.services import significant_catalysts as sc


# Daily bars with deterministic prev-close % moves:
#   01-02 base, 01-05 +10%, 01-06 -10%, 01-07 0%, 01-08 +20%, 01-09 -20%
BARS = [
    {"t": "2026-01-02", "o": 100.0, "c": 100.0},
    {"t": "2026-01-05", "o": 100.0, "c": 110.0},   # +10%
    {"t": "2026-01-06", "o": 110.0, "c": 99.0},    # -10%
    {"t": "2026-01-07", "o": 99.0,  "c": 99.0},    # 0%
    {"t": "2026-01-08", "o": 99.0,  "c": 118.8},   # +20%
    {"t": "2026-01-09", "o": 118.8, "c": 95.04},   # -20%
]


class TestRankBigMoveDays:
    def test_up_matches_original_behavior(self):
        # Original _big_up_days: only pct>0, biggest gain first, rounded to 1dp.
        got = sc.rank_big_move_days(BARS, top_n=12, direction="up")
        assert got == [
            {"date": "2026-01-08", "pct": 20.0},
            {"date": "2026-01-05", "pct": 10.0},
        ]

    def test_down_biggest_drop_first(self):
        got = sc.rank_big_move_days(BARS, top_n=12, direction="down")
        assert got == [
            {"date": "2026-01-09", "pct": -20.0},
            {"date": "2026-01-06", "pct": -10.0},
        ]

    def test_both_mixes_up_and_down_by_abs(self):
        got = sc.rank_big_move_days(BARS, top_n=4, direction="both")
        # Biggest absolute moves first; the top-2 are the two ±20% days.
        assert {got[0]["date"], got[1]["date"]} == {"2026-01-08", "2026-01-09"}
        dirs = {"up" if g["pct"] > 0 else "down" for g in got}
        assert dirs == {"up", "down"}         # both directions present

    def test_top_n_limits(self):
        assert len(sc.rank_big_move_days(BARS, top_n=1, direction="both")) == 1


class TestSnapTradingDay:
    days = ["2026-01-05", "2026-01-08"]
    day_set = set(days)

    def test_exact_hit(self):
        assert sc.snap_trading_day("2026-01-08", self.days, self.day_set, year=2026) == "2026-01-08"

    def test_nearest_within_five_days(self):
        assert sc.snap_trading_day("2026-01-09", self.days, self.day_set, year=2026) == "2026-01-08"

    def test_rejects_wrong_year(self):
        assert sc.snap_trading_day("2025-12-30", self.days, self.day_set, year=2026) is None

    def test_rejects_beyond_five_days(self):
        assert sc.snap_trading_day("2026-06-01", self.days, self.day_set, year=2026) is None

    def test_lo_hi_window(self):
        # No year gate, but bounded by an ISO window (the YTD path).
        assert sc.snap_trading_day("2026-01-09", self.days, self.day_set, lo="2026-01-01", hi="2026-01-08") is None
        assert sc.snap_trading_day("2026-01-05", self.days, self.day_set, lo="2026-01-01", hi="2026-12-31") == "2026-01-05"


class _FakeBlock:
    def __init__(self, text):
        self.text = text


class _FakeMsg:
    def __init__(self, text):
        self.content = [_FakeBlock(text)]


class _FakeClient:
    def __init__(self, payload):
        self._payload = payload
        self.calls = []

    class _Messages:
        def __init__(self, outer):
            self._outer = outer

        def create(self, **kwargs):
            self._outer.calls.append(kwargs)
            return _FakeMsg(json.dumps(self._outer._payload))

    @property
    def messages(self):
        return self._Messages(self)


class TestGenerate:
    def test_up_maps_generic_items(self):
        payload = {"catalysts": [
            {"date": "2026-01-08", "title": "Q3 earnings beat",
             "description": "Beat and raised guidance.", "move_pct": 20.0},
        ]}
        client = _FakeClient(payload)
        out = sc.generate("NVDA", "NVIDIA", BARS, "2026", direction="up",
                          gain_pct=50, client=client)
        assert out == [{
            "date": "2026-01-08", "title": "Q3 earnings beat",
            "description": "Beat and raised guidance.", "move_pct": 20.0,
            "direction": "up", "sort_order": 0,
        }]
        # Bullish system prompt used.
        assert "bullish" in client.calls[0]["system"].lower()

    def test_both_preserves_direction(self):
        payload = {"catalysts": [
            {"date": "2026-01-08", "title": "Earnings beat", "description": "Up.",
             "move_pct": 20.0, "direction": "up"},
            {"date": "2026-01-09", "title": "Guidance cut", "description": "Down.",
             "move_pct": -20.0, "direction": "down"},
        ]}
        out = sc.generate("NVDA", "NVIDIA", BARS, "2026 YTD", direction="both",
                          client=_FakeClient(payload),
                          trading_bounds=("2026-01-01", "2026-12-31"))
        dirs = {o["direction"] for o in out}
        assert dirs == {"up", "down"}
        assert out[1]["move_pct"] == -20.0

    def test_direction_inferred_from_sign_when_missing(self):
        payload = {"catalysts": [
            {"date": "2026-01-09", "title": "Miss", "description": "x", "move_pct": -20.0},
        ]}
        out = sc.generate("X", "X", BARS, "2026 YTD", direction="both",
                          client=_FakeClient(payload), trading_bounds=("2026-01-01", "2026-12-31"))
        assert out[0]["direction"] == "down"

    def test_disabled_returns_none_without_calling(self):
        client = _FakeClient({"catalysts": []})
        assert sc.generate("X", "X", BARS, "2026", enabled=False, client=client) is None
        assert client.calls == []

    def test_empty_bars_returns_none(self):
        assert sc.generate("X", "X", [], "2026", client=_FakeClient({"catalysts": []})) is None

    def test_unparseable_llm_output_returns_none(self):
        # A non-JSON-object body (no braces) → generate() returns None, not raise.
        out = sc.generate("X", "X", BARS, "2026", client=_FakeClient("no json here"))
        assert out is None
