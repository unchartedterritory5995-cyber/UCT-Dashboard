"""A non-finite fundamental is NO VALUE, never a number.

Measured on prod 2026-10-18: KOPN's `pe_fwd` was +inf. Yahoo ships the string
"Infinity" for `forwardPE`, `float()` parses it, and JSON cannot carry it, so

  * `GET /api/fundamentals/KOPN` answered 500, and
  * every `/api/screener/scan` page carrying KOPN with `pe_fwd` answered 500 —
    the Valuation view sorted by Fwd P/E descending failed for every member.

Two producers, two rails: `fundamentals._round*` (the value as gathered) and
`enrich.ratings_fields` (the screener column, which reads a store that already
holds the inf for up to its refresh TTL).
"""
import json
import math
from unittest.mock import patch

import pytest

import api.services.fundamentals as fund
from api.services.screener import enrich


@pytest.mark.parametrize("raw", ["Infinity", "-Infinity", "NaN", float("inf"), float("nan")])
def test_the_rounding_helpers_refuse_non_finite(raw):
    assert fund._round(raw) is None
    assert fund._round_pct(raw) is None


def test_the_rounding_helpers_keep_finite_values_exactly():
    assert fund._round("21.456") == 21.46
    assert fund._round(-3) == -3
    assert fund._round_pct(0.4865) == 48.6
    assert fund._round(None) is None


def _get(sym, info):
    fund._CACHE.set(f"fund::{sym}", None, 0)  # bust
    with patch.object(fund, "yf") as yf_mock, \
         patch("api.services.yf_util.bounded_call", lambda fn, default: fn()):
        yf_mock.Ticker.return_value.info = info
        return fund.get_fundamentals(sym)


def test_a_yahoo_infinity_forward_pe_is_blank_and_the_payload_serializes():
    out = _get("KOPN", {"symbol": "KOPN", "longName": "Kopin Corp",
                        "forwardPE": "Infinity", "trailingPE": 12.5,
                        "earningsGrowth": float("nan")})
    assert out["pe_forward"] is None
    assert out["pe_trailing"] == 12.5
    # The production failure WAS this line: Starlette renders with allow_nan=False.
    json.dumps(out, allow_nan=False)


def test_the_screener_column_refuses_an_inf_already_in_the_store():
    metrics = {"pe_fwd": float("inf"), "earnings_growth": float("nan"),
               "rev_growth": 5.0, "blended_growth": float("-inf"), "sector": "Technology"}
    out = enrich.ratings_fields(metrics, {})
    assert "pe_fwd" not in out
    assert "eps_growth" not in out
    assert "blended_growth" not in out
    assert out["rev_growth"] == 5.0
    assert out["sector"] == "Technology"
    json.dumps(out, allow_nan=False)
    assert all(not (isinstance(v, float) and not math.isfinite(v)) for v in out.values())
