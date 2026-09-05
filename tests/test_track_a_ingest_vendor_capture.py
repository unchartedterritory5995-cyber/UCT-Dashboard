"""Tests for tools/track_a_ingest_vendor_capture.py.

Mirrors tests/test_vendor_truth.py's own discipline: an ingestion tool that
never fails on inconsistent/untrusted input is worse than none (it would be
the "a swallowed error becomes a confident finding" defect this program keeps
naming), so most of these tests are refusal tests, not happy-path tests.
"""

from __future__ import annotations

import csv
import io
import json
import os

import pytest

from tools import track_a_ingest_vendor_capture as ingest_mod
from tools.vendor_truth import REQUIRED, REQUIRED_PROVENANCE, load_observations

# The packet's own worked example at phase == 24: raw=6, priors=3,5,1,9.
GOOD_ROW = {
    "phase": 24,
    "raw": 6.0,
    "rising_builtin": True,          # matches candidate A (running-max)
    "rising_candA_runningMax": True,
    "rising_candB_monotone": False,
    "median_builtin": 3.0,           # matches candidate lower-middle
    "median_candLower": 3.0,
    "median_candMean": 4.0,
    "percentrank_builtin": 75.0,     # matches candidate A (/L)
    "percentrank_candA_overL": 75.0,
    "percentrank_candB_overLplus1": 80.0,
    "bbw_builtin": 190.8367198512619,  # matches candidate percent, NOT ratio
    "bbw_candRatio": 1.908367198512619,
    "bbw_candPercent": 190.8367198512619,
    "time": 20260910,
    "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.5, "volume": 1000,
}


def _write_csv(tmp_path, rows):
    path = tmp_path / "capture.csv"
    with io.open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    return str(path)


def _write_json(tmp_path, row):
    path = tmp_path / "capture.json"
    path.write_text(json.dumps(row), encoding="utf-8")
    return str(path)


class TestParsing:
    def test_csv_round_trips_every_required_field(self, tmp_path):
        path = _write_csv(tmp_path, [GOOD_ROW])
        rows = ingest_mod.parse_capture(path)
        assert len(rows) == 1
        assert rows[0]["phase"] == 24
        assert rows[0]["raw"] == 6.0
        assert rows[0]["rising_builtin"] is True

    def test_json_single_object_becomes_one_row(self, tmp_path):
        path = _write_json(tmp_path, GOOD_ROW)
        rows = ingest_mod.parse_capture(path)
        assert len(rows) == 1
        assert rows[0]["phase"] == 24

    def test_missing_required_field_is_refused(self, tmp_path):
        bad = dict(GOOD_ROW)
        del bad["bbw_candPercent"]
        path = _write_json(tmp_path, bad)
        with pytest.raises(ingest_mod.CaptureError, match="bbw_candPercent"):
            ingest_mod.parse_capture(path)

    def test_unrecognized_extension_is_refused(self, tmp_path):
        path = tmp_path / "capture.txt"
        path.write_text("{}", encoding="utf-8")
        with pytest.raises(ingest_mod.CaptureError, match="extension"):
            ingest_mod.parse_capture(str(path))


class TestPhase24Location:
    def test_finds_the_probe_row(self):
        row = ingest_mod._coerce_row(GOOD_ROW)
        found = ingest_mod.find_phase24_rows([row])
        assert found == [row]

    def test_no_phase_24_row_is_refused(self):
        row = ingest_mod._coerce_row(dict(GOOD_ROW, phase=10))
        with pytest.raises(ingest_mod.CaptureError, match="phase == 24"):
            ingest_mod.find_phase24_rows([row])


class TestConsistency:
    def test_a_single_row_needs_no_cross_check(self):
        row = ingest_mod._coerce_row(GOOD_ROW)
        ingest_mod.validate_consistency([row])  # must not raise

    def test_two_agreeing_rows_pass(self):
        row = ingest_mod._coerce_row(GOOD_ROW)
        row2 = ingest_mod._coerce_row(dict(GOOD_ROW, time=20260935))
        ingest_mod.validate_consistency([row, row2])  # must not raise

    def test_disagreeing_rows_are_refused_not_silently_averaged(self):
        row = ingest_mod._coerce_row(GOOD_ROW)
        drifted = ingest_mod._coerce_row(dict(GOOD_ROW, raw=999.0, time=20260935))
        with pytest.raises(ingest_mod.CaptureError, match="DISAGREE"):
            ingest_mod.validate_consistency([row, drifted])


class TestControlValues:
    def test_matching_controls_pass(self):
        row = ingest_mod._coerce_row(GOOD_ROW)
        ingest_mod.validate_control_values(row)  # must not raise

    def test_wrong_control_value_is_refused(self):
        row = ingest_mod._coerce_row(dict(GOOD_ROW, median_candLower=999.0))
        with pytest.raises(ingest_mod.CaptureError, match="median_candLower"):
            ingest_mod.validate_control_values(row)


