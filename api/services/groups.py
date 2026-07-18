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

from api.services.ticker_meta import _TIER_RANK

_logger = logging.getLogger(__name__)

_CAP_CACHE = {"set": None, "at": 0.0}
_CAP_TTL = 3600.0

_SIZES_CACHE = {"map": None, "at": 0.0}
_SIZES_TTL = 3600.0


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


def _theme_sizes() -> dict:
    """{theme_id: holding_count} for every theme. Cached 1h — theme sizes only
    change on a taxonomy reseed (deploy). Avoids routing a single size lookup
    through list_groups() (which also computes chartable counts + rotation
    order it doesn't need) and its uncached full-taxonomy read — this map backs
    resolve_primary_theme, which is on the universal chart-watermark hot path."""
    now = time.monotonic()
    if _SIZES_CACHE["map"] is not None and (now - _SIZES_CACHE["at"]) < _SIZES_TTL:
        return _SIZES_CACHE["map"]
    out = {}
    try:
        data = _get_all_themes()
        for t in data.get("themes", []):
            out[t["id"]] = len(t.get("holdings") or [])
    except Exception:
        out = {}
    if out:                       # only cache a real (non-empty) map
        _SIZES_CACHE["map"] = out
        _SIZES_CACHE["at"] = now
    return out


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


def _today_map(syms: list) -> dict:
    """{sym(hyphen upper): todaysChangePerc}. One batched Massive snapshot; the
    same source theme_performance uses. Empty on failure (falls back to RS)."""
    if not syms:
        return {}
    try:
        from api.services.massive import get_etf_snapshots
        raw = get_etf_snapshots(syms) or {}
        return {normalize_sym(k): v for k, v in raw.items()}
    except Exception:
        return {}


def _rs_map() -> dict:
    """{ticker(hyphen upper): rs item}. Cache-only; {} when cold."""
    try:
        from api.services.rs_ranking import compute_rs_scores
        return {normalize_sym(it["ticker"]): it for it in (compute_rs_scores() or [])}
    except Exception:
        return {}


def rank_holdings(holdings: list, by: str = "today", seed: str = None) -> list:
    """Rank taxonomy holdings; return chartable hyphen syms best-first.

    holdings: [{sym, tier, sub_theme_id?}] in taxonomy (dot) form.
    Excludes the seed and non-chartable names. No-data names sort last.
    """
    cap = cap_universe_set()
    seed_hy = normalize_sym(seed) if seed else None
    cands = []
    for idx, h in enumerate(holdings):
        hy = normalize_sym(h.get("sym", ""))
        if not hy or hy not in cap or hy == seed_hy:
            continue
        cands.append((idx, hy, h))
    if not cands:
        return []

    today = _today_map([hy for _, hy, _ in cands])
    rs = _rs_map()

    def bands(hy, h):
        t = today.get(hy)
        r = rs.get(hy) or {}
        rank = r.get("rs_rank")
        m1 = (r.get("returns") or {}).get("1m")
        tier = _TIER_RANK.get(h.get("tier"), 99)
        metrics = {"today": t, "rs": rank, "m1": m1}
        primary = "today" if by != "rs" else "rs"
        secondary = "rs" if by != "rs" else "today"
        order = [primary, secondary, "m1"]
        for band, key in enumerate(order):
            v = metrics[key]
            if v is not None:
                return (band, -float(v))
        # Band 3: no data — curated tier order, then taxonomy list position.
        return (len(order), tier)

    cands.sort(key=lambda c: (bands(c[1], c[2]), c[0]))
    return [hy for _, hy, _ in cands]


def _ranked_as_of() -> str:
    try:
        from api.services.massive import _detect_session
        return _detect_session()
    except Exception:
        return "unknown"


def _theme_holdings(theme_id: str) -> list:
    """Fetch holdings for a theme. Helper for testing and top_n()."""
    from api.services import theme_db
    return theme_db.get_theme_holdings(theme_id)


def top_n(theme_id: str, n: int, by: str = "today") -> dict:
    holdings = _theme_holdings(theme_id)
    ranked = rank_holdings(holdings, by=by)
    top = ranked[: max(1, int(n))]
    # Per-sym tier + rationale for the cell badges (keyed hyphen).
    meta = {normalize_sym(h.get("sym", "")): h for h in holdings}
    rows = [{
        "sym": s,
        "tier": (meta.get(s) or {}).get("tier"),
        "rationale": (meta.get(s) or {}).get("rationale") or "",
    } for s in top]
    return {
        "group_id": theme_id,
        "syms": top,
        "rows": rows,
        "total": len(ranked),
        "by": "rs" if by == "rs" else "today",
        "ranked_as_of": _ranked_as_of(),
    }


# Style/factor buckets are poor peer sets — excluded from seed resolution.
_FACTOR_THEME_NAMES = {
    "meme & retail", "small cap growth", "dividend aristocrats",
}


def _themes_for_ticker(sym: str) -> list:
    from api.services import theme_db
    return theme_db.get_themes_for_ticker(to_taxonomy_sym(sym))


def _theme_size(theme_id: str) -> int:
    return _theme_sizes().get(theme_id, 0)


def resolve_primary_theme(sym: str):
    """The membership row whose theme the seed should take peers from, or None.
    Smallest theme where the seed ranks highest by tier; factor buckets excluded.
    Shared with ticker_meta so the displayed theme and filled peers agree."""
    rows = [r for r in _themes_for_ticker(sym)
            if (r.get("theme_name") or "").strip().lower() not in _FACTOR_THEME_NAMES]
    if not rows:
        return None
    rows.sort(key=lambda r: (
        _TIER_RANK.get(r.get("tier"), 99),
        _theme_size(r.get("theme_id")),
        r.get("theme_id") or "",
    ))
    return rows[0]


def resolve_peers(sym: str, n: int) -> dict:
    """Peers = the seed's primary theme's other chartable holdings, same
    sub-theme floated to the top, ranked by today's move. v1: no AI fallback —
    a taxonomy miss returns source='none' (caller keeps the seed solo)."""
    seed_hy = normalize_sym(sym)
    row = resolve_primary_theme(sym)
    if not row:
        return {"seed": seed_hy, "group_id": None, "peers": [], "source": "none"}

    theme_id = row.get("theme_id")
    seed_sub = row.get("sub_theme_id")
    holdings = _theme_holdings(theme_id)
    ranked = rank_holdings(holdings, by="today", seed=seed_hy)  # chartable, seed-excluded

    sub_by_sym = {normalize_sym(h.get("sym", "")): h.get("sub_theme_id") for h in holdings}
    # Stable float: same-sub-theme names first, preserving the ranked order within each group.
    ranked.sort(key=lambda hy: 0 if (seed_sub and sub_by_sym.get(hy) == seed_sub) else 1)

    return {
        "seed": seed_hy,
        "group_id": theme_id,
        "peers": ranked[: max(1, int(n))],
        "source": "taxonomy",
    }
