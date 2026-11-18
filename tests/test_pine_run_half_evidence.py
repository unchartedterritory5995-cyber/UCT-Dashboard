"""RS RATING L8 -- the run half's object evidence, served from the SAME committed allowlist records.

`runtime_definitions.run_half_evidence` reports, for every SERVED allowlist record, its captures
that carry an `objectsV2` grade; `GET /api/user-definitions/runtime-kill` serves them as
`run_half_evidence` (ABSENT when empty); the member door latches them into
`engine/runHalfRailSeam.js::setRunHalfObjectEvidence`, which alone decides admission (2 distinct
captures, each MATCH, objects-v2 MATCH, runtime pane on; railed in
app/src/components/chart/engine/runHalfEvidenceLatch.test.js). Here:
  E1 by default nothing is served and the kill read keeps exactly its keys;
  E2 a served record's objects-v2 captures are passed on as the facts they record;
  E3 a withheld record, a prefix sha, a record with no objects-v2 capture contribute nothing;
  E4 every committed objects-v2 claim is a real runtime-on grade (with a control that can fail);
  E5 (L9) the L7 substituted path: a substituted record's MATCH_SUBSTITUTED captures count only when
     their own names equal the record's; a record without `admission` never counts them; < 2 never;
  E6 (L9) the server rule answers every case of tests/fixtures/ast/run_half_evidence_parity.json,
     which the client rule (runHalfEvidenceLatch.test.js) answers too.
"""
from __future__ import annotations

import json
import pathlib

import pytest

from api.services import runtime_definitions as rt

REPO = pathlib.Path(__file__).resolve().parents[1]
VERDICTS = REPO / "docs" / "pine" / "vendor-harness" / "runtime-on" / "verdicts.json"
REG = {"a": {"status": "conformant", "evidence": ["cap-1"]}}


def _cap(cid, verdict="MATCH", v2="MATCH", pane="on"):
    c = {"id": cid, "verdict": verdict, "runtimePane": pane}
    if v2 is not None:
        c["objectsV2"] = v2
    return c


def _allowlist(tmp_path, monkeypatch, scripts):
    f = tmp_path / "allow.json"
    f.write_text(json.dumps({"_readme": [], "scripts": scripts, "capabilities": REG}), encoding="utf-8")
    monkeypatch.setattr(rt, "ALLOWLIST_PATH", str(f))


def _kill_read():
    from api.routers import user_definitions as router
    return router.runtime_kill(user={"id": "u1"})


# ── E1 ───────────────────────────────────────────────────────────────────────────────

def test_E1_by_default_nothing_is_served_and_the_kill_read_keeps_its_keys(tmp_path, monkeypatch):
    """A list whose records carry no objects-v2 capture serves no evidence, and the key is ABSENT."""
    monkeypatch.delenv("PINE_RUNTIME_CAPABILITY_ADMISSION", raising=False)
    _allowlist(tmp_path, monkeypatch, [{"slug": "plain", "sha256": "d" * 64, "capabilities": ["a"], "captures": [
        _cap("p-rddt", v2=None), _cap("p-spy", v2=None)]}])
    assert rt.run_half_evidence() == []
    got = _kill_read()
    assert "run_half_evidence" not in got
    assert set(got) <= {"kill", "allow", "save_enabled", "capability_admission", "substituted"}


RS_SHA = "caa94fe31a8788c0f52ca571dbb1b3f8a7499dae913ed5e710720fc8662c5af0"
RS_RECAPTURES = [f"rs-rating-fred6724-{s}-1d-2026-11-16" for s in ("rddt", "alab", "crwv")]
# SETTINGS PARITY (2c): RS Rating taken with settings moved (set A / set B / set C: the colours), graded
# at those settings
RS_SETTINGS = [f"rs-rating-fred6724-{v}-{s}-1d-2026-11-16" for v in ("seta", "setb", "setc", "setd", "sete2") for s in ("rddt", "alab")]


