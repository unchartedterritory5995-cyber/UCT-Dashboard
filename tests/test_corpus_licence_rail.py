"""
The CI rail on the committed Pine corpus.

Owner ruling, 2026-09-09: a file under `corpus/committed/` without an MPL-2.0,
MIT or Apache-2.0 header fails the build. Legacy fixtures under
`tests/fixtures/pine*` are exempt. Full policy: docs/pine/LICENSING.md.

⛔⛔ THE HARD PART IS THAT `corpus/committed/` DOES NOT EXIST YET. The 202
commit-eligible scripts are fetched in R1. A rail written the obvious way —
"walk the directory, assert no offenders" — therefore PASSES TODAY WITHOUT
CHECKING ANYTHING, and would keep passing if the ingest later dropped files
somewhere it does not walk. That is `lesson_gate_that_cannot_fail`, and it is the
exact failure this file is shaped to avoid:

  1. The PREDICATE is proven on synthetic inputs on every run, corpus or no
     corpus. `is_permitted` is exercised against all three permitted licences and
     against every non-permitted family we know how to name.
  2. The SWEEP is not scoped to one hard-coded directory. It walks the whole
     `corpus/` tree, so a file landing in a sibling folder cannot dodge the rail
     by being somewhere the author of this test did not think of.
  3. The rail SAYS which of the two states it is in, rather than reporting a
     silent green either way.
"""

from __future__ import annotations

import os

import pytest

from tools.pine_survey.corpus_licence import (
    NONE_FOUND,
    PERMITTED,
    classify,
    detect,
    is_permitted,
    offenders_under,
)

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = os.path.join(REPO, "corpus")
COMMITTED = os.path.join(CORPUS, "committed")

MPL_HEADER = (
    "// This Source Code Form is subject to the terms of the Mozilla Public\n"
    "// License 2.0. https://mozilla.org/MPL/2.0/\n"
    "//@version=6\nindicator('x')\nplot(close)\n"
)
MIT_HEADER = "// The MIT License\n//@version=6\nindicator('x')\nplot(close)\n"
APACHE_HEADER = "// Apache License, Version 2.0\n//@version=6\nindicator('x')\nplot(close)\n"


class TestThePredicate:
    """Runs on every CI run, corpus present or not. This is the real proof."""

    @pytest.mark.parametrize(
        "src,expected",
        [(MPL_HEADER, "MPL-2.0"), (MIT_HEADER, "MIT"), (APACHE_HEADER, "Apache-2.0")],
    )
    def test_the_three_permitted_licences_are_recognised_and_permitted(self, src, expected):
        assert detect(src) == expected
        assert is_permitted(src) is True
        assert classify(src)[1] == "commit"

    @pytest.mark.parametrize(
        "header,expected",
        [
            ("// Attribution-NonCommercial-NoDerivatives 4.0 International (CC BY-NC-ND 4.0)", "CC-BY-NC-ND"),
            ("// Attribution-NonCommercial-ShareAlike 4.0 (CC BY-NC-SA)", "CC-BY-NC-SA"),
            ("// GNU General Public License v3.0", "GPL-3.0"),
            ("// GNU Affero General Public License", "AGPL-3.0"),
            ("// GNU Lesser General Public License", "LGPL"),
            ("// no licence line here at all", NONE_FOUND),
        ],
    )
    def test_everything_else_is_reference_only(self, header, expected):
        src = f"{header}\n//@version=6\nindicator('x')\nplot(close)\n"
        assert detect(src) == expected
        # ⭐ THE LOAD-BEARING ONE IS THE LAST ROW. "No licence line" is the case an
        # earlier corpus treated as MPL-2.0 by way of TradingView's Terms §22. A
        # default we infer is not a grant the author wrote.
        assert is_permitted(src) is False
        assert classify(src)[1] == "reference"

    def test_a_licence_named_far_below_the_header_is_not_a_grant(self):
        # A mention 300 lines down is a mention. Mutation check: raise
        # HEADER_LINES past 300 and this goes red.
        src = "//@version=6\n" + ("plot(close)\n" * 300) + "// The MIT License\n"
        assert detect(src) == NONE_FOUND
        assert is_permitted(src) is False

    def test_the_permitted_set_is_exactly_three(self):
        # Widening this set is an owner decision, not a refactor. If it grows,
        # this fails and whoever grew it has to say so out loud.
        assert PERMITTED == ("MPL-2.0", "MIT", "Apache-2.0")


class TestTheSweep:
    def test_no_committed_corpus_file_carries_a_non_permitted_licence(self):
        """The rail proper. Walks the WHOLE corpus/ tree, not just committed/."""
        if not os.path.isdir(CORPUS):
            # ⭐ NOT a silent pass. The corpus is fetched in R1; until then the
            # predicate tests above are what is actually protecting us, and this
            # states that rather than reporting a green that means nothing.
            pytest.skip(
                "corpus/ does not exist yet — the 202 commit-eligible scripts are "
                "fetched in R1. The predicate tests in this file still run and are "
                "what proves the gate works."
            )
        offenders = offenders_under(CORPUS)
        assert offenders == [], (
            "These files are committed under corpus/ without a permitted licence "
            "header. Each must either carry an explicit MPL-2.0 / MIT / Apache-2.0 "
            "header, or move to corpus/reference/ as metadata with its source in "
            "the gitignored cache:\n"
            + "\n".join(f"  {path}  ({lic})" for path, lic in offenders)
        )

    def test_the_sweep_walks_a_tree_and_reports_by_name(self, tmp_path):
        """⭐ THE CONTROL. Without it, the case above passes for a sweep that
        cannot see anything — which is precisely its state today."""
        root = tmp_path / "corpus"
        (root / "committed").mkdir(parents=True)
        (root / "committed" / "ok.pine").write_text(MPL_HEADER, encoding="utf-8")
        (root / "committed" / "bad.pine").write_text(
            "// GNU General Public License v3.0\n//@version=6\nplot(close)\n", encoding="utf-8"
        )
        # A file in a sibling folder the rail was never told about: it must still
        # be caught, because the sweep walks the tree rather than one directory.
        (root / "somewhere_else").mkdir()
        (root / "somewhere_else" / "sneaky.pine").write_text(
            "//@version=6\nplot(close)\n", encoding="utf-8"
        )

        found = offenders_under(str(root))
        assert found == [
            ("committed/bad.pine", "GPL-3.0"),
            ("somewhere_else/sneaky.pine", NONE_FOUND),
        ]

    def test_legacy_fixtures_are_exempt_and_stay_where_they_are(self):
        """The ruling exempts tests/fixtures/pine* — assert the rail does not
        reach them, so nobody 'helpfully' widens it and deletes the screener
        regression suite (126 of 137 of those files would fail this gate)."""
        legacy = os.path.join(REPO, "tests", "fixtures", "pine")
        assert os.path.isdir(legacy), "the legacy fixture corpus should still exist"
        # The sweep is rooted at corpus/ and cannot reach tests/fixtures/.
        assert not os.path.abspath(legacy).startswith(os.path.abspath(CORPUS) + os.sep)
