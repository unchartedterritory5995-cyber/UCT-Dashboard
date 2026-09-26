"""Rails for the wave-7 live walk's own instrument (tools/notebook_wave7_walk.py).

The walk is a Playwright script, not a module: it parses argv and drives a browser at
import. What these rails exercise is its IMPORTABLE PART -- every top-level statement
above `ARGS = _ap.parse_args()`, cut by AST and executed on its own, so the verdict code
under test is the file's own bytes (a mutation to the file reaches the rail; there is no
copy of it here and no __pycache__ in the way).

W13 (whole-branch tooling review I-2). The walk used to PASS W13 with no evidence: no
`--integrity-log` was a PASS, the log was read while the sandbox was still up (so never
its shutdown checkpoint), and no label was required. W13 is now decided by the perf
harness's own reader (`read_integrity`) against pre-boot, +15 s AND shutdown, after a
bounded wait for the shutdown line. The logs below are written by the launcher's own
writer (`data_root_snapshot.append_log`), so reader and writer cannot drift apart here.
"""
from __future__ import annotations

import ast
import sys
import threading
import time
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
WALK = REPO / "tools" / "notebook_wave7_walk.py"
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))

import data_root_snapshot as drs  # noqa: E402  (the launcher's own log writer)
from tools import notebook_perf_harness as h  # noqa: E402

W13_ROW = "W13_errors_and_sandbox_integrity"


def _tree() -> ast.Module:
    return ast.parse(WALK.read_text(encoding="utf-8"), filename=str(WALK))


def _args_cut(tree: ast.Module) -> int:
    for i, node in enumerate(tree.body):
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "ARGS"
                                                for t in node.targets):
            return i
    raise AssertionError("the walk has no top-level `ARGS = ...` -- the importable part has no boundary")


@pytest.fixture(scope="module")
def walk() -> dict:
    """The walk's importable part, executed from its source."""
    tree = _tree()
    ns: dict = {"__file__": str(WALK), "__name__": "notebook_wave7_walk__importable"}
    exec(compile(ast.Module(body=tree.body[:_args_cut(tree)], type_ignores=[]), str(WALK), "exec"), ns)
    return ns


def _log(tmp_path: Path, labels, *, dirty=(), name="integrity.md") -> str:
    path = tmp_path / name
    for label in labels:
        diffs = [("CHANGED", "auth.db", "sha differs")] if label in dirty else []
        drs.append_log(str(path), label, r"C:\data", 61, diffs)
    return str(path)


ALL_THREE = (h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN)


def _w13(walk, path, errors=(), launcher_text=None):
    return walk["w13_verdict"](walk["w13_integrity"](path, launcher_text), list(errors))


# ── non-vacuity: the prefix really holds the code under test ────────────────────────────

