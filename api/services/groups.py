"""Multi-Chart "Groups" service.

Turns a theme (or a ticker's theme) into a chartable, ranked list of symbols
for the /charts grid. Identity/holdings come from theme_db (SQLite, always
warm); the ranking overlay comes from theme_performance + rs_ranking with a
cold-cache fallback to the taxonomy's curated tier order.

CANONICAL SYMBOL FORM IS HYPHEN + UPPERCASE (BRK-B) — matches cap_universe,
ticker-search, and /api/bars. The taxonomy stores dot class-shares (BRK.B);
convert with to_taxonomy_sym() only for theme_db lookups.
"""
import json
import logging
import os
import time

_logger = logging.getLogger(__name__)

_CAP_CACHE = {"set": None, "at": 0.0}
_CAP_TTL = 3600.0


def normalize_sym(s: str) -> str:
    """App-canonical form for charting/search/cells: uppercase, dot->hyphen."""
    return (s or "").strip().upper().replace(".", "-")


def to_taxonomy_sym(s: str) -> str:
    """Taxonomy (theme_db) form: uppercase, hyphen->dot class-shares."""
    return (s or "").strip().upper().replace("-", ".")


def _cap_universe_path() -> str:
    here = os.path.join(os.path.dirname(__file__), "..", "data", "cap_universe.json")
    return here if os.path.exists(here) else os.path.join("api", "data", "cap_universe.json")


def cap_universe_set() -> set:
    """Cached set of chartable tickers (hyphen form). 1h TTL. A failed/empty
    load is NOT cached so a transient miss retries next call (never pins the
    whole feature 'non-chartable' for an hour)."""
    now = time.monotonic()
    if _CAP_CACHE["set"] and (now - _CAP_CACHE["at"]) < _CAP_TTL:
        return _CAP_CACHE["set"]
    out = set()
    try:
        with open(_cap_universe_path(), "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, list):
            out = {normalize_sym(t) for t in data if t}
    except Exception as e:
        _logger.warning("groups: cap_universe load failed: %s", e)
        out = set()
    if out:                       # only cache a real (non-empty) universe
        _CAP_CACHE["set"] = out
        _CAP_CACHE["at"] = now
    return out


def is_chartable(sym: str) -> bool:
    return normalize_sym(sym) in cap_universe_set()


def _get_all_themes():
    from api.services import theme_db
    return theme_db.get_all_themes()


def _rotation_order():
    """theme_name (lower) -> rank index, hottest first (highest 1-week rank
    percentile from theme-rotation). {} when the rotation cache is cold /
    unavailable, so list_groups() falls back to name order."""
    try:
        from api.services import theme_performance
        sig = theme_performance.compute_rotation_signals()
        rankings = (sig or {}).get("rankings") or {}
        rows = []
        for entry in rankings.values():
            nm = (entry.get("name") or "").strip().lower()
            if nm:
                rows.append((entry.get("1w_rank"), nm))
        # Hottest first: highest 1w_rank; None ranks sink last; name for ties.
        rows.sort(key=lambda r: (-(r[0]) if r[0] is not None else float("inf"), r[1]))
        return {nm: i for i, (_, nm) in enumerate(rows)}
    except Exception:
        return {}


def list_groups() -> list:
    """Groups for the picker: {id,name,sector_id,etf_ticker,total,chartable,sub_theme_count}, hottest first."""
    data = _get_all_themes()
    cap = cap_universe_set()
    order = _rotation_order()
    rows = []
    for t in data.get("themes", []):
        holdings = t.get("holdings") or []
        chartable = sum(1 for h in holdings if normalize_sym(h.get("sym", "")) in cap)
        rows.append({
            "id": t["id"],
            "name": t["name"],
            "sector_id": t.get("sector_id"),
            "etf_ticker": t.get("etf_ticker"),
            "total": len(holdings),
            "chartable": chartable,
            "sub_theme_count": len(t.get("sub_themes") or []),
        })
    # Hot themes first (rotation rank); themes not in the signal sink to the
    # bottom in stable name order — cold cache => plain alphabetical.
    big = len(rows) + 1
    rows.sort(key=lambda r: (order.get((r["name"] or "").strip().lower(), big), r["name"]))
    return rows
