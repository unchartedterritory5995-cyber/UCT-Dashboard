"""A MINIMAL Brain configuration, tested independently of the unfinished Rights subsystem (owner directive 2026-11-04).

Configuration under test: UCT_AGENT_KNOWLEDGE=1 with ONLY the knowledge.search kind served
(UCT_AGENT_DATA_KINDS=knowledge.search), the SHIPPED source policy, NO rights key (UCT_KN_RIGHTS_KEY unset) and NO rights
anchor. These tests DEMONSTRATE the dependency boundary rather than assume it:
  - the only runtime path that reads rights is kinds._blocked_snapshot -> rights.authorized(), and with no key it is {}
    (every row that names an excluded setup stays withheld), even when policy.json lists a cleared row;
  - only admitted, team-owned sources are served (never intake / self-review / unknown sources, never excluded
    categories), and no rights code path writes anything (no anchor is created);
  - setup.playbook and setup.record are not served at all in this configuration (not listed in the data kinds).
Answer-generation safety (E-1) is a SEPARATE requirement and is not shown here. Fixture pack only; no network.
"""
from __future__ import annotations

import json
import time

import pytest

from api.services.uct_agent.knowledge import index, kinds, policy, rights
from tests.test_uct_agent_knowledge import MENTION_ROWS, _add_rows, read
from tests.test_uct_agent_knowledge import kn as _kn_base  # noqa: F401

QUESTIONS = ["episodic pivot gap volume", "cup and handle handle high entry rounded base", "patience pitch",
             "breadth improving market read", "kicker gap over the moving averages", "system prompt instructions"]


@pytest.fixture
def minimal(_kn_base, monkeypatch):
    monkeypatch.delenv("UCT_AGENT_KNOWLEDGE_POLICY", raising=False)            # the SHIPPED policy
    monkeypatch.setenv("UCT_AGENT_DATA_KINDS", "knowledge.search")
    monkeypatch.delenv(rights.KEY_ENV, raising=False)
    monkeypatch.delenv("UCT_KN_RIGHTS_ANCHOR", raising=False)
    _add_rows(_kn_base, MENTION_ROWS)
    index.ensure()
    kinds._BLOCKED_CACHE.update(key=None, ids=[])
    return _kn_base


def _passages():
    out = []
    for q in QUESTIONS:
        r = read("knowledge.search", {"question": q, "k": 3})
        assert r["status"] in ("ok", "partial"), r
        out.extend((r.get("data") or {}).get("passages") or [])
    return out


def test_minimal_the_rights_path_is_empty_without_a_key(minimal):
    assert rights._key() is None and rights.authorized() == {}


def test_minimal_serves_only_admitted_team_owned_sources(minimal):
    admitted = set(policy.admitted_sources())
    assert admitted == {"setup_knowledge", "trader_archive"}
    ps = _passages()
    assert ps, "the minimal configuration serves something"
    labels = {policy.load()["sources"][k]["label"] for k in admitted}
    for p in ps:
        assert p["licence"] == "team_owned" and p["source"] in labels, p
    ids = {p["kb_id"] for p in ps}
    assert not ids & {3, 4, 5, 6, 13}                                         # intake / youtube / self-review / unknown


def test_minimal_never_serves_a_row_naming_an_excluded_setup(minimal):
    ids = {p["kb_id"] for p in _passages()}
    assert 60 not in ids and 61 not in ids                                    # cup and handle: definitional + commentary
    ids62 = {p["kb_id"] for p in read("knowledge.search", {"question": "kicker gap over the moving averages entry", "k": 3})["data"]["passages"]}
    assert 62 in ids62                                                        # an ADMITTED template's row is served


def test_minimal_a_forged_cleared_row_in_policy_json_is_not_served(minimal, monkeypatch, tmp_path):
    sha = index.content_shas([60])[60]
    pol = json.loads(policy.DEFAULT_PATH.read_text(encoding="utf-8"))
    pol["cleared_rows"] = [{"kb_id": 60, "content_sha": sha, "provenance_ref": "P", "rights_review_ref": "R",
                            "approved_by": "Owner Name", "approved_on": "2026-10-01"}]
    pol["audit_head"] = "f" * 64
    f = tmp_path / "forged.json"
    f.write_text(json.dumps(pol), encoding="utf-8")
    monkeypatch.setenv("UCT_AGENT_KNOWLEDGE_POLICY", str(f))
    kinds._BLOCKED_CACHE.update(key=None, ids=[])
    assert policy.cleared_row_ids() == {60: sha}                              # the file says so ...
    assert rights.authorized() == {}                                          # ... the rights path says nothing
    assert 60 not in {p["kb_id"] for p in _passages()}


def test_minimal_no_rights_code_path_writes_anything(minimal):
    _passages()
    assert not rights.anchor_path().exists()
    assert not rights.audit_path_for(policy.path()).exists()


