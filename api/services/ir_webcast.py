"""Resolve a company's Investor Relations / events page — where the live call is.

Earnings calls are webcast from the company's own IR site, so a "Listen live"
link does not need a data vendor: it needs the IR URL. FMP's profile already
carries `website` (we pay for it), and IR lives at a small set of conventional
places off that domain.

Measured on 20 large caps: **16/20 (80%) resolve** from the profile alone, at
zero additional API cost. The remaining ~20% fall back to the existing
Perplexity lookup.

This also fixes a latency problem. `get_webcast_url` was a Perplexity call:
~2.4s alone and 7-10s under twenty concurrent readers, and it was the single
largest cost of a cold recap open. This resolves in parallel HTTP probes and
caches for 30 days, because an IR URL is stable for years.

⚠️ Probes use GET, not HEAD. Plenty of IR hosts answer 403/405 to HEAD while
serving GET perfectly — HEAD measured 3/12 where GET measured 9/12 on the same
companies, so the method was the finding, not the coverage.
"""
from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

_log = logging.getLogger(__name__)

_TTL_HIT = 30 * 86_400      # IR URLs are stable for years
_TTL_MISS = 12 * 3_600      # a miss is usually a redesign away from resolving
# Generous ON PURPOSE, and it costs the reader nothing. The endpoint that calls
# this already bounds the whole cold block at CALL_RECAP_COLD_BUDGET and does
# NOT cancel the future, so a slow probe finishes in the background and lands in
# the 30-day cache for the next open. NVDA resolved locally but timed out from
# Railway at 6s, which is a network-distance fact, not a coverage one — the only
# thing a short timeout buys here is a permanently missing link.
_PROBE_TIMEOUT = 12
_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"


def _cache():
    from api.services.cache import cache
    return cache


def _domain(website: str) -> str:
    return re.sub(r"^https?://(www\.)?", "", (website or "").strip().rstrip("/"))


def candidates(website: str) -> list[str]:
    """IR URLs to try, ORDERED so the closest-to-the-webcast wins.

    `/events` first: that is the page carrying the live webcast player and the
    replay, so landing there saves the reader a click. The bare IR host is the
    fallback, which is still a useful destination.
    """
    d = _domain(website)
    if not d:
        return []
    return [
        f"https://investor.{d}/events", f"https://investors.{d}/events",
        f"https://ir.{d}/events",
        f"https://investor.{d}", f"https://investors.{d}", f"https://ir.{d}",
        f"https://www.{d}/investors", f"https://www.{d}/investor-relations",
        f"https://www.{d}/investor",
    ]


def _alive(url: str) -> bool:
    import requests
    try:
        r = requests.get(url, timeout=_PROBE_TIMEOUT, allow_redirects=True,
                         headers={"User-Agent": _UA}, stream=True)
        r.close()
        return r.status_code < 400
    except Exception:
        return False


def _website_for(sym: str) -> Optional[str]:
    try:
        from api.services.earnings_estimates import _fmp_get
        rows = _fmp_get("/stable/profile", {"symbol": sym}, timeout=10)
    except Exception as exc:
        _log.debug("[ir] profile failed for %s: %s", sym, exc)
        return None
    if not isinstance(rows, list) or not rows:
        return None
    return (rows[0] or {}).get("website")


def resolve(sym: str, *, website: Optional[str] = None,
            alive=None) -> Optional[str]:
    """Best IR/events URL for a symbol, or None. Cached 30d. Never raises."""
    sym = (sym or "").upper().strip()
    if not sym:
        return None
    ck = f"ir_url::{sym}"
    hit = _cache().get(ck)
    if hit is not None:
        return None if hit == "__none__" else hit

    alive = alive or _alive
    if website is None:
        website = _website_for(sym)
    cands = candidates(website)
    if not cands:
        _cache().set(ck, "__none__", _TTL_MISS)
        return None

    # Probed concurrently, but the FIRST candidate in list order wins — the
    # ordering encodes "closest to the webcast", so taking whichever responds
    # fastest would hand back a worse page.
    try:
        with ThreadPoolExecutor(max_workers=len(cands),
                                thread_name_prefix="ir-probe") as ex:
            for url, ok in zip(cands, list(ex.map(alive, cands))):
                if ok:
                    _cache().set(ck, url, _TTL_HIT)
                    return url
    except Exception as exc:
        _log.debug("[ir] probe failed for %s: %s", sym, exc)
        return None

    _cache().set(ck, "__none__", _TTL_MISS)
    return None
