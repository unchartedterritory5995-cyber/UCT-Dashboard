"""MD-1 kind `confluence.board` (owner: terminal-data, data wave 2) — UCT's confluence board.

Stocks where a large dark pool dollar size and aligned long-dated options flow line up: the Agent half of the CONFL
terminal panel (app/src/pages/terminal/panels/confluenceModel.js). A thin adapter over
`api/confluence_screen.get_board(days)`, the read behind `GET /api/confluence?days=30`.

⛔ THE DEFAULT WINDOW ONLY, AND NEVER A COMPUTE (MD-1 §5). `get_board` never computes on the caller's thread: it
serves the cached board, or `{ok: false, status: "warming"}`. A full build is about four minutes (two options-flow legs
from the flow-worker), so:
  * this kind takes NO `days`: it reads `confluence_screen.DAYS`, the one window the scheduler keeps warm. Another
    window with nothing cached would start a multi-week scan on the flow-worker (the pod that runs the live tape);
  * a board that is cold or being rebuilt → `unavailable`, with the reason. Never an empty board;
  * when the cached board is past its TTL, `get_board` itself starts the service's own background rebuild of that
    default window (the same one the scheduler runs, single-flight). That is the service's behaviour, on its own
    thread, and not this turn's work. provider_calls is always 0.

LICENSING: the options-flow leg is UCT's own Massive options tape (the flow-worker), and the dark pool leg is the
dark pool print store. No Schwab option chain is read by this board.

TIME (MD-1 §3): the board carries NO data time, only a window as text. The time it was BUILT is a computation time,
so it is never `as_of`: `as_of` is null with a note, and the build time rides as `data.built_at`. `stale` is the
service's own rule (older than its TTL), and an unknown build time is stale (unknown is never claimed fresh).
freshness `periodic`.
⚠️ COUPLING, stated: the build time is read from the service's cache entry (`_CACHES[days]["at"]`), only when that
entry holds the very board `get_board` returned. A rail builds through the service and fails by name on a rename.

WHAT IS LEFT OUT: `acc` (the accumulation / distribution call). A single unsigned dark pool print names a price, not a
buyer (owner decision 2026-09-12), so the member surfaces do not show it and neither does this kind. The build's
`warnings` are internal text and are never returned: `data.incomplete` says a leg was missing (the read is `partial`).

MODEL-ISOLATED (ADR-005): which names are on the board, each one's status and its rank are UCT's own gate, thresholds
and score: a UCT-derived selection like `leaders.longRun`. Shown to the member only; the capability is local-only.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env

KIND = "confluence.board"
SOURCE = "uct-confluence"
#: what a member may ask for → the board's own `dir`
DIRECTIONS = {"all": None, "bull": "BULL", "bear": "BEAR"}
DEFAULT_LIMIT = 20
MAX_LIMIT = 50
TOP_FIELDS = ("cp", "strike", "exp", "dte", "prem")
#: a row's fields, by the route's own names (`top` is cut to TOP_FIELDS); `acc` is deliberately absent
ROW_FIELDS = ("sym", "band", "dir", "status", "sector", "dpn", "dpAvg", "dpLo", "dpHi", "dpLast", "bigPrint", "bigPrice",
              "bigDate", "net", "net5", "bull", "bear", "bullPct", "leapPrem", "leapShare", "freshRatio", "top", "score")

NOTE_WHAT = ("stocks where a large dark pool dollar size and aligned long-dated options flow line up over the last "
             "{days} trading days, ranked by UCT inside each size band and direction; UCT's own screen, not a "
             "recommendation")
NOTE_TIME = ("built by UCT at {at} and rebuilt about every {minutes} minutes (UCT's build time; the board carries no "
             "data time), so as_of is not given: not a live feed")
NOTE_NO_TIME = "the board carries no build time, so its age is unknown and as_of is not given"
NOTE_STALE = "the board is older than its {minutes}-minute refresh, so it may be behind the latest options flow"
NOTE_PRICES = "the dark pool prices on the board (average, range, last) are from dark pool sessions, never a current quote"
NOTE_PARTIAL = "an options-flow leg could not be read when this board was built, so some names may be missing"
NOTE_WARMING = "the confluence board is being built on the server; ask again in a few minutes"
NOTE_FAILED = "the confluence board could not be read"
NOTE_EMPTY = "no stock passes the board's gate in this window; that is a healthy answer, not a failed read"
NOTE_NO_MATCH = "the board holds {total} names, none of them on the side asked for"
NOTE_CUT = "showing the first {n} of {total} names, in the board's own order (best ranked first)"


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate)."""
    if "days" in params:                                   # one window only: see the module docstring
        return "this kind reads the one window the server keeps warm; `days` is not a parameter"
    if params.get("direction", "all") not in DIRECTIONS:
        return "`direction` must be one of " + ", ".join(DIRECTIONS)
    n = params.get("limit", DEFAULT_LIMIT)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_LIMIT:
        return f"`limit` must be a whole number from 1 to {MAX_LIMIT}"
    return None


