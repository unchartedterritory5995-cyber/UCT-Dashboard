import os
import tempfile

import pytest

from api.services import desk_store
from api.services import substack_poller
from api.services import tweet_store


@pytest.fixture
def store(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(desk_store, "_DB_PATH", os.path.join(d, "desk.db"))
        desk_store._init_db()
        yield desk_store


@pytest.fixture
def tweets(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(tweet_store, "_DB_PATH", os.path.join(d, "tweets.db"))
        tweet_store._init_db()
        yield tweet_store


# ── Substack publications + posts ────────────────────────────────────────────────

def test_create_and_list_publication(store):
    pub = store.create_publication("UCT Letter", "https://uct.substack.com/feed")
    assert pub["id"]
    assert pub["enabled"] == 1
    pubs = store.list_publications()
    assert len(pubs) == 1
    assert pubs[0]["name"] == "UCT Letter"


def test_publication_feed_url_unique_upsert(store):
    a = store.create_publication("A", "https://x.substack.com/feed")
    b = store.create_publication("A renamed", "https://x.substack.com/feed")
    assert a["id"] == b["id"]
    assert len(store.list_publications()) == 1


def test_upsert_and_list_posts_newest_first(store):
    pub = store.create_publication("UCT", "https://uct.substack.com/feed")
    store.upsert_post({"id": "g1", "publication_id": pub["id"], "title": "Older",
                       "url": "https://uct.substack.com/p/older", "published_at": 1000})
    store.upsert_post({"id": "g2", "publication_id": pub["id"], "title": "Newer",
                       "url": "https://uct.substack.com/p/newer", "published_at": 2000})
    posts = store.list_posts()
    assert [p["title"] for p in posts] == ["Newer", "Older"]
    assert posts[0]["publication_name"] == "UCT"


def test_post_upsert_dedupes_on_id(store):
    store.upsert_post({"id": "g1", "title": "T", "url": "u", "published_at": 1})
    store.upsert_post({"id": "g1", "title": "T edited", "url": "u", "published_at": 1})
    posts = store.list_posts()
    assert len(posts) == 1
    assert posts[0]["title"] == "T edited"


def test_delete_publication_cascades_posts(store):
    pub = store.create_publication("UCT", "https://uct.substack.com/feed")
    store.upsert_post({"id": "g1", "publication_id": pub["id"], "title": "T",
                       "url": "u", "published_at": 1})
    store.delete_posts_for_publication(pub["id"])
    assert store.delete_publication(pub["id"]) is True
    assert store.list_posts() == []


# ── Substack RSS parsing ─────────────────────────────────────────────────────────

_SAMPLE_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>UCT Letter</title>
    <item>
      <title>Weekly Market Map</title>
      <link>https://uct.substack.com/p/weekly-market-map</link>
      <guid>https://uct.substack.com/p/weekly-market-map</guid>
      <dc:creator>Patrick</dc:creator>
      <pubDate>Mon, 16 Jun 2026 12:00:00 GMT</pubDate>
      <description>&lt;p&gt;This week we map the &lt;b&gt;tape&lt;/b&gt;.&lt;/p&gt;</description>
      <media:content url="https://img.substack.com/hero.jpg"/>
    </item>
    <item>
      <title>No link should be skipped</title>
      <link></link>
    </item>
  </channel>
</rss>"""


def test_parse_feed_extracts_fields():
    posts = substack_poller.parse_feed(_SAMPLE_RSS, publication_id=5)
    assert len(posts) == 1  # second item has no link → skipped
    p = posts[0]
    assert p["title"] == "Weekly Market Map"
    assert p["url"] == "https://uct.substack.com/p/weekly-market-map"
    assert p["publication_id"] == 5
    assert p["author"] == "Patrick"
    assert p["hero_image"] == "https://img.substack.com/hero.jpg"
    assert "tape" in p["excerpt"].lower()
    assert "<b>" not in p["excerpt"]  # HTML stripped
    assert p["published_at"] > 0


def test_parse_feed_bad_xml_returns_empty():
    assert substack_poller.parse_feed("not xml at all") == []


def test_parse_feed_hero_falls_back_to_img_in_content():
    rss = """<?xml version="1.0"?><rss xmlns:content="http://purl.org/rss/1.0/modules/content/">
    <channel><item><title>T</title><link>https://x.com/p/t</link>
    <content:encoded>&lt;img src="https://x.com/in-content.png"/&gt; body</content:encoded>
    </item></channel></rss>"""
    posts = substack_poller.parse_feed(rss)
    assert posts[0]["hero_image"] == "https://x.com/in-content.png"


# ── Team members ─────────────────────────────────────────────────────────────────

def test_team_crud(store):
    m = store.create_member({"name": "Patrick", "role": "Founder", "bio": "Leads UCT"})
    assert m["id"]
    assert m["has_photo"] == 0
    updated = store.update_member(m["id"], {"role": "CEO"})
    assert updated["role"] == "CEO"
    store.set_member_photo(m["id"], True)
    assert store.get_member(m["id"])["has_photo"] == 1
    assert store.delete_member(m["id"]) is True
    assert store.get_member(m["id"]) is None


def test_team_ordered_by_sort_order(store):
    store.create_member({"name": "B", "sort_order": 1})
    store.create_member({"name": "A", "sort_order": 0})
    assert [m["name"] for m in store.list_team()] == ["A", "B"]


# ── Tweets official filter ───────────────────────────────────────────────────────

def test_feed_official_only_filters(tweets):
    import time
    now = int(time.time())
    tweets.add_account("UCTofficial", display_name="UCT")
    tweets.add_account("Benzinga", display_name="Benzinga")
    tweets.set_account_official("UCTofficial", True)
    tweets.upsert_tweet({"id": "1", "author_handle": "UCTofficial", "text": "ours",
                         "created_at": now, "url": "u1"}, [])
    tweets.upsert_tweet({"id": "2", "author_handle": "Benzinga", "text": "news",
                         "created_at": now, "url": "u2"}, [])
    all_feed = tweets.feed(hours=24, limit=50)
    official = tweets.feed(hours=24, limit=50, official_only=True)
    assert len(all_feed) == 2
    assert [t["author_handle"] for t in official] == ["UCTofficial"]
