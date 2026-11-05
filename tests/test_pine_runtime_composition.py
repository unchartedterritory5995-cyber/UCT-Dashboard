"""W5 T17 (2026-11-04): COMPOSITION AND STAMPS for a runtime document in the server lanes.

Design `docs/pine/SERVER-RUNTIME-DESIGN.md` 5.1 and 5.2. What this file holds, each with the
mutation that proves it can fail (the table is in the evidence file):

  A. THE DOOR. `runtime_definitions.validate` rejects a runtime document that carries
     `meta.blockRuns` (the host translation's stamp for an `ast` document's per-plot gates).
  B. THE ORDER (5.2). `user_definitions.server_lane_composition` returns the FIRST refusal:
     definition -> stored verdict -> consumer contract -> admission. One row per step, each
     with exactly that step's condition set AND every later step also failing, so a dropped
     step turns its row into the next step's guard. Steps 1-4 never reach a network call.
  C. THE STAMP. `routers/user_definitions._stamped` adds `server_lanes: {alerts, screener,
     scans}` to a runtime row, each `true` or `{guard, sentence}`; an `ast` row carries none.
  D. THE RUNTIME BRANCHES of `user_definitions`: `_awaits_retranslation` answers False for a
     runtime row, whatever else it says; the stored `refused` verdict binds it; and
     `consumer_refusal` reads a runtime document's `request.*` from its source.
"""
from __future__ import annotations

import copy
import json
import socket
from pathlib import Path

import pytest

from api.routers import user_definitions as router
from api.services import auth_db, rollout
from api.services import rollout_gate as rg
from api.services import runtime_definitions as rt
from api.services import user_definitions as ud

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "runtime_documents" / "documents.json"
DOCS = {d["slug"]: d for d in json.loads(FIXTURE.read_text(encoding="utf-8"))["documents"]}
ADX = DOCS["adx-and-di-for-v4"]["definition"]            # the committed GRADED allowlist's script
DELTA = DOCS["delta-rsi-oscillator-strategy"]["definition"]  # a real script that is NOT on it

OWNER = "t17-owner-1"
URL = "http://pine-runtime.railway.internal:8080"
SECRET = "t17-secret-DO-NOT-LEAK-0123456789abcdef"
REQUEST_LINE = '\nt17_other = request.security("MSFT", "D", close)\n'
IDENTITY_LINE = "\nt17_same = request.security(syminfo.tickerid, timeframe.period, close)\n"

_ENVS = (rt.STAGE_ENV, rt.SERVER_STAGE_ENV, rt.KILL_ENV, rt.ALLOW_ENV,
         rt.SERVICE_URL_ENV, rt.SERVICE_SECRET_ENV)


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for k in _ENVS:
        monkeypatch.delenv(k, raising=False)


@pytest.fixture(autouse=True)
def owner(monkeypatch):
    """The owner is an ordinary member; the stage is `all`, so only the condition a test
    breaks can refuse."""
    from api.services import auth_service
    monkeypatch.setattr(auth_service, "get_user_by_id",
                        lambda uid: {"id": uid, "role": "member"} if uid == OWNER else None)
    monkeypatch.setattr(rollout, "includes",
                        lambda uid, cohort: cohort == rg.PINE_RUNTIME_COHORT and uid == OWNER)


@pytest.fixture
def no_network(monkeypatch):
    """Steps 1-4 cost no service time: any connection attempt fails the test."""
    calls: list = []

    def boom(*a, **k):
        calls.append(a)
        raise AssertionError("a refused step reached the network")
    for name in ("connect", "connect_ex"):
        monkeypatch.setattr(socket.socket, name, boom)
    monkeypatch.setattr(socket, "create_connection", boom)
    return calls


def arm(monkeypatch, *, service=True):
    monkeypatch.setenv(rt.STAGE_ENV, "all")
    monkeypatch.setenv(rt.SERVER_STAGE_ENV, "all")
    if service:
        monkeypatch.setenv(rt.SERVICE_URL_ENV, URL)
        monkeypatch.setenv(rt.SERVICE_SECRET_ENV, SECRET)
    else:
        monkeypatch.delenv(rt.SERVICE_URL_ENV, raising=False)
        monkeypatch.delenv(rt.SERVICE_SECRET_ENV, raising=False)


def row_of(defn=ADX, **extra):
    r = {"user_id": OWNER, "def_id": defn["id"], "version": 1,
         "definition": copy.deepcopy(defn), "requirements": []}
    r.update(extra)
    return r


def refused_verdict(engine=None, same_maths=False):
    return {"status": "refused", "engine": ud.SCRIPT_ENGINE_VERSION if engine is None else engine,
            "reason": "t17 test refusal", "same_maths": same_maths}


def with_source(row, extra):
    row["definition"]["compute"]["source"] += extra
    return row


def comp(row, consumer="alert", lane="alert"):
    return ud.server_lane_composition(row, consumer=consumer, lane=lane)


# ─── A. THE DOOR ────────────────────────────────────────────────────────────

