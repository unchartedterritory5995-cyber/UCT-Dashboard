"""Memory OBSERVATION for the flow-worker and worker pods: measure, never change behaviour.

Why (owner, 2026-11-06): Railway bills by resident memory, and Nov 1-6 averaged ~20 GB on flow-worker and ~16 GB
on worker (~$500/month of a ~$635/month pace). Code reading found in-process structures that only grow (the
per-contract options-trade maps, the date-keyed flow caches) but measured nothing. The owner ruled that nothing
may get slower and stored data must not change, so before any limit is added this module records, through a
full trading session:

  * process memory split the way the bill sees it: RSS, and the cgroup's anon (process) vs file (page cache)
  * the size of every suspect structure, and how much of each is older than 24 h ("dead weight")
  * WOULD-HAVE counters for each proposed limit (see `bump`): how many trades and requests a limit would
    actually have touched. Zero means the limit is provably invisible.

It reads only. It never imports a module (a target that is not already loaded is skipped), never mutates a
target, and copies a dict's items in one C-level call (`list(d.items())`, atomic under the GIL for builtin
dicts) before walking them in small slices that yield the GIL between slices, so ingest and member requests
are not held up. Every probe is wrapped: a failure logs once and is skipped; nothing raises out of the thread.

One log line per tick, grep `[memobs]`:  {"svc":..., "rss_mb":..., "cg_anon_mb":..., "cg_file_mb":...,
"structs": {name: {"n": .., "aged24": .., "est_mb": ..}}, "would": {counter: n},
"files": [[path, size_mb, cached_mb], ...]}  (page-cache residency per file; off: MEM_OBSERVE_FILES=0)

Off switch: MEM_OBSERVE_ENABLED=0. Interval: MEM_OBSERVE_INTERVAL_S (default 600). Size estimates (a json
sample, the expensive part) run every MEM_OBSERVE_SIZE_EVERY ticks (default 6, i.e. hourly).
"""
from __future__ import annotations

import json
import logging
import os
import sys
import threading
import time

log = logging.getLogger("mem_observe")

AGE_S = 24 * 3600
_SLICE = 2000            # items walked between GIL yields
_SAMPLE = 3              # values json-sized per structure for the byte estimate

# WOULD-HAVE counters. Hot paths call bump(); a dict increment under the GIL is the whole cost.
_WOULD: dict = {}


def bump(name: str, n: int = 1) -> None:
    """Count one event a proposed limit would have affected. Never raises."""
    try:
        _WOULD[name] = _WOULD.get(name, 0) + n
    except Exception:  # noqa: BLE001
        pass


# (label, module, attribute, kind). kind: "len" | "ts_tuple" (value = (unix_ts, payload)) |
# "deque_ts_ns" (value = deque[(ts_ns, price)]) | "ttlcache" (api.services.cache.TTLCache instance)
FLOW_WORKER_TARGETS = [
    ("ws.raw_t_history", "api.massive_ws_worker", "_RAW_T_HISTORY", "deque_ts_ns"),
    ("ws.q_last_seen", "api.massive_ws_worker", "_q_last_seen", "len"),
    ("ws.q_cumulative_premium", "api.massive_ws_worker", "_q_cumulative_premium", "len"),
    ("ws.oi_fetch_seen", "api.massive_ws_worker", "_oi_fetch_seen", "len"),
    ("ws.nbbo_table", "api.massive_ws_worker", "_nbbo_table", "len"),
    ("ws.nbbo_history", "api.massive_ws_worker", "_NBBO_HISTORY", "len"),
    ("ws.tick_test_cache", "api.massive_ws_worker", "_TICK_TEST_CACHE", "len"),
    ("lm.recent_cache", "api.live_massive_router", "_recent_cache", "ts_tuple"),
    ("lm.recent_last_good", "api.live_massive_router", "_recent_last_good", "len"),
    ("lm.recent_cache_locks", "api.live_massive_router", "_recent_cache_locks", "len"),
    ("lm.alert_cache", "api.live_massive_router", "_alert_cache", "len"),
    ("lm.symbol_recent_cache", "api.live_massive_router", "_symbol_recent_cache", "ts_tuple"),
    ("lm.multiday_recent_cache", "api.live_massive_router", "_multiday_recent_cache", "ts_tuple"),
    ("lm.diagnostic_cache", "api.live_massive_router", "_diagnostic_cache", "ts_tuple"),
    ("lm.day_stats_cache", "api.live_massive_router", "_day_stats_cache", "ts_tuple"),
    ("lm.by_contract_cache", "api.live_massive_router", "_by_contract_cache", "ts_tuple"),
    ("lm.cream_cache", "api.live_massive_router", "_cream_cache", "ts_tuple"),
    ("lm.ticker_flow_cache", "api.live_massive_router", "_ticker_flow_cache", "ts_tuple"),
    ("lm.worker_history_cache", "api.live_massive_router", "_worker_history_cache", "ts_tuple"),
    ("cache.shared", "api.services.cache", "cache", "ttlcache"),
]
WORKER_TARGETS = [
    ("cache.shared", "api.services.cache", "cache", "ttlcache"),
    ("bars.recent_intraday", "api.services.bars_fetch", "_recent_intraday", "len"),
]


