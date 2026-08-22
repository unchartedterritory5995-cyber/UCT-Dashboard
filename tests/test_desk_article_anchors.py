"""Anchor closes: the daily close on/before an issue's publish moment.

Load-bearing rules:
  1. the anchor date is the publish moment in ET, not UTC — a Sunday-evening
     letter anchors to Friday's close on both sides of midnight UTC,
  2. a ticker the bars store doesn't hold is OMITTED, never guessed,
  3. the endpoint is a bonus rail — a bars blow-up returns {}, never a 500.
"""
from __future__ import annotations

import importlib
import json

import pytest

# Sun, 16 Aug 2026 17:52:54 GMT = 13:52 ET Sunday.
PUBLISHED_AT = 1786902774
SUNDAY_KEY = 20260816


@pytest.fixture()
def anchors_mod():
    from api.services import desk_article_anchors as mod
    importlib.reload(mod)
    mod._anchors_cached.cache_clear()
    return mod


def test_the_anchor_date_is_the_publish_moment_in_et(anchors_mod):
    assert anchors_mod._date_key(PUBLISHED_AT) == SUNDAY_KEY
    # 23:30 UTC Sunday is 19:30 ET Sunday — still Sunday, not Monday.
    assert anchors_mod._date_key(1786923000) == SUNDAY_KEY


def test_anchors_come_from_the_store_at_or_before_the_key(anchors_mod, monkeypatch):
    calls = []

    def fake_get_bars_before(sym, tf, max_bars, to_key):
        calls.append((sym, tf, max_bars, to_key))
        closes = {"INTC": 103.5, "MU": 1011.75}
        if sym in closes:
            return [(20260814, 1, 2, 0.5, closes[sym], 1000)]
        return []

    monkeypatch.setattr(anchors_mod.bars_sqlite, "get_bars_before", fake_get_bars_before)
    post = {"published_at": PUBLISHED_AT,
            "tickers_json": json.dumps(["INTC", "MU", "UNKNOWN"])}
    got = anchors_mod.anchors_for(post)
    assert got == {"INTC": 103.5, "MU": 1011.75}          # UNKNOWN omitted, not guessed
    assert all(c[1] == "D" and c[2] == 1 and c[3] == SUNDAY_KEY for c in calls)


def test_junk_rows_and_bars_errors_fail_soft(anchors_mod, monkeypatch):
    def exploding(*_a, **_k):
        raise RuntimeError("bars store down")
    monkeypatch.setattr(anchors_mod.bars_sqlite, "get_bars_before", exploding)
    assert anchors_mod.anchors_for(
        {"published_at": PUBLISHED_AT, "tickers_json": json.dumps(["INTC"])}) == {}
    assert anchors_mod.anchors_for({"published_at": PUBLISHED_AT,
                                    "tickers_json": "not json"}) == {}
    assert anchors_mod.anchors_for({"published_at": None, "tickers_json": "[]"}) == {}


def test_a_zero_or_negative_close_is_never_an_anchor(anchors_mod, monkeypatch):
    monkeypatch.setattr(anchors_mod.bars_sqlite, "get_bars_before",
                        lambda *a, **k: [(20260814, 1, 2, 0.5, 0.0, 10)])
    assert anchors_mod.anchors_for(
        {"published_at": PUBLISHED_AT, "tickers_json": json.dumps(["INTC"])}) == {}


def test_the_endpoint_serves_anchors_and_404s_unknown_slugs(tmp_path, monkeypatch):
    monkeypatch.setenv("DESK_DB_PATH", str(tmp_path / "desk.db"))
    from api.services import desk_store as ds
    importlib.reload(ds)
    ds._init_db()
    ds.upsert_post({"id": "u1", "title": "SUNDAY SCANS", "url": "u1",
                    "published_at": PUBLISHED_AT})
    ds.save_post_body("u1", {"body_html": "<p>x</p>", "slug": "s1",
                             "tickers_json": json.dumps(["INTC"])})

    from api.routers import desk as desk_router
    monkeypatch.setattr(desk_router, "desk_store", ds)
    from api.services import desk_article_anchors
    desk_article_anchors._anchors_cached.cache_clear()
    monkeypatch.setattr(desk_article_anchors.bars_sqlite, "get_bars_before",
                        lambda *a, **k: [(20260814, 1, 2, 0.5, 103.5, 10)])

    assert desk_router.article_anchors("s1", _user={"id": 1}) == {
        "anchors": {"INTC": 103.5}}

    from fastapi import HTTPException
    with pytest.raises(HTTPException):
        desk_router.article_anchors("no-such-slug", _user={"id": 1})
