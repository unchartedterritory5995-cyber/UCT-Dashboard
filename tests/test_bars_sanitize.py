"""Serve-time bar normalization — ticker-reuse cutoff, split self-heal, wick clamp.

All deterministic + offline: corporate-action metadata is seeded straight into
the cache (production warms it in the background off the request path).
"""
import datetime
import pytest

from api.services import bars_sanitize as bs
from api.services.cache import cache


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    # A cold-meta path must never spawn a real FMP warm in tests.
    monkeypatch.setattr(bs, "_warm_meta", lambda ticker: None)


def _seed(ticker, ipo=None, splits=None):
    cache.set(bs._META_KEY.format(ticker), {"ipo": ipo, "splits": splits or []}, ttl=3600)


def _day(d):
    return d.isoformat()


def _series(start, n, price=10.0):
    """n consecutive weekday bars from `start`, flat-ish."""
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append({"t": _day(d), "o": price, "h": price * 1.01,
                        "l": price * 0.99, "c": price, "v": 1000})
        d += datetime.timedelta(days=1)
    return out


# ── Ticker-reuse listing cutoff ─────────────────────────────────────────────
class TestListingCutoff:
    def test_reused_ticker_dropped_at_gap_aligned_with_ipo(self):
        old = _series(datetime.date(2015, 1, 5), 40)              # old security
        new_start = datetime.date(2026, 4, 2)
        new = _series(new_start, 20, price=50.0)                  # relisted security
        _seed("DRAM", ipo="2026-04-02", splits=[])
        out = bs.sanitize_daily_bars("DRAM", old + new, "D")
        assert out[0]["t"] == new_start.isoformat()
        assert len(out) == 20

    def test_normal_continuous_history_untouched(self):
        bars = _series(datetime.date(2020, 1, 2), 200)
        _seed("AAPL", ipo="1980-12-12", splits=[])
        out = bs.sanitize_daily_bars("AAPL", list(bars), "D")
        assert len(out) == len(bars)
        assert out[0]["t"] == bars[0]["t"]

    def test_legit_long_halt_same_company_not_cut(self):
        # A 40-day gap but the ipo is years earlier → NOT a relisting → keep all.
        a = _series(datetime.date(2021, 1, 4), 30)
        b = _series(datetime.date(2021, 4, 1), 30)               # ~40d gap
        _seed("HALT", ipo="2005-06-01", splits=[])
        out = bs.sanitize_daily_bars("HALT", a + b, "D")
        assert len(out) == 60

    def test_reuse_cut_without_metadata_on_price_jump(self, monkeypatch):
        # SPCX-style: a sub-standalone (~70-day) gap with a big price jump (old
        # ~$22 ETF → new ~$150 listing) is cut on the FIRST serve — no metadata,
        # no ~1s pre-IPO flash.
        monkeypatch.setattr(bs, "_meta_cached", lambda t: None)
        old = _series(datetime.date(2026, 2, 2), 45, price=22.0)
        new = _series(datetime.date(2026, 6, 12), 20, price=150.0)
        out = bs.sanitize_daily_bars("SPCX", old + new, "D")
        assert out[0]["t"] == "2026-06-12" and len(out) == 20

    def test_halt_without_price_jump_not_cut_without_metadata(self, monkeypatch):
        # Same-company halt: a ~70-day gap but the price resumes near where it left
        # off (no big jump) and no listing metadata → NOT cut (don't chop a halt).
        monkeypatch.setattr(bs, "_meta_cached", lambda t: None)
        a = _series(datetime.date(2026, 2, 2), 45, price=22.0)
        b = _series(datetime.date(2026, 6, 12), 20, price=24.0)  # ~1.1× — not reuse
        out = bs.sanitize_daily_bars("HALT2", a + b, "D")
        assert len(out) == 65

    def test_huge_gap_cut_without_metadata(self, monkeypatch):
        # Cold metadata (meta None) but an unmistakable multi-year gap ⇒ still cut.
        monkeypatch.setattr(bs, "_meta_cached", lambda t: None)
        old = _series(datetime.date(2010, 1, 4), 30)
        new = _series(datetime.date(2026, 4, 2), 20, price=50.0)
        out = bs.sanitize_daily_bars("XYZ", old + new, "D")
        assert out[0]["t"] == "2026-04-02"


