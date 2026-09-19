import json
import pathlib
import tempfile
from PIL import Image, ImageDraw
from tools import vendor_parity_capture as vpc


def _make_image(path, fill, shape="rect"):
    img = Image.new("RGB", (200, 200), color=(20, 20, 20))
    d = ImageDraw.Draw(img)
    if shape == "rect":
        d.rectangle((40, 40, 160, 160), fill=fill)
    else:
        d.ellipse((40, 40, 160, 160), fill=fill)
    img.save(path)


def test_identical_images_score_near_one():
    # Two DISTINCT files with the same content, not the same path compared to
    # itself — a comparator short-circuiting on a_path == b_path would pass a
    # reflexivity check trivially, and that is never the real shape of a run
    # (the member shot and the vendor shot are always two different files).
    with tempfile.TemporaryDirectory() as d:
        a = pathlib.Path(d) / "a.png"
        b = pathlib.Path(d) / "b.png"
        _make_image(a, (0, 200, 180))
        _make_image(b, (0, 200, 180))
        result = vpc.compare(a, b)
        assert result["score"] > 0.999
        assert result["size_mismatch"] is False


def test_genuinely_different_images_score_meaningfully_lower():
    # non-vacuity control: a comparator that can't tell these two images apart
    # is not a comparator. One is a solid teal rectangle; the other is a solid
    # magenta ellipse on the same canvas — different color AND different shape.
    with tempfile.TemporaryDirectory() as d:
        a = pathlib.Path(d) / "a.png"
        b = pathlib.Path(d) / "b.png"
        _make_image(a, (0, 200, 180), shape="rect")
        _make_image(b, (200, 0, 150), shape="ellipse")
        result = vpc.compare(a, b)
        assert result["score"] < 0.85, (
            f"comparator did not distinguish genuinely different images: {result['score']}")


def test_size_mismatch_is_reported_not_silently_resized():
    with tempfile.TemporaryDirectory() as d:
        a = pathlib.Path(d) / "a.png"
        b = pathlib.Path(d) / "b.png"
        Image.new("RGB", (200, 200)).save(a)
        Image.new("RGB", (300, 250)).save(b)
        result = vpc.compare(a, b)
        assert result["size_mismatch"] is True
        assert result["score"] is None


def test_verdict_flags_low_score_for_review():
    assert vpc.verdict({"score": 0.5, "size_mismatch": False}) == "NEEDS_REVIEW"


def test_verdict_passes_high_score():
    assert vpc.verdict({"score": 0.95, "size_mismatch": False}) == "OK"


def test_verdict_reports_size_mismatch_before_looking_at_score():
    assert vpc.verdict({"score": None, "size_mismatch": True}) == "SIZE_MISMATCH"


def test_verdict_threshold_is_overridable():
    assert vpc.verdict({"score": 0.82, "size_mismatch": False}, threshold=0.90) == "NEEDS_REVIEW"


def test_write_report_creates_md_and_json_with_expected_naming(tmp_path):
    a = tmp_path / "member.png"
    b = tmp_path / "vendor.png"
    Image.new("RGB", (100, 100)).save(a)
    Image.new("RGB", (100, 100)).save(b)
    result = vpc.compare(a, b)
    v = vpc.verdict(result)

    paths = vpc.write_report(
        out_dir=tmp_path, slug="test-indicator", tag="2026-09-19",
        member_shot=a, vendor_shot=b, compare_result=result, verdict_str=v,
    )

    assert paths["md"].name == "parity-report-test-indicator-2026-09-19.md"
    assert paths["json"].name == "parity-report-test-indicator-2026-09-19.json"
    assert paths["md"].exists() and paths["json"].exists()

    data = json.loads(paths["json"].read_text())
    assert data["verdict"] == v
    assert data["score"] == result["score"]
    assert "test-indicator" in paths["md"].read_text()


def test_main_requires_vendor_screenshot_argument(capsys):
    import sys
    old_argv = sys.argv
    sys.argv = ["vendor_parity_capture.py", "--script", "x.pine", "--slug", "x"]
    try:
        raised = False
        try:
            vpc.main()
        except SystemExit:
            raised = True
        assert raised, "argparse should reject a missing required --vendor-screenshot"
    finally:
        sys.argv = old_argv


