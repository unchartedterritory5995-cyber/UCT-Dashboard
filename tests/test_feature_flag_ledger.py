"""A gate that ships off and is set nowhere must SAY it meant to.

Measured 2026-08-30: 198 feature gates across api/, scripts/ and tools/, of
which twelve default off and are set on no Railway service. Some of those are
deliberate — `PATTERN_VISION_ENABLED=0` retired the patterns engine after it
measured 15.7% precision, which was a decision worth keeping. Others were simply
built, tested, merged and forgotten. **Nothing in the repo could tell the two
apart**, which is this codebase's most expensive recurring shape: a state nobody
can distinguish from failure (`lesson_built_tested_green_and_unreachable`).

This rail does not decide anything. It makes the decision VISIBLE: every gate
that is off-unless-set must carry an entry in docs/feature_flags.json saying
armed, dark (with a reason) or pending (with a reason and a date). A new gate
merged without one fails here, BY NAME.

⛔ The gate list is DERIVED from the source by AST every run, never typed here —
a hand-maintained roster is the artifact that goes stale first, and a rail whose
subject list is stale is worse than none because it reads as coverage
(`lesson_probe_names_must_be_derived_not_typed`).

⛔ WHAT THIS CANNOT DO: it has no network, so it cannot know what Railway
actually has set. It enforces that a decision is WRITTEN, not that the written
decision is true. `tools/flag_ledger_audit.py` is the half that compares the
ledger to reality; keep them separate so the suite stays offline and
deterministic.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services import feature_flag_index as ffi

REPO = Path(__file__).resolve().parents[1]
LEDGER_PATH = REPO / "docs" / "feature_flags.json"

VALID_STATUS = {"armed", "dark", "pending"}
NEEDS_REASON = {"dark", "pending"}


def _ledger() -> dict:
    return json.loads(LEDGER_PATH.read_text(encoding="utf-8"))["flags"]


def _gates_needing_declaration() -> dict:
    g = ffi.gates(ffi.repo_roots(REPO), REPO)
    return {k: v for k, v in g.items() if ffi.needs_declaration(k, v["default"])}


def test_every_off_by_default_gate_is_declared():
    """A new dark gate cannot merge unnoticed."""
    declared = set(_ledger())
    needed = _gates_needing_declaration()
    missing = sorted(set(needed) - declared)
    assert not missing, (
        "These feature gates are OFF unless something sets them, and nothing in "
        "docs/feature_flags.json says whether that is deliberate:\n"
        + "\n".join(f"  {k}  (default={needed[k]['default']!r}, {needed[k]['sites'][0]})"
                    for k in missing)
        + "\n\nAdd an entry: armed / dark (with a reason) / pending (reason + since)."
    )


def test_the_ledger_does_not_describe_gates_that_no_longer_exist():
    """A retired gate's entry must go too, or the ledger rots into fiction."""
    needed = set(_gates_needing_declaration())
    stale = sorted(set(_ledger()) - needed)
    assert not stale, (
        "docs/feature_flags.json declares gates the code no longer reads as "
        "off-by-default. Delete them, or the ledger describes a repo that does "
        "not exist:\n" + "\n".join(f"  {k}" for k in stale)
    )


@pytest.mark.parametrize("name", sorted(_ledger()))
def test_each_entry_states_a_real_decision(name):
    e = _ledger()[name]
    status = e.get("status")
    assert status in VALID_STATUS, f"{name}: status {status!r} not in {sorted(VALID_STATUS)}"
    if status in NEEDS_REASON:
        note = (e.get("note") or "").strip()
        assert len(note) >= 20, (
            f"{name}: status {status!r} needs a note saying WHY. A bare status is "
            f"the ambiguity this ledger exists to remove."
        )
    if status == "pending":
        assert e.get("since"), (
            f"{name}: pending needs `since`, so a decision left unmade for months "
            f"is visible as such rather than looking freshly raised."
        )


def test_the_derivation_reads_every_form_the_codebase_actually_uses(tmp_path):
    """Control: the four idioms this repo reads env vars with are all caught.

    Without this, a scan that silently missed `os.environ["X"]` or the
    `(os.getenv("X") or "1")` fallback would under-report gates and the rail
    above would pass vacuously. Both misses were real: the subscript form made
    an early pass call four live vars unreferenced, and the fallback form made
    three broker gates look off-by-default when they ship ON.
    """
    (tmp_path / "m.py").write_text(
        "import os\n"
        "A = os.getenv('ALPHA_ENABLED', '0')\n"
        "B = os.environ.get('BETA_ENABLED', '1')\n"
        "C = os.environ['GAMMA_ENABLED']\n"
        "D = (os.getenv('DELTA_ENABLED') or '1') == '1'\n",
        encoding="utf-8",
    )
    found = ffi.gates([tmp_path], tmp_path)
    assert set(found) == {"ALPHA_ENABLED", "BETA_ENABLED", "GAMMA_ENABLED", "DELTA_ENABLED"}
    assert found["ALPHA_ENABLED"]["default"] == "0"
    assert found["BETA_ENABLED"]["default"] == "1"
    assert found["DELTA_ENABLED"]["default"] == "1", "the `or` fallback IS the default"
    # And the off/on split those defaults drive:
    assert ffi.needs_declaration("ALPHA_ENABLED", "0") is True
    assert ffi.needs_declaration("BETA_ENABLED", "1") is False
    assert ffi.needs_declaration("DELTA_ENABLED", "1") is False


def test_an_undeclared_gate_is_actually_caught(tmp_path, monkeypatch):
    """Control: the rail FAILS when a dark gate has no entry.

    A guard nobody has seen fire is not a guard (`lesson_gate_that_cannot_fail`).
    """
    (tmp_path / "m.py").write_text(
        "import os\nX = os.getenv('BRAND_NEW_THING_ENABLED', '0')\n", encoding="utf-8")
    monkeypatch.setattr(ffi, "repo_roots", lambda repo: [tmp_path])
    needed = _gates_needing_declaration()
    assert "BRAND_NEW_THING_ENABLED" in needed
    assert "BRAND_NEW_THING_ENABLED" not in _ledger(), (
        "the control flag must be absent from the real ledger for this to prove anything")


def test_inverted_disable_gates_are_not_dragged_in():
    """`*_DISABLED` unset means the feature is ON — those need no justification."""
    assert ffi.needs_declaration("TICKER_NAMES_PREWARM_DISABLED", None) is False
    assert ffi.needs_declaration("MASSIVE_OI_FALLBACK_DISABLED", "0") is False
    # …but explicitly disabling one IS a decision worth writing down.
    assert ffi.needs_declaration("SOMETHING_DISABLED", "1") is True
