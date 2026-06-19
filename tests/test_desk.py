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


# ── Substack archive API parsing (full history) ──────────────────────────────────

def test_base_url_strips_feed():
    assert substack_poller._base_url("https://uct.substack.com/feed") == "https://uct.substack.com"
    assert substack_poller._base_url("https://uct.substack.com/") == "https://uct.substack.com"
    assert substack_poller._base_url("not a url") == ""


def test_parse_iso8601():
    assert substack_poller._parse_iso8601("2026-06-14T16:30:47.892Z") > 0
    assert substack_poller._parse_iso8601("") == 0
    assert substack_poller._parse_iso8601("garbage") == 0


def test_parse_archive_items_maps_fields():
    items = [
        {"id": 123, "title": "Sunday Scans", "canonical_url": "https://uct.substack.com/p/sunday-scans",
         "cover_image": "https://img/hero.webp", "post_date": "2026-06-14T16:30:47.892Z",
         "description": "<p>Weekly map</p>",
         "publishedBylines": [{"name": "Patrick"}]},
        {"title": "no url skipped", "canonical_url": ""},  # skipped
    ]
    posts = substack_poller.parse_archive_items(items, publication_id=7)
    assert len(posts) == 1
    p = posts[0]
    assert p["id"] == "https://uct.substack.com/p/sunday-scans"  # keyed on URL (dedup-stable)
    assert p["publication_id"] == 7
    assert p["title"] == "Sunday Scans"
    assert p["url"] == "https://uct.substack.com/p/sunday-scans"
    assert p["hero_image"] == "https://img/hero.webp"
    assert p["author"] == "Patrick"
    assert p["excerpt"] == "Weekly map"  # HTML stripped
    assert p["published_at"] > 0


def test_list_posts_dedupes_by_url(store):
    # Same post stored under two ids (legacy guid + numeric) → one row on the page.
    u = "https://uct.substack.com/p/dup"
    store.upsert_post({"id": u, "title": "Dup (url id)", "url": u, "published_at": 2000})
    store.upsert_post({"id": "999", "title": "Dup (numeric id)", "url": u, "published_at": 1000})
    posts = store.list_posts()
    assert len([p for p in posts if (p["url"] or "").rstrip("/") == u]) == 1


def test_dedupe_posts_removes_physical_dupes(store):
    u = "https://uct.substack.com/p/dup"
    store.upsert_post({"id": u, "title": "keep-newer", "url": u, "published_at": 2000})
    store.upsert_post({"id": "999", "title": "drop-older", "url": u + "/", "published_at": 1000})
    removed = store.dedupe_posts()
    assert removed == 1
    rows = store.list_posts()
    survivors = [p for p in rows if "dup" in (p["url"] or "")]
    assert len(survivors) == 1
    assert survivors[0]["title"] == "keep-newer"  # newest published_at kept


def test_parse_archive_items_empty():
    assert substack_poller.parse_archive_items([]) == []
    assert substack_poller.parse_archive_items(None) == []


def test_parse_feed_hero_falls_back_to_img_in_content():
    rss = """<?xml version="1.0"?><rss xmlns:content="http://purl.org/rss/1.0/modules/content/">
    <channel><item><title>T</title><link>https://x.com/p/t</link>
    <content:encoded>&lt;img src="https://x.com/in-content.png"/&gt; body</content:encoded>
    </item></channel></rss>"""
    posts = substack_poller.parse_feed(rss)
    assert posts[0]["hero_image"] == "https://x.com/in-content.png"


def test_parse_feed_hero_from_enclosure():
    # Substack puts the hero image in <enclosure> (type="image/jpeg" even for webp).
    rss = """<?xml version="1.0"?><rss><channel><item>
    <title>Weekly Map</title><link>https://uct.substack.com/p/weekly-map</link>
    <enclosure url="https://substack-post-media.s3.amazonaws.com/public/images/hero_900x510.webp" length="0" type="image/jpeg"/>
    </item></channel></rss>"""
    posts = substack_poller.parse_feed(rss)
    assert posts[0]["hero_image"] == "https://substack-post-media.s3.amazonaws.com/public/images/hero_900x510.webp"


def test_parse_feed_enclosure_wins_over_img_in_body():
    rss = """<?xml version="1.0"?><rss xmlns:content="http://purl.org/rss/1.0/modules/content/">
    <channel><item><title>T</title><link>https://x.com/p/t</link>
    <enclosure url="https://x.com/hero.webp" type="image/jpeg"/>
    <content:encoded>&lt;img src="https://x.com/in-body.png"/&gt;</content:encoded>
    </item></channel></rss>"""
    posts = substack_poller.parse_feed(rss)
    assert posts[0]["hero_image"] == "https://x.com/hero.webp"


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


def test_team_strategy_fields_roundtrip(store):
    m = store.create_member({
        "name": "Bracco", "role": "Co-Founder", "years_trading": "6 Years",
        "trading_style": "Hunts fat pitches\nSizes up aggressively",
        "teaching_focus": "Pattern recognition\nWhen to size up",
    })
    got = store.get_member(m["id"])
    assert got["years_trading"] == "6 Years"
    assert "fat pitches" in got["trading_style"]
    assert "Pattern recognition" in got["teaching_focus"]
    upd = store.update_member(m["id"], {"trading_style": "Edited style"})
    assert upd["trading_style"] == "Edited style"


