"""W5-T11 rails: the lane adapter (`api/services/runtime_server_lane.py`).

`runtime_column_fn(row, plot_key, lane)` asks `engine_withheld_reason` (5.2 step 2) and
`server_lane_refusal` (step 4, W5-T12's, reached through `runtime_definitions` at call time and
faked here) on EVERY call, BEFORE any service call, even with the cycle's cache warm. A refusal
raises `ServerLaneWithheld` by name; it is never an empty column. NO NETWORK: the client talks to
`tests/fakes/pine_runtime_fake.PineRuntimeFake`.
"""
from __future__ import annotations

import math

import pytest

from api.services import pine_runtime_client as prc
from api.services import runtime_definitions, user_definitions
from api.services import runtime_server_lane as lane_mod
from tests.fakes.pine_runtime_fake import FIXTURE_IDENTITY, FIXTURE_SECRET, PineRuntimeFake, bars_fixture

ROW = {"def_id": "u_0123456789ab", "version": 3, "user_id": "user-42",
       "definition": {"id": "u_0123456789ab", "meta": {},
                      "compute": {"kind": "runtime", "source": "//@version=6\nindicator('x')\nplot(close)",
                                  "outputs": ["value", "signal"]}}}
T0 = 1_762_200_000


@pytest.fixture(autouse=True)
def _fresh_signing_memory():
    prc._forget_signing_times()
    yield
    prc._forget_signing_times()


class Switches:
    """The two per-call questions, faked; each records that it was asked."""

    def __init__(self):
        self.verdict = None
        self.refusal = None
        self.asked = []

    def engine_withheld_reason(self, row, current=None):
        self.asked.append("verdict")
        return self.verdict

    def server_lane_refusal(self, row, *, lane):
        self.asked.append(("admission", lane))
        return self.refusal


@pytest.fixture
def world(monkeypatch):
    sw = Switches()
    monkeypatch.setattr(user_definitions, "engine_withheld_reason", sw.engine_withheld_reason)
    monkeypatch.setattr(runtime_definitions, "server_lane_refusal", sw.server_lane_refusal, raising=False)
    fake = PineRuntimeFake()
    make = lambda: prc.PineRuntimeClient(url="http://pine-runtime.test", secret=FIXTURE_SECRET,  # noqa: E731
                                         identity=FIXTURE_IDENTITY, transport=fake, clock=lambda: T0)
    return sw, fake, make


def call(fn, bars=None):
    return fn(bars or bars_fixture(5), {}, tf="D", ticker="AAPL")


def test_admitted_call_returns_the_plot_column(world):
    sw, fake, make = world
    fn = lane_mod.runtime_column_fn(ROW, "value", "alert", client_factory=make)
    col = call(fn)
    assert col == [2 * b["c"] for b in bars_fixture(5)]
    assert sw.asked == ["verdict", ("admission", "alert")] and len(fake.calls) == 1
    req = fake.calls[0]
    assert req["profile"] == "alert" and req["jobs"][0]["want"] == ["value"]
    assert req["definition"]["def_id"] == "u_0123456789ab" and req["definition"]["version"] == 3


def test_both_questions_are_asked_on_every_call(world):
    sw, fake, make = world
    fn = lane_mod.runtime_column_fn(ROW, "value", "sweep", client_factory=make)
    for _ in range(3):
        call(fn)
    assert sw.asked == ["verdict", ("admission", "sweep")] * 3


def test_a_kill_reaches_the_next_call_even_with_the_cache_warm(world):
    sw, fake, make = world
    cache = prc.RunCache()
    fn = lane_mod.runtime_column_fn(ROW, "value", "alert", client_factory=make, cache=cache)
    call(fn)
    assert len(cache) == 1
    sw.refusal = ("runtime:killed", "definition `u_0123456789ab` is on the kill list")
    with pytest.raises(lane_mod.ServerLaneWithheld) as e:
        call(fn)
    assert e.value.guard == "runtime:killed" and "kill list" in e.value.sentence
    assert len(fake.urls) == 1  # no service call for a refused admission
    sw.refusal = None
    call(fn)
    assert len(fake.urls) == 1  # admitted again: the cycle cache answers


