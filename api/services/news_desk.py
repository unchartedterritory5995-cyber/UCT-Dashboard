"""Research > Depth > News desk (Lane R: D-6, D-7, D-8).

One panel over the company-news store (the same corpus /api/company-news
serves: our own SQLite, ZERO provider calls in the request), carrying up to
three annotations, each behind its OWN flag and present only while that flag
is on:

  versions    D-6  NEWS_STORY_VERSIONS_ENABLED   prior versions held per story
  importance  D-7  NEWS_IMPORTANCE_LABEL_ENABLED High / Normal / Low + reasons
  read        D-8  NEWS_READ_STATE_ENABLED       this member's read time

The panel (and its route) exists while ANY of the three is on.
"""
from __future__ import annotations

import contextlib
from typing import Any

from api.services import news_importance, news_read_state, news_versions

_SNIPPET_CHARS = 320


def any_enabled() -> bool:
    return news_versions.is_enabled() or news_importance.is_enabled() or news_read_state.is_enabled()


def enabled_annotations() -> list[str]:
    out = []
    if news_versions.is_enabled():
        out.append("versions")
    if news_importance.is_enabled():
        out.append("importance")
    if news_read_state.is_enabled():
        out.append("read")
    return out


def _shape(r: dict[str, Any]) -> dict[str, Any]:
    desc = (r.get("description") or "").strip()
    if len(desc) > _SNIPPET_CHARS:
        desc = desc[:_SNIPPET_CHARS].rsplit(" ", 1)[0] + "…"
    return {
        "id": r.get("id"),
        "headline": r.get("headline") or "",
        "description": desc,
        "source": r.get("source_display") or "",
        "source_class": r.get("source_class") or "",
        "url": r.get("url") or "",
        "published_at": r.get("published_at") or "",
        "category": r.get("category") or "other",
        "relevance": r.get("rel") or "",
    }


def desk(sym: str, user_id, *, limit: int = 25, cursor: str | None = None) -> dict[str, Any]:
    from api.services.news import store
    page = store.feed(sym, limit=limit, cursor=cursor)
    rows = page["items"]
    ids = [int(r["id"]) for r in rows]
    ann = enabled_annotations()
    items = [_shape(r) for r in rows]

    if "versions" in ann:
        with contextlib.closing(store._connect()) as c:  # noqa: SLF001
            counts = news_versions.version_counts(c, ids)
        for it in items:
            it["prior_versions"] = counts.get(int(it["id"]), 0)
    if "importance" in ann:
        outlets = news_importance.outlet_counts([r.get("event_key") or "" for r in rows])
        for it, r in zip(items, rows):
            it["importance"] = news_importance.classify(r, outlets.get(r.get("event_key") or "", 1))
    if "read" in ann:
        read = news_read_state.read_among(user_id, ids)
        for it in items:
            it["read_at"] = read.get(int(it["id"]))   # None = unread

    out: dict[str, Any] = {
        "symbol": sym,
        "items": items,
        "next_cursor": page["next_cursor"],
        "has_more": page["has_more"],
        "annotations": ann,
        "source": "UCT company-news store (FMP news, SEC EDGAR, curated X); no provider is called to answer this",
    }
    if "importance" in ann:
        out["importance_rules"] = news_importance.RULES
    if "versions" in ann:
        out["retraction"] = dict(news_versions.RETRACTION_STATEMENT)
    return out
