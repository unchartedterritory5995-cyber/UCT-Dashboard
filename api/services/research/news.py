"""Company news for the research page (A8, News/Intelligence Slice 1).

2026-09-04 (owner-authorized narrow slice -- CURATED / SECURITY-SCOPED
FIRST, per the readiness review + the two 2026-09-04 owner decisions).
Canonicalizes the company-news half of what was previously inline in
`api/routers/research.py`'s legacy `/api/research/news/{sym}` route (left
byte-for-byte untouched -- it still powers the calendar modal's own
NewsSection.jsx; COMPATIBILITY BRIDGE, not migrated this slice) behind S3
entity resolution, D1 typed FMP access, and S8 provenance/freshness -- the
same pattern already applied to Financials, Estimates, Analyst Ratings,
Ownership, Ratings, Calls & Transcript, and Filings.

FMP ONLY (owner decision 2, 2026-09-04). Polygon/Massive is an explicit,
named, sequenced follow-on -- do not add it here. No sentiment field:
FMP carries none genuinely, and fabricating one the way engine.py's
market-wide pipeline does for its own unrelated purpose would misrepresent
"no signal" as a real reading on a per-security tab where every article
would wear the identical fake badge. No AI synthesis, no market-wide feed,
no personalization -- see the readiness review's non-goals list.
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime
from typing import Optional

from api.services import fmp_client
from api.services.cache import cache
from api.services.cache_policy import set_by_completeness
from api.services.research.entity_resolution import resolve_entity

_logger = logging.getLogger(__name__)

_CACHE_TTL = 900   # 15 min -- matches the legacy route's own cadence
_FAIL_TTL = 120    # a provider blip self-heals fast, never held 15 min
_MAX_ITEMS = 40


def _fmp_rows_with_meta(fn, ticker: str, **kwargs) -> tuple[list, Optional[dict]]:
    """Same 'never raises, (rows, meta)' contract as analyst_grades.py's
    identically-named helper -- copied locally (module-private there too)
    rather than shared, until a third caller justifies promoting it. One
    provenance/freshness envelope for the WHOLE leg, never per-article --
    matches every other list-shaped leg's S8 treatment this session."""
    try:
        result = fn(ticker, **kwargs)
    except Exception:
        return [], None
    rows = result.value if isinstance(result.value, list) else []
    if not rows:
        return [], None
    meta = {
        "vendor": result.provenance.vendor,
        "sourceActivity": result.provenance.source_activity,
        "fetchedAt": result.provenance.fetched_at,
        "sourceObservedAt": result.provenance.source_observed_at,
        "tieBreak": result.provenance.tie_break,
        "freshnessClass": result.freshness,
        "licensingClass": result.licensing_class,
        "degraded": result.degraded,
    }
    return rows, meta


