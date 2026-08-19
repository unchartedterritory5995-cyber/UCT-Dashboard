"""Intraday Bars Pack builder (api/services/intradaypack.py) — Phase 4.

Pins: intraday (unix-ts) bars encode + newest-session derivation, the size floor,
the coverage-aware post-close rebuild trigger, and the session marker round-trip.
Mirrors test_barspack. The daily pack is deliberately untouched by this module.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services import intradaypack as ip

_ET = ZoneInfo("America/New_York")


def _et_unix(y, mo, d, h, mi):
    return int(datetime(y, mo, d, h, mi, tzinfo=_ET).timestamp())


def _synthetic_intraday(sym, tf, depth):
    """Deterministic intraday bars (unix-second `t`) for 2026-08-18 RTH."""
    base = _et_unix(2026, 8, 18, 9, 30)
    step = int(tf) * 60
    n = 3 + (abs(hash((sym, tf))) % 4)  # 3..6 bars
    return [{"t": base + i * step, "o": 1.0 + i, "h": 1.2 + i, "l": 0.9 + i,
             "c": 1.1 + i, "v": (i + 1) * 1000} for i in range(n)]


def _et(y, mo, d, h, mi):
    return datetime(y, mo, d, h, mi, tzinfo=_ET)


# ── bar → session date ────────────────────────────────────────────────────────
def test_bar_session_ymd_from_unix_and_iso():
    assert ip._bar_session_ymd({"t": _et_unix(2026, 8, 18, 15, 55)}) == 20260818
    assert ip._bar_session_ymd({"t": "2026-08-18"}) == 20260818   # D/W/M bar fallback
    assert ip._bar_session_ymd({"t": None}) == 0


# ── build ────────────────────────────────────────────────────────────────────
def test_build_encodes_intraday_and_derives_newest_session(monkeypatch):
    monkeypatch.setattr(ip, "_sanitized_bars", _synthetic_intraday)
    monkeypatch.setattr(ip, "_last_complete_session_ymd", lambda *a, **k: 20260818)
    monkeypatch.setattr(ip, "MIN_TICKERS", 1)
    monkeypatch.setattr(ip, "MIN_BARS", 1)
    built = ip.build(num_shards=4, tickers=[f"T{i:03d}" for i in range(120)], date="2026-08-18")
    m = built["manifest"]
    assert m["kind"] == "intraday"
    assert m["tfs"] == list(ip._TFS)
    assert m["ticker_count"] == 120
    assert m["newest_session"] == 20260818        # derived from the unix-ts bars
    assert m["bar_count"] > 0
    # a shard per non-empty bucket + one delta file
    assert any(k.endswith("delta.json.gz") for k in built["shards"])


def test_build_refuses_below_floor(monkeypatch):
    monkeypatch.setattr(ip, "_sanitized_bars", _synthetic_intraday)
    monkeypatch.setattr(ip, "_last_complete_session_ymd", lambda *a, **k: 20260818)
    monkeypatch.setattr(ip, "MIN_TICKERS", 10_000)
    with pytest.raises(ip.BarsPackError):
        ip.build(num_shards=4, tickers=["AAPL", "MSFT"], date="2026-08-18")


# ── trigger ──────────────────────────────────────────────────────────────────
def test_should_build_after_close_new_session(monkeypatch):
    monkeypatch.setattr(ip, "_read_marker", lambda: (20260817, 1.0))
    assert ip._should_build_now(_et(2026, 8, 18, 17, 0)) is True   # Tue closed → new session
    monkeypatch.setattr(ip, "_read_marker", lambda: (20260818, 1.0))
    assert ip._should_build_now(_et(2026, 8, 18, 17, 0)) is False  # already comprehensive


def test_builds_mid_session_covering_prior_closed_session(monkeypatch):
    # The builder now runs DURING RTH too — build() drops today's partials, so the pack is
    # closed-only whenever it builds. At RTH Tue 8/18 13:00 the last CLOSED session is Mon
    # 8/17: a stale marker triggers a build covering up to Monday (today rides live).
    monkeypatch.setattr(ip, "_read_marker", lambda: (20260101, 0.0))
    assert ip._should_build_now(_et(2026, 8, 18, 13, 0)) is True
    # ...but not once the marker already covers the last closed session at comprehensive coverage.
    monkeypatch.setattr(ip, "_read_marker", lambda: (20260817, 1.0))
    assert ip._should_build_now(_et(2026, 8, 18, 13, 0)) is False


def test_build_drops_todays_partial_bars(monkeypatch):
    # Bars span Mon 8/17 (closed) + Tue 8/18 (today, still open during RTH). With the last
    # complete session = Monday, the pack must EXCLUDE Tuesday's partials — the pack's
    # newest session is Monday, never today's in-progress bars.
    def _two_day_bars(sym, tf, depth):
        step = int(tf) * 60
        mon = [{"t": _et_unix(2026, 8, 17, 9, 30) + i * step, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1} for i in range(5)]
        tue = [{"t": _et_unix(2026, 8, 18, 9, 30) + i * step, "o": 2, "h": 2, "l": 2, "c": 2, "v": 1} for i in range(3)]
        return mon + tue
    monkeypatch.setattr(ip, "_sanitized_bars", _two_day_bars)
    monkeypatch.setattr(ip, "_last_complete_session_ymd", lambda *a, **k: 20260817)   # RTH Tuesday
    monkeypatch.setattr(ip, "MIN_TICKERS", 1)
    monkeypatch.setattr(ip, "MIN_BARS", 1)
    built = ip.build(num_shards=2, tickers=["AAA"], date="2026-08-18")
    assert built["manifest"]["newest_session"] == 20260817   # Monday, NOT Tuesday's partials


def test_same_session_rebuild_when_5m_coverage_improves(monkeypatch):
    monkeypatch.setattr(ip, "_read_marker", lambda: (20260818, 0.50))
    monkeypatch.setattr(ip, "_coverage_ratio", lambda *a, **k: 0.80)
    assert ip._should_build_now(_et(2026, 8, 18, 18, 0)) is True
    monkeypatch.setattr(ip, "_coverage_ratio", lambda *a, **k: 0.51)   # < +0.03
    assert ip._should_build_now(_et(2026, 8, 18, 18, 0)) is False


# ── marker ───────────────────────────────────────────────────────────────────
def test_session_marker_round_trip(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    assert ip._read_marker() == (0, 0.0)          # absent
    ip._write_marker(20260818, 0.87)
    assert ip._read_marker() == (20260818, 0.87)


def test_disabled_by_default():
    assert ip.status()["enabled"] is False
