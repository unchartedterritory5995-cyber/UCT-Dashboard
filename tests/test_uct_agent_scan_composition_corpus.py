"""The scanner expressibility corpus stays honest (owner: agent-sc).

⛔ It measures whether a valid spec EXISTS, not whether the model produces it. No model, no provider, no production data.
Every gold spec runs through the real SC-1 validator and the screener's own SQL builder, and the statement is prepared on a
real table. Every F-16 item is refused by that same validator. Nothing here may pass by being read rather than run."""
from __future__ import annotations

import hashlib
import json
import pathlib
import re

import pytest

from api.services.screener import filters, logic, ranking
from api.services.uct_agent.scan import hidden, spec as scan_spec
from api.services.uct_agent.scan.eval import composition as C

REPO = pathlib.Path(__file__).resolve().parents[1]
DOC = C.load()
ITEMS = DOC["items"]
BASELINE = json.loads((C.CORPUS.with_name("composition_baseline.json")).read_text(encoding="utf-8"))
WITH_SPEC = [i for i in ITEMS if i["spec"] is not None]
HIDDEN_ITEMS = [i for i in ITEMS if i.get("reason") == C.HIDDEN]
IC1 = [i for i in ITEMS if "ic1_scan_definition_join" in (i.get("needs") or [])]
FRESH = C.load_fresh()
FRESH_SPECS = [i for i in FRESH["items"] if i["spec"] is not None]
FRESH_HIDDEN = [i for i in FRESH["items"] if i.get("reason") == C.HIDDEN]


def _id(x):
    return x["id"] if isinstance(x, dict) else None


def test_the_file_says_what_it_does_not_measure():
    assert "NOT measure whether any model produces" in DOC["about"]
    assert "NOT WHETHER THE MODEL PRODUCES IT" in C.__doc__


def test_size_ids_and_reasons():
    assert len(ITEMS) >= 100
    ids = [i["id"] for i in ITEMS]
    assert len(ids) == len(set(ids)) and len({i["text"] for i in ITEMS}) == len(ITEMS)
    assert set(DOC["reasons"]) == {C.MISSING, C.NARROWER, C.HIDDEN}
    for i in ITEMS:
        assert i["spec"] is not None or i["reason"] in DOC["reasons"], i["id"]
        if i["spec"] is not None:
            assert "reason" not in i, i["id"]
        if i.get("reason") == C.MISSING:
            assert i["needs"], i["id"]


def test_the_split_is_mechanical_and_both_sides_are_real():
    for i in ITEMS:
        rule = int(hashlib.sha256(i["text"].encode()).hexdigest(), 16) % 3
        assert i["split"] == ("held_out" if rule == 0 else "design"), i["id"]
    assert sum(i["split"] == "held_out" for i in ITEMS) >= 40
    assert sum(i["split"] == "design" for i in ITEMS) >= 60


@pytest.mark.parametrize("item", WITH_SPEC, ids=_id)
def test_every_gold_spec_passes_the_real_validator_and_prepares(item):
    C.check_spec(item["spec"])


@pytest.mark.parametrize("item", HIDDEN_ITEMS, ids=_id)
def test_every_hidden_item_is_refused_by_the_real_validator(item):
    key = item["hidden_key"]
    assert key in hidden.hidden_keys()
    entry = filters.FILTERS[key]
    leaf = {"key": key, "op": "gte", "min": 1} if entry["type"] == "range" else (
        {"key": key, "op": "eq", "value": 1} if entry["type"] == "bool" else {"key": key, "op": "in", "values": ["x"]})
    with pytest.raises(scan_spec.SpecError) as e:
        scan_spec.validate({"filters": [leaf]})
    assert "UCT Agent can't screen" in str(e.value)


@pytest.mark.parametrize("item", IC1, ids=_id)
def test_the_scan_definition_join_stays_refused(item):
    with pytest.raises(scan_spec.SpecError) as e:
        scan_spec.validate({"filters": [{"key": "scan", "def_hash": "x"}]})
    assert str(e.value) == scan_spec.INDICATOR_REFUSAL


def test_no_gold_spec_reaches_for_a_hidden_field():
    names = hidden.hidden_keys()
    for i in WITH_SPEC:
        assert not set(scan_spec.named_fields(i["spec"])) & set(names), i["id"]


