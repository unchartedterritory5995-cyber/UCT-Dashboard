"""⛔⛔ THE FIFTH FORM — a TABLE of gates, read through a loop variable.

`tests/test_feature_flag_ledger.py` controls the four idioms this repo reads env
vars with. Wave K added a fifth, and it was invisible:

    NOTEBOOK_FLAGS = {"NOTEBOOK_OFFLINE_DEFAULT_ON": True, ...}
    for env_name, default_on in NOTEBOOK_FLAGS.items():
        raw = os.environ.get(env_name)          # ← not a string constant

⚰️ **Four gates shipped past the index on 2026-09-12 and every flag rail stayed
green** — 140 passing tests over a ledger that was four gates short. That is the
exact defect the ledger exists to prevent, committed one level up: the artifact
that reports coverage cannot see the thing it is reporting on.

⭐ The table form is not an accident to be discouraged — it is what makes the env
name and the payload key impossible to drift apart (`_notebook_flag_key`). The
index learned to read it instead.
"""
from __future__ import annotations

import pathlib

import pytest

from api.services import feature_flag_index as ffi

REPO = pathlib.Path(__file__).resolve().parents[1]


def test_a_gate_table_is_derived_with_its_defaults(tmp_path):
    (tmp_path / "m.py").write_text(
        "import os\n"
        "THING_FLAGS = {\n"
        "    'TABLE_KILL_SWITCH_ON': True,\n"
        "    'TABLE_GATE_ENABLED': False,\n"
        "}\n"
        "def read():\n"
        "    return {k: os.environ.get(k, d) for k, d in THING_FLAGS.items()}\n",
        encoding="utf-8",
    )
    found = ffi.gates([tmp_path], tmp_path)
    assert set(found) == {"TABLE_KILL_SWITCH_ON", "TABLE_GATE_ENABLED"}
    # ⭐ The default comes from the TABLE'S OWN VALUE — better evidence than a
    # second argument, because it is the literal a reader audits.
    assert found["TABLE_KILL_SWITCH_ON"]["default"] is True
    assert found["TABLE_GATE_ENABLED"]["default"] is False
    assert ffi.needs_declaration("TABLE_KILL_SWITCH_ON", True) is False, (
        "a kill switch defaulting ON is self-evidently a live decision")
    assert ffi.needs_declaration("TABLE_GATE_ENABLED", False) is True, (
        "an enablement gate defaulting OFF is the ambiguous class the ledger is for")


def test_the_scan_would_MISS_it_without_the_table_form(tmp_path):
    """⭐ THE CONTROL THAT MAKES THIS RAIL MEAN SOMETHING.

    A loop-variable read is invisible to every other form the index knows, so
    without the table pass the module below yields NOTHING. If this ever starts
    finding the names by some other route, the rail above stops proving what it
    claims to.
    """
    (tmp_path / "m.py").write_text(
        "import os\n"
        "NAMES = ['LOOSE_GATE_ENABLED']\n"
        "def read():\n"
        "    return [os.environ.get(n) for n in NAMES]\n",
        encoding="utf-8",
    )
    assert ffi.gates([tmp_path], tmp_path) == {}, (
        "a bare loop-variable env read is still invisible — the table form is "
        "deliberately narrow, and this is the boundary")


@pytest.mark.parametrize("expect_declared,name", [
    (False, "NOTEBOOK_OFFLINE_DEFAULT_ON"),
    (True, "NOTEBOOK_OFFLINE_READ_ON"),
    (True, "NOTEBOOK_CONFLICT_UX_ON"),
    (True, "NOTEBOOK_ATTACHMENTS_ON"),
])
def test_waveKs_four_capabilities_are_visible_to_the_index(expect_declared, name):
    """The real thing, on the real repo — not a fixture."""
    found = ffi.gates(ffi.repo_roots(REPO), REPO)
    assert name in found, f"{name} is invisible to the flag index again"
    assert found[name]["sites"] == ["api/routers/auth.py"]
    assert ffi.needs_declaration(name, found[name]["default"]) is expect_declared


def test_the_table_form_does_not_drag_in_a_non_gate_dict(tmp_path):
    """A `*_FLAGS` table whose keys are not gate-shaped is NOT a gate table.

    ⛔ `is_gate` is the definition of a gate, and it stays the definition here:
    widening one without the other is how a rail starts reporting names nobody
    can act on, which is how a rail gets muted.
    """
    (tmp_path / "m.py").write_text(
        "CONFIG_FLAGS = {'RETRIES': 3, 'TIMEOUT_SECONDS': 30}\n"
        "MIXED_FLAGS = {'REAL_GATE_ENABLED': False, 'TIMEOUT_SECONDS': 30}\n",
        encoding="utf-8",
    )
    found = ffi.gates([tmp_path], tmp_path)
    assert found == {}, (
        "a table is only a gate table when EVERY key is gate-shaped — a mixed "
        "dict is a settings blob and recording half of it would be a guess")
