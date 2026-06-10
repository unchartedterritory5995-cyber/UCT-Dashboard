"""Unit tests for the catalyst broad gap-scan source (_pull_gap_scan).

Verifies the filtering that lets modest-% big-cap NEWS movers through while
dropping penny / illiquid / flat / non-alpha noise — the gap the top-20
gainers feed left open (NUVL/MU/SIRI never cracked a %-ranked top-20).
"""
import api.services.massive as massive
from api.services.catalyst import sources


class _FakeClient:
    def __init__(self, snap):
        self._snap = snap

    def get_full_market_snapshot(self):
        return self._snap


def _patch(monkeypatch, snap):
    monkeypatch.setattr(massive, "_get_client", lambda: _FakeClient(snap))


def test_gap_scan_keeps_modest_pct_big_cap(monkeypatch):
    """The whole point: a +5% liquid big-cap (MU-style) is kept even though it
    would never make a percentage-ranked top-20 gainers list."""
    _patch(monkeypatch, {
        "MU":   {"last_price": 105.0, "prev_close": 100.0, "today_vol": 9_000_000, "prev_vol": 10_000_000},  # +5% big-cap
        "NUVL": {"last_price": 139.0, "prev_close": 100.0, "today_vol": 4_000_000, "prev_vol": 5_000_000},   # +39% M&A
        "WOLF": {"last_price": 80.0,  "prev_close": 100.0, "today_vol": 4_000_000, "prev_vol": 6_000_000},   # -20%
    })
    out = sources._pull_gap_scan()
    assert set(out) == {"MU", "NUVL", "WOLF"}
    assert out["MU"]["gap_pct"] == 5.0
    assert out["NUVL"]["gap_pct"] == 39.0
    assert out["WOLF"]["gap_pct"] == -20.0


def test_gap_scan_drops_flat_penny_illiquid_and_dotted(monkeypatch):
    _patch(monkeypatch, {
        "FLAT":  {"last_price": 101.0, "prev_close": 100.0, "today_vol": 9_000_000, "prev_vol": 9_000_000},  # +1% < 3%
        "PENNY": {"last_price": 2.0,   "prev_close": 1.5,   "today_vol": 9_000_000, "prev_vol": 9_000_000},  # price < $3
        "ILLIQ": {"last_price": 50.0,  "prev_close": 45.0,  "today_vol": 50_000,    "prev_vol": 50_000},     # $2.5M/day < $5M
        "BRK.B": {"last_price": 500.0, "prev_close": 440.0, "today_vol": 9_000_000, "prev_vol": 9_000_000},  # non-alpha
        "KEEP":  {"last_price": 50.0,  "prev_close": 45.0,  "today_vol": 9_000_000, "prev_vol": 9_000_000},  # +11% liquid
    })
    out = sources._pull_gap_scan()
    assert set(out) == {"KEEP"}


def test_gap_scan_caps_and_ranks_by_dollar_volume(monkeypatch):
    """On a volatile day 1000+ names gap >=3%; we keep only the top-N by
    dollar-volume (the liquid big-cap movers), not thin small-caps."""
    monkeypatch.setenv("CATALYST_GAPSCAN_MAX", "2")
    _patch(monkeypatch, {
        "AAA": {"last_price": 10.0, "prev_close": 9.0, "prev_vol": 100_000_000},  # $1.0B/day
        "BBB": {"last_price": 10.0, "prev_close": 9.0, "prev_vol": 50_000_000},   # $500M/day
        "CCC": {"last_price": 10.0, "prev_close": 9.0, "prev_vol": 2_000_000},    # $20M/day — dropped by cap
    })
    out = sources._pull_gap_scan()
    assert set(out) == {"AAA", "BBB"}


def test_gap_scan_disabled_returns_empty(monkeypatch):
    monkeypatch.setenv("CATALYST_GAPSCAN_ENABLED", "0")
    _patch(monkeypatch, {"MODEST": {"last_price": 105.0, "prev_close": 100.0, "prev_vol": 10_000_000}})
    assert sources._pull_gap_scan() == {}


def test_gap_scan_handles_zero_prev_close(monkeypatch):
    """A bad/zero prev_close must not divide-by-zero — just skip the name."""
    _patch(monkeypatch, {
        "BAD":  {"last_price": 10.0, "prev_close": 0.0, "prev_vol": 9_000_000},
        "GOOD": {"last_price": 11.0, "prev_close": 10.0, "prev_vol": 9_000_000},
    })
    out = sources._pull_gap_scan()
    assert set(out) == {"GOOD"}
