"""FMP earnings-call transcript service (FMP Ultimate plan).

`stable/earning-call-transcript?symbol=&year=&quarter=` returns a single row with
the FULL verbatim transcript in one `content` string (speaker labels inline, e.g.
"Tim Cook: ..."). Unlimited on the Ultimate plan — this is the PRIMARY verbatim
transcript source, de-capping the AlphaVantage 25-req/day path (which stays as a
fallback for any gap).

Returns the SAME shape as `av_transcripts.get_transcript` so the existing endpoint
+ frontend render identically:

    {
        "symbol":   "AAPL",
        "quarter":  "2025Q2",
        "segments": [{"speaker", "title", "content", "sentiment"}, ...],
        "resolved": True,   # True when quarter was auto-resolved (newest available)
    }
    or None when unavailable.

The single `content` blob is split into per-speaker segments by a boundary regex;
if segmentation is unconvincing (<3 turns) the whole transcript is returned as one
segment so nothing is ever lost. Never raises.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from api.services import earnings_estimates as ee
from api.services.cache import cache as _cache_singleton

_log = logging.getLogger(__name__)

# Module-level handles — tests patch these directly.
cache = _cache_singleton

_TTL_HIT  = 30 * 86_400   # 30d — transcripts are immutable once published
_TTL_MISS = 6 * 3_600     # 6h — short-cache genuine misses

# A speaker-turn boundary: a capitalized 1–4 word name (allowing ., -, ', &)
# immediately followed by a colon, at the very start, after newline(s), or after
# sentence-ending punctuation. Mid-sentence ratios like "2:1" never match (no
# capitalized-name prefix); "the Company: " style false hits are rare and benign.
_SPEAKER_RE = re.compile(
    r"(?:\A|\n+|(?<=[.?!])\s+)"
    r"([A-Z][A-Za-z.\-'’]+(?:\s+[A-Z&][A-Za-z.\-'’&]*){0,3})"
    r"\s*:\s+"
)


def _parse_quarter(quarter: Optional[str]) -> tuple[Optional[int], Optional[int]]:
    """'2025Q1' / '2025q1' / '2025-Q1' → (2025, 1); anything else → (None, None)."""
    if not quarter:
        return (None, None)
    m = re.match(r"\s*(\d{4})\D*([1-4])\s*$", str(quarter))
    if m:
        return (int(m.group(1)), int(m.group(2)))
    return (None, None)


def _segment(content: str) -> list[dict]:
    """Split one transcript blob into [{speaker,title,content,sentiment}] turns.
    Falls back to a single whole-transcript segment when speaker turns are scarce."""
    content = (content or "").strip()
    if not content:
        return []
    matches = list(_SPEAKER_RE.finditer(content))
    if len(matches) < 3:
        return [{"speaker": "", "title": "", "content": content, "sentiment": None}]
    segs: list[dict] = []
    for i, m in enumerate(matches):
        speaker = m.group(1).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(content)
        text = content[start:end].strip()
        if text:
            segs.append({"speaker": speaker, "title": "", "content": text, "sentiment": None})
    return segs or [{"speaker": "", "title": "", "content": content, "sentiment": None}]


def _fetch(symbol: str, year: int, quarter: int) -> Optional[dict]:
    data = ee._fmp_get(
        "/stable/earning-call-transcript",
        {"symbol": symbol, "year": year, "quarter": quarter},
    )
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return data[0]
    return None


def _available(symbol: str) -> list[tuple[int, int]]:
    """[(fiscalYear, quarter), ...] newest-first from the transcript-dates index."""
    data = ee._fmp_get("/stable/earning-call-transcript-dates", {"symbol": symbol})
    out: list[tuple[int, int]] = []
    if isinstance(data, list):
        for row in data:
            if not isinstance(row, dict):
                continue
            try:
                out.append((int(row.get("fiscalYear")), int(row.get("quarter"))))
            except (TypeError, ValueError):
                continue
    out.sort(reverse=True)
    return out


def get_transcript(ticker: str, quarter: Optional[str] = None) -> Optional[dict]:
    """Verbatim transcript from FMP. `quarter` like '2025Q1'; omit to auto-resolve
    the newest available. Returns the av_transcripts-compatible dict or None."""
    ticker = (ticker or "").upper().strip()
    if not ticker:
        return None

    year, q = _parse_quarter(quarter)
    resolved = False
    try:
        if year is None or q is None:
            avail = _available(ticker)
            if not avail:
                return None
            year, q = avail[0]
            resolved = True

        cache_key = f"fmp_transcript_{ticker}_{year}_{q}"
        cached = cache.get(cache_key)
        if cached is not None:
            return None if cached.get("_miss") else cached

        row = _fetch(ticker, year, q)
        content = (row or {}).get("content") if isinstance(row, dict) else None
        segments = _segment(content or "")
        if not segments:
            cache.set(cache_key, {"_miss": True}, ttl=_TTL_MISS)
            return None

        payload = {
            "symbol":   ticker,
            "quarter":  f"{year}Q{q}",
            "segments": segments,
            "resolved": resolved,
        }
        cache.set(cache_key, payload, ttl=_TTL_HIT)
        return payload
    except Exception as exc:
        _log.warning("[fmp_transcripts] failed for %s %s: %s", ticker, quarter, exc)
        return None
