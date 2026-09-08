"""Central ingestion — the one place stories enter UCT.

    SOURCES -> NORMALIZE -> CLASSIFY SOURCE -> JUNK -> DEDUPE
            -> SUBJECT vs MENTION -> RELEVANCE -> CATEGORY/SENTIMENT -> STORE

Runs on a schedule, globally, for everyone. A user opening MU -> News reads the
store and contacts nothing (§5). Every stage records counters so §43 can show
what the filters actually removed.
"""

from __future__ import annotations

import logging
import os
import threading
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from api.services.news import canonical, dedupe, filters, sentiment as senti
from api.services.news import sources as news_sources
from api.services.news import store, subject as subj
from api.services.news.adapters import fmp_news, sec_news, x_news

_log = logging.getLogger(__name__)

_RUN_LOCK = threading.Lock()

# Per-cycle ceilings. Ingestion aborts rather than exceeding them (§6).
POLL_BUDGET = int(os.environ.get("NEWS_POLL_BUDGET", "40"))
BACKFILL_BUDGET = int(os.environ.get("NEWS_BACKFILL_BUDGET", "400"))
FALLBACK_SYMBOLS_PER_CYCLE = int(os.environ.get("NEWS_FALLBACK_SYMBOLS", "60"))

# An image URL reused this many times by one publisher is house art, not story
# art. Measured: GlobeNewswire ran 50.5% house art, Motley Fool 3.9%.
HOUSE_ART_MIN = int(os.environ.get("NEWS_HOUSE_ART_MIN", "4"))

_image_seen: Counter[tuple[str, str]] = Counter()
_image_lock = threading.Lock()


def _house_art(publisher: str, image_url: str) -> bool:
    if not image_url:
        return False
    key = (publisher or "?", image_url)
    with _image_lock:
        _image_seen[key] += 1
        n = _image_seen[key]
        if len(_image_seen) > 40000:
            for k, v in list(_image_seen.items()):
                if v < 2:
                    del _image_seen[k]
    return n >= HOUSE_ART_MIN


def _utc(dt: datetime | None) -> str:
    if not dt:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
def process(raw: dict, *, stats: Counter | None = None) -> int | None:
    """Run one raw item through every stage and persist it. Returns row id.

    Rejected items are STORED with a reason rather than dropped, so the reject
    mix is measurable and the thresholds can be tuned against real data.
    """
    st = stats if stats is not None else Counter()
    provider = raw.get("provider") or "?"
    title = (raw.get("title") or "").strip()
    published = raw.get("published_at")
    if not title or not isinstance(published, datetime):
        st["skipped_malformed"] += 1
        return None

    # --- source classification -------------------------------------------
    src_class, src_display = news_sources.classify(
        raw.get("publisher") or "", provider=provider)
    st[f"class_{src_class}"] += 1
    if src_class == news_sources.CLASS_UNKNOWN and raw.get("publisher"):
        store.bump(provider, "unknown_publisher", 1, raw.get("publisher") or "")

    # --- junk ------------------------------------------------------------
    reject = filters.reject_reason(title, source_class=src_class)
    if not reject and not news_sources.is_displayable(src_class):
        reject = filters.REJECT_SOURCE
    if reject:
        st[f"reject_{reject}"] += 1

    # --- canonicalization -------------------------------------------------
    url = raw.get("url") or ""
    canon = canonical.canonical_url(url)

    # --- subject vs mention, per tagged ticker ----------------------------
    tags = [t.upper() for t in (raw.get("tags") or []) if t]
    body = raw.get("body") or ""
    links: list[dict[str, str]] = []
    best_rel = "unknown"
    for sym in dict.fromkeys(tags):
        sc = subj.classify_subject(
            sym, title, body, provider_tags=tags, provider=provider,
            cik_match=bool(raw.get("cik_match")))
        rel = subj.relevance_for(sc, source_class=src_class, tag_count=len(tags))
        links.append({"ticker": sym, "relevance": rel, "subject": sc})
        if rel == "direct":
            best_rel = "direct"
        elif rel == "related" and best_rel != "direct":
            best_rel = "related"
        elif best_rel == "unknown":
            best_rel = rel
        st[f"subject_{sc}"] += 1

    if not links:
        st["reject_no_ticker"] += 1
        reject = reject or filters.REJECT_NO_TICKER
    elif not reject and best_rel not in ("direct", "related"):
        # Nothing this story is actually about. Store for analytics; never show.
        reject = filters.REJECT_MENTION
        st[f"reject_{reject}"] += 1

    # --- category + sentiment --------------------------------------------
    category = filters.categorize(title, form_type=raw.get("form_type") or "",
                                  provider=provider)
    sent, sent_reason = ("", "")
    if not reject:
        sent, sent_reason = senti.classify(title, body, category=category)
        if sent:
            st[f"sentiment_{sent}"] += 1

    # --- media ------------------------------------------------------------
    image = raw.get("image") or ""
    is_house = _house_art(src_display, image) if image else False
    media_type = raw.get("media_type") or ("image" if image and not is_house else "")

    item = {
        "provider": provider,
        "provider_id": raw.get("provider_id") or canon or title[:200],
        "source_name": raw.get("publisher") or "",
        "source_display": src_display,
        "source_class": src_class,
        "url": canonical.display_url(url),
        "canonical_url": canon,
        "headline": title,
        "headline_key": dedupe.headline_key(title),
        "description": body[:1200],
        "author": raw.get("author") or "",
        "published_at": _utc(published),
        "updated_at": "",
        "ingested_at": _utc(datetime.now(timezone.utc)),
        "category": category,
        "sentiment": sent,
        "sentiment_reason": sent_reason,
        "image_url": "" if is_house else image,
        "image_is_house": is_house,
        "media_type": media_type,
        "embed_url": raw.get("embed_url") or "",
        "form_type": raw.get("form_type") or "",
        "event_key": "",
        "is_primary": True,
        "reject_reason": reject or "",
        "raw_ref": raw.get("lane") or "",
    }

    nid = store.upsert(item, links)
    if reject:
        store.bump(provider, "rejected", 1, reject)
    else:
        store.bump(provider, "accepted", 1, src_class)
        st["accepted"] += 1
        _cluster(nid, item, {l["ticker"] for l in links if l["relevance"] == "direct"})
    return nid


