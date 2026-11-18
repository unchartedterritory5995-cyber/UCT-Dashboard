"""Universe live bars, WEB side: every minute bar for every ticker, rolled into 5m
buckets and forwarded to the serving tier (bars-api), which keeps its 5m series
current with them (`api/services/bars_live_store.py` explains the whole design).

The web pod holds the ONE Massive stocks socket (a second connection on the same key
kicks this one off), so the universe feed rides it: `bar_stream` subscribes `AM.*`
when `BARS_UNIVERSE_STREAM_ENABLED=1` and hands every AM event to `on_am` here.

Cost on the shared event loop: `on_am` is a dict update per event (~10k events a
minute in a busy session, arriving as one burst at each minute's close). The flush is
an async HTTP POST every `BARS_LIVE_FLUSH_S`, never a thread and never a DB write.

A bucket is forwarded as a row only if the stream saw it from its FIRST minute. The
one bucket the socket connected inside (the BOUNDARY bucket) is forwarded as its
individual minutes instead: the serving tier fills the minutes before the socket from
the provider and keeps the bucket current from these, so a reconnect never leaves a
bucket that stops updating.

Nothing the serving tier has not acknowledged is dropped: a bucket is pruned only once
a flush carrying it succeeded. If the tier asks for a RESYNC (it restarted, so it
cannot vouch for buckets sent to the process before it), a new epoch starts on the
same socket and the current bucket becomes the new boundary bucket, minutes intact.

**1m** (`BARS_LIVE_1M_ENABLED`, unset = OFF; the serving tier needs the same flag):
each AM minute is already a complete 1m bar, so the payload also carries `m1`, every
minute (`[sym, minute_s, o, h, l, c, v]`) of each dirty bucket and of the boundary
bucket's dirty tickers. `m1` is DERIVED from the same dirty sets as `rows` and
`minutes`, so a failed flush (requeue) resends it and an acknowledged one does not,
exactly like them; a repeated minute replaces itself in `_minutes` before it is sent.
With the flag off the payload is unchanged (no `m1` key).
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Optional

from api.services.vendor_symbols import app_symbol as _vendor_app_symbol

_log = logging.getLogger(__name__)

BUCKET_S = 300
FLUSH_S = float(os.environ.get("BARS_LIVE_FLUSH_S", "3"))
#: Buckets kept per ticker once flushed (the live one and the one before it).
KEEP_BUCKETS = 2
#: Unflushed buckets held per ticker before giving up and starting a new epoch (the
#: serving tier then repairs the gap from the provider). 24 = two hours of outage.
MAX_HELD_BUCKETS = 24

_epoch_ms: Optional[int] = None
_first_full_bucket_s: Optional[int] = None
#: sym -> bucket_s -> minute_ms -> (o, h, l, c, v)
_minutes: dict[str, dict[int, dict[int, tuple]]] = {}
_dirty: set[tuple[str, int]] = set()
#: The boundary bucket (the one the socket connected inside): sym -> minute_ms -> row.
_b0_bucket_s: Optional[int] = None
_b0_minutes: dict[str, dict[int, tuple]] = {}
_b0_dirty: set[str] = set()
#: Buckets carried by the flush in flight (not prunable until it is acknowledged).
_inflight: set[tuple[str, int]] = set()
#: Successful flushes in the current epoch (the tier uses it to spot a missed start).
_epoch_flushes: int = 0
_watermark_ms: int = 0
_stats = {"events": 0, "flushes": 0, "flush_errors": 0, "rows_sent": 0, "minutes_sent": 0,
          "resyncs": 0, "overflows": 0, "last_flush_ok": None, "skipped_marked": 0}
_flush_task: Optional[asyncio.Task] = None
_m1_stats = {"m1_sent": 0}


def enabled() -> bool:
    return os.environ.get("BARS_UNIVERSE_STREAM_ENABLED", "0").strip().lower() in ("1", "true", "yes", "on")


def enabled_1m() -> bool:
    return os.environ.get("BARS_LIVE_1M_ENABLED", "0").strip().lower() in ("1", "true", "yes", "on")


def _app_symbol(sym: str) -> Optional[str]:
    # Massive uses DOT class shares (BRK.B); storage keys use the HYPHEN form. A lowercase-
    # marked vendor ticker (a preferred, `BCpC`) has no key: upper-cased it was Balchem's
    # BCPC, and its minutes were written into Balchem's bars (api/services/vendor_symbols.py).
    return _vendor_app_symbol(sym)


def mark_connected(now_ms: Optional[int] = None) -> None:
    """A new socket. Everything held refers to the old one and is dropped."""
    _new_epoch(now_ms, carry=False)


def resync(now_ms: Optional[int] = None) -> None:
    """A new epoch on the SAME socket: the bucket in progress keeps every minute this
    socket saw and becomes the boundary bucket."""
    _stats["resyncs"] += 1
    _new_epoch(now_ms, carry=True)


def _new_epoch(now_ms: Optional[int], carry: bool) -> None:
    global _epoch_ms, _first_full_bucket_s, _b0_bucket_s, _epoch_flushes
    now_ms = int(now_ms if now_ms is not None else time.time() * 1000)
    b0 = (now_ms // 1000) // BUCKET_S * BUCKET_S
    carried: dict[str, dict[int, tuple]] = {}
    if carry:
        for sym, per in _minutes.items():
            if per.get(b0):
                carried[sym] = dict(per[b0])
        if _b0_bucket_s == b0:
            for sym, mins in _b0_minutes.items():
                carried.setdefault(sym, {}).update(mins)
    _epoch_ms = now_ms
    _first_full_bucket_s = b0 + BUCKET_S
    _b0_bucket_s = b0
    _epoch_flushes = 0
    _minutes.clear()
    _dirty.clear()
    _inflight.clear()
    _b0_minutes.clear()
    _b0_minutes.update(carried)
    _b0_dirty.clear()
    _b0_dirty.update(carried)


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
    s = _app_symbol(sym)
    if s is None:
        _stats["skipped_marked"] += 1
        return
    if t_ms > _watermark_ms:
        _watermark_ms = t_ms
    _stats["events"] += 1
    if bucket < _first_full_bucket_s:
        if bucket == _b0_bucket_s:
            _b0_minutes.setdefault(s, {})[t_ms] = row
            _b0_dirty.add(s)
        return
    per = _minutes.setdefault(s, {})
    per.setdefault(bucket, {})[t_ms] = row  # a repeated minute replaces itself
    _dirty.add((s, bucket))
    if len(per) > KEEP_BUCKETS:
        # Only buckets the tier has acknowledged may go; an unflushed one is kept.
        for old in sorted(per)[:-KEEP_BUCKETS]:
            if (s, old) not in _dirty and (s, old) not in _inflight:
                per.pop(old, None)
        if len(per) > MAX_HELD_BUCKETS:
            _stats["overflows"] += 1
            _log.warning("[bars-live-ingest] %d unflushed buckets held for %s; starting a "
                         "new epoch so the tier repairs the gap", len(per), s)
            resync()


def bucket_row(sym: str, bucket: int) -> Optional[list]:
    mins = (_minutes.get(sym) or {}).get(bucket)
    if not mins:
        return None
    ordered = [mins[k] for k in sorted(mins)]
    return [sym, bucket, ordered[0][0], max(m[1] for m in ordered),
            min(m[2] for m in ordered), ordered[-1][3], sum(m[4] for m in ordered)]


def take_payload() -> dict:
    rows = []
    dirty = list(_dirty)
    for sym, bucket in dirty:
        r = bucket_row(sym, bucket)
        if r is not None:
            rows.append(r)
    _inflight.clear()
    _inflight.update(_dirty)
    _dirty.clear()
    minutes = []
    b0_syms = list(_b0_dirty)
    for sym in b0_syms:
        for t_ms, (o, h, l, c, v) in sorted((_b0_minutes.get(sym) or {}).items()):
            minutes.append([sym, t_ms // 1000, o, h, l, c, v])
    _b0_dirty.clear()
    payload = {
        "epoch_ms": _epoch_ms,
        "seq": _epoch_flushes + 1,
        "first_full_bucket_ms": None if _first_full_bucket_s is None else _first_full_bucket_s * 1000,
        "watermark_ms": _watermark_ms or None,
        "rows": rows,
        "minutes": minutes,
    }
    if enabled_1m():
        payload["m1"] = m1_rows(dirty, b0_syms)
    return payload


def m1_rows(dirty, b0_syms) -> list:
    """Every minute of each dirty bucket (and of each dirty boundary-bucket ticker), as
    `[sym, minute_s, o, h, l, c, v]`. Re-sending a bucket's earlier minutes costs a few
    entries and means a minute the tier wrote over (or never received) comes back with
    the bucket's next minute."""
    out = []
    for sym, bucket in dirty:
        for t_ms, (o, h, l, c, v) in sorted(((_minutes.get(sym) or {}).get(bucket) or {}).items()):
            out.append([sym, t_ms // 1000, o, h, l, c, v])
    for sym in b0_syms:
        for t_ms, (o, h, l, c, v) in sorted((_b0_minutes.get(sym) or {}).items()):
            out.append([sym, t_ms // 1000, o, h, l, c, v])
    return out


def requeue(payload: dict) -> None:
    """A flush failed: everything it carried goes out again with the next one (only if
    the epoch is unchanged; a new epoch's tier repairs the old one's gap itself)."""
    _inflight.clear()
    if payload.get("epoch_ms") != _epoch_ms:
        return
    for r_ in payload.get("rows") or ():
        _dirty.add((r_[0], r_[1]))
    for m in payload.get("minutes") or ():
        _b0_dirty.add(m[0])


def flushed(payload: dict, reply: Optional[dict]) -> None:
    global _epoch_flushes
    _inflight.clear()
    if payload.get("epoch_ms") != _epoch_ms:
        return
    _epoch_flushes += 1
    _stats["flushes"] += 1
    _stats["rows_sent"] += len(payload.get("rows") or ())
    _stats["minutes_sent"] += len(payload.get("minutes") or ())
    if "m1" in payload:
        _m1_stats["m1_sent"] += len(payload.get("m1") or ())
    _stats["last_flush_ok"] = time.time()
    if isinstance(reply, dict) and reply.get("resync"):
        _log.info("[bars-live-ingest] serving tier asked for a resync; new epoch")
        resync()


def _encode_payload(payload: dict) -> bytes:
    import json
    return json.dumps(payload, separators=(",", ":")).encode("utf-8")


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
                if "m1" in payload:
                    # ⛔ OFF THE LOOP. With 1m the body after a busy minute is ~2 MB and its
                    # encode measured 25-45 ms; this loop is the one reading the Massive
                    # socket (web today, stream-ingest after the cutover), so the encode runs
                    # on a worker thread. Without 1m the post is exactly as before.
                    body = await asyncio.to_thread(_encode_payload, payload)
                    r = await client.post(url, content=body, headers={
                        **bars_service_headers(), "Content-Type": "application/json"})
                else:
                    r = await client.post(url, json=payload, headers=bars_service_headers())
                r.raise_for_status()
                try:
                    reply = r.json()
                except Exception:
                    reply = None
            except Exception as e:  # noqa: BLE001
                _stats["flush_errors"] += 1
                # Re-queue: the buckets are still held, so the next flush resends them.
                requeue(payload)
                if _stats["flush_errors"] % 20 == 1:
                    _log.warning("[bars-live-ingest] flush failed: %s", e)
                continue
            flushed(payload, reply)


def start_flusher(loop: asyncio.AbstractEventLoop) -> None:
    global _flush_task
    if _flush_task is None or _flush_task.done():
        _flush_task = loop.create_task(_flush_loop())


def status() -> dict:
    out = {
        "enabled": enabled(),
        "epoch_ms": _epoch_ms,
        "first_full_bucket_s": _first_full_bucket_s,
        "watermark_ms": _watermark_ms,
        "tickers_held": len(_minutes),
        "dirty": len(_dirty),
        "b0_bucket_s": _b0_bucket_s,
        "b0_tickers": len(_b0_minutes),
        "epoch_flushes": _epoch_flushes,
        **_stats,
    }
    if enabled_1m():
        out.update(m1_enabled=True, **_m1_stats)
    return out


def _reset_for_tests() -> None:
    global _epoch_ms, _first_full_bucket_s, _watermark_ms, _b0_bucket_s, _epoch_flushes
    _epoch_ms = _first_full_bucket_s = _b0_bucket_s = None
    _watermark_ms = 0
    _epoch_flushes = 0
    _minutes.clear()
    _dirty.clear()
    _inflight.clear()
    _b0_minutes.clear()
    _b0_dirty.clear()
    for k in _stats:
        _stats[k] = None if k == "last_flush_ok" else 0
    _m1_stats["m1_sent"] = 0
