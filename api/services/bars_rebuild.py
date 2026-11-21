"""Deep daily history rebuilt from ONE checked source, served per ticker (2026-11-18).

WHY. The stored daily history is a patchwork: yfinance before the vendor's first bar, the vendor's per-TICKER
bars after it, gap fills, serve-time corrections. Compared day by day with an independent vendor, 470 of 3,605
tickers disagreed for 15+ bars in a row (cliffs at the vendor's 2003-09-10 archive start, MNST x75; one-bar
spikes; ASB showing ~$2 through 2006 when it traded at $32; splits the reference lacked). The rebuild
(tools/history_lake/daily_{build,join,check}.py) takes the vendor's OFFICIAL daily files per company on one
split basis, joins earlier history only on one proven ratio, and was checked the same way: 160 of 3,605 with
such a stretch. It is served only for the tickers where it checks out at least as well as the stored series
and changes a bar (the serve list, 551 on 2026-11-18); everywhere else nothing moves.

WHAT IT DOES, at serve time (`bars_sanitize.sanitize_daily_bars`, the one path /api/bars, /api/bars-history
and the daily pack share), for a ticker the manifest names:
  * D: the rebuilt bars through the rebuild's last session (`end`), the stored bars after it (today's live
    bars still come from the store);
  * W / M: the rebuilt daily bars resampled with the app's one resampler for every period that ENDED before
    `end`'s period, the stored W / M rows from that period on (the developing week / month stays live);
  * `history_epoch`: what to add to the served `history_rev`, so a browser holding an older copy replaces it.
Store readers (RS Rating, the screener build) read the store and are not changed by this.

WHERE THE DATA COMES FROM. The bars bucket (`DATA_SYNC_*`, the same bucket every service already pulls its
bars from): `daily-rebuild/manifest.json` names the version, `end` and the served symbols; each symbol is
`daily-rebuild/v<N>/<SYM>.json.gz`. A background thread syncs them to `<DATA_DIR>/bars_rebuild/` at boot and
every 15 minutes, manifest LAST, and the local copy is what is served (a restart serves at once, offline).
The rollout widens by publishing a new manifest; no deploy.

KILL SWITCH: `BARS_REBUILD_SERVE=0` (docs/feature_flags.json): nothing is synced, read or served.
Never raises: any failure serves the stored bars exactly as before.
"""
from __future__ import annotations

import gzip
import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Optional

_log = logging.getLogger(__name__)

ENV_SERVE = "BARS_REBUILD_SERVE"
PREFIX = "daily-rebuild/"
MANIFEST_KEY = PREFIX + "manifest.json"
#: Added to a rebuilt series' served history_rev, once per manifest version (a different scale from
#: bars_identity's, so the two epochs never cancel or collide).
EPOCH_STEP = 10_000_000
#: One manifest read per interval (a few hundred bytes); series are fetched only when new. A widened or
#: narrowed rollout reaches every pod within this, with no deploy.
SYNC_EVERY_S = 15 * 60
DATE_TFS = ("D", "W", "M")
_CACHE_MAX = 64

_lock = threading.Lock()

#: ⭐ PER-TICKER REVS (U5, 2026-11-21). The manifest's `revs` = {SYM: rev} for symbols AND retired: rev is the version
#: at which THAT ticker last changed (its payload bytes, newly listed, re-listed, retired). Its payload lives at
#: v<rev>/<SYM>.json.gz and its epoch is rev x EPOCH_STEP, so a publish that changes one ticker moves one ticker's
#: history_rev, and every term only rises. A manifest without `revs` (the first versions) means rev = version for all.
_state = {"version": 0, "end": None, "symbols": frozenset(), "retired": frozenset(), "revs": {}, "loaded": False}
_cache: dict = {}          # (sym, version) -> [bar dicts]
_thread: Optional[threading.Thread] = None


def enabled() -> bool:
    return os.environ.get(ENV_SERVE, "1").strip().lower() not in ("0", "false", "no", "off")


def local_dir() -> Path:
    return Path(os.environ.get("DATA_DIR", "/data")) / "bars_rebuild"


