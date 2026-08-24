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


# SHAPE version of the persisted payload — bumped whenever the generator's
# prompt changes what the text LOOKS like, not merely what it says.
#
# This layer is the reason a prompt change can ship and change nothing. The
# in-memory cache key in engine.py is versioned (`earnings_preview_v3_{sym}`),
# but that only survives until the next redeploy; THIS file is the copy that
# persists on /data and is served "instantly to every user, forever, at zero
# token cost" — which is exactly what a warm name gets. Bumping only the memory
# key would have left every already-warmed reporter serving the OLD long-form
# preview from disk for its full 3-day (preview) / 7-day (analysis) life, so
# the names people actually open — the warm ones — would have been the last to
# see the change, and a spot-check on a cold ticker would have looked correct.
#
# v3 (2026-08-23): preview cut to ~120 words + 3 one-line bullets; analysis
# rewritten as a standalone result summary. Old v2 files are simply never read
# again and age out on their existing TTL — no migration, no delete pass.
_SHAPE = os.environ.get("EARNINGS_AI_SHAPE", "v3")


def _path(kind: str, sym: str) -> str:
    return os.path.join(_DIR, f"{kind}_{_SHAPE}_{_safe(sym)}.json")


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
    output (non-empty preview_text / analysis) — a miss should stay lazy.

    `allow_nan=False` — a NaN/Inf anywhere in `result` (e.g. a yfinance
    data-gap producing a NaN return in earnings_enrichment.get_pre_earnings_
    context, live-verified for UBER) must never reach disk. The plain
    `json.dump` default (`allow_nan=True`) used to write it "successfully" —
    valid-per-Python, invalid-per-spec JSON — which only moved the crash from
    THIS write to EVERY future read: Starlette's own JSONResponse encoder uses
    `allow_nan=False`, so a poisoned file 500'd `/api/earnings-analysis/{sym}`
    on every request for up to `_MAX_AGE_SECS[kind]` (7 days for analysis)
    until it finally aged out — surviving a server restart, because that is
    this store's whole point. Refusing to persist here is the disk-cache
    sibling of "never cache a failed fetch as a value"."""
    try:
        os.makedirs(_DIR, exist_ok=True)
        p = _path(kind, sym)
        tmp = p + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(result, fh, allow_nan=False)
        except ValueError as e:
            _logger.warning("earnings_ai_store.put refused a non-finite payload %s/%s: %s", kind, sym, e)
            try:
                os.remove(tmp)
            except OSError:
                pass
            return
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


def read(kind: str, sym: str):
    """Return the persisted dict REGARDLESS of age (None if missing). Used for
    skip-if-stable: compare the stored signals_hash to the current inputs even
    when the file is past its display max-age."""
    try:
        p = _path(kind, sym)
        if not os.path.exists(p):
            return None
        with open(p, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def age(kind: str, sym: str):
    """Seconds since last write, or None if the file doesn't exist."""
    try:
        p = _path(kind, sym)
        if not os.path.exists(p):
            return None
        return time.time() - os.path.getmtime(p)
    except Exception:
        return None


def touch(kind: str, sym: str) -> None:
    """Refresh the file mtime (skip-if-stable reuse keeps a still-valid preview
    'fresh' without a rewrite)."""
    try:
        p = _path(kind, sym)
        if os.path.exists(p):
            os.utime(p, None)
    except Exception:
        pass
