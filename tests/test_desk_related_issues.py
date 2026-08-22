"""Related issues: from one article to the issues most ABOUT the same stocks.

prev/next already walks the archive as a sequence; `related_posts` walks it by
subject. The load-bearing rules:
  1. overlap is scored on exact ticker sets, ranked overlap-then-recency,
  2. a small overlap is the series' baseline (every issue charts the index
     ETFs) and must NOT read as a relationship,
  3. a body-less or slug-less row is never offered — the card deep-links into
     the reader, which 409s without a body.
"""
from __future__ import annotations

import importlib
import json

import pytest

PUBLISHED_AT = 1786902774


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("DESK_DB_PATH", str(tmp_path / "desk.db"))
    from api.services import desk_store as ds
    importlib.reload(ds)
    ds._init_db()
    return ds


def seed(store, post_id, slug, tickers, *, published_at=PUBLISHED_AT, body="<p>x</p>"):
    store.upsert_post({"id": post_id, "title": "SUNDAY SCANS", "url": post_id,
                       "published_at": published_at})
    store.save_post_body(post_id, {
        "body_html": body, "slug": slug, "display_title": f"Sunday Scans — {slug}",
        "tickers_json": json.dumps(tickers), "reading_minutes": 14,
    })


def test_ranked_by_overlap_then_recency_and_capped(store):
    seed(store, "me", "me", ["INTC", "MU", "ARM", "DELL", "AMD", "NVDA"])
    # 5 shared names — the strongest relation despite being the oldest.
    seed(store, "u1", "s1", ["INTC", "MU", "ARM", "DELL", "AMD", "XYZ"],
         published_at=PUBLISHED_AT - 30 * 86400)
    # 3 shared names, twice — recency breaks the tie between s2 and s3.
    seed(store, "u2", "s2", ["INTC", "MU", "ARM", "KO", "PEP"],
         published_at=PUBLISHED_AT - 14 * 86400)
    seed(store, "u3", "s3", ["INTC", "MU", "ARM", "KO", "JPM"],
         published_at=PUBLISHED_AT - 7 * 86400)
    # 4 shared names — beats both 3s, loses to the 5.
    seed(store, "u4", "s4", ["INTC", "MU", "ARM", "DELL", "F"],
         published_at=PUBLISHED_AT - 21 * 86400)
    got = store.related_posts("me")
    assert [r["slug"] for r in got] == ["s1", "s4", "s3"]
    assert got[0]["shared_count"] == 5
    # Shared names surface in THIS issue's own (author-curated) order, capped.
    assert got[0]["shared"] == ["INTC", "MU", "ARM", "DELL"]


def test_a_baseline_overlap_is_not_a_relationship(store):
    """Every issue charts QQQ/SPY — two shared names must not make a card."""
    seed(store, "me", "me", ["QQQ", "SPY", "NVDA"])
    seed(store, "u1", "s1", ["QQQ", "SPY", "KO"])
    assert store.related_posts("me") == []


def test_self_bodyless_and_slugless_rows_are_never_offered(store):
    seed(store, "me", "me", ["INTC", "MU", "ARM"])
    # Same names, no body: the card would deep-link to a 409.
    store.upsert_post({"id": "u1", "title": "T", "url": "u1", "published_at": 1})
    store.save_post_body("u1", {"body_html": "", "slug": "s1",
                                "tickers_json": json.dumps(["INTC", "MU", "ARM"])})
    # Same names, no slug: nothing to link to.
    store.upsert_post({"id": "u2", "title": "T", "url": "u2", "published_at": 1})
    store.save_post_body("u2", {"body_html": "<p>x</p>", "slug": "",
                                "tickers_json": json.dumps(["INTC", "MU", "ARM"])})
    assert store.related_posts("me") == []


def test_a_post_with_no_tickers_relates_to_nothing(store):
    seed(store, "me", "me", [])
    seed(store, "u1", "s1", ["INTC", "MU", "ARM"])
    assert store.related_posts("me") == []
    assert store.related_posts("missing-id") == []


def test_the_article_payload_carries_related(store, monkeypatch):
    """The rail the frontend actually reads: get_article returns `related`."""
    seed(store, "me", "me", ["INTC", "MU", "ARM", "DELL"])
    seed(store, "u1", "s1", ["INTC", "MU", "ARM", "KO"],
         published_at=PUBLISHED_AT - 7 * 86400)
    from api.routers import desk as desk_router
    monkeypatch.setattr(desk_router, "desk_store", store)
    payload = desk_router.get_article("me", _user={"id": 1})
    assert [r["slug"] for r in payload["related"]] == ["s1"]
    assert payload["related"][0]["shared"] == ["INTC", "MU", "ARM"]


def test_related_failure_never_loses_the_article(store, monkeypatch):
    """`related` is a bonus rail — a blow-up inside it must not 500 the read."""
    seed(store, "me", "me", ["INTC", "MU", "ARM"])
    from api.routers import desk as desk_router
    monkeypatch.setattr(desk_router, "desk_store", store)
    monkeypatch.setattr(store, "related_posts",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    payload = desk_router.get_article("me", _user={"id": 1})
    assert payload["related"] == []
    assert payload["body_html"]
