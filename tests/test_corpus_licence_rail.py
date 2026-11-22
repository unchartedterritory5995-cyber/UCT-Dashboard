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

import json
import os
import sys

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


# ═══ THE SECOND DOOR: Pine source EMBEDDED in committed fixtures (2026-11-15) ═══════════════
#
# ⚰️ The sweep above walks `corpus/` and nothing else, and that is how a script with NO licence
# line reached git anyway: inside the `source.text` of a vendor capture
# (`tests/fixtures/vendor/harness/supertrend-kivancozbilgic-rddt-1d-2026-10-02.json`, admitted in
# `cce0701fe` by its sha matching a local-only OOS record, with no licence check), and as 22 `.pine`
# copies of licence-held OOS members in `tools/c0_*_fixtures` (`e855f62cd`). Both are gone; their
# verdicts are kept per LICENSING.md §2c and the files live in the local capture store
# (`docs/pine/vendor-harness/licence-held.json`). The scope, the allowances and why the in-house
# list is hashes and not directories: `tools/pine_survey/fixture_licence.py`.

from tools.pine_survey import fixture_licence as fl  # noqa: E402

HELD_REGISTRY = os.path.join(REPO, "docs", "pine", "vendor-harness", "licence-held.json")


class TestEmbeddedSources:
    def test_no_committed_fixture_embeds_a_non_permitted_source(self):
        """The rail proper: every committed capture, everything under tests/fixtures/vendor/, every
        .pine under tools/. Fails BY NAME: file, JSON path, the licence found, the sha."""
        counts, offenders = fl.sweep(REPO)
        assert offenders == [], (
            "These committed fixtures embed a Pine source that is not permitted "
            "(docs/pine/LICENSING.md section 1: an explicit MPL-2.0 / MIT / Apache-2.0 header; no "
            "licence line is not permissive). Remove the file, keep its verdict in the evidence "
            "ledger (section 2c) and the bytes in the capture store, or, for a source written in "
            "this repo, add a probe file, a UCTPROBE_ title or a hash line in fixture_licence.IN_HOUSE:\n"
            + "\n".join(f"  {f}  {w}  ({lic}, sha {sha})" for f, w, lic, sha in offenders)
        )
        # ⛔ NOT VACUOUS: the scope really holds the captures it exists for. Several hundred
        # sources are classified, most of them probes and corpus files.
        assert sum(counts.values()) > 500, counts
        assert counts.get("probe", 0) > 100 and counts.get("corpus", 0) > 100, counts

    def test_the_sweep_reports_a_held_source_by_name(self, tmp_path):
        """⭐ THE CONTROL. A tree with one capture of an unlicensed script, one with a permitted
        header, one probe (by its committed file), one UCTPROBE_ inline probe, an in-house hash, a
        legacy-format observation and an unlicensed .pine under tools/."""
        unlicensed = "//@version=5\nindicator('someone else')\nplot(ta.sma(close, 7))\n"

        def cap(name, text, where="tests/fixtures/vendor/harness"):
            p = tmp_path / where / f"{name}.json"
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps({"schema": fl.CAPTURE_SCHEMA, "id": name,
                                     "source": {"text": text}}), encoding="utf-8")
            return f"{where}/{name}.json"

        probe_dir = tmp_path / "tools" / "visual_conformance" / "probes"
        probe_dir.mkdir(parents=True)
        probe_src = "//@version=6\nindicator('ours')\nplot(close)\n"
        (probe_dir / "ours.pine").write_bytes(probe_src.encode("utf-8"))
        house = "//@version=6\nindicator('house')\nplot(open)\n"
        obs = tmp_path / "tests" / "fixtures" / "vendor" / "observations" / "o.json"
        obs.parent.mkdir(parents=True)
        obs.write_text(json.dumps({"script": {"source": unlicensed + "// v2\n"}}), encoding="utf-8")
        tools_pine = tmp_path / "tools" / "x_fixtures" / "theirs.pine"
        tools_pine.parent.mkdir(parents=True)
        tools_pine.write_text(unlicensed, encoding="utf-8")
        files = [
            cap("bad", unlicensed),
            cap("ok", MIT_HEADER),
            cap("probe", probe_src),
            cap("inline", "//@version=6\nindicator('UCTPROBE_X')\nplot(close)\n"),
            cap("house", house),
            cap("elsewhere", unlicensed, where="docs/somewhere"),
            "tools/visual_conformance/probes/ours.pine",
            "tests/fixtures/vendor/observations/o.json",
            "tools/x_fixtures/theirs.pine",
        ]
        counts, offenders = fl.sweep(str(tmp_path), files, in_house={fl.sha256_text(house): "test"})
        assert [(f, w) for f, w, _lic, _sha in offenders] == [
            ("docs/somewhere/elsewhere.json", ".source.text"),          # a capture OUTSIDE the vendor tree
            ("tests/fixtures/vendor/harness/bad.json", ".source.text"),
            ("tests/fixtures/vendor/observations/o.json", ".script.source"),
            ("tools/x_fixtures/theirs.pine", "<file>"),
        ]
        assert all(lic == NONE_FOUND for _f, _w, lic, _s in offenders)
        assert counts == {"held": 4, "permitted": 1, "probe": 3, "in-house": 1}, counts

    def test_the_in_house_list_names_only_sources_still_in_the_tree(self):
        """A stale allowance is an allowance for whatever next hashes the same. Every IN_HOUSE hash
        must still be a source the sweep finds, and none may be a permitted or probe one."""
        files = fl.tracked_files(REPO)
        known = fl.known_shas(REPO, files)
        seen = {}
        for f in fl.scope_files(REPO, files):
            for _w, text in fl.embedded_sources(os.path.join(REPO, f)):
                seen[fl.sha256_text(text)] = fl.classify(text, known, {})
        assert sorted(set(fl.IN_HOUSE) - set(seen)) == []
        assert {sha: seen[sha] for sha in fl.IN_HOUSE if seen[sha] != "held"} == {}

    def test_the_held_registry_carries_hashes_never_source(self):
        """`licence-held.json` is committed, so it must not become the leak it records."""
        sys.path.insert(0, os.path.join(REPO, "tools", "vendor_harness"))
        import licence_held  # noqa: E402

        doc = licence_held.registry()
        assert doc["schema"] == licence_held.SCHEMA
        assert len(doc["entries"]) >= 23
        tracked = set(fl.tracked_files(REPO))
        for e in doc["entries"]:
            assert set(e) <= licence_held.ENTRY_FIELDS, sorted(set(e) - licence_held.ENTRY_FIELDS)
            assert all(not (isinstance(v, str) and "\n" in v) for v in e.values()), e["path"]
            assert e["path"] not in tracked, f"{e['path']} is registered as held and is committed"
            assert len(e["fileSha256"]) == 64 and len(e["sourceSha256"]) == 64
        raw = open(HELD_REGISTRY, encoding="utf-8").read()
        assert "//@version" not in raw


