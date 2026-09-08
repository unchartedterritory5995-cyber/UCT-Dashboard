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
import types
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


def test_an_aliased_os_import_is_still_caught(tmp_path):
    """Control: `import os as X` must not hide a gate from the scan.

    Feature-Flag Governance Sweep, 2026-09-06: `_env_name` matched `os.getenv`
    by checking the base name literally equalled `"os"`, so
    `api/services/journal_two/broker/fidelity_audit.py:227`'s local
    `import os as _os; _os.getenv("BROKER_BALANCE_HISTORY_ENABLED")` was
    invisible to the scan even though it is armed in production with no
    ledger entry — exactly the ambiguous, undecided-looking state this rail
    exists to surface. `os.environ.get`/`os.environ[...]` were never affected
    (they match on the `.environ` ATTRIBUTE name, not the base object), so
    this control is scoped to the one form that was actually blind.
    """
    (tmp_path / "m.py").write_text(
        "import os as _os\n"
        "X = _os.getenv('ALIASED_THING_ENABLED', '0')\n"
        "Y = (_os.getenv('ALIASED_FALLBACK_ENABLED') or '1') == '1'\n",
        encoding="utf-8",
    )
    found = ffi.gates([tmp_path], tmp_path)
    assert found["ALIASED_THING_ENABLED"]["default"] == "0"
    assert found["ALIASED_FALLBACK_ENABLED"]["default"] == "1"
    assert ffi.needs_declaration("ALIASED_THING_ENABLED", "0") is True


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


def test_no_flag_is_declared_twice():
    """Two sessions declaring the same gate merge CLEANLY into duplicate keys.

    2026-09-02: two branches each declared BARS_API_ENABLED and
    BARS_PROXY_ENABLED after they arrived undeclared through a master merge.
    The insertions landed in different hunks, so git merged without a
    conflict, and `json.load` silently keeps the LAST of a duplicated key --
    so one branch's researched note became text that no parser would ever
    read, while a human scrolling the file saw both and could not tell which
    one was live. Every other test in this file parses the JSON first, which
    is exactly the step that hides this.
    """
    import json as _json
    from collections import Counter

    found: list[str] = []

    def check_pairs(pairs):
        # Per-OBJECT, not global: `object_pairs_hook` fires for every object in
        # the document, so counting across all of them just reports `status`,
        # `note` and `where` once per flag. A duplicate key means ONE object
        # holds the same key twice -- which is the only case JSON resolves by
        # silently dropping an entry.
        counts = Counter(k for k, _ in pairs)
        found.extend(k for k, n in counts.items() if n > 1)
        return dict(pairs)

    _json.loads(LEDGER_PATH.read_text(encoding="utf-8"), object_pairs_hook=check_pairs)
    dupes = sorted(set(found))
    assert not dupes, (
        "declared more than once in docs/feature_flags.json:\n"
        + "\n".join(f"  {k}" for k in dupes)
        + "\n\nJSON keeps the LAST one, so the earlier entry is invisible to "
          "every reader except a human. Merge them into one entry."
    )


# ---------------------------------------------------------------------------
# ⚰️ THE AUDITOR'S OWN ROSTER DRIFTED, AND IT MANUFACTURED THE FICTION IT EXISTS
# TO CATCH.
#
# `tools/flag_ledger_audit.py` compared the ledger against a HARDCODED
# `SERVICES = ("web", "worker", "flow-worker")` while the project had five.
# `BARS_API_ENABLED=1` was live on `bars-api` the whole time, and the audit
# reported it under "still awaiting a decision" — so the ledger was told to
# decide something that was already decided and running.
#
# ⛔ The other direction is the dangerous one: a flag armed ONLY on an unlisted
# service lands in `claims_armed_but_unset`, whose headline reads "the entry is
# fiction". Acting on that would mean UNSETTING a live gate on the strength of a
# service nobody looked at.
#
# This rail is OFFLINE — it reads the tool's source, never Railway — so it keeps
# the suite deterministic while still failing if the roster is retyped.
# ---------------------------------------------------------------------------

