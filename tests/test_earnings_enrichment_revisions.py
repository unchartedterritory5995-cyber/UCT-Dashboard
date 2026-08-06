"""earnings_enrichment.get_estimate_revisions — FMP `stable/grades-historical`
primary, Finnhub `/stock/recommendation` fallback (data-dependability
migration plan, Task 5, third call site).
"""
from __future__ import annotations

from unittest.mock import patch

from api.services.earnings_enrichment import get_estimate_revisions

SYM = "REVSYM"

_FMP_HIST = [
    {"period": "2026-08-01", "strongBuy": 10, "buy": 20, "hold": 5, "sell": 2, "strongSell": 1},
    {"period": "2026-07-01", "strongBuy": 8, "buy": 18, "hold": 6, "sell": 2, "strongSell": 1},
    {"period": "2026-06-01", "strongBuy": 6, "buy": 15, "hold": 8, "sell": 3, "strongSell": 1},
    {"period": "2026-05-01", "strongBuy": 5, "buy": 12, "hold": 10, "sell": 4, "strongSell": 2},
]

_FH_HIST = [
    {"period": "2026-08-01", "strongBuy": 10, "buy": 20, "hold": 5, "sell": 2, "strongSell": 1},
    {"period": "2026-07-01", "strongBuy": 8, "buy": 18, "hold": 6, "sell": 2, "strongSell": 1},
]


def test_fmp_primary_computes_30d_and_90d_deltas():
    with patch("api.services.earnings_estimates._fmp_grades_historical",
               return_value=_FMP_HIST) as fmp_spy, \
         patch("api.services.finnhub_client.fh_get") as fh_spy:
        out = get_estimate_revisions(SYM)

    fmp_spy.assert_called_once_with(SYM, limit=4)
    fh_spy.assert_not_called()
    assert out is not None
    latest_net = (10 + 20) - (2 + 1)          # 27
    prior30_net = (8 + 18) - (2 + 1)          # 23
    prior90_net = (5 + 12) - (4 + 2)          # 11
    assert out["delta_30d"] == latest_net - prior30_net
    assert out["delta_90d"] == latest_net - prior90_net
    assert out["buy_count"] == 30
    assert out["sell_count"] == 3


def test_falls_back_to_finnhub_when_fmp_yields_nothing():
    with patch("api.services.earnings_estimates._fmp_grades_historical",
               return_value=[]), \
         patch("api.services.finnhub_client.fh_get",
               return_value=_FH_HIST) as fh_spy:
        out = get_estimate_revisions(SYM)

    fh_spy.assert_called_once()
    assert fh_spy.call_args.args[0] == "/stock/recommendation"
    assert out is not None
    assert out["buy_count"] == 30


def test_none_when_both_providers_yield_nothing():
    with patch("api.services.earnings_estimates._fmp_grades_historical",
               return_value=[]), \
         patch("api.services.finnhub_client.fh_get", return_value=None):
        assert get_estimate_revisions(SYM) is None


def test_none_on_unexpected_exception_never_raises():
    with patch("api.services.earnings_estimates._fmp_grades_historical",
               side_effect=RuntimeError("boom")):
        assert get_estimate_revisions(SYM) is None


def test_arrow_and_label_reflect_a_worsening_trend():
    declining = [
        {"period": "2026-08-01", "strongBuy": 2, "buy": 5, "hold": 10, "sell": 8, "strongSell": 4},
        {"period": "2026-07-01", "strongBuy": 4, "buy": 8, "hold": 8, "sell": 5, "strongSell": 2},
        {"period": "2026-06-01", "strongBuy": 6, "buy": 10, "hold": 6, "sell": 3, "strongSell": 1},
        {"period": "2026-05-01", "strongBuy": 8, "buy": 15, "hold": 4, "sell": 2, "strongSell": 0},
    ]
    with patch("api.services.earnings_estimates._fmp_grades_historical",
               return_value=declining):
        out = get_estimate_revisions(SYM)
    assert out["arrow"] == "↓"
    assert "weakening" in out["label"]
