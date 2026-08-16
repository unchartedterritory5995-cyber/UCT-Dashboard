"""Tests for ticker_meta service."""
import pytest
from unittest.mock import patch, MagicMock
from api.services import ticker_meta

# All-None shape _from_fmp returns on a total miss — used to deterministically
# neutralize the FMP leg in tests that are exercising something else (yfinance
# happy-path / Finnhub-fallback), so they never depend on whether FMP_API_KEY
# happens to be set in the ambient environment.
_FMP_EMPTY = {"name": None, "sector": None, "industry": None, "market_cap_musd": None}


def _yf_info(longName="Tesla Inc", sector="Consumer Cyclical",
             industry="Auto Manufacturers", exchange="NMS"):
    """⚠️ `exchange` is a yfinance MIC-ish CODE ("NMS"), not a friendly name —
    `_from_yfinance` maps it through `_YF_EXCHANGE`. Carrying it here also keeps
    the happy path a genuine yfinance-ONLY path: `_base_meta` runs the FMP leg
    whenever the name OR the exchange is missing, so a fixture without one would
    quietly depend on whether FMP_API_KEY is set in the ambient environment."""
    info = {"longName": longName, "shortName": "Tesla", "sector": sector, "industry": industry}
    if exchange is not None:
        info["exchange"] = exchange
    return info


def test_yfinance_happy_path():
    ticker_meta._mem.clear()
    with patch.object(ticker_meta, "_disk_get", return_value=None), \
         patch.object(ticker_meta, "_disk_put") as DP, \
         patch.object(ticker_meta, "_primary_theme", return_value=None), \
         patch("yfinance.Ticker") as YF:
        YF.return_value.info = _yf_info()
        out = ticker_meta.get_ticker_meta("TSLA")
    # "NMS" is mapped to the friendly name the compare-symbols legend renders.
    assert out == {"name": "Tesla Inc", "sector": "Consumer Cyclical",
                   "industry": "Auto Manufacturers", "exchange": "NASDAQ", "theme": None}
    # disk/mem cache the base meta only (no theme — theme is looked up fresh per call)
    DP.assert_called_once_with("TSLA", {"name": "Tesla Inc", "sector": "Consumer Cyclical",
                                        "industry": "Auto Manufacturers", "exchange": "NASDAQ"})


def test_memory_cache_hit_skips_fetch():
    ticker_meta._mem.clear()
    ticker_meta._mem.set("tmeta_TSLA", {"name": "Cached", "sector": None, "industry": None}, ttl=999)
    with patch.object(ticker_meta, "_primary_theme", return_value=None), \
         patch("yfinance.Ticker") as YF:
        out = ticker_meta.get_ticker_meta("TSLA")
    YF.assert_not_called()
    assert out["name"] == "Cached"


def test_finnhub_fallback_when_yfinance_fails():
    # Finnhub calls now route through the shared finnhub_client.fh_get
    # (2026-08-05) — patch the name ticker_meta._from_finnhub actually calls,
    # rather than the old raw requests.get/_fh_key seam. FMP is neutralized
    # (empty) so this test exercises the Finnhub leg specifically, regardless
    # of whether FMP_API_KEY happens to be set in the ambient environment.
    ticker_meta._mem.clear()
    with patch.object(ticker_meta, "_disk_get", return_value=None), \
         patch.object(ticker_meta, "_disk_put"), \
         patch.object(ticker_meta, "_primary_theme", return_value=None), \
         patch.object(ticker_meta, "_from_fmp", return_value=dict(_FMP_EMPTY)), \
         patch("yfinance.Ticker", side_effect=Exception("yf down")), \
         patch.object(ticker_meta, "fh_get",
                      return_value={"name": "Rocket Lab USA", "finnhubIndustry": "Aerospace"}):
        out = ticker_meta.get_ticker_meta("RKLB")
    assert out == {"name": "Rocket Lab USA", "sector": None, "industry": "Aerospace",
                   "exchange": None, "theme": None}


