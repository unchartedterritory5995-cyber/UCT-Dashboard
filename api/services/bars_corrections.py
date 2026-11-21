"""Per-bar corrections of served D/W/M history from ONE published ledger (price-data unit, 2026-11-20).

WHY. The served daily history carries bad values that two sources prove wrong: one-minute vendor prints that set a
day's high or low (SPY 2005-10-05 low 112.09 against 119.57 at Yahoo and in every other minute of the vendor's own
file), single-day closes, prices stored rounded to 2 decimals, zero-volume placeholder bars Yahoo writes on days a
stock did not trade. They live in two places members read from: the rebuilt history (bars_rebuild) and bars.db on
three separate volumes. An edit to an old stored row does not travel between those volumes (deltas carry only recent
D rows, the merge adds only above a pod's own MAX(ts)), and any deep re-fetch writes the vendor's value back
(INSERT OR REPLACE). So a correction is a LEDGER ENTRY applied where bars are read, by compare-and-set: it changes a
value only while the bar still holds the value the ledger says is wrong.

THE PAYLOAD (bars bucket, private): `daily-corrections/v<N>/<SYM>.json.gz`
    {"sym": "SPY", "version": N, "entries": [
        {"tf": "D", "src": "store", "d": "2005-10-05", "op": "set", "f": {"l": [112.09, 119.57]}, "chk": {"c": 119.63}},
        {"tf": "D", "src": "rebuild", "d": "1981-08-10", "op": "drop", "old": [o, h, l, c, v]}, ...]}
  * `src` says which series the entry was measured on: "store" (bars.db rows) or "rebuild" (bars_rebuild's series).
  * `set`: each field moves from old to new only while the bar's field equals old (PER FIELD); `chk` names undisputed
    fields that must agree within CHK_TOL, so a replaced or re-based bar is left alone. A result whose high is below
    its body or whose low is above it is refused whole.
  * `drop`: the bar is removed only while all of o, h, l, c, v equal `old`.
  * Unknown ops are ignored (a newer ledger never breaks an older applier).
THE MANIFEST, written LAST: `daily-corrections/manifest.json`
    {"version": N, "built_at": ..., "stage": ..., "symbols": [with entries], "retired": [had entries earlier]}
  ⛔ VERSIONS ONLY RISE. A manifest older than the one on this volume is refused. A browser replaces its cached history
  only when `history_rev` RISES (app reducer `histRose`), so the epoch covers `symbols` AND `retired`: a revert is a
  HIGHER version without the entries, and the browser still replaces its corrected copy.

KILL SWITCH: BARS_CORRECTIONS_SERVE=0 (docs/feature_flags.json). With no manifest on the volume it does nothing.
Never raises: any failure serves the bars exactly as they came in.
"""
from __future__ import annotations

import contextlib
import contextvars
import gzip
import json
import logging
import os
import threading
import time
from collections import Counter
from pathlib import Path
from typing import Optional

_log = logging.getLogger(__name__)

ENV_SERVE = "BARS_CORRECTIONS_SERVE"
PREFIX = "daily-corrections/"
MANIFEST_KEY = PREFIX + "manifest.json"
#: Added to a corrected (or retired) series' served history_rev, once per ledger version. A different scale from
#: bars_identity's (1e6) and bars_rebuild's (1e7).
EPOCH_STEP = 100_000_000
SYNC_EVERY_S = 15 * 60
DATE_TFS = ("D", "W", "M")
SOURCES = ("store", "rebuild")
#: A field equals the ledger's old value within this (relative, with an absolute floor): prices are stored at 4 dp.
EQ_TOL = 5e-5
#: A `chk` field (undisputed) must agree within this: the same bar, not a replaced or re-based one.
CHK_TOL = 0.005
_CACHE_MAX = 64
#: ⚡ The cache is bounded by ENTRIES too: a 2-decimal re-precision (D5) ticker carries ~10,000 entries, and 64 of those
#: as parsed JSON dicts would hold most of a gigabyte on the bars-api pod. Entries are kept as small tuples (`_compact`)
#: and the cache drops its oldest tickers past this many entries.
_CACHE_ENTRIES_MAX = 200_000
#: What this applier understands. A manifest's `requires` naming anything else is REFUSED whole (this pod keeps the
#: version it has), so a feature can never half-apply across pods running different code.
#: "list_old" (U6): a set field's old may be a list of candidate olds; any one matching moves it to the one new.
APPLIER_FEATURES = frozenset({"list_old"})