def test_a_spec_the_validator_should_refuse_is_refused():
    """The gate can say no: a key that does not exist, a bad op, a malformed tree."""
    for bad in ({"filters": [{"key": "no_such_field", "op": "gte", "min": 1}]},
                {"filters": [{"key": "rsi14", "op": "contains", "value": "x"}]},
                {"filters": [], "logic": {"any": []}}):
        with pytest.raises(ValueError):
            C.check_spec(bad)


def test_the_flat_surface_matches_screener_js():
    src = (REPO / "app/src/agent/capabilities/screener.js").read_text(encoding="utf-8")
    ops = set()
    for name in ("RANGE_OPS", "LIST_OPS", "COL_OPS", "TOKEN_OPS"):
        ops |= set(re.findall(r"'(\w+)'", re.search(rf"const {name} = \[(.*?)\]", src).group(1)))
    assert ops == set(C.AGENT_OPS)
    assert int(re.search(r"const MAX_FILTERS = (\d+)", src).group(1)) == C.AGENT_MAX_FILTERS
    assert int(re.search(r"const LOGIC_LEAVES = (\d+)", src).group(1)) == C.AGENT_MAX_LEAVES == logic.MAX_LEAVES
    assert int(re.search(r"const LOGIC_DEPTH = (\d+)", src).group(1)) == logic.MAX_DEPTH
    assert int(re.search(r"const RANK_MAX = (\d+)", src).group(1)) == C.AGENT_MAX_RANK == ranking.MAX_CRITERIA


def test_the_flat_test_can_say_no():
    assert C.agent_flat({"filters": [{"key": "rsi14", "op": "gte", "min": 1}]})
    assert C.agent_flat({"filters": [{"key": "a", "op": "gt_col", "other": "b"}]})
    assert C.agent_flat({"filters": [{"key": "a", "op": "contains", "value": "b"}]})
    assert C.agent_flat({"filters": [], "rank": {"criteria": [{"key": "a", "weight": 1}]}})
    assert not C.agent_flat({"filters": [{"key": "a", "op": "arith"}]})
    assert not C.agent_flat({"filters": [{"key": "arith", "op": "gt"}]})
    assert not C.agent_flat({"filters": [{"key": "a", "op": "gt", "min": 1}] * (C.AGENT_MAX_FILTERS + 1)})
    assert not C.agent_flat({"filters": [], "rank": {"criteria": [{"key": str(i), "weight": 1} for i in range(9)]}})


def test_a_real_tree_is_not_flat_and_is_reported_as_needing_the_flag():
    tree = {"any": [{"key": "a", "op": "gt", "min": 1}, {"key": "b", "op": "gt", "min": 1}]}
    assert not C.agent_flat({"filters": [], "logic": tree})
    assert C.classify({"spec": {"filters": [], "logic": tree}}) == C.LOGIC
    assert C.classify({"spec": {"filters": [], "logic": {"any": [tree["any"][0]]}}}) == C.FLAT


def test_the_scorer_says_what_a_flag_item_is_not():
    """Every tree item that counts is a real tree, and the report keeps it apart from what runs today."""
    for i in [*WITH_SPEC, *[x for x in FRESH["items"] if x.get("spec")]]:
        if C.classify(i) == C.LOGIC:
            assert i["spec"].get("logic") and C.flatten_logic(i["spec"]["logic"]) is None, i["id"]
    r = C.report()
    assert r["all"]["agent_says_pct"] > r["all"]["flat_pct"]


def test_the_baseline_is_frozen_and_nothing_regressed():
    assert set(BASELINE["items"]) == {i["id"] for i in ITEMS}
    now = {i["id"]: C.classify(i) for i in ITEMS}
    for cid, before in BASELINE["items"].items():
        if before in (C.FLAT, C.HIDDEN):
            assert now[cid] == before, cid


