"""D1 adapter gaps G2 (typed functions for uncovered endpoints) and G4 (the
multi-symbol news leg) — `api/services/fmp_client.py`.

Fixture shape follows `tests/test_fmp_adapter_status.py` exactly (module-level
`_mock_response`, an autouse fixture that sets `FMP_API_KEY` and resets the
token bucket), because the adapter's rate limiter and cached-forbidden state
are MODULE-LEVEL and leak between tests otherwise.

Every test here patches `fc._session.get` and asserts on the REQUEST THE
ADAPTER ACTUALLY BUILT (path + params, read off the mock's call args) rather
than on a return value alone — a typed function that returns the right shape
while sending the wrong path is the defect this whole abstraction exists to
prevent, and a response-only assertion cannot see it.
"""
import time

import pytest
from unittest.mock import MagicMock

from api.services import fmp_client as fc
from api.services import provider_errors as pe


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    monkeypatch.setenv("FMP_API_KEY", "test-key")
    fc._bucket_tokens = fc._FMP_RATE_LIMIT_PER_MIN
    fc._bucket_updated = time.monotonic()
    fc._bucket_denied_total = 0
    fc._served_total = 0
    # `_get_raw` consults the shared `cache` module for a 24h cached-forbidden
    # marker per path; a 401/403 in ANOTHER test would otherwise turn every
    # test below into a silent degraded-result pass.
    from api.services.cache import cache
    for path in _ALL_NEW_PATHS:
        cache.invalidate(f"fmp_forbidden_{path}")
    yield


_ALL_NEW_PATHS = (
    "/stable/profile",
    "/stable/analyst-estimates",
    "/stable/grades-news",
    "/stable/grades-latest-news",
    "/stable/news/general-latest",
    "/stable/news/stock-latest",
    "/stable/news/press-releases-latest",
    "/stable/sp500-constituent",
    "/stable/nasdaq-constituent",
    "/stable/dowjones-constituent",
    "/stable/etf/holdings",
    "/stable/news/stock",
)

#: (function name, kwargs, expected path). The G2 surface this branch adds,
#: in one place so the parametrized tests below cannot drift from each other.
G2_FUNCTIONS = [
    ("get_company_profile", {"ticker": "AAPL"}, "/stable/profile"),
    ("get_analyst_estimates", {"ticker": "AAPL"}, "/stable/analyst-estimates"),
    ("get_grades_news", {"ticker": "AAPL"}, "/stable/grades-news"),
    ("get_grades_latest_news", {}, "/stable/grades-latest-news"),
    ("get_news_general_latest", {}, "/stable/news/general-latest"),
    ("get_news_stock_latest", {}, "/stable/news/stock-latest"),
    ("get_news_press_releases_latest", {}, "/stable/news/press-releases-latest"),
    ("get_sp500_constituents", {}, "/stable/sp500-constituent"),
    ("get_nasdaq_constituents", {}, "/stable/nasdaq-constituent"),
    ("get_dowjones_constituents", {}, "/stable/dowjones-constituent"),
    ("get_etf_holdings", {"ticker": "SPY"}, "/stable/etf/holdings"),
]


def _mock_response(status_code=200, json_value=None):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_value if json_value is not None else []
    resp.raise_for_status.return_value = None
    return resp


@pytest.fixture
def sent(monkeypatch):
    """Patches the adapter's session and returns a callable giving
    `(path, params)` of the single request the adapter built."""
    get = MagicMock(return_value=_mock_response(json_value=[{"symbol": "AAPL"}]))
    monkeypatch.setattr(fc._session, "get", get)

    def _read():
        assert get.call_count == 1, f"expected exactly one FMP request, got {get.call_count}"
        url = get.call_args[0][0]
        assert url.startswith(fc._BASE_URL), url
        return url[len(fc._BASE_URL):], dict(get.call_args[1]["params"])

    _read.mock = get
    return _read


# ── G2 · the five new typed functions ──────────────────────────────────────

