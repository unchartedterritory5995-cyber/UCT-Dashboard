"""The SC-2 natural-language scanning corpus stays VALID data (owner: agent-sc). It proves the corpus can be scored:
every expected spec parses in the Screener's own grammar, names real catalog fields and passes SC-1 validation; every
chain step is the delta its label says; the SC-1 §2c relative-volume rule holds; refusals are what SC-1 / SC-2 refuse.
Scoring interpreters against it is agent-qa's. No model, no provider."""
from __future__ import annotations

import json
import pathlib
import re

import pytest

from api.services.screener import filters, grammar, logic
from api.services.uct_agent.scan import spec as scan_spec

REPO = pathlib.Path(__file__).resolve().parents[1]
CORPUS = REPO / "api/services/uct_agent/scan/eval/sc2.json"
CONTRACT = REPO / "docs/agent/program/contracts/SC-2-nl-scan.md"
DATA = json.loads(CORPUS.read_text(encoding="utf-8"))
ITEMS = DATA["items"]
CHAINS = DATA["chains"]
STEPS = [(f"{c['id']}.{n + 1}", s) for c in CHAINS for n, s in enumerate(c["steps"])]
ALL = [(i["id"], i) for i in ITEMS] + STEPS
CATALOG = {f["key"]: f for f in filters.field_catalog()}
TYPES = {"spec", "ask", "planner", "refuse"}
DELTAS = {"new", "add", "narrow", "replace_universe", "sort", "show", "remove", "reset"}
UNIVERSE = {"sector", "industry", "theme"}
TIME_WORDS = re.compile(r"\b(today|right now|now|this morning|so far)\b", re.I)
VOLUME_FIELDS = {"vol_ratio", "rvol_live"}
#: the field's own name ("Rel Volume (by now)") also asks for it: "sort by relative volume" (SC-2 §4)
RVOL_NAME = re.compile(r"\b(relative volume|rvol|rel volume)\b", re.I)
#: a chain step that keeps the previous step's rvol_live (a later "now just tech" keeps the sort)
INHERITED = {f"{c['id']}.{n + 1}" for c in CHAINS for n, s in enumerate(c["steps"])
             if n and "rvol_live" in json.dumps(c["steps"][n - 1]["expect"])}


def _leaves(expect: dict) -> list[dict]:
    text = expect.get("criteria_text") or ""
    if not text.strip():
        return []
    out = grammar.compile_text(text)
    return list(logic.leaves(out["logic"])) if out["logic"] else []


def _sig(leaf: dict) -> str:
    return json.dumps(leaf, sort_keys=True)


def test_shape_size_and_ids():
    assert DATA["version"] and DATA["contract"].endswith("SC-2-nl-scan.md") and CONTRACT.exists()
    ids = [i for i, _ in ALL]
    assert len(ids) == len(set(ids))
    assert len(ALL) >= 60                                                         # agent-lead's floor
    assert len(CHAINS) >= 5 and all(len(c["steps"]) >= 2 for c in CHAINS)
    kinds = {e["expect"]["type"] for _, e in ALL}
    assert kinds == TYPES                                                         # every exit is exercised
    for _, e in ALL:
        assert e["expect"]["type"] in TYPES and e["text"].strip()


@pytest.mark.parametrize("cid,e", [x for x in ALL if x[1]["expect"]["type"] == "spec"], ids=lambda x: x if isinstance(x, str) else "")
def test_every_expected_spec_parses_validates_and_names_real_fields(cid, e, monkeypatch):
    monkeypatch.setenv("SCREENER_LOGIC_ENABLED", "1")
    ex = e["expect"]
    text = ex["criteria_text"]
    if text.strip():
        out = grammar.compile_text(text)
        logic.validate(out["logic"])
        scan_spec.validate({"filters": [], "logic": out["logic"]})
        assert {lf["key"] for lf in logic.leaves(out["logic"])} <= set(CATALOG)
    else:
        assert ex.get("sort"), "a spec with no criteria must at least sort"
    if ex.get("sort"):
        f = CATALOG[ex["sort"]["key"]]
        assert f["type"] == "range" and ex["sort"]["dir"] in ("asc", "desc")