def test_a_stored_verdict_reaches_the_next_call(world):
    sw, fake, make = world
    fn = lane_mod.runtime_column_fn(ROW, "value", "alert", client_factory=make)
    call(fn)
    sw.verdict = "engine-refused: this version was refused by engine 4"
    with pytest.raises(lane_mod.ServerLaneWithheld) as e:
        call(fn)
    assert e.value.guard == lane_mod.VERDICT_GUARD and "engine 4" in e.value.sentence
    assert len(fake.urls) == 1


def test_the_verdict_is_asked_before_the_admission(world):
    sw, fake, make = world
    sw.verdict = "engine-refused"
    sw.refusal = ("runtime:server-stage", "off")
    fn = lane_mod.runtime_column_fn(ROW, "value", "alert", client_factory=make)
    with pytest.raises(lane_mod.ServerLaneWithheld) as e:
        call(fn)
    assert e.value.guard == lane_mod.VERDICT_GUARD and sw.asked == ["verdict"]


@pytest.mark.parametrize("guard", ["runtime:killed", "runtime:not-yet-graded", "runtime:stage",
                                   "runtime:server-stage", "runtime:server-unavailable"])
def test_every_admission_refusal_is_raised_by_its_own_name_with_no_service_call(world, guard):
    sw, fake, make = world
    sw.refusal = (guard, f"sentence for {guard}")
    fn = lane_mod.runtime_column_fn(ROW, "value", "on-demand", client_factory=make)
    with pytest.raises(lane_mod.ServerLaneWithheld) as e:
        call(fn)
    assert (e.value.guard, e.value.sentence) == (guard, f"sentence for {guard}") and fake.urls == []


def test_a_build_without_server_lane_refusal_refuses_every_call(world, monkeypatch):
    sw, fake, make = world
    monkeypatch.delattr(runtime_definitions, "server_lane_refusal", raising=False)
    fn = lane_mod.runtime_column_fn(ROW, "value", "alert", client_factory=make)
    with pytest.raises(lane_mod.ServerLaneWithheld) as e:
        call(fn)
    assert e.value.guard == prc.UNAVAILABLE and fake.urls == []


@pytest.mark.parametrize("answer", [("runtime:killed",), ("", "x"), "runtime:killed", 0, False, ["a", "b"]])
def test_a_malformed_admission_answer_refuses(world, monkeypatch, answer):
    sw, fake, make = world
    monkeypatch.setattr(runtime_definitions, "server_lane_refusal", lambda row, *, lane: answer, raising=False)
    fn = lane_mod.runtime_column_fn(ROW, "value", "alert", client_factory=make)
    with pytest.raises(lane_mod.ServerLaneWithheld) as e:
        call(fn)
    assert e.value.guard == prc.UNAVAILABLE and fake.urls == []


def test_an_admission_that_raises_refuses(world, monkeypatch):
    sw, fake, make = world

    def boom(row, *, lane):
        raise RuntimeError("db down")
    monkeypatch.setattr(runtime_definitions, "server_lane_refusal", boom, raising=False)
    fn = lane_mod.runtime_column_fn(ROW, "value", "alert", client_factory=make)
    with pytest.raises(lane_mod.ServerLaneWithheld) as e:
        call(fn)
    assert e.value.guard == prc.UNAVAILABLE and fake.urls == []


def test_a_verdict_read_that_raises_withholds(world, monkeypatch):
    sw, fake, make = world

    def boom(row, current=None):
        raise RuntimeError("bad row")
    monkeypatch.setattr(user_definitions, "engine_withheld_reason", boom)
    fn = lane_mod.runtime_column_fn(ROW, "value", "alert", client_factory=make)
    with pytest.raises(lane_mod.ServerLaneWithheld) as e:
        call(fn)
    assert e.value.guard == lane_mod.VERDICT_GUARD and fake.urls == []


def test_a_run_refusal_is_raised_never_an_empty_column(world):
    sw, fake, make = world
    fake.withhold["AAPL|D"] = ("runtime:limit", "the script ran past its instruction budget")
    fn = lane_mod.runtime_column_fn(ROW, "value", "sweep", client_factory=make)
    with pytest.raises(lane_mod.ServerLaneWithheld) as e:
        call(fn)
    assert e.value.guard == "runtime:limit" and "instruction budget" in e.value.sentence


