from api.services.pattern_engine.detectors.registry import (
    register, get_detector, list_pattern_ids,
)
from api.services.pattern_engine import detect_all, detect_one


def _fake_detector(bars, context):
    return [{"id": "fake-1", "sym": "TEST", "pattern_id": "fake_pattern",
             "confidence": 99.0}]


def test_register_and_lookup():
    register("fake_pattern", _fake_detector)
    fn = get_detector("fake_pattern")
    assert fn is _fake_detector


def test_list_pattern_ids_includes_registered():
    register("another_fake", _fake_detector)
    ids = list_pattern_ids()
    assert "another_fake" in ids


def test_get_detector_raises_on_unknown():
    import pytest
    with pytest.raises(KeyError):
        get_detector("does_not_exist")


def test_detect_one_dispatches_to_correct_detector():
    register("dispatch_test", _fake_detector)
    out = detect_one([], context={}, pattern_id="dispatch_test")
    assert len(out) == 1
    assert out[0]["pattern_id"] == "fake_pattern"


def test_detect_all_runs_all_detectors():
    register("all_test_1", _fake_detector)
    register("all_test_2", _fake_detector)
    out = detect_all([], context={})
    fake_count = sum(1 for d in out if d["confidence"] == 99.0)
    assert fake_count >= 2


def test_detect_all_filters_by_pattern_ids():
    register("filter_test_a", _fake_detector)
    register("filter_test_b", _fake_detector)
    out = detect_all([], context={}, pattern_ids=["filter_test_a"])
    assert len(out) == 1