def test_E1b_the_committed_list_serves_RS_Ratings_run_half_evidence_and_only_that():
    """Q-RS8 (2026-11-16). ⚰️ History: #1410 merged RS Rating's record claiming objects v2
    MATCH_SUBSTITUTED on three captures that record no x table; master's harness graded them
    INCONCLUSIVE and #1413 withdrew the claim. The three captures were then RE-TAKEN with the tool
    that records the x table and graded on master b7cd7a0e63: objects v2 MATCH_SUBSTITUTED with x
    witnessed (2 of 2, exact bar) on each. So the committed list now serves evidence for exactly
    that script and exactly those three captures, and the rule admits its run half.
    ⛔ A record's capture fields are copied only from a grade taken on the tree being merged
    (E4 checks every claim against the committed runtime-on verdicts)."""
    doc = json.loads(pathlib.Path(rt.ALLOWLIST_PATH).read_text(encoding="utf-8"))
    rs = next(s for s in doc["scripts"] if s["slug"] == "rs-rating-fred6724")
    assert rs["sha256"] == RS_SHA
    assert [c["id"] for c in rs["captures"]] == RS_RECAPTURES + RS_SETTINGS
    assert [c["objectsV2"] for c in rs["captures"]] == ["MATCH_SUBSTITUTED"] * 13
    assert all(c["objectsV2Substituted"] == ["syminfo.industry"] == c["substituted"] for c in rs["captures"])
    # the three defaults captures carry no moved setting; each settings capture names its own
    assert [bool(c.get("inputs")) for c in rs["captures"]] == [False] * 3 + [True] * 10
    ev = rt.run_half_evidence()
    assert [e["sha256"] for e in ev] == [RS_SHA], "exactly this script, and no other record"
    assert [c["capture"] for c in ev[0]["captures"]] == RS_RECAPTURES + RS_SETTINGS
    assert rt.run_half_entry_admits(ev[0]) is True
    # ⭐ SETTINGS PARITY (2c): each set's settings are admitted on its two captures (RDDT + ALAB); the line
    # colour (the rating label's text colour) is admitted by set C; a setting no capture moved is not
    # (the MA 2 colour: set through the study API, TradingView's live palette never took it)
    for cap in ev[0]["captures"][3:]:
        assert rt.run_half_settings_admits(ev[0], list(cap["inputs"])) == (True, []), cap["capture"]
    assert rt.run_half_settings_admits(ev[0], ["colorRS"]) == (True, [])
    # the comparison symbol (set D, AMEX:SPY): the label sits on the RS line, which reads it
    assert rt.run_half_settings_admits(ev[0], ["lineTicker"]) == (True, [])
    # the see-through dot colours (set E2): the new-high and new-low dots are drawn in them
    assert rt.run_half_settings_admits(ev[0], ["blueDotCol", "redDotCol"]) == (True, [])
    assert rt.run_half_settings_admits(ev[0], ["colMa2"]) == (False, ["colMa2"])
    rows_all = {r["id"]: r for r in json.loads(VERDICTS.read_text(encoding="utf-8"))["results"]}
    for cid in RS_SETTINGS:
        assert rows_all[cid]["verdict"] == "MATCH_SUBSTITUTED", cid
        assert rows_all[cid]["objectsV2"]["verdict"] == "MATCH_SUBSTITUTED", cid
    assert _kill_read()["run_half_evidence"] == ev
    # every one of the three is a real runtime-on grade with x witnessed
    rows = {r["id"]: r for r in json.loads(VERDICTS.read_text(encoding="utf-8"))["results"]}
    for cid in RS_RECAPTURES:
        v2 = rows[cid]["objectsV2"]
        assert rows[cid]["verdict"] == "MATCH_SUBSTITUTED" and v2["verdict"] == "MATCH_SUBSTITUTED", cid
        assert v2["x"]["graded"] == 2 and v2["x"]["agreeing"] == 2 and v2["x"]["differing"] == 0, cid


