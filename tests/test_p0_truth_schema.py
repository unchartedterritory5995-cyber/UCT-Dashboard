"""P0 acceptance gate -- slice "schema": OWNER DECISION E.

The concierge's ADVERTISED generation schema no longer offers `sym`, `tf` or
`textop` (nor their operands `str` / `symtext`), because this door cannot carry
any of them to an honest answer and P0-conc proved none is end-to-end
(model -> schema -> AST -> definition -> evaluator -> chart). The post-call
`unsupported:node` refusal stays as defence in depth. The formula LANGUAGE is
untouched: a member's manual `sym('SPY', close)` still parses and is canonical.

Every case states ASKED / CLAIMED / DID and classifies the outcome as one of
VALUE, UNKNOWN, REFUSAL, EXACT, DISCLOSED DIFFERENCE, PARTIAL, UNSUPPORTED,
CONTROLLED ERROR.

BEFORE (base 7bd868f34, reproduced 2026-10-05, no paid call):
  * `anthropic_tool()["input_schema"]["$defs"]` held sym, tf, textop, str,
    symtext, and the `node` union offered `#/$defs/tf|sym|textop`. A request
    needing one bought a model call whose tree was then refused post-call at
    `unsupported:node` -- a wasted paid call.
  * The image door deep-copies the same `$defs`, so it offered them too.
AFTER: neither tool offers them; the local BOUNDARY (`tool_schema()["boundary_defs"]`,
a superset) still shape-checks them so a model that emits one anyway is refused
BY NAME, terminally, after exactly one call.

No live model calls: the stub seam is the CLIENT, reused from
`test_p0_truth_conc.py`.
"""
from __future__ import annotations

import json
from typing import Any, Iterator, Set

import pytest

from api.services import ast_table, user_definitions
from api.services import definition_concierge as concierge_mod
from api.services import indicator_from_image as vision
# Fixtures + helpers shared with the P0-conc corpus (imported, not copied).
from tests.test_p0_truth_conc import (  # noqa: F401  (fixtures are used by name)
    CLOSE, ENDPOINT, PLAIN, RS_NEW_HIGH, RS_PROMPT, TEXTOP_TREE, TF_TREE,
    _bars, _parse_back, concierge, http, model, tool_use)

UNADVERTISED = {"sym", "tf", "textop", "str", "symtext"}
ADVERTISED_UNION = ["num", "series", "op", "call", "offset"]


