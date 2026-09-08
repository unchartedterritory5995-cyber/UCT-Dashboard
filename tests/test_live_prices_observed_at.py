"""Seam 8 (Price-Move Evidence Timestamp Convergence, 2026-09-07): the vendor's
own per-ticker observation timestamp, already computed by
`massive.py::_MassiveRestClient.get_batch_quotes` for every ticker in a batch
call (previously folded into an aggregate freshness classification and
discarded), is now ALSO stamped onto each ticker's own dict (`_observed_at`)
and read straight off it by `live_prices.py::_fetch_snapshots`, which exposes
it publicly as `observed_at`. Two layers, two test classes:
  - massive.py's own stamping (real `get_batch_quotes`, fake `_typed_get`)
  - live_prices.py reading that stamp back out (fake client, mirrors
    test_live_prices_day_close.py's `_FakeClient` convention)
"""
from __future__ import annotations

from api.routers import live_prices as lp
from api.services import massive


class TestGetBatchQuotesStampsObservedAt:
    def _client(self, monkeypatch, typed_get_result):
        monkeypatch.setenv("MASSIVE_API_KEY", "test-key")
        client = massive._MassiveRestClient()
        monkeypatch.setattr(client, "_typed_get", lambda path, timeout=None: typed_get_result)
        return client

    def test_updated_field_becomes_observed_at_seconds(self, monkeypatch):
        # updated is epoch NANOSECONDS on the wire (massive.py's own
        # _ticker_observed_at docstring) -- 1_800_000_000_123_456_789ns.
        client = self._client(monkeypatch, {"tickers": [
            {"ticker": "AAPL", "updated": 1_800_000_000_123_456_789,
             "day": {"c": 10.0}, "prevDay": {"c": 9.5}, "lastTrade": {"p": 10.2}},
        ]})
        result = client.get_batch_quotes(["AAPL"])
        assert result.value["AAPL"]["_observed_at"] == 1_800_000_000_123_456_789 / 1e9

    def test_missing_updated_falls_back_to_last_trade_t(self, monkeypatch):
        client = self._client(monkeypatch, {"tickers": [
            {"ticker": "AAPL", "lastTrade": {"t": 1_800_000_000_000_000_000, "p": 10.2},
             "day": {"c": 10.0}, "prevDay": {"c": 9.5}},
        ]})
        result = client.get_batch_quotes(["AAPL"])
        assert result.value["AAPL"]["_observed_at"] == 1_800_000_000_000_000_000 / 1e9

    def test_neither_field_present_stamps_none_not_a_guess(self, monkeypatch):
        client = self._client(monkeypatch, {"tickers": [
            {"ticker": "AAPL", "day": {"c": 10.0}, "prevDay": {"c": 9.5}, "lastTrade": {"p": 10.2}},
        ]})
        result = client.get_batch_quotes(["AAPL"])
        assert result.value["AAPL"]["_observed_at"] is None

    def test_every_ticker_in_the_batch_gets_its_own_stamp_not_just_the_first(self, monkeypatch):
        # Regression guard for the removed early `break`: before Seam 8 the
        # freshness loop stopped at the first stale ticker, which would have
        # left every ticker after it unstamped.
        client = self._client(monkeypatch, {"tickers": [
            {"ticker": "AAPL", "updated": 1_000_000_000_000_000_000,
             "day": {"c": 10.0}, "prevDay": {"c": 9.5}, "lastTrade": {"p": 10.2}},
            {"ticker": "MSFT", "updated": 2_000_000_000_000_000_000,
             "day": {"c": 20.0}, "prevDay": {"c": 19.5}, "lastTrade": {"p": 20.2}},
        ]})
        result = client.get_batch_quotes(["AAPL", "MSFT"])
        assert result.value["AAPL"]["_observed_at"] == 1_000_000_000_000_000_000 / 1e9
        assert result.value["MSFT"]["_observed_at"] == 2_000_000_000_000_000_000 / 1e9


