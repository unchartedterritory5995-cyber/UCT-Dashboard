"""The dark-check instrument keeps working — a broken derivation must not read as "all clear".

⛔ The whole hazard here is silence. If the AST walk or `registry.routers()` stops returning
anything, the instrument reports nothing to check — which looks exactly like a clean system. That
is why every assertion below is a NON-VACUITY check first and a correctness check second.
"""
from __future__ import annotations

import pathlib
import subprocess
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "wisdom_dark_check.py"
sys.path.insert(0, str(REPO / "scripts"))

import wisdom_dark_check as dark  # noqa: E402


def test_the_self_check_passes_and_exits_zero():
    """⛔ A gate nobody has seen fire is not a gate."""
    r = subprocess.run([sys.executable, str(SCRIPT), "--self-check"], capture_output=True, text=True)
    assert r.returncode == dark.PASS, r.stdout + r.stderr
    assert "self-check: PASS" in r.stdout
    assert r.stdout.count("[ok  ]") >= 10, "the self-check must actually run its checks"
    assert "[FAIL]" not in r.stdout


def test_a_dry_run_is_INCONCLUSIVE_never_a_pass():
    """⛔ Measuring nothing must never read as measuring darkness."""
    r = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True)
    assert r.returncode == dark.INCONCLUSIVE, r.stdout + r.stderr
    assert "DRY RUN" in r.stdout
    assert "nothing was measured" in r.stdout


def test_the_three_exit_codes_are_distinct():
    assert len({dark.PASS, dark.LIT, dark.INCONCLUSIVE}) == 3


def test_the_env_walk_finds_reads_and_does_not_invent_them():
    read = dark.env_names_read()
    assert len(read) >= 20, f"non-vacuity: the AST walk found only {len(read)}"
    assert "WISDOM_CAPTURE_ENABLED" in read
    assert "WISDOM_WEEKLY_REPORT_ENABLED" in read
    assert not any("DEFINITELY_NOT" in n for n in read)


def test_the_walk_sees_a_switch_whose_name_does_not_start_with_WISDOM():
    """⛔⛔ THE REGRESSION THAT MATTERS.

    The first version of this instrument matched `^WISDOM_[A-Z0-9_]+$` string literals, so it
    could not see `ASKAI_WISDOM_RETRIEVAL_ENABLED` — the Ask-AI kill switch, which is
    MEMBER-FACING. It would have reported "0 switches set, dark" while a member-facing lane was
    lit. A name-prefix scan is not a measurement of what the code reads.
    """
    read = dark.env_names_read()
    assert "ASKAI_WISDOM_RETRIEVAL_ENABLED" in read
    assert "ASKAI_WISDOM_RETRIEVAL_ENABLED" in dark.switches_read()
    assert "ASKAI_WISDOM_RETRIEVAL_ENABLED" in {n for n, _ in dark.declared_gates()}


def test_the_walk_does_not_report_identifiers_or_docstrings_as_env_vars():
    """⚰️ A grep over the same tree returned four switches that do not exist: WISDOM_CAP (a
    Python constant = 50), WISDOM_PKG_DIR and WISDOM_IMPORT_PREFIX (module constants), and
    WISDOM_PRIVATE_KEYS_V1 (a name appearing only inside a docstring)."""
    read = dark.env_names_read()
    for ghost in ("WISDOM_CAP", "WISDOM_PKG_DIR", "WISDOM_IMPORT_PREFIX", "WISDOM_PRIVATE_KEYS_V1"):
        assert ghost not in read, f"{ghost} is not an environment variable"


def test_configuration_is_not_counted_as_a_switch():
    read = dark.env_names_read()
    sw = dark.switches_read()
    assert "WISDOM_DB_PATH" in read and "WISDOM_DB_PATH" not in sw
    assert "WISDOM_EXTRACT_BUDGET_USD" in read and "WISDOM_EXTRACT_BUDGET_USD" not in sw
    assert "WISDOM_CAPTURE_ENABLED" in sw
    assert 0 < len(sw) < len(read), "control: the filter must exclude some but not all"


def test_the_gate_registry_is_the_authority_and_carries_member_visibility():
    gates = dark.declared_gates()
    assert len(gates) >= 20, f"non-vacuity: flags.GATES yielded {len(gates)}"
    member = [n for n, mv in gates if mv]
    assert 0 < len(member) < len(gates), "control: some gates are member-visible and some are not"
    assert "WISDOM_CAPTURE_ENABLED" in {n for n, mv in gates if not mv}
    assert "WISDOM_BRAINKB_PUBLISH_ENABLED" in set(member)


def test_no_switch_is_read_outside_the_gate_registry():
    """⛔ A gate added straight to os.environ.get would be invisible to this instrument AND to
    the ledger rail at the same time — one omission, two blind systems."""
    off = dark.off_registry_switches()
    assert not off, f"switch-shaped env vars read by Wisdom code but absent from flags.GATES: {sorted(off)}"


def test_the_route_walk_finds_routes_and_every_one_is_guarded():
    dark._pin_data_root()
    routes = dark.wisdom_get_routes()
    assert len(routes) >= 20, f"non-vacuity: the registry yielded only {len(routes)} GET routes"
    unguarded = [r["path"] for r in routes if dark.classify(r) == "UNGUARDED"]
    assert not unguarded, f"Wisdom GET routes with no declared guard: {unguarded}"


@pytest.mark.parametrize("guards,expected", [
    ([], "UNGUARDED"),
    (["require_admin"], "admin"),
    (["require_owner"], "owner"),
    (["require_push_secret"], "internal"),
    (["get_current_user"], "authed"),
    (["require_push_secret", "require_admin"], "internal"),
])
def test_classify(guards, expected):
    assert dark.classify({"path": "/x", "guards": guards}) == expected


def test_it_prints_utf8_on_a_cp1252_console():
    """⚰️ The first ⛔ in a print once crashed this with UnicodeEncodeError and exited 1 (LIT) —
    an instrument reporting a measured failure it had never measured."""
    import os
    env = dict(os.environ, PYTHONIOENCODING="cp1252")
    r = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True, env=env)
    assert r.returncode == dark.INCONCLUSIVE, r.stdout + r.stderr
    assert "UnicodeEncodeError" not in r.stderr