def test_a_per_output_refusal_is_raised_for_that_plot_and_the_sibling_runs(world):
    sw, fake, make = world
    fake.refuse_output["signal"] = ("runtime:server-drawings", "not served yet")
    with pytest.raises(lane_mod.ServerLaneWithheld) as e:
        call(lane_mod.runtime_column_fn(ROW, "signal", "alert", client_factory=make))
    assert e.value.guard == "runtime:server-drawings"
    assert len(call(lane_mod.runtime_column_fn(ROW, "value", "alert", client_factory=make))) == 5


def test_a_transport_failure_is_raised_by_name(world):
    sw, fake, make = world
    fake.script_next = [(503, b"")]
    with pytest.raises(lane_mod.ServerLaneWithheld) as e:
        call(lane_mod.runtime_column_fn(ROW, "value", "alert", client_factory=make))
    assert e.value.guard == prc.UNAVAILABLE


def test_never_partial_through_the_lane_a_short_column_raises_integrity(world):
    sw, fake, make = world
    from tests.fakes.pine_runtime_fake import b64_column
    fake.tamper = lambda reply: (reply["results"][0]["columns"].update(value=b64_column([1.0] * 4)), reply)[1]
    with pytest.raises(lane_mod.ServerLaneWithheld) as e:
        call(lane_mod.runtime_column_fn(ROW, "value", "alert", client_factory=make))
    assert e.value.guard == prc.INTEGRITY


def test_never_stale_through_the_lane_new_bars_new_value(world):
    sw, fake, make = world
    cache = prc.RunCache()
    fn = lane_mod.runtime_column_fn(ROW, "value", "alert", client_factory=make, cache=cache)
    a = call(fn, bars_fixture(5))
    b = call(fn, bars_fixture(6))
    assert len(fake.calls) == 2 and len(a) == 5 and len(b) == 6


def test_params_are_the_scripts_inputs_and_na_survives(world):
    sw, fake, make = world
    fn = lane_mod.runtime_column_fn(ROW, "signal", "backtest", client_factory=make)
    col = fn(bars_fixture(5), {"length": 14, "src": "close"}, tf="D", ticker="AAPL", exchange="NASDAQ",
             history_from_listing=True)
    j = fake.calls[0]["jobs"][0]
    assert j["ctx"] == {"newestBarIsForming": False, "historyFromListing": True,
                        "runtimeInputs": {"length": 14, "src": "close"}}
    assert j["symbol"] == {"ticker": "AAPL", "exchange": "NASDAQ"}
    assert math.isnan(col[0]) and len(col) == 5


def test_an_unknown_lane_is_a_programming_error():
    with pytest.raises(ValueError):
        lane_mod.runtime_column_fn(ROW, "value", "nightly")


def test_the_default_client_is_read_per_call(world, monkeypatch):
    sw, fake, _ = world
    made = []

    def factory(transport=None, identity="read"):
        made.append(1)
        return prc.PineRuntimeClient(url=None, secret=None, identity=None)
    monkeypatch.setattr(prc, "client_from_env", factory)
    fn = lane_mod.runtime_column_fn(ROW, "value", "alert")
    for _ in range(2):
        with pytest.raises(lane_mod.ServerLaneWithheld) as e:
            call(fn)
        assert e.value.guard == prc.UNAVAILABLE
    assert made == [1, 1]


def test_r1_the_lane_column_carries_the_runs_warmup(world):
    sw, fake, make = world
    fake.withheld_bars = 2
    col = call(lane_mod.runtime_column_fn(ROW, "value", "record", client_factory=make))
    assert isinstance(col, list) and len(col) == 5 and col.warmup == {"withheldBars": 2}
    assert col.warmup["withheldBars"] == 2  # the read W5-T16's record_runtime_pass makes


# --- r1: the public admission question agrees with the column function on every refusal ---------