class TestG2TypedFunctions:
    """One test per new function: it hits the endpoint the census said was
    uncovered, with the parameter shape its live call sites use."""

    def test_get_company_profile_hits_stable_profile(self, sent):
        fc.get_company_profile("aapl")
        path, params = sent()
        assert path == "/stable/profile"
        assert params["symbol"] == "AAPL"  # uppercased like every sibling

    def test_get_analyst_estimates_always_sends_period(self, sent):
        fc.get_analyst_estimates("AAPL", period="quarter", limit=40)
        path, params = sent()
        assert path == "/stable/analyst-estimates"
        assert params["symbol"] == "AAPL"
        assert params["period"] == "quarter"
        assert params["limit"] == 40

    def test_get_analyst_estimates_defaults_to_annual_and_omits_limit(self, sent):
        fc.get_analyst_estimates("AAPL")
        _, params = sent()
        assert params["period"] == "annual"
        assert "limit" not in params

    def test_get_grades_news_hits_grades_news_not_grades_historical(self, sent):
        fc.get_grades_news("AAPL", limit=20)
        path, params = sent()
        assert path == "/stable/grades-news"
        assert params == {"symbol": "AAPL", "limit": 20, "apikey": "test-key"}

    def test_get_grades_latest_news_is_market_wide_and_sends_no_symbol(self, sent):
        fc.get_grades_latest_news(limit=100)
        path, params = sent()
        assert path == "/stable/grades-latest-news"
        assert "symbol" not in params and "symbols" not in params
        assert params["limit"] == 100

    def test_get_news_general_latest_is_market_wide_and_sends_no_symbol(self, sent):
        fc.get_news_general_latest(limit=100)
        path, params = sent()
        assert path == "/stable/news/general-latest"
        assert "symbol" not in params and "symbols" not in params
        assert params["limit"] == 100

    def test_news_stock_latest_is_the_global_feed_not_the_per_symbol_one(self, sent):
        """The two names differ by one word and the endpoints answer
        different questions; pointing this at `/stable/news/stock` would
        silently return one symbol's coverage as the whole market's."""
        fc.get_news_stock_latest(limit=250, page=2)
        path, params = sent()
        assert path == "/stable/news/stock-latest"
        assert "symbols" not in params and "symbol" not in params
        assert params["limit"] == 250 and params["page"] == 2

    def test_press_releases_latest_is_the_global_feed(self, sent):
        fc.get_news_press_releases_latest(limit=250, page=0)
        path, params = sent()
        assert path == "/stable/news/press-releases-latest"
        assert "symbols" not in params and "symbol" not in params
        assert params["page"] == 0  # page 0 must be SENT, not dropped as falsy

    @pytest.mark.parametrize("name,path", [
        ("get_sp500_constituents", "/stable/sp500-constituent"),
        ("get_nasdaq_constituents", "/stable/nasdaq-constituent"),
        ("get_dowjones_constituents", "/stable/dowjones-constituent"),
    ])
    def test_constituent_endpoints_are_market_wide_and_distinct(self, sent, name, path):
        getattr(fc, name)()
        got_path, params = sent()
        assert got_path == path
        assert "symbol" not in params

    def test_get_etf_holdings_sends_the_etf_in_symbol(self, sent):
        fc.get_etf_holdings("iwm")
        path, params = sent()
        assert path == "/stable/etf/holdings"
        assert params["symbol"] == "IWM"

    @pytest.mark.parametrize("name,kwargs,path", G2_FUNCTIONS)
    def test_every_g2_function_hits_its_own_endpoint(self, sent, name, kwargs, path):
        """Derived from one table, so a function added without a path — or
        two functions accidentally sharing one — is caught by name."""
        getattr(fc, name)(**kwargs)
        got_path, _ = sent()
        assert got_path == path

    @pytest.mark.parametrize("call", [
        lambda: fc.get_company_profile("AAPL"),
        lambda: fc.get_analyst_estimates("AAPL"),
        lambda: fc.get_grades_news("AAPL"),
        lambda: fc.get_grades_latest_news(),
        lambda: fc.get_news_general_latest(),
        lambda: fc.get_news_stock_latest(),
        lambda: fc.get_news_press_releases_latest(),
        lambda: fc.get_sp500_constituents(),
        lambda: fc.get_nasdaq_constituents(),
        lambda: fc.get_dowjones_constituents(),
        lambda: fc.get_etf_holdings("SPY"),
        lambda: fc.get_news_stock_multi(["AAPL", "MSFT"]),
    ])
    def test_every_new_function_returns_a_stamped_provider_result(self, sent, call):
        result = call()
        assert isinstance(result, pe.ProviderResult)
        assert result.provenance.vendor == "fmp"
        # provenance names the typed function that produced the value, so a
        # consumer can tell get_news_stock from get_news_stock_multi.
        assert result.provenance.source_activity.startswith("fmp_client.get_")
        assert result.licensing_class in {"A", "LA", "R", "U", "X"}
        assert result.freshness == "end_of_day"
        assert result.degraded is None

    @pytest.mark.parametrize("name,kwargs,_path", G2_FUNCTIONS)
    def test_an_empty_list_is_not_found_not_an_empty_success(self, monkeypatch,
                                                             name, kwargs, _path):
        monkeypatch.setattr(fc._session, "get",
                            MagicMock(return_value=_mock_response(json_value=[])))
        with pytest.raises(fc.FMPNotFound):
            getattr(fc, name)(**kwargs)

    def test_multi_symbol_news_also_treats_an_empty_list_as_not_found(self, monkeypatch):
        monkeypatch.setattr(fc._session, "get",
                            MagicMock(return_value=_mock_response(json_value=[])))
        with pytest.raises(fc.FMPNotFound):
            fc.get_news_stock_multi(["NOPE"])

    def test_profile_licensing_class_is_U_because_the_pair_is_unregistered(self, sent):
        """Not a cosmetic assertion. The licensing register has NO row for
        FMP company-profile data, and this module's documented rule is that
        an un-researched (vendor, data_class) pair stamps "U" — never an "R"
        borrowed from a neighbouring class it merely resembles. Pinning the
        letter here means a future change that quietly re-points this at
        `data_class="fundamentals"` to make it look researched goes red."""
        assert fc.get_company_profile("AAPL").licensing_class == "U"

    def test_the_registered_pairs_really_do_stamp_R(self, sent):
        """The control for the test above: if `licensing_class_for` were
        broken or always returned "U", the profile assertion would pass for
        the wrong reason."""
        assert fc.get_analyst_estimates("AAPL").licensing_class == "R"
        sent.mock.reset_mock()
        assert fc.get_grades_news("AAPL").licensing_class == "R"
        sent.mock.reset_mock()
        assert fc.get_news_general_latest().licensing_class == "R"

    def test_new_functions_do_not_expose_a_timeout_parameter(self):
        """Gap G1 is a SEPARATE pending owner ruling. A `timeout=` kwarg on
        any of these would quietly pre-empt it."""
        import inspect
        names = [n for n, _, _ in G2_FUNCTIONS] + ["get_news_stock_multi"]
        for name in names:
            sig = inspect.signature(getattr(fc, name))
            assert "timeout" not in sig.parameters, f"{name} exposes a timeout parameter (G1)"

    def test_no_existing_typed_function_grew_a_timeout_parameter_either(self):
        """The non-vacuity control for the test above: if the adapter had
        NO timeout parameters anywhere for an unrelated reason, that test
        would pass while proving nothing about G1. This sweeps every
        module-level `get_*` and would go red on any of them."""
        import inspect
        publics = [n for n in dir(fc) if n.startswith("get_") and callable(getattr(fc, n))]
        assert len(publics) >= 30, f"expected the full typed surface, found {len(publics)}"
        offenders = [n for n in publics
                     if "timeout" in inspect.signature(getattr(fc, n)).parameters]
        assert offenders == [], f"typed functions exposing a timeout (G1): {offenders}"


