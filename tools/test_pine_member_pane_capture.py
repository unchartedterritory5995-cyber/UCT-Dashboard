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


def test_unique_served_name_never_collides_across_calls():
    """Regression for a real race: two capture calls (this script running
    twice, or this script alongside vendor_parity_capture.py's
    capture_member_pane()) used to write to the exact same hardcoded
    SERVED_DIR/SERVED_NAME path — one process's copyfile could overwrite the
    other's between its own copy and its own page fetching that URL. Every
    call must now get its own name."""
    names = {pmpc._unique_served_name() for _ in range(50)}
    assert len(names) == 50, "collision within 50 calls — the uniqueness source is too weak"
    for name in names:
        assert name.startswith("rig-member-fixture-")
        assert name.endswith(".txt")


def test_served_name_constant_is_a_pattern_not_an_actual_path():
    """SERVED_NAME must never be used directly as a served file's real name
    any more — it's the naming pattern _unique_served_name() derives from."""
    import inspect
    src_capture = inspect.getsource(pmpc.capture_member_pane)
    src_main = inspect.getsource(pmpc.main)
    for src, label in ((src_capture, "capture_member_pane"), (src_main, "main")):
        assert "SERVED_DIR / SERVED_NAME" not in src, (
            f"{label} still builds the served path from the shared constant directly")
