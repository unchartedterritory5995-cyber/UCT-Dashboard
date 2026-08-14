"""Universe Bars Pack — a once-daily, static D/W/M cache pack for the whole
universe, so a chart's FIRST view is an instant zero-network cache hit for every
user (including brand-new ones).

WHAT IT IS
    Every ET day after the market closes, this repackages the Daily/Weekly/
    Monthly bars the worker ALREADY holds in bars.db into a compact, sharded,
    gzipped artifact and uploads it to R2 (`barspack/latest.json` manifest +
    `barspack/<date>/<NNN>.json.gz` shards). Browsers download it once in the
    background and bulk-import it into IndexedDB (see app barsIDB.idbImportPack),
    so opening any D/W/M chart paints instantly with no network round-trip.

WHY IT'S CHEAP (verified against the existing infra)
    * ZERO provider calls. The bars are read straight out of the local bars.db
      via bars_sqlite.get_bars + bars_fetch._fmt_sqlite_bars — the SAME read +
      serve-time-sanitize path a user request takes, so the pack is byte-
      identical to what /api/bars serves, and building it costs no Massive/
      yfinance calls (exactly like data_sync's delta export).
    * R2 egress is free and the served URL is immutable+versioned, so Cloudflare
      caches it at the edge → ~one origin pull per POP per day, flat at any user
      count.

WHERE IT RUNS
    On the WORKER pod (which has the fullest, most-uniform D/W/M coverage) as a
    daemon thread, gated by BARSPACK_ENABLED=1 (default OFF). The web pod only
    serves the finished artifact (that route is a later phase).

SAFETY
    * Dark by default; nothing changes until BARSPACK_ENABLED=1.
    * A floor check refuses to publish an empty/truncated pack (never overwrites
      a good latest.json with a bad one — mirrors data_sync._assert_shippable_db).
    * The pack is strictly additive on the client: any miss falls through to the
      existing warm-server fetch + skeleton. No regression is possible.
"""
import gzip
import json
import os
import threading
import time
import zlib
from datetime import datetime

try:
    import zoneinfo
    _ET = zoneinfo.ZoneInfo("America/New_York")
except Exception:  # pragma: no cover
    _ET = None

import logging

log = logging.getLogger(__name__)

# ── Config (env-overridable) ─────────────────────────────────────────────────
_PREFIX = "barspack"                 # R2 key prefix
PACK_FORMAT = 1                      # bump if the shard encoding changes
_MARKER_FILE = ".last_barspack_day"  # once-per-ET-day dedup marker (worker volume)
_TFS = ("D", "W", "M")


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except (TypeError, ValueError):
        return default


# ~300 bars per timeframe: comfortably covers the 200-bar default zoom + scroll
# margin. W/M are cheap even at long history (few rows), so 300 W ≈ 6y, 300 M ≈
# 25y. Deeper scroll-back beyond this falls to the existing on-demand fetch.
PACK_DEPTH = _int_env("BARSPACK_DEPTH", 300)
NUM_SHARDS = _int_env("BARSPACK_SHARDS", 12)
# Refuse to publish a pack smaller than these floors — a truncated/empty build
# must never overwrite a good latest.json (the delta-exporter's shippable gate).
MIN_TICKERS = _int_env("BARSPACK_MIN_TICKERS", 1500)
MIN_BARS = _int_env("BARSPACK_MIN_BARS", 300_000)
_GZIP_LEVEL = _int_env("BARSPACK_GZIP_LEVEL", 6)
_KEEP_VERSIONS = _int_env("BARSPACK_KEEP", 2)
_SLEEP_SECONDS = _int_env("BARSPACK_LOOP_SECONDS", 1800)  # 30 min poll
_BOOT_DELAY = _int_env("BARSPACK_BOOT_DELAY", 120)


class BarsPackError(Exception):
    """Raised when a build is unfit to publish (below the size floor)."""


def _now_et() -> datetime:
    return datetime.now(_ET) if _ET else datetime.utcnow()


def _et_today() -> str:
    return _now_et().date().isoformat()


def _universe() -> list[str]:
    """The $300M+ cap universe (app-form tickers, e.g. BRK-B). Same source the
    scans + prewarmer use."""
    path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "cap_universe.json")
    try:
        with open(path) as f:
            arr = json.load(f)
        return [str(t).upper() for t in arr if t]
    except Exception:
        return []


def _shard_of(sym: str, num_shards: int) -> int:
    """Stable shard index for a ticker (crc32 mod N) — deterministic across
    builds so a ticker always lands in the same shard."""
    return zlib.crc32(sym.encode()) % max(1, num_shards)