def _proc_rss_mb():
    try:
        with open("/proc/self/status", encoding="ascii") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return round(int(line.split()[1]) / 1024, 1)
    except Exception:  # noqa: BLE001
        return None
    return None


def _cgroup_mb():
    """cgroup v2 current / anon / file in MB (v1 fallback for usage only)."""
    out = {}
    try:
        with open("/sys/fs/cgroup/memory.current", encoding="ascii") as f:
            out["cg_current_mb"] = round(int(f.read().strip()) / 1048576, 1)
        with open("/sys/fs/cgroup/memory.stat", encoding="ascii") as f:
            for line in f:
                k, _, v = line.partition(" ")
                if k in ("anon", "file", "shmem", "slab"):
                    out[f"cg_{k}_mb"] = round(int(v) / 1048576, 1)
    except Exception:  # noqa: BLE001
        try:
            with open("/sys/fs/cgroup/memory/memory.usage_in_bytes", encoding="ascii") as f:
                out["cg_current_mb"] = round(int(f.read().strip()) / 1048576, 1)
        except Exception:  # noqa: BLE001
            pass
    return out


def _items(obj):
    """One atomic copy of a builtin dict's items (or a set's members)."""
    if isinstance(obj, dict):
        return list(obj.items())
    if isinstance(obj, (set, frozenset)):
        return [(k, None) for k in list(obj)]
    return []


def _est_mb(values, n):
    """Average json size of up to _SAMPLE values, scaled to n. A rough lower bound (json is compact)."""
    sizes = []
    for v in values[:_SAMPLE]:
        try:
            sizes.append(len(json.dumps(v, default=str)))
        except Exception:  # noqa: BLE001
            continue
    if not sizes or not n:
        return None
    return round(sum(sizes) / len(sizes) * n / 1048576, 1)


def _probe(kind, obj, now, with_size):
    if kind == "ttlcache":
        store = getattr(obj, "_store", None)
        lock = getattr(obj, "_lock", None)
        if store is None:
            return None
        if lock is not None:
            with lock:                                # the cache's own lock; one C-level copy, then release
                items = list(store.items())
        else:
            items = list(store.items())
        res = {"n": len(items)}
        if with_size:
            res["est_mb"] = _est_mb([v for _, v in items[-_SAMPLE:]], len(items))
        return res
    items = _items(obj)
    res = {"n": len(items)}
    if kind in ("ts_tuple", "deque_ts_ns"):
        aged = 0
        cutoff_ns = (now - AGE_S) * 1e9
        for i in range(0, len(items), _SLICE):
            for _, v in items[i:i + _SLICE]:
                try:
                    if kind == "ts_tuple":
                        if now - float(v[0]) > AGE_S:
                            aged += 1
                    elif v and v[-1][0] < cutoff_ns:
                        aged += 1
                except Exception:  # noqa: BLE001
                    continue
            time.sleep(0)                             # yield the GIL between slices
        res["aged24"] = aged
    if with_size and items:
        vals = [v[1] if kind == "ts_tuple" and isinstance(v, tuple) and len(v) == 2 else v
                for _, v in items[:_SAMPLE]]
        if kind == "deque_ts_ns":
            vals = [list(v) for v in vals]
        res["est_mb"] = _est_mb(vals, len(items))
    return res


# ---- page-cache residency per file (added 2026-11-06 after the first day showed ~90% of billed memory is FILE
# cache, not process memory). mincore() over a read-only mapping reports which pages of a file are already in
# the page cache. It reads no file data, faults no page in, and charges nothing to the cgroup.
_FILE_TOP = 12               # files reported per tick, largest cached first
_FILE_MAX_SCAN = 5000        # files examined per tick (bounded walk)
_FILE_MIN_BYTES = 1 << 20    # ignore files under 1 MB
_CHUNK = 1 << 30             # map 1 GB at a time (keeps the residency vector at 256 KB)
_LIBC = None
_LOW_BIT = bytes(b & 1 for b in range(256))   # mincore: bit 0 = resident; other bits are reserved


def _libc():
    global _LIBC
    if _LIBC is None:
        import ctypes
        lib = ctypes.CDLL(None, use_errno=True)
        lib.mmap.restype = ctypes.c_void_p
        lib.mmap.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_long]
        lib.munmap.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
        lib.mincore.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p]
        _LIBC = lib
    return _LIBC


