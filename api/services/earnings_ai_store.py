"""Disk-persist earnings AI preview/analysis on the /data volume.

The in-memory TTLCache is wiped on every Railway redeploy, so an expensive
Claude preview/analysis was re-generated for the same name on every restart —
the reason broad pre-warming was disabled in the 2026-05-27 cost pass. Persisting
the result to disk makes each name generate **once per report cycle** and survive
redeploys: after the first generation (lazy click OR the background warm) it is
served instantly to every user, forever, at zero token cost.

Mirrors the bars_cache / logo_cache / ticker_meta on-disk patterns. Never raises.

Layout: /data/earnings_ai_cache/{kind}_{SYM}.json   (kind = preview | analysis)
"""
import json
import logging
import os
import time

_logger = logging.getLogger(__name__)

_DIR = os.path.join(os.environ.get("DATA_DIR", "/data"), "earnings_ai_cache")

# preview (pending, forward-looking) refreshes as the report nears; analysis
# (reported) is historical → keep it longer. Env-overridable (days).
_MAX_AGE_SECS = {
    "preview":  int(os.environ.get("EARNINGS_PREVIEW_DISK_DAYS", "3")) * 86400,
    "analysis": int(os.environ.get("EARNINGS_ANALYSIS_DISK_DAYS", "7")) * 86400,
}
_DEFAULT_MAX_AGE = 3 * 86400


def _safe(sym: str) -> str:
    return os.path.basename((sym or "").upper().strip())


def _path(kind: str, sym: str) -> str:
    return os.path.join(_DIR, f"{kind}_{_safe(sym)}.json")


def get(kind: str, sym: str):
    """Return the persisted result dict if present AND fresh, else None."""
    try:
        p = _path(kind, sym)
        if not os.path.exists(p):
            return None
        age = time.time() - os.path.getmtime(p)
        if age > _MAX_AGE_SECS.get(kind, _DEFAULT_MAX_AGE):
            return None
        with open(p, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as e:
        _logger.debug("earnings_ai_store.get failed %s/%s: %s", kind, sym, e)
        return None


def put(kind: str, sym: str, result: dict) -> None:
    """Persist a successful result atomically. Callers must only persist real
    output (non-empty preview_text / analysis) — a miss should stay lazy."""
    try:
        os.makedirs(_DIR, exist_ok=True)
        p = _path(kind, sym)
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(result, fh)
        os.replace(tmp, p)
    except Exception as e:
        _logger.debug("earnings_ai_store.put failed %s/%s: %s", kind, sym, e)


def is_fresh(kind: str, sym: str) -> bool:
    """Cheap freshness check (no JSON parse) so the warm pass can skip a name
    without spawning a generation thread that would immediately return."""
    try:
        p = _path(kind, sym)
        if not os.path.exists(p):
            return False
        return (time.time() - os.path.getmtime(p)) <= _MAX_AGE_SECS.get(kind, _DEFAULT_MAX_AGE)
    except Exception:
        return False
