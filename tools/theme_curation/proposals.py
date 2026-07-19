"""Typed proposals + strict parsing of the LLM's JSON output.

cap_universe membership is validated HERE (a non-chartable target can never be
proposed). Cross-referential validation against the theme's CURRENT state
happens at apply time (proposals may be reviewed/edited in between)."""
from dataclasses import dataclass, field

from tools.theme_curation import loaders

TIERS = {"core", "relevant", "peripheral"}
_ACTIONS = {"add", "drop", "remap", "retier"}


@dataclass
class Proposal:
    theme_id: str
    action: str
    sym: str                      # hyphen form; for remap = the OLD sym
    confidence: float
    fields: dict = field(default_factory=dict)


def pid(p: Proposal) -> str:
    s = f"{p.theme_id}::{p.sym}::{p.action}"
    if any(c.isspace() for c in s):
        raise ValueError(f"pid components must be whitespace-free: {s!r}")
    return s


def parse_llm_proposals(theme_id: str, raw: dict, cap_set: set):
    out, rejects = [], []
    for row in (raw or {}).get("proposals", []):
        try:
            action = str(row["action"]).lower().strip()
            sym = loaders.norm(row["sym"])
            conf = float(row.get("confidence", 0.0))
        except Exception:
            rejects.append(f"malformed row: {row!r}")
            continue
        if action not in _ACTIONS or not sym:
            rejects.append(f"unknown action / empty sym: {row!r}")
            continue
        if action in ("add",) and sym not in cap_set:
            rejects.append(f"add target not chartable: {sym}")
            continue
        f = {}
        if action == "add":
            tier = str(row.get("tier", "relevant")).lower()
            f = {"tier": tier if tier in TIERS else "relevant",
                 "sub_theme_id": row.get("sub_theme_id"),
                 "rationale": row.get("rationale", "")}
        elif action == "drop":
            f = {"reason": row.get("reason", "")}
        elif action == "remap":
            new_sym = loaders.norm(row.get("new_sym", ""))
            if not new_sym or new_sym not in cap_set:
                rejects.append(f"remap new_sym not chartable: {row.get('new_sym')!r}")
                continue
            tier = str(row.get("tier", "relevant")).lower()
            f = {"new_sym": new_sym, "tier": tier if tier in TIERS else "relevant",
                 "sub_theme_id": row.get("sub_theme_id"), "rationale": row.get("rationale", "")}
        elif action == "retier":
            new_tier = str(row.get("new_tier", "")).lower()
            if new_tier not in TIERS:
                rejects.append(f"retier invalid tier: {row.get('new_tier')!r}")
                continue
            f = {"new_tier": new_tier}
        out.append(Proposal(theme_id, action, sym, conf, f))
    return out, rejects
