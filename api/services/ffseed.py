"""First-frame seed builder: one compact pack per timeframe with every symbol's NEWEST N bars,
exactly as `/api/bars` serves them, published to R2 and served from the EDGE.

WHY. A chart opened at random (a typed ticker nobody has viewed) must draw in under 20 ms, and one
network round trip alone is longer than that. So everything a chart's FIRST FRAME needs must
already be on the member's device: this module builds those bytes; the browser keeps one file per
timeframe in OPFS and a Worker reads a symbol in ~0.3-2 ms. Format: `ffseed_format.py` and
docs/charts/first-frame-seed-format.md.

WHAT IS IN A PACK (defaults; `FFSEED_DEPTH_<TF>` overrides):

    tf   newest N bars   which bars
    1    600             regular session (RTH) only, 09:30 <= ET start < close (13:00 on a half day)
    5    300             RTH only
    15   300             RTH only
    30   300             RTH only
    60   1000            RTH only, the stored 'session' grid (09:30, 10:30 ... 15:30 half bar):
                         the chart's '60' key, NOT the clock-hour '60e' grid
    D    350             every daily bar (W and M are derived on the device from D)

and only bars of sessions up to the build's AS-OF session (the last closed session), so a build
that runs during a session never freezes a forming bar.

BYTE-IDENTICAL TO /api/bars. Bars are read through the SAME two calls `/api/bars` answers a warm
request with (`bars_fetch._get_bars_inner` Layer 2): `bars_sqlite.get_bars(sym, tf, count)` then
`bars_fetch._fmt_sqlite_bars(rows, tf, sym)` (null/non-positive guard, intraday grid fold, daily
key guard, split self-heal / ticker-reuse cutoff / wick clamp). The read COUNT is the chart's own
first-paint ask (`barsBackfill.firstPaintBarsFor(tf, false)`, `FIRST_PAINT_BARS` for D) so the
sanitizer sees exactly the window the chart's first answer is built from; it grows (doubling) only
when that window holds fewer than N regular-session bars (60m: 1000 RTH bars need ~2,400 stored
rows), which is safe because every intraday transform is per bucket. The RTH filter is the
client's `keepRthBars` / `isRthBar` (barTime.js) on the server's own calendar
(`nyse_calendar`). The encoder refuses (never rounds) a value it cannot hold bit for bit.

A symbol whose newest selected bar is OLDER than the as-of session is left out (`stale`): its
server answer would differ from the seed (the request path heals it), and a first frame that then
jumps is worse than a 100 ms network paint.

WHERE IT RUNS. On the `worker` service (it holds the fullest bars.db and already builds the D/W/M
barspack after the close), as a daemon thread, DARK until `FFSEED_ENABLED=1`. It builds once per
closed session, after `FFSEED_BUILD_AFTER_MIN` (default 20:15 ET: the extended session has ended
and the 8 h mutable-window repairs of the regular-session bars have had hours to land). Zero
provider calls. Worker deploys are manual (docs/runbooks/worker-deploys.md).

CLI (a local build into a directory, no upload)::

    python -m api.services.ffseed --out <dir> [--tfs 5,D] [--symbols AAPL,MSFT] [--comp gzip|raw]
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Dict, Iterable, List, Optional, Tuple

from api.services import ffseed_format as fmt

log = logging.getLogger(__name__)


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except (TypeError, ValueError):
        return default


PREFIX = "ffseed"                      # R2 key prefix
SEED_TFS = fmt.TFS                     # 1 5 15 30 60 D
DEFAULT_DEPTH = {"1": 600, "5": 300, "15": 300, "30": 300, "60": 1000, "D": 350}
#: The chart's first-paint ask per timeframe (app/src/utils/barsBackfill.js): intraday
#: `firstPaintBarsFor(tf, false)` = min(1199, max(600, ceil(target / (390/960)))), D = 600.
#: Pinned by tests/test_ffseed.py against the JS source.
FIRST_PAINT_READ = {"1": 960, "5": 1152, "15": 1152, "30": 1120, "60": 1138, "D": 600}
READ_MAX = _int_env("FFSEED_READ_MAX", 20000)
RTH_OPEN_MIN = 9 * 60 + 30
RTH_CLOSE_MIN = 16 * 60
RTH_EARLY_CLOSE_MIN = 13 * 60
MIN_SYMBOLS = _int_env("FFSEED_MIN_SYMBOLS", 1500)
#: ⭐ A FLOOR PER TIMEFRAME (2026-11-20). The worker's store holds 1-minute bars only for the symbols members
#: and the stream have touched (1,270 of the cap universe for the 2026-11-19 session), so one floor for every
#: timeframe refused the WHOLE first build at its first timeframe. A timeframe's floor is
#: `FFSEED_MIN_SYMBOLS_<tf>` when set, else its entry here, else MIN_SYMBOLS: a store that lost its daily or
#: hourly bars still never replaces a good build, and a symbol left out of a pack loads from the network.
MIN_SYMBOLS_BY_TF = {"1": 1000}


def floor_for(tf: str) -> int:
    """The symbol floor of one timeframe's pack (read at build time, so a variable change needs no deploy)."""
    tf = str(tf)
    return _int_env(f"FFSEED_MIN_SYMBOLS_{tf}", MIN_SYMBOLS_BY_TF.get(tf, MIN_SYMBOLS))


