"""Theme / sector / industry membership for the /charts Compare Symbols group picker.

Lightweight on purpose: lists groups + their CHARTABLE member symbols WITHOUT the
period-change computation. The heavy path (`scan_period.get_period_change_groups`)
fetches bars over a date range to RANK groups; the compare picker only needs each
group's name + members so it can overlay them on the active chart.

- Themes come from the owner taxonomy via `theme_db.get_all_themes()` (engine-overlay
  rows excluded, matching every other UCT group metric).
- Sectors / industries come from the prewarmed ticker_meta disk cache
  (`scan_period._sector_industry_map` — the only whole-universe sector/industry source).

Members are filtered to the chartable cap universe and de-duplicated, hyphen-upper form.
"""
from api.services.cache import cache
from api.services import groups as _groups

# The owner asked to overlay ALL of a group. That's sensible for a theme (~20-40 names)
# but a broad sector/industry can hold hundreds — each member is a live line + a bars
# fetch, so cap for the browser's sake. The legend surfaces "N of TOTAL" when capped.
MAX_MEMBERS = 50

_LIST_TTL = 900   # 15 min — taxonomy + sector map move slowly


def _chartable(syms) -> list:
    """De-dupe to hyphen-upper form, keep only names we can actually chart."""
    cap = _groups.cap_universe_set()
    out, seen = [], set()
    for s in syms:
        h = _groups.normalize_sym(s or "")
        if h and h in cap and h not in seen:
            seen.add(h)
            out.append(h)
    return out


def _theme_groups() -> list:
    from api.services import theme_db
    try:
        themes = theme_db.get_all_themes().get("themes", [])
    except Exception:
        themes = []
    out = []
    for th in themes:
        name = th.get("name")
        if not name:
            continue
        syms = [h.get("sym") for h in (th.get("holdings") or []) if h.get("source") != "engine"]
        members = _chartable(syms)
        if members:
            out.append({"name": name, "symbols": members})
    return out


def _si_groups(field: str) -> list:
    """field ∈ {'sector','industry'} — invert the whole-universe sector/industry map."""
    from api.services.scan_period import _sector_industry_map
    try:
        smap = _sector_industry_map()
    except Exception:
        smap = {}
    buckets: dict = {}
    for sym, d in (smap or {}).items():
        g = (d or {}).get(field)
        if not g:
            continue
        buckets.setdefault(g, []).append(sym)
    out = []
    for name, syms in buckets.items():
        members = _chartable(syms)
        if members:
            out.append({"name": name, "symbols": members})
    return out


def all_groups(gtype: str) -> list:
    """[{name, symbols:[...]}] for gtype ∈ {theme,sector,industry}, biggest first. Cached."""
    if gtype not in ("theme", "sector", "industry"):
        return []
    ck = f"compare_groups_{gtype}"
    hit = cache.get(ck)
    if hit is not None:
        return hit
    groups = _theme_groups() if gtype == "theme" else _si_groups(gtype)
    groups.sort(key=lambda g: (-len(g["symbols"]), g["name"]))
    cache.set(ck, groups, _LIST_TTL)
    return groups


def list_groups(gtype: str) -> list:
    """[{name, count}] for the picker list."""
    return [{"name": g["name"], "count": len(g["symbols"])} for g in all_groups(gtype)]


def group_members(gtype: str, name: str) -> dict:
    """{name, symbols:[...capped], total, truncated} for one chosen group."""
    want = (name or "").strip().lower()
    for g in all_groups(gtype):
        if g["name"].lower() == want:
            syms = g["symbols"]
            total = len(syms)
            return {
                "name": g["name"],
                "symbols": syms[:MAX_MEMBERS],
                "total": total,
                "truncated": total > MAX_MEMBERS,
            }
    return {"name": name, "symbols": [], "total": 0, "truncated": False}
