"""Earnings intelligence router — call recap, sentiment, webcast, audio, rating changes,
and verbatim AV transcripts.

GET /api/earnings/call-recap/{ticker}   → call recap (24h cache, cost-guarded)
GET /api/earnings/sentiment/{ticker}    → AI sentiment (12h cache, cost-guarded)
GET /api/earnings/audio/{ticker}        → pluggable audio (env-gated)
GET /api/earnings/transcript/{ticker}   → verbatim transcript via AlphaVantage (lazy, cached)

🔴 PAID since 2026-08-09 (every route here that had a session dependency). All of
them were `get_current_user` only — a session, never a plan — and signup is open
and free.

Two independent reasons, and either alone is sufficient:

1. **It spends.** `call-recap` is an Opus + Perplexity call, `sentiment` is an
   LLM read, and `transcript` runs off the **AlphaVantage 25-calls-a-day** free
   budget the whole product shares. The caches are cost guards, not gates: they
   bound the *repeat* price of a question, never who is allowed to ask a new one.
2. **It is the firm's read**, not a relay — the recap's guidance extraction,
   the sentiment score with its drivers, the rating-change roll-up.

Every consumer is a paid surface: `components/calendar/*` and
`pages/calendar/MyStocksHub.jsx` (Calendar is paid — `AuthGuard` bounces a free
member off `/calendar`), `pages/research/tabs/CallsTab.jsx` (`/research/:sym`
renders `PaywallTeaser` for a free member, which fetches nothing), and
`pages/journal-2-0/**`. Nothing on `/morning-wire` touches this router.

✋ `GET /api/earnings/audio/{ticker}` and `GET /api/admin/call-recap-status` are
left as they are: both are *anonymous* (no session dependency at all), so they
belong to the no-dependency bucket, not the `get_current_user` bucket this task
was scoped to close. Reported rather than swept.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, Response

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.call_recap import (
    get_call_recap_with_status,
    get_sentiment,
    get_webcast_url,
    get_rating_changes,
)
from api.services.earnings_audio import get_audio
from api.services.av_transcripts import get_transcript
from api.services.fmp_transcripts import (
    get_transcript as get_fmp_transcript,
    list_quarters as list_fmp_quarters,
)
from api.services.analyst_grades import get_analyst_grades

_log = logging.getLogger(__name__)
router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for earnings intelligence.

    ⛔ Defined HERE, never imported from a sibling — each router owns its own
    402 sentence so "which surface refused me" is readable off the message.
    Rail: `tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…`

    The three `keyword-alerts` routes are gated with the rest deliberately, even
    though they are a per-user store. What they subscribe to is the transcript
    feed above, which is now paid — leaving the subscription open would enroll
    free accounts in a delivery pipeline whose content they cannot read, and the
    scan that fires them reads the same AlphaVantage budget.
    """
    if not is_paid_user(user):
        raise HTTPException(status_code=402,
                            detail="Earnings intelligence requires a paid plan")
    return user


@router.get("/api/earnings/call-recap/{ticker}")
def call_recap_endpoint(
    ticker: str,
    quarter: Optional[str] = Query(default=None, description="e.g. 2026Q3; omit for latest"),
    user: dict = Depends(require_paid),
):
    """AI-synthesized earnings call recap.

    Returns {headline, sentiment, bullets[], quotes[], guidance, qa_highlights[]}
    or null when no data is available.
    Cached 24h. Cost-guarded (reuses catalyst daily cap).
    """
    sym = (ticker or "").upper().strip()
    if not sym:
        return None
    try:
        recap, recap_status = get_call_recap_with_status(
            sym, quarter=quarter or None)
        # A warmed recap carries these already. Calling the providers anyway is
        # what kept the endpoint at ~4.5s despite the recap itself being a ~1ms
        # point-read — the store read was instant, the RESPONSE was not.
        if recap and "webcast_url" in recap:
            webcast = recap.get("webcast_url")
            ratings = recap.get("rating_changes") or []
        else:
            webcast = get_webcast_url(sym)
            ratings = get_rating_changes(sym)
        return {
            "ticker": sym,
            "recap": recap,
            "recap_status": recap_status,
            "webcast_url": webcast,
            "rating_changes": ratings,
        }
    except Exception as e:
        _log.warning("[earnings_intel] call-recap failed for %s: %s", sym, e)
        return {"ticker": sym, "recap": None, "recap_status": "unavailable",
                "webcast_url": None, "rating_changes": []}


