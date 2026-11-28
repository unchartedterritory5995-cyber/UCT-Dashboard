"""Licensed-first pass 2 (2026-11-28): licensed sources before Yahoo / Finnhub.

Unit 1, ticker metadata: FMP profile + Massive ticker details before Yahoo in
`ticker_meta`, `industry_map`'s straggler fallback, the catalyst metadata, the
leveraged-ETF test and the news cap gate; the wording map that keeps every
consumer's matches; the disk-cache version.

No network: FMP, Massive and Yahoo are stood in at each module's seams.
conftest's `_licensed_first_pass2_off` turns the licensed reads off for every
other test; the `on` fixture here turns them back on.
"""
from __future__ import annotations

import json
import os
import time
import types
from unittest.mock import patch

import pytest

import api.services.licensed_reference as lr


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setattr(lr, "first", lambda: True)
    lr._DETAILS.clear()
    yield
    lr._DETAILS.clear()


def massive_says(monkeypatch, details: dict | None):
    calls = []

    def _gtd(sym):
        calls.append(sym)
        return dict(details or {})
    from api.services import massive
    monkeypatch.setattr(massive, "get_ticker_details", _gtd)
    return calls


# ── the wording map ───────────────────────────────────────────────────────────

# Every word a consumer matches on today, and the FMP word that names the same group.
@pytest.mark.parametrize("fmp, yahoo", [
    ("Medical - Devices", "Medical Devices"),
    ("Auto - Manufacturers", "Auto Manufacturers"),
    ("Financial - Capital Markets", "Capital Markets"),
    ("Oil & Gas Exploration & Production", "Oil & Gas E&P"),
    ("Regulated Electric", "Utilities - Regulated Electric"),
    ("Asset Management - Income", "Asset Management"),
    # already Yahoo's word: unchanged
    ("Semiconductors", "Semiconductors"),
    ("Software - Infrastructure", "Software - Infrastructure"),
    ("Banks - Regional", "Banks - Regional"),
    # Yahoo's older em-dash spelling reads as the spaced hyphen
    ("Banks—Regional", "Banks - Regional"),
])
def test_an_fmp_industry_reads_in_yahoos_word(fmp, yahoo):
    assert lr.normalize_industry(fmp) == yahoo


def test_an_industry_with_no_one_yahoo_twin_passes_through_unguessed():
    assert lr.normalize_industry("Hardware, Equipment & Parts") == "Hardware, Equipment & Parts"
    assert lr.normalize_industry("") is None and lr.normalize_industry(None) is None


@pytest.mark.parametrize("raw, word", [
    ("Information Technology", "Technology"), ("Health Care", "Healthcare"),
    ("Financial", "Financial Services"), ("Consumer Discretionary", "Consumer Cyclical"),
    ("Consumer Staples", "Consumer Defensive"), ("Materials", "Basic Materials"),
    ("Technology", "Technology"), ("Financial Services", "Financial Services"),
])
def test_a_sector_reads_in_the_eleven_words(raw, word):
    assert lr.normalize_sector(raw) == word
    assert lr.normalize_sector(raw) in lr.SECTORS


def test_every_mapped_word_still_matches_the_consumers_that_matched_before():
    """The catalyst bank rule matches 'bank'; the earnings-preview fund test matches
    'asset manage'; a regional bank and an asset manager keep matching after the map."""
    from api.services import earnings_preview_warm as epw
    assert "bank" in lr.normalize_industry("Banks - Regional").lower()
    assert epw._FUND_SOFT_INDUSTRY.search(lr.normalize_industry("Asset Management - Bonds"))
    # no mapped word invents a fund or a bank the source did not say
    for fmp, yahoo in lr.FMP_INDUSTRY_TO_YAHOO.items():
        assert ("bank" in fmp.lower()) == ("bank" in yahoo.lower()), fmp
        assert bool(epw._FUND_INDUSTRY.search(fmp)) == bool(epw._FUND_INDUSTRY.search(yahoo)), fmp


@pytest.mark.parametrize("mic, name", [
    ("XNAS", "NASDAQ"), ("XNGS", "NASDAQ"), ("XNYS", "NYSE"), ("ARCX", "NYSE Arca"),
    ("XASE", "NYSE American"), ("BATS", "Cboe BZX"), ("ZZZZ", None), (None, None),
])
def test_a_massive_mic_reads_as_the_exchange_our_store_has_always_held(mic, name):
    assert lr.exchange_from_mic(mic) == name