KEEP_BUILDS = _int_env("FFSEED_KEEP", 2)
BUILD_AFTER_MIN = _int_env("FFSEED_BUILD_AFTER_MIN", 20 * 60 + 15)
_SLEEP_SECONDS = _int_env("FFSEED_LOOP_SECONDS", 1800)
_BOOT_DELAY = _int_env("FFSEED_BOOT_DELAY", 300)
_MARKER_FILE = ".last_ffseed_session"
CONTENT_TYPE = "application/vnd.uct.ffseed"
EDGE_PATH = "/api/seed/v1"

try:
    from zoneinfo import ZoneInfo
    ET = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover - a host without tz data cannot build
    ET = None


class SeedBuildError(Exception):
    """A build is unfit to publish."""


class OldGridSeries(Exception):
    """A stored 60m series still on the old clock-hour grid (the serve path rebuilds it first)."""


def depth_for(tf: str) -> int:
    return _int_env(f"FFSEED_DEPTH_{tf}", DEFAULT_DEPTH[tf])


# --------------------------------------------------------------------------------------------
# session calendar (the server's own: api/services/nyse_calendar.py, stdlib only)
# --------------------------------------------------------------------------------------------

def _early_closes() -> frozenset:
    from api.services.nyse_calendar import NYSE_EARLY_CLOSES_YYYYMMDD
    return NYSE_EARLY_CLOSES_YYYYMMDD


def _holidays() -> frozenset:
    from api.services.nyse_calendar import NYSE_HOLIDAYS_YYYYMMDD
    return NYSE_HOLIDAYS_YYYYMMDD


def _et(ts: int) -> datetime:
    return datetime.fromtimestamp(int(ts), ET)


def rth_close_min(ymd: int) -> int:
    return RTH_EARLY_CLOSE_MIN if int(ymd) in _early_closes() else RTH_CLOSE_MIN


def is_rth_bar(ts: int) -> bool:
    """barTime.js `isRthBar`: 09:30 <= ET minute of the bar START < the day's regular close."""
    d = _et(ts)
    m = d.hour * 60 + d.minute
    return RTH_OPEN_MIN <= m < rth_close_min(int(d.strftime("%Y%m%d")))


def is_trading_day(d: date) -> bool:
    return d.weekday() < 5 and int(d.strftime("%Y%m%d")) not in _holidays()


def last_closed_session(now: Optional[datetime] = None, after_min: int = RTH_CLOSE_MIN) -> date:
    """The newest trading day whose regular session closed at least `after_min` ET minutes into
    the day (default: at the close). Before that on a trading day: the previous trading day."""
    now = now or datetime.now(ET)
    d = now.date()
    if is_trading_day(d) and now.hour * 60 + now.minute >= max(after_min, rth_close_min(int(d.strftime("%Y%m%d")))):
        return d
    x = d - timedelta(days=1)
    for _ in range(30):
        if is_trading_day(x):
            return x
        x -= timedelta(days=1)
    return x


def session_ymd_of(bar: dict, tf: str) -> int:
    t = bar.get("t")
    if tf == "D":
        return int(str(t)[:10].replace("-", ""))
    return int(_et(int(t)).strftime("%Y%m%d"))


