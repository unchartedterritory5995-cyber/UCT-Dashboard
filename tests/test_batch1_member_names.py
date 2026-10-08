"""BATCH 1 -- the member's name for the indicator is a NAME on every turn, never a concept.

⚰️ Measured 2026-10-08 (planner probe): a later-turn "Call it Swing Line" was refused
before any model call (`concept:ungrounded` -- the planner's Title-Case rule), and
"Make the RSI length 28 and call it Swing Line" planned only "Make the RSI length 28":
the name never reached the model. The browser enforces the member's name on the result
(`derivedName.memberCueNames`), and both read ONE rule (`preflightRules.json` -> naming).
ASKED / CLAIMED / DID per case.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from api.services import conversation_preflight as cp
from tests.test_p2_truth_server import (  # noqa: F401  (pytest fixtures by import)
    RSI_GT_70, conv, emits, env, model, out, view,
)

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("message,names,rest", [
    ("Call it Swing Line", ["Swing Line"], ""),
    ("Make the RSI length 28 and call it Swing Line", ["Swing Line"], "Make the RSI length 28"),
    ("call it Swing Line and colour it red", ["Swing Line"], "colour it red"),
    ("Rename it to Momentum Pulse", ["Momentum Pulse"], ""),
    ("Name it “RSI Trend” please", ["RSI Trend"], "please"),
    ("Add a 20 EMA", [], "Add a 20 EMA"),
    ("What is a good name for this?", [], "What is a good name for this?"),
])
def test_naming_split(message, names, rest):
    got_names, got_rest = cp.naming_split(message)
    assert got_names == names
    assert got_rest == rest


def _user_turn_text(client):
    return "\n".join(m["content"] if isinstance(m["content"], str) else json.dumps(m["content"])
                     for m in client.calls[-1]["messages"] if m["role"] == "user")


def test_a_later_rename_reaches_the_model_with_the_name_as_data(conv, model):
    """ASKED: "Call it Swing Line" on an existing indicator (turn 3). CLAIMED: not refused
    by the planner; the model is called with the member's name in `member_names`, and the
    request is a rename. DID (EXACT)."""
    client = model([emits(env(1, [{"op": "rename_definition", "name": "Swing Line"}]))])
    r = conv.converse("Call it Swing Line", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    assert r["ok"] is True and r["disposition"] == "change", r
    assert len(client.calls) == 1
    text = _user_turn_text(client)
    assert "Swing Line" in text and "member_names" in text
    assert conv.RENAME_REQUEST in text


def test_a_change_AND_a_name_keeps_both(conv, model):
    """ASKED: "Make the RSI length 28 and call it Swing Line". CLAIMED: the planner sees
    the change (no refusal for "Swing Line"); the name rides as data. DID (EXACT)."""
    client = model([emits(env(1, [{"op": "rename_definition", "name": "Swing Line"}]))])
    r = conv.converse("Make the RSI length 28 and call it Swing Line", user_id="u1",
                      view=view(1, [out("value", RSI_GT_70)]))
    assert r["ok"] is True, r
    assert not any((n.get("phrase") or "") == "Swing Line" for n in r.get("not_understood") or [])
    text = _user_turn_text(client)
    assert "Swing Line" in text and "member_names" in text and "length 28" in text


def test_an_unknown_concept_beside_a_name_is_still_refused(conv, model):
    """ASKED: "Add the McGinley Dynamic and call it Swing Line". CLAIMED: the name does not
    launder an unknown concept -- still refused with no model call. DID (REFUSAL)."""
    client = model([])
    r = conv.converse("Add the McGinley Dynamic and call it Swing Line", user_id="u1",
                      view=view(1, [out("value", RSI_GT_70)]))
    assert r["ok"] is False and r["gate"].startswith("concept:")
    assert client.calls == []


@pytest.mark.skipif(shutil.which("node") is None, reason="node not on PATH")
def test_the_browser_reads_the_same_rule():
    """The browser's `memberCueNames` and the server's `naming_split` agree on the names."""
    rules = json.loads((ROOT / "app/src/components/chart/builder/authoring/preflightRules.json").read_text("utf-8"))
    cue = re.compile(rules["naming"]["cue"], re.I)
    stop = re.compile(rules["naming"]["stop"], re.I)
    samples = ["Call it Swing Line", "call it Swing Line and colour it red", "Rename it to Momentum Pulse",
               "named My Trend then make it red", "Add a 20 EMA"]
    js = (ROOT / "app/src/components/chart/builder/authoring/preflightRules.json").as_uri()
    script = (f"import r from {json.dumps(js)} with {{ type: 'json' }};"
              "const cue = new RegExp(r.default ? r.default.naming.cue : r.naming.cue, 'gi');"
              "const stop = new RegExp(r.default ? r.default.naming.stop : r.naming.stop, 'i');"
              f"const S = {json.dumps(samples)};"
              "process.stdout.write(JSON.stringify(S.map((s) => [...s.matchAll(cue)].map((m) => m[1].replace(/\\s+/g, ' ').trim().split(stop)[0].trim()))))")
    res = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, timeout=60)
    assert res.returncode == 0, res.stderr
    browser = json.loads(res.stdout)
    server = [[stop.split(re.sub(r"\s+", " ", m.group(1)).strip())[0].strip() for m in cue.finditer(s)] for s in samples]
    assert browser == server
    assert [cp.naming_split(s)[0] for s in samples] == server
