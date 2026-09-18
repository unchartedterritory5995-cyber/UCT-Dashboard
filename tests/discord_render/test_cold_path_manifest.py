"""R63(c) ADDENDUM — `api.services.discord_render.cold_path_manifest`."""
import json

import pytest

from api.services.discord_render import cold_path_manifest as cm


def _manifest(rows):
    return {"generated_at": "2026-09-18T00:00:00Z", "modules": [r["module"] for r in rows],
            "measured": rows}


# ─────────────────────────────────────────────────────────────── loading

def test_load_manifest_returns_the_parsed_dict(tmp_path):
    p = tmp_path / "m.json"
    p.write_text(json.dumps({"a": 1}), encoding="utf-8")
    assert cm.load_manifest(p) == {"a": 1}


def test_a_missing_manifest_returns_None_never_raises(tmp_path):
    assert cm.load_manifest(tmp_path / "does-not-exist.json") is None


def test_a_malformed_manifest_returns_None_never_raises(tmp_path):
    p = tmp_path / "bad.json"
    p.write_text("{not valid json", encoding="utf-8")
    assert cm.load_manifest(p) is None


def test_the_default_path_points_at_the_scanner_output_location():
    """⛔ One path, not a second hand-typed copy anywhere else. This pins it against
    accidental drift from the scanner's own write location."""
    assert str(cm.DEFAULT_MANIFEST_PATH).replace("\\", "/").endswith(
        "docs/discord-render/evidence/cold-paths/preload-manifest.json")


# ────────────────────────────────────────────────────────── the threshold filter

def test_only_entries_above_the_threshold_qualify():
    m = _manifest([{"module": "cheap", "cold_ms": 3.0, "error": None},
                  {"module": "expensive", "cold_ms": 200.0, "error": None}])
    above = cm.above_threshold_modules(m, threshold_ms=50.0)
    assert [r["module"] for r in above] == ["expensive"]


def test_the_boundary_itself_is_EXCLUSIVE():
    """⛔ 'above' means strictly above — a module measured at EXACTLY the threshold has not
    demonstrated it costs MORE than the line being drawn."""
    m = _manifest([{"module": "exactly", "cold_ms": 50.0, "error": None}])
    assert cm.above_threshold_modules(m, threshold_ms=50.0) == []


def test_unmeasurable_entries_are_EXCLUDED_never_defaulted():
    """⛔⛔ THE ONE THAT MATTERS MOST. cold_ms=None must never be coerced to 0 (which would
    silently pass every filter as 'free') or to the threshold (which would silently register
    something nobody has verified imports cleanly). It is excluded from registration and
    reported separately."""
    m = _manifest([{"module": "broken", "cold_ms": None, "error": "ModuleNotFoundError"}])
    assert cm.above_threshold_modules(m, threshold_ms=50.0) == []
    unmeasurable = cm.unmeasurable_modules(m)
    assert len(unmeasurable) == 1 and unmeasurable[0]["module"] == "broken"


def test_a_zero_or_negative_reading_is_excluded_a_real_import_is_never_free():
    m = _manifest([{"module": "suspicious", "cold_ms": 0.0, "error": None}])
    assert cm.above_threshold_modules(m, threshold_ms=0.0) == []


def test_results_are_RANKED_descending_by_cost():
    m = _manifest([{"module": "mid", "cold_ms": 100.0, "error": None},
                  {"module": "biggest", "cold_ms": 500.0, "error": None},
                  {"module": "smallest_qualifying", "cold_ms": 51.0, "error": None}])
    above = cm.above_threshold_modules(m, threshold_ms=50.0)
    assert [r["module"] for r in above] == ["biggest", "mid", "smallest_qualifying"]


def test_api_main_is_excluded_regardless_of_measured_cost():
    """⛔⛔ THE METHODOLOGY-ARTIFACT EXCLUSION. `api.main` measured at 17,300 ms on 2026-09-18 —
    the largest entry the scanner has ever produced — because it is the ASGI entry point:
    every OTHER module that lazily imports it can only run after api.main has already finished
    importing, so a live 'lazy' import of it is a guaranteed cache hit and reporting it at the
    top of a ranked list is actively misleading."""
    m = _manifest([{"module": "api.main", "cold_ms": 17300.0, "error": None},
                  {"module": "api.services.options_chain", "cold_ms": 13370.8, "error": None}])
    above = cm.above_threshold_modules(m, threshold_ms=50.0)
    assert [r["module"] for r in above] == ["api.services.options_chain"], (
        "api.main was not excluded, or something else was wrongly excluded with it")


def test_an_empty_measured_list_qualifies_nothing_and_does_not_raise():
    assert cm.above_threshold_modules({"measured": []}, threshold_ms=50.0) == []
    assert cm.above_threshold_modules({}, threshold_ms=50.0) == []


# ─────────────────────────────────────────────────────────────────── the summary

def test_manifest_summary_reports_absence_honestly(tmp_path):
    s = cm.manifest_summary(path=tmp_path / "nope.json")
    assert s == {"manifest_present": False}


def test_manifest_summary_reports_counts_when_present(tmp_path):
    p = tmp_path / "m.json"
    p.write_text(json.dumps(_manifest([
        {"module": "a", "cold_ms": 200.0, "error": None},
        {"module": "b", "cold_ms": 5.0, "error": None},
        {"module": "c", "cold_ms": None, "error": "boom"},
    ])), encoding="utf-8")
    s = cm.manifest_summary(path=p, threshold_ms=50.0)
    assert s["manifest_present"] is True
    assert s["above_threshold_count"] == 1
    assert s["above_threshold_modules"] == ["a"]
    assert s["unmeasurable_count"] == 1
    assert s["modules_measured"] == 3