# --------------------------------------------------------------------------------------------
# selection
# --------------------------------------------------------------------------------------------

def select_window(served: List[dict], tf: str, n: int, asof_ymd: int) -> List[dict]:
    """The newest `n` bars of a served series that the seed holds: sessions <= as-of, and for
    intraday the regular-session view (a bar whose `t` is not a number is never intraday)."""
    out = []
    for b in served:
        t = b.get("t")
        if tf == "D":
            if not isinstance(t, str) or session_ymd_of(b, tf) > asof_ymd:
                continue
        else:
            if isinstance(t, bool) or not isinstance(t, (int, float)):
                continue
            if session_ymd_of(b, tf) > asof_ymd or not is_rth_bar(int(t)):
                continue
        out.append(b)
    return out[-n:] if n > 0 else []


def store_read(sym: str, tf: str, count: int) -> Tuple[List[dict], int]:
    """(served bars, raw stored rows read) through the `/api/bars` warm path. Zero provider calls:
    `suppress_meta_warm` keeps a cold-metadata daily sanitize on the metadata-free path (the same
    path the serve takes for that request) instead of scheduling a vendor fetch, exactly as the
    barspack builder does."""
    from api.services import bars_fetch, bars_sanitize, bars_sqlite
    rows = bars_sqlite.get_bars(sym, tf, count)
    if not rows:
        return [], 0
    if tf == "60" and any(bars_sqlite.is_old_grid_60m_ts(r[0]) for r in rows):
        # `/api/bars` never serves the pre-2026-11-10 clock-hour layout: it REBUILDS the series from
        # 15m/30m first (a store write). The seed never writes: it leaves the symbol out.
        raise OldGridSeries(sym)
    with bars_sanitize.suppress_meta_warm():
        return bars_fetch._fmt_sqlite_bars(rows, tf, sym), len(rows)


def seed_window(sym: str, tf: str, n: int, asof_ymd: int,
                read: Callable[[str, str, int], Tuple[List[dict], int]] = store_read,
                read_max: int = READ_MAX) -> List[dict]:
    """The seed's bars for (sym, tf): read the chart's first-paint window and grow it until it
    holds `n` selectable bars or the store has no more rows."""
    count = FIRST_PAINT_READ[tf]
    while True:
        served, raw = read(sym, tf, count)
        sel = select_window(served, tf, n, asof_ymd)
        if len(sel) >= n or raw < count or count >= read_max:
            return sel
        count = min(read_max, count * 2)


# --------------------------------------------------------------------------------------------
# build
# --------------------------------------------------------------------------------------------

def universe() -> List[str]:
    """The seed universe: api/data/cap_universe.json (3,639 at writing). `FFSEED_UNIVERSE=barspack`
    widens it to the barspack universe (~13k: the active reference feed + cap list + themes)."""
    if os.environ.get("FFSEED_UNIVERSE", "cap") == "barspack":
        from api.services.barspack import _universe
        return list(_universe())
    path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "cap_universe.json")
    with open(path, encoding="utf-8") as f:
        return sorted({str(t).upper() for t in json.load(f) if t})


def build_id(now: Optional[datetime] = None) -> str:
    now = now or datetime.now(timezone.utc)
    return now.astimezone(timezone.utc).strftime("%Y%m%dT%H%MZ")


def build_tf(tf: str, symbols: Iterable[str], asof: date, build: str, *, comp: str = "gzip",
             depth: Optional[int] = None, read=store_read) -> Tuple[bytes, dict]:
    """One timeframe's pack bytes and its stats. A symbol that fails is counted, never fatal."""
    n = depth if depth is not None else depth_for(tf)
    asof_ymd = int(asof.strftime("%Y%m%d"))
    pb = fmt.PackBuilder(tf, asof=asof.isoformat(), build=build, depth=n, comp=comp)
    stats = {"no_bars": 0, "stale": 0, "old_grid": 0, "inexact": 0, "error": 0, "short": 0, "bars": 0}
    for sym in symbols:
        try:
            bars = seed_window(sym, tf, n, asof_ymd, read=read)
        except OldGridSeries:
            stats["old_grid"] += 1
            continue
        except Exception:  # noqa: BLE001 - one bad series never sinks the build
            log.exception("[ffseed] read failed %s tf=%s", sym, tf)
            stats["error"] += 1
            continue
        if not bars:
            stats["no_bars"] += 1
            continue
        if session_ymd_of(bars[-1], tf) < asof_ymd:
            stats["stale"] += 1
            continue
        try:
            facts = pb.add_served(sym, bars)
        except fmt.SeedError as exc:
            log.warning("[ffseed] %s tf=%s not encodable: %s", sym, tf, exc)
            stats["inexact"] += 1
            continue
        stats["bars"] += facts["bars"]
        if facts["bars"] < n:
            stats["short"] += 1
    stats["symbols"] = len(pb)
    stats["depth"] = n
    return pb.finish(), stats