def test_total_failure_returns_nulls_and_not_cached():
    ticker_meta._mem.clear()
    with patch.object(ticker_meta, "_disk_get", return_value=None), \
         patch.object(ticker_meta, "_disk_put") as DP, \
         patch.object(ticker_meta, "_primary_theme", return_value=None), \
         patch.object(ticker_meta, "_from_fmp", return_value=dict(_FMP_EMPTY)), \
         patch("yfinance.Ticker", side_effect=Exception("x")), \
         patch.object(ticker_meta, "fh_get", return_value=None):
        out = ticker_meta.get_ticker_meta("ZZZZ")
    assert out == {"name": None, "sector": None, "industry": None,
                   "exchange": None, "theme": None}
    DP.assert_not_called()
    assert ticker_meta._mem.get("tmeta_ZZZZ") is None


def test_disk_cache_hit_populates_mem_and_skips_fetch():
    ticker_meta._mem.clear()
    cached = {"name": "From Disk", "sector": "Tech", "industry": "Semis", "exchange": "NASDAQ"}
    with patch.object(ticker_meta, "_disk_get", return_value=cached), \
         patch.object(ticker_meta, "_primary_theme", return_value=None), \
         patch("yfinance.Ticker") as YF:
        out = ticker_meta.get_ticker_meta("NVDA")
    YF.assert_not_called()
    assert out == {**cached, "theme": None}
    # mem caches the base meta only — not the per-call theme
    assert ticker_meta._mem.get("tmeta_NVDA") == cached


def test_a_disk_entry_from_before_exchange_existed_is_treated_as_STALE():
    """⚠️ The rail this file was MISSING, and the reason its cache test looked
    broken when `exchange` shipped (3ca0f574a).

    `_base_meta` deliberately ignores a disk entry with no `exchange` key so the
    field fills in on the next request instead of only after the 24h TTL. That
    is a real, load-bearing branch with no test — so when the shape changed, the
    only signal was an unrelated-looking `YF.assert_not_called()` failure."""
    ticker_meta._mem.clear()
    pre_exchange = {"name": "From Disk", "sector": "Tech", "industry": "Semis"}
    with patch.object(ticker_meta, "_disk_get", return_value=pre_exchange), \
         patch.object(ticker_meta, "_disk_put"), \
         patch.object(ticker_meta, "_primary_theme", return_value=None), \
         patch.object(ticker_meta, "_from_fmp", return_value=dict(_FMP_EMPTY)), \
         patch("yfinance.Ticker") as YF:
        YF.return_value.info = _yf_info(longName="From yfinance", exchange="NYQ")
        out = ticker_meta.get_ticker_meta("NVDA")

    YF.assert_called()                      # the stale entry did NOT short-circuit
    assert out["name"] == "From yfinance"
    assert out["exchange"] == "NYSE"        # …and the new field is now populated


def test_yfinance_without_an_exchange_still_runs_the_FMP_leg_to_fill_it():
    """The other half of the same 3ca0f574a change: the FMP leg now runs when
    the NAME is present but the EXCHANGE is missing, because yfinance serves
    ugly codes (or nothing) and FMP has the friendly name. yfinance's own value
    still wins where it has one — FMP mislabels some ETFs."""
    ticker_meta._mem.clear()
    with patch.object(ticker_meta, "_disk_get", return_value=None), \
         patch.object(ticker_meta, "_disk_put"), \
         patch.object(ticker_meta, "_primary_theme", return_value=None), \
         patch.object(ticker_meta, "_from_fmp",
                      return_value={**_FMP_EMPTY, "exchange": "NYSE Arca"}) as FMP, \
         patch("yfinance.Ticker") as YF:
        YF.return_value.info = _yf_info(longName="SPDR S&P 500 ETF Trust", exchange=None)
        out = ticker_meta.get_ticker_meta("SPY")

    FMP.assert_called_once()
    assert out["name"] == "SPDR S&P 500 ETF Trust"     # yfinance kept the name
    assert out["exchange"] == "NYSE Arca"              # FMP filled only the gap