@router.get("/api/earnings/audio/{ticker}")
def audio_endpoint(ticker: str):
    """Pluggable earnings-call audio.

    Returns {stream_url, kind: 'live'|'recorded', transcript_url} when a
    provider is configured (EARNINGS_AUDIO_PROVIDER env), otherwise null.
    Never raises.
    """
    sym = (ticker or "").upper().strip()
    if not sym:
        return None
    try:
        return get_audio(sym)
    except Exception as e:
        _log.warning("[earnings_intel] audio failed for %s: %s", sym, e)
        return None


@router.get("/api/earnings/sentiment/{ticker}")
def sentiment_endpoint(ticker: str, user: dict = Depends(require_paid)):
    """AI-derived earnings sentiment.

    Returns {score: int(-100..100), label, rationale, drivers[]}
    or null when unavailable.
    Cached 12h. Cost-guarded.
    """
    sym = (ticker or "").upper().strip()
    if not sym:
        return None
    try:
        return get_sentiment(sym)
    except Exception as e:
        _log.warning("[earnings_intel] sentiment failed for %s: %s", sym, e)
        return None


def _with_qa_boundary(res):
    """Attach where prepared remarks end, when the transcript actually says.

    Derived, not guessed: three of seven live transcripts (DIS, MSFT, JPM) carry
    no question-and-answer phrasing at all, so this is None for them and the UI
    simply omits the chip rather than pointing at an invented boundary.
    """
    if not res or not res.get("segments"):
        return res
    try:
        from api.services.call_recap_grounded import prepared_remarks_end
        res["prepared_remarks_end"] = prepared_remarks_end(res["segments"])
    except Exception:
        res["prepared_remarks_end"] = None
    return res


@router.get("/api/earnings/transcript/{ticker}")
def transcript_endpoint(
    ticker: str,
    quarter: Optional[str] = Query(default=None, description="e.g. 2025Q1; omit to auto-resolve latest"),
    user: dict = Depends(require_paid),
):
    """Verbatim earnings call transcript.

    Primary source = FMP (Ultimate plan): unlimited, 83+ quarters of history,
    cached 30d. Falls back to AlphaVantage (lazy, 25 req/day, cached 24h) only
    when FMP has no transcript for the ticker/quarter.

    Returns:
        {symbol, quarter, segments: [{speaker, title, content, sentiment}], resolved}
        or null when unavailable.
    Never raises.
    """
    sym = (ticker or "").upper().strip()
    if not sym:
        return None
    # FMP first — uncapped on Ultimate, so no quota discipline needed.
    try:
        res = get_fmp_transcript(sym, quarter=quarter or None)
        if res and res.get("segments"):
            return _with_qa_boundary(res)
    except Exception as e:
        _log.warning("[earnings_intel] fmp transcript failed for %s: %s", sym, e)
    # AlphaVantage fallback (rate-limited) only when FMP came up empty.
    try:
        return _with_qa_boundary(get_transcript(sym, quarter=quarter or None))
    except Exception as e:
        _log.warning("[earnings_intel] av transcript failed for %s: %s", sym, e)
        return None


# ── Cross-company transcript keyword alerts ──────────────────────────────────
# Follow a THEME rather than a ticker: "tell me when anyone says 'tariff'".
# Reuses the existing multi-channel alert delivery; see
# api/services/transcript_keyword_alerts.py.

