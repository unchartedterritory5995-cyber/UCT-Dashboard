"""A reference to an earlier issue should open HERE, not bounce to Substack.

The archive carries 149 links back to Substack post URLs, 74 of which point at
articles we already host in full. URL shapes below are the real ones measured
off the live archive, including the `/comments` variant.
"""
from __future__ import annotations

import importlib
import re

import pytest

from api.services import substack_article as sa
from api.services import substack_internal_links as il

PUB = "https://unchartedterritoryy.substack.com"
HELD = {"sunday-scans-1ad", "sunday-scans-cd2"}


def convert(body: str) -> str:
    return sa.convert(body).html


# ── the converter marks candidates, and only candidates ──────────────────────

def test_a_link_to_another_post_is_marked_with_its_slug():
    out = convert(f'<p><a href="{PUB}/p/sunday-scans-1ad">last week</a></p>')
    assert 'data-post-slug="sunday-scans-1ad"' in out


def test_a_trailing_slash_still_marks():
    assert 'data-post-slug="sunday-scans-1ad"' in convert(
        f'<p><a href="{PUB}/p/sunday-scans-1ad/">x</a></p>')


@pytest.mark.parametrize("href", [
    f"{PUB}/p/sunday-scans-4d1/comments",   # a real one from the archive
    f"{PUB}/subscribe?",
    f"{PUB}/archive",
    "https://whop.com/checkout/plan_x",
    "https://substackcdn.com/image/fetch/x.png",
    "/research/MU",
])
def test_things_that_are_not_a_post_permalink_are_not_marked(href):
    """⛔ `/p/<slug>/comments` especially: it is a DIFFERENT destination, and
    routing it to our reader would answer a question the reader didn't ask.
    (Those links are also broken at the source — several carry last week's
    slug.)"""
    assert "data-post-slug" not in convert(f'<p><a href="{href}">x</a></p>')


def test_marking_does_not_disturb_the_href_or_the_safety_attributes():
    out = convert(f'<p><a href="{PUB}/p/sunday-scans-1ad">x</a></p>')
    assert f'href="{PUB}/p/sunday-scans-1ad"' in out
    assert 'rel="noopener noreferrer"' in out


# ── the rewrite, at read time ────────────────────────────────────────────────

def test_a_link_we_can_serve_is_pointed_at_our_reader():
    html, n = il.rewrite(convert(f'<p><a href="{PUB}/p/sunday-scans-1ad">last week</a></p>'), HELD)
    assert n == 1
    assert 'href="/desk/article/sunday-scans-1ad"' in html
    assert PUB not in html


def test_the_new_link_does_not_open_a_new_tab():
    """An internal route in a new tab is a bug, and rel=noopener on a same-origin
    link is noise."""
    html, _ = il.rewrite(convert(f'<p><a href="{PUB}/p/sunday-scans-1ad">x</a></p>'), HELD)
    anchor = re.search(r"<a[^>]*>", html).group(0)
    assert "target=" not in anchor and "rel=" not in anchor


def test_a_post_we_do_NOT_hold_keeps_working_as_an_outbound_link():
    """Fail SOFT: an unresolvable link must stay a working link to Substack, not
    become a dead internal route."""
    html, n = il.rewrite(convert(f'<p><a href="{PUB}/p/never-fetched">x</a></p>'), HELD)
    assert n == 0
    assert f'href="{PUB}/p/never-fetched"' in html
    assert "/desk/article/never-fetched" not in html


def test_only_the_marked_anchors_move():
    body = (f'<p><a href="{PUB}/p/sunday-scans-1ad">a</a>'
            f'<a href="https://whop.com/x">b</a>'
            f'<a href="{PUB}/p/sunday-scans-4d1/comments">c</a></p>')
    html, n = il.rewrite(convert(body), HELD)
    assert n == 1
    assert "whop.com/x" in html and "sunday-scans-4d1/comments" in html


def test_several_links_in_one_article_all_resolve():
    body = "".join(f'<p><a href="{PUB}/p/{s}">x</a></p>' for s in
                   ["sunday-scans-1ad", "sunday-scans-cd2", "not-held"])
    html, n = il.rewrite(convert(body), HELD)
    assert n == 2
    assert html.count("/desk/article/") == 2


def test_rewriting_is_idempotent():
    once, n1 = il.rewrite(convert(f'<p><a href="{PUB}/p/sunday-scans-1ad">x</a></p>'), HELD)
    twice, n2 = il.rewrite(once, HELD)
    assert twice == once and n2 == 1  # same output; the marker is still there


@pytest.mark.parametrize("slugs", [set(), None])
def test_no_known_slugs_means_nothing_is_touched(slugs):
    src = convert(f'<p><a href="{PUB}/p/sunday-scans-1ad">x</a></p>')
    assert il.rewrite(src, slugs) == (src, 0)


def test_an_empty_body_is_handled():
    assert il.rewrite("", HELD) == ("", 0)
    assert il.rewrite(None, HELD) == ("", 0)


# ── the store only offers slugs it can actually serve ────────────────────────

def test_readable_slugs_excludes_a_post_we_only_hold_a_card_for(tmp_path, monkeypatch):
    """Sending a reader to an article we have no body for is worse than letting
    them go to Substack."""
    monkeypatch.setenv("DESK_DB_PATH", str(tmp_path / "d.db"))
    from api.services import desk_store as ds
    importlib.reload(ds)
    ds._init_db()
    ds.upsert_post({"id": "u1", "title": "T", "url": "u1", "published_at": 1})
    ds.save_post_body("u1", {"body_html": "<p>x</p>", "slug": "has-body"})
    ds.upsert_post({"id": "u2", "title": "T", "url": "u2", "published_at": 2})
    ds.save_post_body("u2", {"body_html": "", "slug": "card-only"})
    assert ds.readable_slugs() == {"has-body"}