class _FakeClient:
    """Mirrors test_live_prices_day_close.py's _FakeClient convention: hands
    _fetch_snapshots a pre-built ticker dict as massive.py's REAL
    get_batch_quotes would already have stamped it (this test's concern is
    live_prices.py's own read-and-expose logic, not massive.py's stamping,
    which TestGetBatchQuotesStampsObservedAt above covers directly)."""
    _api_key = "k"

    def __init__(self, observed_at):
        self._observed_at = observed_at

    def get_batch_quotes(self, tickers, *, entity_ids=None):
        from api.services import provider_errors as _pe
        return _pe.ProviderResult(
            value={"AAPL": {
                "ticker": "AAPL",
                "day": {"c": 10.0, "o": 1, "h": 2, "l": 0.5, "v": 100},
                "prevDay": {"c": 9.5},
                "lastTrade": {"p": 10.2},
                "todaysChangePerc": 1.0,
                "todaysChange": 0.1,
                "_observed_at": self._observed_at,
            }},
            provenance=_pe.ProvenanceRecord(vendor="massive", source_activity="test"),
            licensing_class="R",
        )


class TestFetchSnapshotsExposesObservedAt:
    def test_a_real_stamp_is_surfaced_as_observed_at(self):
        out = lp._fetch_snapshots(_FakeClient(observed_at=1_800_000_000.5), ["AAPL"], "regular")
        assert out["AAPL"]["observed_at"] == 1_800_000_000.5

    def test_no_stamp_surfaces_observed_at_none_not_a_crash(self):
        out = lp._fetch_snapshots(_FakeClient(observed_at=None), ["AAPL"], "regular")
        assert out["AAPL"]["observed_at"] is None


# Closed-market fallback path -- mirrors test_live_prices_market_closed.py's
# own _ClosedClient/_closed_ticker/session_closes convention exactly (that
# file established the pattern; this one only needs it for one assertion, so
# it is duplicated locally rather than shared, matching this test suite's
# existing one-concern-per-file style).

def _closed_ticker(sym: str, prev: dict) -> dict:
    return {
        "ticker": sym, "todaysChangePerc": 0, "todaysChange": 0, "updated": 0,
        "day": {"o": 0, "h": 0, "l": 0, "c": 0, "v": 0, "vw": 0},
        "lastQuote": {"P": 0, "S": 0, "p": 0, "s": 0, "t": 0},
        "lastTrade": {"i": "", "p": 0, "s": 0, "t": 0, "x": 0},
        "min": {"av": 0, "t": 0, "n": 0, "o": 0, "h": 0, "l": 0, "c": 0, "v": 0},
        "prevDay": prev,
    }


_AAPL_FRIDAY = {"o": 321.79, "h": 334.37, "l": 321.62, "c": 333.02, "v": 4.7489415903844e07, "vw": 331.448}


class _ClosedClient:
    _api_key = "k"

    def __init__(self, *tickers):
        self._tickers = list(tickers)

    def get_batch_quotes(self, tickers, *, entity_ids=None):
        from api.services import provider_errors as _pe
        return _pe.ProviderResult(
            value={t["ticker"]: t for t in self._tickers},
            provenance=_pe.ProvenanceRecord(vendor="massive", source_activity="test"),
            licensing_class="R",
        )


def test_closed_market_fallback_row_always_carries_observed_at_none(monkeypatch):
    # The weekend/holiday branch is built from prevDay/_session_closes(),
    # never from the live `t` at all -- it has no per-symbol observation to
    # report (see live_prices.py's own Seam 8 comment on this row).
    monkeypatch.setattr(lp, "_session_closes", lambda: ({"AAPL": 333.02}, {"AAPL": 321.66}))
    out = lp._fetch_snapshots(
        _ClosedClient(_closed_ticker("AAPL", _AAPL_FRIDAY)), ["AAPL"], "post_market",
    )
    assert out["AAPL"]["observed_at"] is None
