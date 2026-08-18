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
import hashlib
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
# FRESHNESS floor: refuse to publish a pack whose newest DAILY bar is more than
# this many calendar days behind the last expected trading session. The builder
# reads bars.db raw (no per-ticker freshness top-up), trusting the worker's
# universe warm — but if that warm stalls, the build silently packages week-old
# data that every browser then ingests and my daily-staleness gate rejects on
# sight (→ refetch → black screen). This turns that silent failure LOUD: a stale
# build raises BarsPackError, leaving the last good latest.json in place instead
# of overwriting it with staler data. 4 days tolerates a normal Fri→Mon weekend
# gap (build runs ~00:07 ET) while catching a genuine multi-session freeze.
MAX_STALE_DAYS = _int_env("BARSPACK_MAX_STALE_DAYS", 4)
_GZIP_LEVEL = _int_env("BARSPACK_GZIP_LEVEL", 6)
_KEEP_VERSIONS = _int_env("BARSPACK_KEEP", 2)
# Daily-delta tail: the last N bars of each series, shipped as one small file so a
# returning browser catches up (new daily bar + re-aggregated current W/M bar)
# and re-stamps every entry's savedAt (→ never ages out → instant forever) for
# ~1MB instead of re-downloading the full ~40MB pack. 7 covers a user up to ~a
# week behind via mergeDelta; further-behind users re-pull the full pack.
_DELTA_TAIL = _int_env("BARSPACK_DELTA_TAIL", 7)
_SLEEP_SECONDS = _int_env("BARSPACK_LOOP_SECONDS", 1800)  # 30 min poll
_BOOT_DELAY = _int_env("BARSPACK_BOOT_DELAY", 120)


class BarsPackError(Exception):
    """Raised when a build is unfit to publish (below the size floor)."""


def _now_et() -> datetime:
    return datetime.now(_ET) if _ET else datetime.utcnow()


def _et_today() -> str:
    return _now_et().date().isoformat()


def _theme_holding_syms() -> set:
    """Theme-tracker holding symbols from themes_taxonomy.json (repo root).

    Folded into the pack universe so theme stocks OUTSIDE the $300M cap list —
    e.g. small-cap cannabis names like GRWG that the Theme Tracker surfaces — are
    covered too. Best-effort: returns empty on any error (→ pack is just the cap
    universe). Only ~58 of these are net-new beyond cap_universe."""
    try:
        root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        with open(os.path.join(root, "themes_taxonomy.json"), encoding="utf-8") as f:
            tax = json.load(f)
        out: set = set()
        for th in tax.get("themes", []) or []:
            for h in th.get("holdings", []) or []:
                s = h.get("sym") if isinstance(h, dict) else h
                if s:
                    out.add(str(s).upper())
        return out
    except Exception:
        return set()


def _universe() -> list[str]:
    """Pack universe = the $300M+ cap list UNION the Theme Tracker's holdings, so
    both the broad market AND the specific names the app surfaces in themes are
    instant. Tickers with no bars in the worker's db are dropped later (empty
    sanitize → skipped), so this only ever ADDS coverage, never empties."""
    path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "cap_universe.json")
    base: set = set()
    try:
        with open(path) as f:
            base = {str(t).upper() for t in json.load(f) if t}
    except Exception:
        base = set()
    return sorted(base | _theme_holding_syms())


def _shard_of(sym: str, num_shards: int) -> int:
    """Stable shard index for a ticker (crc32 mod N) — deterministic across
    builds so a ticker always lands in the same shard."""
    return zlib.crc32(sym.encode()) % max(1, num_shards)


def _ymd_int(iso: str | None) -> int:
    """'2026-08-11' → 20260811; 0 on anything unparseable."""
    try:
        return int(str(iso)[:10].replace("-", ""))
    except (TypeError, ValueError):
        return 0


