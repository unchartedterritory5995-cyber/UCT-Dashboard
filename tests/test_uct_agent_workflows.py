"""Track D — trading workflows for UCT Agent (DARK, UCT_AGENT_WORKFLOWS). docs/agent/TRADING-WORKFLOWS.md.

The server's part is small and pinned here: the flag (default off, staged by name), the config field the browser reads,
and the data-read rail (the model's pre-read reply is blanked on a plan made only of these reads, exactly as for
stock.dailyBars / chart.describeSetup). No new kind, route, model call or budget is added.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from api.services.uct_agent import turn, workflows
from tests.test_uct_agent import env  # noqa: F401

ROOT = Path(__file__).resolve().parents[1]
ACTIONS = {"stock.relativeStrength", "watchlist.changes", "chartSetup.multiTimeframe"}


@pytest.mark.parametrize("raw,want", [
    (None, []), ("", []), ("0", []), ("off", []), ("false", []), ("nonsense", []),
    ("1", sorted(workflows.NAMES)), ("all", sorted(workflows.NAMES)), ("ON", sorted(workflows.NAMES)),
    ("relativeStrength", ["relativeStrength"]),
    ("watchlistchanges, relativeStrength,unknown", ["relativeStrength", "watchlistChanges"]),
])
def test_the_flag_is_off_by_default_and_staged_by_name(monkeypatch, raw, want):
    if raw is None:
        monkeypatch.delenv(workflows.ENV, raising=False)
    else:
        monkeypatch.setenv(workflows.ENV, raw)
    assert workflows.enabled() == want


def test_the_config_route_reports_the_enabled_workflows(monkeypatch):
    from api.routers import uct_agent as r
    monkeypatch.delenv(workflows.ENV, raising=False)
    assert r.agent_config(user={"id": 1})["workflows"] == []
    monkeypatch.setenv(workflows.ENV, "relativeStrength")
    assert r.agent_config(user={"id": 1})["workflows"] == ["relativeStrength"]


def test_the_browser_gate_names_exactly_the_server_workflows():
    src = (ROOT / "app/src/agent/capabilities/workflowGate.js").read_text(encoding="utf-8")
    m = re.search(r"export const WORKFLOWS = \[([^\]]*)\]", src)
    assert m and sorted(re.findall(r"'([A-Za-z]+)'", m.group(1))) == sorted(workflows.NAMES)


def test_every_workflow_action_is_a_data_read_never_local_only():
    assert ACTIONS <= turn.DATA_READ_ACTIONS
    assert not (ACTIONS & turn.LOCAL_ONLY_ACTIONS)
    for name in sorted(ACTIONS):
        o = {"action": name, "target": "m", "args": {}}
        assert turn.sanitize_envelope(env("apply", [o], reply="NVDA beat SPY by 4 points."), {"m"})["reply"] == ""


def test_each_action_is_registered_by_its_own_module_as_a_query():
    for mod, name in (("relativeStrength", "stock.relativeStrength"), ("watchlistChanges", "watchlist.changes")):
        src = (ROOT / f"app/src/agent/capabilities/{mod}.js").read_text(encoding="utf-8")
        assert f"name: '{name}'" in src and "query: true" in src and "localOnly" not in src.split("registerCapability({", 1)[1]
