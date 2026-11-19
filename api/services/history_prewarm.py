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


def _svc_headers() -> dict:
    """The service token — `/api/bars-history` is paid now.

    ⚠️ This sweep stocks the SHARED edge cache, which still serves cache HITs with
    no entitlement check. That gap is the secure-edge phase’s to close; the sweep is
    default-OFF (`HISTORY_PREWARM_ENABLED=0`) and the credential here only lets it
    reach the now-gated origin when it is deliberately enabled.
    """
    from api.bars_auth import bars_service_headers
    return bars_service_headers()
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/120.0 Safari/537.36 uct-history-prewarm")
_PACE = float(os.environ.get("HISTORY_PREWARM_PACE_SECS", "0.4"))          # gap between requests
_INTERVAL = int(os.environ.get("HISTORY_PREWARM_INTERVAL_SECS", str(24 * 3600)))
_STARTUP_DELAY = int(os.environ.get("HISTORY_PREWARM_STARTUP_DELAY_SECS", "300"))
#: How often the scheduler asks whether the daily boundary moved (see `pass_due`).
_CHECK_EVERY = int(os.environ.get("HISTORY_PREWARM_CHECK_SECS", "900"))
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
    """The market's current sealed boundary for `tf`, so every symbol's pre-warm URL carries the SAME `d` the
    browser sends (an immutable match). D comes from the NYSE calendar (`bars.calendar_last_sealed_day`), the
    rule the browser's tail follows: the store this sweep reads can lag a day after a restart, and a sweep
    stamped with the store's day warms URLs no browser asks for (2026-11-19: it warmed d=2026-11-17 while
    browsers asked d=2026-11-18). W/M are read from a reference active symbol."""
    if tf == "D":
        try:
            from api.routers.bars import calendar_last_sealed_day
            d = calendar_last_sealed_day()
            if d:
                return d
        except Exception:  # noqa: BLE001 - fall back to the reference read below
            pass
    # ⛔ WITH THE SERVICE TOKEN, like every sweep request. `/api/bars-history` is paid: this read
    # without it was refused (401) on every pass, so the boundary was "" for D, W and M and the
    # sweep warmed NOTHING (2026-11-18 worker log: 3,639 symbols, 0 requests, "complete in 3s"),
    # while every member's first open of a ticker's daily history paid the 1-2 s origin build.
    for ref in ("SPY", "AAPL", "QQQ"):
        try:
            r = cli.get(f"{_BASE}/api/bars-history/{ref}?tf={tf}&bars={_FULL[tf]}", headers=_svc_headers())
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
    stats = {"symbols": len(syms), "requests": 0, "ok": 0, "hit": 0, "miss": 0, "err": 0}
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
                    r = cli.get(url, headers=_svc_headers())
                    stats["requests"] += 1
                    if r.status_code == 200:
                        stats["ok"] += 1   # a refused (401/5xx) answer is never cached: it warms nothing
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
    if syms and not stats["ok"]:
        # A pass that warmed nothing is a failure, never a quiet "complete" (it read as one for weeks).
        _log.error("[history_prewarm] sweep warmed NOTHING (no boundary, or every answer refused): %s", stats)
    else:
        _log.info("[history_prewarm] sweep complete in %ss: %s", stats["secs"], stats)
    return stats


def pass_due(boundary_now: str, warmed: str, last_pass: float, now: float, interval: float = None) -> bool:
    """Is a sweep pass due?

    ⭐ ON THE ROLLOVER, NOT 24 h AFTER BOOT (2026-11-19). Every history URL carries `d=<last sealed
    day>`, and the daily boundary moves at midnight ET (`_period_start_iso`): every symbol's daily
    URL is new from then on, and cold until something requests it. A pass every `_INTERVAL` after
    boot warmed the PREVIOUS day's URLs whenever the worker happened to boot in the evening, so the
    whole next session paid the origin build (1-2 s) on each first open. A pass is due when the
    daily boundary differs from the one the last complete pass warmed (the rollover, and the first
    pass after a boot), or `interval` after the last pass as a backstop. An unreadable boundary
    ("") never triggers one on its own.
    """
    interval = _INTERVAL if interval is None else interval
    if boundary_now and boundary_now != warmed:
        return True
    return bool(warmed) and now - last_pass >= interval


def start_history_prewarm() -> None:
    """Boot-delayed sweep on a daemon thread (worker only), re-run on every daily rollover
    (`pass_due`). No-op unless enabled."""
    if not _ENABLED:
        _log.info("[history_prewarm] disabled (set HISTORY_PREWARM_ENABLED=1 to enable)")
        return

    def _loop():
        time.sleep(_STARTUP_DELAY)
        warmed, last_pass = "", 0.0
        while True:
            try:
                with _client() as cli:
                    boundary = _market_last_sealed(cli, "D")
            except Exception:
                boundary = ""
            if pass_due(boundary, warmed, last_pass, time.time()):
                try:
                    stats = prewarm_pass()
                    last_pass = time.time()
                    if stats.get("ok"):
                        warmed = boundary or warmed
                except Exception:
                    _log.exception("[history_prewarm] sweep error")
            time.sleep(_CHECK_EVERY)

    threading.Thread(target=_loop, name="history-prewarm", daemon=True).start()
    _log.info("[history_prewarm] started (base=%s, re-warm on each daily rollover, check every %ss, backstop %ss, pace=%ss)",
              _BASE, _CHECK_EVERY, _INTERVAL, _PACE)