def test_yfinances_exchange_WINS_over_FMPs_when_both_answer():
    """The real SPY case the source comment cites and nothing guarded: FMP
    mislabels some ETFs ("AMEX") where yfinance's mapped code is right ("NYSE
    Arca"). yfinance is missing only the NAME here, so both legs run and both
    have an opinion about the exchange — the merge must prefer yfinance's."""
    ticker_meta._mem.clear()
    with patch.object(ticker_meta, "_disk_get", return_value=None), \
         patch.object(ticker_meta, "_disk_put"), \
         patch.object(ticker_meta, "_primary_theme", return_value=None), \
         patch.object(ticker_meta, "_from_fmp",
                      return_value={**_FMP_EMPTY, "name": "SPDR S&P 500 ETF Trust",
                                    "exchange": "AMEX"}), \
         patch.object(ticker_meta, "fh_get", return_value=None), \
         patch("yfinance.Ticker") as YF:
        YF.return_value.info = {"exchange": "PCX"}      # no name at all
        out = ticker_meta.get_ticker_meta("SPY")

    assert out["name"] == "SPDR S&P 500 ETF Trust"      # FMP filled the gap
    assert out["exchange"] == "NYSE Arca"               # …but did NOT overwrite


def test_yfinance_empty_info_falls_back_to_finnhub():
    """yfinance returns silent empty .info (ETF/delisted) → Finnhub fallback used
    (FMP neutralized so this specifically exercises the Finnhub leg)."""
    ticker_meta._mem.clear()
    with patch.object(ticker_meta, "_disk_get", return_value=None), \
         patch.object(ticker_meta, "_disk_put"), \
         patch.object(ticker_meta, "_primary_theme", return_value=None), \
         patch.object(ticker_meta, "_from_fmp", return_value=dict(_FMP_EMPTY)), \
         patch("yfinance.Ticker") as YF, \
         patch.object(ticker_meta, "fh_get",
                      return_value={"name": "SPDR S&P 500 ETF", "finnhubIndustry": "ETF"}):
        YF.return_value.info = {}
        out = ticker_meta.get_ticker_meta("SPY")
    assert out == {"name": "SPDR S&P 500 ETF", "sector": None, "industry": "ETF",
                   "exchange": None, "theme": None}


def test_partial_yfinance_missing_name_backfills_name_from_finnhub():
    """THE BUG: yfinance returns a PARTIAL .info — GICS sector/industry present but
    no longName/shortName. The old `not any(data.values())` gate skipped the
    Finnhub fallback (sector/industry made it truthy), caching name=None. Now the
    fallback fires whenever the NAME is missing, and merges field-by-field so
    yfinance's accurate GICS sector/industry are KEPT and only the name is filled
    from Finnhub (whose coarser 'Technology' industry must NOT overwrite 'Semiconductors').
    FMP is neutralized so this test still isolates the Finnhub leg specifically."""
    ticker_meta._mem.clear()
    with patch.object(ticker_meta, "_disk_get", return_value=None), \
         patch.object(ticker_meta, "_disk_put") as DP, \
         patch.object(ticker_meta, "_primary_theme", return_value=None), \
         patch.object(ticker_meta, "_from_fmp", return_value=dict(_FMP_EMPTY)), \
         patch("yfinance.Ticker") as YF, \
         patch.object(ticker_meta, "fh_get",
                      return_value={"name": "Micron Technology Inc", "finnhubIndustry": "Technology"}):
        # yfinance: sector/industry but NO name (the flaky partial payload)
        YF.return_value.info = {"sector": "Technology", "industry": "Semiconductors"}
        out = ticker_meta.get_ticker_meta("MU")
    assert out == {"name": "Micron Technology Inc", "sector": "Technology",
                   "industry": "Semiconductors", "exchange": None, "theme": None}
    # Cached WITH the name now (not the poisoned name=None), GICS industry preserved.
    DP.assert_called_once_with("MU", {"name": "Micron Technology Inc", "sector": "Technology",
                                      "industry": "Semiconductors", "exchange": None})


