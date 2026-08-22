"""Intraday Bars Pack — pre-seed PRIOR CLOSED intraday sessions (5m/60m) for the
whole universe so intraday scroll-back is instant, the same way the D/W/M pack
makes daily instant. Phase 4 of the instant-origin plan.

WHY A SEPARATE MODULE (not a barspack param)
    Intraday has a DIFFERENT freshness model than daily: a prior, closed intraday
    session is IMMUTABLE (packable + edge-cacheable); only TODAY's session is live
    (it rides the WS feed + warm store). The daily pack's freshness guard,
    single-depth, and daily-newest-bar logic don't apply. This module reuses
    barspack's PURE, tf-agnostic helpers (_universe / _shard_of / _sanitized_bars /
    _columnar / the session calendar) but keeps its own build/publish/trigger so the
    working daily pack is never entangled or put at risk.

CLOSED-ONLY BY CONSTRUCTION
    build() DROPS the current still-open session's partial bars (keeps only bars at/before
    _last_complete_session_ymd), so no partial in-session bar can leak into the pack — and
    it can therefore build + serve DURING market hours (today's session rides the client's
    live feed / since-fetch on top), not only after 16:30.

SHAPE
    Identical to the daily pack (so the client reuses idbImportPack / decodeShard):
    manifest `intradaypack/latest.json` + `intradaypack/<date>/<NNN>.json.gz` shards +
    a delta. Bars are the exact serve-shaped rows (`{t,o,h,l,c,v}`, intraday `t` =
    unix seconds), read straight from bars.db → zero provider calls.

DARK by default: INTRADAYPACK_ENABLED=1 to build. Strictly additive on the client
    (any miss falls through to the existing warm-server fetch), so no regression.
"""
import gzip
import hashlib
import json
import os
import threading
import time
import logging
from datetime import datetime, date as _date

from api.services.barspack import (
    _ET, _int_env, _et_today, _universe, _shard_of, _sanitized_bars, _columnar,
    _last_complete_session_ymd, BarsPackError,
)

log = logging.getLogger(__name__)

# ── Config (env-overridable) ─────────────────────────────────────────────────
_PREFIX = "intradaypack"
PACK_FORMAT = 1
# TFs packed. 5m + 60m to start (60m is already prewarmed full-universe; 5m is the
# long-tail gap). Comma list, e.g. "5,15,60".
_TFS = tuple(t.strip() for t in os.environ.get("INTRADAYPACK_TFS", "5,60").split(",") if t.strip())
# Per-TF depth (bars). 5m: ~240 ≈ 3 RTH sessions of scroll-back; 60m: ~180 ≈ 5 weeks.
_DEPTHS = {
    "1": _int_env("INTRADAYPACK_DEPTH_1", 390),
    "5": _int_env("INTRADAYPACK_DEPTH_5", 240),
    "15": _int_env("INTRADAYPACK_DEPTH_15", 200),
    "30": _int_env("INTRADAYPACK_DEPTH_30", 180),
    "60": _int_env("INTRADAYPACK_DEPTH_60", 180),
}
NUM_SHARDS = _int_env("INTRADAYPACK_SHARDS", 16)   # slightly more than daily (5m is heavy)
_GZIP_LEVEL = _int_env("INTRADAYPACK_GZIP_LEVEL", 6)
_DELTA_TAIL = _int_env("INTRADAYPACK_DELTA_TAIL", 80)   # ~1 RTH 5m session
_KEEP_VERSIONS = _int_env("INTRADAYPACK_KEEP", 2)
MIN_TICKERS = _int_env("INTRADAYPACK_MIN_TICKERS", 1000)
MIN_BARS = _int_env("INTRADAYPACK_MIN_BARS", 200_000)
_SLEEP_SECONDS = _int_env("INTRADAYPACK_LOOP_SECONDS", 1800)
_BOOT_DELAY = _int_env("INTRADAYPACK_BOOT_DELAY", 180)
_COMPREHENSIVE_RATIO = float(os.environ.get("INTRADAYPACK_COMPREHENSIVE_RATIO", "0.85"))
_COVERAGE_IMPROVE_MIN = float(os.environ.get("INTRADAYPACK_COVERAGE_IMPROVE_MIN", "0.03"))
_SESSION_MARKER_FILE = ".last_intradaypack_session"
# Over-fetch beyond the target depth so that, after DROPPING the current still-open
# session's partial bars (build-during-RTH), we still have ~depth CLOSED bars. Roughly
# one full session (RTH+ext) per tf.
_SESSION_PAD = {"1": 500, "5": 130, "15": 45, "30": 24, "60": 16}