def _sanitized_bars(sym: str, tf: str, depth: int) -> list[dict]:
    """Up to `depth` most-recent serve-shaped, SANITIZED bars for (sym, tf),
    read-only from bars.db. Returns [] on any miss/error. ZERO provider calls —
    this is the exact read + sanitize path _get_bars_inner serves from, minus any
    fetch/freshness top-up (the worker's db is already warmed universe-wide)."""
    from api.services import bars_sqlite, bars_fetch, bars_sanitize
    try:
        rows = bars_sqlite.get_bars(sym, tf, depth)
    except Exception:
        return []
    if not rows:
        return []
    try:
        # ticker passed → sanitize (split self-heal, ticker-reuse cutoff, wick
        # clamp) applied, byte-identical to what users see. suppress_meta_warm →
        # cold-metadata tickers use the metadata-free sanitize path instead of
        # scheduling a provider fetch, so the whole build costs ZERO FMP calls
        # (the metadata cache still warms on the normal serve/prewarm path).
        with bars_sanitize.suppress_meta_warm():
            return bars_fetch._fmt_sqlite_bars(rows, tf, sym)
    except Exception:
        return []


def _columnar(bars: list[dict]) -> dict:
    """Row bars [{t,o,h,l,c,v}] → columnar arrays. Strips the repeated JSON keys
    (~6x fewer bytes pre-gzip). The client reconstructs rows on ingest. `t` stays
    the server value verbatim (ISO 'YYYY-MM-DD' for D/W/M) — no transform, so no
    divergence risk."""
    return {
        "t": [b["t"] for b in bars],
        "o": [b["o"] for b in bars],
        "h": [b["h"] for b in bars],
        "l": [b["l"] for b in bars],
        "c": [b["c"] for b in bars],
        "v": [b["v"] for b in bars],
    }


def build(depth: int = PACK_DEPTH, num_shards: int = NUM_SHARDS,
          tickers: list[str] | None = None, date: str | None = None) -> dict:
    """Build the whole pack IN MEMORY (no network). Returns
    {"manifest": {...}, "shards": {key: gz_bytes}}.

    Raises BarsPackError if the result is below the size floor (so a bad build
    never gets published). Peak memory ~ one raw shard + all gzipped shards
    (~tens of MB) since each shard is serialized+gzipped then its raw payload is
    freed before the next.
    """
    date = date or _et_today()
    tickers = tickers or _universe()

    # Group tickers by shard so each shard is built + gzipped independently.
    by_shard: dict[int, list[str]] = {}
    for t in tickers:
        by_shard.setdefault(_shard_of(t, num_shards), []).append(t)

    shards: dict[str, bytes] = {}
    manifest_shards: list[dict] = []
    total_tickers = 0
    total_bars = 0

    for idx in range(num_shards):
        syms = by_shard.get(idx, [])
        payload_tickers: dict[str, dict] = {}
        shard_bars = 0
        for sym in syms:
            entry: dict[str, dict] = {}
            for tf in _TFS:
                bars = _sanitized_bars(sym, tf, depth)
                if bars:
                    entry[tf] = _columnar(bars)
                    shard_bars += len(bars)
            if entry:
                payload_tickers[sym] = entry
        if not payload_tickers:
            continue
        raw = json.dumps({"format": PACK_FORMAT, "tickers": payload_tickers},
                         separators=(",", ":")).encode("utf-8")
        gz = gzip.compress(raw, compresslevel=_GZIP_LEVEL)
        key = f"{_PREFIX}/{date}/{idx:03d}.json.gz"
        shards[key] = gz
        manifest_shards.append({
            "name": key,
            "bytes": len(gz),
            "tickers": len(payload_tickers),
            "bars": shard_bars,
        })
        total_tickers += len(payload_tickers)
        total_bars += shard_bars

    if total_tickers < MIN_TICKERS or total_bars < MIN_BARS:
        raise BarsPackError(
            f"pack below floor: {total_tickers} tickers / {total_bars} bars "
            f"(need >= {MIN_TICKERS} / {MIN_BARS}) — refusing to publish"
        )

    manifest = {
        "version": date,
        "built_at": int(time.time()) if _ET else 0,
        "format": PACK_FORMAT,
        "depth": {tf: depth for tf in _TFS},
        "num_shards": num_shards,
        "ticker_count": total_tickers,
        "bar_count": total_bars,
        "shards": manifest_shards,
    }
    return {"manifest": manifest, "shards": shards}