# ── FMP `stable/profile` migration (2026-08-05, plan Task 8) ─────────────────
# FMP is now tried BEFORE Finnhub whenever yfinance leaves the name blank.


def _fmp_row(companyName="Apple Inc.", sector="Technology",
             industry="Consumer Electronics", marketCap=4567767716000):
    row = {}
    if companyName is not None:
        row["companyName"] = companyName
    if sector is not None:
        row["sector"] = sector
    if industry is not None:
        row["industry"] = industry
    if marketCap is not None:
        row["marketCap"] = marketCap
    return row


def test_fmp_is_tried_before_finnhub_and_finnhub_skipped_on_fmp_hit():
    """FMP is the new PRIMARY leg: when yfinance fails and FMP fully resolves
    the name, Finnhub must never even be called."""
    ticker_meta._mem.clear()
    with patch.object(ticker_meta, "_disk_get", return_value=None), \
         patch.object(ticker_meta, "_disk_put"), \
         patch.object(ticker_meta, "_primary_theme", return_value=None), \
         patch("yfinance.Ticker", side_effect=Exception("yf down")), \
         patch("api.services.earnings_estimates._fmp_get",
               return_value=[_fmp_row()]) as FMP, \
         patch.object(ticker_meta, "fh_get") as FH:
        out = ticker_meta.get_ticker_meta("AAPL")
    assert out == {"name": "Apple Inc.", "sector": "Technology",
                   "industry": "Consumer Electronics", "exchange": None, "theme": None}
    FMP.assert_called_once()
    assert FMP.call_args[0][0] == "/stable/profile"
    assert FMP.call_args[0][1] == {"symbol": "AAPL"}
    FH.assert_not_called()  # Finnhub never reached — FMP already filled the name


def test_fmp_field_mapping_happy_path():
    """Direct unit test of the field-shape mapping table: companyName->name,
    sector/industry split correctly (Finnhub profile2 had no sector at all)."""
    with patch("api.services.earnings_estimates._fmp_get",
               return_value=[_fmp_row(companyName="Apple Inc.", sector="Technology",
                                       industry="Consumer Electronics")]):
        out = ticker_meta._from_fmp("AAPL")
    assert out["name"] == "Apple Inc."
    assert out["sector"] == "Technology"
    assert out["industry"] == "Consumer Electronics"


def test_fmp_market_cap_unit_conversion_asserts_magnitude():
    """THE known bug class (lesson_market_cap_cache_poison_and_finnhub_currency):
    FMP's marketCap is raw USD UNITS (4567767716000), NOT the millions Finnhub's
    marketCapitalization used. Assert the CONVERTED magnitude, not just presence —
    a bug that skips the /1e6 conversion (or divides by the wrong power) must
    fail this on the number, not silently pass on "field exists"."""
    with patch("api.services.earnings_estimates._fmp_get",
               return_value=[_fmp_row(marketCap=4567767716000)]):
        out = ticker_meta._from_fmp("AAPL")
    assert out["market_cap_musd"] == pytest.approx(4567767.716, rel=1e-9)
    # Sanity bound: a real megacap's market cap in MILLIONS is a 6-7 digit
    # number, not a 12-13 digit one (the un-converted raw-units bug) and not a
    # 3-4 digit number (an accidental extra /1000).
    assert 100_000 < out["market_cap_musd"] < 100_000_000


def test_fmp_none_fields_yield_none_not_fabricated():
    """Any field FMP doesn't supply renders None — never 0, never "", never a
    fabricated value (honest-degradation law)."""
    with patch("api.services.earnings_estimates._fmp_get",
               return_value=[_fmp_row(companyName=None, sector=None,
                                       industry=None, marketCap=None)]):
        out = ticker_meta._from_fmp("ZZZZ")
    assert out == {"name": None, "sector": None, "industry": None, "market_cap_musd": None}
    # Explicitly assert the Number(null)===0 trap does not apply here: a None
    # market cap must stay None, never coerce to the falsy-but-wrong 0.
    assert out["market_cap_musd"] is None
    assert out["market_cap_musd"] != 0