class TestClassification:
    def test_matches_candidate_a_for_rising(self):
        row = ingest_mod._coerce_row(GOOD_ROW)
        func = next(f for f in ingest_mod.FUNCTIONS if f["key"] == "rising")
        result = ingest_mod.classify_builtin(func, row)
        assert result["outcome"] == "matches_one_candidate"
        assert result["matched_candidates"] == ["candidate_a_running_max"]

    def test_matches_candidate_b_when_reported_that_way(self):
        row = ingest_mod._coerce_row(dict(GOOD_ROW, rising_builtin=False))
        func = next(f for f in ingest_mod.FUNCTIONS if f["key"] == "rising")
        result = ingest_mod.classify_builtin(func, row)
        assert result["matched_candidates"] == ["candidate_b_monotone"]

    def test_matches_neither_is_a_real_finding_not_forced(self):
        # bbw builtin reported as neither the ratio nor the percent form.
        row = ingest_mod._coerce_row(dict(GOOD_ROW, bbw_builtin=42.0))
        func = next(f for f in ingest_mod.FUNCTIONS if f["key"] == "bbw")
        result = ingest_mod.classify_builtin(func, row)
        assert result["outcome"] == "matches_neither"
        assert result["matched_candidates"] == []

    def test_median_matches_lower_middle_candidate(self):
        row = ingest_mod._coerce_row(GOOD_ROW)
        func = next(f for f in ingest_mod.FUNCTIONS if f["key"] == "median_even_length")
        result = ingest_mod.classify_builtin(func, row)
        assert result["matched_candidates"] == ["candidate_lower_middle"]

    def test_percentrank_matches_over_L_candidate(self):
        row = ingest_mod._coerce_row(GOOD_ROW)
        func = next(f for f in ingest_mod.FUNCTIONS if f["key"] == "percentrank")
        result = ingest_mod.classify_builtin(func, row)
        assert result["matched_candidates"] == ["candidate_a_over_L"]


class TestObservationSchema:
    def test_built_observation_has_every_required_field(self):
        row = ingest_mod._coerce_row(GOOD_ROW)
        func = ingest_mod.FUNCTIONS[0]
        obs = ingest_mod.build_observation(
            func, row, when="2026-09-10", who="owner", symbol="AAPL",
            timeframe="1D", platform_version="Pine v5, web", capture_source="test",
        )
        for key in REQUIRED:
            assert key in obs
        for key in REQUIRED_PROVENANCE:
            assert obs["provenance"].get(key)

    def test_engine_ast_is_null_vendor_semantics_only(self):
        row = ingest_mod._coerce_row(GOOD_ROW)
        func = ingest_mod.FUNCTIONS[0]
        obs = ingest_mod.build_observation(
            func, row, when="2026-09-10", who="owner", symbol="AAPL",
            timeframe="1D", platform_version="Pine v5, web", capture_source="test",
        )
        assert obs["engine"]["ast"] is None
        assert obs["engine"]["formula"] is None

    def test_shape_is_stateless(self):
        row = ingest_mod._coerce_row(GOOD_ROW)
        func = ingest_mod.FUNCTIONS[0]
        obs = ingest_mod.build_observation(
            func, row, when="2026-09-10", who="owner", symbol="AAPL",
            timeframe="1D", platform_version="Pine v5, web", capture_source="test",
        )
        assert obs["shape"] == "stateless"

    def test_missing_ohlcv_writes_a_flagged_placeholder_not_a_fabrication(self):
        no_ohlcv = dict(GOOD_ROW)
        for k in ("open", "high", "low", "close", "volume", "time"):
            del no_ohlcv[k]
        row = ingest_mod._coerce_row(no_ohlcv)
        func = ingest_mod.FUNCTIONS[0]
        obs = ingest_mod.build_observation(
            func, row, when="2026-09-10", who="owner", symbol="AAPL",
            timeframe="1D", platform_version="Pine v5, web", capture_source="test",
        )
        assert obs["market"]["bars"][0]["o"] == 0.0
        assert "PLACEHOLDER" in obs["provenance"]["note"]

    def test_written_observation_passes_the_real_vendor_truth_loader(self, tmp_path):
        row = ingest_mod._coerce_row(GOOD_ROW)
        func = ingest_mod.FUNCTIONS[0]
        obs = ingest_mod.build_observation(
            func, row, when="2026-09-10", who="owner", symbol="AAPL",
            timeframe="1D", platform_version="Pine v5, web", capture_source="test",
        )
        ingest_mod.write_observation(obs, str(tmp_path), force=False)
        loaded = load_observations(obs_dir=str(tmp_path))
        assert len(loaded) == 1
        assert loaded[0]["engine"]["ast"] is None