def _cluster(nid: int, item: dict, tickers: set[str]) -> None:
    """Attach this story to an event and pick the version that owns the slot.

    A duplicate is hidden; genuinely distinct reporting on the same event stays
    stored and reachable from the expanded row as related coverage (§9).
    """
    if not nid or not tickers:
        return
    try:
        published = datetime.fromisoformat(item["published_at"])
    except (ValueError, KeyError):
        return
    try:
        candidates = store.find_cluster_candidates(tickers, published)
    except Exception as e:                            # noqa: BLE001
        _log.debug("cluster lookup failed: %s", e)
        return

    # ⛔ Only cluster ACROSS sources. Clustering exists to merge one event
    # reported by several outlets; two items from the SAME source are two
    # stories, never duplicates of each other. Without this, Alibaba's four
    # separate 6-K filings in one week collapsed into one row, because the
    # honest generated headline for a 6-K with no item codes is necessarily
    # identical every time. Genuine repeats are already caught upstream by
    # the (provider, provider_id) upsert.
    mine = (item.get("source_display") or "", item.get("provider") or "")
    group = [c for c in candidates
             if c["id"] != nid
             and (c.get("source_display") or "", c.get("provider") or "") != mine
             and dedupe.same_event(item["headline"], published, tickers,
                                   c["headline"], _parse(c["published_at"]), tickers)]
    if not group:
        return
    members = group + [{**item, "id": nid}]
    for m in members:
        if isinstance(m.get("published_at"), str):
            m["published_at"] = _parse(m["published_at"]) or datetime.max.replace(
                tzinfo=timezone.utc)
    key = group[0].get("event_key") or dedupe.event_key(
        item["headline"], published, tickers)
    primary = dedupe.pick_primary(members)
    if primary:
        store.set_event([int(m["id"]) for m in members], key, int(primary["id"]))
        store.bump("dedupe", "clustered", len(members) - 1)


def _parse(s: str) -> datetime | None:
    try:
        d = datetime.fromisoformat(s)
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# cycles
# ---------------------------------------------------------------------------
def _universe_all() -> list[str]:
    """The full symbol list the sweep should eventually cover, ordered stably.

    ⛔ `api.services.universe` DOES NOT EXIST. This function used to try three
    attribute names on that phantom module, fail the import every time, and fall
    through to "symbols we already have news for" -- which made coverage
    self-reinforcing: a ticker with no rows was never polled, so it never got
    rows. LITE held zero items for exactly this reason.
    """
    for mod, attr in (("api.services.cap_universe", "symbols"),
                      ("api.services.bars_universe_crawler", "load_universe")):
        try:
            m = __import__(mod, fromlist=["*"])
            f = getattr(m, attr, None)
            syms = sorted({str(s).upper() for s in (f() or [])}) if callable(f) else []
            if syms:
                return syms
        except Exception:                             # noqa: BLE001
            continue
    # Last resort: what our own store already tracks. Note this CANNOT discover
    # a new ticker -- it is a degraded mode, not the intended path.
    try:
        import contextlib as _c
        with _c.closing(store._connect()) as c:      # noqa: SLF001
            rows = c.execute(
                "SELECT ticker FROM news_tickers GROUP BY ticker "
                "ORDER BY COUNT(*) DESC").fetchall()
            return [r["ticker"] for r in rows]
    except Exception:                                 # noqa: BLE001
        return []