def now_s() -> float:
    return time.time()


def _row(r: Any) -> Optional[dict]:
    if not isinstance(r, dict) or not str(r.get("sym") or "").strip() or r.get("dir") not in ("BULL", "BEAR"):
        return None
    top = r.get("top") if isinstance(r.get("top"), dict) else {}
    return {**{k: r.get(k) for k in ROW_FIELDS}, "top": {k: top.get(k) for k in TOP_FIELDS}}


def built_at(svc, days: int, board: dict) -> Optional[float]:
    """When the service built THIS board (unix seconds), or None when its cache entry is not this board."""
    entry = (getattr(svc, "_CACHES", None) or {}).get(days) or {}
    at = entry.get("at")
    if entry.get("board") is board and isinstance(at, (int, float)) and not isinstance(at, bool) and at > 0:
        return float(at)
    return None


def read_confluence_board(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    direction = params.get("direction", "all")
    limit = params.get("limit", DEFAULT_LIMIT)
    try:
        from api import confluence_screen as svc
        days = int(svc.DAYS)
        board = svc.get_board(days=days)                   # the cached board or "warming": never a compute here
    except Exception:  # noqa: BLE001 — a failing service is an honest unavailable, never an empty board
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if not isinstance(board, dict):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if board.get("ok") is False:
        return env.unavailable(KIND, params, SOURCE, NOTE_WARMING)
    if board.get("ok") is not True or not isinstance(board.get("rows"), list):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)

    rows = [x for x in (_row(r) for r in board["rows"]) if x]
    want = DIRECTIONS[direction]
    kept = [r for r in rows if want is None or r["dir"] == want]
    ttl = float(getattr(svc, "_TTL", 1800.0))
    minutes = int(ttl // 60)
    built = built_at(svc, days, board)
    built_iso = env.utc_iso(datetime.fromtimestamp(built, tz=timezone.utc)) if built else None
    notes = [NOTE_WHAT.format(days=days), NOTE_TIME.format(at=built_iso, minutes=minutes) if built_iso else NOTE_NO_TIME,
             NOTE_PRICES]
    stale = built is None or (now_s() - built) >= ttl
    if stale and built is not None:
        notes.append(NOTE_STALE.format(minutes=minutes))
    incomplete = bool(board.get("warnings"))
    if incomplete:
        notes.append(NOTE_PARTIAL)
    if not rows:
        notes.append(NOTE_EMPTY)
    elif not kept:
        notes.append(NOTE_NO_MATCH.format(total=len(rows)))
    elif len(kept) > limit:
        notes.append(NOTE_CUT.format(n=limit, total=len(kept)))
    meta = board.get("band_meta") if isinstance(board.get("band_meta"), dict) else {}
    # counted from the rows kept, as the CONFL panel's model does (a row it cannot place is in neither count)
    counts = {"total": len(rows), "bull": sum(1 for r in rows if r["dir"] == "BULL"),
              "bear": sum(1 for r in rows if r["dir"] == "BEAR"),
              "building": sum(1 for r in rows if r.get("status") == "BUILDING")}
    # `window` / `days` / `rows` / `counts` / `band_meta` keep the route's own names (the CONFL panel's model reads them)
    data = {"days": days, "window": str(board.get("window") or ""), "direction": direction, "rows": kept[:limit],
            "count": len(kept), "counts": counts,
            "band_meta": {k: [str(x) for x in v] for k, v in meta.items() if isinstance(v, (list, tuple))},
            "incomplete": incomplete, "built_at": built_iso, "refresh_minutes": minutes}
    shown = min(len(kept), limit)
    coverage = {"evaluated": len(rows), "answered": shown, "dropped": len(kept) - shown, "not_computable": 0}
    return env.make_envelope(KIND, params, status="partial" if incomplete else "ok", freshness="periodic", as_of=None,
                             source=SOURCE, data=data, stale=stale, coverage=coverage, notes=notes, provider_calls=0)