def test_E1c_a_capture_without_an_x_table_still_admits_nothing(tmp_path, monkeypatch):
    """CONTROL, on one of the 2026-11-15 captures (still committed, as history): it records no x
    table, master grades its objects v2 INCONCLUSIVE, and a record built on such captures serves
    nothing and admits nothing. This is the state #1413 restored; it must stay refusable."""
    rows = {r["id"]: r for r in json.loads(VERDICTS.read_text(encoding="utf-8"))["results"]}
    old = [f"rs-rating-fred6724-{s}-1d-2026-11-15" for s in ("rddt", "alab", "crwv")]
    for cid in old:
        assert rows[cid]["verdict"] == "MATCH_SUBSTITUTED", cid
        assert rows[cid]["objectsV2"]["verdict"] == "INCONCLUSIVE", cid
    doc = json.loads(pathlib.Path(rt.ALLOWLIST_PATH).read_text(encoding="utf-8"))
    rs = json.loads(json.dumps(next(s for s in doc["scripts"] if s["slug"] == "rs-rating-fred6724")))
    rs["captures"] = [{"id": cid, "verdict": "MATCH_SUBSTITUTED", "runtimePane": "on",
                       "substituted": ["syminfo.industry"], "objectsV2": "INCONCLUSIVE"} for cid in old]
    f = tmp_path / "allow.json"
    f.write_text(json.dumps({**doc, "scripts": [rs]}), encoding="utf-8")
    monkeypatch.setattr(rt, "ALLOWLIST_PATH", str(f))
    assert rt.run_half_evidence() == []
    assert "run_half_evidence" not in _kill_read()
    # and a record that CLAIMED the grade for them is caught by E4's check, by name
    rs["captures"] = [{**c, "objectsV2": "MATCH_SUBSTITUTED", "objectsV2Substituted": ["syminfo.industry"]}
                      for c in rs["captures"]]
    assert _false_claims([rs], list(rows.values())), "an objects-v2 claim on a capture graded INCONCLUSIVE is a false claim"


# ── E2 ───────────────────────────────────────────────────────────────────────────────

def test_E2_a_served_records_objects_v2_captures_are_passed_on_as_recorded(tmp_path, monkeypatch):
    sha = "c" * 64
    _allowlist(tmp_path, monkeypatch, [{"slug": "rs", "sha256": sha, "capabilities": ["a"], "captures": [
        _cap("x-rddt"), _cap("x-nvda"), _cap("x-spy", v2="DIVERGE"), _cap("x-old", v2=None)]}])
    ev = rt.run_half_evidence()
    assert ev == [{"sha256": sha, "captures": [
        {"capture": "x-rddt", "verdict": "MATCH", "objectsV2": True, "runtimeOn": True},
        {"capture": "x-nvda", "verdict": "MATCH", "objectsV2": True, "runtimeOn": True},
        {"capture": "x-spy", "verdict": "MATCH", "objectsV2": False, "runtimeOn": True},
    ]}]
    assert _kill_read()["run_half_evidence"] == ev


# ── E3 ───────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("record", [
    # withheld: no MATCH capture with the pane on (R1)
    {"slug": "w1", "sha256": "d" * 64, "capabilities": ["a"], "captures": [_cap("y", pane="off")]},
    # withheld: a capability not in the registry
    {"slug": "w2", "sha256": "d" * 64, "capabilities": ["zz"], "captures": [_cap("y")]},
    # a sha256 PREFIX admits on the allowlist but names no one script's evidence
    {"slug": "w3", "sha256": "d" * 20, "capabilities": ["a"], "captures": [_cap("y")]},
    # served, but no capture carries an objects-v2 grade
    {"slug": "w4", "sha256": "d" * 64, "capabilities": ["a"], "captures": [_cap("y", v2=None)]},
])
def test_E3_records_that_contribute_nothing(tmp_path, monkeypatch, record):
    _allowlist(tmp_path, monkeypatch, [record])
    assert rt.run_half_evidence() == []
    assert "run_half_evidence" not in _kill_read()


def test_E3_an_unreadable_allowlist_serves_no_evidence(tmp_path, monkeypatch):
    monkeypatch.setattr(rt, "ALLOWLIST_PATH", str(tmp_path / "missing.json"))
    assert rt.run_half_evidence() == []


# ── E4 ───────────────────────────────────────────────────────────────────────────────