def publish(built: dict) -> dict:
    """Upload a built pack's shards + latest.json to R2, then prune old versions.
    latest.json is written LAST so a reader never sees a manifest pointing at
    shards that aren't uploaded yet. Returns the manifest. Raises if R2 is
    unconfigured or a shard upload fails (so we don't publish a partial pack)."""
    from api.services import data_sync
    if not data_sync.credentials_ok():
        raise BarsPackError("R2 not configured — cannot publish pack")

    manifest = built["manifest"]
    shards = built["shards"]

    # Shards first; latest.json only after every shard is up.
    for key, gz in shards.items():
        if not data_sync.put_bytes(key, gz, "application/gzip"):
            raise BarsPackError(f"shard upload failed: {key}")

    body = json.dumps(manifest, separators=(",", ":")).encode("utf-8")
    if not data_sync.put_bytes(f"{_PREFIX}/latest.json", body, "application/json"):
        raise BarsPackError("manifest upload failed")

    try:
        _prune(_KEEP_VERSIONS, manifest["version"])
    except Exception:
        log.exception("[barspack] prune failed (non-fatal)")
    return manifest


def build_and_upload(depth: int = PACK_DEPTH, num_shards: int = NUM_SHARDS,
                     tickers: list[str] | None = None) -> dict:
    return publish(build(depth=depth, num_shards=num_shards, tickers=tickers))


def _is_date_folder(name: str) -> bool:
    try:
        datetime.strptime(name, "%Y-%m-%d")
        return True
    except (TypeError, ValueError):
        return False


def _prune(keep: int, current: str) -> None:
    """Delete all but the newest `keep` dated pack folders under barspack/.
    Best-effort; the `current` version is always retained."""
    from api.services import data_sync
    cl = data_sync._client()
    bkt = data_sync._bucket()
    if not cl or not bkt:
        return
    dates: set = set()
    resp = cl.list_objects_v2(Bucket=bkt, Prefix=f"{_PREFIX}/")
    for o in resp.get("Contents", []):
        parts = o["Key"].split("/")
        if len(parts) >= 3 and _is_date_folder(parts[1]):
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
        log.info("[barspack] pruned old versions: %s", ", ".join(to_delete))


# ── Once-per-ET-day marker (mirrors data_sync's base-day marker idiom) ────────
def _marker_path() -> str:
    return os.path.join(os.environ.get("DATA_DIR", "/data"), _MARKER_FILE)


def _read_marker() -> str | None:
    try:
        with open(_marker_path()) as f:
            return f.read().strip() or None
    except Exception:
        return None


def _write_marker(day: str) -> None:
    try:
        with open(_marker_path(), "w") as f:
            f.write(day)
    except Exception:
        pass


def status() -> dict:
    """Diagnostics for the worker health surface."""
    return {
        "enabled": os.environ.get("BARSPACK_ENABLED", "0") == "1",
        "last_built_day": _read_marker(),
        "depth": PACK_DEPTH,
        "num_shards": NUM_SHARDS,
    }


def _should_build_now() -> bool:
    """Build once per ET day, AFTER the active data window closes (post ~8pm ET
    or weekend) so the day's bars are complete. The marker dedups within a day."""
    from api.services import data_sync
    if _read_marker() == _et_today():
        return False
    return not data_sync.in_active_data_window()


def _loop() -> None:
    time.sleep(_BOOT_DELAY)
    while True:
        try:
            from api.services import data_sync
            if not data_sync.credentials_ok():
                pass  # R2 not configured on this pod — nothing to do
            elif _should_build_now():
                today = _et_today()
                m = build_and_upload()
                _write_marker(today)
                log.info(
                    "[barspack] published %s: %d tickers, %d bars, %d shards",
                    today, m["ticker_count"], m["bar_count"], len(m["shards"]),
                )
        except BarsPackError as e:
            log.warning("[barspack] not published: %s", e)
        except Exception:
            log.exception("[barspack] build failed (non-fatal)")
        time.sleep(_SLEEP_SECONDS)


def start_barspack_builder() -> None:
    """Start the daily pack builder on the worker. No-op unless BARSPACK_ENABLED=1."""
    if os.environ.get("BARSPACK_ENABLED", "0") != "1":
        return
    threading.Thread(target=_loop, daemon=True, name="barspack-builder").start()
    log.info("[barspack] builder thread started (depth=%d, shards=%d)", PACK_DEPTH, NUM_SHARDS)
