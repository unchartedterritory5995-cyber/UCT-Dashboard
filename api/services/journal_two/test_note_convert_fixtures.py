"""Drift detector for the cross-language schema-rail fixtures (Task 5).

`fixtures_gen.generate()` is the ONLY thing allowed to write
`app/src/pages/journal-2-0/lib/importer/__fixtures__/server_convert/*.json` —
those files are committed, and the vitest contract rail
(`serverConvert.contract.test.js`) validates the COMMITTED copies against the
real editor schema, not a freshly-regenerated one. If someone edits
`mddoc.py` (or a fixture input under `convert/fixtures_in/`) and forgets to
re-run the generator, the committed JSON silently stops matching what the
converter would actually produce today — exactly the drift the cross-
language rail exists to catch, except entirely on the Python side where the
JS test would never see it.

This test regenerates into a throwaway temp directory (never touching the
committed fixtures) and asserts the result is byte-IDENTICAL to what's
checked in: same filenames, same bytes. `fixtures_gen.generate()` is written
to be deterministic (sorted JSON keys, fixed indent, `\n`-only newlines) for
exactly this reason — see its module docstring.
"""

from __future__ import annotations

from api.services.journal_two.note_connectors.convert import fixtures_gen


def test_fixtures_in_dir_has_committed_inputs():
    md_files = sorted(fixtures_gen.FIXTURES_IN_DIR.glob("*.md"))
    html_files = sorted(fixtures_gen.FIXTURES_IN_DIR.glob("*.html"))
    assert md_files, "expected at least one *.md fixture input"
    assert html_files, "expected at least one *.html fixture input (html_to_tiptap rail)"


def test_committed_fixtures_exist_and_are_non_empty():
    assert fixtures_gen.FIXTURES_OUT_DIR.is_dir()
    json_files = sorted(fixtures_gen.FIXTURES_OUT_DIR.glob("*.json"))
    input_files = sorted(fixtures_gen.FIXTURES_IN_DIR.glob("*.md")) + sorted(
        fixtures_gen.FIXTURES_IN_DIR.glob("*.html")
    )
    assert len(json_files) == len(input_files)
    for path in json_files:
        assert path.stat().st_size > 0


def test_regeneration_is_byte_identical_to_the_committed_fixtures(tmp_path):
    """The drift detector: regenerate into a temp dir, diff every byte
    against the committed copy. A mismatch means `mddoc.py`/a fixture input
    changed without the generator being re-run — this test goes RED in CI
    the moment that happens, rather than only the human noticing later that
    the vitest rail is validating stale output."""
    regenerated_paths = fixtures_gen.generate(out_dir=tmp_path, in_dir=fixtures_gen.FIXTURES_IN_DIR)
    regenerated_names = {p.name for p in regenerated_paths}

    committed_paths = sorted(fixtures_gen.FIXTURES_OUT_DIR.glob("*.json"))
    committed_names = {p.name for p in committed_paths}

    assert regenerated_names == committed_names, (
        "fixtures_in/*.md and the committed server_convert/*.json fixtures "
        "have drifted apart (a fixture was added/removed on one side without "
        "re-running `python -m "
        "api.services.journal_two.note_connectors.convert.fixtures_gen`): "
        f"regenerated only={regenerated_names - committed_names}, "
        f"committed only={committed_names - regenerated_names}"
    )

    mismatches: list[str] = []
    for name in sorted(committed_names):
        committed_bytes = (fixtures_gen.FIXTURES_OUT_DIR / name).read_bytes()
        regenerated_bytes = (tmp_path / name).read_bytes()
        if committed_bytes != regenerated_bytes:
            mismatches.append(name)

    assert not mismatches, (
        "committed server_convert fixtures are STALE relative to the current "
        "converter output — regenerate via `python -m "
        "api.services.journal_two.note_connectors.convert.fixtures_gen` and "
        f"commit the result. Stale files: {mismatches}"
    )


def test_generate_is_idempotent_across_two_temp_runs(tmp_path_factory):
    """A second, independent regeneration (fresh temp dir, fresh call)
    produces the exact same bytes as the first — proves `generate()` itself
    has no run-to-run nondeterminism (e.g. dict/set iteration order) that a
    single comparison against the committed copy wouldn't reveal on a machine
    where both happened to already agree by coincidence."""
    out_a = tmp_path_factory.mktemp("gen_a")
    out_b = tmp_path_factory.mktemp("gen_b")
    paths_a = fixtures_gen.generate(out_dir=out_a, in_dir=fixtures_gen.FIXTURES_IN_DIR)
    paths_b = fixtures_gen.generate(out_dir=out_b, in_dir=fixtures_gen.FIXTURES_IN_DIR)

    names_a = sorted(p.name for p in paths_a)
    names_b = sorted(p.name for p in paths_b)
    assert names_a == names_b
    assert names_a  # non-vacuous

    for name in names_a:
        assert (out_a / name).read_bytes() == (out_b / name).read_bytes()
