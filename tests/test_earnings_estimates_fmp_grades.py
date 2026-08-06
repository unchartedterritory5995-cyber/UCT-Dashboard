"""FMP `stable/grades-consensus` / `stable/grades-historical` — the shared
helpers behind Task 5 of the data-dependability migration plan
(`/stock/recommendation` -> FMP). Three call sites route through these:
  - earnings_estimates.get_earnings_intel's `consensus` leg (snapshot)
  - call_recap.get_rating_changes (history)
  - earnings_enrichment.get_estimate_revisions (history)

Shape mapping locked in here, verified against LIVE payloads captured
2026-08-05:
  stable/grades-consensus  -> {symbol,strongBuy,buy,hold,sell,strongSell,consensus}
  stable/grades-historical -> {symbol,date,analystRatingsStrongBuy,
                                analystRatingsBuy,analystRatingsHold,
                                analystRatingsSell,analystRatingsStrongSell}
  (newest first; FMP AAPL sample: date desc 2026-08-01, 2026-07-01, ...)
"""
from __future__ import annotations

from unittest.mock import patch

from api.services import earnings_estimates as ee

SYM = "GRADESYM"

# Real captured shape (values redacted, structure/keys are exact).
_CONSENSUS_ROW = [{
    "symbol": SYM, "strongBuy": 1, "buy": 70, "hold": 32, "sell": 8,
    "strongSell": 0, "consensus": "Buy",
}]

_HISTORICAL_ROWS = [
    {"symbol": SYM, "date": "2026-08-01", "analystRatingsStrongBuy": 6,
     "analystRatingsBuy": 22, "analystRatingsHold": 14, "analystRatingsSell": 2,
     "analystRatingsStrongSell": 2},
    {"symbol": SYM, "date": "2026-07-01", "analystRatingsStrongBuy": 6,
     "analystRatingsBuy": 23, "analystRatingsHold": 17, "analystRatingsSell": 2,
     "analystRatingsStrongSell": 2},
]


# ── _fmp_consensus_snapshot ─────────────────────────────────────────────────

def test_consensus_snapshot_maps_the_five_buckets():
    with patch.object(ee, "_fmp_get", return_value=_CONSENSUS_ROW):
        out = ee._fmp_consensus_snapshot(SYM)
    assert out == {
        "buy": 70, "hold": 32, "sell": 8, "strongBuy": 1, "strongSell": 0,
        "period": "",
    }


def test_consensus_snapshot_preserves_a_genuine_zero_bucket():
    """strongSell=0 above must survive as 0, not be treated as 'missing'."""
    with patch.object(ee, "_fmp_get", return_value=_CONSENSUS_ROW):
        out = ee._fmp_consensus_snapshot(SYM)
    assert out["strongSell"] == 0
    assert out["strongSell"] is not None


def test_consensus_snapshot_returns_none_on_unusable_row():
    """A resolved row with none of the five bucket keys (e.g. a price-target
    row leaking in from a blanket test double) must not become a fake
    zero-filled consensus."""
    with patch.object(ee, "_fmp_get", return_value=[{"symbol": SYM}]):
        out = ee._fmp_consensus_snapshot(SYM)
    assert out is None


def test_consensus_snapshot_returns_none_when_fmp_has_nothing():
    with patch.object(ee, "_fmp_get", return_value=None):
        assert ee._fmp_consensus_snapshot(SYM) is None
    with patch.object(ee, "_fmp_get", return_value=[]):
        assert ee._fmp_consensus_snapshot(SYM) is None


# ── _fmp_grades_historical ──────────────────────────────────────────────────

def test_grades_historical_remaps_analystratings_prefix_to_bare_names():
    with patch.object(ee, "_fmp_get", return_value=_HISTORICAL_ROWS):
        out = ee._fmp_grades_historical(SYM, limit=4)
    assert len(out) == 2
    assert out[0] == {
        "period": "2026-08-01", "strongBuy": 6, "buy": 22, "hold": 14,
        "sell": 2, "strongSell": 2,
    }
    # FMP already returns newest-first — order must be preserved, not re-sorted.
    assert out[0]["period"] > out[1]["period"]


def test_grades_historical_skips_a_row_with_no_date():
    rows = [{"analystRatingsBuy": 5}] + _HISTORICAL_ROWS
    with patch.object(ee, "_fmp_get", return_value=rows):
        out = ee._fmp_grades_historical(SYM, limit=4)
    assert len(out) == 2  # the dateless row is dropped, not defaulted to ""


def test_grades_historical_empty_on_non_list_response():
    with patch.object(ee, "_fmp_get", return_value=None):
        assert ee._fmp_grades_historical(SYM) == []
    with patch.object(ee, "_fmp_get", return_value={"Error": "bad symbol"}):
        assert ee._fmp_grades_historical(SYM) == []


def test_grades_historical_passes_the_limit_param_through():
    captured = {}

    def fake_get(path, params, timeout=10):
        captured["params"] = dict(params)
        return []

    with patch.object(ee, "_fmp_get", side_effect=fake_get):
        ee._fmp_grades_historical(SYM, limit=7)
    assert captured["params"]["limit"] == 7
    assert captured["params"]["symbol"] == SYM
