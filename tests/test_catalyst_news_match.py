"""Unit tests for catalyst news_match — company-name → ticker attachment.

The motivating miss (2026-06-12): "Rocket Lab, Nebius, Astera Labs, CoreWeave,
Teradyne to join Nasdaq-100" attached to ZERO tickers because extraction was
cashtag-only — so the engine never knew the inclusion story existed and only
TER (which gapped enough on its own) reached the board.
"""
import pytest

from api.services.catalyst import news_match, news_store
from api.services.catalyst.news_match import build_index, match_tickers


@pytest.fixture(autouse=True)
def _isolated_news_store(tmp_path, monkeypatch):
    """The RSS pull persists into the 48h news store — isolate it per test
    so items don't leak across tests (keys are URL-deduped)."""
    monkeypatch.setattr(news_store, "_DB_PATH", str(tmp_path / "news.db"))
    monkeypatch.setattr(news_store, "_INIT_DONE", False)

NAMES = {
    "RKLB": "Rocket Lab USA, Inc.",
    "NBIS": "Nebius Group N.V.",
    "ALAB": "Astera Labs, Inc.",
    "CRWV": "CoreWeave, Inc.",
    "TER": "Teradyne, Inc.",
    "TGT": "Target Corporation",
    "GPS": "Gap Inc.",
    "UAL": "United Airlines Holdings Inc",
    "ORCL": "Oracle Corporation",
    "AAPL": "Apple Inc.",
    "GOOGL": "Alphabet Inc.",
}
IDX = build_index(NAMES)


def test_nasdaq_100_inclusion_headline_matches_all_five():
    text = ("Rocket Lab, Nebius, Astera Labs, CoreWeave and Teradyne to join "
            "Nasdaq-100 in annual reconstitution")
    assert match_tickers(text, IDX) == {"RKLB", "NBIS", "ALAB", "CRWV", "TER"}


def test_possessive_and_case_insensitive():
    assert match_tickers("TERADYNE'S shares rally on index news", IDX) == {"TER"}


def test_common_word_single_tokens_do_not_match():
    # "price target", "first quarter", "United States", "the gap between"
    text = ("Analysts raise the price target; first quarter GDP shows the gap "
            "between United States consumers and producers widening")
    assert match_tickers(text, IDX) == set()


def test_full_multiword_name_still_matches_blocked_single_tokens():
    assert match_tickers("Target Corporation beats on earnings", IDX) == {"TGT"}
    assert match_tickers("United Airlines Holdings guides higher", IDX) == {"UAL"}


def test_distinctive_single_token_matches():
    assert match_tickers("Oracle surges on cloud backlog", IDX) == {"ORCL"}
    assert match_tickers("Apple unveils new chip", IDX) == {"AAPL"}


def test_listicle_over_cap_returns_nothing(monkeypatch):
    monkeypatch.setattr(news_match, "MAX_TICKERS_PER_TEXT", 3)
    text = "Rocket Lab, Nebius, Astera Labs, CoreWeave and Teradyne join the index"
    assert match_tickers(text, IDX) == set()


def test_env_kill_switch(monkeypatch):
    monkeypatch.setenv("CATALYST_NEWS_MATCH_ENABLED", "0")
    assert match_tickers("Oracle surges", IDX) == set()


def test_empty_index_safe():
    assert match_tickers("Oracle surges", {}) == set()


def test_rss_pull_attaches_name_matched_tickers(monkeypatch):
    """Integration: an RSS item naming companies (no cashtags) attaches to the
    matched tickers and creates candidates for them."""
    from api.services.catalyst import sources

    items = [{"title": "Rocket Lab and Teradyne to join Nasdaq-100",
              "summary": "", "url": "u", "source": "CNBC",
              "time_published": "2026-06-12T08:00:00"}]
    monkeypatch.setattr("api.services.news_aggregator.fetch_rss_news",
                        lambda *a, **k: items)
    monkeypatch.setattr(news_match, "_get_index", lambda: IDX)
    monkeypatch.setattr(news_match, "_UNIVERSE", set(NAMES))
    out = sources._pull_rss_signals()
    assert set(out) >= {"RKLB", "TER"}
    assert out["RKLB"][0]["title"].startswith("Rocket Lab")


def test_rss_pull_validates_bare_word_tickers_against_universe(monkeypatch):
    """news_aggregator guesses tickers from ANY bare uppercase word — FIFA,
    USMNT, LLP and USA all arrived as 'tickers' on 2026-06-12. Only real
    cap-universe symbols may attach."""
    from api.services.catalyst import sources

    items = [{"title": "World Cup prize money announced for players",
              "summary": "", "url": "u", "source": "CNBC",
              "tickers": ["FIFA", "USMNT", "TER"],
              "time_published": "2026-06-12T08:00:00"}]
    monkeypatch.setattr("api.services.news_aggregator.fetch_rss_news",
                        lambda *a, **k: items)
    monkeypatch.setattr(news_match, "_get_index", lambda: {})
    monkeypatch.setattr(news_match, "_UNIVERSE", set(NAMES))
    out = sources._pull_rss_signals()
    assert set(out) == {"TER"}


def test_tweet_pull_name_matches_uncashtagged_tweets(monkeypatch):
    """A squawk tweet naming a company with no cashtag attaches via name."""
    from api.services.catalyst import sources
    from api.services import tweet_store

    monkeypatch.setattr(tweet_store, "tape", lambda **k: [])
    monkeypatch.setattr(tweet_store, "feed", lambda **k: [
        {"id": "1", "text": "BREAKING: Rocket Lab wins $500M defense contract",
         "author_handle": "FirstSquawk", "url": "u", "created_at": 1765900000,
         "tickers": []},
    ])
    monkeypatch.setattr(news_match, "_get_index", lambda: IDX)
    out = sources._pull_tweet_signals()
    assert "RKLB" in out
    assert out["RKLB"][0]["author_handle"] == "FirstSquawk"


def test_rss_pull_skips_legal_boilerplate(monkeypatch):
    """Law-firm investor alerts are never catalysts (GPGI/FSK junk rows
    reached selection 2026-06-12)."""
    from api.services.catalyst import sources

    items = [
        {"title": "SHAREHOLDER ALERT: Ademi LLP investigates claims against $TER",
         "summary": "", "url": "u1", "source": "PRNewswire",
         "time_published": "2026-06-12T08:00:00"},
        {"title": "INVESTOR NOTICE: Robbins Geller Rudman & Dowd LLP announces "
                  "class action against $RKLB",
         "summary": "", "url": "u2", "source": "PRNewswire",
         "time_published": "2026-06-12T08:00:00"},
        {"title": "Teradyne wins major robotics contract", "summary": "",
         "url": "u3", "source": "CNBC",
         "time_published": "2026-06-12T08:00:00"},
    ]
    monkeypatch.setattr("api.services.news_aggregator.fetch_rss_news",
                        lambda *a, **k: items)
    monkeypatch.setattr(news_match, "_get_index", lambda: IDX)
    monkeypatch.setattr(news_match, "_UNIVERSE", set(NAMES))
    out = sources._pull_rss_signals()
    assert set(out) == {"TER"}
    assert len(out["TER"]) == 1  # only the robotics headline, not the alert
