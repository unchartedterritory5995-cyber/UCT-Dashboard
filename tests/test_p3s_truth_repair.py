"""P3S PRIORITY 1 -- the near-100% repair rate.

MEASURED (P3R, real model, 17 turns): 16 paid a repair call, every one at
``envelope:schema``. The captured first-pass trace (the P2 ``railway run`` diag,
re-read for P3S) is the SAME on every turn: the tool input's only key is ``args``
-- "Additional properties are not allowed ('args' was unexpected); 'contract' is a
required property; ..." -- and the repair answer carries the identical envelope at
the top level (keys assumptions/baseRevision/contract/disposition/ops/reply).

FIX: ``_unwrap_input`` removes exactly that one wrapper at the EXTRACTION boundary;
``check_envelope`` (unchanged) then validates the inner envelope as strictly as a
top-level one. The tool description also says where the fields belong.

These rails pin: the failure shape is accepted on the FIRST call (1 call, no
repair), and nothing else got more permissive -- a wrapped malformed patch is still
refused and repaired, a wrapper beside other keys is not unwrapped, a non-object
wrapper is not unwrapped, an unknown wrapper is not unwrapped, and the repair
fallback still works for a genuine mistake.
"""
from __future__ import annotations

import pytest

from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    RSI_GT_70, conv, emits, empty_view, env, model, out, view,
)

GOOD_SET = {"op": "set_slot", "slot": "value#1", "value": 80}