def _set_manifest(m: dict) -> None:
    with _lock:
        _state.update(version=int(m.get("version") or 0), end=m.get("end"),
                      symbols=frozenset(str(s).upper() for s in (m.get("symbols") or ())),
                      retired=frozenset(str(s).upper() for s in (m.get("retired") or ())),
                      revs={str(k).upper(): int(v) for k, v in (m.get("revs") or {}).items()}, loaded=True)
        _cache.clear()


def load_local() -> bool:
    """The manifest already on this volume (a restart serves at once). False when there is none."""
    try:
        m = json.loads((local_dir() / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    _set_manifest(m)
    return True


def _rev(sym: str, revs=None, version=None) -> int:
    revs = _state["revs"] if revs is None else revs
    return int(revs.get(sym) or (_state["version"] if version is None else version))


def _write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def sync(client=None, bucket: Optional[str] = None) -> dict:
    """Bring the local copy to the bucket's manifest: every named symbol's series first, the manifest last.
    Never raises; returns what it did."""
    out = {"ok": False, "fetched": 0, "removed": 0}
    if not enabled():
        out["reason"] = "disabled"
        return out
    try:
        if client is None:
            from api.services import data_sync
            client, bucket = data_sync._client(), data_sync._bucket()
        if client is None or not bucket:
            out["reason"] = "no bucket credentials"
            return out
        m = json.loads(client.get_object(Bucket=bucket, Key=MANIFEST_KEY)["Body"].read())
        version = int(m.get("version") or 0)
        # ⛔ VERSIONS ONLY RISE (U5): an older manifest would lower every epoch it names.
        if _state["loaded"] and version < int(_state["version"] or 0):
            out["reason"] = f"refused: manifest v{version} is older than v{_state['version']} on this volume"
            _log.warning("[bars-rebuild] %s", out["reason"])
            return out
        syms = sorted({str(s).upper() for s in (m.get("symbols") or ())})
        revs = {str(k).upper(): int(v) for k, v in (m.get("revs") or {}).items()}
        want = {(s, _rev(s, revs, version)) for s in syms}
        for s, rv in sorted(want):
            p = local_dir() / f"v{rv}" / f"{s}.json.gz"
            if not p.exists():
                body = client.get_object(Bucket=bucket, Key=f"{PREFIX}v{rv}/{s}.json.gz")["Body"].read()
                json.loads(gzip.decompress(body))          # a body that does not parse is never kept
                _write_atomic(p, body)
                out["fetched"] += 1
        for p in list(local_dir().glob("v*/*.json.gz")):
            if (p.name[:-len(".json.gz")], int(p.parent.name[1:]) if p.parent.name[1:].isdigit() else -1) not in want:
                p.unlink(missing_ok=True)
                out["removed"] += 1
        _write_atomic(local_dir() / "manifest.json", json.dumps(m).encode("utf-8"))
        _set_manifest(m)
        out.update(ok=True, version=version, symbols=len(syms))
    except Exception as e:  # noqa: BLE001 - a failed sync keeps serving what is on the volume
        out["reason"] = f"{type(e).__name__}: {e}"
        _log.warning("[bars-rebuild] sync failed: %s", out["reason"])
    return out


def start_background_sync() -> None:
    """Load the local copy, then sync now and every SYNC_EVERY_S, on a daemon thread."""
    global _thread
    if not enabled() or (_thread is not None and _thread.is_alive()):
        return
    load_local()

    def _loop():
        while True:
            sync()
            time.sleep(SYNC_EVERY_S)

    _thread = threading.Thread(target=_loop, name="bars-rebuild-sync", daemon=True)
    _thread.start()


def active(ticker: str) -> bool:
    if not enabled() or not _state["loaded"]:
        return False
    return str(ticker or "").upper() in _state["symbols"]


def series(ticker: str) -> Optional[list]:
    """The rebuilt daily bars of `ticker` as bar dicts ({t, o, h, l, c, v}, ascending), or None."""
    sym = str(ticker or "").upper()
    version = _rev(sym)
    key = (sym, version)
    hit = _cache.get(key)
    if hit is not None:
        return hit
    try:
        raw = json.loads(gzip.decompress((local_dir() / f"v{version}" / f"{sym}.json.gz").read_bytes()))
        bars = [{"t": b[0], "o": b[1], "h": b[2], "l": b[3], "c": b[4], "v": b[5]} for b in raw["bars"]]
    except Exception:  # noqa: BLE001 - not on the volume (yet): the stored bars are served
        return None
    with _lock:
        if len(_cache) >= _CACHE_MAX:
            _cache.pop(next(iter(_cache)))
        _cache[key] = bars
    return bars


def _period_start(t: str, tf: str) -> str:
    import datetime as _dt
    d = _dt.date.fromisoformat(str(t)[:10])
    if tf == "W":
        return (d - _dt.timedelta(days=d.weekday())).isoformat()
    return d.replace(day=1).isoformat()


def apply(ticker: str, bars: list, tf: str, head: bool = False) -> Optional[list]:
    """`ticker`'s served D/W/M bars with the rebuilt history in place, or None when it does not apply
    (not on the served list, switched off, not on this volume yet, a failure).

    `head`: the stored bars asked for start at the store's first row (a whole-history read): the rebuilt
    history is served whole, joined depth included. Otherwise only from the first period asked for: a
    600-bar first paint stays 600-ish bars, it never becomes a 10,000-bar answer."""
    tf = str(tf).upper()
    if tf not in DATE_TFS or not active(ticker) or not bars:
        return None
    try:
        reb = series(ticker)
        end = _state["end"]
        if not reb or not end:
            return None
        # The corrections ledger's entries measured on the REBUILT series (bars_corrections, src "rebuild"), applied
        # to the daily bars BEFORE the W / M resample, so weekly and monthly derive from the corrected dailies.
        from api.services import bars_corrections as _cor
        reb = _cor.apply(ticker, "D", reb, "rebuild")
        reb = [b for b in reb if b["t"] <= end]
        if tf == "D":
            out = [dict(b) for b in reb] + [b for b in bars if str(b.get("t"))[:10] > end]
            lo = None if head else str(bars[0].get("t"))[:10]
            return out if lo is None else [b for b in out if str(b["t"])[:10] >= lo]
        from api.services import bars_fetch as _bf
        built = _bf._resample_weekly_iso(reb, ticker) if tf == "W" else _bf._resample_monthly_iso(reb, ticker)
        cut = _period_start(end, tf)          # the period `end` falls in is still forming in the rebuild
        older = [b for b in built if _period_start(b["t"], tf) < cut]
        newer = [b for b in bars if _period_start(str(b.get("t"))[:10], tf) >= cut]
        out = older + newer
        if head:
            return out
        lo = _period_start(str(bars[0].get("t"))[:10], tf)
        return [b for b in out if _period_start(str(b["t"])[:10], tf) >= lo]
    except Exception as e:  # noqa: BLE001 - never blank a chart
        _log.warning("[bars-rebuild] apply failed for %s tf=%s: %s", ticker, tf, e)
        return None


def history_epoch(ticker: str, tf: str) -> int:
    """What to add to `ticker`'s served history_rev at `tf`: the manifest version's epoch while its rebuilt
    history is served, else 0."""
    if str(tf).upper() not in DATE_TFS or not enabled() or not _state["loaded"]:
        return 0
    sym = str(ticker or "").upper()
    if sym in _state["retired"]:
        return _rev(sym) * EPOCH_STEP           # a ticker taken back keeps a RISING epoch (browsers replace their copy)
    if not active(ticker):
        return 0
    # ⛔ Only while the rebuilt series is ON THIS VOLUME: a pod still syncing serves the stored bars, and
    # must not label them with the newer history (a browser would keep them as the new history).
    if series(ticker) is None:
        return 0
    return _rev(sym) * EPOCH_STEP


def status() -> dict:
    return {"enabled": enabled(), "loaded": _state["loaded"], "version": _state["version"], "end": _state["end"],
            "symbols": len(_state["symbols"]), "cached": len(_cache)}
