"""⛔⛔ THE MERGE GUARD FOR TWO SESSIONS ON ONE PRODUCT.

`tools/nb_foreign_commits.py` is run before every Notebook merge. This is the
rail that keeps it honest, because a guard nobody has seen fire is not a guard
(`lesson_gate_that_cannot_fail`).

⭐ EACH OF THE THREE OUTCOMES IS DRIVEN. The dangerous one is exit 2 — a foreign
commit in the save path — because that is the outcome that never happens on a
quiet week and is therefore the one most likely to have quietly stopped working
by the time it matters.
"""
from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
TOOL = REPO / "tools" / "nb_foreign_commits.py"


def _mod():
    spec = importlib.util.spec_from_file_location("nb_foreign", TOOL)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_the_tool_exists_and_imports():
    assert TOOL.exists(), "the merge guard is missing"
    assert _mod() is not None


def test_no_foreign_commits_lets_the_merge_through():
    assert _mod().verdict({"foreign": [], "save_path": []}) == 0


def test_a_foreign_commit_outside_the_save_path_asks_for_rails_and_shas():
    v = _mod().verdict({"foreign": [{"sha": "abc", "save_path_files": []}], "save_path": []})
    assert v == 1, "exit 1 means: re-run the affected rails, record the SHAs, then merge"


def test_a_foreign_commit_IN_the_save_path_STOPS_the_merge():
    # ⛔ The outcome that matters. A second writer to the durable copy, the
    # drain, the settle, the body door or the shared note PUT is not something
    # to notice afterwards.
    v = _mod().verdict({
        "foreign": [{"sha": "def", "save_path_files": ["app/src/pages/journal-2-0/lib/offline/outboxDrain.js"]}],
        "save_path": [{"sha": "def"}],
    })
    assert v == 2, "a save-path commit must STOP the merge, not merely warn"


def test_the_save_path_names_the_files_wave_q1_exists_to_protect():
    m = _mod()
    # ⛔ Named, not guessed — and each one must sit inside the tree the guard
    # scans, or the stop can never fire for the file it names.
    for p in ("lib/offline/", "NoteEditorPage.jsx", "hooks/useJ2Notes.js"):
        assert any(p in s for s in m.SAVE_PATH), f"{p} is part of the save path and is not protected"
    for s in m.SAVE_PATH:
        assert any(s.startswith(n) for n in m.NOTEBOOK_PATHS), f"{s} is outside the scanned tree"


def test_the_scanned_tree_covers_the_server_half_too():
    m = _mod()
    assert any("api/services/journal_two" in p for p in m.NOTEBOOK_PATHS), (
        "the seven advancing functions live server-side; a foreign commit there is "
        "as much a second writer as one in the client")


@pytest.mark.parametrize("args,expected", [(["--self-check"], 0)])
def test_the_tools_own_self_check_passes(args, expected):
    r = subprocess.run([sys.executable, str(TOOL), *args], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", cwd=str(REPO))
    assert "self-check: PASS" in r.stdout, r.stdout[-2000:]
    assert r.returncode == expected


def test_it_refuses_to_guess_what_since_means():
    # ⛔ A guard that defaults its own window would silently scan the wrong range
    # and report a comfortable zero.
    r = subprocess.run([sys.executable, str(TOOL)], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", cwd=str(REPO))
    assert r.returncode == 3
    assert "--since" in r.stdout