def test_the_mic_names_are_the_yahoo_map_names():
    """The chart's tick-size and listing rows are keyed on these strings: Massive must
    produce exactly the names Yahoo's codes produced, never a new spelling."""
    from api.services import ticker_meta
    assert set(lr.MIC_TO_EXCHANGE.values()) <= set(ticker_meta._YF_EXCHANGE.values())


def test_the_seam_is_off_for_every_other_test():
    assert lr.first() is False


# ── Massive details: read once a day ──────────────────────────────────────────

def test_massive_details_are_held_for_the_day(on, monkeypatch):
    calls = massive_says(monkeypatch, {"name": "Apple Inc.", "primary_exchange": "XNAS", "type": "CS"})
    assert lr.massive_reference("aapl")["exchange"] == "NASDAQ"
    assert lr.massive_reference("AAPL")["type"] == "CS"
    assert calls == ["AAPL"]


def test_an_empty_massive_answer_is_asked_again_soon_not_tomorrow(on, monkeypatch):
    calls = massive_says(monkeypatch, {})
    lr.massive_details("ZZZQ")
    exp, _ = lr._DETAILS["ZZZQ"]
    assert exp - time.time() <= lr._FAIL_TTL_S + 1
    assert calls == ["ZZZQ"]


def test_massive_avg_volume_leaves_out_the_forming_session(on, monkeypatch):
    from datetime import date, timedelta
    import api.services.earnings_reaction as er
    today = date.today()
    bars = [{"t": (today - timedelta(days=i)).isoformat(), "v": 100.0 * i, "c": 10.0 + i}
            for i in range(12, 0, -1)] + [{"t": today.isoformat(), "v": 9e9, "c": 1.0}]
    monkeypatch.setattr(er, "massive_daily_bars", lambda sym, since, to=None: bars)
    out = lr.massive_avg_volume("FOO", 10)
    assert out["avg_volume"] == sum(100.0 * i for i in range(1, 11)) / 10
    assert out["last_close"] == 11.0
    assert out["as_of"] == (today - timedelta(days=1)).isoformat()
    assert lr.massive_avg_volume("FOO", 50) is None          # too few sessions: no number


# ── ticker_meta ───────────────────────────────────────────────────────────────

FMP_ROW = {"companyName": "Intuitive Surgical, Inc.", "sector": "Healthcare",
           "industry": "Medical - Instruments & Supplies", "exchange": "NASDAQ"}


def _fmp_profile(body):
    from api.services import fmp_client

    def _answer(ticker, *, timeout=None):
        if body is None:
            raise fmp_client._ERR.transient("FMP unavailable (test)")
        if body == []:
            raise fmp_client._ERR.not_found("no data (test)")
        return types.SimpleNamespace(value=body, degraded=None)
    return patch.object(fmp_client, "get_company_profile", side_effect=_answer)


