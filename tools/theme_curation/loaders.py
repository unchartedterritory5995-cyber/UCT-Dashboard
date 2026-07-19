"""Local data loading + canonical symbol helpers for the curation pipeline."""
import json

from api.services.groups import normalize_sym as _norm, to_taxonomy_sym as _dot


def norm(sym: str) -> str:
    """Canonical hyphen+upper form (dedup/cap_universe/Finviz/Perplexity side)."""
    return _norm(sym)


def to_dot(sym: str) -> str:
    """Taxonomy (dot) form — used only when writing holdings back to JSON."""
    return _dot(sym)


def load_taxonomy(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_taxonomy(path: str, data: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def cap_universe_set(path: str) -> set:
    with open(path, encoding="utf-8") as f:
        return {norm(s) for s in json.load(f) if s}


def ipo_dates() -> dict:
    from api.services.ipo_maintenance import IPO_DATES
    return dict(IPO_DATES)


def theme_by_id(taxonomy: dict) -> dict:
    return {t["id"]: t for t in taxonomy.get("themes", [])}


def holding_syms(theme: dict) -> list:
    """Hyphen-form syms of a theme's holdings, order preserved."""
    return [norm(h["sym"]) for h in theme.get("holdings", []) if h.get("sym")]