def test_a_clean_runtime_document_validates():
    rt.validate(copy.deepcopy(ADX))


@pytest.mark.parametrize("value", [[], [{"key": "x", "gates": []}], {"keys": []}, None])
def test_a_runtime_document_carrying_block_runs_is_rejected_at_save(value):
    d = copy.deepcopy(ADX)
    d.setdefault("meta", {})["blockRuns"] = value
    with pytest.raises(ValueError, match="meta.blockRuns"):
        rt.validate(d)


# ─── B. THE ORDER ───────────────────────────────────────────────────────────

def test_the_baseline_row_is_admitted(monkeypatch, no_network):
    arm(monkeypatch)
    assert comp(row_of()) is None


def _everything_failing_from(step, monkeypatch):
    """A row whose conditions fail from `step` on (1 definition, 2 verdict, 3 consumer,
    4 admission) and hold before it."""
    arm(monkeypatch, service=step < 4)              # 4 alone leaves the service unset...
    row = row_of()
    if step <= 1:
        row["definition"].setdefault("meta", {})["blockRuns"] = {"keys": []}
    if step <= 2:
        row["engine_status"] = refused_verdict()
    if step <= 3:
        with_source(row, REQUEST_LINE)
    if step <= 4:
        arm(monkeypatch, service=False)             # ...and every earlier step leaves it unset too
    return row


@pytest.mark.parametrize("step,guard", [(1, "definition"), (2, "withheld"),
                                        (3, "requirements"), (4, "runtime:server-unavailable")])
def test_the_first_refusal_wins_and_no_step_one_to_four_reaches_the_network(
        step, guard, monkeypatch, no_network):
    row = _everything_failing_from(step, monkeypatch)
    out = comp(row)
    assert out is not None and out[1] == guard, out
    assert no_network == []


def test_each_step_alone_is_its_own_guard(monkeypatch):
    """Each condition set ALONE (every other step satisfied) reports that step's guard."""
    arm(monkeypatch)
    r = row_of()
    r["definition"].setdefault("meta", {})["blockRuns"] = {"keys": []}
    assert comp(r)[:2] == ("definition", "definition")
    r = row_of(engine_status=refused_verdict())
    assert comp(r)[:2] == ("withheld", "withheld")
    r = with_source(row_of(), REQUEST_LINE)
    assert comp(r)[:2] == ("requirements", "requirements")
    arm(monkeypatch, service=False)
    assert comp(row_of())[:2] == ("admission", "runtime:server-unavailable")


def test_the_step_carries_the_owning_modules_own_sentence(monkeypatch):
    arm(monkeypatch)
    assert comp(row_of(engine_status=refused_verdict()))[2] == ud.engine_withheld_reason(
        row_of(engine_status=refused_verdict()))
    r = with_source(row_of(), REQUEST_LINE)
    assert comp(r)[2] == ud.consumer_refusal("alert", [], r["definition"])
    monkeypatch.setenv(rt.KILL_ENV, "*")
    killed = comp(row_of(DELTA))
    assert killed[1] in ("runtime:killed", "runtime:not-yet-graded")
    assert killed[2] == rt.server_lane_refusal(row_of(DELTA), lane="alert")[1]


def test_a_kill_reaches_the_next_call_and_deletes_nothing(monkeypatch):
    arm(monkeypatch)
    row = row_of()
    assert comp(row) is None
    src = row["definition"]["compute"]["source"]
    monkeypatch.setenv(rt.KILL_ENV, rt.source_hash(src))
    assert comp(row)[1] == "runtime:killed"
    assert row["definition"]["compute"]["source"] == src
    monkeypatch.delenv(rt.KILL_ENV)
    assert comp(row) is None


@pytest.mark.parametrize("bad", [None, "x", {}, {"definition": None, "def_id": "u_aaaaaaaaaaaa"},
                                 {"definition": {}, "def_id": ""}])
def test_an_unreadable_row_is_refused_at_step_one_and_never_raises(bad):
    out = comp(bad)
    assert out is not None and out[0] == "definition"


# ─── C. THE STAMP ───────────────────────────────────────────────────────────

LANES = ("alerts", "screener", "scans")


def test_a_runtime_row_is_stamped_true_on_all_three_lanes(monkeypatch):
    arm(monkeypatch)
    out = router._stamped(row_of())
    assert out["server_lanes"] == {k: True for k in LANES}


def test_a_refused_lane_is_stamped_with_guard_and_sentence(monkeypatch):
    arm(monkeypatch, service=False)
    out = router._stamped(row_of())
    for k in LANES:
        v = out["server_lanes"][k]
        assert set(v) == {"guard", "sentence"} and v["guard"] == "runtime:server-unavailable"
        assert v["sentence"] and SECRET not in v["sentence"] and URL not in v["sentence"]


