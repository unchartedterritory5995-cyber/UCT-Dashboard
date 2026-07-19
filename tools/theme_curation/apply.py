"""Stage 4 — cross-referential validation, mutation, content-hashed version bump."""
import copy
import hashlib
import json
from datetime import date, timezone, datetime

from tools.theme_curation import loaders
from tools.theme_curation.proposals import TIERS


def _tax_copy(tax):
    return copy.deepcopy(tax)


def _sub_ids(theme):
    return {s.get("id") for s in theme.get("sub_themes", [])}


def validate_proposal(p, theme, cap_set):
    cur = set(loaders.holding_syms(theme))
    subs = _sub_ids(theme)
    f = p.fields
    if p.action == "drop":
        if p.sym not in cur:
            return f"drop {p.sym}: not a current member"
    elif p.action == "add":
        if p.sym in cur:
            return f"add {p.sym}: already present"
        if p.sym not in cap_set:
            return f"add {p.sym}: not chartable"
        if f.get("sub_theme_id") not in (None, *subs):
            return f"add {p.sym}: invalid sub_theme_id {f.get('sub_theme_id')!r}"
    elif p.action == "remap":
        new = f.get("new_sym")
        if p.sym not in cur:
            return f"remap {p.sym}: old not a current member"
        if new not in cap_set:
            return f"remap {p.sym}->{new}: new not chartable"
        if f.get("sub_theme_id") not in (None, *subs):
            return f"remap {p.sym}: invalid sub_theme_id"
    elif p.action == "retier":
        if p.sym not in cur:
            return f"retier {p.sym}: not a current member"
        if f.get("new_tier") not in TIERS:
            return f"retier {p.sym}: invalid tier"
    return None


def _find(holdings, sym):
    for h in holdings:
        if loaders.norm(h.get("sym", "")) == sym:
            return h
    return None


def apply_proposals(taxonomy, approved, cap_set):
    tax = _tax_copy(taxonomy)
    by_id = loaders.theme_by_id(tax)
    rejects = []
    for p in approved:
        theme = by_id.get(p.theme_id)
        if theme is None:
            rejects.append(f"{p.theme_id}: unknown theme")
            continue
        why = validate_proposal(p, theme, cap_set)
        if why:
            rejects.append(why)
            continue
        H = theme["holdings"]
        if p.action == "drop":
            theme["holdings"] = [h for h in H if loaders.norm(h["sym"]) != p.sym]
        elif p.action == "add":
            theme["holdings"].append({
                "sym": loaders.to_dot(p.sym), "tier": p.fields.get("tier", "relevant"),
                "sub_theme_id": p.fields.get("sub_theme_id"),
                "rationale": p.fields.get("rationale", "")})
        elif p.action == "remap":
            old = _find(H, p.sym)
            new_sym = p.fields["new_sym"]
            theme["holdings"] = [h for h in H if loaders.norm(h["sym"]) != p.sym]
            existing = _find(theme["holdings"], new_sym)
            if existing is None:      # append (inherit old's fields unless overridden)
                theme["holdings"].append({
                    "sym": loaders.to_dot(new_sym),
                    "tier": p.fields.get("tier") or (old or {}).get("tier", "relevant"),
                    "sub_theme_id": p.fields.get("sub_theme_id") or (old or {}).get("sub_theme_id"),
                    "rationale": p.fields.get("rationale") or (old or {}).get("rationale", "")})
            # else: new already present -> the drop-old above is the whole merge
        elif p.action == "retier":
            h = _find(H, p.sym)
            if h is not None:
                h["tier"] = p.fields["new_tier"]
    return tax, rejects


def self_validate(taxonomy):
    errs = []
    for s in taxonomy.get("sectors", []):
        if not (s.get("id") and s.get("name")):
            errs.append(f"sector missing id/name: {s!r}")
    for t in taxonomy.get("themes", []):
        if not (t.get("id") and t.get("name") and t.get("sector_id")):
            errs.append(f"theme missing id/name/sector_id: {t.get('id')!r}")
        if not isinstance(t.get("holdings"), list):
            errs.append(f"theme {t.get('id')!r} holdings not a list")
        for h in t.get("holdings", []):
            if not h.get("sym"):
                errs.append(f"theme {t.get('id')!r} holding missing sym: {h!r}")
    return errs


def _content_hash(taxonomy) -> str:
    canon = json.dumps({"sectors": taxonomy.get("sectors", []),
                        "themes": taxonomy.get("themes", [])},
                       sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()[:8]


def _bump_semver(v: str) -> str:
    base = (v or "0.0.0").split("+")[0]
    parts = base.split(".")
    while len(parts) < 3:
        parts.append("0")
    try:
        parts[1] = str(int(parts[1]) + 1)
        parts[2] = "0"
    except ValueError:
        return "0.0.0"
    return ".".join(parts[:3])


def bump_version(taxonomy) -> str:
    sha = _content_hash(taxonomy)
    ver = f"{_bump_semver(taxonomy.get('version', '0.0.0'))}+{sha}"
    taxonomy["version"] = ver
    taxonomy["generated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return ver