def _false_claims(scripts, results):
    by_id = {r.get("id"): r for r in results}
    bad = []
    for s in scripts:
        for c in s.get("captures") or []:
            if not isinstance(c, dict) or "objectsV2" not in c:
                continue
            r = by_id.get(c.get("id"))
            if r is None:
                bad.append(f"{s.get('slug')}: {c.get('id')} is not in the runtime-on verdicts")
                continue
            if c.get("verdict") != r.get("verdict"):
                bad.append(f"{s.get('slug')}: {c.get('id')} says {c.get('verdict')}, graded {r.get('verdict')}")
            v2 = (r.get("objectsV2") or {}).get("verdict")
            if c.get("objectsV2") != v2:
                bad.append(f"{s.get('slug')}: {c.get('id')} says objectsV2 {c.get('objectsV2')}, graded {v2}")
    return bad


def test_E4_every_committed_objects_v2_claim_is_a_real_runtime_on_grade():
    doc = json.loads(pathlib.Path(rt.ALLOWLIST_PATH).read_text(encoding="utf-8"))
    results = json.loads(VERDICTS.read_text(encoding="utf-8"))["results"]
    assert _false_claims(doc["scripts"], results) == []
    # CONTROL: a claim the verdicts do not support is caught, by name
    real = next(r for r in results if r.get("verdict") == "DIVERGE")
    fake = [{"slug": "fake", "captures": [_cap(real["id"]), _cap("no-such-capture")]}]
    got = _false_claims(fake, results)
    assert any("says MATCH, graded DIVERGE" in g for g in got) and any("not in the runtime-on verdicts" in g for g in got)


# ── E5 (RS RATING L9) ── the L7 substituted path, never a looser rule ─────────────────────
# A record with `admission: "substituted"` and `substituted: [names]` counts captures graded
# MATCH_SUBSTITUTED (objects-v2 MATCH, runtime pane on) whose OWN names equal the record's; a
# record without `admission` still counts MATCH only. The server serves only entries the rule
# admits; the client re-applies the same rule on what it receives. Both read
# tests/fixtures/ast/run_half_evidence_parity.json, so the two cannot drift.

NAMES = ["syminfo.industry"]
PARITY = json.loads((REPO / "tests" / "fixtures" / "ast" / "run_half_evidence_parity.json")
                    .read_text(encoding="utf-8"))


def _sub(cid, names=NAMES, verdict="MATCH_SUBSTITUTED", v2="MATCH", pane="on"):
    c = _cap(cid, verdict=verdict, v2=v2, pane=pane)
    if names is not None:
        c["substituted"] = list(names)
    return c


def _sub_record(captures, names=NAMES):
    return {"slug": "rs", "sha256": "e" * 64, "capabilities": ["a"], "admission": "substituted",
            "substituted": list(names), "captures": captures}


def test_E5_control_substituted_record_is_served_with_what_the_client_needs(tmp_path, monkeypatch):
    _allowlist(tmp_path, monkeypatch, [_sub_record([_sub("x-rddt"), _sub("x-nvda")])])
    ev = rt.run_half_evidence()
    assert ev == [{"sha256": "e" * 64, "admission": "substituted", "substituted": NAMES, "captures": [
        {"capture": "x-rddt", "verdict": "MATCH_SUBSTITUTED", "objectsV2": True, "runtimeOn": True,
         "substituted": NAMES},
        {"capture": "x-nvda", "verdict": "MATCH_SUBSTITUTED", "objectsV2": True, "runtimeOn": True,
         "substituted": NAMES},
    ]}]
    assert _kill_read()["run_half_evidence"] == ev


def test_E5_substituted_captures_on_a_record_without_admission_are_not_evidence(tmp_path, monkeypatch):
    # served on R1 by its MATCH capture (no objects-v2 grade); its two objects-v2 captures are
    # MATCH_SUBSTITUTED, which the plain path never counts
    rec = {"slug": "rs", "sha256": "e" * 64, "capabilities": ["a"],
           "captures": [_cap("x-served", v2=None), _sub("x-rddt"), _sub("x-nvda")]}
    _allowlist(tmp_path, monkeypatch, [rec])
    assert rt.allow_report(with_capabilities=False)["served"], "the record itself is served"
    assert rt.run_half_evidence() == []