# ── G4 · the multi-symbol news leg ─────────────────────────────────────────

class TestG4MultiSymbolNews:

    def test_multi_sends_one_request_with_a_comma_separated_symbol_list(self, sent):
        fc.get_news_stock_multi(["aapl", "msft", "nvda"], limit=100)
        path, params = sent()
        assert path == "/stable/news/stock"
        assert params["symbols"] == "AAPL,MSFT,NVDA"
        assert params["limit"] == 100

    def test_multi_dedupes_preserving_order(self, sent):
        fc.get_news_stock_multi(["AAPL", "msft", "AAPL", " MSFT ", "NVDA"])
        _, params = sent()
        assert params["symbols"] == "AAPL,MSFT,NVDA"

    def test_multi_never_truncates_the_symbol_list(self, sent):
        """A silently-capped list returns fewer rows and reads as a quiet
        news day. The caller's batch size is the caller's policy."""
        syms = [f"SYM{i}" for i in range(120)]
        fc.get_news_stock_multi(syms)
        _, params = sent()
        assert params["symbols"].split(",") == syms
        assert len(params["symbols"].split(",")) == 120

    def test_multi_refuses_a_bare_string(self, sent):
        """`Sequence[str]` admits a str, and iterating one yields CHARACTERS
        — `"AAPL"` would become `A,P,L` and silently return the wrong news."""
        with pytest.raises(TypeError) as exc:
            fc.get_news_stock_multi("AAPL")
        assert "get_news_stock" in str(exc.value)
        assert sent.mock.call_count == 0  # and it never reached the network

    @pytest.mark.parametrize("empty", [[], ["", "  "], ()])
    def test_multi_refuses_an_empty_symbol_list_without_calling_fmp(self, sent, empty):
        """Firing a request that cannot succeed would still spend a
        rate-limit token to learn that."""
        before = fc.budget()["served_total"]
        with pytest.raises(ValueError):
            fc.get_news_stock_multi(empty)
        assert sent.mock.call_count == 0
        assert fc.budget()["served_total"] == before

    def test_multi_matches_single_ticker_behaviour_exactly_bar_the_symbols(self, monkeypatch):
        """The load-bearing G4 assertion. Both functions hit the SAME
        endpoint, so every other facet of the request and the stamped
        envelope must be identical — otherwise `engine.py` migrating onto
        the multi leg would silently change the news it gets."""
        calls = []

        def _capture(url, params=None, timeout=None):
            calls.append({"url": url, "params": dict(params or {}), "timeout": timeout})
            return _mock_response(json_value=[{"symbol": "AAPL"}])

        monkeypatch.setattr(fc._session, "get", _capture)

        single = fc.get_news_stock("AAPL", limit=100)
        multi = fc.get_news_stock_multi(["AAPL"], limit=100)

        assert calls[0]["url"] == calls[1]["url"]
        assert calls[0]["timeout"] == calls[1]["timeout"]
        assert calls[0]["params"] == calls[1]["params"]  # incl. symbols="AAPL"
        assert single.licensing_class == multi.licensing_class
        assert single.freshness == multi.freshness
        assert single.provenance.vendor == multi.provenance.vendor
        # The ONE intended difference: provenance names the function used.
        assert single.provenance.source_activity == "fmp_client.get_news_stock"
        assert multi.provenance.source_activity == "fmp_client.get_news_stock_multi"