def _depth(tf: str) -> int:
    return _DEPTHS.get(tf, 240)


def _bar_session_ymd(bar: dict) -> int:
    """ET date (YYYYMMDD int) of an intraday bar. `t` is unix seconds (intraday) —
    convert to the ET calendar day so 'newest session' is comparable to
    _last_complete_session_ymd(). 0 on anything unparseable."""
    try:
        t = bar.get("t")
        if isinstance(t, str):   # a D/W/M bar slipped in — use its ISO date
            return int(t[:10].replace("-", ""))
        if _ET:
            return int(datetime.fromtimestamp(int(t), _ET).strftime("%Y%m%d"))
        return int(datetime.utcfromtimestamp(int(t)).strftime("%Y%m%d"))
    except Exception:
        return 0


# ── Session marker (last published intraday session + coverage) ──────────────
def _marker_path() -> str:
    return os.path.join(os.environ.get("DATA_DIR", "/data"), _SESSION_MARKER_FILE)


def _read_marker():
    try:
        raw = open(_marker_path()).read().strip()
        if not raw:
            return (0, 0.0)
        if ":" in raw:
            s, r = raw.split(":", 1)
            return (int(s), float(r))
        return (int(raw), 0.0)
    except Exception:
        return (0, 0.0)


def _write_marker(session_ymd: int, coverage: float = 0.0) -> None:
    try:
        with open(_marker_path(), "w") as f:
            f.write(f"{int(session_ymd)}:{float(coverage):.3f}")
    except Exception:
        pass


