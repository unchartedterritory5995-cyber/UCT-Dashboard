"""Timed transcripts + call audio (earningscall.biz) — the Quartr behaviour.

This is what makes a transcript *playable*: the words carry start times, so the
text can follow the audio and a click on any word can seek to it.

Everything here was established by probing the live API, because its docs are
thin:

  * `exchange` is REQUIRED. `/events?symbol=AAPL` with no exchange is a 400,
    and it wants the NAME — `exchange=NASDAQ` is 200, `exchange=9` (the id the
    symbol index carries) is 403.
  * `level=3` is the level that matters. It returns `speakers[]`, each with
    `words[]` and `start_times[]` — verified 1:1 and monotonic over a full
    53-minute call (194 words / 194 starts on the first turn).
  * `/audio` returns raw `audio/mpeg`, ~52 MB for one call.

⚠️ THE AUDIO URL CONTAINS OUR API KEY. It must never reach the browser; the
router proxies the bytes instead. Nothing in this module returns a URL that is
safe to hand to a client, which is why the accessor is named `_audio_url` and
stays private.

FMP remains the transcript of record. This is a SECOND source and is used only
where it can do something FMP cannot — carry timing — so the two never describe
the same thing in two places. Coverage is the S&P 500 plus some international
listings, so most of the universe will correctly get `None` here.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

_log = logging.getLogger(__name__)

_BASE = "https://v2.api.earningscall.biz"
_TIMEOUT = 20

# Transcripts are immutable once published, so these cache hard. A miss is
# usually "not covered by the plan", which is also stable — but not permanent,
# since coverage grows, hence a shorter miss ttl.
_TTL_HIT = 30 * 86_400
_TTL_MISS = 6 * 3_600

# Exchanges to try when the symbol index does not name one. Ordered by how much
# of a US-listed universe each covers, and the winner is cached, so this costs
# at most a couple of extra calls once per symbol.
_EXCHANGE_CANDIDATES = ("NASDAQ", "NYSE", "AMEX")


def _cache():
    from api.services.cache import cache
    return cache


def api_key() -> str:
    """The configured key, or the public demo key.

    The demo key serves AAPL and MSFT only. That is deliberately left as the
    fallback rather than disabling the feature: it keeps this path exercisable
    end-to-end — including in tests and on a dev box — before anyone pays for a
    subscription.
    """
    return (os.environ.get("EARNINGS_AUDIO_API_KEY") or "").strip() or "demo"


def enabled() -> bool:
    return (os.environ.get("EARNINGS_TIMED_TRANSCRIPT", "1").strip() == "1")


def _get(path: str, params: dict, *, raw: bool = False):
    """One GET. Returns parsed JSON, or (status, headers) when raw."""
    import requests
    params = {**params, "apikey": api_key()}
    r = requests.get(f"{_BASE}{path}", params=params, timeout=_TIMEOUT,
                     stream=raw)
    if r.status_code != 200:
        return None
    return r if raw else r.json()


def _exchange_for(sym: str) -> Optional[str]:
    """Which exchange string this symbol answers on, cached.

    The symbol index gives a numeric exchange id the API itself rejects, so the
    id is only useful as a hint that the symbol is covered at all.
    """
    ck = f"ec_exchange::{sym}"
    hit = _cache().get(ck)
    if hit is not None:
        return None if hit == "__none__" else hit

    for ex in _EXCHANGE_CANDIDATES:
        try:
            data = _get("/events", {"exchange": ex, "symbol": sym})
        except Exception as exc:
            _log.debug("[ec] exchange probe failed %s/%s: %s", sym, ex, exc)
            continue
        if data and data.get("events"):
            _cache().set(ck, ex, _TTL_HIT)
            return ex

    _cache().set(ck, "__none__", _TTL_MISS)
    return None


def latest_event(sym: str) -> Optional[dict]:
    """Newest PUBLISHED event for a symbol, or None when uncovered."""
    ex = _exchange_for(sym)
    if not ex:
        return None
    try:
        data = _get("/events", {"exchange": ex, "symbol": sym})
    except Exception as exc:
        _log.debug("[ec] events failed for %s: %s", sym, exc)
        return None
    events = [e for e in ((data or {}).get("events") or [])
              if e.get("is_published")]
    if not events:
        return None
    # The feed is newest-first, but sort rather than trust it — a queue that
    # depends on provider ordering is one silent reshuffle from serving a
    # two-year-old call as "latest".
    events.sort(key=lambda e: (e.get("year") or 0, e.get("quarter") or 0),
                reverse=True)
    top = events[0]
    return {"exchange": ex, "year": top.get("year"), "quarter": top.get("quarter"),
            "conference_date": top.get("conference_date"),
            "company_name": (data or {}).get("company_name")}


def get_timed_transcript(sym: str, year: Optional[int] = None,
                         quarter: Optional[int] = None) -> Optional[dict]:
    """Speaker turns with per-word start times, or None when unavailable.

    Shape:
        {symbol, year, quarter, company_name,
         segments: [{speaker, name, words: [str], starts: [float]}]}

    `words` and `starts` are returned as parallel arrays rather than a list of
    objects: a 6,000-word call is ~12k array entries either way, but paired
    objects roughly triples the JSON for no gain.
    """
    sym = (sym or "").upper().strip()
    if not sym or not enabled():
        return None

    ck = f"ec_timed::{sym}::{year or 'latest'}::{quarter or ''}"
    hit = _cache().get(ck)
    if hit is not None:
        return None if hit == "__null__" else hit

    ev = latest_event(sym) if (year is None or quarter is None) else None
    if year is None or quarter is None:
        if not ev:
            _cache().set(ck, "__null__", _TTL_MISS)
            return None
        year, quarter = ev["year"], ev["quarter"]
        exchange = ev["exchange"]
    else:
        exchange = _exchange_for(sym)
        if not exchange:
            _cache().set(ck, "__null__", _TTL_MISS)
            return None

    try:
        data = _get("/transcript", {"exchange": exchange, "symbol": sym,
                                    "year": year, "quarter": quarter,
                                    "level": 3})
    except Exception as exc:
        _log.warning("[ec] transcript failed for %s: %s", sym, exc)
        return None
    if not data or not data.get("speakers"):
        _cache().set(ck, "__null__", _TTL_MISS)
        return None

    names = data.get("speaker_name_map_v2") or {}
    segments = []
    for sp in data["speakers"]:
        words = sp.get("words") or []
        starts = sp.get("start_times") or []
        # Drop a turn whose arrays disagree rather than zipping to the shorter
        # one: a silent truncation would put later words on earlier timestamps
        # and the highlight would drift for the rest of the call.
        if not words or len(words) != len(starts):
            if words:
                _log.warning("[ec] %s: dropping turn, %d words vs %d starts",
                             sym, len(words), len(starts))
            continue
        label = sp.get("speaker")
        info = names.get(str(label)) or names.get(label) or {}
        segments.append({
            "speaker": label,
            "name": (info.get("name") if isinstance(info, dict) else None) or "",
            "title": (info.get("title") if isinstance(info, dict) else None) or "",
            "words": words,
            "starts": [float(s) for s in starts],
        })

    if not segments:
        _cache().set(ck, "__null__", _TTL_MISS)
        return None

    out = {"symbol": sym, "year": year, "quarter": quarter,
           "company_name": (ev or {}).get("company_name") or "",
           "segments": segments}
    _cache().set(ck, out, _TTL_HIT)
    return out


def _audio_url(sym: str, year: int, quarter: int, exchange: str) -> str:
    """PRIVATE — carries the API key. Never return this to a client."""
    from urllib.parse import urlencode
    q = urlencode({"apikey": api_key(), "exchange": exchange,
                   "symbol": sym, "year": year, "quarter": quarter})
    return f"{_BASE}/audio?{q}"


def open_audio_stream(sym: str, year: Optional[int] = None,
                      quarter: Optional[int] = None,
                      range_header: Optional[str] = None):
    """Open the upstream audio response for proxying.

    Returns the streaming `requests` response, or None. The caller relays the
    bytes so the key stays server-side.

    `Range` is forwarded because an <audio> element cannot seek without it —
    and seeking is the entire point of a timed transcript.
    """
    import requests
    sym = (sym or "").upper().strip()
    if not sym or not enabled():
        return None
    if year is None or quarter is None:
        ev = latest_event(sym)
        if not ev:
            return None
        year, quarter, exchange = ev["year"], ev["quarter"], ev["exchange"]
    else:
        exchange = _exchange_for(sym)
        if not exchange:
            return None

    headers = {}
    if range_header:
        headers["Range"] = range_header
    try:
        r = requests.get(_audio_url(sym, year, quarter, exchange),
                         headers=headers, stream=True, timeout=_TIMEOUT)
    except Exception as exc:
        _log.warning("[ec] audio open failed for %s: %s", sym, exc)
        return None
    if r.status_code not in (200, 206):
        _log.debug("[ec] audio upstream %s for %s", r.status_code, sym)
        r.close()
        return None
    return r
