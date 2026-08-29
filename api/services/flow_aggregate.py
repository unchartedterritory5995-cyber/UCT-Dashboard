"""Run the Options Flow analytics ONCE PER DATA VERSION, on the server.

THE PROBLEM, measured on prod 2026-08-29 from the page's own `[perf]` logs:

    [perf] Downloaded: 88ms (14324KB)
    [perf] CSV parsed: 854ms (107346 rows, worker)
    [perf] processFlowData (Last1): 2735ms
    [perf] processFlowData (Last1): 1631ms      <- intermittent second pass

Every member, on every first load, downloads 14 MB of raw option prints and
spends 2-4 s of their own CPU reducing 107,346 prints to ~26,800 trades and a
handful of aggregates. The aggregation cost varies 1,617-3,433 ms for identical
input. The server already holds the rows; it is sending the raw tape and asking
the browser to do the analytics.

`_current_version()` in flow_router rolls once per bucket (60 s), so the answer
changes at most once a minute no matter how many members ask. Computing it once
per version instead of once per member per load is the whole idea.

⛔ THE ANALYTICS ARE NOT REIMPLEMENTED HERE.
A Python port would put a SECOND AUTHORITY on the numbers members trade on —
the defect this repo names more than any other. This shells out to
`app/dist/flow-facts.cjs`, an esbuild bundle of the very functions the browser
calls (`parseCSV` + `processFlowData`), exactly as `cot_prewarm.py` already does
for the COT analytics. If the bundle and the page ever disagree it is a build
problem, not a logic drift, and `flowFactsEntry.test.js` asserts the bundle's
output is byte-identical to running the pair directly.

FAILURE IS ALWAYS SOFT. A missing bundle, a missing `node`, a timeout or a
non-zero exit returns None. The caller serves nothing and the page keeps using
the CSV path it uses today — this endpoint is an accelerator, never a
dependency.
"""
from __future__ import annotations

import gzip
import json
import logging
import os
import shutil
import subprocess
import threading
import time
from collections import OrderedDict

log = logging.getLogger(__name__)

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_BUNDLE = os.path.join(_REPO_ROOT, "app", "dist", "flow-facts.cjs")


def bundle_path() -> str:
    return os.environ.get("FLOW_FACTS_BUNDLE") or DEFAULT_BUNDLE


def node_bin() -> str:
    return os.environ.get("FLOW_NODE_BIN") or "node"


def enabled() -> bool:
    return os.environ.get("FLOW_AGGREGATE_ENABLED", "1") == "1"


# A build is bounded: past this the subprocess is killed and the caller serves
# nothing. The browser does the same work in 1.6-3.4 s, so a build taking much
# longer than that means something is wrong, not slow.
BUILD_TIMEOUT_S = float(os.environ.get("FLOW_AGGREGATE_TIMEOUT_S", "60"))

# Same shape as flow_router's _RESPONSE_CACHE: small, LRU, version-stamped.
_CACHE: "OrderedDict[tuple, tuple]" = OrderedDict()
_CACHE_MAX = int(os.environ.get("FLOW_AGGREGATE_CACHE_MAX", "8"))
_BUILD_LOCK = threading.Lock()


def available() -> bool:
    """Can we build at all? Cheap, no subprocess."""
    return enabled() and os.path.exists(bundle_path()) and shutil.which(node_bin()) is not None


def build(csv_text: str) -> dict | None:
    """Run the bundle over a CSV. Returns {json_bytes, stats} or None. Never raises."""
    if not available():
        log.debug("[flow-agg] unavailable (enabled=%s bundle=%s node=%s)",
                  enabled(), os.path.exists(bundle_path()), shutil.which(node_bin()))
        return None
    t0 = time.monotonic()
    try:
        proc = subprocess.run(
            [node_bin(), bundle_path(), "aggregate"],
            input=csv_text.encode("utf-8"),
            capture_output=True,
            timeout=BUILD_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        log.warning("[flow-agg] build timed out after %.0fs", BUILD_TIMEOUT_S)
        return None
    except Exception:
        log.exception("[flow-agg] build failed to start")
        return None

    if proc.returncode != 0:
        # stderr carries the CLI's own diagnostics AND processFlowData's notes,
        # which are routed there precisely so stdout stays parseable.
        log.warning("[flow-agg] build exited %s: %s",
                    proc.returncode, (proc.stderr or b"")[:300].decode("utf-8", "replace"))
        return None

    raw = proc.stdout
    try:
        payload = json.loads(raw)
    except Exception:
        log.warning("[flow-agg] stdout was not JSON (%d bytes) — first 200: %r",
                    len(raw), raw[:200])
        return None
    if not payload.get("ok"):
        return None

    stats = payload.get("stats") or {}
    stats["buildMs"] = int((time.monotonic() - t0) * 1000)
    stats["jsonBytes"] = len(raw)
    return {"json_bytes": raw, "stats": stats}


def get_cached_or_build(key: tuple, version, csv_provider) -> tuple | None:
    """(version, gzipped_json) for `key`, computed at most once per version.

    Mirrors `flow_router._get_cached_or_build` deliberately — single-flight with
    stale-serve — because the failure it prevents is the same one, and it has
    already caused a 524-class outage on this pod: with no lock, every request
    that missed the cache started its OWN build, they piled into the threadpool,
    and once a build outlived the version bucket the cache could never populate.

    ⚠️ The returned version is the one the payload was BUILT FROM, never simply
    the current one, so a stale-served body always describes itself honestly.
    """
    cached = _CACHE.get(key)
    if cached and cached[0] == version:
        _CACHE.move_to_end(key)
        return cached

    def _store(gz_bytes):
        if key not in _CACHE and len(_CACHE) >= _CACHE_MAX:
            _CACHE.popitem(last=False)
        _CACHE[key] = (version, gz_bytes)
        _CACHE.move_to_end(key)
        return _CACHE[key]

    if not _BUILD_LOCK.acquire(blocking=False):
        # Someone is building. Serve the previous answer rather than queue
        # behind a multi-second subprocess; if there is none, decline.
        return cached if cached else None
    try:
        again = _CACHE.get(key)
        if again and again[0] == version:
            return again
        csv_text = csv_provider()
        if not csv_text:
            return None
        built = build(csv_text)
        if not built:
            return None
        gz = gzip.compress(built["json_bytes"], compresslevel=6)
        log.info("[flow-agg] built %s: %d raw rows -> %d trades, json %.1f MB "
                 "-> gz %.1f MB, %d ms",
                 key, built["stats"].get("rawRows", -1),
                 built["stats"].get("totalTrades", -1),
                 built["stats"].get("jsonBytes", 0) / 1048576,
                 len(gz) / 1048576, built["stats"].get("buildMs", -1))
        return _store(gz)
    finally:
        _BUILD_LOCK.release()


def cache_state() -> dict:
    """For diagnostics — what is cached, and for which version."""
    return {
        "available": available(),
        "bundle": bundle_path(),
        "bundle_exists": os.path.exists(bundle_path()),
        "node": shutil.which(node_bin()),
        "entries": [{"key": str(k), "version": v[0], "gz_bytes": len(v[1])}
                    for k, v in _CACHE.items()],
    }
