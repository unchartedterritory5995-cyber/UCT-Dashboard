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
import re
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


# The page's date selections are a CLOSED set, and this is the only place a
# caller-supplied string reaches an argv. An allowlist keeps it that way and
# bounds the cache: "All" plus LastN for a single- or double-digit N.
_DATE_FILTER_RE = re.compile(r"^(All|Last\d{1,2})$")


def valid_date_filter(v: str | None) -> str | None:
    """The filter to use, or None for 'the whole CSV'. Never raises."""
    if not v:
        return None
    v = v.strip()
    return v if _DATE_FILTER_RE.match(v) else None


def build(csv_text: str, date_filter: str | None = None) -> dict | None:
    """Run the bundle over a CSV. Returns {json_bytes, stats} or None. Never raises."""
    if not available():
        log.debug("[flow-agg] unavailable (enabled=%s bundle=%s node=%s)",
                  enabled(), os.path.exists(bundle_path()), shutil.which(node_bin()))
        return None
    df = valid_date_filter(date_filter)
    argv = [node_bin(), bundle_path(), "aggregate"]
    if df:
        argv.append(f"--date-filter={df}")
    t0 = time.monotonic()
    try:
        proc = subprocess.run(
            argv,
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
    _STATS["builds"] += 1
    _STATS["last_build"] = {"ms": stats["buildMs"], "json_bytes": stats["jsonBytes"],
                            "raw_rows": stats.get("rawRows"),
                            "selected_rows": stats.get("selectedRows"),
                            "trades": stats.get("totalTrades"),
                            "date_filter": stats.get("dateFilter"),
                            "at": time.time()}
    return {"json_bytes": raw, "stats": stats}


def get_cached_or_build(key: tuple, version, csv_provider,
                        date_filter: str | None = None) -> tuple | None:
    """(version, gzipped_json) for `key`, computed at most once per version.

    Mirrors `flow_router._get_cached_or_build` deliberately — single-flight with
    stale-serve — because the failure it prevents is the same one, and it has
    already caused a 524-class outage on this pod: with no lock, every request
    that missed the cache started its OWN build, they piled into the threadpool,
    and once a build outlived the version bucket the cache could never populate.

    ⚠️ The returned version is the one the payload was BUILT FROM, never simply
    the current one, so a stale-served body always describes itself honestly.
    """
    _STATS["requests"] += 1
    cached = _CACHE.get(key)
    if cached and cached[0] == version:
        _CACHE.move_to_end(key)
        _STATS["cache_hits"] += 1
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
        _STATS["stale_served" if cached else "declined_busy"] += 1
        return cached if cached else None
    try:
        again = _CACHE.get(key)
        if again and again[0] == version:
            return again
        csv_text = csv_provider()
        if not csv_text:
            return None
        built = build(csv_text, date_filter)
        if not built:
            _STATS["build_failures"] += 1
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


# ── observability ───────────────────────────────────────────────────────────
#
# WHY THIS EXISTS: this whole path FAILS SOFT by design. A missing bundle, a
# missing `node`, a flipped flag, a changed proxy prefix — every one returns
# None, the page silently takes the slow path it took before, and nothing
# anywhere goes red. That is correct for safety and terrible for noticing: the
# symptom is "the flow page feels slow again", weeks later, from a member.

# Process-local tallies. ⚠️ THESE RESET ON EVERY DEPLOY, so they are the
# SECONDARY signal only — never the health verdict. A counter that resets is
# exactly how the desk insights pass reported healthy straight through a total
# failure (its 4-consecutive-failure streak never survived a redeploy).
_STATS = {"requests": 0, "cache_hits": 0, "builds": 0, "build_failures": 0,
          "stale_served": 0, "declined_busy": 0, "last_build": None,
          # ⛔ MEMBER traffic, counted SEPARATELY from the warmer's own calls.
          # The warmer goes through the same builder, so a single `requests`
          # tally cannot answer the question that actually matters — "are
          # members reaching the fast path?" — because the warmer keeps it
          # non-zero forever even if every browser stopped asking. A signal
          # that cannot distinguish the thing being measured from the thing
          # measuring it is not a signal.
          "endpoint_requests": 0}


def stats() -> dict:
    return dict(_STATS)


def health(current_version=None, view=("stocks", 1, "Last1")) -> dict:
    """Is the fast path ACTUALLY available right now?

    ⛔ READS THE ARTIFACT, NOT A COUNTER. The verdict is "is there a usable
    aggregate for the CURRENT data version, this second" — answerable from
    state alone, so it is true immediately after a restart with no history to
    accumulate. A tally-based check would have to wait for traffic to prove
    anything, and would read healthy on a pod that has served nobody.

    `warm` is the one that matters. `available` only says the machinery COULD
    run (flag on, bundle present, node on PATH); `warm` says the answer the
    page asks for is already sitting there, which is the difference between a
    204 ms first paint and a member waiting for a 3 s cold build.
    """
    bundle = bundle_path()
    node = shutil.which(node_bin())
    out = {
        "enabled": enabled(),
        "bundle": bundle,
        "bundle_exists": os.path.exists(bundle),
        "node": node,
        "available": False,
        "warm": False,
        "current_version": current_version,
        "view": list(view),
        "entries": [{"key": str(k), "version": v[0], "gz_bytes": len(v[1])}
                    for k, v in _CACHE.items()],
        "stats_process_local": stats(),
        "reason": None,
    }
    if not out["enabled"]:
        out["reason"] = "disabled"
        return out
    if not out["bundle_exists"]:
        # The build step did not run, or the image shipped without app/dist.
        out["reason"] = "bundle_missing"
        return out
    if not node:
        out["reason"] = "node_missing"
        return out
    out["available"] = True

    cached = _CACHE.get(tuple(view))
    if cached is None:
        out["reason"] = "cold"
    elif current_version is not None and cached[0] != current_version:
        # A warm entry for a SUPERSEDED version is not warm: the next caller
        # rebuilds. Reporting it as warm is how a stalled warmer would hide.
        out["reason"] = f"stale (cached v{cached[0]} vs current v{current_version})"
    else:
        out["warm"] = True
    return out


def alert_if_unavailable(current_version=None, post=None,
                         view=("stocks", 1, "Last1")) -> dict:
    """Post to Discord when the fast path STOPS or STARTS working.

    ⛔ ON TRANSITION ONLY. A check that posts every cycle while something is
    broken gets muted inside a week, and a muted alert is worse than none —
    it reads as coverage. The recovery message matters as much as the failure
    one: without it nobody knows whether an alert from this morning still
    stands.

    ⚠️ `cold` is NOT unhealthy. A pod that has just booted has an empty cache
    by construction; the warmer fills it within its cycle. Only a hard
    unavailability (flag off, bundle gone, node gone) is worth waking someone.
    """
    h = health(current_version=current_version, view=view)
    bad = not h["available"]
    prev = _STATS.get("_last_alert_bad")
    h["alerted"] = False
    if prev is None:
        _STATS["_last_alert_bad"] = bad          # first observation: no alert
        return h
    if bad != prev:
        _STATS["_last_alert_bad"] = bad
        msg = (f"\U0001F534 FLOW AGGREGATE UNAVAILABLE — {h['reason']}. Options "
               f"Flow has fallen back to client-side compute (~2-4 s of the "
               f"member's own CPU per load). bundle={h['bundle_exists']} "
               f"node={bool(h['node'])} enabled={h['enabled']}"
               if bad else
               "\U0001F7E2 Flow aggregate available again — Options Flow is back "
               "on the server-computed first paint.")
        try:
            if post is not None:
                post(msg)
                h["alerted"] = True
        except Exception:  # noqa: BLE001
            log.exception("[flow-agg] health alert post failed")
    return h
