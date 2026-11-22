"""Track 4, unit B2 (NUMBER PENDING, train e95): the server's half of `USI:` breadth in the engine.

Each must hold, with a test that goes red when it breaks:
  * the engine's spellings (`app/src/components/chart/engine/pineBreadth.js::BREADTH_SPELLINGS` / `BREADTH_ALIASES`) are
    exactly the ones B1 serves (`api/services/pine_breadth.py::SPELLINGS` / `ALIASES`), and no spelling B1 does not hold
    (volume) is one the engine serves;
  * the breadth witness rows (`requestWitnesses.json`, kind `breadth`) name B1's door and are PENDING today;
  * the capability `request-breadth` is declared beside `request-other`, pending, not admitted, history-only;
  * the assistant is handed a `USI:` spelling ONLY while the breadth door serves members AND the engine serves it
    (its capture is in): the E2 pattern; a gap probe that reads one stays a gap otherwise.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from api.services import pine_authoring as pa
from api.services import pine_breadth as pb
from api.services import pine_capabilities as pc
from api.services import rollout_gate as rg

REPO = Path(__file__).resolve().parents[1]
ENGINE = REPO / "app" / "src" / "components" / "chart" / "engine"
JS = (ENGINE / "pineBreadth.js").read_text(encoding="utf-8")
WITNESSES = json.loads((ENGINE / "requestWitnesses.json").read_text(encoding="utf-8"))


def _js_object_keys(name: str) -> set:
    """The keys of `export const <name> = Object.freeze({ ... })` in pineBreadth.js (quoted or bare)."""
    m = re.search(rf"export const {name} = Object\.freeze\(\{{(.*?)\n\}}\)", JS, re.S)
    assert m, name
    body = m.group(1)
    return set(re.findall(r"^\s*'?([A-Z][A-Z0-9.]*)'?\s*:", body, re.M))


def test_the_engine_serves_exactly_b1s_spellings():
    served = _js_object_keys("BREADTH_SPELLINGS")
    assert {f"USI:{t}" for t in served} == set(pb.SPELLINGS)
    aliases = re.search(r"export const BREADTH_ALIASES = Object\.freeze\(\{(.*?)\}\)", JS, re.S).group(1)
    js_aliases = dict(re.findall(r"(\w+): '([A-Z.]+)'", aliases))
    b1_usi_aliases = {k[4:]: v[4:] for k, v in pb.ALIASES.items() if k.startswith("USI:")}
    assert js_aliases == b1_usi_aliases
    # nothing B1 does not hold is served by the engine
    assert not {s[4:] for s in pb.NOT_HELD} & (served | set(js_aliases))


def test_the_breadth_rows_name_b1s_door_and_are_pending():
    rows = {k: v for k, v in WITNESSES["rows"].items() if isinstance(v, dict) and v.get("kind") == "breadth"}
    assert set(rows) == set(pb.SPELLINGS) | {k for k in pb.ALIASES if k.startswith("USI:")}
    for k, v in rows.items():
        base = pb.ALIASES.get(k, k)
        assert v["store"] == "USI~" + base[4:], k
        assert v["fetch"].startswith(f"/api/pine/breadth/{base} "), k
        assert (v["witness"], v["captured"]) == ("", ""), k
        assert v["queue_row"] == "Q-T4-B1" and set(v["periods"]) == {"W", "M"}, k


def test_request_breadth_is_declared_pending_and_history_only():
    assert "request-breadth" in pc.CAPABILITY_IDS
    assert pc.capabilities_of('x = request.security("USI:ADD", "D", close)\nplot(x)\n') >= {"request-breadth", "request-other"}
    assert "request-breadth" not in pc.capabilities_of('indicator("USI: breadth notes")\nplot(close)\n')
    allow = json.loads((REPO / "api" / "data" / "pine_runtime_allowlist.json").read_text(encoding="utf-8"))
    row = allow["capabilities"]["request-breadth"] if "capabilities" in allow else allow["request-breadth"]
    assert (row["status"], row["admitted"]) == ("pending", False)
    assert "request-breadth" in rg.PINE_CAPABILITY_FORMING_UNGRADED


@pytest.fixture
def witnessed(tmp_path):
    """The witness file as the landed capture's data edit writes it (witness + captured on every breadth row)."""
    doc = json.loads(json.dumps(WITNESSES))
    for v in doc["rows"].values():
        if isinstance(v, dict) and v.get("kind") == "breadth":
            v["witness"], v["captured"] = "test", "2026-11-22"
    p = tmp_path / "requestWitnesses.json"
    p.write_text(json.dumps(doc), encoding="utf-8")
    return p


def test_no_spelling_is_served_today_so_none_is_handed(monkeypatch):
    monkeypatch.setenv("PINE_BREADTH_SUPPLY_ENABLED", "all")
    assert pa.breadth_spellings_served() == []
    assert pa.breadth_handed() == []
    assert "MARKET BREADTH" not in pa.document()


@pytest.mark.parametrize("stage", ["", "admins", "off"])
def test_below_all_nothing_is_handed_even_when_served(monkeypatch, witnessed, stage):
    monkeypatch.setenv("PINE_BREADTH_SUPPLY_ENABLED", stage)
    assert pa.breadth_spellings_served(witnessed) == sorted(set(pb.SPELLINGS) | {k for k in pb.ALIASES if k.startswith("USI:")})
    assert pa.breadth_handed(witnessed) == []


def test_at_all_the_served_spellings_are_handed_with_the_words(monkeypatch, witnessed):
    monkeypatch.setenv("PINE_BREADTH_SUPPLY_ENABLED", "all")
    monkeypatch.setattr(pa, "WITNESSES_PATH", witnessed)
    handed = pa.breadth_handed()
    assert "USI:ADVN.NY" in handed and "USI:ADD" in handed
    doc = pa.document()
    assert "MARKET BREADTH" in doc and pa.BREADTH_WORDS in doc and "`USI:ADVN.NY`" in doc
    assert pa.BREADTH_WORDS == "UCT breadth data (our own counts), not the exchange's official figures"


def test_a_gap_probe_that_reads_usi_stays_a_gap_until_handed(monkeypatch, witnessed):
    probe = {"id": "usi-probe", "kind": "data", "cannot": "breadth", "runs": True, "lane": "host",
             "source": '//@version=5\nindicator("p")\nplot(request.security("USI:ADVN.NY", "D", close))\n'}
    doc = {"probes": [probe]}
    monkeypatch.setenv("PINE_BREADTH_SUPPLY_ENABLED", "admins")
    monkeypatch.setattr(pa, "WITNESSES_PATH", witnessed)
    row = pa.gap_rows(doc, admitted=[])[0]
    assert (row["served"], row["guard"]) == (False, pa.BREADTH_DARK_GUARD)
    monkeypatch.setenv("PINE_BREADTH_SUPPLY_ENABLED", "all")
    assert pa.gap_rows(doc, admitted=[])[0]["served"] is True