def manifest_entry(tf: str, build: str, data: bytes, stats: dict) -> dict:
    key = f"{PREFIX}/{build}/{tf}.ffs"
    return {
        "key": key, "url": f"{EDGE_PATH}/{build}/{tf}.ffs", "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(), "symbols": stats["symbols"],
        "bars": stats["bars"], "depth": stats["depth"], "tunit": fmt.T_UNIT[tf],
        "skipped": {k: stats[k] for k in ("no_bars", "stale", "old_grid", "inexact", "error")},
        "short": stats["short"],
    }


def build(*, tfs: Iterable[str] = SEED_TFS, symbols: Optional[List[str]] = None,
          asof: Optional[date] = None, comp: str = "gzip", read=store_read,
          now: Optional[datetime] = None, min_symbols: Optional[int] = None,
          on_pack: Optional[Callable[[str, bytes, dict], None]] = None) -> dict:
    """Build every timeframe. Returns {"manifest": {...}, "packs": {tf: bytes}} (or, with
    `on_pack`, hands each pack over as it is finished and keeps no bytes). Raises SeedBuildError
    when a timeframe is below the symbol floor, so a broken store never replaces a good build."""
    symbols = list(symbols) if symbols is not None else universe()
    asof = asof or last_closed_session(now.astimezone(ET) if now else None)
    bid = build_id(now)
    manifest = {
        "v": fmt.FORMAT_VERSION, "kind": fmt.KIND, "build": bid, "asof": asof.isoformat(),
        "built_at": int((now or datetime.now(timezone.utc)).timestamp()), "comp": comp,
        "basis": fmt.BASIS, "grid": fmt.GRID, "universe": {"count": len(symbols)}, "tfs": {},
    }
    packs: Dict[str, bytes] = {}
    for tf in tfs:
        t0 = time.time()
        data, stats = build_tf(tf, symbols, asof, bid, comp=comp, read=read)
        floor = floor_for(tf) if min_symbols is None else min_symbols
        if stats["symbols"] < floor:
            raise SeedBuildError(f"tf {tf}: {stats['symbols']} symbols, floor {floor}: refusing to publish")
        entry = manifest["tfs"][tf] = manifest_entry(tf, bid, data, stats)
        log.info("[ffseed] tf=%s %d symbols %d bars %d bytes in %.1fs", tf, stats["symbols"],
                 stats["bars"], len(data), time.time() - t0)
        if on_pack:
            on_pack(tf, data, entry)
        else:
            packs[tf] = data
    return {"manifest": manifest, "packs": packs}


# --------------------------------------------------------------------------------------------
# publish (R2, DATA_SYNC_* bucket) + the nightly loop
# --------------------------------------------------------------------------------------------

def _upload_pack(entry: dict, data: bytes) -> None:
    from api.services import data_sync
    if not data_sync.put_bytes(entry["key"], data, CONTENT_TYPE):
        raise SeedBuildError(f"upload failed: {entry['key']}")


def _publish_manifest(m: dict) -> dict:
    from api.services import data_sync
    body = json.dumps(m, sort_keys=True, separators=(",", ":")).encode("ascii")
    if not data_sync.put_bytes(f"{PREFIX}/latest.json", body, "application/json"):
        raise SeedBuildError("manifest upload failed")
    try:
        prune(KEEP_BUILDS, m["build"])
    except Exception:  # noqa: BLE001
        log.exception("[ffseed] prune failed (non-fatal)")
    return m


