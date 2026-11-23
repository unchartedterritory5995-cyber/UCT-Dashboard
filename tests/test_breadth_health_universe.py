"""Health on US / Nasdaq / NYSE: each universe's own bands (2026-11-23). Synthetic values only."""
from __future__ import annotations

from api.services import breadth_monitor as bm
from api.services import breadth_universe_monitor as bum

ROW = {"pct_above_50sma": 50.0, "ratio_5day": 1.1, "magna_up": 30, "magna_down": 20,
       "hi_ratio": 2.0, "stage2_count": 150, "universe_count": 1000, "adv_decline": 10,
       "cboe_putcall": 0.45, "aaii_spread": -5.0, "vix": 20.0}


def test_uct_scores_exactly_as_before():
    # the UCT bands, spelled out: the score UCT members have always seen
    def lerp(v, lo, hi, w):
        return 0 if v <= lo else w if v >= hi else round((v - lo) / (hi - lo) * w, 1)
    want = (lerp(50, 30, 65, 20) + lerp(1.1, 0.7, 1.5, 15) + lerp(60, 40, 70, 10) + lerp(2.0, 0.5, 5.0, 10)
            + lerp(0.45, 0.37, 0.53, 10) + lerp(5, -30, 20, 10) + lerp(10, 0, 12, 10) + lerp(15, 5, 25, 10) + 5)
    assert bm._score_breakdown(ROW)[0] == round(want, 1)
    assert bm._score_breakdown(ROW, None) == bm._score_breakdown(ROW, {})


def test_every_universe_has_calibrated_bands_and_health_is_no_longer_hidden():
    assert "breadth_score" not in bum.HIDDEN
    for u in bum.UNIVERSES:
        b = bm.health_bands(u)
        assert set(b) == set(bm.UCT_BANDS)
        assert all(lo < hi for lo, hi in b.values())


def test_a_universe_row_is_scored_with_its_own_bands():
    u = "us"
    row = bm._finish_universe_row({k: v for k, v in ROW.items() if k not in bum.MARKET_WIDE}, u,
                                  {k: ROW[k] for k in ("cboe_putcall", "aaii_spread", "vix")})
    assert row["breadth_score"] == bm._score_breakdown({**ROW}, bm.health_bands(u))[0]
    assert row["breadth_score"] is not None


def test_a_universe_without_bands_shows_no_health(monkeypatch):
    monkeypatch.setattr(bm, "health_bands", lambda u: None)
    row = bm._finish_universe_row(dict(ROW), "us", None)
    assert row["breadth_score"] is None


def test_shading_ranks_health_in_each_universe():
    from api.services import breadth_shade_rule as rule
    assert "breadth_score" not in rule.NOT_PER_UNIVERSE