def _coverage_ratio(sample: int = 150) -> float:
    """Fraction of a broad universe sample whose newest STORED 5m bar is at/after the
    last complete session. Cheap (get_last_ts only). Gates same-session rebuilds so
    the pack keeps improving as the long tail's 5m warms. 1.0 on error (don't spin)."""
    try:
        from api.services import bars_sqlite
        uni = _universe()
        target = _last_complete_session_ymd()
        if not uni or target is None:
            return 1.0
        probe_tf = "5" if "5" in _TFS else _TFS[0]
        step = max(1, len(uni) // sample)
        samp = uni[::step][:sample]
        if not samp:
            return 1.0
        fresh = 0
        for s in samp:
            try:
                ts = bars_sqlite.get_last_ts(s, probe_tf)   # intraday last_ts = unix seconds
                if ts and _ET and int(datetime.fromtimestamp(int(ts), _ET).strftime("%Y%m%d")) >= target:
                    fresh += 1
            except Exception:
                pass
        return fresh / len(samp)
    except Exception:
        return 1.0


# ── Build ────────────────────────────────────────────────────────────────────
def build(num_shards: int = NUM_SHARDS, tickers: list[str] | None = None,
          date: str | None = None) -> dict:
    """Build the intraday pack IN MEMORY (no network). Returns
    {"manifest": {...}, "shards": {key: gz_bytes}}. Raises BarsPackError below floor."""
    date = date or _et_today()
    tickers = tickers or _universe()

    # The last CLOSED session (weekday < 16:00 ET → yesterday; else today). We pack only
    # bars at/before it, so the pack NEVER carries today's still-forming partial bars and
    # can therefore build + serve DURING market hours (today's session rides the client's
    # live feed / since-fetch on top). Post-close, this == today so nothing is dropped.
    last_complete = _last_complete_session_ymd()
    if last_complete is None:
        raise BarsPackError("intraday pack: no complete session available — refusing to build")

    by_shard: dict[int, list[str]] = {}
    for t in tickers:
        by_shard.setdefault(_shard_of(t, num_shards), []).append(t)

    shards: dict[str, bytes] = {}
    manifest_shards: list[dict] = []
    delta_tickers: dict[str, dict] = {}
    included: set = set()
    total_tickers = 0
    total_bars = 0
    newest_session = 0

    for idx in range(num_shards):
        syms = by_shard.get(idx, [])
        payload: dict[str, dict] = {}
        shard_bars = 0
        for sym in syms:
            entry: dict[str, dict] = {}
            dentry: dict[str, dict] = {}
            for tf in _TFS:
                # Over-fetch, DROP the current still-open session's partial bars, then trim
                # back to the target depth so the pack ends at the last CLOSED bar.
                raw = _sanitized_bars(sym, tf, _depth(tf) + _SESSION_PAD.get(tf, 130))
                bars = [b for b in raw if _bar_session_ymd(b) <= last_complete][-_depth(tf):] if raw else []
                if bars:
                    entry[tf] = _columnar(bars)
                    dentry[tf] = _columnar(bars[-_DELTA_TAIL:])
                    shard_bars += len(bars)
                    newest_session = max(newest_session, _bar_session_ymd(bars[-1]))
            if entry:
                payload[sym] = entry
            if dentry:
                delta_tickers[sym] = dentry
        if not payload:
            continue
        raw = json.dumps({"format": PACK_FORMAT, "tickers": payload}, separators=(",", ":")).encode("utf-8")
        gz = gzip.compress(raw, compresslevel=_GZIP_LEVEL)
        key = f"{_PREFIX}/{date}/{idx:03d}.json.gz"
        shards[key] = gz
        manifest_shards.append({"idx": idx, "name": key, "bytes": len(gz),
                                "tickers": len(payload), "bars": shard_bars})
        included.update(payload.keys())
        total_tickers += len(payload)
        total_bars += shard_bars

    if total_tickers < MIN_TICKERS or total_bars < MIN_BARS:
        raise BarsPackError(
            f"intraday pack below floor: {total_tickers} tickers / {total_bars} bars "
            f"(need >= {MIN_TICKERS} / {MIN_BARS}) — refusing to publish")

    delta_raw = json.dumps({"format": PACK_FORMAT, "tail": _DELTA_TAIL, "tickers": delta_tickers},
                           separators=(",", ":")).encode("utf-8")
    delta_gz = gzip.compress(delta_raw, compresslevel=_GZIP_LEVEL)
    delta_key = f"{_PREFIX}/{date}/delta.json.gz"
    shards[delta_key] = delta_gz

    seed = hashlib.md5(",".join(sorted(included)).encode()).hexdigest()[:12]
    manifest = {
        "version": date,
        "seed": seed,
        "built_at": int(time.time()) if _ET else 0,
        "format": PACK_FORMAT,
        "kind": "intraday",
        "tfs": list(_TFS),
        "depth": {tf: _depth(tf) for tf in _TFS},
        "num_shards": num_shards,
        "ticker_count": total_tickers,
        "bar_count": total_bars,
        "newest_session": newest_session,   # YYYYMMDD of the newest intraday session packed
        "shards": manifest_shards,
        "delta": {"name": delta_key, "bytes": len(delta_gz), "tail": _DELTA_TAIL,
                  "tickers": len(delta_tickers)},
    }
    return {"manifest": manifest, "shards": shards}


def publish(built: dict) -> dict:
    """Upload shards + latest.json to R2 (intradaypack/ prefix), latest.json LAST."""
    from api.services import data_sync
    if not data_sync.credentials_ok():
        raise BarsPackError("R2 not configured — cannot publish intraday pack")
    manifest, shards = built["manifest"], built["shards"]
    for key, gz in shards.items():
        if not data_sync.put_bytes(key, gz, "application/gzip"):
            raise BarsPackError(f"intraday shard upload failed: {key}")
    body = json.dumps(manifest, separators=(",", ":")).encode("utf-8")
    if not data_sync.put_bytes(f"{_PREFIX}/latest.json", body, "application/json"):
        raise BarsPackError("intraday manifest upload failed")
    try:
        _prune(_KEEP_VERSIONS, manifest["version"])
    except Exception:
        log.exception("[intradaypack] prune failed (non-fatal)")
    return manifest


def _prune(keep: int, current: str) -> None:
    """Delete all but the newest `keep` dated shard folders under intradaypack/.
    Best-effort; `current` is always retained. Mirrors barspack._prune (S3 client)."""
    import re
    from api.services import data_sync
    cl = data_sync._client()
    bkt = data_sync._bucket()
    if not cl or not bkt:
        return
    dates: set = set()
    resp = cl.list_objects_v2(Bucket=bkt, Prefix=f"{_PREFIX}/")
    for o in resp.get("Contents", []):
        parts = o["Key"].split("/")
        if len(parts) >= 3 and re.match(r"^\d{4}-\d{2}-\d{2}$", parts[1]):
            dates.add(parts[1])
    dates.add(current)
    to_delete = sorted(dates, reverse=True)[max(1, keep):]
    for d in to_delete:
        if d == current:
            continue
        sub = cl.list_objects_v2(Bucket=bkt, Prefix=f"{_PREFIX}/{d}/")
        for o in sub.get("Contents", []):
            try:
                cl.delete_object(Bucket=bkt, Key=o["Key"])
            except Exception:
                pass
    if to_delete:
        log.info("[intradaypack] pruned old versions: %s", ", ".join(to_delete))


def build_and_upload(tickers: list[str] | None = None) -> dict:
    return publish(build(tickers=tickers))


# ── Trigger + loop ───────────────────────────────────────────────────────────
def _should_build_now(now: datetime | None = None) -> bool:
    """Rebuild post-close whenever a newer CLOSED session exists than the last
    published intraday pack, and keep rebuilding same-session while 5m coverage
    improves (long tail warming) until comprehensive. Never mid-session."""
    if now is None:
        if not _ET:
            return False
        now = datetime.now(_ET)
    # NB: no _safe_to_build (post-close) gate — build() drops today's partial bars, so the
    # pack is CLOSED-only whenever it builds. This lets the pack bootstrap + advance DURING
    # market hours (first-enable, or the daily session roll), not only after 16:30.
    sess = _last_complete_session_ymd(now)
    if sess is None:
        return False
    m_sess, m_ratio = _read_marker()
    if sess > m_sess:
        return True
    if sess == m_sess and m_ratio < _COMPREHENSIVE_RATIO:
        return _coverage_ratio() >= m_ratio + _COVERAGE_IMPROVE_MIN
    return False


def _loop() -> None:
    time.sleep(_BOOT_DELAY)
    while True:
        try:
            from api.services import data_sync
            if data_sync.credentials_ok() and _should_build_now():
                m = build_and_upload()
                cov = _coverage_ratio()
                _write_marker(m.get("newest_session") or 0, cov)
                log.info("[intradaypack] published %s (session %s, coverage %.0f%%): "
                         "%d tickers, %d bars, %d shards", m["version"], m.get("newest_session"),
                         cov * 100, m["ticker_count"], m["bar_count"], len(m["shards"]))
        except BarsPackError as e:
            log.warning("[intradaypack] not published: %s", e)
        except Exception:
            log.exception("[intradaypack] build failed (non-fatal)")
        time.sleep(_SLEEP_SECONDS)


def status() -> dict:
    m_sess, m_ratio = _read_marker()
    return {
        "enabled": os.environ.get("INTRADAYPACK_ENABLED", "0") == "1",
        "tfs": list(_TFS),
        "published_session": m_sess,
        "published_coverage": round(m_ratio, 3),
        "target_session": _last_complete_session_ymd(),
        "should_build_now": _should_build_now(),
    }


def start_intradaypack_builder() -> None:
    """Start the intraday pack builder on the worker. No-op unless INTRADAYPACK_ENABLED=1."""
    if os.environ.get("INTRADAYPACK_ENABLED", "0") != "1":
        return
    threading.Thread(target=_loop, daemon=True, name="intradaypack-builder").start()
    log.info("[intradaypack] builder started (tfs=%s, shards=%d)", ",".join(_TFS), NUM_SHARDS)