def _active_universe(limit: int, *, rotate: str = "") -> list[str]:
    """Symbols to poll this cycle. Bounded by construction.

    With `rotate`, returns a MOVING window over the whole universe, persisting
    the offset under that job name so the sweep continues across restarts and
    every symbol comes up in turn. Without it, the head of the list -- which is
    what the metered FMP fallback wants, since it is a cost ceiling rather than
    a coverage sweep.
    """
    full = _universe_all()
    if not full:
        return []
    limit = max(1, min(int(limit or 1), len(full)))
    if not rotate:
        return full[:limit]

    try:
        state = store.get_backfill(rotate) or {}
        off = int(str(state.get("cursor") or "0") or 0) % len(full)
    except Exception:                                 # noqa: BLE001
        off = 0
    window = [full[(off + i) % len(full)] for i in range(limit)]
    try:
        store.set_backfill(rotate, str((off + limit) % len(full)),
                           note=f"{len(full)} symbols")
    except Exception:                                 # noqa: BLE001
        pass
    return window


def run_fmp_cycle(*, budget: int | None = None) -> dict[str, Any]:
    """One scheduled FMP pull. Global-latest preferred, bounded fallback."""
    b = fmp_news.RequestBudget(budget or POLL_BUDGET, "fmp-poll")
    stats: Counter = Counter()
    result: dict[str, Any] = {"mode": "", "items": 0, "requests": 0}
    since = datetime.now(timezone.utc) - timedelta(hours=6)

    support = fmp_news.probe_latest(b)
    result["latest_support"] = support

    raws: list[dict] = []
    try:
        if support.get("press") or support.get("stock"):
            result["mode"] = "global-latest"
            for lane, ok in (("press", support.get("press")),
                             ("stock", support.get("stock"))):
                if not ok:
                    continue
                raws.extend(fmp_news.fetch_latest(lane, pages=2, budget=b,
                                                  since=since))
        else:
            result["mode"] = "per-symbol-fallback"
            syms = _active_universe(FALLBACK_SYMBOLS_PER_CYCLE)
            for lane in ("press", "stock"):
                raws.extend(fmp_news.fetch_symbols(syms, lane, budget=b, limit=100))
        store.record_health("fmp", ok=True)
    except fmp_news.FmpUnavailable as e:
        _log.warning("fmp cycle: %s", e)
        store.record_health("fmp", ok=False, error=str(e))
        result["error"] = str(e)
    except Exception as e:                            # noqa: BLE001
        _log.exception("fmp cycle failed")
        store.record_health("fmp", ok=False, error=f"{type(e).__name__}: {e}")
        result["error"] = str(e)

    newest = ""
    for raw in raws:
        process(raw, stats=stats)
        iso = _utc(raw.get("published_at"))
        if iso > newest:
            newest = iso
    if newest:
        store.record_health("fmp", ok=True, last_item_at=newest)

    result["items"] = len(raws)
    result["requests"] = b.used
    result["stats"] = dict(stats)
    return result


def run_sec_cycle(symbols: Iterable[str], *, per_symbol: int = 20) -> dict[str, Any]:
    stats: Counter = Counter()
    n = 0
    newest = ""
    syms = list(symbols)
    for sym in syms:
        for raw in sec_news.fetch(sym, count=per_symbol):
            process(raw, stats=stats)
            n += 1
            iso = _utc(raw.get("published_at"))
            if iso > newest:
                newest = iso
    store.record_health("sec", ok=True, last_item_at=newest)
    return {"symbols": len(syms), "items": n, "stats": dict(stats)}


def run_x_cycle(symbols: Iterable[str], *, hours: int = 72) -> dict[str, Any]:
    stats: Counter = Counter()
    n = 0
    newest = ""
    syms = list(symbols)
    for sym in syms:
        for raw in x_news.fetch(sym, hours=hours):
            process(raw, stats=stats)
            n += 1
            iso = _utc(raw.get("published_at"))
            if iso > newest:
                newest = iso
    store.record_health("x", ok=True, last_item_at=newest)
    return {"symbols": len(syms), "items": n, "stats": dict(stats)}


