"""drawingBoard.set (r8-drawings, Drawing Boards C1-167..170): its mappings, checked against the REAL sources.

Each test FAILS if a mapping is wrong, not only if it is missing:
  1. the routing group, read from the browser's own app/src/agent/routing.js (the server has no group map of its own:
     the browser sends the groups), and test_uct_agent_contract's copy of it agreeing with routing.js domain by domain;
  2. planner v2's domain tool (turn_v2.domain_for, the real map), which sends an unlisted prefix to "history";
  3. the capability-regression corpus entry drawingBoard.switch: its op and args exactly, and the baseline lock's digest
     of that entry (so a changed op / args without a re-lock fails here too).
Reads repository files only.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from api.services.uct_agent import turn_v2
from tests import test_uct_agent_capreg_baseline as capreg
from tests import test_uct_agent_contract as contract

ROOT = Path(__file__).resolve().parents[1]
ROUTING_JS = ROOT / "app" / "src" / "agent" / "routing.js"
GOLDEN = json.loads((ROOT / "app" / "src" / "agent" / "contract" / "manifest.golden.json").read_text(encoding="utf-8"))
# one routing group per line in routing.js: `{ id: 'drawings', title: '…', domains: ['drawing', 'drawingBoard'], …`
_GROUP_LINE = re.compile(r"\{ id: '([A-Za-z]+)',.*?domains: \[([^\]]*)\]")


def _routing_domains() -> dict[str, str]:
    out = {}
    for line in ROUTING_JS.read_text(encoding="utf-8").splitlines():
        m = _GROUP_LINE.search(line)
        if m:
            for d in re.findall(r"'([A-Za-z]+)'", m.group(2)):
                out[d] = m.group(1)
    return out


def test_drawing_board_is_in_the_drawings_group_of_the_real_routing_map():
    assert "drawingBoard.set" in {c["name"] for c in GOLDEN["capabilities"]}
    real = _routing_domains()
    assert len(real) >= 20, "routing.js groups were not read (format changed?)"
    assert real["drawingBoard"] == "drawings" == real["drawing"]
    # the contract test's copy may not drift from routing.js for any domain both name
    drift = {d: (g, contract._GROUP_OF[d]) for d, g in real.items() if d in contract._GROUP_OF and contract._GROUP_OF[d] != g}
    assert not drift, f"test_uct_agent_contract._GROUP_OF disagrees with routing.js: {drift}"


def test_planner_v2_sends_drawing_boards_to_the_drawing_domain_not_history():
    assert turn_v2.domain_for("drawingBoard.set") == "drawing"
    assert turn_v2.domain_for("drawing.addLevel") == "drawing"
    assert turn_v2.domain_for("breadth.show") == "history"          # the fallback is still there for unlisted prefixes


def test_drawing_board_switch_corpus_entry_pins_its_op_and_args_and_the_lock_digest():
    corpus = json.loads(capreg.CORPUS.read_text(encoding="utf-8"))
    [entry] = [i for i in corpus["intents"] if i["id"] == "drawingBoard.switch"]
    assert entry["capabilities"] == ["drawingBoard.set"] and entry["needs"] == ["drawingBoard.set"]
    assert entry["model"]["ops"] == [{"action": "drawingBoard.set", "target": "$drawingBoards[0]",
                                      "args": {"op": "switch", "board": "Swing", "name": None}}]
    # the board it switches to is the one the entry's own steps created, by the same name
    assert [o["args"] for s in entry["before"] for o in s["model"]["ops"] if o["action"] == "drawingBoard.set"] == [
        {"op": "create", "board": None, "name": "Swing"}]
    assert entry["expect"]["drawings"] == {"count": 0} and entry["undo"]["expect"]["drawings"] == {"count": 1}
    lock = json.loads(capreg.LOCK.read_text(encoding="utf-8"))
    now = capreg.fingerprint(corpus, json.loads(capreg.GOLDEN.read_text(encoding="utf-8")))
    assert lock["intents"]["drawingBoard.switch"] == now["intents"]["drawingBoard.switch"]