def _resident_bytes(path, size):
    """Bytes of `path` currently in the page cache. None when it cannot be measured."""
    import ctypes
    import mmap as _mm
    lib = _libc()
    page = _mm.PAGESIZE
    fd = os.open(path, os.O_RDONLY)
    try:
        resident = 0
        off = 0
        while off < size:
            ln = min(_CHUNK, size - off)
            addr = lib.mmap(None, ln, _mm.PROT_READ, _mm.MAP_SHARED, fd, off)
            if addr in (None, ctypes.c_void_p(-1).value):
                return None
            try:
                vec = (ctypes.c_ubyte * ((ln + page - 1) // page))()
                if lib.mincore(addr, ln, vec) != 0:
                    return None
                resident += bytes(vec).translate(_LOW_BIT).count(1) * page
            finally:
                lib.munmap(addr, ln)
            off += ln
            time.sleep(0)
        return min(resident, size)
    finally:
        os.close(fd)


def _candidate_files(roots):
    """(label, open_path, size) for big regular files under `roots` plus every file this process holds open
    (including deleted-but-open ones, which a directory walk cannot see)."""
    seen, out = set(), []

    def add(label, open_path):
        try:
            st = os.stat(open_path)
        except OSError:
            return
        key = (st.st_dev, st.st_ino)
        if key in seen or not (st.st_mode & 0o170000 == 0o100000) or st.st_size < _FILE_MIN_BYTES:
            return
        seen.add(key)
        out.append((label, open_path, st.st_size))

    try:
        for fd in os.listdir("/proc/self/fd"):
            p = f"/proc/self/fd/{fd}"
            try:
                add(os.readlink(p), p)
            except OSError:
                continue
    except OSError:
        pass
    n = 0
    for root in roots:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in ("proc", "sys")]
            for fn in filenames:
                n += 1
                if n > _FILE_MAX_SCAN:
                    return out
                fp = os.path.join(dirpath, fn)
                add(fp, fp)
    return out


def file_cache(roots=None):
    """Top files by page-cache residency: {"files": [[path, size_mb, cached_mb], ...], "files_cached_mb": total}."""
    if roots is None:
        roots = [r for r in os.environ.get("MEM_OBSERVE_FILE_ROOTS",
                                           os.environ.get("DATA_DIR", "/data") + ":/tmp").split(":") if r]
    rows = []
    for label, open_path, size in _candidate_files(roots):
        try:
            b = _resident_bytes(open_path, size)
        except Exception:  # noqa: BLE001
            b = None
        if b:
            rows.append((b, label, size))
    rows.sort(reverse=True)
    return {"files": [[lbl, round(sz / 1048576, 1), round(b / 1048576, 1)] for b, lbl, sz in rows[:_FILE_TOP]],
            "files_cached_mb": round(sum(r[0] for r in rows) / 1048576, 1), "files_scanned": len(rows)}


def snapshot(service, targets, with_size=False, with_files=False):
    now = time.time()
    rec = {"svc": service, "ts": int(now), "rss_mb": _proc_rss_mb(), **_cgroup_mb(),
           "threads": threading.active_count(), "structs": {}, "would": dict(_WOULD)}
    for label, mod, attr, kind in targets:
        m = sys.modules.get(mod)                      # never import: a target not loaded is not running here
        if m is None or not hasattr(m, attr):
            continue
        try:
            r = _probe(kind, getattr(m, attr), now, with_size)
            if r is not None:
                rec["structs"][label] = r
        except Exception as e:  # noqa: BLE001
            rec["structs"][label] = {"err": type(e).__name__}
    if with_files:
        try:
            rec.update(file_cache())
        except Exception as e:  # noqa: BLE001
            rec["files_err"] = type(e).__name__
    return rec


def start(service: str, targets) -> bool:
    """Start the observer thread. Returns False (and does nothing) when disabled."""
    if os.environ.get("MEM_OBSERVE_ENABLED", "1").strip() in ("0", "false", "no", ""):
        log.info("[memobs] disabled (MEM_OBSERVE_ENABLED=0)")
        return False
    try:
        interval = max(60, int(os.environ.get("MEM_OBSERVE_INTERVAL_S", "600")))
        size_every = max(1, int(os.environ.get("MEM_OBSERVE_SIZE_EVERY", "6")))
    except ValueError:
        interval, size_every = 600, 6

    files_on = os.environ.get("MEM_OBSERVE_FILES", "1").strip() not in ("0", "false", "no", "")

    def _loop():
        tick = 0
        time.sleep(30)                                # let the service finish booting first
        while True:
            try:
                rec = snapshot(service, targets, with_size=(tick % size_every == 0),
                               with_files=files_on and sys.platform.startswith("linux"))
                log.info("[memobs] %s", json.dumps(rec, separators=(",", ":")))
            except Exception as e:  # noqa: BLE001
                log.warning("[memobs] tick failed: %s", type(e).__name__)
            tick += 1
            time.sleep(interval)

    threading.Thread(target=_loop, name="mem-observe", daemon=True).start()
    log.info("[memobs] started svc=%s interval=%ss size_every=%s", service, interval, size_every)
    return True