class TestWriteObservation:
    def test_refuses_to_overwrite_without_force(self, tmp_path):
        row = ingest_mod._coerce_row(GOOD_ROW)
        func = ingest_mod.FUNCTIONS[0]
        obs = ingest_mod.build_observation(
            func, row, when="2026-09-10", who="owner", symbol="AAPL",
            timeframe="1D", platform_version="Pine v5, web", capture_source="test",
        )
        ingest_mod.write_observation(obs, str(tmp_path), force=False)
        with pytest.raises(ingest_mod.CaptureError, match="already exists"):
            ingest_mod.write_observation(obs, str(tmp_path), force=False)

    def test_force_overwrites_deliberately(self, tmp_path):
        row = ingest_mod._coerce_row(GOOD_ROW)
        func = ingest_mod.FUNCTIONS[0]
        obs = ingest_mod.build_observation(
            func, row, when="2026-09-10", who="owner", symbol="AAPL",
            timeframe="1D", platform_version="Pine v5, web", capture_source="test",
        )
        path1 = ingest_mod.write_observation(obs, str(tmp_path), force=False)
        path2 = ingest_mod.write_observation(obs, str(tmp_path), force=True)
        assert path1 == path2


class TestEndToEndIngest:
    def test_dry_run_writes_nothing(self, tmp_path):
        csv_path = _write_csv(tmp_path, [GOOD_ROW])
        obs_dir = str(tmp_path / "observations")
        report = ingest_mod.ingest(
            csv_path, when="2026-09-10", who="owner", symbol="AAPL", timeframe="1D",
            platform_version="Pine v5, web", obs_dir=obs_dir, force=False, dry_run=True,
        )
        assert not os.path.isdir(obs_dir)
        assert len(report["classifications"]) == 4

    def test_real_run_writes_four_observations_and_they_all_validate(self, tmp_path):
        csv_path = _write_csv(tmp_path, [GOOD_ROW])
        obs_dir = str(tmp_path / "observations")
        report = ingest_mod.ingest(
            csv_path, when="2026-09-10", who="owner", symbol="AAPL", timeframe="1D",
            platform_version="Pine v5, web", obs_dir=obs_dir, force=False, dry_run=False,
        )
        assert len(report["written"]) == 4
        loaded = load_observations(obs_dir=obs_dir)
        assert len(loaded) == 4
        assert all(o["engine"]["ast"] is None for o in loaded)

    def test_multiple_agreeing_phase24_rows_across_full_history_still_ingest(self, tmp_path):
        rows = [dict(GOOD_ROW, time=20260910 + 25 * i) for i in range(3)]
        csv_path = _write_csv(tmp_path, rows)
        obs_dir = str(tmp_path / "observations")
        report = ingest_mod.ingest(
            csv_path, when="2026-09-10", who="owner", symbol="AAPL", timeframe="1D",
            platform_version="Pine v5, web", obs_dir=obs_dir, force=False, dry_run=False,
        )
        assert report["phase24_rows_found"] == 3
        assert len(report["written"]) == 4

    def test_inconsistent_history_aborts_before_writing_anything(self, tmp_path):
        rows = [GOOD_ROW, dict(GOOD_ROW, raw=999.0, time=20260935)]
        csv_path = _write_csv(tmp_path, rows)
        obs_dir = str(tmp_path / "observations")
        with pytest.raises(ingest_mod.CaptureError, match="DISAGREE"):
            ingest_mod.ingest(
                csv_path, when="2026-09-10", who="owner", symbol="AAPL", timeframe="1D",
                platform_version="Pine v5, web", obs_dir=obs_dir, force=False, dry_run=False,
            )
        assert not os.path.isdir(obs_dir)

    def test_untrustworthy_controls_abort_before_writing_anything(self, tmp_path):
        bad = dict(GOOD_ROW, bbw_candRatio=42.0)
        csv_path = _write_csv(tmp_path, [bad])
        obs_dir = str(tmp_path / "observations")
        with pytest.raises(ingest_mod.CaptureError):
            ingest_mod.ingest(
                csv_path, when="2026-09-10", who="owner", symbol="AAPL", timeframe="1D",
                platform_version="Pine v5, web", obs_dir=obs_dir, force=False, dry_run=False,
            )
        assert not os.path.isdir(obs_dir)


class TestCLI:
    def test_main_dry_run_exits_zero(self, tmp_path, capsys):
        csv_path = _write_csv(tmp_path, [GOOD_ROW])
        code = ingest_mod.main(["--csv", csv_path, "--when", "2026-09-10", "--dry-run"])
        assert code == 0
        out = capsys.readouterr().out
        assert "TRACK A VENDOR CAPTURE INGESTION REPORT" in out
        assert "VENDOR SEMANTICS CAPTURED" in out

    def test_main_refuses_loudly_on_bad_capture(self, tmp_path, capsys):
        bad = dict(GOOD_ROW, median_candLower=999.0)
        csv_path = _write_csv(tmp_path, [bad])
        code = ingest_mod.main(["--csv", csv_path, "--when", "2026-09-10", "--dry-run"])
        assert code == 1
        err = capsys.readouterr().err
        assert "REFUSED" in err