def _audit_source() -> str:
    return (REPO / "tools" / "flag_ledger_audit.py").read_text(encoding="utf-8")


def test_the_audit_derives_its_service_roster_and_does_not_type_one():
    """⭐ The roster must come FROM the project, so a sixth service is covered the
    day it is created rather than the day someone remembers this file."""
    import ast

    src = _audit_source()
    tree = ast.parse(src)

    # ⛔ NON-VACUITY: the module really does parse and really does name the
    # deriving function, so the absence check below cannot pass over an empty read.
    fns = {n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
    assert "_services" in fns, (
        "flag_ledger_audit no longer defines _services(); if the roster moved, "
        "move this rail with it rather than deleting it")

    # A module-level assignment whose value is a literal collection of service
    # names is the shape that broke. Find any, and fail BY NAME.
    typed = []
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if not isinstance(target, ast.Name):
                continue
            if isinstance(node.value, (ast.Tuple, ast.List, ast.Set)):
                strs = [e.value for e in node.value.elts
                        if isinstance(e, ast.Constant) and isinstance(e.value, str)]
                if any(s in {"web", "worker", "flow-worker", "bars-api",
                             "chart-renderer"} for s in strs):
                    typed.append(f"{target.id} = {strs}")
    assert typed == [], (
        "the audit's service roster is hardcoded again:\n  " + "\n  ".join(typed)
        + "\nDerive it from the project — a partial roster is not a smaller audit, "
          "it is a confidently wrong one.")


def _load_audit_module():
    """Import the tool by path — it lives in tools/, which is not a package."""
    import importlib.util

    path = REPO / "tools" / "flag_ledger_audit.py"
    spec = importlib.util.spec_from_file_location("_fla_under_test", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _stub_cli(monkeypatch, mod, stdout):
    """Make the module think a railway CLI exists and returns `stdout`.

    ⛔ OFFLINE. Nothing here reaches Railway; the point is to drive the failure
    branches, which a live read can never be relied upon to produce.
    """
    monkeypatch.setattr(mod.shutil, "which", lambda _n: "railway")
    monkeypatch.setattr(
        mod.subprocess, "run",
        lambda *a, **k: types.SimpleNamespace(stdout=stdout, stderr="", returncode=0))


def test_services_returns_the_roster_the_project_reports():
    """⛔ NON-VACUITY, and it comes FIRST. Without a case proving _services() can
    SUCCEED, the two refusal tests below would be satisfied by a function that
    raised unconditionally."""
    import pytest as _pytest

    mod = _load_audit_module()
    monkeypatch = _pytest.MonkeyPatch()
    try:
        _stub_cli(monkeypatch, mod, json.dumps(
            {"services": {"edges": [{"node": {"name": "web"}},
                                    {"node": {"name": "bars-api"}}]}}))
        assert mod._services() == ("bars-api", "web")
    finally:
        monkeypatch.undo()


@pytest.mark.parametrize("stdout,why", [
    ('{"services": {"edges": []}}', "an empty roster"),
    ('{"services": {}}', "a response missing the edges"),
    ("not json at all", "unparseable output"),
    ("", "no output"),
])
def test_services_refuses_rather_than_auditing_a_partial_roster(stdout, why):
    """⭐⭐ REFUSING IS THE POINT, and it is EXECUTED rather than grepped for.

    An earlier version of this rail counted the string `RailwayUnavailable` in the
    source and required two. Deleting the empty-roster guard left the other two
    raises in place, so the count still passed — a rail green over the exact defect
    it named. This drives the branches instead.

    A shrunken roster is not a smaller audit: a flag armed only on an unlisted
    service reads as `claims_armed_but_unset`, whose headline calls a TRUE entry
    fiction, and acting on that would unset a live gate.
    """
    mod = _load_audit_module()
    monkeypatch = pytest.MonkeyPatch()
    try:
        _stub_cli(monkeypatch, mod, stdout)
        with pytest.raises(mod.RailwayUnavailable):
            mod._services()
    finally:
        monkeypatch.undo()
