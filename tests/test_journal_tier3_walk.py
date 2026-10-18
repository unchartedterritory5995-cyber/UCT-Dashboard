"""P2 Tier 3, Task 10: rails on tools/journal_tier3_walk.py that hold without a two-hour re-walk.

  * the driver never imports api.* in its own process (it drives a sandbox from outside);
  * the two switches it arms are real NOTEBOOK_FLAGS gates (never an invented name), and set_env
    refuses one that is not;
  * the seed is what the walk's steps need: >= 25 closed trades, every one with an emotion tag, enough
    winners for the checklist suggestions (>= 10), trades in last year (the Wrapped door's Earlier years)
    and trades today ET (the check-in day the By check-in view joins on).
"""
from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
TOOL = REPO / "tools" / "journal_tier3_walk.py"
for p in (REPO / "tools", REPO / "scripts"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))


def _gates() -> set[str]:
    src = (REPO / "api" / "routers" / "auth.py").read_text(encoding="utf-8")
    block = src.split("NOTEBOOK_FLAGS = {", 1)[1].split("\n}\n", 1)[0]
    return set(re.findall(r'^\s+"([A-Z0-9_]+)":\s*(?:True|False)', block, re.M))


def test_the_driver_never_imports_api():
    tree = ast.parse(TOOL.read_text(encoding="utf-8"))
    mods = []
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            mods += [a.name for a in n.names]
        elif isinstance(n, ast.ImportFrom) and n.module:
            mods.append(n.module)
    assert mods, "non-vacuity: the tool's imports were read"
    assert "notebook_perf_harness" in mods
    assert [m for m in mods if m == "api" or m.startswith("api.")] == []


def test_the_switches_are_real_gates_and_an_invented_one_is_refused():
    import journal_tier3_walk as t3

    gates = _gates()
    assert "NOTEBOOK_PLAYBOOK_ENABLED" in gates               # non-vacuity: the parse found the block
    assert set(t3.TIER3_FLAGS) == {"JOURNAL_TIER3_ENABLED", "NOTEBOOK_JOURNAL_STYLES_ENABLED"}
    assert set(t3.TIER3_FLAGS) <= gates
    assert "JOURNAL_STYLES_ENABLED" not in gates              # the plan's spelling is not a flag
    fs = {"gates": {g: False for g in gates if g != "JOURNAL_TIER3_ENABLED"}, "c1": [], "all_names": []}
    with pytest.raises(SystemExit, match="JOURNAL_TIER3_ENABLED"):
        t3.set_env(fs)


def test_the_seed_carries_what_the_steps_read():
    import journal_tier3_walk as t3

    rows = t3.trade_rows()
    assert len(rows) >= 25
    assert all(r["emotionTags"] for r in rows)
    winners = [r for r in rows if r["exitPrice"] > r["entryPrice"]]
    assert len(winners) >= 10
    assert all(r["originalStop"] < r["entryPrice"] for r in rows)       # every trade has an R
    years = {r["exitDate"][:4] for r in rows}
    assert str(t3.LAST_YEAR) in years
    assert any(r["exitDate"] == t3.TODAY_ET.isoformat() for r in rows)
    # the suggested habit is on the winners and not on the losers
    assert all(r["emotionTags"] == ["patient"] for r in winners)
    assert all("patient" not in r["emotionTags"] for r in rows if r not in winners)
