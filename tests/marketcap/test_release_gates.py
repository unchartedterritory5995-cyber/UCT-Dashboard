"""Market Cap V1 automated release gates: an all-pass synthetic suite passes, and each gate fails ALONE when its own
predicate is violated (no gate can be satisfied by another's evidence)."""
from __future__ import annotations

import json
import os
import sqlite3

import pytest

from api.services.marketcap import gates as G

BID = "MCAP_V1-20261003T050000Z"


def suite(tmp_path):
    b = str(tmp_path / f"{BID}.db")
    db = sqlite3.connect(b)
    db.executescript("""
    CREATE TABLE manifest(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE state_run(issuer_id TEXT, class_key TEXT, start TEXT, end TEXT, shares REAL, obs_accession TEXT, as_of TEXT, source_type TEXT);
    CREATE TABLE observation(issuer_id TEXT, class_key TEXT, as_of TEXT, accession TEXT, validation_status TEXT);
    CREATE TABLE regime(issuer_id TEXT, start TEXT, end TEXT, classes TEXT, kind TEXT, reason TEXT, note TEXT, components TEXT);
    CREATE TABLE cap_daily(cik INTEGER, d INTEGER, cap REAL, PRIMARY KEY(cik, d));
    """)
    db.executemany("INSERT INTO manifest VALUES (?,?)", [("build_id", BID), ("code_commit", "x")])
    db.execute("INSERT INTO state_run VALUES ('cik:1','COMMON','2026-01-01','2026-12-31',1e6,'A1','2025-12-31','COVER_XBRL')")
    db.execute("INSERT INTO observation VALUES ('cik:1','COMMON','2025-12-31','A1','ACCEPTED')")
    db.execute("INSERT INTO regime VALUES ('cik:2','2026-01-01','2026-12-31','[]','UNRESOLVED','MULTI_CLASS_UNRESOLVED',NULL,'[]')")
    db.execute("INSERT INTO cap_daily VALUES (1, 20260102, 1e7)")
    db.commit()
    db.close()
    r = tmp_path / "reports"
    (r / "adjudication").mkdir(parents=True)
    (r / "cap_steps").mkdir()
    zero = {"count": 0}
    J = {
        "final_checks.json": {"unexplained_days": 0, "bug_reason_days": 0, "bug_issuers": [], "lookahead_state_runs_before_known_from": 0,
                              "observations_known_before_public": 0, "invalid_unit_used": 0, "other_member_classes_in_state": 0,
                              "duplicate_cap_days": 0, "gap_runs_overlapping_values": 0, "state_runs_inverted": 0},
        "universe_audit.json": {"build": BID, "unexplained": {"v1_unexplained_sessions": 0},
                                "anomalies": {"L_known_before_public": zero, "M_lookahead_state_before_known": zero,
                                              "F_v1_cap_before_listing": zero, "G_multi_class_same_price_ticker": zero}},
        "magnitude_scan.json": {"outliers": [{"ticker": "OLD", "class": "OLD_LAST_VALUE"}], "by_class": {"OLD_LAST_VALUE": 1}},
        "history_adjudication.json": {"per_security": {"XYZ": [{"start": 20200101, "end": 20200301, "verdict": "UNDECIDED"}],
                                                       "ABC": [{"start": 20200101, "end": 20200301, "verdict": "PRODUCTION_JUMPS"}]}},
        "arm_before_after.json": {"legit_sessions": 763, "v1_valued_legit": 763, "v1_before_listing": 0, "v1_missing_legit": [],
                                  "max_rel_diff_where_both": 0.007},
        "adjudication/adjudication_summary.json": {"split_cases": {"total": 2, "unverified": []},
                                                   "hist_cases": {"unverified": [], "unknown_but_valued": []}},
        "adjudication/hist_cases.json": [{"ticker": "XYZ", "interval": [20190101, 20201231], "disposition": "PROVEN_CORRECT"}],
        "cap_steps/cap_step_summary.json": {"build": b, "original_cohort": {"by_disposition": {"PROVEN_CORRECT": 1}},
                                            "day_to_day_scan": {"unknown_but_valued": 0, "unexplained_by_price_served": 3},
                                            "gate_N_build_validator_parity": {"semantics": G.M.EXTREME_STEP_SEMANTICS, "pass": True,
                                                                              "disagreements": 0}},
        "scan2.json": {"findings": [{"kind": "ONE_OFF_PARSED", "ticker": "PPBT", "status": "UNEXPLAINED",
                                     "run": ["COMMON", "a", "b", 1, "0001-26-1"]}]},
        "second_order_adjudication.json": {"residual_unexplained_findings": [
            {"kind": "ONE_OFF_PARSED", "ticker": "PPBT", "disposition": "PROVEN_CORRECT", "evidence": "F-3 0001-26-1: ..."}],
            "known_wrong_discovered_and_still_served": 0},
        "identity_delta.json": {"pass": True, "reference": {"build_id": "MCAP_V1-20261003T140306Z"},
                                "observations": {"removed_by_class": {"EVIDENCE_HOLD": 3}}, "failing_blocks": [],
                                "issuers": {"removed_unexplained": []}},
    }
    for n, v in J.items():
        json.dump(v, open(r / n, "w"))
    return b, str(r)