# ── The additive-only guarantee ────────────────────────────────────────────

class TestNothingExistingChanged:
    """G2/G4 are authorized as ADDITIVE SURFACE ONLY. These pin the two ways
    this branch could have broken that promise without any other test
    noticing."""

    def test_get_news_stock_still_takes_one_ticker_with_the_same_signature(self):
        import inspect
        sig = inspect.signature(fc.get_news_stock)
        assert list(sig.parameters) == ["ticker", "limit"]
        # `fmp_client` uses `from __future__ import annotations`, so every
        # annotation is a STRING at runtime — comparing against `str` itself
        # would fail for the right-looking wrong reason.
        assert sig.parameters["ticker"].annotation == "str"
        assert sig.parameters["limit"].default is None
        assert sig.parameters["limit"].kind is inspect.Parameter.KEYWORD_ONLY

    def test_the_new_names_are_new_and_do_not_shadow_an_existing_one(self):
        """A new function that happened to reuse an existing name would
        REPLACE it at import time — additive in the diff, destructive at
        runtime (the `_parse_mdy` double-definition class)."""
        import ast
        import inspect
        src = inspect.getsource(fc)
        names = [n.name for n in ast.parse(src).body
                 if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
        assert len(names) == len(set(names)), \
            f"duplicate top-level def in fmp_client.py: {sorted(set(n for n in names if names.count(n) > 1))}"
        for new in [n for n, _, _ in G2_FUNCTIONS] + ["get_news_stock_multi", "_symbols_csv"]:
            assert names.count(new) == 1
