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


def dead_syms(taxonomy: dict, cap_set: set) -> set:
    """Union of every holding across all themes that is absent from cap_universe.
    The caller liveness-checks these to split delisted from off-universe."""
    out = set()
    for t in taxonomy.get("themes", []):
        out.update(s for s in loaders.holding_syms(t) if s not in cap_set)
    return out


def audit_taxonomy(taxonomy: dict, cap_set: set, ipo_dates: dict, now_days: int,
                   live: set = None) -> dict:
    # `live` (optional): syms confirmed still-trading by liveness.live_syms. When given,
    # a not-in-cap holding that is live is reclassified 'off_universe' (a cap_universe
    # gap, NOT a taxonomy defect) and kept OUT of the genuinely-gone 'dead' list that
    # grounds the discover DROP/REMAP prompt. live=None => no split (all not-in-cap =>
    # 'dead'), the pure-local default.
    themes_out = {}
    covered = set()
    for t in taxonomy.get("themes", []):
        syms = loaders.holding_syms(t)          # hyphen form, order preserved
        covered.update(syms)
        seen, dups, dead, off_universe = set(), [], [], []
        for s in syms:
            if s in seen:
                dups.append(s)
            seen.add(s)
            if s not in cap_set:
                if live is not None and s in live:
                    off_universe.append(s)
                else:
                    dead.append(s)
        chartable = [s for s in set(syms) if s in cap_set]
        themes_out[t["id"]] = {"dead": dead, "off_universe": off_universe,
                               "dups": dups, "thin": len(chartable) < THIN_MIN}

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
    cap_gap = {}     # sym -> [theme names] (live holdings absent from cap_universe)
    for tid, flags in result["themes"].items():
        name = by_id.get(tid, {}).get("name", tid)
        off = flags.get("off_universe") or []
        for s in off:
            cap_gap.setdefault(s, []).append(name)
        if not (flags["dead"] or off or flags["dups"] or flags["thin"]):
            continue
        lines.append(f"## {name} (`{tid}`)")
        if flags["dead"]:
            lines.append(f"- **dead (delisted / renamed — not in cap_universe):** {', '.join(flags['dead'])}")
        if off:
            lines.append(f"- **off cap_universe (still trading — add to cap_universe, do NOT drop):** {', '.join(off)}")
        if flags["dups"]:
            lines.append(f"- **duplicate syms:** {', '.join(flags['dups'])}")
        if flags["thin"]:
            lines.append(f"- **thin** (informational — do NOT pad for strength)")
        lines.append("")
    if cap_gap:
        lines.append("## cap_universe gap (live tickers held by a theme but not chartable)")
        lines.append("_These are valid, still-trading names the dashboard's cap_universe is "
                     "missing — add them to `api/data/cap_universe.json`, they are NOT taxonomy defects._")
        for s in sorted(cap_gap):
            lines.append(f"- {s} — {', '.join(cap_gap[s])}")
        lines.append("")
    live = [g for g in result["gap_pool"] if not g["aged_out"]]
    if live:
        lines.append("## Gap pool (in cap_universe / IPO tracker, in no theme)")
        lines += [f"- {g['sym']} (IPO {g['ipo_date']})" for g in live]
    return "\n".join(lines) + "\n"
