"""Phase 8, Package 8F — proves the shadow-log wiring in
`snapshot_builder.run_build` never touches the served `pattern_map`.

`run_build` reads from ~10 live market sources and builds its own target
universe internally (no injectable `targets`/`sources` params) — there is no
existing harness in this repo that runs it end-to-end in a test, and
building one is out of this package's scope. Instead this pins the SOURCE
directly (the same lighter-weight idiom
`test_read_pattern_fields_source_is_unchanged_by_the_shadow_addition`
already established for the sibling shadow-reader claim): `pattern_map` is
assigned exactly once, unconditionally, from `pattern_join.read_pattern_fields`
— never reassigned, never computed conditionally on the shadow flag. The
shadow-log block itself is exercised behaviorally by
`tests/test_screener_wave5_pattern_join_shadow.py`'s
`compare_pattern_shadow` tests — this file only proves the WIRING.
"""
import ast
import inspect


def _run_build_source() -> str:
    from api.services.screener import snapshot_builder
    # `run_build` is a thin lock wrapper — the real body (and pattern_map)
    # lives in `_run_build_locked`.
    return inspect.getsource(snapshot_builder._run_build_locked)


def test_pattern_map_is_assigned_exactly_once_unconditionally():
    source = _run_build_source()
    tree = ast.parse(source)
    fn = tree.body[0]
    assert isinstance(fn, ast.FunctionDef)

    assignments_to_pattern_map = []
    for node in ast.walk(fn):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "pattern_map":
                    assignments_to_pattern_map.append(node)

    assert len(assignments_to_pattern_map) == 1, (
        "pattern_map must be assigned exactly once — a second assignment "
        "would mean something (e.g. a canonical-authority flip) can "
        "overwrite the served value"
    )
    # The one assignment must not be nested inside any If/Try — i.e. it is
    # not conditional on the shadow (or any other) flag.
    only = assignments_to_pattern_map[0]
    for node in ast.walk(fn):
        if isinstance(node, (ast.If, ast.Try)):
            if only in ast.walk(node):
                raise AssertionError(
                    "pattern_map's assignment is nested inside a conditional "
                    "— it must be unconditional"
                )


def test_shadow_block_is_gated_on_its_own_flag_and_calls_compare_pattern_shadow():
    source = _run_build_source()
    assert "PATTERN_CANONICAL_SHADOW_LOG_ENABLED" in source
    assert "compare_pattern_shadow" in source
    # The shadow call passes the already-computed pattern_map — never a
    # second identical query.
    assert "legacy_map=pattern_map" in source


def test_no_scanner_authority_flag_exists_anywhere_in_run_build():
    """This package builds no read-authority switch at all — a stronger
    guarantee than 'off by default', since there is no live code to flip
    (ChatGPT relay review, 2026-09-04, point 1 — 'read-authority flag must
    remain OFF throughout 8F')."""
    source = _run_build_source()
    for forbidden in ("PATTERN_CANONICAL_SCANNER_ENABLED", "read_pattern_fields_canonical_shadow("):
        # the shadow READER function name itself is fine to appear (it's
        # called for the log-only comparison via compare_pattern_shadow);
        # what must never appear is a DIRECT call to it as pattern_map's
        # source, nor any literal "scanner authority" flag name.
        if forbidden.endswith("("):
            assert f"pattern_map = {forbidden}" not in source
        else:
            assert forbidden not in source