def edit(reports, name, fn):
    p = os.path.join(reports, name)
    j = json.load(open(p))
    fn(j)
    json.dump(j, open(p, "w"))


def test_all_pass(tmp_path, monkeypatch):
    monkeypatch.setattr(G.M, "drift", lambda: {})
    b, r = suite(tmp_path)
    v = G.evaluate(b, r)
    assert v["status"] == "PASS", v["failed"]


MUTATIONS = {
    "A": ("universe_audit.json", lambda j: j["unexplained"].update(v1_unexplained_sessions=3)),
    "B": ("magnitude_scan.json", lambda j: j["outliers"].append({"ticker": "NEW", "class": "RECENT_V1_INTRODUCED"})),
    "C": ("history_adjudication.json", lambda j: j["per_security"]["XYZ"].append({"start": 20210101, "end": 20210301,
                                                                                    "verdict": "UNDECIDED"})),
    "D": ("final_checks.json", lambda j: j.update(observations_known_before_public=1)),
    "E": ("universe_audit.json", lambda j: j["anomalies"]["F_v1_cap_before_listing"].update(count=2)),
    "F": ("arm_before_after.json", lambda j: j.update(v1_valued_legit=762)),
    "G": ("adjudication/adjudication_summary.json", lambda j: j["split_cases"]["unverified"].append("X")),
    "H": ("final_checks.json", lambda j: j.update(invalid_unit_used=1)),
    "K": ("adjudication/adjudication_summary.json", lambda j: j["hist_cases"]["unknown_but_valued"].append("Y")),
    "L": ("cap_steps/cap_step_summary.json", lambda j: j["day_to_day_scan"].update(unknown_but_valued=1)),
    "M": ("scan2.json", lambda j: j["findings"].append({"kind": "STEP_10X", "ticker": "NEW", "status": "UNEXPLAINED",
                                                         "run": [None, None, None, None, "0002-26-9"]})),
    "N": ("cap_steps/cap_step_summary.json", lambda j: j["gate_N_build_validator_parity"].update(pass_=False, **{"pass": False})),
    "R": ("identity_delta.json", lambda j: j.update(**{"pass": False, "failing_blocks": [
        {"cik": 801337, "ticker": "WBS", "start": 20220228, "end": 20260820, "n_days": 1124, "class": "UNEXPLAINED"}]})),
}


def test_R_fails_when_the_retention_report_is_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(G.M, "drift", lambda: {})
    b, r = suite(tmp_path)
    os.remove(os.path.join(r, "identity_delta.json"))
    v = G.evaluate(b, r)
    assert v["failed"] == ["R"] and "missing" in v["gates"]["R"]["value"]["error"]


@pytest.mark.parametrize("gate", sorted(MUTATIONS))
def test_each_gate_fails_on_its_own_predicate(tmp_path, monkeypatch, gate):
    monkeypatch.setattr(G.M, "drift", lambda: {})
    b, r = suite(tmp_path)
    name, fn = MUTATIONS[gate]
    edit(r, name, fn)
    v = G.evaluate(b, r)
    assert v["status"] == "FAIL" and gate in v["failed"]


def test_I_J_backing_from_the_build_db(tmp_path, monkeypatch):
    monkeypatch.setattr(G.M, "drift", lambda: {})
    b, r = suite(tmp_path)
    db = sqlite3.connect(b)
    db.execute("INSERT INTO state_run VALUES ('cik:3','COMMON','2026-01-01','2026-12-31',1e6,'A3','2025-12-31','COVER_XBRL')")
    db.execute("INSERT INTO observation VALUES ('cik:3','COMMON','2025-12-31','A3','REJECTED_ADR_RATIO_UNRESOLVED')")
    db.execute("INSERT INTO cap_daily VALUES (2, 20260105, 1e7)")              # a valued day inside cik 2's UNRESOLVED regime
    db.commit()
    db.close()
    v = G.evaluate(b, r)
    assert {"I", "J", "BACKING"} <= set(v["failed"])


def test_methodology_drift_fails(tmp_path, monkeypatch):
    monkeypatch.setattr(G.M, "drift", lambda: {"build.py": "x"})
    b, r = suite(tmp_path)
    assert "METHODOLOGY" in G.evaluate(b, r)["failed"]


def test_suite_for_another_build_fails_integrity(tmp_path, monkeypatch):
    monkeypatch.setattr(G.M, "drift", lambda: {})
    b, r = suite(tmp_path)
    edit(r, "universe_audit.json", lambda j: j.update(build="MCAP_V1-20200101T000000Z"))
    assert "INTEGRITY" in G.evaluate(b, r)["failed"]


def test_pinned_methodology_matches_this_tree():
    assert G.M.drift() == {}, "methodology files changed: a V1 release cannot be built from this tree"