_lock = threading.Lock()

#: ⭐ PER-TICKER REVS (U5, 2026-11-21). The manifest's `revs` = {SYM: rev} for symbols AND retired: rev is the version
#: at which THAT ticker last changed (its payload bytes, newly listed, re-listed, retired). Its payload lives at
#: v<rev>/<SYM>.json.gz and its epoch is rev x EPOCH_STEP, so a publish that changes one ticker moves one ticker's
#: history_rev, and every term only rises. A manifest without `revs` (the first versions) means rev = version for all.
_state = {"version": 0, "symbols": frozenset(), "retired": frozenset(), "revs": {}, "loaded": False}
_cache: dict = {}           # (sym, version) -> ({(tf, src): {date: [compact entry, ...]}}, n_entries)
_counts: Counter = Counter()
_thread: Optional[threading.Thread] = None


def enabled() -> bool:
    return os.environ.get(ENV_SERVE, "1").strip().lower() not in ("0", "false", "no", "off")


def local_dir() -> Path:
    return Path(os.environ.get("DATA_DIR", "/data")) / "bars_corrections"


def _set_manifest(m: dict) -> None:
    with _lock:
        _state.update(version=int(m.get("version") or 0),
                      symbols=frozenset(str(s).upper() for s in (m.get("symbols") or ())),
                      retired=frozenset(str(s).upper() for s in (m.get("retired") or ())),
                      revs={str(k).upper(): int(v) for k, v in (m.get("revs") or {}).items()}, loaded=True)
        _cache.clear()


