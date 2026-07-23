"""Finviz Elite news export + AlphaVantage news-sentiment sources."""
import pytest

from api.services.catalyst import sources


# ── Finviz news ─────────────────────────────────────────────────────────
_FINVIZ_CSV = (
    '"Title","Source","Date","Url","Category","Ticker"\n'
    '"L3Harris Announces Quarterly Dividend","Finviz",2026-07-23 14:08:48,"http://x/1","Stock","LHX"\n'
    '"Comstock earns award","Finviz",2026-07-23 13:00:00,"http://x/2","Stock","CHCI"\n'
    '"These S&P 500 sectors are selling off","MarketWatch",2026-07-23 12:00:00,"http://x/3","Stock","AMZN,GOOGL,META,TSLA,NVDA"\n'
    '"Shareholder Alert: class action deadline","LawFirm LLP",2026-07-23 11:00:00,"http://x/4","Stock","XYZ"\n'
    '"Two-name deal chatter","Finviz",2026-07-23 10:00:00,"http://x/5","Stock","HUT,MS"\n'
    '"Macro note, no ticker","Finviz",2026-07-23 09:00:00,"http://x/6","Stock",""\n'
)


def _csv_response(monkeypatch, text):
    class _Resp:
        def __init__(self, t): self.text = t
        def raise_for_status(self): pass
    monkeypatch.setattr("requests.get", lambda *a, **k: _Resp(text))


def test_finviz_disabled_returns_empty(monkeypatch):
    monkeypatch.setenv("CATALYST_FINVIZ_NEWS_ENABLED", "0")
    monkeypatch.setenv("FINVIZ_API_KEY", "k")
    assert sources._pull_finviz_news() == {}


def test_finviz_no_key_returns_empty(monkeypatch):
    monkeypatch.setenv("CATALYST_FINVIZ_NEWS_ENABLED", "1")
    monkeypatch.delenv("FINVIZ_API_KEY", raising=False)
    assert sources._pull_finviz_news() == {}


def test_finviz_failsoft(monkeypatch):
    monkeypatch.setenv("CATALYST_FINVIZ_NEWS_ENABLED", "1")
    monkeypatch.setenv("FINVIZ_API_KEY", "k")

    def boom(*a, **k):
        raise RuntimeError("finviz down")
    monkeypatch.setattr("requests.get", boom)
    assert sources._pull_finviz_news() == {}


def test_finviz_keeps_single_ticker_headlines(monkeypatch):
    monkeypatch.setenv("CATALYST_FINVIZ_NEWS_ENABLED", "1")
    monkeypatch.setenv("FINVIZ_API_KEY", "k")
    _csv_response(monkeypatch, _FINVIZ_CSV)
    out = sources._pull_finviz_news()
    assert "LHX" in out and "CHCI" in out
    assert out["LHX"][0]["title"].startswith("L3Harris")
    assert out["LHX"][0]["source"] == "Finviz"


def test_finviz_keeps_few_ticker_rows(monkeypatch):
    monkeypatch.setenv("CATALYST_FINVIZ_NEWS_ENABLED", "1")
    monkeypatch.setenv("FINVIZ_API_KEY", "k")
    _csv_response(monkeypatch, _FINVIZ_CSV)
    out = sources._pull_finviz_news()
    # HUT,MS = 2 tickers (<= max 3) → both kept
    assert "HUT" in out and "MS" in out


def test_finviz_drops_macro_multiticker(monkeypatch):
    monkeypatch.setenv("CATALYST_FINVIZ_NEWS_ENABLED", "1")
    monkeypatch.setenv("FINVIZ_API_KEY", "k")
    _csv_response(monkeypatch, _FINVIZ_CSV)
    out = sources._pull_finviz_news()
    # The 5-ticker macro sector piece is dropped entirely.
    for sym in ("AMZN", "GOOGL", "META", "TSLA", "NVDA"):
        assert sym not in out


def test_finviz_drops_legal_boilerplate_and_blank(monkeypatch):
    monkeypatch.setenv("CATALYST_FINVIZ_NEWS_ENABLED", "1")
    monkeypatch.setenv("FINVIZ_API_KEY", "k")
    _csv_response(monkeypatch, _FINVIZ_CSV)
    out = sources._pull_finviz_news()
    assert "XYZ" not in out          # "Shareholder Alert" legal noise dropped
    assert "" not in out             # blank-ticker macro row dropped


# ── AlphaVantage news sentiment ─────────────────────────────────────────
def _json_response(monkeypatch, obj):
    class _Resp:
        def __init__(self, o): self._o = o
        def raise_for_status(self): pass
        def json(self): return self._o
    monkeypatch.setattr("requests.get", lambda *a, **k: _Resp(obj))


def test_av_dormant_by_default(monkeypatch):
    # No CATALYST_AV_NEWS_ENABLED set → off even with a key present.
    monkeypatch.delenv("CATALYST_AV_NEWS_ENABLED", raising=False)
    monkeypatch.setenv("ALPHAVANTAGE_API_KEY", "k")
    assert sources._pull_av_news() == {}


def test_av_no_key_returns_empty(monkeypatch):
    monkeypatch.setenv("CATALYST_AV_NEWS_ENABLED", "1")
    monkeypatch.delenv("ALPHAVANTAGE_API_KEY", raising=False)
    monkeypatch.delenv("CATALYST_AV_NEWS_KEY", raising=False)
    assert sources._pull_av_news() == {}


def test_av_throttle_reply_returns_empty(monkeypatch):
    monkeypatch.setenv("CATALYST_AV_NEWS_ENABLED", "1")
    monkeypatch.setenv("ALPHAVANTAGE_API_KEY", "k")
    _json_response(monkeypatch, {"Information": "Please consider premium..."})
    assert sources._pull_av_news() == {}


def test_av_aggregates_sentiment(monkeypatch):
    monkeypatch.setenv("CATALYST_AV_NEWS_ENABLED", "1")
    monkeypatch.setenv("ALPHAVANTAGE_API_KEY", "k")
    _json_response(monkeypatch, {"feed": [
        {"title": "NVDA soars", "ticker_sentiment": [
            {"ticker": "NVDA", "relevance_score": "0.9", "ticker_sentiment_score": "0.4"},
            {"ticker": "AMD", "relevance_score": "0.05", "ticker_sentiment_score": "0.9"},  # below relevance floor
        ]},
        {"title": "NVDA again", "ticker_sentiment": [
            {"ticker": "NVDA", "relevance_score": "0.8", "ticker_sentiment_score": "0.2"},
        ]},
        {"title": "TSLA slides", "ticker_sentiment": [
            {"ticker": "TSLA", "relevance_score": "0.7", "ticker_sentiment_score": "-0.3"},
        ]},
    ]})
    out = sources._pull_av_news()
    assert out["NVDA"]["news_sentiment"] == pytest.approx(0.3, abs=0.001)
    assert out["NVDA"]["news_sentiment_label"] == "Bullish"
    assert out["NVDA"]["av_article_count"] == 2
    assert out["TSLA"]["news_sentiment_label"] == "Bearish"
    assert "AMD" not in out          # relevance below floor → excluded
