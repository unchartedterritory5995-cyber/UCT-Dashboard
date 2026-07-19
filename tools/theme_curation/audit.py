"""Stage 1 — mechanical audit (pure-local, no LLM)."""
from datetime import datetime

from tools.theme_curation import loaders

THIN_MIN = 4
_IPO_MAX_AGE_DAYS = 365


def _ipo_ordinal(iso: str):
    try:
        return datetime.strptime(iso, "%Y-%m-%d").date().toordinal()
    except Exception:
        return None


def audit_taxonomy(taxonomy: dict, cap_set: set, ipo_dates: dict, now_days: int) -> dict:
    themes_out = {}
    covered = set()
    for t in taxonomy.get("themes", []):
        syms = loaders.holding_syms(t)          # hyphen form, order preserved
        covered.update(syms)
        seen, dups, dead = set(), [], []
        for s in syms:
            if s in seen:
                dups.append(s)
            seen.add(s)
            if s not in cap_set:
                dead.append(s)
        chartable = [s for s in set(syms) if s in cap_set]
        themes_out[t["id"]] = {"dead": dead, "dups": dups, "thin": len(chartable) < THIN_MIN}

    gap_pool = []
    for tk, iso in ipo_dates.items():
        s = loaders.norm(tk)
        if s in covered or s not in cap_set:
            continue
        o = _ipo_ordinal(iso)
        aged = bool(o is not None and (now_days - o) > _IPO_MAX_AGE_DAYS)
        gap_pool.append({"sym": s, "ipo_date": iso, "aged_out": aged})
    return {"themes": themes_out, "gap_pool": gap_pool}


def write_audit_md(result: dict, taxonomy: dict) -> str:
    by_id = loaders.theme_by_id(taxonomy)
    lines = ["# Taxonomy Audit", ""]
    for tid, flags in result["themes"].items():
        name = by_id.get(tid, {}).get("name", tid)
        if not (flags["dead"] or flags["dups"] or flags["thin"]):
            continue
        lines.append(f"## {name} (`{tid}`)")
        if flags["dead"]:
            lines.append(f"- **dead (not in cap_universe):** {', '.join(flags['dead'])}")
        if flags["dups"]:
            lines.append(f"- **duplicate syms:** {', '.join(flags['dups'])}")
        if flags["thin"]:
            lines.append(f"- **thin** (informational — do NOT pad for strength)")
        lines.append("")
    live = [g for g in result["gap_pool"] if not g["aged_out"]]
    if live:
        lines.append("## Gap pool (in cap_universe / IPO tracker, in no theme)")
        lines += [f"- {g['sym']} (IPO {g['ipo_date']})" for g in live]
    return "\n".join(lines) + "\n"
