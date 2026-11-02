"""expected_leaves.json is current (owner: agent-sc): the JS intent measurement compares against the Screener grammar's
own reading of both corpora, regenerated with `python -m api.services.uct_agent.scan.eval.expected --write`."""
from __future__ import annotations

from api.services.uct_agent.scan.eval import expected


def test_expected_leaves_are_current(monkeypatch):
    monkeypatch.setenv("SCREENER_LOGIC_ENABLED", "1")
    have = expected.OUT.read_text(encoding="utf-8").replace("\r\n", "\n")
    assert have == expected.text(), "regenerate: python -m api.services.uct_agent.scan.eval.expected --write"


def test_every_corpus_item_is_present_with_its_kind():
    data = expected.build()
    assert len(data["discovery"]) == 31 and len(data["sc2"]) >= 40 and data["sc2_chains"]
    assert {e["kind"] for e in data["sc2"].values()} == {"spec", "ask", "planner", "refuse"}
    assert any(e["leaves"] for e in data["discovery"].values() if e["kind"] == "spec")
