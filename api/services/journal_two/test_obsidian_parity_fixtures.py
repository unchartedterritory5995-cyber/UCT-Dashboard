"""Drift detector for the Obsidian cross-LANE parity-rail fixtures.

Mirrors `test_note_convert_fixtures.py` exactly, one level down: those
fixtures pin the SCHEMA (does the JS editor recognize what Python emits);
these pin a narrower, cross-LANE claim about the Obsidian-specific wiki
pre-passes. `obsidianParity.contract.test.js` (the JS side) is the rail
that actually catches a client/server behavior divergence — THIS test only
guards the committed Python-side JSON from going STALE relative to
`obsidian_parity_fixtures_gen.py`'s current output, exactly as
`test_note_convert_fixtures.py` does for `fixtures_gen.py`.

Spec: docs/superpowers/specs/2026-09-02-obsidian-ingest-server-design.md
Report: .superpowers/sdd/2026-09-02-obsidian-ingest-server/parity-rail-report.md
"""

from __future__ import annotations

from api.services.journal_two.note_connectors.convert import (
    obsidian_parity_fixtures_gen as gen,
)


def test_fixtures_in_dir_has_committed_inputs():
    md_files = sorted(gen.FIXTURES_IN_DIR.glob("*.md"))
    manifests = sorted(gen.FIXTURES_IN_DIR.glob("*.vault.json"))
    assert md_files, "expected at least one *.md obsidian parity fixture input"
    assert len(manifests) == len(md_files), (
        "every *.md obsidian parity fixture needs a matching *.vault.json manifest"
    )


def test_committed_fixtures_exist_and_are_non_empty():
    assert gen.FIXTURES_OUT_DIR.is_dir()
    json_files = sorted(gen.FIXTURES_OUT_DIR.glob("*.json"))
    input_files = sorted(gen.FIXTURES_IN_DIR.glob("*.md"))
    assert len(json_files) == len(input_files)
    for path in json_files:
        assert path.stat().st_size > 0


def test_regeneration_is_byte_identical_to_the_committed_fixtures(tmp_path):
    """The drift detector: regenerate into a temp dir, diff every byte
    against the committed copy. A mismatch means `providers/obsidian.py`'s
    pre-pass (or a fixture input) changed without the generator being
    re-run — this test goes RED in CI the moment that happens, rather than
    only the JS parity rail silently validating stale output."""
    regenerated_paths = gen.generate(out_dir=tmp_path, in_dir=gen.FIXTURES_IN_DIR)
    regenerated_names = {p.name for p in regenerated_paths}

    committed_paths = sorted(gen.FIXTURES_OUT_DIR.glob("*.json"))
    committed_names = {p.name for p in committed_paths}

    assert regenerated_names == committed_names, (
        "obsidian_fixtures_in/*.md and the committed obsidian_parity/*.json "
        "fixtures have drifted apart (a fixture was added/removed without "
        "re-running `python -m api.services.journal_two.note_connectors."
        "convert.obsidian_parity_fixtures_gen`): "
        f"regenerated only={regenerated_names - committed_names}, "
        f"committed only={committed_names - regenerated_names}"
    )

    mismatches: list[str] = []
    for name in sorted(committed_names):
        committed_bytes = (gen.FIXTURES_OUT_DIR / name).read_bytes()
        regenerated_bytes = (tmp_path / name).read_bytes()
        if committed_bytes != regenerated_bytes:
            mismatches.append(name)

    assert not mismatches, (
        "committed obsidian_parity fixtures are STALE relative to the "
        "current provider pre-pass output -- regenerate via `python -m "
        "api.services.journal_two.note_connectors.convert."
        "obsidian_parity_fixtures_gen` and commit the result. "
        f"Stale files: {mismatches}"
    )


def test_generate_is_idempotent_across_two_temp_runs(tmp_path_factory):
    """A second, independent regeneration (fresh temp dir, fresh call)
    produces the exact same bytes as the first — proves `generate()` itself
    has no run-to-run nondeterminism."""
    out_a = tmp_path_factory.mktemp("obsidian_parity_gen_a")
    out_b = tmp_path_factory.mktemp("obsidian_parity_gen_b")
    paths_a = gen.generate(out_dir=out_a, in_dir=gen.FIXTURES_IN_DIR)
    paths_b = gen.generate(out_dir=out_b, in_dir=gen.FIXTURES_IN_DIR)

    names_a = sorted(p.name for p in paths_a)
    names_b = sorted(p.name for p in paths_b)
    assert names_a == names_b
    assert names_a  # non-vacuous

    for name in names_a:
        assert (out_a / name).read_bytes() == (out_b / name).read_bytes()
