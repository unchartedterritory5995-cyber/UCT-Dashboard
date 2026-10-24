"""Task 9.3: tracker values -- cleaning, display, buckets and the tracker measures."""
import math

import pytest

from api.services.journal_two import measures as shared_measures
from api.services.journal_two import tracker_days as tk


def test_constants_are_the_briefs_values():
    assert tk.KINDS == ("yesno", "number", "scale", "duration")
    assert tk.KIND_LABELS == {"yesno": "Yes / no", "number": "Number", "scale": "1-5 scale",
                              "duration": "Duration"}
    assert (tk.UNIT_MAX, tk.DURATION_MAX_MIN, tk.NUMBER_ABS_MAX) == (16, 1440, 1e9)
    assert tk.S_YESNO == "Pick yes or no."
    assert tk.S_SCALE == "Pick a value from 1 to 5."
    assert tk.S_NUMBER == "Enter a number."
    assert tk.S_DURATION == "A duration can be at most 24 hours."
    assert tk.S_UNIT == "A unit can be at most 16 characters."


# ── clean_value ────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("kind,raw,sentence", [
    ("number", float("nan"), tk.S_NUMBER),
    ("number", "1e309", tk.S_NUMBER),
    ("number", float("inf"), tk.S_NUMBER),
    ("number", float("-inf"), tk.S_NUMBER),
    ("number", True, tk.S_NUMBER),
    ("number", "5", tk.S_NUMBER),
    ("number", None, tk.S_NUMBER),
    ("number", 1e9 + 1, tk.S_NUMBER),
    ("number", -1e10, tk.S_NUMBER),
    ("number", [1], tk.S_NUMBER),
    ("scale", 6, tk.S_SCALE),
    ("scale", 2.5, tk.S_SCALE),
    ("scale", 0, tk.S_SCALE),
    ("scale", True, tk.S_SCALE),
    ("scale", "3", tk.S_SCALE),
    ("scale", float("nan"), tk.S_SCALE),
    ("duration", -5, tk.S_DURATION),
    ("duration", 1441, tk.S_DURATION),
    ("duration", float("inf"), tk.S_NUMBER),
    ("duration", "60", tk.S_NUMBER),
    ("duration", True, tk.S_NUMBER),
    ("yesno", 2, tk.S_YESNO),
    ("yesno", 0.5, tk.S_YESNO),
    ("yesno", "yes", tk.S_YESNO),
    ("yesno", None, tk.S_YESNO),
])
def test_clean_value_refuses(kind, raw, sentence):
    with pytest.raises(ValueError) as e:
        tk.clean_value(kind, raw)
    assert str(e.value) == sentence


@pytest.mark.parametrize("kind,raw,expected", [
    ("number", 6.5, 6.5), ("number", -3, -3.0), ("number", 0, 0.0), ("number", 1e9, 1e9),
    ("scale", 1, 1.0), ("scale", 5, 5.0), ("scale", 3.0, 3.0),
    ("duration", 0, 0.0), ("duration", 1440, 1440.0), ("duration", 450, 450.0),
    ("yesno", 1, 1.0), ("yesno", 0, 0.0), ("yesno", True, 1.0), ("yesno", False, 0.0),
])
def test_clean_value_accepts(kind, raw, expected):
    v = tk.clean_value(kind, raw)
    assert isinstance(v, float) and v == expected


def test_clean_value_unknown_kind_is_refused():
    with pytest.raises(ValueError):
        tk.clean_value("mood", 3)


# ── format_value ───────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("kind,value,unit,text", [
    ("yesno", 1.0, None, "Yes"), ("yesno", 0.0, None, "No"),
    ("scale", 3.0, None, "3"),
    ("duration", 450.0, None, "7h 30m"), ("duration", 480.0, None, "8h"),
    ("duration", 45.0, None, "45m"), ("duration", 0.0, None, "0m"),
    ("number", 6.5, "h", "6.5 h"), ("number", 7.0, None, "7"), ("number", 12.0, "trades", "12 trades"),
])
def test_format_value(kind, value, unit, text):
    assert tk.format_value(kind, value, unit) == text


# ── buckets ────────────────────────────────────────────────────────────────────────────────────

def test_buckets_terciles_label_sleep():
    minutes = [h * 60.0 for h in (4, 5, 6, 7, 8, 9)]
    bs = tk.buckets("duration", minutes, None)
    assert [b.label for b in bs] == ["Under 6h", "6h-8h", "8h or more"]
    assert [(b.lo, b.hi) for b in bs] == [(None, 360.0), (360.0, 480.0), (480.0, None)]
    assert [tk.bucket_of(bs, v) for v in minutes] == [
        "Under 6h", "Under 6h", "6h-8h", "6h-8h", "8h or more", "8h or more"]


def test_buckets_terciles_for_a_number_with_a_unit():
    bs = tk.buckets("number", [1, 2, 3, 4, 5, 6, 7, 8, 9], "trades")
    # k = 9 distinct values: edges at index 3 and 6 -> 4 and 7.
    assert [b.label for b in bs] == ["Under 4 trades", "4-7 trades", "7 trades or more"]
    assert tk.bucket_of(bs, 3.9) == "Under 4 trades"
    assert tk.bucket_of(bs, 4) == "4-7 trades"
    assert tk.bucket_of(bs, 7) == "7 trades or more"


def test_buckets_use_distinct_values_only():
    bs = tk.buckets("number", [1, 1, 1, 1, 2, 3], None)
    assert [b.label for b in bs] == ["Under 2", "2-3", "3 or more"]