def test_the_captured_first_pass_shape_is_accepted_on_the_first_call(conv, model):
    """ASKED: does the real model's measured first answer -- the whole envelope
    under ``args`` -- still cost a repair? CLAIMED: no; unwrapped once and validated
    strictly. DID: ok, 1 call, attempts 1, repair_gate None, input_wrapper 'args',
    and the envelope returned is the INNER one, unchanged."""
    inner = env(1, [GOOD_SET], reply="Made it 80.")
    client = model([emits({"args": inner})])
    r = conv.converse("make it 80", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    assert r["ok"] is True and r["disposition"] == "change"
    assert r["envelope"] == inner and r["attempts"] == 1 and len(client.calls) == 1
    assert r["usage"]["repair_gate"] is None
    assert r["usage"]["input_wrapper"] == "args"
    assert r["usage"]["calls"] == 1


def test_a_bare_answer_records_no_wrapper(conv, model):
    good = env(1, [GOOD_SET])
    model([emits(good)])
    r = conv.converse("make it 80", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    assert r["ok"] is True and r["usage"]["input_wrapper"] is None and r["attempts"] == 1


@pytest.mark.parametrize("disposition,payload", [
    ("answer", {"reply": "It reads the 14-bar RSI."}),
    ("clarify", {"questions": [{"id": "q1", "text": "Which length?"}]}),
    ("unsupported", {"reply": "Tables are not drawable yet."}),
])
def test_every_TALK_disposition_survives_the_wrapper_and_still_never_mutates(conv, model, disposition, payload):
    inner = {"contract": "uct.authoring.patch/1", "baseRevision": 2, "ops": [],
             "disposition": disposition, **payload}
    client = model([emits({"args": inner})])
    r = conv.converse("what is this?", user_id="u1", view=view(2, [out("value", RSI_GT_70)]))
    assert r["ok"] is True and r["disposition"] == disposition
    assert r["envelope"]["ops"] == [] and len(client.calls) == 1


def test_a_wrapped_MALFORMED_patch_is_still_refused_and_repaired(conv, model):
    """ASKED: did unwrapping make validation permissive? CLAIMED: no. DID: the
    inner envelope (set_slot with no value) is refused at envelope:schema and the
    turn pays the repair exactly as an unwrapped malformed patch would."""
    bad = env(1, [{"op": "set_slot", "slot": "value#1"}])
    good = env(1, [GOOD_SET])
    client = model([emits({"args": bad}), emits(good)])
    r = conv.converse("make it 80", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    assert r["ok"] is True and r["attempts"] == 2 and len(client.calls) == 2
    assert r["usage"]["repair_gate"] == "envelope:schema"
    last = client.calls[1]["messages"][-1]["content"][0]
    assert last["type"] == "tool_result" and last["is_error"] is True


def test_a_wrapped_stale_revision_is_still_refused(conv, model):
    stale = env(0, [GOOD_SET])
    model([emits({"args": stale}), emits({"args": stale})])
    r = conv.converse("make it 80", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    assert r["ok"] is False and r["gate"] == "envelope:revision" and "envelope" not in r


def test_a_wrapped_disposition_lie_is_still_refused(conv, model):
    lie = env(1, [GOOD_SET], disposition="answer", reply="Nothing changes.")
    model([emits({"args": lie}), emits({"args": lie})])
    r = conv.converse("what is it?", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    assert r["ok"] is False and r["gate"] == "envelope:disposition"


@pytest.mark.parametrize("shape", [
    {"args": env(1, [GOOD_SET]), "contract": "uct.authoring.patch/1"},   # beside other keys
    {"args": "not an object"},                                            # not an object
    {"args": [env(1, [GOOD_SET])]},                                       # a list
    {"input": env(1, [GOOD_SET])},                                        # a wrapper never measured
    {"parameters": env(1, [GOOD_SET])},
])
def test_only_the_one_measured_wrapper_shape_is_unwrapped(conv, model, shape):
    client = model([emits(shape), emits(shape)])
    r = conv.converse("make it 80", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    assert r["ok"] is False and r["gate"] == "envelope:schema"
    assert len(client.calls) == 2 and "envelope" not in r


def test_a_wrapped_scalar_or_unsupported_node_is_still_refused(conv, model):
    tree = {"type": "op", "name": ">=", "args": [{"type": "series", "name": "rsi14"},
                                                {"type": "num", "value": 70}]}
    e = env(1, [{"op": "set_output_tree", "output": "value", "tree": tree}])
    model([emits({"args": e})])
    r = conv.converse("use rsi14", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    assert r["ok"] is False and r["gate"] == "unsupported:scalar"


def test_the_contract_defines_no_property_the_unwrap_could_shadow(conv):
    props = conv.composed_schema()["properties"]
    for name in conv.INPUT_WRAPPERS:
        assert name not in props


def test_the_tool_tells_the_model_where_the_fields_belong(conv):
    d = conv.anthropic_tool()["description"]
    assert "TOP LEVEL" in d and '"args"' in d


def test_a_create_from_empty_is_accepted_wrapped_on_the_first_call(conv, model):
    """The P3R turn-1 case: 'Add a 20 EMA.' on an empty view."""
    ema = {"type": "call", "name": "ema", "args": [{"type": "series", "name": "close"},
                                                   {"type": "num", "value": 20}]}
    inner = env(0, [{"op": "create", "name": "EMA 20", "outputs": [{"key": "ema20", "tree": ema}]}])
    client = model([emits({"args": inner})])
    r = conv.converse("Add a 20 EMA.", user_id="u1", view=empty_view(0))
    assert r["ok"] is True and r["turn"] == "patch" and len(client.calls) == 1
    assert r["usage"]["usd"] == r["usage"]["per_call"][0]["usd"]


# ═══ P3S -- the constant prefix is cached, and the ledger charges every token ═══

from tests.test_p2_truth_server import _B  # noqa: E402


def _emits_cached(envelope, *, inp, out, read, write):
    from api.services import definition_conversation as conv
    return _B(content=[_B(type="tool_use", id="tu_c", name=conv.TOOL_NAME, input=envelope)],
              stop_reason="tool_use",
              usage=_B(input_tokens=inp, output_tokens=out,
                       cache_read_input_tokens=read, cache_creation_input_tokens=write))


def test_the_system_prompt_carries_ONE_cache_breakpoint_and_the_tool_is_unchanged(conv, model):
    client = model([emits(env(1, [GOOD_SET]))])
    conv.converse("make it 80", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    sent = client.calls[0]
    assert sent["system"] == conv.system_blocks()
    assert sent["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert sent["system"][0]["text"] == conv.system_prompt()
    assert sent["tools"] == [conv.anthropic_tool()] and "cache_control" not in sent["tools"][0]


def test_cache_reads_and_writes_are_charged_at_the_ledgers_own_prices(conv, model):
    """ASKED: with caching, ``input_tokens`` is only the uncached part -- is the cached
    prefix still charged? CLAIMED: yes, through ``cost_guard.record``'s cache fields.
    DID: the turn's usd equals ``estimate_cost`` over all four token classes."""
    from api.services.catalyst import cost_guard
    from api.services import definition_concierge as dc
    model([_emits_cached(env(1, [GOOD_SET]), inp=600, out=300, read=14000, write=0)])
    r = conv.converse("make it 80", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    want = cost_guard.estimate_cost(dc.MODEL, 600, 300, cache_read_tokens=14000, cache_creation_tokens=0)
    assert r["usage"]["usd"] == round(want, 6) and want > 0
    call = r["usage"]["per_call"][0]
    assert call["cache_read_tokens"] == 14000 and call["cache_creation_tokens"] == 0
    # a cache WRITE costs more than a read of the same prefix (1.25x vs 0.1x)
    w = cost_guard.estimate_cost(dc.MODEL, 600, 300, cache_read_tokens=0, cache_creation_tokens=14000)
    assert w > want


def test_a_response_without_cache_fields_is_priced_exactly_as_before(conv, model):
    from api.services.catalyst import cost_guard
    from api.services import definition_concierge as dc
    model([emits(env(1, [GOOD_SET]), tokens=(14600, 300))])
    r = conv.converse("make it 80", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    assert r["usage"]["usd"] == round(cost_guard.estimate_cost(dc.MODEL, 14600, 300), 6)
    assert r["usage"]["per_call"][0]["cache_read_tokens"] == 0
