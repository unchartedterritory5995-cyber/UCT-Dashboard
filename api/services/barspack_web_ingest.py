"""Web-side ingest of the universe Bars Pack into the WEB pod's bars.db.

WHY THIS EXISTS (measured 2026-08-21). The worker warms full-universe D/W/M into
ITS bars.db, but the R2 sync can't carry that to web's serve path:
  * the delta export is a ~10-day recency window → an UNCHANGED long-tail daily bar
    (written once, older than the window) is never in a delta;
  * the once-a-day full-base merge reads a multi-GB tarball into the memory-tight
    web pod's RAM (OOM-fragile) and is SKIPPED on every normal redeploy
    (persistent volume ≥1000 bars → boot pull skipped).
So web's serve path was ~0% warm for the long tail — every first view of an obscure
ticker fell through to a synchronous provider fetch (fast in isolation, 20s under a
scanning load). `tools/bars_warmth_audit.py` is the metric.

THE FIX. The worker ALREADY publishes the universe's D/W/M as a compact
(~120MB gzipped), edge-cached R2 artifact — the `barspack` — for browsers. This
folds that SAME pack into web's bars.db, so a cold view serves from SQLite instead
of the provider. It is deliberately conservative:
  * ADD-ONLY per (ticker,tf,ts) (`put_bars … on_conflict="ignore"`) — never
    downgrades a fresher local bar;
  * writes ONLY series web is entirely MISSING (`get_last_ts is None`) — exactly the
    measured `fetch`/no-rows gap — so the active set (already warm) is untouched and
    the write volume is the long-tail only, not the whole universe;
  * one shard decoded at a time (bounded memory, freed before the next);
  * rate-limited between writes so it never monopolises the single web pod's SQLite
    write-lock (the 2s busy_timeout / 524-outage class) — it is a slow background
    gap-fill, never on the request path.

Gated `BARSPACK_WEB_INGEST_ENABLED=1` (default OFF). Daily/Weekly/Monthly only for
now (the pack's TFs); intraday is a follow-up.
"""
import gzip
import json
import logging
import os
import threading
import time

log = logging.getLogger(__name__)

_PREFIX = "barspack"
_DATE_TFS = ("D", "W", "M")


def _marker_path() -> str:
    return os.path.join(os.environ.get("DATA_DIR", "/data"), ".barspack_web_ingested_version")


def _last_ingested_version() -> str | None:
    try:
        with open(_marker_path()) as f:
            return f.read().strip() or None
    except Exception:
        return None


def _stamp_version(version: str) -> None:
    try:
        with open(_marker_path(), "w") as f:
            f.write(version)
    except Exception:
        pass


def _shard_idx(s) -> int | None:
    """Resolve a shard's numeric index (prefers manifest `idx`, falls back to the
    R2 name) — mirrors the client `_shardIdx`."""
    idx = s.get("idx") if isinstance(s, dict) else None
    if isinstance(idx, int):
        return idx
    if isinstance(idx, str) and idx.strip().isdigit():
        return int(idx)
    name = s.get("name") if isinstance(s, dict) else None
    if isinstance(name, str):
        import re
        m = re.search(r"/(\d+)\.json\.gz$", name)
        if m:
            return int(m.group(1))
    return None


def decode_shard(obj) -> list[tuple]:
    """Columnar shard {tickers:{sym:{tf:{t,o,h,l,c,v}}}} → [(sym, tf, [bars])].
    Pure + defensive (tolerates missing tfs / ragged columns). Mirrors the client
    `decodeShardPayload` so the two decode the same artifact identically."""
    out = []
    tickers = (obj or {}).get("tickers") or {}
    for sym, tfs in tickers.items():
        if not tfs:
            continue
        for tf, cols in tfs.items():
            if not cols or not cols.get("t"):
                continue
            t, o, h, low, c, v = (cols.get("t"), cols.get("o"), cols.get("h"),
                                  cols.get("l"), cols.get("c"), cols.get("v"))
            n = len(t)
            if not (o and h and low and c and v):
                continue
            bars = [{"t": t[i], "o": o[i], "h": h[i], "l": low[i], "c": c[i], "v": v[i]}
                    for i in range(min(n, len(o), len(h), len(low), len(c), len(v)))]
            if bars:
                out.append((str(sym).upper(), tf, bars))
    return out


def ingest_once() -> dict:
    """Fold the current barspack into web's bars.db, add-only, missing-series-only.
    Returns a small status dict. Best-effort: any error is caught and logged."""
    from api.services import data_sync, bars_sqlite

    body = data_sync.get_bytes(f"{_PREFIX}/latest.json")
    if not body:
        return {"ok": False, "reason": "no manifest"}
    try:
        manifest = json.loads(body)
    except Exception:
        return {"ok": False, "reason": "bad manifest json"}
    version = manifest.get("version")
    shards = manifest.get("shards")
    if not version or not isinstance(shards, list) or not shards:
        return {"ok": False, "reason": "manifest missing version/shards"}
    if _last_ingested_version() == version:
        return {"ok": True, "reason": "already ingested", "version": version}

    pace = float(os.environ.get("BARSPACK_WEB_INGEST_PACE_SECS", "0.02"))
    written_series = 0
    written_rows = 0
    skipped_present = 0
    t0 = time.time()
    for s in shards:
        idx = _shard_idx(s)
        if idx is None:
            continue
        gz = data_sync.get_bytes(f"{_PREFIX}/{version}/{idx:03d}.json.gz")
        if not gz:
            continue
        try:
            obj = json.loads(gzip.decompress(gz))
        except Exception:
            continue
        gz = None
        for sym, tf, bars in decode_shard(obj):
            if tf not in _DATE_TFS:
                continue
            try:
                # Fill ONLY what web is entirely missing — the measured no-rows gap.
                # A ticker web already has (even a stale tail) is left to the deltas
                # / reconciliation; we never write over it.
                if bars_sqlite.get_last_ts(sym, tf) is not None:
                    skipped_present += 1
                    continue
                n = bars_sqlite.put_bars(sym, tf, bars, date_tf=True, on_conflict="ignore")
                if n:
                    written_series += 1
                    written_rows += n
                    if pace > 0:
                        time.sleep(pace)  # release the write-lock for the serve path
            except Exception:
                pass  # one bad series never aborts the ingest
        obj = None
    _stamp_version(version)
    dt = time.time() - t0
    log.info("[barspack-web-ingest] version=%s wrote %d series / %d rows "
             "(skipped %d already-present) in %.1fs",
             version, written_series, written_rows, skipped_present, dt)
    return {"ok": True, "version": version, "series": written_series,
            "rows": written_rows, "skipped_present": skipped_present, "secs": round(dt, 1)}


def _loop(interval: int) -> None:
    # Small startup delay so it never competes with the post-deploy boot spike.
    time.sleep(float(os.environ.get("BARSPACK_WEB_INGEST_STARTUP_DELAY_SECS", "90")))
    while True:
        try:
            ingest_once()
        except Exception:
            log.exception("[barspack-web-ingest] cycle failed (non-fatal)")
        time.sleep(interval)


def start_web_ingest() -> None:
    """Start the web-side pack ingest daemon. No-op unless BARSPACK_WEB_INGEST_ENABLED=1."""
    if os.environ.get("BARSPACK_WEB_INGEST_ENABLED") != "1":
        return
    interval = int(os.environ.get("BARSPACK_WEB_INGEST_INTERVAL_SECS", "10800"))  # 3h
    threading.Thread(target=_loop, args=(interval,), daemon=True,
                     name="barspack-web-ingest").start()
    log.info("[barspack-web-ingest] daemon started (interval=%ds)", interval)
