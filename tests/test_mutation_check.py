"""Rails for the byte-exact mutation-check harness.

The harness exists to remove a source-loss hazard, so the property that
matters most is: THE FILE COMES BACK, byte for byte, on every path --
including a failing rail, a rail that stays green, and an exception.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

TOOL = Path(__file__).resolve().parents[1] / "tools" / "mutation_check.py"

# A tiny implementation + rail pair, written into tmp_path per test.
IMPL = "VALUE = 'right'\nUNCOVERED = 'nobody checks this'\n"
RAIL = (
    "import importlib.util, sys\n"
    "from pathlib import Path\n"
    "def test_value():\n"
    "    spec = importlib.util.spec_from_file_location('impl', Path(__file__).with_name('impl.py'))\n"
    "    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n"
    "    assert m.VALUE == 'right'\n"
)


def _project(tmp_path):
    (tmp_path / "impl.py").write_text(IMPL, encoding="utf-8")
    (tmp_path / "test_rail.py").write_text(RAIL, encoding="utf-8")
    return tmp_path / "impl.py", tmp_path / "test_rail.py"


def _run(impl, rail, *extra):
    cmd = [sys.executable, str(TOOL), "--file", str(impl),
           "--test", f'"{sys.executable}" -m pytest "{rail}" -q', *extra]
    return subprocess.run(cmd, capture_output=True, text=True)


class TestRestoreGuarantee:
    def test_the_file_is_byte_identical_after_a_detected_mutation(self, tmp_path):
        impl, rail = _project(tmp_path)
        before = impl.read_bytes()
        r = _run(impl, rail, "--replace", "'right'", "--with", "'wrong'")
        assert impl.read_bytes() == before
        assert "byte-identical restore verified" in r.stdout
        assert r.returncode == 0

    def test_the_file_is_byte_identical_even_when_the_rail_fails_to_detect(self, tmp_path):
        impl, rail = _project(tmp_path)
        before = impl.read_bytes()
        r = _run(impl, rail, "--replace", "'nobody checks this'", "--with", "'changed'")
        assert impl.read_bytes() == before, "restore must not depend on the verdict"
        assert r.returncode == 1

    def test_the_file_is_byte_identical_when_the_test_command_itself_explodes(self, tmp_path):
        impl, rail = _project(tmp_path)
        before = impl.read_bytes()
        cmd = [sys.executable, str(TOOL), "--file", str(impl),
               "--test", "this-command-does-not-exist",
               "--replace", "'right'", "--with", "'wrong'"]
        subprocess.run(cmd, capture_output=True, text=True)
        assert impl.read_bytes() == before

    def test_a_missing_mutation_target_restores_and_refuses(self, tmp_path):
        impl, rail = _project(tmp_path)
        before = impl.read_bytes()
        r = _run(impl, rail, "--replace", "not-in-the-file", "--with", "x")
        assert impl.read_bytes() == before
        assert r.returncode == 2
        assert "MUTATION TARGET NOT FOUND" in r.stdout


class TestVerdicts:
    def test_a_detected_mutation_passes_the_check(self, tmp_path):
        impl, rail = _project(tmp_path)
        r = _run(impl, rail, "--replace", "'right'", "--with", "'wrong'")
        assert "MUTATION CHECK PASSED" in r.stdout
        assert r.returncode == 0

    def test_an_undetected_mutation_fails_the_check(self, tmp_path):
        # The whole point: a test that stays green through a broken
        # implementation is not a rail, and the harness must say so.
        impl, rail = _project(tmp_path)
        r = _run(impl, rail, "--replace", "'nobody checks this'", "--with", "'changed'")
        assert "THE RAIL DID NOT FAIL" in r.stdout
        assert r.returncode == 1

    def test_expect_red_naming_the_wrong_test_fails_the_check(self, tmp_path):
        # Something broke, but not the thing claimed -- so the check proves
        # the wrong thing and must not pass.
        impl, rail = _project(tmp_path)
        r = _run(impl, rail, "--replace", "'right'", "--with", "'wrong'",
                 "--expect-red", "test_some_other_name")
        assert "was NOT among the failures" in r.stdout
        assert r.returncode == 1

    def test_expect_red_naming_the_right_test_passes(self, tmp_path):
        impl, rail = _project(tmp_path)
        r = _run(impl, rail, "--replace", "'right'", "--with", "'wrong'",
                 "--expect-red", "test_value")
        assert r.returncode == 0


class TestArgumentGuards:
    def test_mismatched_replace_and_with_are_refused(self, tmp_path):
        impl, rail = _project(tmp_path)
        r = _run(impl, rail, "--replace", "a")
        assert r.returncode == 2

    def test_no_mutation_specified_is_refused(self, tmp_path):
        impl, rail = _project(tmp_path)
        r = _run(impl, rail)
        assert r.returncode == 2

    def test_a_missing_file_is_refused(self, tmp_path):
        _, rail = _project(tmp_path)
        r = _run(tmp_path / "nope.py", rail, "--replace", "a", "--with", "b")
        assert r.returncode == 2

    def test_an_out_of_range_line_is_refused_and_restores(self, tmp_path):
        impl, rail = _project(tmp_path)
        before = impl.read_bytes()
        r = _run(impl, rail, "--line", "9999", "--set", "x")
        assert impl.read_bytes() == before
        assert r.returncode == 2