@router.get("/api/admin/call-recap-status")
def call_recap_status():
    """Store size, today's generations and spend against the cap.

    Read this rather than the logs to answer "is warming keeping up?" — a
    permanently-green heartbeat would not distinguish a healthy sweep from one
    that has been capped since 08:00.
    """
    try:
        from api.services import call_recap_store as store
        store.init_db()
        return store.stats()
    except Exception as e:
        return {"error": str(e)}


@router.get("/api/earnings/keyword-alerts")
def list_keyword_alerts(user: dict = Depends(require_paid)):
    try:
        from api.services import transcript_keyword_alerts as ka
        ka.init_db()
        return {"keywords": ka.list_keywords(user["id"]),
                "max": ka.MAX_KEYWORDS_PER_USER,
                "min_length": ka.MIN_KEYWORD_LEN,
                "enabled": ka.enabled()}
    except Exception as e:
        _log.warning("[earnings_intel] keyword list failed: %s", e)
        return {"keywords": [], "max": 0, "min_length": 0, "enabled": False}


@router.post("/api/earnings/keyword-alerts")
def add_keyword_alert(body: dict = Body(...), user: dict = Depends(require_paid)):
    """Add a keyword. Returns the stored (normalised) form, or an explicit
    reason — a silent no-op would look like a saved subscription that never
    fires, which is the worst outcome for an alert feature."""
    from api.services import transcript_keyword_alerts as ka
    ka.init_db()
    raw = (body or {}).get("keyword") or ""
    if ka.normalize_keyword(raw) is None:
        return {"ok": False, "reason": "too_short_or_too_long",
                "min_length": ka.MIN_KEYWORD_LEN}
    stored = ka.add_keyword(user["id"], raw)
    if stored is None:
        return {"ok": False, "reason": "limit_reached", "max": ka.MAX_KEYWORDS_PER_USER}
    return {"ok": True, "keyword": stored, "keywords": ka.list_keywords(user["id"])}


@router.delete("/api/earnings/keyword-alerts")
def remove_keyword_alert(keyword: str = Query(...), user: dict = Depends(require_paid)):
    from api.services import transcript_keyword_alerts as ka
    ka.init_db()
    removed = ka.remove_keyword(user["id"], keyword)
    return {"ok": removed, "keywords": ka.list_keywords(user["id"])}


@router.get("/api/earnings/transcript-quarters/{ticker}")
def transcript_quarters_endpoint(ticker: str, user: dict = Depends(require_paid)):
    """Quarters with a published transcript, newest first.

    Cheap (one cached FMP index call, no transcript bodies) and it is what lets
    the reader step back through prior calls instead of only seeing the latest.
    Never raises; an empty list simply means no selector is offered.
    """
    sym = (ticker or "").upper().strip()
    if not sym:
        return {"symbol": "", "quarters": []}
    try:
        return {"symbol": sym, "quarters": list_fmp_quarters(sym)}
    except Exception as e:
        _log.warning("[earnings_intel] quarter list failed for %s: %s", sym, e)
        return {"symbol": sym, "quarters": []}


@router.get("/api/earnings/analyst-grades/{ticker}")
def analyst_grades_endpoint(ticker: str, user: dict = Depends(require_paid)):
    """Analyst ratings consensus + price targets + recent upgrade/downgrade
    actions + rating-bucket trend (FMP Ultimate). Returns null when unavailable.
    Never raises."""
    sym = (ticker or "").upper().strip()
    if not sym:
        return None
    try:
        return get_analyst_grades(sym)
    except Exception as e:
        _log.warning("[earnings_intel] analyst grades failed for %s: %s", sym, e)
        return None


# ── Timed transcript + call audio (the Quartr behaviour) ─────────────────────
#
# A transcript with per-word start times is what lets the text follow the audio
# and a click on a word seek to it. FMP carries no timing, so this is a second
# source used ONLY for what FMP cannot do; it returns null for the many symbols
# it does not cover, and the existing transcript panel is unaffected.

