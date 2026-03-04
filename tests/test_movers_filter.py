import pytest
import csv
import io
from unittest.mock import patch, MagicMock


# ── Helpers ────────────────────────────────────────────────────────────────────

def _make_csv(*rows):
    """Build a minimal Finviz-style CSV string with Ticker, Company, and Change columns."""
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=["Ticker", "Company", "Change", "Price", "Volume"])
    writer.writeheader()
    for item in rows:
        if len(item) == 3:
            sym, chg, company = item
        else:
            sym, chg = item
            company = sym  # default company = ticker (no leveraged ETF keywords)
        writer.writerow({"Ticker": sym, "Company": company, "Change": f"{chg:.2f}%",
                         "Price": "50.00", "Volume": "500000"})
    return buf.getvalue()


def _mock_urlopen_factory(gainers_csv: str, losers_csv: str):
    """Return a context-manager mock for urllib.request.urlopen."""
    import contextlib

    call_count = {"n": 0}

    @contextlib.contextmanager
    def _mock_urlopen(req, timeout=15):
        text = gainers_csv if call_count["n"] == 0 else losers_csv
        call_count["n"] += 1
        mock_resp = MagicMock()
        mock_resp.read.return_value = text.encode("utf-8")
        yield mock_resp

    return _mock_urlopen


# ── _fetch_finviz_movers_live ──────────────────────────────────────────────────

def test_finviz_movers_parses_gainers_and_losers():
    """Basic CSV parse: returns correct sym/pct for qualifying movers."""
    from api.services.massive import _fetch_finviz_movers_live

    gainers = _make_csv(("COIN", 15.63), ("ASTS", 14.80), ("WIX", 2.50))  # WIX < 3%
    losers  = _make_csv(("CHWY", -5.63), ("EVGO", -6.53), ("LOW", -1.00))  # LOW < 3%

    with patch("api.services.massive.os.environ.get", return_value="fake_token"), \
         patch("api.services.massive._is_leveraged_etf", return_value=False), \
         patch("api.services.massive.urllib.request.urlopen", side_effect=_mock_urlopen_factory(gainers, losers)):
        ripping, drilling = _fetch_finviz_movers_live()

    rip_syms = [r["sym"] for r in ripping]
    drl_syms = [r["sym"] for r in drilling]

    assert "COIN" in rip_syms
    assert "ASTS" in rip_syms
    assert "WIX"  not in rip_syms   # 2.5% < 3% threshold

    assert "CHWY" in drl_syms
    assert "EVGO" in drl_syms
    assert "LOW"  not in drl_syms   # -1% > -3% threshold


def test_finviz_movers_excludes_leveraged_etfs():
    """Leveraged ETFs are filtered by company name keyword check."""
    from api.services.massive import _fetch_finviz_movers_live

    # Company name contains "3x leveraged" — should be excluded
    gainers = _make_csv(("SOXL", 18.0, "Direxion Daily Semiconductors 3x Leveraged ETF"),
                        ("NVDA", 5.0,  "NVIDIA Corp"))
    losers  = _make_csv()

    with patch("api.services.massive.os.environ.get", return_value="fake_token"), \
         patch("api.services.massive.urllib.request.urlopen", side_effect=_mock_urlopen_factory(gainers, losers)):
        ripping, drilling = _fetch_finviz_movers_live()

    rip_syms = [r["sym"] for r in ripping]
    assert "SOXL" not in rip_syms
    assert "NVDA" in rip_syms


def test_finviz_movers_returns_empty_without_token():
    """Returns ([], []) immediately when FINVIZ_API_KEY is not set."""
    from api.services.massive import _fetch_finviz_movers_live

    with patch("api.services.massive.os.environ.get", return_value=""):
        ripping, drilling = _fetch_finviz_movers_live()

    assert ripping  == []
    assert drilling == []


def test_finviz_movers_caps_at_12():
    """Never returns more than 12 items per side."""
    from api.services.massive import _fetch_finviz_movers_live

    gainers = _make_csv(*[(f"G{i}", 15.0) for i in range(20)])
    losers  = _make_csv(*[(f"L{i}", -15.0) for i in range(20)])

    with patch("api.services.massive.os.environ.get", return_value="fake_token"), \
         patch("api.services.massive._is_leveraged_etf", return_value=False), \
         patch("api.services.massive.urllib.request.urlopen", side_effect=_mock_urlopen_factory(gainers, losers)):
        ripping, drilling = _fetch_finviz_movers_live()

    assert len(ripping)  <= 12
    assert len(drilling) <= 12


# ── get_movers integration ─────────────────────────────────────────────────────

def test_gap_filter_excludes_sub_3pct():
    """Stocks moving less than 3% are excluded from both sides."""
    from api.services.massive import get_movers
    from api.services.cache import cache
    cache.invalidate("movers")

    # Must be sorted descending (gainers) / ascending (losers) — Finviz sort order
    gainers = _make_csv(("NVDA", 5.2), ("TSLA", 3.0), ("AAPL", 1.5))
    losers  = _make_csv(("GOOG", -4.1), ("META", -3.5), ("AMZN", -2.9))

    with patch("api.services.massive.os.environ.get", return_value="fake_token"), \
         patch("api.services.massive._is_leveraged_etf", return_value=False), \
         patch("api.services.massive.urllib.request.urlopen", side_effect=_mock_urlopen_factory(gainers, losers)):
        result = get_movers()

    rip = [r["sym"] for r in result["ripping"]]
    drl = [r["sym"] for r in result["drilling"]]

    assert "NVDA" in rip and "TSLA" in rip
    assert "AAPL" not in rip

    assert "GOOG" in drl and "META" in drl
    assert "AMZN" not in drl


def test_gap_filter_empty_when_nothing_qualifies():
    """Returns empty lists when no stock meets the 3% threshold."""
    from api.services.massive import get_movers
    from api.services.cache import cache
    cache.invalidate("movers")

    gainers = _make_csv(("AAPL", 0.5), ("MSFT", 1.2))
    losers  = _make_csv(("GOOG", -0.3), ("META", -2.9))

    with patch("api.services.massive.os.environ.get", return_value="fake_token"), \
         patch("api.services.massive._is_leveraged_etf", return_value=False), \
         patch("api.services.massive.urllib.request.urlopen", side_effect=_mock_urlopen_factory(gainers, losers)):
        result = get_movers()

    assert result["ripping"]  == []
    assert result["drilling"] == []


def test_engine_movers_listed_first():
    """Engine movers (wire_data) appear before Finviz supplement movers."""
    from api.services.massive import get_movers
    from api.services.cache import cache
    cache.invalidate("movers")
    cache.set("wire_data", {
        "movers": {
            "rippers": [{"sym": "ENGINE_TOP", "pct": "+20.00%"}],
            "drillers": [],
        }
    }, ttl=300)

    gainers = _make_csv(("FINVIZ_STOCK", 8.0))
    losers  = _make_csv()

    try:
        with patch("api.services.massive.os.environ.get", return_value="fake_token"), \
             patch("api.services.massive._is_leveraged_etf", return_value=False), \
             patch("api.services.massive.urllib.request.urlopen", side_effect=_mock_urlopen_factory(gainers, losers)):
            result = get_movers()

        rip = [r["sym"] for r in result["ripping"]]
        assert rip[0] == "ENGINE_TOP"
        assert "FINVIZ_STOCK" in rip
    finally:
        cache.invalidate("wire_data")
        cache.invalidate("movers")