def publish(built: dict) -> dict:
    """Upload every pack of an in-memory build, then `ffseed/latest.json` LAST (a reader never
    sees a manifest that names a pack not yet uploaded), then prune old builds."""
    from api.services import data_sync
    if not data_sync.credentials_ok():
        raise SeedBuildError("R2 not configured")
    m = built["manifest"]
    for tf, data in built["packs"].items():
        _upload_pack(m["tfs"][tf], data)
    return _publish_manifest(m)


def build_and_publish(**kw) -> dict:
    """The nightly path: each pack is uploaded as soon as it is built and then dropped, so the
    worker never holds more than one pack in memory; the manifest goes up last."""
    from api.services import data_sync
    if not data_sync.credentials_ok():
        raise SeedBuildError("R2 not configured")
    built = build(on_pack=lambda tf, data, entry: _upload_pack(entry, data), **kw)
    return _publish_manifest(built["manifest"])


def prune(keep: int, current: str) -> List[str]:
    from api.services import data_sync
    cl, bkt = data_sync._client(), data_sync._bucket()
    if not cl or not bkt:
        return []
    builds = {current}
    for page in cl.get_paginator("list_objects_v2").paginate(Bucket=bkt, Prefix=f"{PREFIX}/"):
        for o in page.get("Contents", []):
            parts = o["Key"].split("/")
            if len(parts) == 3 and len(parts[1]) == 14 and parts[1].endswith("Z"):
                builds.add(parts[1])
    gone = [b for b in sorted(builds, reverse=True)[max(1, keep):] if b != current]
    for b in gone:
        for page in cl.get_paginator("list_objects_v2").paginate(Bucket=bkt, Prefix=f"{PREFIX}/{b}/"):
            for o in page.get("Contents", []):
                try:
                    cl.delete_object(Bucket=bkt, Key=o["Key"])
                except Exception:  # noqa: BLE001
                    pass
    return gone


def _marker_path() -> str:
    return os.path.join(os.environ.get("DATA_DIR", "/data"), _MARKER_FILE)


def _read_marker() -> int:
    try:
        with open(_marker_path(), encoding="ascii") as f:
            return int(f.read().strip() or 0)
    except Exception:  # noqa: BLE001
        return 0


def _write_marker(ymd: int) -> None:
    try:
        tmp = _marker_path() + ".tmp"
        with open(tmp, "w", encoding="ascii") as f:
            f.write(str(int(ymd)))
        os.replace(tmp, _marker_path())
    except Exception:  # noqa: BLE001
        pass


def should_build(now: Optional[datetime] = None, published: Optional[int] = None) -> bool:
    """True once per closed session, after BUILD_AFTER_MIN ET on that session's day (or any time
    after that day). Never for a session already published."""
    now = now or datetime.now(ET)
    target = int(last_closed_session(now, after_min=BUILD_AFTER_MIN).strftime("%Y%m%d"))
    return target > (published if published is not None else _read_marker())


#: A forced rebuild of the newest closed session (whose marker already exists), done once:
#: `FFSEED_FORCE_ASOF=YYYY-MM-DD` on the worker. Recorded here so the variable can stay set.
_FORCED_FILE = ".last_ffseed_forced"


def _forced_path() -> str:
    return os.path.join(os.environ.get("DATA_DIR", "/data"), _FORCED_FILE)


def _read_forced() -> str:
    try:
        with open(_forced_path(), encoding="ascii") as f:
            return f.read().strip()
    except Exception:  # noqa: BLE001
        return ""


def _write_forced(asof_iso: str) -> None:
    try:
        tmp = _forced_path() + ".tmp"
        with open(tmp, "w", encoding="ascii") as f:
            f.write(asof_iso)
        os.replace(tmp, _forced_path())
    except Exception:  # noqa: BLE001
        pass


def forced_rebuild_due(now: Optional[datetime] = None) -> Optional[date]:
    """The session `FFSEED_FORCE_ASOF` asks to rebuild, when that is due: it must BE the newest closed
    session (an older build published after a newer one would roll every device back) and must not have
    been force-built already. Anything else is ignored (logged)."""
    raw = os.environ.get("FFSEED_FORCE_ASOF", "").strip()
    if not raw:
        return None
    try:
        want = date.fromisoformat(raw)
    except ValueError:
        log.warning("[ffseed] FFSEED_FORCE_ASOF=%r is not YYYY-MM-DD: ignored", raw)
        return None
    target = last_closed_session(now or datetime.now(ET), after_min=BUILD_AFTER_MIN)
    if want != target:
        log.warning("[ffseed] FFSEED_FORCE_ASOF=%s is not the newest closed session (%s): ignored", raw, target)
        return None
    if _read_forced() == want.isoformat():
        return None
    return want