class TestDerivedDocuments:
    """The third door (2026-11-15): a TRANSLATED definition document of a held script carries no Pine
    text, so the sweep above cannot see it. `fixture_licence.derived_sweep` flags one by its name."""

    def test_no_committed_document_is_named_after_a_held_script(self):
        seen, offenders = fl.derived_sweep(REPO)
        assert offenders == [], (
            "These committed definition documents are translations of a script whose source may not "
            "be committed (docs/pine/LICENSING.md section 2d). Remove each, keep it in the capture "
            "store and register it in docs/pine/vendor-harness/licence-held.json:\n"
            + "\n".join(f"  {f}  {w}  <- {h} ({why})" for f, w, h, why in offenders)
        )
        assert seen >= 20, seen   # ⛔ NOT VACUOUS: the scope finds the documents it exists for

    def test_the_derived_sweep_reports_by_name(self, tmp_path):
        """⭐ THE CONTROL: a held pine_oos member, a held reference script, a committed one sharing no
        slug, and a document named after each (one cut to 40 characters, as the save door does)."""
        def put(rel, obj):
            p = tmp_path / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(obj), encoding="utf-8")
            return rel

        held_oos = "high_engagement__99-someone-elses-long-script-name"
        files = [
            put(f"tests/fixtures/pine_oos/{held_oos}.json", {"storage": "local-only", "license": "not stated"}),
            put("tests/fixtures/pine_oos/long_tail__98-ours.json", {"storage": "git", "license": "MPL-2.0"}),
            put("corpus/reference/held-ref__abc.json", {"verdict": "reference", "licence": "NONE-IN-SOURCE"}),
            put("corpus/reference/ok-ref__def.json", {"verdict": "commit", "licence": "MIT"}),
        ]
        doc = lambda name: {"compute": {"source": "close"}, "meta": {"name": name}}  # noqa: E731
        files += [
            put("tests/fixtures/a/cut.json", doc(held_oos[:40])),
            put("tests/fixtures/a/ref.json", {"docs": [doc("held-ref")]}),
            put("tests/fixtures/a/fine.json", doc("long_tail__98-ours")),
            put("tests/fixtures/a/fine2.json", doc("ok-ref")),
            put("tests/fixtures/a/notadoc.json", {"meta": {"name": held_oos}}),
        ]
        seen, offenders = fl.derived_sweep(str(tmp_path), files)
        assert [(f, w, h) for f, w, h, _why in offenders] == [
            ("tests/fixtures/a/cut.json", "$", held_oos),
            ("tests/fixtures/a/ref.json", ".docs[0]", "held-ref"),
        ]
        assert seen == 4
