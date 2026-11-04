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
