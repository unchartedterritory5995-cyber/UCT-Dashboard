"""Warm the Company Panel's caches ahead of the member, for the whole universe.

MEASURED on production 8 Sep 2026, /api/earnings-intel end to end:

    AMKR  cold 4.46s -> warm 0.12s
    VSAT  cold 4.72s -> warm 0.15s
    CALX  cold 7.47s -> warm 0.13s

35-60x. Warm is already instant; the only slow view is the FIRST view of a
symbol, which is precisely what this removes. Nothing here makes a served
request faster -- it moves the cost off the member's click and onto a schedule.

⛔ It warms through the SAME functions the endpoints call, never a private
build. A prewarmed entry has to be byte-identical to a lazily built one or this
becomes a second, subtly different code path that nobody tests.

Everything it populates persists to the snapshot store on /data, so a redeploy
-- of which there can be many in a day -- does not throw the work away. The
in-memory cache is repopulated from disk on the next read.

⚠️ Bulk warming has OOM'd this pod before (see the bars prewarmer). This walks
symbols one at a time and holds no accumulating structure: each surface is
fetched, cached by the service, and dropped. The scheduler job takes a small
bounded slice per cycle rather than the universe in one pass.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Callable, Iterable

_log = logging.getLogger(__name__)

STATE_PATH = os.environ.get("PANEL_PREWARM_STATE", "/data/panel_prewarm_state.json")
# Symbols per scheduled cycle. Free-ish providers, but each symbol is seconds of
# wall clock, so this is a pace, not a cost ceiling.
BATCH = int(os.environ.get("PANEL_PREWARM_BATCH", "40"))


# ⛔ ONLY these three persist their result to the snapshot store on /data.
# `fundamentals` and `institutional_holdings` cache in MEMORY only, which makes
# them un-prewarmable in the design below and is why they are excluded:
#   • warming them in-process is what grows RSS — measured at ~13 MB per symbol
#     with no plateau after 100 symbols, i.e. ~48 GB over a 3,742-name universe
#     against a 32 GB container. That is an OOM, not a slow warm.
#   • warming them in a subprocess is pointless: the memory dies with it.
# Giving those two a disk snapshot is the fix, and it is a separate change.
DISK_BACKED = ("statements", "earnings_table", "earnings_intel")


def _surfaces(only: tuple[str, ...] | None = None) -> list[tuple[str, Callable[[str], Any]]]:
    """(name, fn) for the payloads a Company Panel tab reads.

    Imported lazily and defensively: a module that fails to import must cost its
    own surface, not the whole prewarm. `only` narrows to a named subset.
    """
    out: list[tuple[str, Callable[[str], Any]]] = []

    def add(name, importer):
        try:
            out.append((name, importer()))
        except Exception as e:                            # noqa: BLE001
            _log.warning("panel prewarm: %s unavailable: %s", name, e)

    add("fundamentals", lambda: __import__(
        "api.services.fundamentals", fromlist=["get_fundamentals"]).get_fundamentals)
    add("statements", lambda: __import__(
        "api.services.financial_statements", fromlist=["get_statements"]).get_statements)
    add("earnings_table", lambda: __import__(
        "api.services.earnings_table", fromlist=["get_earnings_table"]).get_earnings_table)
    add("earnings_intel", lambda: __import__(
        "api.services.earnings_intel", fromlist=["get_earnings"]).get_earnings)
    add("ownership", lambda: __import__(
        "api.services.institutional_holdings", fromlist=["get_ownership"]).get_ownership)
    if only:
        out = [(n, f) for n, f in out if n in only]
    return out


def warm_symbol(sym: str, surfaces=None) -> dict[str, Any]:
    """Warm every panel surface for one symbol. Never raises."""
    sym = (sym or "").upper().strip()
    if not sym:
        return {"symbol": sym, "ok": 0, "failed": 0, "ms": 0}
    started = time.time()
    ok = failed = 0
    errors: dict[str, str] = {}
    for name, fn in (surfaces if surfaces is not None else _surfaces()):
        try:
            fn(sym)
            ok += 1
        except Exception as e:                            # noqa: BLE001
            failed += 1
            errors[name] = f"{type(e).__name__}: {e}"[:120]
    return {"symbol": sym, "ok": ok, "failed": failed,
            "ms": int((time.time() - started) * 1000),
            **({"errors": errors} if errors else {})}


def _universe() -> list[str]:
    try:
        from api.services import cap_universe
        return sorted({str(s).upper() for s in (cap_universe.symbols() or [])})
    except Exception as e:                                # noqa: BLE001
        _log.warning("panel prewarm: universe unavailable: %s", e)
        return []


def _read_cursor() -> int:
    try:
        with open(STATE_PATH, encoding="utf-8") as fh:
            return int(json.load(fh).get("cursor") or 0)
    except Exception:                                     # noqa: BLE001
        return 0


def _write_cursor(n: int) -> None:
    try:
        tmp = f"{STATE_PATH}.tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump({"cursor": int(n), "updated_at": time.time()}, fh)
        os.replace(tmp, STATE_PATH)     # atomic; a torn file would reset the sweep
    except Exception as e:              # noqa: BLE001
        _log.warning("panel prewarm: cursor write failed: %s", e)


def run_prewarm(symbols: Iterable[str] | None = None, *, limit: int | None = None,
                rotate: bool = True,
                surfaces_only: tuple[str, ...] | None = DISK_BACKED) -> dict[str, Any]:
    """One bounded pass. With `rotate`, continues where the last pass stopped.

    The cursor WRAPS rather than stopping at the end: fundamentals go stale on
    their own TTL, so the sweep is a treadmill that keeps the universe warm, not
    a one-time backfill that finishes.
    """
    syms = ([s.upper() for s in symbols] if symbols else _universe())
    if not syms:
        return {"symbols": 0, "ok": 0, "failed": 0, "wrapped": False}

    n = max(1, min(int(limit or BATCH), len(syms)))
    start = (_read_cursor() % len(syms)) if rotate else 0
    window = [syms[(start + i) % len(syms)] for i in range(n)]

    surfaces = _surfaces(only=surfaces_only)
    t0 = time.time()
    ok = failed = 0
    slowest = ("", 0)
    for s in window:
        r = warm_symbol(s, surfaces=surfaces)
        ok += r["ok"]
        failed += r["failed"]
        if r["ms"] > slowest[1]:
            slowest = (s, r["ms"])

    end = start + n
    if rotate:
        _write_cursor(end % len(syms))
    return {"symbols": len(window), "universe": len(syms),
            "cursor": (end % len(syms)) if rotate else 0,
            "ok": ok, "failed": failed, "wrapped": end >= len(syms),
            "elapsed_s": round(time.time() - t0, 1),
            "slowest": {"symbol": slowest[0], "ms": slowest[1]}}


# ── run as a SUBPROCESS ─────────────────────────────────────────────────────
# `python -m api.services.panel_prewarm [limit]`
#
# The scheduler shells out to this rather than warming inside the web process.
# Measured: ~13 MB of RSS per symbol with no plateau, because every payload
# stays in the process cache. Out of process that memory is handed back to the
# OS when the run exits, and the WORK still lands — the three surfaces above
# write to the snapshot store on /data, which the web process reads on the next
# request. That is what makes a cold symbol fast; the in-memory copy is only a
# second-level cache the request rebuilds for free.
if __name__ == "__main__":
    import sys

    n = int(sys.argv[1]) if len(sys.argv) > 1 else BATCH
    print(json.dumps(run_prewarm(limit=n)), flush=True)