def test_the_documented_invocation_actually_starts():
    """Regression for a real, measured bug: running this file AS A SCRIPT (the
    only invocation the plan documents) used to die at import time with
    ModuleNotFoundError, because sys.path[0] for a script is its own directory
    (tools/), not the repo root, and `import tools.pine_member_pane_capture`
    needs the repo root on the path. `python -m tools.vendor_parity_capture`
    worked the whole time, which is exactly why pytest (which imports this
    module the -m way) never caught it. Runs the REAL documented command in a
    subprocess — a mock of sys.path would prove nothing about this bug."""
    import subprocess
    import sys as _sys

    proc = subprocess.run(
        [_sys.executable, str(pathlib.Path(__file__).parent / "vendor_parity_capture.py"), "--help"],
        cwd=str(pathlib.Path(__file__).resolve().parents[1]),
        capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, (
        f"the documented `python tools/vendor_parity_capture.py --help` failed "
        f"(exit {proc.returncode}): {proc.stderr}")
    assert "--vendor-screenshot" in proc.stdout


def test_write_report_carries_the_threshold_and_reason_it_was_run_with(tmp_path):
    """A stored report with no threshold on it can't later say whether OK meant
    the 0.80 default or someone's hand-lowered override — this is the exact
    fact chart_parity.py's own --tolerance/--tolerance-reason pairing exists
    to preserve, and it was being validated then silently dropped."""
    a = tmp_path / "member.png"
    b = tmp_path / "vendor.png"
    Image.new("RGB", (100, 100)).save(a)
    Image.new("RGB", (100, 100)).save(b)
    result = vpc.compare(a, b)
    v = vpc.verdict(result, threshold=0.4)

    paths = vpc.write_report(
        out_dir=tmp_path, slug="thresh-test", tag="2026-09-19",
        member_shot=a, vendor_shot=b, compare_result=result, verdict_str=v,
        threshold=0.4, threshold_reason="member's card renders a lighter gridline",
    )

    data = json.loads(paths["json"].read_text())
    assert data["threshold"] == 0.4
    assert data["threshold_reason"] == "member's card renders a lighter gridline"
    md = paths["md"].read_text()
    assert "0.4" in md
    assert "member's card renders a lighter gridline" in md


def test_write_report_default_threshold_has_no_dangling_reason(tmp_path):
    a = tmp_path / "member.png"
    b = tmp_path / "vendor.png"
    Image.new("RGB", (100, 100)).save(a)
    Image.new("RGB", (100, 100)).save(b)
    result = vpc.compare(a, b)
    v = vpc.verdict(result)

    paths = vpc.write_report(
        out_dir=tmp_path, slug="default-thresh", tag="2026-09-19",
        member_shot=a, vendor_shot=b, compare_result=result, verdict_str=v,
    )
    data = json.loads(paths["json"].read_text())
    assert data["threshold"] == vpc.DEFAULT_THRESHOLD
    assert data["threshold_reason"] is None


def test_main_reports_a_measured_capture_failure_as_exit_1_not_inconclusive(
        monkeypatch, tmp_path, capsys):
    """A "kind": "measured" capture failure (the door refused, the attach
    failed) is a real product defect and must exit 1 — flattening it to the
    same INCONCLUSIVE exit 2 as an unreachable rig would make a real
    regression indistinguishable from "nobody tried"."""
    import sys as _sys
    monkeypatch.setattr(vpc.pmpc, "capture_member_pane", lambda **kw: {
        "ok": False, "shot": None, "reason": "attach failed: {}", "kind": "measured"})
    vendor_shot = tmp_path / "vendor.png"
    Image.new("RGB", (10, 10)).save(vendor_shot)
    old_argv = _sys.argv
    _sys.argv = ["vendor_parity_capture.py", "--script", "x.pine", "--slug", "x",
                 "--vendor-screenshot", str(vendor_shot)]
    try:
        assert vpc.main() == 1
    finally:
        _sys.argv = old_argv
    assert "MEASURED FAILURE" in capsys.readouterr().out


def test_main_reports_an_inconclusive_capture_failure_as_exit_2(monkeypatch, tmp_path, capsys):
    import sys as _sys
    monkeypatch.setattr(vpc.pmpc, "capture_member_pane", lambda **kw: {
        "ok": False, "shot": None, "reason": "sign-in 401", "kind": "inconclusive"})
    vendor_shot = tmp_path / "vendor.png"
    Image.new("RGB", (10, 10)).save(vendor_shot)
    old_argv = _sys.argv
    _sys.argv = ["vendor_parity_capture.py", "--script", "x.pine", "--slug", "x",
                 "--vendor-screenshot", str(vendor_shot)]
    try:
        assert vpc.main() == 2
    finally:
        _sys.argv = old_argv
    assert "INCONCLUSIVE" in capsys.readouterr().out


def test_main_reports_an_unreadable_vendor_screenshot_as_inconclusive_not_a_crash(
        monkeypatch, tmp_path, capsys):
    """Before this fix, compare() raising PIL.UnidentifiedImageError on a
    corrupt/non-image file was an uncaught exception — an unreadable file is
    a measurement we could not make, which is INCONCLUSIVE (exit 2), not the
    exit-1 code the contract reserves for a real, measured comparison."""
    import sys as _sys
    member_shot = tmp_path / "member.png"
    Image.new("RGB", (10, 10)).save(member_shot)
    monkeypatch.setattr(vpc.pmpc, "capture_member_pane", lambda **kw: {
        "ok": True, "shot": member_shot, "reason": None})
    not_an_image = tmp_path / "vendor.png"
    not_an_image.write_bytes(b"this is not a png file")
    old_argv = _sys.argv
    _sys.argv = ["vendor_parity_capture.py", "--script", "x.pine", "--slug", "x",
                 "--vendor-screenshot", str(not_an_image)]
    try:
        assert vpc.main() == 2
    finally:
        _sys.argv = old_argv
    assert "INCONCLUSIVE" in capsys.readouterr().out