def load_local() -> bool:
    """The manifest already on this volume (a restart applies at once). False when there is none."""
    try:
        m = json.loads((local_dir() / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    _set_manifest(m)
    return True


def _rev(sym: str, revs=None, version=None) -> int:
    """The version a ticker's payload was published at (its file locator and its epoch)."""
    revs = _state["revs"] if revs is None else revs
    return int(revs.get(sym) or (_state["version"] if version is None else version))


def _write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def decode_payload(body: bytes) -> dict:
    """The one reader of a payload body (the publisher round-trips through it). Raises on anything malformed."""
    doc = json.loads(gzip.decompress(body))
    if not isinstance(doc, dict) or not isinstance(doc.get("entries"), list):
        raise ValueError("not a corrections payload")
    return doc


def encode_payload(sym: str, version: int, entries: list) -> bytes:
    """The one writer of a payload body (tools/history_lake/daily_corrections.py publishes through it)."""
    body = {"sym": str(sym).upper(), "version": int(version), "entries": entries}
    return gzip.compress(json.dumps(body, separators=(",", ":")).encode("utf-8"), 6)


def sync(client=None, bucket: Optional[str] = None) -> dict:
    """Bring the local copy to the bucket's manifest: every named symbol's payload first, the manifest last.
    Refuses a manifest older than the one on this volume. Never raises; returns what it did."""
    out = {"ok": False, "fetched": 0}
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
        missing = sorted(set(m.get("requires") or ()) - APPLIER_FEATURES)
        if missing:
            out["reason"] = f"refused: manifest v{version} requires {missing}, which this applier does not support"
            _log.warning("[bars-corrections] %s", out["reason"])
            return out
        if version < int(_state["version"] or 0):
            out["reason"] = f"refused: manifest v{version} is older than v{_state['version']} on this volume"
            _log.warning("[bars-corrections] %s", out["reason"])
            return out
        syms = sorted({str(s).upper() for s in (m.get("symbols") or ())})
        revs = {str(k).upper(): int(v) for k, v in (m.get("revs") or {}).items()}
        for s in syms:
            rv = _rev(s, revs, version)
            p = local_dir() / f"v{rv}" / f"{s}.json.gz"
            if not p.exists():
                body = client.get_object(Bucket=bucket, Key=f"{PREFIX}v{rv}/{s}.json.gz")["Body"].read()
                doc = decode_payload(body)                     # a body that does not parse is never kept
                if int(doc.get("version") or -1) != rv or str(doc.get("sym") or "").upper() != s:
                    raise ValueError(f"payload for {s} does not name v{rv}/{s}")
                _write_atomic(p, body)
                out["fetched"] += 1
        _write_atomic(local_dir() / "manifest.json", json.dumps(m).encode("utf-8"))
        _set_manifest(m)
        out.update(ok=True, version=version, symbols=len(syms), retired=len(m.get("retired") or ()))
    except Exception as e:  # noqa: BLE001 - a failed sync keeps applying what is on the volume
        out["reason"] = f"{type(e).__name__}: {e}"
        _log.warning("[bars-corrections] sync failed: %s", out["reason"])
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

    _thread = threading.Thread(target=_loop, name="bars-corrections-sync", daemon=True)
    _thread.start()


def active(ticker: str) -> bool:
    if not enabled() or not _state["loaded"]:
        return False
    return str(ticker or "").upper() in _state["symbols"]


def _index(ticker: str) -> Optional[dict]:
    """{(tf, src): {date: [entry, ...]}} for `ticker`, or None (not listed, not on this volume, unreadable)."""
    if not active(ticker):
        return None
    sym = str(ticker).upper()
    rv = _rev(sym)
    key = (sym, rv)
    hit = _cache.get(key)
    if hit is not None:
        return hit[0]
    try:
        doc = decode_payload((local_dir() / f"v{rv}" / f"{sym}.json.gz").read_bytes())
    except Exception:  # noqa: BLE001 - not on the volume (yet): nothing is applied
        return None
    idx: dict = {}
    n = 0
    for e in doc["entries"]:
        c = _compact(e) if isinstance(e, dict) else None
        if c is None:
            continue
        idx.setdefault((str(e.get("tf")).upper(), e.get("src")), {}).setdefault(str(e.get("d"))[:10], []).append(c)
        n += 1
    with _lock:
        while _cache and (len(_cache) >= _CACHE_MAX or sum(v[1] for v in _cache.values()) + n > _CACHE_ENTRIES_MAX):
            _cache.pop(next(iter(_cache)))
        _cache[key] = (idx, n)
    return idx


def _compact(e: dict):
    """An entry as a small tuple, or None when it is malformed or an op this applier does not know.
    ("set", ((field, old, new), ...), ((chk_field, value), ...)) | ("drop", (o, h, l, c, v)) | ("keep", field, value)"""
    try:
        op = e.get("op")
        if op == "set":
            f = tuple(x for x in (_field(k, p) for k, p in (e.get("f") or {}).items()) if x is not None)
            chk = tuple((k, float(v)) for k, v in (e.get("chk") or {}).items() if k in ("o", "h", "l", "c"))
            return ("set", f, chk) if f else None
        if op == "drop":
            old = e.get("old") or ()
            return ("drop", tuple(float(x or 0) for x in old)) if len(old) == 5 else None
        if op == "keep_wick" and e.get("field") in ("h", "l") and e.get("value") is not None:
            return ("keep", e["field"], float(e["value"]))
    except (TypeError, ValueError, AttributeError):
        return None
    return None


def _field(k, p):
    """(field, (old, ...), new), or None for a field name this applier does not know. `p` = [old, new] or
    [[old1, old2, ...], new] (U6 list-olds). A MALFORMED o/h/l/c/v raises, so `_compact` skips the WHOLE entry: applying
    the rest of a correction would write a bar no vendor printed (and a pre-U6 applier skips a list-old entry whole too)."""
    if k not in ("o", "h", "l", "c", "v"):
        return None
    if not isinstance(p, (list, tuple)) or len(p) != 2:
        raise ValueError(f"malformed field {k}")
    olds = tuple(float(x) for x in (p[0] if isinstance(p[0], (list, tuple)) else [p[0]]))
    if not olds:
        raise ValueError(f"field {k} lists no old")
    return (k, olds, float(p[1]))


def entries_for(ticker: str, tf: str, src: str) -> dict:
    """{date: [compact entry, ...]} for one (ticker, tf, src); {} when there are none."""
    idx = _index(ticker)
    return (idx or {}).get((str(tf).upper(), src)) or {}


def keep_wicks(ticker: str, src: str) -> dict:
    """{date: {field: value}}: daily wicks the serve-time clamp must NOT trim (owner decision D1: a second vendor
    independently shows the same spike, so it is a real print). Op `keep_wick`: {"tf": "D", "src", "d", "field":
    "h"|"l", "value"}. The clamp honours an entry only while the bar still holds `value` (compare-and-set again)."""
    out: dict = {}
    for d, es in entries_for(ticker, "D", src).items():
        for e in es:
            if e[0] == "keep":
                out.setdefault(d, {})[e[1]] = e[2]
    return out


def same_value(a, b) -> bool:
    """The ledger's equality (prices at 4 dp), for callers outside this module."""
    return _eq(a, b)


def _eq(a, b) -> bool:
    try:
        a, b = float(a), float(b)
    except (TypeError, ValueError):
        return False
    return abs(a - b) <= max(EQ_TOL * abs(b), EQ_TOL)


def _chk_ok(bar: dict, chk) -> bool:
    for f, v in chk:
        try:
            if abs(float(bar.get(f)) / float(v) - 1) > CHK_TOL:
                return False
        except (TypeError, ValueError, ZeroDivisionError):
            return False
    return True


def _consistent(b: dict) -> bool:
    try:
        o, h, l, c = float(b["o"]), float(b["h"]), float(b["l"]), float(b["c"])
    except (KeyError, TypeError, ValueError):
        return False
    return h >= max(o, c) and l <= min(o, c) and l > 0


def _set(bar: dict, e: tuple) -> Optional[dict]:
    """The bar with the entry's fields applied (a new dict), or None when nothing applied."""
    if not _chk_ok(bar, e[2]):
        _counts["set_missed_chk"] += 1
        return None
    nb = None
    for f, olds, new in e[1]:
        if any(_eq(bar.get(f), o) for o in olds):
            nb = nb or dict(bar)
            nb[f] = new
        elif _eq(bar.get(f), new):
            _counts["set_already"] += 1          # a second pass (door, then serve) over a corrected bar: not a miss
        else:
            _counts["set_missed_field"] += 1
    if nb is not None and not _consistent(nb):
        _counts["set_refused_inconsistent"] += 1
        return None
    return nb


def _drop(bar: dict, e: tuple) -> bool:
    old = e[1]
    ok = all(_eq(bar.get(k), old[i]) for i, k in enumerate("ohlc")) and _eq(bar.get("v") or 0, old[4] or 0)
    if not ok:
        _counts["drop_missed"] += 1
    return ok


_raw = contextvars.ContextVar("bars_corrections_raw_reads", default=False)


@contextlib.contextmanager
def raw_reads():
    """Inside this block the store's read door (`bars_sqlite._door`) returns rows EXACTLY AS STORED. For every
    read-modify-write caller: a correction read through the door and written back would be baked into the row, and
    no later ledger version could take it back. tests/test_bars_store_door.py names who must use it."""
    token = _raw.set(True)
    try:
        yield
    finally:
        _raw.reset(token)


def _apply_one(b: dict, es: list):
    """The ONE per-bar application: the bar after `es` (one date's entries), the same dict when nothing applied, or
    None when a drop matched. `apply` (served dicts) and `apply_rows` (the store door's tuples) both run this."""
    cur = b
    for e in es:
        op = e[0]
        if op == "drop" and _drop(cur, e):
            _counts["drop_applied"] += 1
            return None
        if op == "set":
            nb = _set(cur, e)
            if nb is not None:
                cur = nb
                _counts["set_applied"] += 1
    return cur


def apply_rows(ticker: str, tf: str, rows: list, src: str = "store") -> list:
    """The store read door's form of `apply`: `rows` are (ts YYYYMMDD, o, h, l, c, v) tuples. Inside `raw_reads()`
    they come back untouched. Returns the SAME list when nothing applies; never raises."""
    if not rows or _raw.get() or str(tf).upper() not in DATE_TFS:
        return rows
    try:
        by_d = entries_for(ticker, tf, src)
        if not by_d:
            return rows
        out, changed = [], False
        for r in rows:
            s = str(r[0])
            es = by_d.get(f"{s[:4]}-{s[4:6]}-{s[6:8]}") if len(s) == 8 else None
            if not es:
                out.append(r)
                continue
            b = {"t": s, "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}
            nb = _apply_one(b, es)
            if nb is None:
                changed = True
                continue
            if nb is b:
                out.append(r)
                continue
            changed = True
            out.append((r[0], nb["o"], nb["h"], nb["l"], nb["c"], nb["v"]) + tuple(r[6:]))
        return out if changed else rows
    except Exception as e:  # noqa: BLE001 - the stored rows still read
        _log.warning("[bars-corrections] apply_rows failed for %s tf=%s: %s", ticker, tf, e)
        return rows


def apply(ticker: str, tf: str, bars: list, src: str) -> list:
    """`bars` (ascending {t, o, h, l, c, v} dicts) with the ledger's entries for (ticker, tf, src) applied by
    compare-and-set. Returns the SAME list object when nothing applies; never mutates the input dicts; never raises."""
    if not bars or str(tf).upper() not in DATE_TFS or src not in SOURCES:
        return bars
    try:
        by_d = entries_for(ticker, tf, src)
        if not by_d:
            return bars
        out, changed = [], False
        for b in bars:
            es = by_d.get(str(b.get("t"))[:10])
            if not es:
                out.append(b)
                continue
            cur = _apply_one(b, es)
            if cur is None:
                changed = True
                continue
            changed = changed or cur is not b
            out.append(cur)
        return out if changed else bars
    except Exception as e:  # noqa: BLE001 - never blank or bend a chart on a ledger fault
        _log.warning("[bars-corrections] apply failed for %s tf=%s: %s", ticker, tf, e)
        return bars


def history_epoch(ticker: str, tf: str) -> int:
    """What to add to `ticker`'s served history_rev at `tf`: the ledger version's epoch while the ticker is corrected
    (its payload on this volume) or retired (a later version took its entries back), else 0."""
    if str(tf).upper() not in DATE_TFS or not enabled() or not _state["loaded"]:
        return 0
    sym = str(ticker or "").upper()
    if sym in _state["retired"]:
        return _rev(sym) * EPOCH_STEP
    # ⛔ Only while the payload is ON THIS VOLUME: a pod still syncing serves uncorrected bars and must not label
    # them with the newer history (a browser would keep them as the new history).
    if sym in _state["symbols"] and _index(sym) is not None:
        return _rev(sym) * EPOCH_STEP
    return 0


def status() -> dict:
    return {"enabled": enabled(), "loaded": _state["loaded"], "version": _state["version"],
            "symbols": len(_state["symbols"]), "retired": len(_state["retired"]), "cached": len(_cache),
            "cached_entries": sum(v[1] for v in _cache.values()),
            "counts": dict(_counts)}
