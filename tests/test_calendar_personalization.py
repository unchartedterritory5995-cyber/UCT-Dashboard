"""S6 CP2' -- `get_user_ticker_sets` is now a thin delegate onto
`member_interest.interest_for`. The four per-source functions moved there
(ownership genuinely relocated, not merely renamed), so these tests patch
`member_interest`'s functions rather than `calendar_personalization`'s own --
`calendar_personalization` no longer defines them at all.

This file's job is unchanged: prove the migration is a no-op at the
`get_user_ticker_sets`/`to_payload` layer -- same shape, same union, same
JSON-serializable payload -- regardless of which module does the reading.
"""
from unittest import mock

from api.services import calendar_personalization as cp
from api.services import member_interest as mi


def test_get_user_ticker_sets_unions_sources():
    with mock.patch.object(mi, "_watchlist_syms", return_value={"AAPL", "MSFT"}), \
         mock.patch.object(mi, "_flagged_syms", return_value={"NVDA"}), \
         mock.patch.object(mi, "_position_syms", return_value={"TSLA"}), \
         mock.patch.object(mi, "_uct20_syms", return_value={"AAPL", "AMD"}):
        out = cp.get_user_ticker_sets("user-1")
    assert out["watchlist"] == {"AAPL", "MSFT"}
    assert out["flagged"] == {"NVDA"}
    assert out["positions"] == {"TSLA"}
    assert out["uct20"] == {"AAPL", "AMD"}
    assert out["all_mine"] == {"AAPL", "MSFT", "NVDA", "TSLA", "AMD"}


def test_get_user_ticker_sets_never_raises_on_a_failing_source():
    """⛔ Carried over from `calendar_personalization.py`'s original stated
    contract: 'Each source is wrapped in try/except so one failing source
    never blocks the others. Never raises.' The migration must not lose this."""
    with mock.patch.object(mi, "_watchlist_syms", side_effect=RuntimeError("db down")), \
         mock.patch.object(mi, "_flagged_syms", return_value={"NVDA"}), \
         mock.patch.object(mi, "_position_syms", return_value=set()), \
         mock.patch.object(mi, "_uct20_syms", return_value=set()):
        out = cp.get_user_ticker_sets("user-2")
    assert out["watchlist"] == set()
    assert out["flagged"] == {"NVDA"}
    assert out["all_mine"] == {"NVDA"}


def test_sets_are_json_serializable_lists_via_endpoint_shape():
    out = cp.to_payload({"watchlist": {"AAPL"}, "flagged": set(),
                         "positions": set(), "uct20": set(), "all_mine": {"AAPL"}})
    assert out["watchlist"] == ["AAPL"]
    assert isinstance(out["all_mine"], list)
