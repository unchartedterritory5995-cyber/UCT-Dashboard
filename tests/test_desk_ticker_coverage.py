"""Reverse discovery: from a symbol back to the issues that covered it.

The archive was reachable from exactly one place — the Articles tab. Ticker
chips ran article -> research; this is the other direction, which is the
question a trader actually brings to a research page.
"""
from __future__ import annotations

import gzip
import importlib
import json
import os

import pytest

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures",
                       "substack_sunday_scans_2026-08-16.html.gz")
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


def test_a_symbol_finds_the_issues_that_covered_it(store):
    seed(store, "u1", "s1", ["INTC", "MU", "ARM"])
    seed(store, "u2", "s2", ["QQQ", "SPY"], published_at=PUBLISHED_AT - 86400)
    seed(store, "u3", "s3", ["MU", "DELL"], published_at=PUBLISHED_AT - 172800)
    got = store.posts_for_ticker("MU")
    assert [r["slug"] for r in got] == ["s1", "s3"]      # newest first
    assert store.count_posts_for_ticker("MU") == 2


def test_a_substring_symbol_does_not_match(store):
    """⛔ The JSON quoting is what makes this an EXACT-token test. A bare
    substring would make MU match AMU, MU.TO and MULN."""
    seed(store, "u1", "s1", ["AMU", "MU.TO", "MULN", "EMU"])
    assert store.posts_for_ticker("MU") == []
    assert store.count_posts_for_ticker("MU") == 0
    assert [r["slug"] for r in store.posts_for_ticker("MU.TO")] == ["s1"]


def test_case_is_normalised(store):
    seed(store, "u1", "s1", ["MU"])
    for q in ("mu", "Mu", " mu "):
        assert [r["slug"] for r in store.posts_for_ticker(q)] == ["s1"]


@pytest.mark.parametrize("bad", [
    "", "   ", None, "'; DROP TABLE substack_posts;--", "%", "_", "A" * 40, "<script>",
])
def test_junk_input_returns_nothing_and_cannot_reach_the_query(store, bad):
    """The symbol arrives from a URL path segment. `%` and `_` are LIKE
    wildcards — unfiltered they would match EVERY article."""
    seed(store, "u1", "s1", ["MU"])
    assert store.posts_for_ticker(bad) == []
    assert store.count_posts_for_ticker(bad) == 0
    assert store.list_posts(limit=10), "the table is still intact"


def test_an_article_with_no_body_is_never_offered(store):
    """The card links straight into the reader, so offering a card-only row
    would send the reader to a page that 409s."""
    store.upsert_post({"id": "u9", "title": "T", "url": "u9", "published_at": 1})
    store.save_post_body("u9", {"body_html": "", "slug": "no-body",
                                "tickers_json": json.dumps(["MU"])})
    assert store.posts_for_ticker("MU") == []


def test_the_list_is_capped_but_the_count_is_not(store):
    """The card shows the newest few and links onward — a capped count would
    understate the coverage it is advertising."""
    for i in range(15):
        seed(store, f"u{i}", f"s{i}", ["MU"], published_at=PUBLISHED_AT - i * 86400)
    assert len(store.posts_for_ticker("MU", limit=8)) == 8
    assert store.count_posts_for_ticker("MU") == 15


def test_coverage_rows_carry_what_the_card_renders(store):
    seed(store, "u1", "s1", ["MU"])
    row = store.posts_for_ticker("MU")[0]
    for key in ("slug", "display_title", "published_at", "reading_minutes"):
        assert row.get(key) is not None, key
    assert "body_html" not in row, "a list payload must not carry bodies"


def test_it_works_against_the_real_article(store):
    """End to end on the genuine 2026-08-16 issue rather than hand-made rows."""
    from api.services import substack_bodies
    importlib.reload(substack_bodies)
    with gzip.open(FIXTURE, "rt", encoding="utf-8") as fh:
        raw = fh.read()
    url = "https://unchartedterritoryy.substack.com/p/sunday-scans-da5"
    post = {"id": url, "title": "SUNDAY SCANS", "url": url, "published_at": PUBLISHED_AT}
    store.upsert_post(post)
    substack_bodies.store_body(post, raw, slug="sunday-scans-da5")
    for sym in ("MU", "INTC", "QQQ"):
        assert store.count_posts_for_ticker(sym) == 1, sym
    assert store.count_posts_for_ticker("TSLA") == 0
