"""earnings_enrichment.get_pre_earnings_context — pre-earnings 5d/30d price
context, folded into the Brief section's payload.

Regression (found live via a paid-member browser walkthrough of the
redesigned earnings modal): a yfinance daily `Close` can be `NaN` around a
data gap / split-adjustment edge — confirmed live for UBER. `ret_5d =
((last / NaN) - 1) * 100` -> `float('nan')`, which passes an `is not None`
guard (`nan is not None` is `True` -- the Python-side sibling of this
codebase's JS `Number(null) === 0` trap) and reaches stdlib `json.dumps`,
which raises `ValueError: Out of range float values are not JSON compliant:
nan`. That 500'd the WHOLE `/api/earnings-analysis/{sym}` response (not just
this one field), which is why UBER's Brief tab showed "Brief unavailable
right now" instead of its real preview/analysis.
"""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pandas as pd

from api.services.earnings_enrichment import get_pre_earnings_context

SYM = "NANSYM"


def _closes_df(values):
    return pd.DataFrame({"Close": values})


def test_nan_close_six_sessions_back_never_returns_a_raw_nan():
    # 25 clean sessions, except the exact -6 lookback bucket ret_5d reads —
    # the real-world yfinance shape that broke UBER live.
    values = [100.0] * 25
    values[-6] = float("nan")
    mock_ticker = MagicMock()
    mock_ticker.history.return_value = _closes_df(values)
    with patch("yfinance.Ticker", return_value=mock_ticker):
        out = get_pre_earnings_context(SYM)

    assert out is not None
    assert out["ret_5d_pct"] is None                        # never a raw NaN
    assert "nan" not in (out["label"] or "").lower()         # never leaks into the label
    assert out["ret_30d_pct"] is not None                    # the healthy -22 bucket is unaffected

    # The literal failure mode this regression guards: a NaN in the dict
    # makes stdlib json.dumps raise ValueError before this fix.
    json.dumps(out)


def test_finite_pct_rejects_nan_and_inf_but_keeps_real_numbers():
    from api.services.earnings_enrichment import _finite_pct  # local: doesn't exist pre-fix
    assert _finite_pct(float("nan")) is None
    assert _finite_pct(float("inf")) is None
    assert _finite_pct(float("-inf")) is None
    assert _finite_pct(None) is None
    assert _finite_pct(3.14159) == 3.1
    assert _finite_pct(0.0) == 0.0   # a genuine zero return must survive, never dropped
