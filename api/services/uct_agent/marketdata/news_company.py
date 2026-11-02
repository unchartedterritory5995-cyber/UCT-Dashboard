"""MD-1 kind `news.company` (owner: agent-md) — contract MD-1 v1.2 §4.

Published news about one company. An adapter over `services/news/store.feed`, the Company Panel's own
SQLite store, whose contract is that a read never contacts a provider. `provider_calls` is always 0.

* Per item `as_of` = its `published_at`. The envelope `as_of` = the newest item's.
* freshness `periodic` (the store is fed by scheduled ingest).
* `stale` is judged on INGEST HEALTH: the newest successful ingest across all news sources
  (`store.health_snapshot()["sources"][].last_ok`) is older than STALE_AFTER_S. It is NOT judged on this
  company's newest item: a quiet company is not stale data. Zero items is `ok`, with an empty list and a
  note. When ingest health is unknown (no source has ever succeeded), `stale` is true and a note says so.
* Fields are metadata only — headline, url, source, class, category, sentiment, time. No body or
  description text.
* The store's first-use schema init (idempotent DDL) is its own behaviour (accepted by agent-lead,
  2026-11-01); this adapter writes nothing.
"""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env

SOURCE = "uct-news"
STALE_AFTER_S = 3600
DEFAULT_LIMIT = 10
MAX_LIMIT = 25
ITEM_FIELDS = ("headline", "url", "source", "source_class", "category", "sentiment", "as_of")
_SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")

NOTE_NO_ITEMS = "no news items are stored for {sym} — that is not a sign of stale data"
NOTE_INGEST_STALE = "news ingest has not succeeded for over an hour; recent stories may be missing"
NOTE_INGEST_UNKNOWN = "news ingest health is unknown; recent stories may be missing"
NOTE_PUBLISHED = "each item's as_of is when it was published; the envelope as_of is the newest item"


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate)."""
    sym = str(params.get("symbol") or "").strip().upper()
    if not _SYMBOL_RE.match(sym):
        return "a valid ticker symbol is required"
    n = params.get("limit", DEFAULT_LIMIT)
    if not isinstance(n, int) or isinstance(n, bool) or n < 1:
        return "`limit` must be a positive whole number"
    return None


def _utc(v: Any) -> Optional[str]:
    if not isinstance(v, str) or not v:
        return None
    try:
        d = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return env.utc_iso(d)


def _epoch(iso: Optional[str]) -> Optional[float]:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() if iso else None


def _ingest_last_ok(store) -> Optional[float]:
    snap = store.health_snapshot(days=1)
    stamps = [_epoch(_utc(s.get("last_ok"))) for s in (snap.get("sources") or []) if isinstance(s, dict)]
    stamps = [s for s in stamps if s]
    return max(stamps) if stamps else None


def read_news_company(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    kind = "news.company"
    why = validate(params)
    if why:
        return env.unavailable(kind, params, SOURCE, why)
    sym = str(params["symbol"]).strip().upper()
    limit = min(params.get("limit", DEFAULT_LIMIT), MAX_LIMIT)

    from api.services.news import store
    try:
        feed = store.feed(sym, limit=limit)
        last_ok = _ingest_last_ok(store)
    except Exception:  # noqa: BLE001 — a store failure is an honest unavailable
        return env.unavailable(kind, params, SOURCE, "the news store could not answer")

    items = []
    for r in (feed.get("items") or [])[:limit]:
        if not isinstance(r, dict):
            continue
        pub = _utc(r.get("published_at"))
        if not pub:
            continue
        items.append({"headline": r.get("headline") or "", "url": r.get("url") or "",
                      "source": r.get("source_display") or r.get("source_name") or "",
                      "source_class": r.get("source_class") or "", "category": r.get("category") or "",
                      "sentiment": r.get("sentiment") or None, "as_of": pub})

    notes: list[str] = []
    if last_ok is None:
        stale = True
        notes.append(NOTE_INGEST_UNKNOWN)
    else:
        stale = (time.time() - last_ok) > STALE_AFTER_S
        if stale:
            notes.append(NOTE_INGEST_STALE)
    if items:
        notes.append(NOTE_PUBLISHED)
        as_of = max(i["as_of"] for i in items)
    else:
        notes.append(NOTE_NO_ITEMS.format(sym=sym))
        as_of = None
    data = {"symbol": sym, "items": items, "has_more": bool(feed.get("has_more"))}
    return env.make_envelope(kind, params, status="ok", freshness="periodic", as_of=as_of, source=SOURCE,
                             data=data, stale=stale, notes=notes, provider_calls=0)
