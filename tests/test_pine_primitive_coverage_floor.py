"""Fails if any known rendering primitive has zero fixture coverage.

Mutation-proof procedure (run by hand once, recorded here — not re-run every
CI pass): temporarily `git mv` the sole fixture for a thin primitive (e.g. the
one script using `plotbar`) out of all three fixture directories, confirm this
test goes RED naming that primitive, then restore it and confirm GREEN.

# Mutation-proved 2026-09-19: removing all barcolor scripts turned this red naming barcolor; restoring turned it green.
"""
from tools.pine_primitive_coverage import (
    build_matrix, collect_corpus_paths, dedupe_corpus, load_primitive_names,
)


def test_no_primitive_has_zero_fixture_coverage():
    primitive_names = load_primitive_names()
    corpus = dedupe_corpus(collect_corpus_paths())
    matrix = build_matrix(corpus, primitive_names)

    zero = sorted(n for n, d in matrix["primitives"].items() if d["count"] == 0)
    assert not zero, (
        f"These rendering primitives have NO fixture script exercising them: {zero}. "
        f"Add a minimal fixture .pine script under tools/c0_oos_fixtures/ before merging."
    )
