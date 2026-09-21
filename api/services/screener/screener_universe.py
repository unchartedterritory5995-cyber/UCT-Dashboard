"""The screener's OWN symbol universe — every US common stock + ADR that trades,
with NO price and NO market-cap floor.

⛔ WHY THIS IS SEPARATE FROM `cap_universe`. `api/data/cap_universe.json` (the
app-wide "$300M+ symbol list") is read by ~75 modules — the whole-universe bars
pre-cache, ticker search, the name/logo prewarmers, chart-health. Growing IT to
"every stock" would ~double all of that background work on the single web pod.
So the screener gets its own, wider pool that ONLY the screener snapshot builder
iterates; everything else keeps the curated cap universe untouched.

"All Market" on the page = this whole set. "UCT Universe" is the liquid subset,
applied at READ time in `query.py::_universe_clauses` (price ≥ $5, 30-day $-vol
≥ $20M) — not baked into this list, so the two pools stay one file + one gate.

LOAD precedence (first non-empty wins):
  1. env `SCREENER_UNIVERSE_PATH`            (tests / explicit override)
  2. `<DATA_DIR>/screener_universe.json`     (refreshed on the pod by build_and_save)
  3. `api/data/screener_universe.json`       (committed fallback, may be absent)
  4. `cap_universe.symbols()`                (LAST resort → identical to the old
                                              behaviour, so a missing file is
                                              never a regression, only "not wider yet")

Never raises. A total failure yields the cap universe so the screener still builds.
"""
from __future__ import annotations

import json
import logging
import os

log = logging.getLogger(__name__)

_FILENAME = "screener_universe.json"
_BUYOUT_FILENAME = "screener_buyout_exclude.json"

# US common stock + ADR classes, per `api/ticker_types.py`. Deliberately NARROW:
# no preferreds (PFD), units, rights, warrants, ETFs, ETNs or funds — "US stocks
# + ADR" is exactly common + depositary receipts.
KEEP_TYPES = frozenset({"CS", "ADRC", "ADRP", "ADRR", "ADRW"})


def _pkg_data_path(filename: str) -> str:
    """A data file inside the api package, then relative to CWD."""
    here = os.path.join(os.path.dirname(__file__), "..", "..", "data", filename)
    if os.path.exists(here):
        return here
    return os.path.join("api", "data", filename)


def _data_dir() -> str:
    return os.environ.get("DATA_DIR", "/data")


def writable_path() -> str:
    """Where `build_and_save` writes — the refreshed copy the loader prefers.
    Env override wins so a test never touches the real volume."""
    override = os.environ.get("SCREENER_UNIVERSE_PATH")
    if override:
        return override
    return os.path.join(_data_dir(), _FILENAME)


def _load_paths() -> list[str]:
    override = os.environ.get("SCREENER_UNIVERSE_PATH")
    paths = []
    if override:
        paths.append(override)
    paths.append(os.path.join(_data_dir(), _FILENAME))
    paths.append(_pkg_data_path(_FILENAME))
    return paths


