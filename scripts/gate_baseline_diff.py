"""Classify a baseline diff into its THREE directions, each with its own name and consequence.

⛔ WHY THIS EXISTS. The ad-hoc script that produced the 2026-09-09 base measurements printed ONE
label for a direction it had misnamed:

    "in the committed baseline but NOT failing at base ...  <== would be HUB-INTRODUCED and BLOCKS"

That is exactly backwards. An entry in the baseline that no longer fails at the base means MASTER
FIXED IT (or the baseline is stale) — it never blocks. HUB-INTRODUCED is the opposite direction: a
failure the BRANCH has that the base does not.

The mislabel did not cause a wrong decision, because it was read by someone who checked the
attribution before acting. That is precisely the kind of luck this repo does not rely on: a label
that says BLOCKS on a non-blocking direction is a wrong answer waiting for a reader in a hurry.

⭐ THE THREE DIRECTIONS ARE NOT SYMMETRIC, which is the whole reason to name them separately:

    hub_introduced     branch fails it, base does not   -> ⛔ BLOCKS. The branch caused it.
    master_introduced  base fails it, baseline lacks it -> ADD to the baseline, citing the base
                                                           hash. It is master's, and the gate must
                                                           not blame the branch for it.
    master_fixed       baseline has it, base passes it  -> REMOVE from the baseline, citing the
                                                           master commit responsible. Never blocks.

⚠️ `hub_introduced` needs a measurement OF THE BRANCH. The baseline file is not that — it is a
record of a past branch run, which goes stale the moment master moves. Pass `branch=` from a real
run (the gate manifest's own failure list) or leave it None and get an explicit "not assessed".
"""
from __future__ import annotations

BLOCKS = "⛔ BLOCKS — the branch introduced this"
ADD = "ADD to the baseline, citing the base hash — it is master's, not the branch's"
REMOVE = "REMOVE from the baseline, citing the master commit responsible — never blocks"
NOT_ASSESSED = "not assessed — no branch measurement was supplied"


def classify(base: set[str] | list[str],
             baseline: set[str] | list[str],
             branch: set[str] | list[str] | None = None) -> dict:
    """Three named directions, each with its consequence. Sets of failing-test identities."""
    base, baseline = set(base), set(baseline)
    out = {
        "master_introduced": {"entries": sorted(base - baseline), "consequence": ADD},
        "master_fixed": {"entries": sorted(baseline - base), "consequence": REMOVE},
    }
    if branch is None:
        out["hub_introduced"] = {"entries": None, "consequence": NOT_ASSESSED}
    else:
        out["hub_introduced"] = {"entries": sorted(set(branch) - base), "consequence": BLOCKS}
    return out


def render(result: dict, base_sha: str = "?") -> str:
    lines = [f"=== baseline diff vs base {base_sha} ==="]
    for key in ("hub_introduced", "master_introduced", "master_fixed"):
        d = result[key]
        if d["entries"] is None:
            lines.append(f"  {key}: {d['consequence']}")
            continue
        lines.append(f"  {key} ({len(d['entries'])}) -> {d['consequence']}")
        for e in d["entries"]:
            lines.append(f"    - {e}")
    blocking = result["hub_introduced"]["entries"]
    lines.append("")
    lines.append("  VERDICT: " + (
        "⛔ BLOCKED — hub-introduced failures above" if blocking
        else "no hub-introduced failures" if blocking is not None
        else "⚠️ cannot clear the branch — no branch measurement supplied"))
    return "\n".join(lines)