def test_gold_specs_stay_inside_what_screener_run_takes():
    """A gold spec the Agent's arguments have no way to write must not count as said: no view, no columns, no capped rank."""
    for i in [*WITH_SPEC, *FRESH_SPECS]:
        if C.classify(i) in (C.FLAT, C.LOGIC):
            assert not set(i["spec"]) - {"filters", "sort", "logic", "rank"}, i["id"]
            assert not set(i["spec"].get("rank") or {}) - {"criteria"}, i["id"]
            assert not (i["spec"].get("rank") and i["spec"].get("sort")), i["id"]


# ── the fresh corpus ──────────────────────────────────────────────────────────────────────────────────────────────────
def test_the_fresh_corpus_says_what_it_does_not_prove():
    assert len(FRESH["items"]) >= 40
    assert "does NOT prove the model produces" in FRESH["about"].replace("It does NOT", "does NOT")
    assert "written and committed BEFORE" in FRESH["about"]


def test_the_fresh_ids_splits_and_reasons():
    items = FRESH["items"]
    assert len({i["id"] for i in items}) == len(items) and len({i["text"] for i in items}) == len(items)
    assert not {i["text"] for i in items} & {i["text"] for i in ITEMS}, "a fresh request must be new"
    for i in items:
        rule = int(hashlib.sha256(i["text"].encode()).hexdigest(), 16) % 3
        assert i["split"] == ("held_out" if rule == 0 else "design"), i["id"]
        assert (i["spec"] is None) == ("reason" in i), i["id"]


def _flat_when_written(spec):
    """screener.run as it stood when the fresh corpus was committed: no group, no rank, no comparison, no contains."""
    ops = {"gt", "gte", "lt", "lte", "eq", "between", "in", "not_in"}
    return not spec.get("logic") and not spec.get("rank") and all(f["op"] in ops for f in spec["filters"])


def test_each_fresh_before_is_what_the_old_surface_gave():
    for i in FRESH_SPECS:
        assert i["before"] == (C.FLAT if _flat_when_written(i["spec"]) else C.NARROWER), i["id"]
    for i in FRESH["items"]:
        if i["spec"] is None:
            assert i["before"] == i["reason"], i["id"]


@pytest.mark.parametrize("item", FRESH_SPECS, ids=_id)
def test_every_fresh_gold_spec_passes_the_real_validator_and_prepares(item):
    C.check_spec(item["spec"])


@pytest.mark.parametrize("item", FRESH_HIDDEN, ids=_id)
def test_every_fresh_hidden_item_is_refused(item):
    key = item["hidden_key"]
    assert key in hidden.hidden_keys()
    with pytest.raises(scan_spec.SpecError):
        scan_spec.validate({"filters": [], "rank": {"criteria": [{"key": key, "weight": 1}]}})


def test_no_fresh_gold_spec_reaches_for_a_hidden_field():
    names = set(hidden.hidden_keys())
    for i in FRESH_SPECS:
        assert not set(scan_spec.named_fields(i["spec"])) & names, i["id"]


def test_the_fresh_held_out_set_is_reported_on_its_own_and_nothing_fell_back():
    r = C.fresh_before_after()
    assert set(r) == {"design", "held_out"}
    for split in r.values():
        assert split["after"]["flat"] >= split["before"]["flat"]
        assert split["after"]["f16_hidden"] == split["before"]["f16_hidden"]
    for i in FRESH["items"]:
        if i["before"] == C.FLAT:
            assert C.classify(i) == C.FLAT, i["id"]


def test_corrections_are_explained():
    for cid, why in BASELINE["corrections"].items():
        assert cid in BASELINE["items"] and len(why) > 30


def test_the_held_out_set_is_reported_on_its_own():
    r = C.before_after()
    assert set(r) == {"design", "held_out"}
    for split in r.values():
        assert split["after"]["spec_exists"] >= split["before"]["spec_exists"]
        assert split["after"]["f16_hidden"] == split["before"]["f16_hidden"]
        assert split["after"]["total"] == split["before"]["total"]


def test_what_a_gold_spec_cannot_claim_stays_a_recorded_gap():
    """A request the primitives only approximate keeps its reason, rather than a near-enough spec."""
    still = {i["text"] for i in ITEMS if i.get("reason") == C.MISSING}
    assert "first close above the 20 ema after 10 days below" in still
    assert "stocks that broke above their 20 day high this week and held" in still
    assert "weekly RSI above 60" in still
