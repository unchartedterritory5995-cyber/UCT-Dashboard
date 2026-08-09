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

# Segmentation runs a LADDER of boundaries, most precise first, and takes the
# first rung that finds a plausible number of turns. Nothing is ever discarded:
# the last rung returns the whole blob as one segment.
#
# Rung 1 — LINE-ANCHORED. In an FMP transcript a speaker turn begins at the
# start of a line ("Name: text…"). Two properties matter and both were defects
# in the sentence-boundary boundary below (measured against live transcripts on
# 2026-08-08, fixtures in tests/fixtures/fmp_transcript_excerpts.json):
#
#   * separators WITHIN a name are spaces/commas only — never `\s` — so a name
#     cannot span a line break. The old `\s+` between name words, combined with
#     `.` being legal inside a name word, produced speaker='Thanks.\n\nTim Cook'
#     on AAPL: one human rendered as two identities, silently breaking any
#     speaker filter or role map downstream.
#   * `[ ,]+` admits the comma, so credentialed names parse. DIS Q&A is
#     moderated by "Benjamin Daniel Swinburne, C.F.A."; the old space-only
#     separator never matched him, so 22 of that call's 46 turns merged into
#     the PRECEDING executive's segment and carried his name.
#
# The class is letters + . - ' ’ & with NO digits (deliberately not `\w`), so a
# line like "Q3: revenue grew" can never be read as a speaker.
_SPEAKER_LINE_RE = re.compile(
    r"(?:\A|\n)[ \t]*"
    r"([A-Z][A-Za-z.\-'’]*(?:[ ,]+[A-Z&][A-Za-z.\-'’&]*){0,5})"
    r"[ \t]*:[ \t]+"
)

# Rung 2 — the original sentence-boundary form, kept verbatim for rows that
# arrive as ONE line with no newlines at all (FMP is not consistent about this).
# Line-anchoring alone would return a single unsplit segment for those.
_SPEAKER_RE = re.compile(
    r"(?:\A|\n+|(?<=[.?!])\s+)"
    r"([A-Z][A-Za-z.\-'’]+(?:\s+[A-Z&][A-Za-z.\-'’&]*){0,3})"
    r"\s*:\s+"
)

# Below this many turns a boundary hasn't convincingly found speaker structure,
# so we fall to the next rung rather than emit confident nonsense.
_MIN_TURNS = 3


def _parse_quarter(quarter: Optional[str]) -> tuple[Optional[int], Optional[int]]:
    """'2025Q1' / '2025q1' / '2025-Q1' → (2025, 1); anything else → (None, None)."""
    if not quarter:
        return (None, None)
    m = re.match(r"\s*(\d{4})\D*([1-4])\s*$", str(quarter))
    if m:
        return (int(m.group(1)), int(m.group(2)))
    return (None, None)


def _seg(speaker: str, text: str) -> dict:
    return {"speaker": speaker, "title": "", "content": text, "sentiment": None}


def _turns(content: str, matches: list) -> list[dict]:
    """Slice `content` into turns at each boundary match.

    Any text BEFORE the first boundary is kept as a leading unattributed
    segment rather than dropped — an unlabelled preamble is still part of the
    call, and silently losing it is indistinguishable from the provider not
    having sent it.
    """
    segs: list[dict] = []
    head = content[: matches[0].start()].strip()
    if head:
        segs.append(_seg("", head))
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(content)
        text = content[m.end():end].strip()
        if text:
            segs.append(_seg(m.group(1).strip(), text))
    return segs


def _segment(content: str) -> list[dict]:
    """Split one transcript blob into [{speaker,title,content,sentiment}] turns.

    Walks the boundary ladder (line-anchored → sentence-boundary) and takes the
    first rung that finds >= _MIN_TURNS turns; falls back to a single
    whole-transcript segment so no text is ever lost.
    """
    content = (content or "").strip()
    if not content:
        return []
    for rx in (_SPEAKER_LINE_RE, _SPEAKER_RE):
        matches = list(rx.finditer(content))
        if len(matches) < _MIN_TURNS:
            continue
        segs = _turns(content, matches)
        if segs:
            return segs
    return [_seg("", content)]


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


# A hit is stable — a company gains a quarter roughly four times a year.
# A MISS must expire fast: reusing the 6h transcript miss-TTL here would hide
# a company's first-ever transcript for most of a day after it publishes.
_TTL_QUARTERS      = 12 * 3_600   # 12h
_TTL_QUARTERS_MISS = 900          # 15 min


def list_quarters(ticker: str) -> list[dict]:
    """Every quarter FMP has a transcript for, newest first.

    DIS has 81. `useTranscript` has always accepted a `quarter` argument and
    nothing ever passed one, so all of that history was unreachable from the UI.
    """
    ticker = (ticker or "").upper().strip()
    if not ticker:
        return []
    ck = f"fmp_transcript_quarters_{ticker}"
    hit = cache.get(ck)
    if hit is not None:
        return hit
    try:
        rows = _available(ticker)
    except Exception as exc:
        _log.warning("[fmp_transcripts] quarter list failed for %s: %s", ticker, exc)
        return []
    out = [{"quarter": f"{y}Q{q}", "year": y, "q": q} for y, q in rows]
    cache.set(ck, out, ttl=_TTL_QUARTERS if out else _TTL_QUARTERS_MISS)
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