def test_the_stamp_follows_the_environment_on_the_next_read(monkeypatch):
    arm(monkeypatch)
    assert router._stamped(row_of())["server_lanes"]["alerts"] is True
    monkeypatch.setenv(rt.SERVER_STAGE_ENV, "off")
    assert router._stamped(row_of())["server_lanes"]["alerts"]["guard"] == "runtime:server-stage"
    monkeypatch.setenv(rt.SERVER_STAGE_ENV, "all")
    assert router._stamped(row_of())["server_lanes"]["alerts"] is True


def test_a_withheld_runtime_row_is_stamped_withheld_on_every_lane(monkeypatch):
    arm(monkeypatch)
    out = router._stamped(row_of(engine_status=refused_verdict()))
    assert all(out["server_lanes"][k]["guard"] == "withheld" for k in LANES)


def test_each_lane_asks_its_own_consumer(monkeypatch):
    """The three stamp keys are the three consumers and service profiles (no key reads
    another's answer): the sentence names the lane the service profile words it with."""
    arm(monkeypatch, service=False)
    out = router._stamped(row_of())["server_lanes"]
    assert "(alert lane)" in out["alerts"]["sentence"]
    assert "(on-demand lane)" in out["screener"]["sentence"]
    assert "(sweep lane)" in out["scans"]["sentence"]


def test_an_ast_row_carries_no_server_lanes_key(monkeypatch):
    arm(monkeypatch)
    ast_row = {"user_id": OWNER, "def_id": "u_0123456789ab", "version": 1, "requirements": [],
               "definition": {"id": "u_0123456789ab", "compute": {"kind": "ast", "ast": {}}}}
    assert "server_lanes" not in router._stamped(ast_row)


def test_the_stamp_does_not_touch_the_stored_row(monkeypatch):
    arm(monkeypatch)
    r = row_of()
    before = json.dumps(r, sort_keys=True)
    router._stamped(r)
    assert json.dumps(r, sort_keys=True) == before


# ─── D. THE RUNTIME BRANCHES ────────────────────────────────────────────────

def _scripted_runtime_row(stamp_below=True):
    """A runtime row dressed as everything `_awaits_retranslation` asks for in an ast row:
    a stored script, the Pine origin, an engine stamp below today's."""
    r = row_of(has_pine_source=True)
    r["definition"].setdefault("meta", {})["recurrenceOrigin"] = "pine"
    r["definition"]["meta"]["engineVersion"] = 1
    return r


def test_a_runtime_row_never_awaits_retranslation():
    r = _scripted_runtime_row()
    assert ud._awaits_retranslation(r, ud.SCRIPT_ENGINE_VERSION + 5) is False


def test_the_same_dress_on_an_ast_row_does_await_it():
    """The control: the row shape above would await a re-translation if it were `ast`."""
    r = _scripted_runtime_row()
    r["definition"]["compute"] = {"kind": "ast"}
    assert ud._awaits_retranslation(r, ud.SCRIPT_ENGINE_VERSION + 5) is True


def test_a_stored_refused_verdict_binds_a_runtime_row_at_todays_engine():
    r = row_of(engine_status=refused_verdict())
    why = ud.engine_withheld_reason(r)
    assert why and why.startswith("engine-refused:")


def test_an_older_verdict_on_a_runtime_row_is_held_only_for_the_same_maths():
    older = ud.SCRIPT_ENGINE_VERSION - 1
    assert ud.engine_withheld_reason(row_of(engine_status=refused_verdict(older, True))) is not None
    assert ud.engine_withheld_reason(row_of(engine_status=refused_verdict(older, False))) is None


def test_a_runtime_row_is_not_told_to_wait_for_a_chart_load():
    """An older verdict on a runtime row that LOOKS script-backed is never the `re-checks it
    the next time it is opened` hold: nothing re-translates a runtime document."""
    r = _scripted_runtime_row()
    r["engine_status"] = refused_verdict(ud.SCRIPT_ENGINE_VERSION - 1, False)
    assert ud.engine_withheld_reason(r) is None


@pytest.mark.parametrize("consumer", ["alert", "screener", "sweep", "share", "listing", "pane"])
def test_a_runtime_document_naming_request_is_refused_for_every_consumer(consumer):
    d = with_source(row_of(), REQUEST_LINE)["definition"]
    why = ud.consumer_refusal(consumer, [], d)
    assert why and "request.security" in why and "runtime:request" in why


def test_the_identity_request_is_not_a_requirement():
    d = with_source(row_of(), IDENTITY_LINE)["definition"]
    assert ud.consumer_refusal("alert", [], d) is None


def test_a_runtime_document_with_an_unreadable_source_fails_closed():
    d = copy.deepcopy(ADX)
    d["compute"]["source"] = 'plot("unterminated'
    assert rt.request_reads(d) == ["<unreadable source>"]
    assert ud.consumer_refusal("alert", [], d)


def test_consumer_refusal_without_a_definition_is_unchanged():
    assert ud.consumer_refusal("alert", []) is None
    assert ud.consumer_refusal("alert", None, None) is None
    assert ud.consumer_refusal("alert", ["window_dependent"])      # the manifest's own tag still refuses