def nightly(asof: date) -> dict:
    """One session's build: the long-tail 1m pass, the build and publish, the marker, then the 1m
    retention. The pass and the retention never stop a publish."""
    from api.services import ffseed_onemin as onemin
    if onemin.backfill_enabled():
        try:
            onemin.backfill(asof)
        except Exception:  # noqa: BLE001
            log.exception("[ffseed] 1m backfill failed (building with what the store has)")
    m = build_and_publish(asof=asof)
    _write_marker(max(_read_marker(), int(asof.strftime("%Y%m%d"))))
    log.info("[ffseed] published %s as-of %s: %s", m["build"], m["asof"],
             {tf: (e["symbols"], e["bytes"]) for tf, e in m["tfs"].items()})
    try:
        onemin.retention(asof)
    except Exception:  # noqa: BLE001
        log.exception("[ffseed] 1m retention failed (non-fatal)")
    return m


def tick(now: Optional[datetime] = None) -> Optional[dict]:
    """One pass of the builder loop: a forced rebuild when one is due, else the nightly build when due.
    Returns the published manifest, or None when nothing was built."""
    from api.services import data_sync
    now = now or datetime.now(ET)
    if not data_sync.credentials_ok():
        return None
    forced = forced_rebuild_due(now)
    if forced is not None:
        m = nightly(forced)
        _write_forced(forced.isoformat())
        return m
    if should_build(now):
        return nightly(last_closed_session(now, after_min=BUILD_AFTER_MIN))
    return None


def _loop() -> None:
    time.sleep(_BOOT_DELAY)
    while True:
        try:
            tick()
        except SeedBuildError as e:
            log.warning("[ffseed] not published: %s", e)
        except Exception:  # noqa: BLE001
            log.exception("[ffseed] build failed (non-fatal)")
        time.sleep(_SLEEP_SECONDS)


def start_ffseed_builder() -> bool:
    """Start the nightly builder thread on the worker. No-op unless FFSEED_ENABLED=1."""
    if os.environ.get("FFSEED_ENABLED", "0") != "1":
        return False
    threading.Thread(target=_loop, daemon=True, name="ffseed-builder").start()
    log.info("[ffseed] builder started (tfs=%s)", ",".join(SEED_TFS))
    return True


def status() -> dict:
    return {"enabled": os.environ.get("FFSEED_ENABLED", "0") == "1",
            "published_session": _read_marker(), "should_build_now": should_build(),
            "forced_session": _read_forced() or None,
            "depth": {tf: depth_for(tf) for tf in SEED_TFS}}


def _main(argv=None) -> int:
    import argparse
    ap = argparse.ArgumentParser(description="Build first-frame seed packs into a directory.")
    ap.add_argument("--out", required=True)
    ap.add_argument("--tfs", default=",".join(SEED_TFS))
    ap.add_argument("--symbols", default=None)
    ap.add_argument("--asof", default=None, help="YYYY-MM-DD (default: last closed session)")
    ap.add_argument("--comp", choices=fmt.COMPRESSIONS, default="gzip")
    ap.add_argument("--min-symbols", type=int, default=0)
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)

    def save(tf, data, _entry):
        with open(os.path.join(a.out, f"{tf}.ffs"), "wb") as f:
            f.write(data)

    built = build(tfs=[t for t in a.tfs.split(",") if t],
                  symbols=a.symbols.split(",") if a.symbols else None,
                  asof=date.fromisoformat(a.asof) if a.asof else None,
                  comp=a.comp, min_symbols=a.min_symbols, on_pack=save)
    with open(os.path.join(a.out, "manifest.json"), "w", encoding="ascii") as f:
        json.dump(built["manifest"], f, indent=1, sort_keys=True)
    print(json.dumps({tf: {k: e[k] for k in ("symbols", "bars", "bytes")}
                      for tf, e in built["manifest"]["tfs"].items()}, indent=1))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(_main())