def _stale_days(newest_daily_ymd: int, for_date: str | None = None) -> int:
    """Calendar days the pack's newest daily bar is behind the last expected
    trading session. A huge number when the pack has no daily bars at all (0) so
    the freshness floor refuses it. Reuses the serve path's session calendar so
    the builder and the chart agree on 'what session should be present'.

    `for_date` (the ET day being built, 'YYYY-MM-DD') anchors the reference: the
    build runs ~00:07 ET, before the open, so the last expected session is the
    PRIOR trading day. Anchoring on the build date (not wall-clock now) keeps the
    check correct across the midnight boundary and deterministic in tests."""
    if not newest_daily_ymd:
        return 10_000
    try:
        from api.services.bars_fetch import _expected_latest_session_yyyymmdd
        from datetime import date, datetime
        ref = None
        if for_date and _ET:
            y, m, d = (int(x) for x in str(for_date)[:10].split("-"))
            ref = datetime(y, m, d, 0, 30, tzinfo=_ET)
        exp = _expected_latest_session_yyyymmdd(ref)
        e = date(exp // 10000, (exp // 100) % 100, exp % 100)
        n = date(newest_daily_ymd // 10000, (newest_daily_ymd // 100) % 100, newest_daily_ymd % 100)
        return max(0, (e - n).days)
    except Exception:
        return 0  # never let a freshness-calc error block a build


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
    delta_tickers: dict[str, dict] = {}   # last _DELTA_TAIL bars/series, all tickers
    included: set = set()                 # exact ticker SET in the pack → seed
    total_tickers = 0
    total_bars = 0
    newest_daily_ymd = 0                  # max daily bar date seen (freshness floor)

    for idx in range(num_shards):
        syms = by_shard.get(idx, [])
        payload_tickers: dict[str, dict] = {}
        shard_bars = 0
        for sym in syms:
            entry: dict[str, dict] = {}
            dentry: dict[str, dict] = {}
            for tf in _TFS:
                bars = _sanitized_bars(sym, tf, depth)
                if bars:
                    entry[tf] = _columnar(bars)
                    dentry[tf] = _columnar(bars[-_DELTA_TAIL:])
                    shard_bars += len(bars)
                    if tf == "D":
                        newest_daily_ymd = max(newest_daily_ymd, _ymd_int(bars[-1].get("t")))
            if entry:
                payload_tickers[sym] = entry
            if dentry:
                delta_tickers[sym] = dentry
        if not payload_tickers:
            continue
        raw = json.dumps({"format": PACK_FORMAT, "tickers": payload_tickers},
                         separators=(",", ":")).encode("utf-8")
        gz = gzip.compress(raw, compresslevel=_GZIP_LEVEL)
        key = f"{_PREFIX}/{date}/{idx:03d}.json.gz"
        shards[key] = gz
        manifest_shards.append({
            "idx": idx,           # client builds GET /api/barspack/{version}/{idx}
            "name": key,          # raw R2 key (debug)
            "bytes": len(gz),
            "tickers": len(payload_tickers),
            "bars": shard_bars,
        })
        included.update(payload_tickers.keys())
        total_tickers += len(payload_tickers)
        total_bars += shard_bars

    if total_tickers < MIN_TICKERS or total_bars < MIN_BARS:
        raise BarsPackError(
            f"pack below floor: {total_tickers} tickers / {total_bars} bars "
            f"(need >= {MIN_TICKERS} / {MIN_BARS}) — refusing to publish"
        )

    # FRESHNESS floor — refuse a stale pack (see MAX_STALE_DAYS). A pack whose
    # newest daily bar is a week old ships week-old charts to every browser and
    # my daily-staleness gate rejects them on sight. Better to keep the last good
    # pack live and alert than to overwrite it with staler data.
    stale_days = _stale_days(newest_daily_ymd, date)
    if stale_days > MAX_STALE_DAYS:
        raise BarsPackError(
            f"pack too stale: newest daily bar {newest_daily_ymd or 'none'} is "
            f"~{stale_days}d behind the expected session (max {MAX_STALE_DAYS}d) — "
            f"worker bars.db daily warm has likely stalled; refusing to publish"
        )

    # One small delta file (not sharded — it's ~1MB). Same sanitized data, just
    # the tail of each series; a returning browser merges it (mergeDelta) and
    # re-stamps savedAt instead of re-pulling the full pack.
    delta_raw = json.dumps({"format": PACK_FORMAT, "tail": _DELTA_TAIL, "tickers": delta_tickers},
                           separators=(",", ":")).encode("utf-8")
    delta_gz = gzip.compress(delta_raw, compresslevel=_GZIP_LEVEL)
    delta_key = f"{_PREFIX}/{date}/delta.json.gz"
    shards[delta_key] = delta_gz

    # Seed = a stable fingerprint of the exact ticker SET. When it changes (the
    # universe gained/lost names), the client forces a FULL re-ingest instead of
    # a delta — because the delta only maintains entries a browser already has and
    # would never seed a newly-added ticker (e.g. GRWG on the day it's added).
    seed = hashlib.md5(",".join(sorted(included)).encode()).hexdigest()[:12]

    manifest = {
        "version": date,
        "seed": seed,
        "built_at": int(time.time()) if _ET else 0,
        "format": PACK_FORMAT,
        "depth": {tf: depth for tf in _TFS},
        "num_shards": num_shards,
        "ticker_count": total_tickers,
        "bar_count": total_bars,
        "shards": manifest_shards,
        "delta": {"name": delta_key, "bytes": len(delta_gz),
                  "tail": _DELTA_TAIL, "tickers": len(delta_tickers)},
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
