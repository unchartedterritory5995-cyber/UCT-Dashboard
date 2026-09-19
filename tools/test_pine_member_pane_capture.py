import pathlib

# ⛔ `tools/__init__.py` makes `tools` a real package and the repo root (not
# `tools/`) is what pytest puts on sys.path for an explicit-path invocation
# (`python -m pytest tools/test_....py`) — a bare `import
# pine_member_pane_capture` raises ModuleNotFoundError (measured). The
# fully-qualified form is the established sibling-import convention in this
# directory: see `from tools.full_chart_diagnostic import _phantom_spike` in
# tools/full_chart_diagnostic_test.py.
import tools.pine_member_pane_capture as pmpc


def test_capture_member_pane_is_importable_with_expected_signature():
    import inspect
    sig = inspect.signature(pmpc.capture_member_pane)
    assert list(sig.parameters) == ["base", "script_path", "out_dir", "tag", "slug", "viewport"]
    assert sig.parameters["viewport"].default == (1440, 900)


def test_main_still_uses_the_uncharted_clouds_fixture_by_default():
    # backward-compat: the original CLI's behavior must not change silently.
    assert pmpc.FIXTURE.name == "uncharted-clouds.pine"
