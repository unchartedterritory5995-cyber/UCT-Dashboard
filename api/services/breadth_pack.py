"""The Breadth Pack — every breadth series' recent daily bars, versioned, for the browser.

⭐⭐ WHY (2026-10-10, owner: "breadth charts should be instant, all the time, forever").
A stock chart's first view paints from IndexedDB because the Universe Bars Pack pre-seeds it
(`barsPackClient.js`); breadth was never in that pack, so every breadth chart and pane — even a
warm, persisted, 70 ms server answer — waited for a network round trip on its first view in a
browser. This is the same idea for the ~173 breadth series: their newest `PACK_BARS` daily bars,
four shards (one per universe), versioned by content, ingested by the same client in idle time.
The deep history and today's developing bar still arrive through the normal fetches.

⛔ BUILT IN THE BACKGROUND, NEVER ON A REQUEST. `refresh()` runs from the breadth warm loop and
reads only already-built series (`build_breadth_bars` / market-indicator `build_bars`, both
cache-first); the routes serve the last finished build or `{"available": false}`.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import logging
import threading
import time
from typing import Optional

_log = logging.getLogger("breadth_pack")

#: Daily bars per series in the pack — the chart's primary window (`/api/bars?bars=600`).
PACK_BARS = 600
SHARDS = ("uct", "us", "nyse", "nasdaq")

_lock = threading.Lock()
_state: dict = {"version": None, "shards": {}, "manifest": None, "built_at": 0.0}
#: The previous build's shards stay addressable: a browser that read the old manifest a moment
#: before a rebuild must still be able to download what that manifest named.
_previous: dict = {"version": None, "shards": {}}


def _today_et() -> str:
    from datetime import datetime
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("America/New_York")).date().isoformat()


def _symbols() -> list:
    """`[(symbol, universe, kind)]` for every served breadth series: the UCT library, every
    published PIT universe's library rows, and the breadth-derived market indicators."""
    from api.services import breadth_symbols as bs
    from api.services import breadth_universes as bu
    out, seen = [], set()
    for sym in bs._METRIC_OF:
        out.append((sym, "uct", "base"))
        seen.add(sym)
    for uni in bu.published_universe_ids():
        if uni == bs.DEFAULT_UNIVERSE:
            continue
        for row in bs.library_rows([uni]):
            sym = row.get("symbol")
            if sym and sym not in seen and bs.is_published(uni, row["metric"]):
                out.append((sym, uni, "base"))
                seen.add(sym)
    try:
        from api.services.market_indicators import registry as reg
        for row in reg.all_rows():
            if row.source_type == reg.SRC_BREADTH_DERIVED and row.symbol not in seen:
                out.append((row.symbol, (row.universe or "us"), "indicator"))
                seen.add(row.symbol)
    except Exception as e:
        _log.warning("[breadth_pack] indicator catalogue unavailable: %s", e)
    return out


def _bars_for(sym: str, kind: str) -> list:
    """The served bars for `sym` — ONLY when its series is already warm (never a build here)."""
    if kind == "indicator":
        from api.services.market_indicators import producers as p
        from api.services.market_indicators import series as mis
        from api.services.market_indicators import registry as reg
        row = reg.get(sym)
        if row is None or f"derived::{row.id.upper()}{p._authority_suffix()}" not in p._cache:
            return []
        return (mis.build_bars(sym, "D", PACK_BARS) or {}).get("bars") or []
    from api.services import breadth_symbols as bs
    if not bs._breadth_cache.get(bs._daily_key(sym)):
        return []
    return (bs.build_breadth_bars(sym, "D", PACK_BARS) or {}).get("bars") or []


def refresh() -> dict:
    """Rebuild the pack from the warm series; a no-op when nothing changed. Never raises."""
    today = _today_et()
    shards: dict = {u: {} for u in SHARDS}
    sig = []
    for sym, uni, kind in _symbols():
        try:
            bars = _bars_for(sym, kind)
        except Exception:
            continue
        # sealed sessions only: today's developing bar comes from the live fetch
        bars = [b for b in bars if str(b.get("t", ""))[:10] < today]
        if not bars:
            continue
        cols = {k: [b.get(k) for b in bars] for k in ("t", "o", "h", "l", "c")}
        cols["v"] = [0] * len(bars)
        shards[uni if uni in shards else "us"][sym] = {"D": cols}
        sig.append((sym, len(bars), bars[-1]["t"], bars[-1].get("c")))
    if not sig:
        return {"ok": False, "reason": "no breadth series built yet"}
    version = "b" + hashlib.sha1(json.dumps(sorted(sig)).encode()).hexdigest()[:16]
    with _lock:
        if _state["version"] == version:
            return {"ok": True, "version": version, "unchanged": True}
    gz = {i: gzip.compress(json.dumps({"tickers": shards[u]}, separators=(",", ":")).encode(), 6)
          for i, u in enumerate(SHARDS)}
    manifest = {"available": True, "version": version, "ticker_count": len(sig),
                "bars": PACK_BARS, "shards": [{"idx": i, "universe": u, "tickers": len(shards[u]),
                                               "bytes": len(gz[i])} for i, u in enumerate(SHARDS)]}
    with _lock:
        _previous.update(version=_state["version"], shards=_state["shards"])
        _state.update(version=version, shards=gz, manifest=manifest, built_at=time.time())
    _log.info("[breadth_pack] built %s: %s series, %s bytes", version, len(sig),
              sum(len(b) for b in gz.values()))
    return {"ok": True, "version": version, "series": len(sig)}


def manifest() -> Optional[dict]:
    with _lock:
        return _state["manifest"]


def shard(version: str, idx: int) -> Optional[bytes]:
    with _lock:
        if version == _state["version"]:
            return _state["shards"].get(idx)
        if version == _previous["version"]:
            return _previous["shards"].get(idx)
        return None