def _read_list(path: str) -> list[str]:
    """A flat JSON list of ticker strings → upper-cased list, or [] on any fault."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        return []
    except Exception as exc:                                # noqa: BLE001
        log.warning("[screener-universe] load failed for %s: %s", path, exc)
        return []
    if not isinstance(data, list):
        log.warning("[screener-universe] %s is not a list", path)
        return []
    return [str(t).upper() for t in data if t]


def buyout_excludes() -> frozenset[str]:
    """Owner-maintained buyout / M&A exclude set. There is NO live acquisition
    feed anywhere in the app, so this is a best-effort hand list — subtracted at
    build time and easy to extend (`api/data/screener_buyout_exclude.json`)."""
    return frozenset(_read_list(_pkg_data_path(_BUYOUT_FILENAME)))


def symbols() -> list[str]:
    """The screener universe, best available source. Falls back to the cap
    universe so the screener never loses its universe just because the wider file
    has not been generated yet."""
    for p in _load_paths():
        got = _read_list(p)
        if got:
            return sorted(set(got))
    # Last resort: the app-wide cap universe (== the pre-2026-09-21 behaviour).
    try:
        from api.services import cap_universe
        return sorted(cap_universe.symbols())
    except Exception:                                      # noqa: BLE001
        return []


# ── the generator (runs where the Massive key lives: the web pod) ──────────────

def _recent_traded_set(sessions: int, min_shares: float,
                       max_lookback_days: int = 12) -> set[str]:
    """Union of tickers that actually traded (volume ≥ min_shares) across the last
    `sessions` non-empty grouped-daily frames — the "not a dead shell" signal.
    One whole-market call per day; empty (holiday) frames are skipped."""
    from datetime import date, timedelta
    from api.services import massive
    live: set[str] = set()
    got = 0
    day = date.today()
    for _ in range(max_lookback_days):
        day -= timedelta(days=1)
        if day.weekday() >= 5:                             # skip Sat/Sun cheaply
            continue
        frame = massive.get_grouped_daily_ohlcv(day.isoformat()) or {}
        if not frame:
            continue
        for tk, row in frame.items():
            try:
                if float(row.get("v") or 0) >= min_shares:
                    live.add(str(tk).upper())
            except Exception:                              # noqa: BLE001
                continue
        got += 1
        if got >= sessions:
            break
    return live


def build_and_save(min_shares: float | None = None, sessions: int = 5,
                   write_path: str | None = None) -> dict:
    """Regenerate the screener universe from Massive reference and persist it.

    US common + ADR (`KEEP_TYPES`), active, NO price/market-cap floor, minus
    truly dead shells (never traded ≥ `min_shares` over the recent window) and
    minus the buyout exclude list. A name in the curated cap universe is ALWAYS
    kept even if it fails the liveness test — the known-good core can never shrink.

    Returns a summary; writes a flat JSON list. Best-effort: on a reference-API
    failure it writes nothing and reports `final == 0`, so the loader keeps the
    previous file (or the cap-universe fallback) rather than blanking the screener.
    """
    from api.services import massive
    if min_shares is None:
        try:
            min_shares = float(os.environ.get("SCREENER_UNIVERSE_MIN_SHARES", "1000"))
        except Exception:                                  # noqa: BLE001
            min_shares = 1000.0

    ref = massive.list_reference_tickers(active=True, market="stocks") or []
    typed: dict[str, str] = {}
    for r in ref:
        tk = str(r.get("ticker") or "").upper()
        typ = str(r.get("type") or "").upper()
        if tk and typ in KEEP_TYPES:
            typed[tk] = typ

    if not typed:
        # Reference call failed — do NOT overwrite a good file with nothing.
        log.warning("[screener-universe] reference returned no CS/ADR names; "
                    "leaving the existing universe untouched")
        return {"ok": False, "reason": "reference_empty", "final": 0}

    live = _recent_traded_set(sessions, min_shares)
    try:
        from api.services import cap_universe
        core = set(cap_universe.symbols())
    except Exception:                                      # noqa: BLE001
        core = set()
    excl = buyout_excludes()

    # Keep a typed name if it traded recently OR is in the curated core; then drop
    # buyouts. If the liveness frame came back empty (provider hiccup), don't let
    # it delete the world — fall through to "all typed minus buyouts".
    keep_live = live or set(typed)
    final = sorted(t for t in typed
                   if (t in keep_live or t in core) and t not in excl)

    dest = write_path or writable_path()
    os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
    tmp = dest + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(final, fh)
    os.replace(tmp, dest)

    summary = {
        "ok": True,
        "reference_total": len(ref),
        "kept_type": len(typed),
        "traded_recently": len(live),
        "excluded_buyouts": sum(1 for t in typed if t in excl),
        "final": len(final),
        "min_shares": min_shares,
        "path": dest,
    }
    log.info("[screener-universe] rebuilt: %s", summary)
    return summary
