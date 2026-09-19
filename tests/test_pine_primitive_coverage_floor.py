"""Fails if any known rendering primitive has zero fixture coverage, or has
fewer than the spec's floor of two scripts.

Mutation-proof procedure (run by hand once, recorded here — not re-run every
CI pass): temporarily `git mv` all scripts for a thin primitive out of all
three fixture directories, confirm the relevant test below goes RED naming
that primitive, then restore and confirm GREEN.

# Mutation-proved 2026-09-19 (zero-coverage test): removing all barcolor scripts turned it red naming barcolor; restoring turned it green.
# Mutation-proved 2026-09-19 (>=2-floor test): removing one of plotbar's two scripts turned it red naming plotbar (count=1); restoring turned it green.
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
        f"Add a minimal fixture .pine script under tools/pine_coverage_synthetic_fixtures/ before merging."
    )


def test_no_primitive_has_fewer_than_two_fixture_scripts():
    """Spec §4.1's floor is >=2 fixture scripts per primitive, not merely >0
    (a single fixture can't distinguish "this primitive renders" from "this
    primitive renders exactly like THIS one script" — see the fixture header
    comments in tools/pine_coverage_synthetic_fixtures/*-2.pine). The test
    above only ever enforced >0 and would stay green if a primitive dropped
    to exactly 1."""
    primitive_names = load_primitive_names()
    corpus = dedupe_corpus(collect_corpus_paths())
    matrix = build_matrix(corpus, primitive_names)

    below_floor = sorted(
        (n, d["count"]) for n, d in matrix["primitives"].items() if d["count"] < 2
    )
    assert not below_floor, (
        f"These rendering primitives have FEWER THAN 2 fixture scripts (spec "
        f"§4.1 floor): {below_floor}. Add another minimal fixture .pine script "
        f"under tools/pine_coverage_synthetic_fixtures/ exercising each before merging."
    )
