"""Deep-history warm — smoke + guard tests.

The heavy work (provider fetches) isn't unit-tested; these lock the SAFETY
behavior: it never runs on the web pod, never runs unflagged, and its ticker
list is resilient (always at least the priority megacaps, even with no DB/files).
"""
import os
from unittest.mock import patch

from api.services import deep_history_warm as dhw


def test_ticker_list_always_includes_priority_and_is_resilient():
    tickers = dhw._build_ticker_list()
    assert "SPY" in tickers and "NVDA" in tickers and "SMCI" in tickers
    # No dupes, all upper-case, priority names come first.
    assert len(tickers) == len(set(tickers))
    assert all(t == t.upper() for t in tickers)
    assert tickers[0] == "SPY"


def test_deep_targets_match_frontend_full_history():
    # Daily target must reach full history (frontend fullBarsFor('D') = 20000).
    assert dhw._DEEP_TARGET["D"] == 20000
    # Skip floor is below the target so a modern name with only a few thousand
    # sessions is still attempted once (its cache hit is fast if nothing deeper).
    assert dhw._DEEP_ENOUGH["D"] < dhw._DEEP_TARGET["D"]


def test_no_op_when_flag_disabled(capsys):
    with patch.dict(os.environ, {"DEEP_HISTORY_WARM_ENABLED": "0", "WORKER_ENABLED": "1"}):
        dhw.deep_warm_history_once()
    assert "Skipped" in capsys.readouterr().out


def test_no_op_on_web_pod_even_when_flag_enabled(capsys):
    # The OOM lesson: NEVER on web. Flag on but WORKER_ENABLED unset → refuse.
    with patch.dict(os.environ, {"DEEP_HISTORY_WARM_ENABLED": "1"}, clear=False):
        os.environ.pop("WORKER_ENABLED", None)
        dhw.deep_warm_history_once()
    assert "worker-only" in capsys.readouterr().out.lower()
