"""Every test that needs a REAL tesseract is skipped where there is none, and still runs where there is one.

WHY (2026-11-21). tests/test_document_ocr.py's TestAClaimNobodyCanServeIsNotProcessing::
test_the_member_facing_chain_ends_at_a_navigable_page points the engine at `_TESS_BIN` (the real binary) with no
skip guard, while the file's other three real-engine classes carry `skipif(_TESS_BIN is None)`. It passed on the dev
PC, which has tesseract, and went red on the remote tests lane, which has none ("assert False is True").

Two halves, both derived from the source:
  * a test function that names `_TESS_BIN` or `_TESS_VER` (the real binary, or its version) carries
    `@pytest.mark.skipif(_TESS_BIN is None, ...)` on itself or on its class, so a machine without tesseract skips it
    and never reads it as red;
  * every file holding one runs in the tesseract lane (`tesseract-tests` in .github/workflows/ocr-linux-cert.yml,
    which installs tesseract and fails on a tesseract skip), so a skip never means "runs nowhere".

Run ONLY this file:  python -m pytest tests/test_ocr_tesseract_lane.py -q   (stdlib + PyYAML)
"""
from __future__ import annotations

import ast
import pathlib
import re
import subprocess
import sys
import textwrap

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
LANE_WORKFLOW = ROOT / ".github" / "workflows" / "ocr-linux-cert.yml"
LANE_JOB = "tesseract-tests"
REAL = re.compile(r"\b_TESS_(?:BIN|VER)\b")


def _guarded(decorators: list[ast.expr], src: str) -> bool:
    for d in decorators:
        text = ast.get_source_segment(src, d) or ""
        if "skipif" in text and re.search(r"_TESS_BIN\s+is\s+None", text):
            return True
    return False


def real_engine_tests(src: str) -> list[tuple[str, bool]]:
    """[(Class::test or test, guarded?)] for every test function that names the real binary."""
    tree = ast.parse(src)
    out = []
    for node in tree.body:
        if isinstance(node, ast.ClassDef):
            cls_guard = _guarded(node.decorator_list, src)
            for fn in node.body:
                if isinstance(fn, ast.FunctionDef) and fn.name.startswith("test"):
                    if REAL.search(ast.get_source_segment(src, fn) or ""):
                        out.append((f"{node.name}::{fn.name}", cls_guard or _guarded(fn.decorator_list, src)))
        elif isinstance(node, ast.FunctionDef) and node.name.startswith("test"):
            if REAL.search(ast.get_source_segment(src, node) or ""):
                out.append((node.name, _guarded(node.decorator_list, src)))
    return out


def census() -> dict[str, list[tuple[str, bool]]]:
    found = {}
    for path in sorted((ROOT / "tests").rglob("test_*.py")):
        text = path.read_text(encoding="utf-8", errors="replace")
        if not REAL.search(text) or path.name == pathlib.Path(__file__).name:
            continue
        tests = real_engine_tests(text)
        if tests:
            found[path.relative_to(ROOT).as_posix()] = tests
    return found


def lane_files() -> set[str]:
    doc = yaml.safe_load(LANE_WORKFLOW.read_text(encoding="utf-8"))
    job = doc["jobs"][LANE_JOB]
    runs = " ".join(str(s.get("run", "")) for s in job["steps"])
    return set(re.findall(r"tests/test_\w+\.py", runs))


def test_every_real_engine_test_is_skipped_where_there_is_no_binary():
    found = census()
    assert "tests/test_document_ocr.py" in found, "non-vacuity: the census must find the OCR file's real-engine tests"
    bare = [f"{f}::{t}" for f, tests in found.items() for t, ok in tests if not ok]
    assert not bare, ("these name the real tesseract binary with no skipif(_TESS_BIN is None) on the test or its "
                      f"class, so a machine without tesseract reads them as red: {bare}")


def test_every_file_with_one_runs_in_the_tesseract_lane():
    missing = sorted(set(census()) - lane_files())
    assert not missing, (f"real-engine tests that run in no lane with tesseract (add them to `{LANE_JOB}` in "
                         f"{LANE_WORKFLOW.name}): {missing}")


_JUNIT = """<testsuites><testsuite name="pytest">
<testcase classname="tests.test_document_ocr.TestX" name="test_real">{body}</testcase>
<testcase classname="tests.test_document_ocr.TestY" name="test_fake"/>
</testsuite></testsuites>"""


def test_the_lane_installs_tesseract_and_refuses_a_skip(tmp_path):
    doc = yaml.safe_load(LANE_WORKFLOW.read_text(encoding="utf-8"))
    runs = "\n".join(str(s.get("run", "")) for s in doc["jobs"][LANE_JOB]["steps"])
    assert "tesseract-ocr" in runs and "tesseract --version" in runs
    # the refusal is RUN, not read: the step's own script, against a report with and without a tesseract skip
    m = re.search(r"<<'PY'\n(.*?)\n\s*PY\b", runs, re.S)
    assert m, "the lane's skip refusal script is gone"
    (tmp_path / "check.py").write_text(textwrap.dedent(m.group(1)), encoding="utf-8")

    def verdict(body: str) -> int:
        (tmp_path / "tesseract-tests.xml").write_text(_JUNIT.format(body=body), encoding="utf-8")
        return subprocess.run([sys.executable, "check.py"], cwd=tmp_path, capture_output=True).returncode

    assert verdict("") == 0
    assert verdict('<skipped message="no tesseract binary on this machine"/>') == 1
    assert verdict('<skipped message="needs the network"/>') == 0     # only a tesseract skip is the lane's failure
    on = doc.get("on", doc.get(True))
    paths = set(on["pull_request"]["paths"])
    for f in lane_files():
        assert f in paths, f"{f} runs in the lane but does not trigger it"


def test_the_census_can_tell_guarded_from_bare():
    src = '''
import pytest
_TESS_BIN = None

@pytest.mark.skipif(_TESS_BIN is None, reason="x")
class TestGuarded:
    def test_a(self):
        use(_TESS_BIN)

class TestMixed:
    def test_fake(self):
        use("fake")
    @pytest.mark.skipif(_TESS_BIN is None, reason="x")
    def test_real(self):
        use(_TESS_BIN)
    def test_bare(self):
        use(_TESS_VER)

def test_top():
    use(_TESS_BIN)
'''
    assert real_engine_tests(src) == [("TestGuarded::test_a", True), ("TestMixed::test_real", True),
                                      ("TestMixed::test_bare", False), ("test_top", False)]
