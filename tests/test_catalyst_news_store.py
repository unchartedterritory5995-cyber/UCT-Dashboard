"""Tests for the catalyst 48h news store — evening headlines must survive
to the premarket refresh (the Nasdaq-100 reconstitution headline aged out
of every live RSS window before the 2026-06-12 morning run)."""
import time

import pytest

from api.services.catalyst import news_store


@pytest.fixture(autouse=True)
def _tmp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(news_store, "_DB_PATH", str(tmp_path / "news.db"))
    monkeypatch.setattr(news_store, "_INIT_DONE", False)


def _item(title, url=None, **kw):
    return {"title": title, "url": url, "summary": kw.get("summary", ""),
            "source": kw.get("source", "CNBC"),
            "time_published": kw.get("time_published", "2026-06-12T01:00:00"),
            "tickers": kw.get("tickers", [])}


def test_upsert_and_read_back():
    n = news_store.upsert_items([_item("Rocket Lab joins Nasdaq-100", "http://a")])
    assert n == 1
    items = news_store.recent_items()
    assert len(items) == 1
    assert items[0]["title"] == "Rocket Lab joins Nasdaq-100"
    assert items[0]["source"] == "CNBC"


def test_dedupe_by_url_keeps_first_seen():
    news_store.upsert_items([_item("Original headline", "http://a")])
    n = news_store.upsert_items([_item("Re-served headline", "http://a")])
    assert n == 0
    assert len(news_store.recent_items()) == 1


def test_dedupe_by_title_hash_when_no_url():
    news_store.upsert_items([_item("Same headline", None)])
    assert news_store.upsert_items([_item("Same headline", None)]) == 0
    assert news_store.upsert_items([_item("Different headline", None)]) == 1


def test_retention_prunes_expired(monkeypatch):
    news_store.upsert_items([_item("old", "http://old")])
    # Age the row past the window, then trigger prune via a fresh upsert.
    import contextlib
    with contextlib.closing(news_store._connect()) as c:
        c.execute("UPDATE news_items SET first_seen_at = ?",
                  (int(time.time()) - (news_store.RETENTION_HOURS + 1) * 3600,))
        c.commit()
    news_store.upsert_items([_item("new", "http://new")])
    titles = [i["title"] for i in news_store.recent_items()]
    assert titles == ["new"]


def test_rss_pull_reads_store_union(monkeypatch):
    """An evening headline already in the store attaches at the next refresh
    even though the live fetch no longer returns it."""
    from api.services.catalyst import sources, news_match
    from tests.test_catalyst_news_match import IDX, NAMES

    news_store.upsert_items(
        [_item("Rocket Lab and Teradyne to join Nasdaq-100", "http://evening")])
    monkeypatch.setattr("api.services.news_aggregator.fetch_rss_news",
                        lambda *a, **k: [_item("Teradyne wins robotics deal",
                                               "http://morning")])
    monkeypatch.setattr(news_match, "_get_index", lambda: IDX)
    monkeypatch.setattr(news_match, "_UNIVERSE", set(NAMES))
    out = sources._pull_rss_signals()
    assert "RKLB" in out          # from the persisted evening item
    titles = {i["title"] for i in out["TER"]}
    assert len(titles) == 2       # both evening + morning items attach
