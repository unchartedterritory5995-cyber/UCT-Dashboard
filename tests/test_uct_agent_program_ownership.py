"""UCT Agent program — the ownership map (docs/agent/program/OWNERSHIP.md) and its checker.

Every file in the Agent program's paths resolves to a KNOWN session; the hot spots stay agent-lead's;
each specialist's own paths resolve to it; anything else is EXTERNAL.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

from tools import agent_ownership_check as oc

REPO = Path(__file__).resolve().parents[1]
SESSIONS = {"agent-lead", "agent-md", "agent-sc", "agent-qa", "agent-rs"}
TABLE = oc.load_table()


def _tracked(prefixes: tuple[str, ...]) -> list[str]:
    out = subprocess.run(["git", "ls-files", *prefixes], cwd=REPO, capture_output=True, text=True, check=True)
    return [f for f in out.stdout.splitlines() if f]


def test_table_names_only_known_sessions():
    assert {o for _, o in TABLE} <= SESSIONS


def test_every_agent_program_file_has_a_known_owner():
    files = _tracked(("app/src/agent", "api/services/uct_agent", "docs/agent/program"))
    files += [f for f in _tracked(("api/routers", "tests", "tools")) if "uct_agent" in f or "/agent_" in f]
    assert files, "no Agent files found"
    unowned = [f for f in files if oc.owner_of(f, TABLE) not in SESSIONS]
    assert unowned == []


def test_hot_spots_stay_with_the_lead():
    for f in ["app/src/agent/useAgent.js", "app/src/agent/builtins.js", "app/src/agent/capabilities.js",
              "app/src/agent/routing.js", "app/src/agent/agentClient.js", "app/src/agent/host.js",
              "app/src/agent/contract/manifest.golden.json", "app/src/agent/contract/manifest.contract.json",
              "api/services/uct_agent/turn.py", "api/services/uct_agent/budget.py", "api/services/uct_agent/limits.py",
              "api/routers/uct_agent.py", "api/services/uct_agent/marketdata/gateway.py", "api/services/uct_agent/marketdata/envelope.py",
              "docs/agent/program/OWNERSHIP.md", "tools/agent_ownership_check.py"]:
        assert oc.owner_of(f, TABLE) == "agent-lead", f


def test_each_specialist_owns_its_paths():
    cases = {
        "api/services/uct_agent/marketdata/kinds.py": "agent-md",
        "api/services/uct_agent/marketdata/adapters/quotes.py": "agent-md",
        "app/src/agent/marketdata/client.js": "agent-md",
        "app/src/agent/capabilities/marketData.js": "agent-md",
        "tests/test_uct_agent_data_quotes.py": "agent-md",
        "docs/agent/program/contracts/MD-1-market-data.md": "agent-md",
        "api/services/uct_agent/scan/kinds.py": "agent-sc",
        "app/src/agent/capabilities/screener.js": "agent-sc",
        "app/src/agent/capabilities/scanIdeas.js": "agent-sc",
        "tests/test_uct_agent_scan_run.py": "agent-sc",
        "tests/test_uct_agent_qa_conformance.py": "agent-qa",
        "app/src/agent/qa/conformance.test.js": "agent-qa",
        "app/src/agent/__fixtures__/program/envelopes.json": "agent-qa",
        "docs/agent/program/status/agent-qa.md": "agent-qa",
        "api/services/uct_agent/research/answer.py": "agent-rs",
    }
    for f, want in cases.items():
        assert oc.owner_of(f, TABLE) == want, f


def test_outside_paths_are_external():
    for f in ["api/services/screener/query.py", "api/services/massive.py", "app/src/components/chart/builder/agentMutations.js",
              "app/src/pages/charts/ChartsWorkspace.jsx", "api/flow_proxy.py", ".github/workflows/master-deploy-gate.yml"]:
        assert oc.owner_of(f, TABLE) == oc.EXTERNAL, f


def test_checker_flags_foreign_and_external():
    bad, lines = oc.check(["api/services/uct_agent/marketdata/kinds.py", "api/services/uct_agent/scan/kinds.py",
                           "api/services/screener/query.py"], "agent-md", TABLE)
    assert bad == 2
    assert lines[0].strip().startswith("ok") and "FOREIGN" in lines[1] and "EXTERNAL" in lines[2]
    assert oc.check(["api/services/screener/query.py"], "agent-md", TABLE, allow_external=True)[0] == 0
