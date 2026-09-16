"""R57 — every chain step's target actually resolves, so a typo cannot become a silent no-op.

⛔⛔ THE FAILURE THIS GUARDS, and it ran in production for weeks. `chain.py`'s WEEKLY table named
`api.services.wisdom.extract:run_weekly_audit`. **No such function exists anywhere in the repo** —
the real one is `run_audit`. `chain.resolve()` returns `fn=None` for an unresolvable target and
`_run_step` records status `not_available` (chain.py:229-230), which is a SKIP, not a failure: the
chain stays green, nothing pages, and the weekly extraction audit simply never happens.

⭐ THE SHAPE IS WHY THIS IS A RAIL AND NOT A ONE-LINE FIX. `not_available` exists so a chain can
survive a module that has not been built yet — a good property. Its cost is that a MISSPELLED
target is indistinguishable from an UNBUILT one, and the repo carried the misspelling in two
artifacts at once (chain.py's table and extract/jobs.py's prose), which reads as corroboration.

⛔ An absence is only evidence if the instrument could have seen a presence — so the control below
plants an unresolvable target and proves the check reds on it.
"""
from __future__ import annotations

import importlib
import pathlib
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))


def _steps():
    from api.services.wisdom.publish import chain

    out = []
    for name, table in (("daily", chain.DAILY), ("weekly", chain.WEEKLY), ("monthly", chain.MONTHLY)):
        for step in table:
            out.append((name, step))
    return out


def _resolves(module_name: str, attr: str) -> bool:
    try:
        mod = importlib.import_module(module_name)
    except Exception:
        return False
    return callable(getattr(mod, attr, None))


#: ⛔⛔ STEPS WHOSE TARGET IS GENUINELY NOT BUILT YET — declared, not tolerated in silence.
#:
#: This rail found FOUR unresolvable weekly steps, not the one R57 was about, and they are two
#: different things wearing one status:
#:   * `extract_audit` was a MISSPELLING of a function that exists and is specified
#:     (RUNBOOK.md:108, CONTRACTS.md:251). Fixed — that is R57.
#:   * these three are UNBUILT FEATURES. `not_available` is the right status for them; that is
#:     what it is for. Deleting the steps would erase the intent, and defining them would be
#:     building three features nobody ruled.
#:
#: ⭐ So the distinction the rail enforces is: a target may be unresolvable only if it is NAMED
#: here. A new typo fails by name; a deliberate gap is a line someone had to write.
#: ⚠️ Each of these means a weekly step has NEVER run. That is a finding for the owner, recorded
#: in docs/recon/2026-09-15-session15-*.md, not a thing this rail should quietly normalise.
KNOWN_UNBUILT = {
    "weekly:reconcile_outcomes": "evals.reconcile_weekly is not implemented anywhere in the repo",
    "weekly:vocab_candidates": "core.vocab.refresh_candidates is not implemented anywhere in the repo",
    "weekly:voice_profile": "publish.adapters.refresh_voice_profile is not implemented anywhere "
                            "in the repo (the step is also gated by WISDOM_VOICE_PROFILE_ENABLED)",
}


def test_every_chain_step_target_resolves_or_is_declared_unbuilt():
    """⛔⛔ THE LOAD-BEARING ONE. A typo degrades to `not_available` and the chain stays green."""
    broken = []
    for chain_name, step in _steps():
        if not step.targets:
            continue  # an inline_note step declares no target by design
        label = f"{chain_name}:{step.name}"
        if any(_resolves(m, a) for m, a in step.targets):
            continue
        if label in KNOWN_UNBUILT:
            continue
        broken.append(f"{label} -> " + ", ".join(f"{m}:{a}" for m, a in step.targets))
    assert not broken, (
        "a chain step names a target that does not resolve and is not declared unbuilt. It will "
        "record `not_available` and SKIP SILENTLY — the chain stays green and the step never "
        "runs:\n  " + "\n  ".join(broken))


def test_the_unbuilt_list_does_not_outlive_the_gap_it_describes():
    """⭐ A declared gap that has since been built must leave the list, or the list becomes a
    place where working steps go to be ignored."""
    stale = []
    for chain_name, step in _steps():
        label = f"{chain_name}:{step.name}"
        if label in KNOWN_UNBUILT and any(_resolves(m, a) for m, a in step.targets):
            stale.append(label)
    assert not stale, f"these are implemented now and must be removed from KNOWN_UNBUILT: {stale}"


def test_the_weekly_extraction_audit_resolves_specifically():
    """The one this ruling is about, pinned by name so a rename cannot quietly undo it."""
    from api.services.wisdom.publish import chain

    step = next(s for _, s in _steps() if s.name == "extract_audit")
    assert step.targets, "the extract_audit step lost its target"
    module, attr = step.targets[0]
    assert _resolves(module, attr), f"{module}:{attr} does not resolve"
    assert attr == "run_audit", (
        "the weekly audit target changed; RUNBOOK.md:108 and CONTRACTS.md:251 specify this step, "
        "so a change here needs those updated too")


def test_the_probe_can_see_an_unresolvable_target():
    """⭐ CONTROL: without this the assertion above passes for a broken resolver."""
    assert not _resolves("api.services.wisdom.extract", "run_weekly_audit"), (
        "run_weekly_audit exists now — if it was deliberately added, this control needs a "
        "different non-existent name, not deletion")
    assert not _resolves("api.services.wisdom.does_not_exist", "anything")
    # and the positive half, so the probe is not simply always-False
    assert _resolves("api.services.wisdom.extract", "run_audit")


def test_every_step_target_module_is_inside_the_wisdom_package():
    """A chain step reaching outside the package would be a dependency nobody declared."""
    for chain_name, step in _steps():
        for module, _attr in step.targets:
            assert module.startswith("api.services.wisdom"), f"{chain_name}:{step.name} -> {module}"


def test_the_runbooks_weekly_row_names_the_function_that_exists():
    """⛔ The misspelling lived in the RUNBOOK's weekly row as well as the chain table.

    ⚰️ CODE, NEVER PROSE — and this test made that mistake on its first run. It asserted the wrong
    name was absent from the WHOLE FILE, and went red on the ⚰️ note that EXPLAINS the bug, which
    has to say `run_weekly_audit` to be intelligible. Deleting the explanation would have made it
    pass. The predicate that actually matters is the TABLE ROW: the row must name a function that
    resolves; the history beside it may name the one that never did.
    """
    row = next(l for l in (REPO / "docs" / "wisdom" / "RUNBOOK.md").read_text(encoding="utf-8")
               .splitlines() if l.startswith("| weekly |"))
    assert "run_weekly_audit" not in row, "the RUNBOOK's weekly row still names run_weekly_audit"
    assert "extract.run_audit" in row, "the weekly row lost its extraction-audit step entirely"
    # ⭐ control: the file DOES still explain the history, so the fix did not erase the record
    whole = (REPO / "docs" / "wisdom" / "RUNBOOK.md").read_text(encoding="utf-8")
    assert "run_weekly_audit" in whole, "the ⚰️ note explaining the defect was deleted"