def test_E5_captures_naming_other_inputs_are_not_evidence(tmp_path, monkeypatch):
    rec = _sub_record([_sub("x-served", v2=None),                       # serves the record (R1/L7)
                       _sub("x-rddt", names=["syminfo.sector"]),
                       _sub("x-nvda", names=["syminfo.industry", "syminfo.sector"])])
    _allowlist(tmp_path, monkeypatch, [rec])
    assert rt.allow_report(with_capabilities=False)["served"], "the record itself is served"
    assert rt.run_half_evidence() == []


def test_E5_fewer_than_two_distinct_substituted_captures_are_not_evidence(tmp_path, monkeypatch):
    for caps in ([_sub("x-rddt")], [_sub("x-rddt"), _sub("x-rddt")]):
        _allowlist(tmp_path, monkeypatch, [_sub_record(caps)])
        assert rt.run_half_evidence() == [], caps


# ── E6 ── the parity cases, server side ────────────────────────────────────────────────────

def test_E6_the_server_rule_answers_every_parity_case():
    assert PARITY["min_captures"] == rt.RUN_HALF_EVIDENCE_MIN_CAPTURES
    wrong = [c["name"] for c in PARITY["cases"] if rt.run_half_entry_admits(c["entry"]) is not c["admits"]]
    assert wrong == []
    assert any(c["admits"] for c in PARITY["cases"]) and any(not c["admits"] for c in PARITY["cases"])


# ── E7 (L9b) ── on the substituted path, objects-v2 may itself grade MATCH_SUBSTITUTED ─────────
# Coordinator ruling 2026-11-15 (after owner ruling (a)): a substituted run's drawings grade
# MATCH_SUBSTITUTED, never MATCH, so on a substituted record the objects-v2 grade may be
# MATCH_SUBSTITUTED when its own names (`objectsV2Substituted`) are exactly the record's.

def _sub_v2(cid, v2_names=NAMES):
    c = _sub(cid, v2="MATCH_SUBSTITUTED")
    if v2_names is not None:
        c["objectsV2Substituted"] = list(v2_names)
    return c


def test_E7_control_substituted_objects_v2_is_served_and_admits(tmp_path, monkeypatch):
    _allowlist(tmp_path, monkeypatch, [_sub_record([_sub_v2("x-rddt"), _sub_v2("x-nvda")])])
    ev = rt.run_half_evidence()
    assert [c["objectsV2Substituted"] for c in ev[0]["captures"]] == [NAMES, NAMES]
    assert [c["objectsV2"] for c in ev[0]["captures"]] == [False, False]
    assert _kill_read()["run_half_evidence"] == ev


def test_E7_substituted_objects_v2_naming_other_inputs_or_none_is_not_evidence(tmp_path, monkeypatch):
    for v2_names in (["syminfo.sector"], [], None):
        _allowlist(tmp_path, monkeypatch, [_sub_record([_sub_v2("x-rddt"), _sub_v2("x-nvda", v2_names)])])
        assert rt.run_half_evidence() == [], v2_names


def test_E7_substituted_objects_v2_never_counts_on_a_plain_record(tmp_path, monkeypatch):
    rec = {"slug": "rs", "sha256": "e" * 64, "capabilities": ["a"], "captures": [
        _cap("x-rddt", v2="MATCH_SUBSTITUTED"), _cap("x-nvda", v2="MATCH_SUBSTITUTED")]}
    for c in rec["captures"]:
        c["objectsV2Substituted"] = list(NAMES)
    _allowlist(tmp_path, monkeypatch, [rec])
    assert rt.allow_report(with_capabilities=False)["served"], "the record itself is served"
    assert rt.run_half_evidence() == []


# ── E8 (settings parity 2c) ── a run half at a member's settings, admitted per moved setting ─────
def test_E8_the_server_settings_rule_answers_every_parity_case():
    cases = PARITY["settings_cases"]
    wrong = [c["name"] for c in cases
             if list(rt.run_half_settings_admits(c["entry"], c["moved"])) != [c["ok"], c["missing"]]]
    assert wrong == []
    assert any(c["ok"] for c in cases) and any(not c["ok"] for c in cases)