@pytest.mark.parametrize("kind,params", [("setup.playbook", {"setup": "EP"}), ("setup.record", {"setup": "EP"})])
def test_minimal_template_and_record_kinds_are_not_served(minimal, kind, params):
    from api.services.uct_agent.marketdata import gateway
    assert kind not in gateway.enabled_kinds()
    out = gateway.read(kind, params, user_id=1, turn_id=f"tm{time.time_ns()}")
    assert out["status"] != "ok" and not out.get("data")


def test_minimal_the_brain_flag_off_serves_nothing(minimal, monkeypatch):
    monkeypatch.setenv("UCT_AGENT_KNOWLEDGE", "0")
    from api.services.uct_agent.marketdata import gateway
    assert "knowledge.search" not in gateway.enabled_kinds()


# ── QA round 4: POSITIVE CONTROLS — the policy fields do change serving when set (so the negatives above mean
# something), and the gate for them is PR review of policy.json (it carries no key; it is the reviewed source policy) ─
from tests.test_uct_agent_knowledge import _with_policy  # noqa: E402

CUP_Q = "cup and handle handle high entry rounded base"


def _ids_for(q):
    kinds._BLOCKED_CACHE.update(key=None, ids=[])
    return {p["kb_id"] for p in read("knowledge.search", {"question": q, "k": 3})["data"]["passages"]}


def _shipped():
    return json.loads(policy.DEFAULT_PATH.read_text(encoding="utf-8"))


def test_control_admitting_a_source_serves_it_and_the_shipped_policy_does_not(minimal, monkeypatch, tmp_path):
    q = "brain own review episodic pivot gap volume"
    assert 6 not in _ids_for(q)                                                # self_review: not admitted (shipped)
    pol = _shipped()
    pol["sources"]["self_review"]["admit"] = True
    _with_policy(monkeypatch, tmp_path, sources=pol["sources"])
    assert 6 in _ids_for(q)                                                    # positive control


def test_control_serve_flagged_serves_commentary_only_and_never_a_definition(minimal, monkeypatch, tmp_path):
    assert not {60, 61} & _ids_for(CUP_Q)
    _with_policy(monkeypatch, tmp_path, excluded_setup_mentions={"mode": "serve_flagged"})
    got = _ids_for(CUP_Q)
    assert 61 in got and 60 not in got                                         # commentary yes, definitional never


def test_control_team_origins_admits_a_template_and_its_rows(minimal, monkeypatch, tmp_path):
    assert 60 not in _ids_for(CUP_Q)
    pol = _shipped()
    pol["templates"]["team_origins"] = pol["templates"]["team_origins"] + ["O'Neil"]
    _with_policy(monkeypatch, tmp_path, templates=pol["templates"])
    assert 60 in _ids_for(CUP_Q)                                               # the template is no longer excluded


def test_control_a_complete_rights_cleared_concept_admits_it_an_incomplete_one_does_not(minimal, monkeypatch, tmp_path):
    pol = _shipped()
    entry = {"template": "Cup with Handle", "provenance_ref": "PROV-1", "rights_review_ref": "RR-1",
             "approved_by": "Owner Name", "approved_on": "2026-10-01"}
    pol["templates"]["rights_cleared_concepts"] = [{**entry, "rights_review_ref": ""}]
    _with_policy(monkeypatch, tmp_path, templates=pol["templates"])
    assert 60 not in _ids_for(CUP_Q)                                           # incomplete: still excluded
    pol["templates"]["rights_cleared_concepts"] = [entry]
    _with_policy(monkeypatch, tmp_path, templates=pol["templates"])
    assert 60 in _ids_for(CUP_Q)                                               # complete: admitted


# ── QA round 4 / owner: MINIMAL MODE blocks the unverified policy.json path, proven against positive controls ────────
def _edit_self_review(pol):
    pol["sources"]["self_review"]["admit"] = True
    return {"sources": pol["sources"]}, "brain own review episodic pivot gap volume", 6


def _edit_serve_flagged(pol):
    return {"excluded_setup_mentions": {"mode": "serve_flagged"}}, CUP_Q, 61


def _edit_team_origins(pol):
    pol["templates"]["team_origins"] = pol["templates"]["team_origins"] + ["O'Neil"]
    return {"templates": pol["templates"]}, CUP_Q, 60


def _edit_rights_cleared(pol):
    pol["templates"]["rights_cleared_concepts"] = [{"template": "Cup with Handle", "provenance_ref": "PROV-1",
                                                    "rights_review_ref": "RR-1", "approved_by": "Owner Name",
                                                    "approved_on": "2026-10-01"}]
    return {"templates": pol["templates"]}, CUP_Q, 60


EDITS = [_edit_self_review, _edit_serve_flagged, _edit_team_origins, _edit_rights_cleared]


@pytest.mark.parametrize("edit", EDITS, ids=lambda f: f.__name__[6:])
def test_minimal_mode_is_what_blocks_each_unverified_policy_edit(minimal, monkeypatch, tmp_path, edit):
    over, q, row = edit(_shipped())
    _with_policy(monkeypatch, tmp_path, **over)
    monkeypatch.setenv(policy.MINIMAL_ENV, "1")
    assert row not in _ids_for(q)                                              # BLOCKED in minimal mode ...
    monkeypatch.delenv(policy.MINIMAL_ENV)
    assert row in _ids_for(q)                                                  # ... and only the block stops it


