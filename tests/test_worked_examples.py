"""L5: worked examples for Create Indicator.

The set is UCT's own house indicators as they were described and built. Three things are held here:
ADMISSION (every example passes the door's own check and is the indicator the UCT tab ships),
RETRIEVAL (a paraphrase meets its example; an unrelated request meets none), and the DOOR (dark for
members; an admin turn that asks gets them, only for a new indicator, and never at the cost of a turn).

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import json
import pathlib

import pytest

from api.services import indicator_telemetry as telemetry
from api.services import worked_examples as we
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    RSI_GT_70, conv, emits, empty_view, env, model, out, view,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

ROOT = pathlib.Path(__file__).resolve().parents[1]
HOUSE = json.loads((ROOT / "app/src/components/chart/house/houseIndicators.json").read_text(encoding="utf-8"))
EXAMPLES = we.all_examples()
CREATE = {"op": "create", "name": "EMA 20", "outputs": [{"key": "e", "tree": {
    "type": "call", "name": "ema", "args": [{"type": "series", "name": "close"}, {"type": "num", "value": 20}]}}]}
ASK = "show me how stretched price is from the 50 day in ATRs"


def _sent(client, call=0) -> str:
    return json.dumps(client.calls[call]["messages"], ensure_ascii=False)


# ═══ admission ════════════════════════════════════════════════════════════════════════════════
def test_the_set_is_exactly_the_house_set():
    assert [e["id"] for e in EXAMPLES] == [i["slug"] for i in HOUSE["indicators"]]
    assert len({e["request"] for e in EXAMPLES}) == len(EXAMPLES)


@pytest.mark.parametrize("ex", EXAMPLES, ids=lambda e: e["id"])
def test_every_example_passes_the_doors_own_check(conv, ex):
    envelope = {"contract": "uct.authoring.patch/1", "baseRevision": 0, "disposition": "change", "ops": ex["ops"]}
    checked = conv.check_envelope(envelope, 0, empty_view(0))               # raises _Refused on any fault
    assert checked["ops"] == ex["ops"]                                      # and returns it unchanged
    created = [o for o in ex["ops"] if o.get("op") == "create"]
    assert len(created) == 1 and created[0].get("outputs")


@pytest.mark.parametrize("ex", EXAMPLES, ids=lambda e: e["id"])
def test_every_example_is_the_indicator_the_UCT_tab_ships(ex):
    """The same output keys as the shipped definition, whose values the value rail checks."""
    item = next(i for i in HOUSE["indicators"] if i["slug"] == ex["id"])
    made = [o["key"] for o in next(o for o in ex["ops"] if o["op"] == "create")["outputs"]]
    shipped = [p["key"] for p in item["definition"]["plots"]]
    assert set(made) <= set(shipped), (made, shipped)


def test_an_example_carries_no_member_data_and_nothing_private():
    blob = json.dumps(EXAMPLES).lower()
    for banned in ("@", "http", "password", "token", "u_"):
        assert banned not in blob, banned


# ═══ retrieval ════════════════════════════════════════════════════════════════════════════════
@pytest.mark.parametrize("words,first", [
    (ASK, "atr_extension"),
    ("count the distribution days", "distribution_day_count"),
    ("mark follow through days", "follow_through_day"),
    ("FTD", "follow_through_day"),
    ("show the ADR", "average_daily_range"),
    ("tight closes on the weekly", "tight_weekly_closes"),
    ("flat base", "flat_base"),
    ("gap ups on big volume", "gap_up_on_volume"),
    ("paint inside days", "inside_outside_bars"),
    ("new high in relative strength before price", "rs_new_high_vs_spy"),
])
def test_a_paraphrase_meets_its_example(words, first):
    got = we.nearest(words)
    assert we.ids_of(got)[0] == first
    assert 1 <= len(got) <= we.MAX_EXAMPLES
    assert all(set(g) == {"request", "ops", "rule"} for g in got)


@pytest.mark.parametrize("words", ["RSI under 30", "bollinger band squeeze", "a 20 EMA",
                                   "anchored vwap from the last earnings gap", "", None, "   "])
def test_an_unrelated_request_meets_none(words):
    assert we.nearest(words) == []


def test_retrieval_is_deterministic_and_never_raises():
    assert we.nearest(ASK) == we.nearest(ASK)
    assert we.nearest({"not": "text"}) == [] or isinstance(we.nearest({"not": "text"}), list)


# ═══ the switch ═══════════════════════════════════════════════════════════════════════════════
def test_off_for_everyone_by_default_and_on_only_as_stated(monkeypatch):
    monkeypatch.delenv("CONVERSE_WORKED_EXAMPLES", raising=False)
    assert we.enabled() is False
    assert we.enabled(admin=True) is False                 # an admin who does not ask
    assert we.enabled(asked=True) is False                 # a member who asks
    assert we.enabled(admin=True, asked=True) is True      # the measuring lane
    monkeypatch.setenv("CONVERSE_WORKED_EXAMPLES", "1")
    assert we.enabled() is True
    monkeypatch.setenv("CONVERSE_WORKED_EXAMPLES", "0")
    assert we.enabled() is False


# ═══ the door ═════════════════════════════════════════════════════════════════════════════════
def test_an_admin_turn_that_asks_carries_the_nearest_examples_as_data(conv, clean_env, model):
    client = model([emits(env(0, [CREATE]))])
    r = conv.converse(ASK, user_id="a1", view=empty_view(0), admin=True, examples=True)
    assert r["ok"] is True
    sent = _sent(client)
    assert "worked_examples" in sent and "multiples of the 1" in sent      # the ATR extension request
    assert r["usage"]["examples"] >= 1
    # inside the notes block, which the instructions already call data; the instructions did not move
    assert sent.index("worked_examples") > sent.index("uct_language_notes")
    assert "worked_examples" not in conv.system_prompt()


@pytest.mark.parametrize("kwargs,why", [
    ({"admin": False, "examples": True}, "a member who asks"),
    ({"admin": True, "examples": False}, "an admin who does not ask"),
    ({"admin": True}, "the default"),
    ({"admin": True, "examples": "yes"}, "anything but the literal True"),
])
def test_everyone_else_gets_exactly_the_turn_they_got_before(conv, clean_env, model, kwargs, why):
    client = model([emits(env(0, [CREATE]))])
    r = conv.converse(ASK, user_id="m1", view=empty_view(0), **kwargs)
    assert r["ok"] is True, why
    assert "worked_examples" not in _sent(client), why
    assert r["usage"]["examples"] is None, why


def test_a_refinement_carries_none(conv, clean_env, model):
    client = model([emits(env(1, [{"op": "set_slot", "slot": "value#0.1", "value": 21}]))])
    conv.converse(ASK, user_id="a1", view=view(1, [out("value", RSI_GT_70)]), admin=True, examples=True)
    assert "worked_examples" not in _sent(client)


def _turn_chars(client) -> int:
    content = client.calls[0]["messages"][0]["content"]
    return len(content) if isinstance(content, str) else sum(len(b.get("text") or "") for b in content if isinstance(b, dict))


def test_examples_never_cost_a_turn_when_they_would_not_fit(conv, clean_env, model, monkeypatch):
    plain_client = model([emits(env(0, [CREATE]))])
    conv.converse(ASK, user_id="a0", view=empty_view(0), admin=True)                 # the same turn, no examples
    room = _turn_chars(plain_client) + 200                                              # fits the turn, not an example
    monkeypatch.setattr(conv, "MAX_INPUT_CHARS", room)
    client = model([emits(env(0, [CREATE]))])
    r = conv.converse(ASK, user_id="a1", view=empty_view(0), admin=True, examples=True)
    assert r["ok"] is True                                                             # not refused as too large
    assert "worked_examples" not in _sent(client) and r["usage"]["examples"] is None
    # control: with room, the same call carries them
    monkeypatch.setattr(conv, "MAX_INPUT_CHARS", 48_000)
    roomy = model([emits(env(0, [CREATE]))])
    conv.converse(ASK, user_id="a2", view=empty_view(0), admin=True, examples=True)
    assert "worked_examples" in _sent(roomy)


def test_the_count_is_an_allowed_telemetry_field():
    assert telemetry.EVENT_SCHEMAS["converse_turn"]["examples"] == (int,)