def test_buckets_few_distinct_values():
    bs = tk.buckets("number", [2.0, 5.0, 2.0], None)
    assert [b.label for b in bs] == ["2", "5"]
    assert tk.bucket_of(bs, 2.0) == "2" and tk.bucket_of(bs, 5.0) == "5"
    assert [b.label for b in tk.buckets("duration", [480.0], None)] == ["8h"]
    assert tk.buckets("number", [], None) == []


def test_buckets_ignore_non_finite_values():
    bs = tk.buckets("number", [1.0, float("nan"), 2.0, float("inf")], None)
    assert [b.label for b in bs] == ["1", "2"]


def test_scale_and_yesno_buckets():
    assert [b.label for b in tk.buckets("yesno", [1.0], None)] == ["Yes", "No"]
    yn = tk.buckets("yesno", [], None)
    assert (tk.bucket_of(yn, 1.0), tk.bucket_of(yn, 0.0)) == ("Yes", "No")
    sc = tk.buckets("scale", [3.0], None)
    assert [b.label for b in sc] == ["1-2", "3", "4-5"]
    assert [tk.bucket_of(sc, v) for v in (1, 2, 3, 4, 5)] == ["1-2", "1-2", "3", "4-5", "4-5"]


def test_bucket_of_missing_value_is_none():
    bs = tk.buckets("scale", [], None)
    assert tk.bucket_of(bs, None) is None
    assert tk.bucket_of(bs, float("nan")) is None


# ── measures ───────────────────────────────────────────────────────────────────────────────────

def _rows(*pairs, tracker="t1"):
    return [{"tracker": tracker, "day": d, "value": v} for d, v in pairs]


def test_tracker_latest_is_newest_day():
    rows = _rows(("2026-11-25", 7.0), ("2026-11-27", 5.0), ("2026-11-23", 9.0))
    mv = tk.TRACKER_MEASURES["tracker_latest"].fn(rows)
    assert (mv.value, mv.n) == (5.0, 3)


def test_tracker_measures_values():
    rows = _rows(("2026-11-23", 6.0), ("2026-11-24", 8.0), ("2026-11-25", None), ("2026-11-27", 7.0))
    m = tk.TRACKER_MEASURES
    assert m["tracker_avg"].fn(rows).value == 7.0
    assert m["tracker_min"].fn(rows).value == 6.0
    assert m["tracker_max"].fn(rows).value == 8.0
    assert m["tracker_entries"].fn(rows).value == 3.0
    assert m["tracker_avg"].fn(rows).n == 3


def test_tracker_measures_with_no_entries_have_no_value():
    for key in ("tracker_avg", "tracker_min", "tracker_max", "tracker_latest"):
        assert tk.TRACKER_MEASURES[key].fn([]).value is None, key


def test_tracker_measures_poisoned_value_is_no_data():
    rows = _rows(("2026-11-23", 6.0), ("2026-11-24", float("nan")))
    for key in ("tracker_avg", "tracker_min", "tracker_max"):
        assert tk.TRACKER_MEASURES[key].fn(rows).value is None, key


def test_tracker_measures_catalog_shape():
    m = tk.TRACKER_MEASURES
    assert list(m) == ["tracker_avg", "tracker_min", "tracker_max", "tracker_latest",
                       "tracker_entries"]
    assert [(x.label, x.kind) for x in m.values()] == [
        ("Average", "average"), ("Lowest", "extreme"), ("Highest", "extreme"),
        ("Latest", "extreme"), ("Entries", "count")]
    for x in m.values():
        assert isinstance(x, shared_measures.Measure)
        assert x.unit == "entries"
        assert x.sources == frozenset({"tracker_history"})
        assert x.min_n == shared_measures.DEFAULT_MIN_N
        assert math.isfinite(x.fn(_rows(("2026-11-23", 1.0))).value)


# ── fix round 1 ────────────────────────────────────────────────────────────────────────────────

def test_tracker_entries_zero_is_no_data():
    mv = tk.TRACKER_MEASURES["tracker_entries"].fn([])
    assert (mv.value, mv.n) == (None, 0)
    assert tk.TRACKER_MEASURES["tracker_entries"].fn(_rows(("2026-11-23", None))).value is None


def test_negative_bucket_edges_read_to():
    bs = tk.buckets("number", [-9, -7, -5, -3, -2, -1], None)
    # k = 6: edges at index 2 and 4 -> -5 and -2.
    assert [b.label for b in bs] == ["Under -5", "-5 to -2", "-2 or more"]
    # Neither edge negative (0 and 4): the plain hyphen stays.
    plain = tk.buckets("number", [-3, -1, 0, 2, 4, 6], "R")
    assert [x.label for x in plain] == ["Under 0 R", "0-4 R", "4 R or more"]


def test_negative_edge_with_one_negative_side_reads_to():
    bs = tk.buckets("number", [-6, -4, -2, 1, 3, 5], None)
    # edges at index 2 and 4 -> -2 and 3
    assert [b.label for b in bs] == ["Under -2", "-2 to 3", "3 or more"]


@pytest.mark.parametrize("value,text", [
    (1e9, "1000000000"), (-1e9, "-1000000000"), (0.000001, "0"), (1e-7, "0"),
    (0.125, "0.12"), (6.5, "6.5"), (-2.0, "-2"), (123456789.987, "123456789.99"),
    (-0.001, "0"),
])
def test_number_text_never_uses_an_exponent(value, text):
    out = tk.format_value("number", value, None)
    assert out == text and "e" not in out


def test_bucket_labels_never_use_an_exponent():
    bs = tk.buckets("number", [1e8, 5e8, 1e9, 2.5e-5, 3e-6, 7e-8], None)
    import re
    labels = [b.label for b in bs]
    assert labels == ["Under 0", "0-500000000", "500000000 or more"]
    assert not any(re.search(r"\de", lab) for lab in labels)