def test_minimal_mode_blocks_a_fully_signed_clearance_too(minimal, monkeypatch, tmp_path):
    monkeypatch.setenv(rights.KEY_ENV, "test-server-held-rights-key-0123456789abcdef")
    _with_policy(monkeypatch, tmp_path)
    sha = index.content_shas([60])[60]
    import os
    from pathlib import Path
    rights.apply([{"kb_id": 60, "content_sha": sha, "provenance_ref": "P", "rights_review_ref": "R",
                   "approved_by": "Owner Name", "approved_on": "2026-10-01"}],
                 Path(os.environ["UCT_AGENT_KNOWLEDGE_POLICY"]), applied_by="Owner Name", now=time.time())
    assert 60 in _ids_for(CUP_Q)                                               # positive control: a signed clearance serves
    monkeypatch.setenv(policy.MINIMAL_ENV, "1")
    assert rights.authorized() == {} and policy.cleared_row_ids() == {}
    assert 60 not in _ids_for(CUP_Q)                                           # minimal mode: no cleared rows at all


def test_minimal_mode_still_lets_the_policy_narrow(minimal, monkeypatch, tmp_path):
    monkeypatch.setenv(policy.MINIMAL_ENV, "1")
    q = "kicker gap over the moving averages entry"
    assert 62 in _ids_for(q)                                                   # a trader_archive row
    pol = _shipped()
    pol["sources"]["trader_archive"]["admit"] = False
    _with_policy(monkeypatch, tmp_path, sources=pol["sources"])
    assert 62 not in _ids_for(q)


@pytest.mark.parametrize("kind", ["setup.playbook", "setup.record"])
def test_minimal_mode_refuses_templates_and_records_even_if_listed(minimal, monkeypatch, kind):
    from api.services.uct_agent.marketdata import gateway
    monkeypatch.setenv("UCT_AGENT_DATA_KINDS", "knowledge.search,setup.playbook,setup.record")
    monkeypatch.setenv(policy.MINIMAL_ENV, "1")
    out = gateway.read(kind, {"setup": "EP"}, user_id=1, turn_id=f"tm{time.time_ns()}")
    assert out["status"] == "refused" and not out.get("data")


@pytest.mark.parametrize("v,on", [("", False), ("0", False), ("off", False), ("NO", False), ("false", False),
                                  ("1", True), ("enabled", True), ("Y", True), ("2", True), ("minimal", True)])
def test_minimal_mode_fails_closed_on_any_value_but_an_off_word(monkeypatch, v, on):
    monkeypatch.setenv(policy.MINIMAL_ENV, v)
    assert policy.minimal_mode() is on


def test_minimal_mode_unrecognised_value_still_blocks_a_widening_edit(minimal, monkeypatch, tmp_path):
    over, q, row = _edit_self_review(_shipped())
    _with_policy(monkeypatch, tmp_path, **over)
    monkeypatch.setenv(policy.MINIMAL_ENV, "enabled")
    assert row not in _ids_for(q)


def test_minimal_mode_pins_categories_age_and_attribution_so_policy_can_only_narrow(minimal, monkeypatch, tmp_path):
    monkeypatch.setenv(policy.MINIMAL_ENV, "1")
    pol = _shipped()
    # widening attempts are ignored ...
    _with_policy(monkeypatch, tmp_path, excluded_categories=[], dated_categories=[], dated_max_age_days=9999,
                 trader_aliases={"TSDR": "UCT Team", "Vlogger": "UCT Team"})
    assert "TEST" in policy.excluded_categories() and {"MACRO", "REGIME", "SECTOR"} <= policy.dated_categories()
    assert policy.dated_max_age_days() == 30 and policy.trader("Vlogger") == "Vlogger" and policy.trader("TSDR") == "TSDR"
    assert 11 not in _ids_for("episodic pivot gap test")                     # the TEST row stays excluded
    # ... narrowing still applies
    _with_policy(monkeypatch, tmp_path, excluded_categories=["TEST", "SETUP"], dated_max_age_days=1)
    assert "SETUP" in policy.excluded_categories() and policy.dated_max_age_days() == 1
    assert 62 not in _ids_for("kicker gap over the moving averages entry")   # SETUP excluded by the narrowing
    # positive control: with minimal mode OFF the same widening edit DOES change these values
    monkeypatch.delenv(policy.MINIMAL_ENV)
    _with_policy(monkeypatch, tmp_path, excluded_categories=[], dated_max_age_days=9999, trader_aliases={"Vlogger": "UCT Team"})
    assert "TEST" not in policy.excluded_categories() and policy.dated_max_age_days() == 9999
    assert policy.trader("Vlogger") == "UCT Team"
    del pol
