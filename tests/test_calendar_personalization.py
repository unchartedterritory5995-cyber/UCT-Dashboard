from unittest import mock
from api.services import calendar_personalization as cp


def test_get_user_ticker_sets_unions_sources():
    with mock.patch.object(cp, "_watchlist_syms", return_value={"AAPL", "MSFT"}), \
         mock.patch.object(cp, "_flagged_syms", return_value={"NVDA"}), \
         mock.patch.object(cp, "_position_syms", return_value={"TSLA"}), \
         mock.patch.object(cp, "_uct20_syms", return_value={"AAPL", "AMD"}):
        out = cp.get_user_ticker_sets("user-1")
    assert out["watchlist"] == {"AAPL", "MSFT"}
    assert out["flagged"] == {"NVDA"}
    assert out["positions"] == {"TSLA"}
    assert out["uct20"] == {"AAPL", "AMD"}
    assert out["all_mine"] == {"AAPL", "MSFT", "NVDA", "TSLA", "AMD"}


def test_sets_are_json_serializable_lists_via_endpoint_shape():
    out = cp.to_payload({"watchlist": {"AAPL"}, "flagged": set(),
                         "positions": set(), "uct20": set(), "all_mine": {"AAPL"}})
    assert out["watchlist"] == ["AAPL"]
    assert isinstance(out["all_mine"], list)