def test_ensure_default_team_seeds_roster(store):
    store.ensure_default_team()
    team = store.list_team()
    names = {m["name"] for m in team}
    assert len(team) == 18
    assert "Bracco" in names and "Stef" in names
    # Strategy content actually lands on the seeded rows.
    bracco = next(m for m in team if m["name"] == "Bracco")
    assert bracco["role"] == "Co-Founder"
    assert "fat" in (bracco["trading_style"] or "").lower()
    # Seeded in sheet order (TSDR the founder first).
    assert team[0]["name"] == "TSDR"


def test_ensure_default_team_idempotent_and_preserves_edits(store):
    store.ensure_default_team()
    bracco = next(m for m in store.list_team() if m["name"] == "Bracco")
    store.update_member(bracco["id"], {"role": "Head Trader"})
    store.ensure_default_team()  # second boot — must not duplicate or clobber
    team = store.list_team()
    assert len(team) == 18  # no duplicates
    bracco2 = next(m for m in team if m["name"] == "Bracco")
    assert bracco2["role"] == "Head Trader"  # admin edit preserved


def test_seed_backfills_bundled_avatars(store, monkeypatch, tmp_path):
    """ensure_default_team writes each seed member's bundled avatar into the live
    photo dir and flags has_photo — every trader card gets an image."""
    monkeypatch.setattr(store, "_TEAM_PHOTO_DIR", str(tmp_path))
    store.ensure_default_team()
    team = store.list_team()
    with_photo = [m for m in team if m["has_photo"]]
    assert len(with_photo) == 18  # all 18 traders have a bundled avatar
    # The webp file was actually written for a member.
    bracco = next(m for m in team if m["name"] == "Bracco")
    assert (tmp_path / f"{bracco['id']}.webp").exists()


def test_seed_photo_never_clobbers_admin_upload(store, monkeypatch, tmp_path):
    monkeypatch.setattr(store, "_TEAM_PHOTO_DIR", str(tmp_path))
    store.ensure_default_team()
    bracco = next(m for m in store.list_team() if m["name"] == "Bracco")
    # Admin replaces the avatar with their own bytes.
    (tmp_path / f"{bracco['id']}.webp").write_bytes(b"ADMIN_UPLOAD")
    store.ensure_default_team()  # re-run must not overwrite (has_photo already 1)
    assert (tmp_path / f"{bracco['id']}.webp").read_bytes() == b"ADMIN_UPLOAD"


def test_seed_member_photo_missing_file_is_safe(store, monkeypatch, tmp_path):
    monkeypatch.setattr(store, "_TEAM_PHOTO_DIR", str(tmp_path))
    m = store.create_member({"name": "Ghost"})
    assert store.seed_member_photo(m["id"], "does_not_exist.webp") is False
    assert store.get_member(m["id"])["has_photo"] == 0


def test_team_alters_apply_to_legacy_db(monkeypatch):
    """A pre-existing team_members table without the strategy columns gets them
    ALTERed in on _init_db()."""
    import contextlib as _cl
    import tempfile as _tf
    import os as _os
    with _tf.TemporaryDirectory() as d:
        path = _os.path.join(d, "desk.db")
        monkeypatch.setattr(desk_store, "_DB_PATH", path)
        # Build the OLD schema (no years_trading/trading_style/teaching_focus).
        with _cl.closing(desk_store._connect()) as c:
            c.execute("""CREATE TABLE team_members (
              id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, role TEXT,
              bio TEXT, has_photo INTEGER NOT NULL DEFAULT 0, twitter_url TEXT,
              substack_url TEXT, email TEXT, link_url TEXT,
              sort_order INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
              created_at INTEGER NOT NULL, updated_at INTEGER)""")
            c.commit()
        desk_store._init_db()  # should ALTER in the 3 new columns, not crash
        m = desk_store.create_member({"name": "X", "trading_style": "S"})
        assert desk_store.get_member(m["id"])["trading_style"] == "S"


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


def test_extract_media_from_raw_json():
    raw = ('{"text":"chart","extendedEntities":{"media":[{"media_url_https":'
           '"https://pbs.twimg.com/media/ABC123.jpg"},{"media_url_https":'
           '"https://pbs.twimg.com/media/DEF456?format=png&name=large"}]}}')
    media = tweet_store._extract_media(raw)
    assert "https://pbs.twimg.com/media/ABC123.jpg?format=jpg&name=small" in media[0]
    assert any("DEF456" in m for m in media)
    assert len(media) == 2


def test_extract_media_dedupes_and_caps():
    url = "https://pbs.twimg.com/media/SAME.jpg"
    raw = "{" + ",".join(f'"k{i}":"{url}"' for i in range(10)) + "}"
    assert len(tweet_store._extract_media(raw)) == 1  # deduped


def test_extract_media_none_and_no_media():
    assert tweet_store._extract_media(None) == []
    assert tweet_store._extract_media('{"text":"no images here"}') == []


def test_feed_attaches_media(tweets):
    import time
    now = int(time.time())
    tweets.add_account("UCTofficial")
    tweets.set_account_official("UCTofficial", True)
    tweets.upsert_tweet({"id": "9", "author_handle": "UCTofficial", "text": "with pic",
                         "created_at": now, "url": "u9",
                         "raw_json": '{"x":"https://pbs.twimg.com/media/PIC9.jpg"}'}, [])
    feed = tweets.feed(hours=24, limit=10, official_only=True)
    assert feed[0]["media"] and "PIC9" in feed[0]["media"][0]
