"""The rail on `tools/flow_read_gate.py`'s manifest.

⚰️ WHAT THIS EXISTS TO PREVENT. On 2026-11-08 `test_cream_meta_key` was found red against
production code, 54 days after the commit that made it stale. The gate now names the files
it runs -- but a NAMED LIST GOES STALE THE SAME WAY the assertion did. A test that lands
next month importing `live_massive_router` and sitting in no batch is in exactly the
position `test_flow_classification.py` was in: real, green-looking, and run by nothing.

So this fails BY NAME on any test file that reaches a read-path module and appears in
neither BATCHES, BLOCKED, nor EXCLUDED. Add it to a batch and this goes quiet; leave it out
and it names the orphan. EXCLUDED is the escape hatch and it COSTS A SENTENCE -- a reason
string is mandatory, so "not a flow-read assertion" is a judgment somebody recorded rather
than a silent omission.

⛔ THE PREDICATE IS DELIBERATELY OVER-INCLUSIVE. It is a text match on the module names, not
an AST import walk, so a file that merely mentions `massive_processor` in a comment is
caught too and has to be classified. That direction is the safe one: a false positive costs
one line in EXCLUDED, a false negative costs another 54 days. Six of the current EXCLUDED
entries are exactly this case and say so.
"""
from __future__ import annotations

import io
import os

import pytest

from tools import flow_read_gate as gate

REPO = gate.REPO
SEARCH_ROOTS = ("tests", "api")
_SKIP_DIR_PARTS = frozenset({"__pycache__", "node_modules", ".git", "external", "corpus"})


def _is_test_file(name: str) -> bool:
    return (name.startswith("test_") and name.endswith(".py")) or name.endswith("_test.py")


def _read_path_test_files() -> list[str]:
    """Every test file under the search roots that reaches a read-path module."""
    found = []
    for root in SEARCH_ROOTS:
        base = os.path.join(REPO, root)
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if d not in _SKIP_DIR_PARTS]
            for fn in filenames:
                if not _is_test_file(fn):
                    continue
                full = os.path.join(dirpath, fn)
                try:
                    src = io.open(full, encoding="utf-8", errors="replace").read()
                except OSError:
                    continue
                if any(m in src for m in gate.READ_PATH_MODULES):
                    found.append(os.path.relpath(full, REPO).replace("\\", "/"))
    return sorted(found)


def _classified() -> dict[str, str]:
    out = {f: "batch" for f in gate.manifest_files()}
    out.update({f: "blocked" for f in gate.BLOCKED})
    out.update({f: "excluded" for f in gate.EXCLUDED})
    return out


# ── the controls: a sweep that finds nothing passes every assertion below ────────
# A rail that can answer "no" to everything is not a rail, which is the same lesson
# the parity audit's --self-check encodes.

def test_the_sweep_actually_reads_the_repo():
    files = _read_path_test_files()
    assert len(files) >= 40, (
        "the read-path sweep found only %d files; it found 49 on 2026-11-08, so a drop "
        "this large means the WALK broke, not that the tests went away" % len(files))
    assert "tests/test_flow_classification.py" in files, (
        "the sweep must find the very file whose 54-day-stale assertion prompted this gate")


def test_the_module_list_is_not_empty():
    assert gate.READ_PATH_MODULES, "an empty module list makes every assertion here vacuous"
    for mod in gate.READ_PATH_MODULES:
        assert os.path.exists(os.path.join(REPO, "api", mod + ".py")), (
            "READ_PATH_MODULES names api/%s.py, which is not on disk -- either the module "
            "moved (update this list) or the name is a typo that silences the sweep" % mod)


# ── the rail ────────────────────────────────────────────────────────────────────

def test_every_read_path_test_file_is_classified():
    classified = _classified()
    orphans = [f for f in _read_path_test_files() if f not in classified]
    assert orphans == [], (
        "these test files reach a flow read-path module and NOTHING RUNS THEM:\n  "
        + "\n  ".join(orphans)
        + "\n\nPut each one in a batch in tools/flow_read_gate.py, or in EXCLUDED with a "
          "reason. This is the position test_cream_meta_key was in for 54 days.")


def test_every_excluded_file_carries_a_reason():
    for f, why in gate.EXCLUDED.items():
        assert why and len(why.strip()) >= 12, (
            "EXCLUDED[%r] has no real reason string. The sentence is the whole point: it "
            "is what makes an omission a decision." % f)


def test_every_blocked_file_carries_a_reason():
    for f, why in gate.BLOCKED.items():
        assert why and len(why.strip()) >= 12, "BLOCKED[%r] needs a reason" % f


def test_manifest_batches_are_disjoint_and_present():
    seen: dict[str, str] = {}
    for key, _why, files in gate.BATCHES:
        for f in files:
            assert f not in seen, (
                "%s is in both the %s and %s batches -- it would run twice and a failure "
                "would be reported against the wrong surface" % (f, seen[f], key))
            seen[f] = key
            assert os.path.exists(os.path.join(REPO, f)), (
                "the manifest names %s, which is not on disk. pytest would collect nothing "
                "for it and still exit 0 on the rest, so this must fail here." % f)


def test_no_file_is_both_run_and_waived():
    runs = set(gate.manifest_files())
    for bucket, name in ((gate.BLOCKED, "BLOCKED"), (gate.EXCLUDED, "EXCLUDED")):
        overlap = runs & set(bucket)
        assert overlap == set(), (
            "%s and the batches disagree about %s -- one says run it, the other says do "
            "not, and whichever is read last wins" % (name, sorted(overlap)))


@pytest.mark.parametrize("surface", ["discord_push", "live_massive", "page_product"])
def test_each_of_the_three_surfaces_has_a_batch(surface):
    """The three surfaces a wrong read reaches: Discord, Live Massive, the OptionsFlow page.

    Named individually because the shared-module structure is the actual hazard: a wrong
    prior in `live_massive_router` or `flowCompute` is wrong on all three at once, so a
    gate that silently lost one surface's batch would still look like a gate.
    """
    keys = {k for k, _w, _f in gate.BATCHES}
    assert surface in keys, "the %s batch is gone from the manifest" % surface
    files = next(f for k, _w, f in gate.BATCHES if k == surface)
    assert len(files) >= 3, "the %s batch is down to %d files" % (surface, len(files))