def ensure_symbol(symbol: str, *, max_age_minutes: int = 180) -> dict[str, Any]:
    """Warm one symbol from the FREE, per-company sources only.

    ⚠️ Called from a scheduled warmer and from the admin route -- never from
    the read path. SEC and the local tweet store are both free and per-company,
    so warming a newly-viewed ticker costs nothing metered. FMP is deliberately
    NOT here: it is ingested globally.
    """
    sym = (symbol or "").upper().strip()
    if not sym:
        return {"symbol": "", "skipped": "no symbol"}
    out: dict[str, Any] = {"symbol": sym}
    try:
        out["sec"] = run_sec_cycle([sym])
    except Exception as e:                            # noqa: BLE001
        out["sec_error"] = str(e)
    try:
        out["x"] = run_x_cycle([sym])
    except Exception as e:                            # noqa: BLE001
        out["x_error"] = str(e)
    return out


def run_backfill(symbols: Iterable[str], *, years: int = 2,
                 budget: int | None = None, job: str = "fmp-2y") -> dict[str, Any]:
    """Bounded, resumable, idempotent historical backfill (§17).

    Walks 90-day windows backwards per symbol. State is persisted after every
    symbol so a restart resumes rather than repeating, and upsert on
    (provider, provider_id) makes a repeat harmless anyway.
    """
    b = fmp_news.RequestBudget(budget or BACKFILL_BUDGET, "fmp-backfill")
    state = store.get_backfill(job) or {}
    done_syms = set((state.get("cursor") or "").split(",")) - {""}
    stats: Counter = Counter()
    processed = 0
    syms = [s.upper() for s in symbols if s]

    for sym in syms:
        if sym in done_syms:
            continue
        if b.remaining <= 2:
            break
        end = datetime.now(timezone.utc).date()
        start = end - timedelta(days=365 * years)
        cursor = end
        try:
            while cursor > start and b.remaining > 0:
                win_start = max(start, cursor - timedelta(days=90))
                for lane in ("press", "stock"):
                    if b.remaining <= 0:
                        break
                    rows = fmp_news.fetch_symbol(
                        sym, lane, frm=win_start.isoformat(),
                        to=cursor.isoformat(), budget=b)
                    for raw in rows:
                        process(raw, stats=stats)
                        processed += 1
                cursor = win_start
        except fmp_news.FmpUnavailable as e:
            store.set_backfill(job, ",".join(sorted(done_syms)),
                               requests=b.used, note=str(e)[:150])
            return {"job": job, "stopped": str(e), "symbols_done": len(done_syms),
                    "items": processed, "requests": b.used, "stats": dict(stats)}
        done_syms.add(sym)
        store.set_backfill(job, ",".join(sorted(done_syms)), requests=b.used)

    complete = all(s in done_syms for s in syms)
    store.set_backfill(job, ",".join(sorted(done_syms)), done=complete,
                       note="complete" if complete else "partial")
    return {"job": job, "symbols_done": len(done_syms), "symbols_total": len(syms),
            "items": processed, "requests": b.used, "complete": complete,
            "stats": dict(stats)}


def run_all(symbols: Iterable[str] | None = None) -> dict[str, Any]:
    """One full cycle. Non-reentrant: a slow run never stacks on itself."""
    if not _RUN_LOCK.acquire(blocking=False):
        return {"skipped": "already running"}
    try:
        syms = list(symbols or _active_universe(FALLBACK_SYMBOLS_PER_CYCLE))
        out = {"fmp": run_fmp_cycle()}
        if syms:
            out["sec"] = run_sec_cycle(syms[:40])
            out["x"] = run_x_cycle(syms[:80])
        return out
    finally:
        _RUN_LOCK.release()


def recheck_rejects() -> dict[str, Any]:
    """Re-apply today's reject rules to everything already stored.

    Run after changing a filter rule. Reuses the EXACT two-step decision
    process() makes -- the headline rules first, then the displayable-source
    check -- so a recheck can never disagree with fresh ingestion.
    """
    def rule(headline: str, source_class: str) -> str:
        reason = filters.reject_reason(headline, source_class=source_class)
        if not reason and not news_sources.is_displayable(source_class):
            reason = filters.REJECT_SOURCE
        return reason or ""

    return store.recheck_rejects(rule)