def test_the_importable_part_defines_W13s_code_and_reuses_the_harness_reader(walk):
    for name in ("w13_verdict", "w13_integrity", "wait_for_shutdown_checkpoint", "integrity_log_named_in"):
        assert callable(walk.get(name)), f"{name} is not above `ARGS = ...` in the walk"
    # ONE reader: the harness module itself, not a copy of it.
    assert walk["_harness"] is h
    assert tuple(walk["W13_REQUIRED"]) == ALL_THREE
    # ...and no second parser anywhere in the walk (the old one matched "- `" lines by hand).
    tree = _tree()
    defs = {n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
    assert "read_integrity" not in defs
    src = WALK.read_text(encoding="utf-8")
    assert 'startswith("- `")' not in src and 'endswith("— CLEAN")' not in src


# ── W13's three verdicts (the brief's rails) ────────────────────────────────────────────

def test_all_three_checkpoints_CLEAN_is_PASS(tmp_path, walk):
    verdict, why = _w13(walk, _log(tmp_path, ALL_THREE))
    assert (verdict, why) == ("PASS", None)


def test_a_log_missing_the_shutdown_checkpoint_is_INCONCLUSIVE(tmp_path, walk):
    # Pre-boot, +15 s and even +120 s all CLEAN: without the line taken after the walk's
    # own writes there is no evidence about them.
    verdict, why = _w13(walk, _log(tmp_path, (h.PRE_BOOT, h.POST_BOOT, h.PREWARM)))
    assert verdict == "INCONCLUSIVE"
    assert "INCOMPLETE" in why and repr(h.SHUTDOWN) in why


def test_a_checkpoint_that_is_NOT_CLEAN_is_FAIL(tmp_path, walk):
    verdict, why = _w13(walk, _log(tmp_path, ALL_THREE, dirty=(h.SHUTDOWN,)))
    assert verdict == "FAIL"
    assert "shared data root changed" in why and h.SHUTDOWN in why


# ── the rest of I-2 ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("path", [None, "", "does/not/exist.md"])
def test_no_integrity_log_is_INCONCLUSIVE_never_PASS(tmp_path, walk, path):
    verdict, why = _w13(walk, path)
    assert verdict == "INCONCLUSIVE" and "MISSING" in why


def test_a_log_holding_only_pre_boot_is_not_evidence(tmp_path, walk):
    verdict, _ = _w13(walk, _log(tmp_path, (h.PRE_BOOT,)))
    assert verdict == "INCONCLUSIVE"


def test_a_dirty_checkpoint_fails_even_when_the_shutdown_line_is_missing(tmp_path, walk):
    verdict, _ = _w13(walk, _log(tmp_path, (h.PRE_BOOT, h.POST_BOOT), dirty=(h.POST_BOOT,)))
    assert verdict == "FAIL"


def test_an_unforced_page_error_fails_on_a_clean_log(tmp_path, walk):
    verdict, why = _w13(walk, _log(tmp_path, ALL_THREE), errors=["TypeError: x is undefined"])
    assert verdict == "FAIL" and "1 unforced page error" in why


def test_the_log_must_be_the_one_the_launcher_named(tmp_path, walk):
    path = _log(tmp_path, ALL_THREE)
    other = _log(tmp_path, ALL_THREE, name="another-run.md")
    # The launcher's own line, as scripts/hub_sandbox_boot.py prints it (leading spaces, CRLF).
    said = lambda p: f"  [pre-boot] shared data root CLEAN\r\n  [pre-boot] integrity log: {p}\r\n"  # noqa: E731
    assert _w13(walk, path, launcher_text=said(path)) == ("PASS", None)
    verdict, why = _w13(walk, path, launcher_text=said(other))
    assert verdict == "INCONCLUSIVE" and "another-run.md" in why
    # No launcher output to ask is not a disagreement.
    assert _w13(walk, path, launcher_text=None) == ("PASS", None)


# ── --shutdown-wait ─────────────────────────────────────────────────────────────────────

def test_the_wait_returns_once_the_shutdown_line_lands(tmp_path, walk):
    path = _log(tmp_path, (h.PRE_BOOT, h.POST_BOOT))
    timer = threading.Timer(0.6, lambda: drs.append_log(path, h.SHUTDOWN, r"C:\data", 61, []))
    timer.start()
    try:
        t0 = time.time()
        waited = walk["wait_for_shutdown_checkpoint"](path, 20, poll_s=0.05)
        elapsed = time.time() - t0
    finally:
        timer.cancel()
    assert 0.5 <= waited < 10 and elapsed < 10
    assert _w13(walk, path) == ("PASS", None)


def test_the_wait_is_bounded_and_then_W13_is_INCONCLUSIVE(tmp_path, walk):
    path = _log(tmp_path, (h.PRE_BOOT, h.POST_BOOT))
    t0 = time.time()
    waited = walk["wait_for_shutdown_checkpoint"](path, 0.4, poll_s=0.05)
    assert 0.35 <= waited and time.time() - t0 < 5
    assert _w13(walk, path)[0] == "INCONCLUSIVE"


@pytest.mark.parametrize("case", ["no log", "zero budget", "already there"])
def test_the_wait_does_not_wait_with_nothing_to_wait_for(tmp_path, walk, case):
    path = {"no log": None,
            "zero budget": _log(tmp_path, (h.PRE_BOOT,)),
            "already there": _log(tmp_path, ALL_THREE)}[case]
    t0 = time.time()
    assert walk["wait_for_shutdown_checkpoint"](path, 0 if case == "zero budget" else 30, poll_s=0.05) == 0.0
    assert time.time() - t0 < 2


# ── wiring: the row the walk records IS this verdict, after the wait ─────────────────────

def _main_block(tree: ast.Module) -> ast.With:
    withs = [n for n in tree.body[_args_cut(tree):] if isinstance(n, ast.With)]
    assert len(withs) == 1, "expected the walk's one top-level `with sync_playwright()` block"
    return withs[0]


def _calls(node, name):
    return [c for c in ast.walk(node) if isinstance(c, ast.Call)
            and ((isinstance(c.func, ast.Name) and c.func.id == name)
                 or (isinstance(c.func, ast.Attribute) and c.func.attr == name))]


def _is_args(node, attr):
    return (isinstance(node, ast.Attribute) and node.attr == attr
            and isinstance(node.value, ast.Name) and node.value.id == "ARGS")


def test_W13_is_recorded_from_w13_verdict_after_the_browser_closes_and_the_wait():
    main = _main_block(_tree())
    records = [c for c in _calls(main, "record")
               if c.args and isinstance(c.args[0], ast.Constant) and c.args[0].value == W13_ROW]
    assert len(records) == 1, "W13 must be recorded exactly once"
    rec = records[0]
    assert isinstance(rec.args[1], ast.Name), "W13's verdict must be a name bound from w13_verdict(...)"
    verdict_name = rec.args[1].id
    binds = [n for n in ast.walk(main) if isinstance(n, ast.Assign) and isinstance(n.value, ast.Call)
             and isinstance(n.value.func, ast.Name) and n.value.func.id == "w13_verdict"
             and any(isinstance(t, ast.Tuple) and t.elts and isinstance(t.elts[0], ast.Name)
                     and t.elts[0].id == verdict_name for t in n.targets)]
    assert len(binds) == 1, f"`{verdict_name}` is not bound from w13_verdict(...)"

    waits = _calls(main, "wait_for_shutdown_checkpoint")
    assert len(waits) == 1 and _is_args(waits[0].args[0], "integrity_log") \
        and _is_args(waits[0].args[1], "shutdown_wait")
    reads = _calls(main, "w13_integrity")
    assert len(reads) == 1 and _is_args(reads[0].args[0], "integrity_log")
    closes = [c for c in _calls(main, "close") if isinstance(c.func, ast.Attribute)
              and isinstance(c.func.value, ast.Name) and c.func.value.id == "browser"]
    assert closes, "the browser is never closed"
    # Order in the file: close the browser, wait for shutdown, read the log, judge, record.
    assert (closes[-1].lineno < waits[0].lineno < reads[0].lineno
            < binds[0].lineno <= rec.lineno), "W13 must be judged after the browser closed and the wait"