@pytest.fixture
def tm(tmp_path, monkeypatch):
    from api.services import ticker_meta
    monkeypatch.setattr(ticker_meta, "_CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(ticker_meta, "_primary_theme", lambda t: None)
    ticker_meta._mem.clear()
    yield ticker_meta
    ticker_meta._mem.clear()


def test_licensed_reads_answer_and_yahoo_is_never_asked(on, tm, monkeypatch):
    massive_says(monkeypatch, {"name": "Intuitive Surgical Inc. Common Stock", "primary_exchange": "XNGS",
                               "type": "CS"})
    with _fmp_profile([FMP_ROW]), patch("yfinance.Ticker") as YF, \
            patch.object(tm, "fh_get") as FH:
        out = tm.get_ticker_meta("ISRG")
    YF.assert_not_called()
    FH.assert_not_called()
    assert out["name"] == "Intuitive Surgical, Inc."            # FMP's name before Massive's
    assert out["sector"] == "Healthcare"
    assert out["industry"] == "Medical Instruments & Supplies"   # in Yahoo's word
    assert out["exchange"] == "NASDAQ"                           # Massive's MIC, our spelling
    row = json.load(open(os.path.join(tm._CACHE_DIR, "ISRG.json"), encoding="utf-8"))
    assert row["_v"] == tm._DISK_VERSION
    assert row["_src"] == {"name": "fmp", "sector": "fmp", "industry": "fmp", "exchange": "massive"}


def test_spy_keeps_nyse_arca_not_fmps_amex(on, tm, monkeypatch):
    massive_says(monkeypatch, {"name": "SPDR S&P 500 ETF Trust", "primary_exchange": "ARCX", "type": "ETF"})
    with _fmp_profile([{"companyName": "SPDR S&P 500 ETF Trust", "sector": "Financial Services",
                        "industry": "Asset Management", "exchange": "AMEX"}]), \
            patch("yfinance.Ticker") as YF:
        out = tm.get_ticker_meta("SPY")
    YF.assert_not_called()
    assert out["exchange"] == "NYSE Arca"


def test_yahoo_fills_only_the_field_the_licensed_reads_left_empty(on, tm, monkeypatch):
    massive_says(monkeypatch, {})                                  # no exchange from Massive
    with _fmp_profile([FMP_ROW]), patch("yfinance.Ticker") as YF:
        YF.return_value.info = {"longName": "Yahoo Name", "sector": "Yahoo Sector",
                                "industry": "Yahoo Industry", "exchange": "NMS"}
        out = tm.get_ticker_meta("ISRG")
    YF.assert_called()
    assert out["name"] == "Intuitive Surgical, Inc."               # licensed kept
    assert out["industry"] == "Medical Instruments & Supplies"
    assert out["exchange"] == "NASDAQ"                             # Yahoo filled the one gap
    row = json.load(open(os.path.join(tm._CACHE_DIR, "ISRG.json"), encoding="utf-8"))
    assert row["_src"]["exchange"] == "yahoo" and row["_src"]["name"] == "fmp"


def test_the_fmp_profile_is_read_once_per_build(on, tm, monkeypatch):
    massive_says(monkeypatch, {})
    with _fmp_profile([FMP_ROW]) as FMP, patch("yfinance.Ticker") as YF:
        YF.return_value.info = {}
        out = tm.get_ticker_meta("ISRG")
    assert FMP.call_count == 1
    assert out["exchange"] == "NASDAQ"                             # FMP's exchange, last


def test_a_row_written_before_this_pass_is_not_served(on, tm, monkeypatch):
    with open(os.path.join(tm._CACHE_DIR, "OLDY.json"), "w", encoding="utf-8") as fh:
        json.dump({"name": "Old Yahoo", "sector": "X", "industry": "Y", "exchange": "NYSE"}, fh)
    assert tm._disk_get("OLDY") is None
    assert tm.peek_ticker_meta("OLDY") is None
    tm._disk_put("NEWY", {"name": "N", "sector": None, "industry": None, "exchange": None}, {"name": "fmp"})
    assert tm._disk_get("NEWY") == {"name": "N", "sector": None, "industry": None, "exchange": None}


# ── industry_map straggler fallback ───────────────────────────────────────────

def test_industry_map_asks_fmp_before_yahoo(on, monkeypatch):
    from api.services import industry_map as im
    monkeypatch.setattr(im, "_fmp_profile_row", lambda t: {"sector": "Healthcare",
                                                           "industry": "Medical - Devices"})
    with patch("yfinance.Ticker") as YF:
        assert im._fetch_fallback("ZZQ") == ("Healthcare", "Medical Devices", "fmp")
    YF.assert_not_called()


def test_industry_map_falls_to_yahoo_when_fmp_has_no_industry(on, monkeypatch):
    from api.services import industry_map as im
    asked = []
    monkeypatch.setattr(im, "_fmp_profile_row", lambda t: asked.append(t) or {"sector": "Healthcare"})
    with patch("yfinance.Ticker") as YF:
        YF.return_value.info = {"sector": "Healthcare", "industry": "Biotechnology"}
        assert im._fetch_fallback("ZZQ") == ("Healthcare", "Biotechnology", "yfinance")
    assert asked == ["ZZQ"]                                         # FMP not asked a second time


# ── catalyst metadata ─────────────────────────────────────────────────────────

@pytest.fixture
def cat(tmp_path, monkeypatch):
    from api.services.catalyst import ticker_metadata as ctm
    monkeypatch.setattr(ctm, "_DB_PATH", str(tmp_path / "cm.db"))
    monkeypatch.setattr(ctm, "_INIT_DONE", False)
    monkeypatch.setattr(ctm, "_ASKED", {})
    monkeypatch.setattr(ctm, "_ASK_LOCKS", {})
    facts = {"name": "Foo", "is_etf": False, "is_fund": False, "market_cap": 5e9, "price": 42.0,
             "avg_volume": 9e6, "year_high": 120.0, "sector": "Financial Services",
             "industry": "Banks - Regional"}
    state = types.SimpleNamespace(facts=facts, counts={"float_shares": 44, "shares_outstanding": 55},
                                  yahoo_calls=[])
    monkeypatch.setattr(ctm, "profile_facts", lambda t: dict(state.facts) if state.facts else None)
    monkeypatch.setattr(ctm, "share_counts", lambda t: dict(state.counts))

    def _yf(t):
        state.yahoo_calls.append(t)
        return {"sector": "Y-Sector", "industry": "Y-Industry", "market_cap": 1.0, "avg_volume_30d": 7,
                "fifty_two_week_high": 1.0, "quote_type": "ETF", "float_shares": 1,
                "shares_outstanding": 2}
    monkeypatch.setattr(ctm, "_fetch_via_yfinance", _yf)
    monkeypatch.setattr(lr, "massive_avg_volume", lambda t, n, **k: {"avg_volume": 1_234_567.9,
                                                                    "last_close": 40.0})
    state.ctm = ctm
    return state


def test_catalyst_metadata_from_licensed_reads_without_yahoo(on, cat, monkeypatch):
    massive_says(monkeypatch, {"type": "CS", "name": "Foo Corp"})
    out = cat.ctm._fetch_fresh("FOO")
    assert cat.yahoo_calls == []
    assert out == {"sector": "Financial Services", "industry": "Banks - Regional", "market_cap": 5e9,
                   "avg_volume_30d": 1_234_567, "fifty_two_week_high": 120.0, "quote_type": "EQUITY",
                   "float_shares": 44, "shares_outstanding": 55}


def test_a_company_the_profile_says_but_massive_does_not_confirm_asks_yahoo(on, cat, monkeypatch):
    massive_says(monkeypatch, {})                                   # Massive cannot say
    out = cat.ctm._fetch_fresh("FOO")
    assert cat.yahoo_calls == ["FOO"]
    assert out["quote_type"] == "ETF"                               # the gate is never looser
    assert out["sector"] == "Financial Services"                    # licensed kept


def test_massive_saying_fund_settles_it(on, cat, monkeypatch):
    massive_says(monkeypatch, {"type": "ETF"})
    out = cat.ctm._fetch_fresh("FOO")
    assert out["quote_type"] == "ETF"


def test_with_the_seam_off_the_old_yahoo_path_runs(cat, monkeypatch):
    out = cat.ctm._fetch_fresh("FOO")
    assert cat.yahoo_calls == ["FOO"]
    assert out["sector"] == "Y-Sector"


# ── leveraged-ETF test + news cap gate ────────────────────────────────────────

def test_a_massive_name_with_a_keyword_settles_leveraged(on, monkeypatch):
    from api.services import massive
    from api.services.cache import cache
    cache.delete("is_lev_ZLEV") if hasattr(cache, "delete") else None
    monkeypatch.setattr(massive, "_lev_by_profile_name", lambda t: None)
    massive_says(monkeypatch, {"name": "Direxion Daily Semiconductor Bull 3X Shares", "type": "ETF"})
    with patch("yfinance.Ticker") as YF:
        assert massive._is_leveraged_etf("ZLEV") is True
    YF.assert_not_called()


def test_a_fund_whose_massive_name_does_not_say_still_reads_yahoo(on, monkeypatch):
    from api.services import massive
    monkeypatch.setattr(massive, "_lev_by_profile_name", lambda t: None)
    massive_says(monkeypatch, {"name": "Some Equity Fund", "type": "ETF"})
    assert massive._lev_by_massive_name("ZFND") is None
    massive_says(monkeypatch, {"name": "Plain Company Inc.", "type": "CS"})
    lr._DETAILS.clear()
    assert massive._lev_by_massive_name("ZCO") is False


def test_news_cap_gate_from_massive(on, monkeypatch):
    from api.services import engine
    engine._SYM_CAP_MASSIVE.clear()
    monkeypatch.setattr(engine, "_sym_cap_from_profile", lambda s: None)
    massive_says(monkeypatch, {"type": "CS", "market_cap": 2e9})
    monkeypatch.setattr(lr, "massive_avg_volume", lambda t, n, **k: {"avg_volume": 200_000.0,
                                                                    "last_close": 30.0})
    with patch("yfinance.Ticker") as YF:
        assert engine._check_sym_cap("ZCAP") == ("ZCAP", True)       # $6M a day, $2B cap
    YF.assert_not_called()
    engine._SYM_CAP_MASSIVE.clear()
    monkeypatch.setattr(lr, "massive_avg_volume", lambda t, n, **k: {"avg_volume": 100_000.0,
                                                                    "last_close": 30.0})
    assert engine._sym_cap_from_massive("ZCAP") is False             # $3M a day: blocked
    engine._SYM_CAP_MASSIVE.clear()
    lr._DETAILS.clear()
    massive_says(monkeypatch, {"type": "ETF", "market_cap": 2e9})
    assert engine._sym_cap_from_massive("ZETF") is False
    engine._SYM_CAP_MASSIVE.clear()
    lr._DETAILS.clear()
    massive_says(monkeypatch, {"type": "CS"})                         # no cap: Yahoo decides
    assert engine._sym_cap_from_massive("ZNOC") is None


# ── Unit 4: logos ─────────────────────────────────────────────────────────────

def _png(w=64, h=64):
    import io
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGBA", (w, h), (10, 20, 30, 255)).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def logos(monkeypatch):
    from api.services import massive, ticker_logos as tl
    monkeypatch.setattr(massive, "_get_client", lambda: types.SimpleNamespace(_api_key="k-test"))
    got = []

    def _url(url):
        got.append(url)
        return got_answers.get(url.split("?")[0])
    got_answers = {}
    monkeypatch.setattr(tl, "_url_bytes", _url)
    return types.SimpleNamespace(tl=tl, got=got, answers=got_answers)


def test_massive_branding_is_the_first_logo_source(on, logos, monkeypatch):
    massive_says(monkeypatch, {"branding": {
        "icon_url": "https://api.massive.com/v1/reference/company-branding/x/images/icon.png"}})
    logos.answers["https://api.massive.com/v1/reference/company-branding/x/images/icon.png"] = _png()
    with patch.object(logos.tl, "_logodev_logo_bytes") as LD, \
            patch.object(logos.tl, "_finnhub_logo_bytes") as FH:
        raw, source = logos.tl._fetch_sources("AAPL")
    assert source == "massive" and raw
    LD.assert_not_called()
    FH.assert_not_called()
    assert logos.got == ["https://api.massive.com/v1/reference/company-branding/x/images/icon.png?apiKey=k-test"]


def test_a_massive_svg_that_cannot_be_stored_does_not_end_the_chain(on, logos, monkeypatch):
    massive_says(monkeypatch, {"branding": {"logo_url": "https://api.massive.com/b/logo.svg"}})
    logos.answers["https://api.massive.com/b/logo.svg"] = b"<svg xmlns='http://www.w3.org/2000/svg'>" + b" " * 300
    with patch.object(logos.tl, "_logodev_logo_bytes", return_value=_png()) as LD:
        raw, source = logos.tl._fetch_sources("AAPL")
    assert source == "logodev"
    LD.assert_called_once()


def test_the_api_key_never_goes_to_another_host(on, logos, monkeypatch):
    massive_says(monkeypatch, {"branding": {"icon_url": "https://evil.example.com/icon.png"}})
    assert logos.tl._massive_logo_bytes("AAPL") is None
    assert logos.got == []


def test_with_the_seam_off_logo_dev_still_leads(logos, monkeypatch):
    calls = massive_says(monkeypatch, {"branding": {"icon_url": "https://api.massive.com/i.png"}})
    with patch.object(logos.tl, "_logodev_logo_bytes", return_value=_png()):
        raw, source = logos.tl._fetch_sources("AAPL")
    assert source == "logodev" and calls == []


def test_massive_is_in_the_miss_vocabulary_and_clearbit_is_not():
    from api.services import ticker_logos as tl
    assert "massive" in tl._SOURCE_NAMES and tl._SOURCE_NAMES[0] == "override"
    assert tl._CLEARBIT_SOURCE_NAME not in tl._SOURCE_NAMES


# ── Unit 2 (the part built): DES average volume from Massive before Finnhub ────

@pytest.fixture
def des(monkeypatch):
    from api.routers import fundamentals as fr
    st = types.SimpleNamespace(fh_calls=[], fh={"10DayAverageTradingVolume": 2.5, "52WeekHigh": 9.0,
                                                "52WeekLow": 1.0})
    monkeypatch.setattr(fr, "get_fundamentals", lambda s: {"name": "Foo", "market_cap": "$1.00B"})
    monkeypatch.setattr(fr, "_fmp_metrics_get", lambda s, legs=None: dict(st.fmp))
    st.fmp = {"yearHigh": 50.0, "yearLow": 10.0, "marketCap": 1e9}

    def _fh(s, legs=None):
        st.fh_calls.append(s)
        return dict(st.fh)
    monkeypatch.setattr(fr, "_fh_metric_get", _fh)
    monkeypatch.setattr(fr, "set_by_completeness", lambda *a, **k: None)
    st.fr = fr
    return st


def test_des_average_volume_is_massives_and_finnhub_is_not_asked(on, des, monkeypatch):
    monkeypatch.setattr(lr, "massive_avg_volume", lambda t, n, **k: {"avg_volume": 31_000_000.0})
    out = des.fr._build_snapshot("FOO")
    assert out["avg_vol"] == 31_000_000.0 and out["avg_vol_source"] == "massive"
    assert out["week52_high"] == 50.0
    assert des.fh_calls == []


def test_des_falls_back_to_finnhub_labelled_when_massive_has_no_bars(on, des, monkeypatch):
    monkeypatch.setattr(lr, "massive_avg_volume", lambda t, n, **k: None)
    out = des.fr._build_snapshot("FOO")
    assert out["avg_vol"] == 2_500_000.0 and out["avg_vol_source"] == "finnhub"
    assert des.fh_calls == ["FOO"]


def test_des_asks_finnhub_for_a_missing_52_week_range_even_with_massive_volume(on, des, monkeypatch):
    monkeypatch.setattr(lr, "massive_avg_volume", lambda t, n, **k: {"avg_volume": 5.0})
    des.fmp = {}
    out = des.fr._build_snapshot("FOO")
    assert des.fh_calls == ["FOO"]
    assert out["avg_vol_source"] == "massive" and out["week52_high"] == 9.0
    assert out["avg_vol"] == 5.0                     # Massive's number, not Finnhub's 2.5M


def test_des_asks_finnhub_when_only_the_52_week_high_is_missing(on, des, monkeypatch):
    monkeypatch.setattr(lr, "massive_avg_volume", lambda t, n, **k: {"avg_volume": 5.0})
    des.fmp = {"yearLow": 10.0, "marketCap": 1e9}
    out = des.fr._build_snapshot("FOO")
    assert des.fh_calls == ["FOO"] and out["week52_high"] == 9.0


def test_des_no_volume_anywhere_is_none_never_zero(on, des, monkeypatch):
    monkeypatch.setattr(lr, "massive_avg_volume", lambda t, n, **k: None)
    des.fh = {}
    out = des.fr._build_snapshot("FOO")
    assert out["avg_vol"] is None and out["avg_vol_source"] is None


# ── Unit 3: estimate revisions from our own FMP snapshots ─────────────────────

from datetime import date as _date, timedelta as _td

TODAY = _date(2026, 11, 27)


@pytest.fixture
def snaps(tmp_path, monkeypatch):
    from api.services import estimate_history as eh
    from api.services.research import estimates_consensus as ec
    monkeypatch.setenv("ESTIMATE_HISTORY_ENABLED", "1")
    monkeypatch.setenv("ESTIMATE_HISTORY_DB_PATH", str(tmp_path / "eh.db"))
    cons = {"state": "ok", "quarterly": [{"period_end": "2026-12-31", "label": "Q4 2026"},
                                         {"period_end": "2027-03-31", "label": "Q1 2027"}],
            "annual": []}
    st = types.SimpleNamespace(cons=cons, eh=eh)
    monkeypatch.setattr(ec, "get_consensus", lambda s, **k: st.cons)

    def put(sym, snap_date, period_end, eps):
        eh.snapshot_symbol(sym, snap_date, fetch=lambda s: ("ok", [{"date": period_end, "epsAvg": eps}], None))
    st.put = put
    return st


def _d(days_ago):
    return (TODAY - _td(days=days_ago)).isoformat()


def test_revisions_come_from_our_snapshots_when_30_days_are_held(on, snaps):
    from api.services.research.estimates import licensed_revisions
    snaps.put("NVDA", _d(40), "2026-12-31", 1.00)
    snaps.put("NVDA", _d(31), "2026-12-31", 1.05)      # the 30-day-ago point (newest on/before day-30)
    snaps.put("NVDA", _d(1), "2026-12-31", 1.20)
    snaps.put("NVDA", _d(1), "2027-03-31", 1.40)       # second quarter: no 30-day point yet
    out = licensed_revisions("nvda", today=TODAY)
    assert out["state"] == "ok"
    assert out["covers_from"] == _d(40)
    q4, q1 = out["revisions"]
    assert q4 == {"period": "Q4 2026", "period_end": "2026-12-31", "current": 1.20, "ago30": 1.05,
                  "ago90": None, "up30": None, "down30": None}
    assert q1["ago30"] is None and q1["current"] == 1.40


def test_a_30_day_point_more_than_a_week_older_than_day_30_is_not_used(on, snaps):
    from api.services.research.estimates import licensed_revisions
    snaps.put("AMD", _d(45), "2026-12-31", 0.9)        # 15 days before day-30: too far
    snaps.put("AMD", _d(2), "2026-12-31", 1.0)
    out = licensed_revisions("AMD", today=TODAY)
    assert out["state"] == "building" and out["covers_from"] == _d(45)


def test_a_stale_store_does_not_pretend_to_be_current(on, snaps):
    from api.services.research.estimates import licensed_revisions
    snaps.put("MU", _d(31), "2026-12-31", 0.9)         # a good 30-day-ago point...
    snaps.put("MU", _d(10), "2026-12-31", 1.0)         # ...but the newest snapshot is 10 days old
    assert licensed_revisions("MU", today=TODAY)["state"] == "building"


def test_no_snapshot_yet_is_building_and_starts_tracking(on, snaps):
    from api.services.research.estimates import licensed_revisions
    out = licensed_revisions("ZZNEW", today=TODAY)
    assert out == {"state": "building", "covers_from": None, "tracked": True}
    assert "ZZNEW" in snaps.eh.tracked()


def test_no_forward_quarter_or_dark_history_means_no_licensed_answer(on, snaps, monkeypatch):
    from api.services.research.estimates import licensed_revisions
    snaps.cons = {"state": "empty", "quarterly": [], "annual": []}
    assert licensed_revisions("XYZ", today=TODAY) is None
    monkeypatch.setenv("ESTIMATE_HISTORY_ENABLED", "0")
    snaps.cons = {"state": "ok", "quarterly": [{"period_end": "2026-12-31", "label": "Q4 2026"}]}
    assert licensed_revisions("XYZ", today=TODAY) is None


def test_the_route_serves_snapshots_first_and_yahoo_labelled_otherwise(on, snaps, monkeypatch):
    from api.routers import research as r
    from api.services.research import estimates as est
    yahoo_rows = [{"period": "Current Qtr", "current": 1.0, "ago30": 0.9, "ago90": 0.8,
                   "up30": 3, "down30": 1}]
    monkeypatch.setattr(r, "get_estimates", lambda s: {"revisions": yahoo_rows})
    monkeypatch.setattr(r, "_fund_marked", lambda out, sym, why: out)
    monkeypatch.setattr(est, "licensed_revisions",
                        lambda s, **k: {"state": "ok", "revisions": [{"period": "Q4 2026"}],
                                        "covers_from": "2026-10-05", "last_snapshot": "2026-11-26"})
    out = r.research_estimates("NVDA", revisions=1)
    assert out["sources"] == {"revisions": est.LICENSED_REVISIONS_SOURCE}
    assert out["revisions"] == [{"period": "Q4 2026"}]
    monkeypatch.setattr(est, "licensed_revisions",
                        lambda s, **k: {"state": "building", "covers_from": None, "tracked": True})
    out = r.research_estimates("NVDA", revisions=1)
    assert out["sources"] == {"revisions": "Yahoo Finance"}
    assert out["revisions"] == yahoo_rows
    assert out["history"] == {"state": "building", "covers_from": None, "tracked": True}


def test_the_client_and_server_name_the_snapshot_source_the_same():
    from pathlib import Path
    from api.services.research.estimates import LICENSED_REVISIONS_SOURCE
    jsx = Path("app/src/components/research/fmpDepth/ConsensusEstimates.jsx").read_text(encoding="utf-8")
    assert f"SNAPSHOT_REVISIONS_SOURCE = '{LICENSED_REVISIONS_SOURCE}'" in jsx
