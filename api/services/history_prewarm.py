"""Global history pre-warm — stocks Cloudflare's edge + Cache Reserve for every symbol's
SEALED daily/weekly/monthly history, so NO first-time user in ANY region ever hits the
origin for a chart's deep history (instant-charts Phase 5 — worldwide warmth).

How it works: periodically (overnight, after the sealed data settles) request every symbol's
DATED-IMMUTABLE history URL THROUGH the public Cloudflare domain. Each request populates the
edge PoP it lands on AND — with Cache Reserve enabled — Cloudflare's persistent GLOBAL store,
so the first real user anywhere is served from Cloudflare, never the origin. The dated URL
(`d=<last-sealed>`) is immutable for a year and changes only when a new trading day seals, so
a nightly pass keeps the whole universe globally warm at ~one origin serve per (symbol, tf)
per trading day. Our own sweep is the only thing that ever touches the origin for history.

Runs on the WORKER (off the user request path), gated by HISTORY_PREWARM_ENABLED (default OFF
— activate once Cloudflare Tiered Cache + Cache Reserve are on). Gentle + sequential so it
never loads the web pod even if a pass overlaps market hours.
"""
from __future__ import annotations

import logging
import os
import threading
import time

_log = logging.getLogger("history_prewarm")

_ENABLED = os.environ.get("HISTORY_PREWARM_ENABLED", "0") == "1"
# Go THROUGH Cloudflare (the public domain), never the origin directly, or the edge / Cache
# Reserve is never stocked. Cloudflare 1010-blocks non-browser UAs, so send a browser UA.
_BASE = os.environ.get("HISTORY_PREWARM_BASE", "https://uctintelligence.com").rstrip("/")
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/120.0 Safari/537.36 uct-history-prewarm")
_PACE = float(os.environ.get("HISTORY_PREWARM_PACE_SECS", "0.4"))          # gap between requests
_INTERVAL = int(os.environ.get("HISTORY_PREWARM_INTERVAL_SECS", str(24 * 3600)))
_STARTUP_DELAY = int(os.environ.get("HISTORY_PREWARM_STARTUP_DELAY_SECS", "300"))
_TIMEOUT = float(os.environ.get("HISTORY_PREWARM_TIMEOUT_SECS", "35"))
_TFS = ("D", "W", "M")
# Match the client's fullBarsFor(tf) so the pre-warmed URL == the URL the browser requests.
_FULL = {"D": 12500, "W": 4000, "M": 2000}


def _client():
    import httpx
    return httpx.Client(timeout=_TIMEOUT, headers={"User-Agent": _UA}, follow_redirects=True)


def _universe() -> list[str]:
    try:
        from api.services.bars_fetch import _build_universe_ticker_list
        syms = _build_universe_ticker_list()
        if syms:
            return syms
    except Exception:
        pass
    import json
    p = os.path.join(os.path.dirname(__file__), "..", "data", "cap_universe.json")
    try:
        with open(p, encoding="utf-8") as fh:
            raw = json.load(fh)
        return [str(t).upper() for t in (raw if isinstance(raw, list) else raw.get("tickers", []))]
    except Exception:
        return []


def _market_last_sealed(cli, tf: str) -> str:
    """The market's current sealed boundary for `tf`, read from a reference active symbol so
    every symbol's pre-warm URL carries the SAME `d` the browser sends (an immutable match)."""
    for ref in ("SPY", "AAPL", "QQQ"):
        try:
            r = cli.get(f"{_BASE}/api/bars-history/{ref}?tf={tf}&bars={_FULL[tf]}")
            if r.status_code == 200:
                d = (r.json() or {}).get("last_sealed") or ""
                if d:
                    return d
        except Exception:
            continue
    return ""


def prewarm_pass() -> dict:
    """One full sweep of the universe × D/W/M through Cloudflare. Returns counts."""
    syms = _universe()
    stats = {"symbols": len(syms), "requests": 0, "hit": 0, "miss": 0, "err": 0}
    if not syms:
        _log.warning("[history_prewarm] empty universe — nothing to warm")
        return stats
    t0 = time.time()
    with _client() as cli:
        for tf in _TFS:
            d = _market_last_sealed(cli, tf)
            if not d:
                _log.warning("[history_prewarm] no sealed boundary for tf=%s — skipping", tf)
                continue
            for sym in syms:
                url = f"{_BASE}/api/bars-history/{sym}?tf={tf}&bars={_FULL[tf]}&d={d}"
                try:
                    r = cli.get(url)
                    stats["requests"] += 1
                    cf = (r.headers.get("cf-cache-status") or "").upper()
                    if cf == "HIT":
                        stats["hit"] += 1
                    else:
                        stats["miss"] += 1
                except Exception:
                    stats["err"] += 1
                time.sleep(_PACE)
            _log.info("[history_prewarm] tf=%s done (d=%s): %s", tf, d, stats)
    stats["secs"] = round(time.time() - t0)
    _log.info("[history_prewarm] sweep complete in %ss: %s", stats["secs"], stats)
    return stats


def start_history_prewarm() -> None:
    """Boot-delayed + periodic sweep on a daemon thread (worker only). No-op unless enabled."""
    if not _ENABLED:
        _log.info("[history_prewarm] disabled (set HISTORY_PREWARM_ENABLED=1 to enable)")
        return

    def _loop():
        time.sleep(_STARTUP_DELAY)
        while True:
            try:
                prewarm_pass()
            except Exception:
                _log.exception("[history_prewarm] sweep error")
            time.sleep(_INTERVAL)

    threading.Thread(target=_loop, name="history-prewarm", daemon=True).start()
    _log.info("[history_prewarm] started (base=%s, interval=%ss, pace=%ss)", _BASE, _INTERVAL, _PACE)