def _walk(obj: Any) -> Iterator[Any]:
    yield obj
    if isinstance(obj, dict):
        for v in obj.values():
            yield from _walk(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk(v)


def _node_types_named(schema: Any) -> Set[str]:
    """Every node type a schema could make a model emit: `type` consts and `$ref`s."""
    out: Set[str] = set()
    for node in _walk(schema):
        if isinstance(node, dict):
            ref = node.get("$ref")
            if isinstance(ref, str):
                out.add(ref.rsplit("/", 1)[-1])
            t = (node.get("properties") or {}).get("type")
            if isinstance(t, dict) and isinstance(t.get("const"), str):
                out.add(t["const"])
    return out


# ═══ 1. the advertised schema ═════════════════════════════════════════════

def test_concierge_tool__ASKED_any_prompt__CLAIMED_offers_sym_tf_textop__DID_offers_none():
    """ASKED: any concierge request. CLAIMED (before): the tool offered sym / tf /
    textop that the door then refuses post-call. DID (after): the input_schema
    the model is handed names none of them, anywhere. OUTCOME: UNSUPPORTED
    (not advertised, so not paid for)."""
    tool = concierge_mod.anthropic_tool()
    schema = tool["input_schema"]
    named = _node_types_named(schema)
    assert named & UNADVERTISED == set(), named & UNADVERTISED
    defs = schema["$defs"]
    assert [r["$ref"].rsplit("/", 1)[-1] for r in defs["node"]["oneOf"]] == ADVERTISED_UNION
    assert set(defs) == set(ADVERTISED_UNION) | {"node"}
    # Non-vacuity: the benchmark roster and the resamplable codes exist; they are
    # simply not in what the model reads.
    text = json.dumps(tool)
    for ticker in ast_table.benchmarks():
        assert f'"{ticker}"' not in text, ticker


def test_concierge_prompt_text_describes_no_unadvertised_shape():
    """ASKED: any request. CLAIMED: the prompt's shape list. DID: it lists the
    five advertised shapes only -- no sym(, tf(, textop, syminfo, text_.
    OUTCOME: EXACT."""
    text = concierge_mod.SYSTEM_PROMPT + concierge_mod.vocabulary_text()
    for needle in ('"sym"', '"tf"', "textop", "symtext", "syminfo", "sym(", "tf(", "text_"):
        assert needle not in text, needle


def test_the_boundary_still_describes_them_so_a_stray_emit_is_shape_checked():
    """The local boundary is a SUPERSET of what is advertised (one derivation):
    sym / tf / textop / str / symtext stay described there. OUTCOME: EXACT."""
    full = concierge_mod.tool_schema()
    boundary = full["boundary_defs"]
    assert UNADVERTISED <= set(boundary)
    assert sorted(boundary["tf"]["properties"]["value"]["enum"]) == \
        sorted(concierge_mod.TF_RESAMPLABLE)
    assert sorted(boundary["sym"]["properties"]["value"]["enum"]) == \
        sorted(ast_table.benchmarks())
    # Every advertised def is byte-identical to its boundary twin.
    adv = full["input_schema"]["$defs"]
    for k in ADVERTISED_UNION:
        assert adv[k] == boundary[k], k
    # Every node type is still either described at the boundary or omitted.
    assert set(concierge_mod.CONCIERGE_OMITS) >= UNADVERTISED


# ═══ 2. defence in depth: a model that emits one anyway ═══════════════════

@pytest.mark.parametrize("tree,needle", [
    (RS_NEW_HIGH, "another instrument (SPY)"),
    (TF_TREE, "higher timeframe (W)"),
    (TEXTOP_TREE, "symbol's text"),
], ids=["sym", "tf", "textop"])
def test_a_model_emitting_an_unadvertised_shape__DID_unsupported_node_one_call(
        http, concierge, model, tree, needle):
    """ASKED: RS vs SPY / weekly read / ticker text. CLAIMED: nothing (the shape
    is not offered). DID: if the model emits it anyway, 200 + `unsupported:node`
    naming why, no ast/source/sentence, exactly ONE call (terminal).
    OUTCOME: UNSUPPORTED."""
    client = model([tool_use(tree), tool_use(tree)])
    res = http.post(ENDPOINT, json={"prompt": RS_PROMPT, "bars": _bars()})
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is False and body["gate"] == "unsupported:node"
    assert needle in body["reason"]
    for leaked in ("ast", "source", "sentence"):
        assert leaked not in body
    assert len(client.calls) == 1
    # And the tool the model was handed on that very call offered no such shape.
    sent = client.calls[0]["tools"][0]["input_schema"]
    assert _node_types_named(sent) & UNADVERTISED == set()


def test_a_plain_tree_still_succeeds_under_the_narrowed_schema(http, concierge, model):
    """ASKED: a 20-bar average. DID: ok, with the derived source. OUTCOME: VALUE."""
    model([tool_use(PLAIN)])
    res = http.post(ENDPOINT, json={"prompt": "a twenty bar average of close",
                                    "bars": _bars()})
    body = res.json()
    assert res.status_code == 200 and body["ok"] is True, body
    assert body["source"] == "sma(close, 20)"


# ═══ 3. the formula LANGUAGE is untouched ═════════════════════════════════

def test_manual_sym_formula__ASKED_sym_SPY_close__DID_parses_and_is_canonical():
    """ASKED: a member types `sym('SPY', close)` by hand. CLAIMED: supported.
    DID: `parse.js` parses it to the canonical `sym` node (same astHash), the
    store's NODE_TYPES and `closedTable.json` still declare sym/tf/textop, and
    `assert_canonical` accepts the tree. OUTCOME: EXACT."""
    sym_tree = {"type": "sym", "value": "SPY", "args": [CLOSE]}
    tf_tree = {"type": "tf", "value": "W", "args": [CLOSE]}
    rows = _parse_back({
        "sym": (sym_tree, "sym('SPY', close)"),
        "tf": (tf_tree, "tf(close, 'W')"),
        "rs": (RS_NEW_HIGH,
               "((close / sym('SPY', close)) >= highest((close / sym('SPY', close)), 63))"),
    })
    assert rows == {"sym": {"same": True}, "tf": {"same": True}, "rs": {"same": True}}, rows
    for t in ("sym", "tf", "textop", "str", "symtext"):
        assert t in user_definitions.NODE_TYPES, t
    canonical = ast_table.TABLE.get("_canonical", "")
    assert "sym" in canonical and "textop" in canonical
    user_definitions.assert_canonical(sym_tree)
    user_definitions.assert_canonical(TEXTOP_TREE)


# ═══ 4. the image door follows ════════════════════════════════════════════

def test_image_door__DID_offers_exactly_the_concierge_advertised_defs():
    """ASKED: a screenshot. CLAIMED (before): the same sym/tf/textop offer.
    DID: the vision tool's `$defs` equal the concierge's ADVERTISED `$defs`, and
    each candidate's tree is `#/$defs/node`. OUTCOME: EXACT."""
    tool = vision.anthropic_tool()
    schema = tool["input_schema"]
    assert schema["$defs"] == concierge_mod.anthropic_tool()["input_schema"]["$defs"]
    assert _node_types_named(schema) & UNADVERTISED == set()
    item = schema["properties"][vision.CANDIDATES]["items"]
    assert item["properties"][vision.CANDIDATE_TREE] == {"$ref": "#/$defs/node"}


# ═══ 5. pre-call rejection: recorded, not built ═══════════════════════════

@pytest.mark.parametrize("prompt", [
    "RS line versus SPY at a 52 week high",
    "weekly close above the 10 week sma",
])
def test_plan_does_not_pre_refuse_other_symbol_or_HTF_asks__DISCLOSED(prompt):
    """ASKED: an explicit other-symbol / higher-timeframe request. CLAIMED: the
    deterministic `plan()` would refuse it before the paid call. DID: it does
    NOT -- `plan()` only refuses lexicon `_refused` words (the firm-reviewed,
    browser-shared conceptVocabulary.json) and 2+-word Title-Case names; a lone
    ticker or "weekly" matches neither, and "weekly" is legitimately the chart's
    own timeframe (`isweekly`). Building a detector would be a new intent
    classifier (out of scope). The request reaches the model, which is no longer
    OFFERED sym/tf and so must answer `unresolved` or emit a tree that the
    post-call gate judges. OUTCOME: DISCLOSED DIFFERENCE (one call, no repair)."""
    out = concierge_mod.plan(prompt)
    assert out["not_understood"] == []