def test_fmp_missing_marketcap_key_entirely_yields_none():
    """A row that simply omits the marketCap key (not just null) must also
    yield None, not raise a KeyError or coerce to 0."""
    with patch("api.services.earnings_estimates._fmp_get",
               return_value=[{"companyName": "No Cap Co"}]):
        out = ticker_meta._from_fmp("NOCAP")
    assert out["name"] == "No Cap Co"
    assert out["market_cap_musd"] is None


def test_fmp_no_api_key_short_circuits_without_network_call():
    """When FMP_API_KEY is unset, `_fmp_get` returns None WITHOUT ever calling
    requests.get — `_from_fmp` must degrade to all-None cleanly (never raise)."""
    import os
    from unittest.mock import patch as _patch
    with _patch.dict(os.environ, {}, clear=False):
        os.environ.pop("FMP_API_KEY", None)
        with patch("requests.get", side_effect=AssertionError("should not fire")):
            out = ticker_meta._from_fmp("AAPL")
    assert out == {"name": None, "sector": None, "industry": None, "market_cap_musd": None}


def test_fmp_partial_then_finnhub_fills_remainder():
    """Full 3-leg interaction: yfinance fails entirely, FMP supplies industry
    but no name (a partial FMP response), Finnhub then fills the name. Proves
    the merge chain composes correctly end-to-end, matching the yfinance/
    Finnhub partial-merge behavior already covered above."""
    ticker_meta._mem.clear()
    with patch.object(ticker_meta, "_disk_get", return_value=None), \
         patch.object(ticker_meta, "_disk_put") as DP, \
         patch.object(ticker_meta, "_primary_theme", return_value=None), \
         patch("yfinance.Ticker", side_effect=Exception("yf down")), \
         patch("api.services.earnings_estimates._fmp_get",
               return_value=[_fmp_row(companyName=None, sector="Technology",
                                       industry="Semiconductors")]), \
         patch.object(ticker_meta, "fh_get",
                      return_value={"name": "Micron Technology Inc", "finnhubIndustry": "Technology"}):
        out = ticker_meta.get_ticker_meta("MU")
    assert out == {"name": "Micron Technology Inc", "sector": "Technology",
                   "industry": "Semiconductors", "exchange": None, "theme": None}
    DP.assert_called_once_with(
        "MU", {"name": "Micron Technology Inc", "sector": "Technology",
               "industry": "Semiconductors", "exchange": None})


def test_primary_theme_attached_to_result():
    ticker_meta._mem.clear()
    ticker_meta._mem.set("tmeta_SEDG", {"name": "SolarEdge Technologies, Inc.", "sector": "Technology", "industry": "Solar"}, ttl=999)
    with patch.object(ticker_meta, "_primary_theme", return_value="Solar"):
        out = ticker_meta.get_ticker_meta("SEDG")
    assert out == {"name": "SolarEdge Technologies, Inc.", "sector": "Technology", "industry": "Solar", "theme": "Solar"}


def test_primary_theme_prefers_core_then_relevant_then_peripheral():
    rows = [
        {"theme_name": "Peripheral One", "tier": "peripheral", "theme_id": "a"},
        {"theme_name": "Core One", "tier": "core", "theme_id": "z"},
        {"theme_name": "Relevant One", "tier": "relevant", "theme_id": "b"},
    ]
    with patch("api.services.theme_db.get_themes_for_ticker", return_value=rows):
        assert ticker_meta._primary_theme("AAPL") == "Core One"


def test_primary_theme_none_when_no_membership_or_error():
    with patch("api.services.theme_db.get_themes_for_ticker", return_value=[]):
        assert ticker_meta._primary_theme("ZZZZ") is None
    with patch("api.services.theme_db.get_themes_for_ticker", side_effect=Exception("db down")):
        assert ticker_meta._primary_theme("AAPL") is None
    assert ticker_meta._primary_theme("") is None
