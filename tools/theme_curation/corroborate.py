"""Stage 2 Finviz corroboration — a per-ticker industry check, NOT enumeration."""
import json

from api.services import industry_map


def ensure_industry_map() -> None:
    st = industry_map.status()
    if st.get("rows", 0) == 0 or st.get("stale"):
        n = industry_map.bulk_refresh_from_finviz()
        if not n:
            raise RuntimeError(
                "industry_map is empty and the Finviz refresh returned 0 rows — "
                "set FINVIZ_API_KEY (Finviz Elite) in your .env before running curation.")


def load_theme_industries(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def corroborate(syms: list, expected_industries) -> dict:
    if not expected_industries:
        return {s: False for s in syms}
    exp = set(expected_industries)
    groups = industry_map.get_groups(syms)
    out = {}
    for s in syms:
        ind = (groups.get(s) or {}).get("industry")
        out[s] = bool(ind and ind in exp)
    return out