def _published_at(raw: Optional[str]) -> Optional[str]:
    """FMP's `publishedDate` is an ET wall-clock string
    ("YYYY-MM-DD HH:MM:SS", live-verified 2026-08-05 per
    docs/superpowers/plans/2026-08-05-data-dependability-migration.md) --
    preserved AS-IS, never reinterpreted as UTC/naive (the exact FMP-
    timestamp trap CLAUDE.md's Bars Correctness Layer section already
    documents for intraday bars). Returns None -- honestly unknown, never a
    fetch-time substitute -- for anything missing or not shaped like that
    string, rather than passing through unparseable junk."""
    s = (raw or "").strip()
    if not s:
        return None
    try:
        datetime.strptime(s, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None
    return s


def _article_id(url: Optional[str], title: str, published_at: Optional[str]) -> str:
    """A stable per-article identity FMP itself doesn't supply. URL first --
    already a real unique key, same precedent `catalyst/news_store.py` uses
    for its own persistence layer -- a title+date hash only for the rare
    row with no URL at all."""
    if url:
        return url
    basis = f"{title}|{published_at or ''}"
    return "nourl:" + hashlib.sha1(basis.encode("utf-8")).hexdigest()[:16]


def _item(row: dict, kind: str) -> Optional[dict]:
    title = (row.get("title") or "").strip()
    if not title:
        return None
    url = row.get("url") or None
    published_at = _published_at(row.get("publishedDate"))
    return {
        "id":           _article_id(url, title, published_at),
        "kind":         kind,   # "news" | "release"
        "headline":     title,
        # FMP truncates this to the lede -- enough for a preview line and
        # explicitly NOT presented as the article (same posture the legacy
        # route already shipped).
        "summary":      (row.get("text") or "")[:280],
        "publisher":    row.get("publisher") or row.get("site") or None,
        "url":          url,
        "published_at": published_at,
        "image":        row.get("image") or None,
    }


def _articles(fmp_symbol: str, limit: int) -> tuple[list, Optional[dict], bool]:
    """Both FMP legs, fetched concurrently, merged into one chronological
    feed. Exact-identity dedup -- URL match, or the same title+date hash
    for a URL-less row -- BEFORE the cap, mirroring analyst_grades.py's
    `_recent_actions` discipline exactly ("collapse an EXACT repeat, never
    a broader identity guess"). `news` rows are processed before `release`
    so a story appearing in both legs keeps the wire-coverage `kind` badge
    -- the same "first-listed leg wins ties" precedent engine.py's own
    market-wide dedup already uses.

    Returns `(items, meta, all_answered)`. `all_answered` is False only
    when a leg raised OUTSIDE `_fmp_rows_with_meta`'s own never-raising
    contract -- a genuine, unexpected fault, not an ordinary "no coverage"
    -- the same defense-in-depth distinction analyst_grades.py's four-leg
    fan-out already makes, kept here for cache-TTL parity.
    """
    from concurrent.futures import ThreadPoolExecutor

    legs = (("news", fmp_client.get_news_stock), ("release", fmp_client.get_news_press_releases))
    got: dict[str, tuple[list, Optional[dict]]] = {}
    all_answered = True
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="news") as ex:
        futures = {kind: ex.submit(_fmp_rows_with_meta, fn, fmp_symbol, limit=limit) for kind, fn in legs}
        for kind, fut in futures.items():
            try:
                got[kind] = fut.result()
            except Exception:
                got[kind] = ([], None)
                all_answered = False

    seen: set[str] = set()
    out: list[dict] = []
    for kind in ("news", "release"):
        rows, _ = got[kind]
        for row in rows:
            if not isinstance(row, dict):
                continue
            item = _item(row, kind)
            if item is None or item["id"] in seen:
                continue
            seen.add(item["id"])
            out.append(item)

    # Both endpoints return the same "YYYY-MM-DD HH:MM:SS" shape, so a raw
    # string sort IS the date sort -- no parsing needed (matches the legacy
    # route's own proven approach). A missing/malformed published_at sorts
    # last (empty string), never masquerading as "most recent".
    out.sort(key=lambda x: x["published_at"] or "", reverse=True)

    stock_meta = got["news"][1]
    pr_meta = got["release"][1]
    meta = stock_meta or pr_meta
    if stock_meta and pr_meta:
        # Both legs answered -- report the LATER fetch as the envelope's own
        # fetchedAt so the freshness badge reflects the freshest of the two
        # calls, not an arbitrary pick.
        meta = stock_meta if (stock_meta.get("fetchedAt") or 0) >= (pr_meta.get("fetchedAt") or 0) else pr_meta

    return out[:limit], meta, all_answered


def get_company_news(sym: str) -> dict:
    """Canonical company-news payload for `sym` -- the honest empty shape
    on a blank symbol, never raises."""
    sym = (sym or "").upper().strip()
    if not sym:
        return {"sym": sym, "entity": None, "items": [], "_meta": None}

    ck = f"research_company_news::{sym}"
    cached = cache.get(ck)
    if cached is not None:
        return cached

    # S3: resolve canonical identity before any FMP call, on the vendor="fmp"
    # leg (mirrors analyst_grades.py exactly) -- a renamed/reused/dual-class
    # ticker (e.g. BRK-B) hits FMP under its real vendor symbol.
    entity, fmp_symbol = resolve_entity(sym, vendor="fmp")
    items, meta, all_answered = _articles(fmp_symbol, _MAX_ITEMS)

    out = {"sym": sym, "entity": entity, "items": items, "_meta": meta}
    set_by_completeness(ck, out, complete=all_answered, ttl_ok=_CACHE_TTL, ttl_partial=_FAIL_TTL)
    return out