@pytest.mark.parametrize("cid,e", [x for x in ALL if x[1]["expect"]["type"] == "spec"], ids=lambda x: x if isinstance(x, str) else "")
def test_relative_volume_follows_sc1_2c(cid, e):
    """A volume question with a time word reads rvol_live (sorted, "at this time of day"); without one, vol_ratio.
    Never the one silently in place of the other (SC-1 §2c)."""
    ex = e["expect"]
    keys = {lf["key"] for lf in _leaves(ex)} | ({ex["sort"]["key"]} if ex.get("sort") else set())
    if "rvol_live" in keys and cid not in INHERITED:
        assert TIME_WORDS.search(e["text"]) or RVOL_NAME.search(e["text"]), f"{cid}: rvol_live without a time word"
        assert ex.get("sort") == {"key": "rvol_live", "dir": "desc"} or ex.get("sort", {}).get("key") == "rvol_live"
    vol_here = {lf["key"] for lf in _leaves(ex)} & VOLUME_FIELDS
    if vol_here == {"vol_ratio"} and not cid.startswith("k"):
        assert not TIME_WORDS.search(e["text"]) or "yesterday" in e["text"], f"{cid}: a time word read as full-session"


def _prev_spec(chain, n):
    for s in reversed(chain["steps"][:n]):
        if s["expect"]["type"] == "spec":
            return s["expect"]
    return None


@pytest.mark.parametrize("chain", CHAINS, ids=lambda c: c["id"])
def test_every_chain_step_is_the_delta_it_says(chain):
    assert chain["steps"][0]["delta"] == "new"
    for n, step in enumerate(chain["steps"]):
        assert step["delta"] in DELTAS
        if n == 0 or step["expect"]["type"] != "spec" or step["delta"] in ("new", "reset"):
            continue
        prev, cur = _prev_spec(chain, n), step["expect"]
        p, c = {_sig(x) for x in _leaves(prev)}, {_sig(x) for x in _leaves(cur)}
        pk, ck = {x["key"] for x in _leaves(prev)}, {x["key"] for x in _leaves(cur)}
        if step["delta"] in ("sort", "show"):
            assert p == c, f"{chain['id']}.{n + 1}: a {step['delta']} changed the filters"
            if step["delta"] == "show":
                assert prev.get("sort") == cur.get("sort")
            else:
                assert cur.get("sort") and cur.get("sort") != prev.get("sort")
        elif step["delta"] in ("add", "narrow"):
            # every earlier filter survives unless the step replaced that key's bound (refine replaces by key)
            kept = {x for x in p if json.loads(x)["key"] in ck}
            assert pk <= ck and len(c) >= len(kept), f"{chain['id']}.{n + 1}: an add dropped a filter"
            assert c != p
        elif step["delta"] == "remove":
            assert c < p and ck < pk
            assert cur.get("sort") == prev.get("sort")
        elif step["delta"] == "replace_universe":
            assert {x for x in p if json.loads(x)["key"] not in UNIVERSE} == {x for x in c if json.loads(x)["key"] not in UNIVERSE}
            assert (pk ^ ck) <= UNIVERSE and c != p
            assert cur.get("sort") == prev.get("sort")


def test_asks_name_their_slot_and_a_reason_and_planner_items_say_why():
    for cid, e in ALL:
        ex = e["expect"]
        if ex["type"] == "ask":
            assert ex["slot"] and ex["why"], cid
        if ex["type"] == "planner":
            assert ex["why"], cid


def test_refusals_are_what_sc1_refuses_or_the_open_flow_question():
    with pytest.raises(scan_spec.SpecError, match="indicator-condition scans"):
        scan_spec.validate({"filters": [{"key": "scan", "op": "in", "value": ["h"]}]})
    reasons = {e["expect"]["reason"] for _, e in ALL if e["expect"]["type"] == "refuse"}
    assert reasons == {"indicator-condition scans", "the Screener has no field", "flow fields pending a ruling"}
    # the open question is REAL: the catalog serves flow fields today (SC-2 §6), so refusing them is a choice
    assert {"dp_notional_1d", "opt_net_premium_1d"} <= set(CATALOG)
    # and the no-field refusal is real: nothing in the catalog is a put/call ratio
    assert not [k for k, f in CATALOG.items() if "put" in (f.get("label") or "").lower()]


def test_the_contract_names_this_corpus_and_marks_proposed_values():
    text = CONTRACT.read_text(encoding="utf-8")
    assert "api/services/uct_agent/scan/eval/sc2.json" in text and "PROPOSED" in text
    assert "/api/screener/compile" in text                                     # stated as not used
