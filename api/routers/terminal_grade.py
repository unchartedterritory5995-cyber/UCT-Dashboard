"""UCT Terminal `GRADE` -- Compass's buy / hold / skip verdict, read-only, in the terminal.

A THIN read over `api/services/grade_ticker.py` (the deterministic GO/HOLD/SKIP orchestrator
Compass voice and chat already call). Nothing is computed here: the verdict, the regime gate,
the setup, grade, entry, stop, size, first target, basis, hard flags and sources are exactly
what `grade_ticker` returns.

Gates, in order of meaning (the same pair every /api/terminal/* route carries):
  * `require_terminal_next` -- the shell has been released to you (404 otherwise, byte-identical
    to an unknown route; dies with TERMINAL_NEXT_ENABLED).
  * `_require_paid` -- 402 for a free account.

⛔ NEVER A FAKE VERDICT. While BRAIN_TOOLS_ENABLED is not "1", or the Brain Pack is not installed
(`brain_service.available()`), the route answers 200 `{available: false, reason}` and DOES NOT
call `grade_ticker` -- the panel then says "Grade not available yet". BRAIN_TOOLS_ENABLED is the
switch that exposes grade_ticker on both Compass surfaces (CLAUDE.md "Compass Brain Bridge"), so
the terminal can never show a verdict Compass itself is not allowed to give. Both are read PER
REQUEST, never captured at import.

⚠️ STATED, NOT HIDDEN: until Pattern Vision's confirmed verdicts carry entry/stop levels (Seam 28,
`grade_ticker._default_patterns_fn`), every real call resolves to SKIP with the `no_setup` flag.
That is grade_ticker's honest answer, served as-is.

Plain `def`: grade_ticker reads the regime classifier and a quote synchronously, so the route runs
on the threadpool (tests/test_async_routes_do_not_block.py). A short per-symbol cache bounds the
cost of a member re-running the code.
"""
from __future__ import annotations

import os
import re
import threading
import time

from fastapi import APIRouter, Depends, HTTPException, Path

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.rollout_gate import require_terminal_next

_SYM_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")
_CACHE_TTL_S = 60.0
_CACHE_MAX = 256
_cache: dict[str, tuple[float, dict]] = {}
_lock = threading.Lock()

NOT_ENABLED_REASON = ("Compass grading is not switched on for this server yet "
                      "(BRAIN_TOOLS_ENABLED).")
NO_PACK_REASON = "The Compass Brain Pack is not installed on this server yet."


def _require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, never imported from a sibling (this codebase's per-router 402 rule)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The UCT Terminal requires a paid plan")
    return user


router = APIRouter(dependencies=[Depends(require_terminal_next), Depends(_require_paid)])


def brain_tools_enabled() -> bool:
    """The same switch, spelled the same way, that registers grade_ticker on Compass chat
    (`coach_chat_tools.py`). Read per request."""
    return os.environ.get("BRAIN_TOOLS_ENABLED", "0") == "1"


def _brain_available() -> bool:
    try:
        from api.services import brain_service
        return bool(brain_service.available())
    except Exception:  # noqa: BLE001 -- an unreadable pack is an unavailable pack
        return False


def _grade(sym: str) -> dict:
    from api.services.grade_ticker import grade_ticker
    return grade_ticker(sym) or {}


def _reset_cache_for_tests() -> None:
    with _lock:
        _cache.clear()


@router.get("/api/terminal/grade/{sym}")
def terminal_grade(sym: str = Path(..., min_length=1, max_length=10)):
    """GRADE: grade_ticker's verdict for one security, or why there is none yet."""
    s = sym.strip().upper()
    if not _SYM_RE.match(s):
        raise HTTPException(status_code=400, detail="not a ticker symbol")
    if not brain_tools_enabled():
        return {"available": False, "symbol": s, "reason": NOT_ENABLED_REASON}
    if not _brain_available():
        return {"available": False, "symbol": s, "reason": NO_PACK_REASON}

    now = time.time()
    with _lock:
        hit = _cache.get(s)
    if hit and now - hit[0] < _CACHE_TTL_S:
        return hit[1]

    try:
        v = _grade(s)
    except Exception:  # noqa: BLE001 -- grade_ticker never raises; this is belt and braces
        v = {"ok": False, "reason": "the grade could not be computed just now"}
    if not v.get("ok"):
        # Not cached: a missing regime gate is transient, and the next read should retry it.
        return {"available": True, "ok": False, "symbol": s,
                "reason": str(v.get("reason") or "the grade could not be computed just now")}

    out = {**v, "available": True, "symbol": s, "as_of": now}
    with _lock:
        if len(_cache) >= _CACHE_MAX:
            _cache.clear()
        _cache[s] = (now, out)
    return out
