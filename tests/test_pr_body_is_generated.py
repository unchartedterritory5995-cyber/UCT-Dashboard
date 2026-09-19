# -*- coding: utf-8 -*-
"""R31 — `PR-BODY-COMBINED.md` is GENERATED, and it cannot drift again.

⚰️ THE INCIDENT. `PR-BODY-WAVE2.md` was updated when j.1 landed and the combined
file was never regenerated. PR #145 therefore described item (j) as *"scoped only,
11 gaps with file:line"* — pre-j.1 text — through BOTH j.1 and j.2. Nothing could
detect it: the source of truth was correct the whole time, the generated artifact
was stale, and no check compared the two. It was found by rebuilding the file and
diffing, which is exactly what this rail does on every run.

⭐ THE SHAPE, AND WHY IT IS WORTH A RAIL RATHER THAN A HABIT. This is
`two authorities over one value` in its GENERATED form — the fourth spelling of a
defect this repo has already recorded for a sentence, a job and a field name. It is
also the quietest of the four, because nothing is ever wrong: the parts are right,
the artifact is merely old, and every reader of either one sees something coherent.

⛔⛔ THIS FILE MUST NOT RESTATE THE RECIPE. The part list and their ORDER live in
`tools/build_pr_body.py` and are imported. A rail carrying its own copy of "how the
file is built" agrees with itself while the artifact drifts — which is the defect,
not a test of it. `test_the_recipe_is_imported_not_restated` pins that.
"""
from __future__ import annotations

import io
import os
import shutil

import pytest

from tools import build_pr_body as B

ROOT = B.repo_root(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_the_combined_body_is_current():
    """⛔⛔ THE LOAD-BEARING ONE. The artifact equals what its parts produce."""
    rc, msg = B.check(ROOT)
    assert rc == 0, msg


def test_non_vacuity_the_rebuild_is_real():
    """⛔ NON-VACUITY. Without this, the assertion above passes over an empty
    rebuild compared against an empty file — two nothings agreeing."""
    built = B.build(ROOT)
    assert len(built) > 10_000, 'the rebuild is implausibly small: %d bytes' % len(built)
    text = built.decode('utf-8')
    # Both waves are present. A recipe that silently dropped a part would still
    # produce a plausible document, and only a check that names both waves sees it.
    assert 'Uncharted Volume v2 renders on a member' in text, 'Wave 1 is missing from the rebuild'
    assert 'Wave 2 — the Pine grammar closes' in text, 'Wave 2 is missing from the rebuild'
    # every declared part exists on disk
    for path in B.part_paths(ROOT):
        assert os.path.isfile(path), 'declared part is missing: %s' % path


def test_the_parts_appear_in_the_declared_order():
    """⛔ ORDER IS PART OF THE RECIPE. Concatenating the right three files in the
    wrong order yields a document of exactly the right length and the right bytes,
    just arranged into something nobody would publish — a length or a hash-set check
    would not notice, and neither would a reader who only skims the top."""
    built = B.build(ROOT)
    at = -1
    for path in B.part_paths(ROOT):
        with io.open(path, 'rb') as fh:
            head = fh.read()[:60]
        found = built.find(head)
        assert found > at, '%s does not appear after the part before it' % os.path.basename(path)
        at = found


def test_a_stale_part_is_reported(tmp_path):
    """⛔ THE MUTATION, HERMETIC. Edit a part and do not regenerate ⇒ STALE.

    Runs against a COPY so the real artifact is never touched: a rail that mutates
    the tree it is verifying can leave the repo dirty when it fails, and this repo
    has paid for `git checkout --` as a restore once already.
    """
    docs = tmp_path / 'docs' / 'pine'
    docs.mkdir(parents=True)
    for name in B.PARTS + (B.COMBINED,):
        shutil.copyfile(os.path.join(ROOT, B.DOCS, name), str(docs / name))

    rc, msg = B.check(str(tmp_path))
    assert rc == 0, 'the copy should start current, else the mutation proves nothing: %s' % msg

    # the real historical shape: a part gains a sentence, the artifact is not rebuilt
    last = docs / B.PARTS[-1]
    with io.open(str(last), 'ab') as fh:
        fh.write(b'\n\nA sentence added to a part, with no regeneration.\n')

    rc, msg = B.check(str(tmp_path))
    assert rc != 0, 'a stale artifact was reported as current'
    assert 'STALE' in msg

    # …and regenerating clears it, so the rail is not simply always-red
    B.write(str(tmp_path))
    rc, msg = B.check(str(tmp_path))
    assert rc == 0, 'regeneration did not clear the staleness: %s' % msg


def test_a_missing_part_raises_rather_than_shortening_the_build(tmp_path):
    """⛔ A SKIPPED PART MUST NOT DEGRADE QUIETLY. Producing a shorter document
    that still looks like a body is the failure mode that would let this rail pass
    while publishing half a PR description."""
    docs = tmp_path / 'docs' / 'pine'
    docs.mkdir(parents=True)
    for name in B.PARTS:
        shutil.copyfile(os.path.join(ROOT, B.DOCS, name), str(docs / name))
    os.remove(str(docs / B.PARTS[1]))
    with pytest.raises(RuntimeError, match='missing part'):
        B.build(str(tmp_path))


def test_the_recipe_is_imported_not_restated():
    """⛔⛔ R31's OWN CLAUSE, MADE CHECKABLE. The recipe lives in one place.

    This module may NAME a part (the mutation above picks one), but it must not
    contain an ordered list of all of them — that would be a second copy of the
    recipe, and the two would drift exactly as the artifact did.
    """
    with io.open(os.path.abspath(__file__), 'r', encoding='utf-8') as fh:
        src = fh.read()
    body = src.split('"""', 2)[-1]  # past the module docstring
    named = [p for p in B.PARTS if p in body]
    assert len(named) < len(B.PARTS), (
        'this test file names every part (%s) — that is a second copy of the recipe. '
        'Import `build_pr_body.PARTS` instead.' % ', '.join(named)
    )


def test_the_self_check_can_fail_and_restores():
    """⛔ A GATE NOBODY HAS SEEN FAIL IS NOT A GATE — and this one edits the real
    artifact, so it must put it back. The assertion covers both halves."""
    before = B.current(ROOT)
    rc, msg = B.self_check(ROOT)
    assert rc == 0, msg
    assert B.current(ROOT) == before, 'the self-check did not restore the artifact'
