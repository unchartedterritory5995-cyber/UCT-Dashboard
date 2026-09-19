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
    with tempfile.TemporaryDirectory() as d:
        p = pathlib.Path(d) / "a.png"
        _make_image(p, (0, 200, 180))
        result = vpc.compare(p, p)
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
