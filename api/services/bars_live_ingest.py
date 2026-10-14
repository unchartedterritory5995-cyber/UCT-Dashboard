"""Universe live bars, WEB side: every minute bar for every ticker, rolled into 5m
buckets and forwarded to the serving tier (bars-api), which keeps its 5m series
current with them (`api/services/bars_live_store.py` explains the whole design).

The web pod holds the ONE Massive stocks socket (a second connection on the same key
kicks this one off), so the universe feed rides it: `bar_stream` subscribes `AM.*`
when `BARS_UNIVERSE_STREAM_ENABLED=1` and hands every AM event to `on_am` here.

Cost on the shared event loop: `on_am` is a dict update per event (~10k events a
minute in a busy session, arriving as one burst at each minute's close). The flush is
an async HTTP POST every `BARS_LIVE_FLUSH_S`, never a thread and never a DB write.

A bucket is forwarded only if the stream saw it from its FIRST minute: one that began
before this socket connected is partial here, and the serving tier backfills it from
the provider instead.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Optional

_log = logging.getLogger(__name__)

BUCKET_S = 300
FLUSH_S = float(os.environ.get("BARS_LIVE_FLUSH_S", "3"))
#: Buckets kept per ticker (the live one and the one before it).
KEEP_BUCKETS = 2

_epoch_ms: Optional[int] = None
_first_full_bucket_s: Optional[int] = None
#: sym -> bucket_s -> minute_ms -> (o, h, l, c, v)
_minutes: dict[str, dict[int, dict[int, tuple]]] = {}
_dirty: set[tuple[str, int]] = set()
_watermark_ms: int = 0
_stats = {"events": 0, "flushes": 0, "flush_errors": 0, "rows_sent": 0, "last_flush_ok": None}
_flush_task: Optional[asyncio.Task] = None


def enabled() -> bool:
    return os.environ.get("BARS_UNIVERSE_STREAM_ENABLED", "0").strip().lower() in ("1", "true", "yes", "on")


def _app_symbol(sym: str) -> str:
    # Massive uses DOT class shares (BRK.B); storage keys use the HYPHEN form.
    return sym.upper().replace(".", "-")


def mark_connected(now_ms: Optional[int] = None) -> None:
    """A new socket. Everything held refers to the old one and is dropped."""
    global _epoch_ms, _first_full_bucket_s
    now_ms = int(now_ms if now_ms is not None else time.time() * 1000)
    _epoch_ms = now_ms
    now_s = now_ms // 1000
    _first_full_bucket_s = (now_s // BUCKET_S + 1) * BUCKET_S
    _minutes.clear()
    _dirty.clear()


def on_am(sym: str, bar: dict) -> None:
    """One `AM` (minute) event. `bar["t"]` is the minute's start in ms."""
    global _watermark_ms
    if _first_full_bucket_s is None:
        return
    try:
        t_ms = int(bar["t"])
        row = (float(bar["o"]), float(bar["h"]), float(bar["l"]), float(bar["c"]), int(bar.get("v") or 0))
    except Exception:
        return
    bucket = (t_ms // 1000) // BUCKET_S * BUCKET_S
    if bucket < _first_full_bucket_s:
        return
    s = _app_symbol(sym)
    per = _minutes.setdefault(s, {})
    per.setdefault(bucket, {})[t_ms] = row  # a repeated minute replaces itself
    if len(per) > KEEP_BUCKETS:
        for old in sorted(per)[:-KEEP_BUCKETS]:
            per.pop(old, None)
    _dirty.add((s, bucket))
    if t_ms > _watermark_ms:
        _watermark_ms = t_ms
    _stats["events"] += 1


def bucket_row(sym: str, bucket: int) -> Optional[list]:
    mins = (_minutes.get(sym) or {}).get(bucket)
    if not mins:
        return None
    ordered = [mins[k] for k in sorted(mins)]
    return [sym, bucket, ordered[0][0], max(m[1] for m in ordered),
            min(m[2] for m in ordered), ordered[-1][3], sum(m[4] for m in ordered)]


def take_payload() -> dict:
    rows = []
    for sym, bucket in list(_dirty):
        r = bucket_row(sym, bucket)
        if r is not None:
            rows.append(r)
    _dirty.clear()
    return {
        "epoch_ms": _epoch_ms,
        "first_full_bucket_ms": None if _first_full_bucket_s is None else _first_full_bucket_s * 1000,
        "watermark_ms": _watermark_ms or None,
        "rows": rows,
    }


async def _flush_loop() -> None:
    import httpx
    from api.bars_auth import bars_service_headers
    origin = os.environ.get("BARS_ORIGIN_URL", "").rstrip("/")
    if not origin:
        _log.warning("[bars-live-ingest] BARS_ORIGIN_URL unset; universe bars not forwarded")
        return
    url = f"{origin}/internal/live-bars"
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=3.0)) as client:
        while True:
            await asyncio.sleep(FLUSH_S)
            if _epoch_ms is None:
                continue
            payload = take_payload()
            try:
                r = await client.post(url, json=payload, headers=bars_service_headers())
                r.raise_for_status()
                _stats["flushes"] += 1
                _stats["rows_sent"] += len(payload["rows"])
                _stats["last_flush_ok"] = time.time()
            except Exception as e:  # noqa: BLE001
                _stats["flush_errors"] += 1
                # Re-queue: the buckets are still held, so the next flush resends them.
                for r_ in payload["rows"]:
                    _dirty.add((r_[0], r_[1]))
                if _stats["flush_errors"] % 20 == 1:
                    _log.warning("[bars-live-ingest] flush failed: %s", e)


def start_flusher(loop: asyncio.AbstractEventLoop) -> None:
    global _flush_task
    if _flush_task is None or _flush_task.done():
        _flush_task = loop.create_task(_flush_loop())


def status() -> dict:
    return {
        "enabled": enabled(),
        "epoch_ms": _epoch_ms,
        "first_full_bucket_s": _first_full_bucket_s,
        "watermark_ms": _watermark_ms,
        "tickers_held": len(_minutes),
        "dirty": len(_dirty),
        **_stats,
    }


def _reset_for_tests() -> None:
    global _epoch_ms, _first_full_bucket_s, _watermark_ms
    _epoch_ms = _first_full_bucket_s = None
    _watermark_ms = 0
    _minutes.clear()
    _dirty.clear()
