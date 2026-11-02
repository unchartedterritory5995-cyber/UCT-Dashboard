"""ADR-005 layers built in Sprint 2 (agent-lead):

* L2 — the gateway stamps `isolated: true` on every envelope of a model-isolated kind (from the kind's own
  declaration, never the adapter's), and only those.
* L6 — run_turn removes anything carrying the marker from the request's model-bound inputs, and replays a stored
  history row whose data carries it as unreadable. The member's own words are never touched."""
from __future__ import annotations

import json
import types

import pytest

from api.services.uct_agent import turn
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw

SECRET = "987.654"


# ── L2 ──────────────────────────────────────────────────────────────────────────────────────────────
@pytest.fixture()
def isolated_on(monkeypatch):
    for name in (gw.DATA_ENV, gw.ISOLATED_ENV):
        monkeypatch.setenv(name, "1")
    monkeypatch.setenv(gw.KINDS_ENV, "sealed,plain")

    def fn(name, stamp=None):
        def _f(params, ctx):
            out = env.make_envelope(name, params, status="ok", freshness="periodic", as_of="2026-11-01T20:00:00Z",
                                    source="fixture", data={"v": SECRET})
            if stamp is not None:
                out["isolated"] = stamp
            return out
        return _f
    r = gw.Registry()
    r.register(gw.Kind(name="sealed", fn=fn("sealed"), freshness="periodic", model_isolated=True))
    r.register(gw.Kind(name="plain", fn=fn("plain"), freshness="periodic"))
    gw._reset_for_test(r)
    yield r
    gw._reset_for_test(None)


def _read(kind):
    return gw.read(kind, {}, user_id=1, turn_id=f"l2-{kind}", purpose="answer")


def test_L2_an_isolated_kind_is_stamped_by_the_gateway(isolated_on):
    out = _read("sealed")
    assert out["status"] == "ok" and out["isolated"] is True and env.validate_envelope(out) == []


def test_L2_an_ordinary_kind_is_not_stamped(isolated_on):
    assert "isolated" not in _read("plain")


def test_L2_the_adapter_cannot_unstamp_it(isolated_on):
    r = gw.Registry()

    def sneaky(params, ctx):
        out = env.make_envelope("sealed", params, status="ok", freshness="periodic", as_of="2026-11-01T20:00:00Z",
                                source="fixture", data={"v": SECRET})
        out["isolated"] = False
        return out
    r.register(gw.Kind(name="sealed", fn=sneaky, freshness="periodic", model_isolated=True))
    gw._reset_for_test(r)
    out = _read("sealed")
    assert out.get("isolated") is True and out["data"] is None   # contract break -> unavailable, still stamped


def test_L2_validation_rejects_a_false_marker():
    e = env.make_envelope("x", {}, status="ok", freshness="periodic", as_of="2026-11-01T20:00:00Z", source="s")
    e["isolated"] = False
    assert "isolated, when present, must be true (ADR-005 L2)" in env.validate_envelope(e)


# ── L6 ──────────────────────────────────────────────────────────────────────────────────────────────
MARKED = {"kind": "ratings", "isolated": True, "data": {"composite": SECRET}}


def _sent(**kw):
    calls = []

    def caller(**k):
        calls.append(k)
        return types.SimpleNamespace(
            content=[types.SimpleNamespace(type="text", text=json.dumps(
                {"disposition": "answer", "reply": "ok", "ops": [], "question": None, "unsupported_category": None}))],
            stop_reason="end_turn", usage=types.SimpleNamespace(input_tokens=10, output_tokens=5))
    args = dict(message="what about it?", context={}, history=[], capabilities=[], caller=caller)
    args.update(kw)
    try:
        turn.run_turn(**args)
    except Exception:  # noqa: BLE001 — what was SENT is the question
        pass
    assert calls, "the model call was not reached: the test would pass vacuously"
    return json.dumps(calls[0], ensure_ascii=False, default=str)


@pytest.mark.parametrize("where", ["context", "pending", "reference", "repair"])
def test_L6_a_marked_object_never_reaches_the_model(where):
    nested = {"widgets": [{"ref": "w1", "last": MARKED}, {"ref": "w2"}]}
    assert SECRET not in _sent(**{where: nested})


def test_L6_a_marked_top_level_input_is_dropped_whole():
    assert SECRET not in _sent(context=MARKED)


def test_L6_a_history_row_carrying_the_marker_is_never_replayed():
    history = [{"role": "member", "text": "show NVDA's rating", "data": {}},
               {"role": "outcome", "text": f"NVDA rating {SECRET}",
                "data": {"kind": "answered", "actions": ["stock.profile"], "rows": [MARKED]}},
               {"role": "agent", "text": f"rating {SECRET}", "data": {"envelope": {"ops": []}, "seen": MARKED}}]
    sent = _sent(history=history)
    assert SECRET not in sent and "show NVDA's rating" in sent   # the member's own words stay


def test_L6_an_unmarked_request_is_unchanged():
    ctx = {"widgets": [{"ref": "w1", "symbol": "NVDA", "note": "isolated is just a word here"}]}
    c, p, r, rp, h, n = turn.strip_isolated_request(ctx, None, None, None, [{"role": "outcome", "text": "x", "data": {"kind": "undo"}}])
    assert n == 0 and c == ctx and h[0]["data"] == {"kind": "undo"}


def test_L6_counts_what_it_removed():
    *_, n = turn.strip_isolated_request({"a": MARKED, "b": [MARKED, 1]}, MARKED, None, None, [])
    assert n == 3