def _admission_states():
    return [
        ("admitted", None, None),
        ("verdict", "engine-refused: refused by engine 4", None),
        ("verdict-and-kill", "engine-refused", ("runtime:killed", "kill list")),
        ("killed", None, ("runtime:killed", "on the kill list")),
        ("not-graded", None, ("runtime:not-yet-graded", "not graded")),
        ("stage", None, ("runtime:stage", "stage off")),
        ("server-stage", None, ("runtime:server-stage", "server stage off")),
        ("unavailable", None, ("runtime:server-unavailable", "not set up")),
        ("malformed", None, "runtime:killed"),
        ("absent", None, "ABSENT"),
        ("raises", None, "RAISES"),
    ]


@pytest.mark.parametrize("name,verdict,refusal", _admission_states(), ids=[s[0] for s in _admission_states()])
def test_r1_admission_and_runtime_column_fn_agree(world, monkeypatch, name, verdict, refusal):
    sw, fake, make = world
    sw.verdict = verdict
    if refusal == "ABSENT":
        monkeypatch.delattr(runtime_definitions, "server_lane_refusal", raising=False)
    elif refusal == "RAISES":
        def boom(row, *, lane):
            raise RuntimeError("down")
        monkeypatch.setattr(runtime_definitions, "server_lane_refusal", boom, raising=False)
    elif refusal == "runtime:killed":
        monkeypatch.setattr(runtime_definitions, "server_lane_refusal", lambda row, *, lane: refusal, raising=False)
    else:
        sw.refusal = refusal
    asked = lane_mod.admission(ROW, "value", "alert")
    assert fake.urls == []  # the public question never calls the service
    fn = lane_mod.runtime_column_fn(ROW, "value", "alert", client_factory=make)
    if asked is None:
        assert name == "admitted" and len(call(fn)) == 5
    else:
        with pytest.raises(lane_mod.ServerLaneWithheld) as e:
            call(fn)
        assert (e.value.guard, e.value.sentence) == asked and fake.urls == []
    expected = {"admitted": None, "verdict": lane_mod.VERDICT_GUARD, "verdict-and-kill": lane_mod.VERDICT_GUARD,
                "malformed": prc.UNAVAILABLE, "absent": prc.UNAVAILABLE, "raises": prc.UNAVAILABLE}
    want = expected.get(name, refusal[0] if isinstance(refusal, tuple) else None)
    assert (asked[0] if asked else None) == want


def test_r1_admission_refuses_an_unnamed_plot_and_rejects_an_unknown_lane(world):
    sw, fake, make = world
    for key in ("", None, 3):
        assert lane_mod.admission(ROW, key, "alert")[0] == prc.INTEGRITY
    with pytest.raises(ValueError):
        lane_mod.admission(ROW, "value", "nightly")
    assert sw.asked == []


def test_r1_the_underscore_names_stay_as_aliases(world):
    sw, fake, make = world
    sw.verdict = "held"
    assert lane_mod._verdict(ROW) == "held"
    sw.refusal = ("runtime:killed", "k")
    assert lane_mod._admission(ROW, "sweep") == ("runtime:killed", "k")


# --- r2: the lane column carries the engine's NaN warm-up; a finite one never reaches a lane -----------

def test_r2_the_lane_column_is_nan_on_its_warmup(world):
    sw, fake, make = world
    fake.withheld_bars = 2
    col = call(lane_mod.runtime_column_fn(ROW, "value", "alert", client_factory=make))
    assert all(math.isnan(v) for v in col[:2]) and col[2:] == [2 * b["c"] for b in bars_fixture(5)][2:]
    assert col.warmup == {"withheldBars": 2}


def test_r2_a_finite_warmup_value_is_raised_never_returned(world):
    sw, fake, make = world
    from tests.fakes.pine_runtime_fake import b64_column
    from api.services import pine_runtime_codec as codec
    import base64
    fake.withheld_bars = 2

    def m(reply):
        r = reply["results"][0]
        col = codec.decode_column(base64.b64decode(r["columns"]["value"]))
        col[0] = 9.0
        r["columns"]["value"] = b64_column(col)
        r["digest"] = codec.column_digest(fake.identity, {"value": col}, r["refusals"])
        return reply
    fake.tamper = m
    with pytest.raises(lane_mod.ServerLaneWithheld) as e:
        call(lane_mod.runtime_column_fn(ROW, "value", "sweep", client_factory=make))
    assert e.value.guard == prc.INTEGRITY