# ── Split self-heal ─────────────────────────────────────────────────────────
class TestSplitAdjust:
    def _split_series(self, pre_price, post_price):
        pre = _series(datetime.date(2012, 1, 3), 20, price=pre_price)
        # relabel pre dates strictly before the split; post on/after
        post = _series(datetime.date(2012, 2, 16), 20, price=post_price)
        return pre + post

    def test_unadjusted_2for1_is_healed(self):
        bars = self._split_series(pre_price=20.0, post_price=10.0)  # provider MISSED it
        _seed("MNST", ipo="1995-01-01", splits=[("2012-02-16", 2.0)])
        out = bs.sanitize_daily_bars("MNST", bars, "D")
        pre_last = [b for b in out if b["t"] < "2012-02-16"][-1]
        post_first = [b for b in out if b["t"] >= "2012-02-16"][0]
        # pre halved to ~10 → continuous across the boundary
        assert abs(pre_last["c"] / post_first["c"] - 1.0) < 0.1

    def test_already_adjusted_left_alone(self):
        bars = self._split_series(pre_price=10.0, post_price=10.0)  # already smooth
        before = [dict(b) for b in bars]
        _seed("OK", ipo="1995-01-01", splits=[("2012-02-16", 2.0)])
        out = bs.sanitize_daily_bars("OK", bars, "D")
        assert [b["c"] for b in out] == [b["c"] for b in before]

    def test_real_gap_not_matching_ratio_left_alone(self):
        # A 30% gap at the split date does NOT match a 2:1 → ambiguous → untouched.
        bars = self._split_series(pre_price=13.0, post_price=10.0)
        _seed("GAP", ipo="1995-01-01", splits=[("2012-02-16", 2.0)])
        out = bs.sanitize_daily_bars("GAP", bars, "D")
        pre_last = [b for b in out if b["t"] < "2012-02-16"][-1]
        assert abs(pre_last["c"] - 13.0) < 0.01  # unchanged


# ── Lone bad-bar wick clamp ─────────────────────────────────────────────────
class TestWickClamp:
    def test_extreme_lone_upper_wick_clamped(self):
        bars = _series(datetime.date(2024, 6, 3), 10, price=120.0)
        bars[5]["h"] = 195.95                      # NVDA-style bad print
        _seed("NVDA", ipo="1999-01-22", splits=[])
        out = bs.sanitize_daily_bars("NVDA", bars, "D")
        assert out[5]["h"] < 130

    def test_real_big_move_body_not_clamped(self):
        # A genuine +60% move is a big BODY (o→c), not a wick → untouched.
        bars = _series(datetime.date(2024, 6, 3), 10, price=10.0)
        bars[5].update(o=10.0, c=16.0, h=16.1, l=9.9)
        _seed("RUN", ipo="2000-01-01", splits=[])
        out = bs.sanitize_daily_bars("RUN", bars, "D")
        assert out[5]["h"] == 16.1

    def test_wick_corroborated_by_neighbors_kept(self):
        bars = _series(datetime.date(2024, 6, 3), 10, price=10.0)
        for i in (4, 5, 6):
            bars[i]["h"] = 15.0                    # a real multi-day spike
        _seed("VOL", ipo="2000-01-01", splits=[])
        out = bs.sanitize_daily_bars("VOL", bars, "D")
        assert out[5]["h"] == 15.0


# ── Guards / passthrough ────────────────────────────────────────────────────
class TestPassthrough:
    def test_intraday_untouched(self):
        bars = [{"t": 1_700_000_000, "o": 1, "h": 9, "l": 1, "c": 1, "v": 1}]
        out = bs.sanitize_daily_bars("X", bars, "5")
        assert out == bars

    def test_cold_metadata_returns_bars(self, monkeypatch):
        monkeypatch.setattr(bs, "_meta_cached", lambda t: None)
        bars = _series(datetime.date(2020, 1, 2), 50)
        out = bs.sanitize_daily_bars("COLD", list(bars), "D")
        assert len(out) == 50   # no crash; served as-is (bg warm populates for next)

    def test_disabled_flag_passthrough(self, monkeypatch):
        monkeypatch.setattr(bs, "_ENABLED", False)
        bars = _series(datetime.date(2015, 1, 5), 40) + _series(datetime.date(2026, 4, 2), 5)
        _seed("DRAM", ipo="2026-04-02", splits=[])
        out = bs.sanitize_daily_bars("DRAM", list(bars), "D")
        assert len(out) == 45   # untouched when disabled