@router.get("/api/earnings/timed-transcript/{ticker}")
def timed_transcript_endpoint(
    ticker: str,
    year: Optional[int] = Query(default=None),
    quarter: Optional[int] = Query(default=None),
    user: dict = Depends(require_paid),
):
    """Speaker turns with per-word start times, or null when uncovered."""
    sym = (ticker or "").upper().strip()
    if not sym:
        return None
    try:
        from api.services import earningscall_timed as ec
        data = ec.get_timed_transcript(sym, year=year, quarter=quarter)
        if not data:
            return {"symbol": sym, "available": False}
        # `audio_url` points at OUR proxy, never upstream: the upstream URL
        # carries the API key as a query parameter.
        return {**data, "available": True,
                "audio_url": f"/api/earnings/call-audio/{sym}"}
    except Exception as e:
        _log.warning("[earnings_intel] timed transcript failed for %s: %s", sym, e)
        return {"symbol": sym, "available": False}


@router.get("/api/earnings/call-audio/{ticker}")
def call_audio_endpoint(
    ticker: str,
    request: Request,
    year: Optional[int] = Query(default=None),
    quarter: Optional[int] = Query(default=None),
    user: dict = Depends(require_paid),
):
    """Proxy the call recording so the provider key never reaches the browser.

    Range is forwarded and the upstream status relayed verbatim (206 with
    Content-Range when partial): an <audio> element cannot seek without it, and
    seeking is the whole point of a timed transcript.
    """
    from fastapi.responses import StreamingResponse

    sym = (ticker or "").upper().strip()
    if not sym:
        return Response(status_code=404)

    from api.services import earningscall_timed as ec
    upstream = ec.open_audio_stream(sym, year=year, quarter=quarter,
                                    range_header=request.headers.get("range"))
    if upstream is None:
        return Response(status_code=404)

    passthrough = {}
    for h in ("content-type", "content-length", "content-range", "accept-ranges"):
        v = upstream.headers.get(h)
        if v:
            passthrough[h] = v
    passthrough.setdefault("accept-ranges", "bytes")
    # A published call never changes, so let the browser keep it.
    passthrough["cache-control"] = "private, max-age=86400"

    def _iter():
        try:
            for chunk in upstream.iter_content(chunk_size=64 * 1024):
                if chunk:
                    yield chunk
        finally:
            upstream.close()

    return StreamingResponse(
        _iter(), status_code=upstream.status_code,
        media_type=passthrough.get("content-type", "audio/mpeg"),
        headers=passthrough)


# ── Cross-company transcript search ──────────────────────────────────────────
#
# The panel search finds a word inside ONE transcript already open. This
# answers the question that moves money: who said "tariff" this quarter, and
# what did they say — across every company that reported.

@router.get("/api/earnings/transcript-search")
def transcript_search_endpoint(
    q: str = Query(..., min_length=2, description="keyword, or \"exact phrase\""),
    limit: int = Query(default=40, ge=1, le=200),
    symbol: Optional[str] = Query(default=None),
    since: Optional[str] = Query(default=None, description="YYYY-MM-DD"),
    user: dict = Depends(require_paid),
):
    """Ranked hits with highlighted snippets, across the indexed corpus."""
    try:
        from api.services import transcript_index as ix
        return ix.search(q, limit=limit, symbol=symbol, since=since)
    except Exception as e:
        _log.warning("[earnings_intel] transcript search failed for %r: %s", q, e)
        return {"query": q, "hits": [], "total": 0, "error": "search unavailable"}


@router.get("/api/admin/transcript-index-status")
def transcript_index_status():
    """Corpus size and span — read this to answer "is search covering today?"

    A search that returns nothing looks identical whether the corpus is empty
    or the term is genuinely absent, so the corpus has to be observable.
    """
    try:
        from api.services import transcript_index as ix
        return ix.stats()
    except Exception as e:
        return {"error": str(e)}
