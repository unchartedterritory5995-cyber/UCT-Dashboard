"""UCT Agent AUTOTEST gate (tools/agent_autotest_gate.py): the guard in front of every REAL-MODEL call.
No model call, no network, no key anywhere in this file: the SDK and the turn are stand-ins."""
from __future__ import annotations

import json
import types

import pytest

from tools import agent_autotest_gate as gate
from tools import agent_eval_ledger as ledger

PUB, HELD = "a" * 64, "b" * 64
GOOD = {"approved_by": "owner", "max_usd": 8, "expires": "2099-01-01", "targets": ["local"], "stages": ["canary", "sample"],
        "public_set_sha256": PUB, "heldout_sha256": HELD}
KW = {"model": "claude-haiku-4-5", "max_tokens": 2048, "system": "s", "messages": [{"role": "user", "content": "x" * 500}]}


@pytest.fixture
def env(tmp_path, monkeypatch):
    db = tmp_path / "ledger.db"
    (tmp_path / ledger.CAP_FILE_NAME).write_text(json.dumps({"cap_usd": 21.0}))
    monkeypatch.setenv(ledger.LEDGER_ENV, str(db))
    monkeypatch.setenv(gate.AUTH_ENV, str(tmp_path / "auth.json"))
    monkeypatch.setenv(gate.STOP_ENV, str(tmp_path / "stop.json"))
    return tmp_path


def write(p, **patch):
    (p / "auth.json").write_text(json.dumps({**GOOD, **patch}))


def read(**k):
    return gate.read_authorization(**{"target": "local", "stage": "canary", "public_sha": PUB, "heldout_sha": HELD, **k})


def test_no_file_refuses(env):
    with pytest.raises(gate.Refused, match="no authorization file"):
        read()


def test_a_good_file_opens_it(env):
    write(env)
    assert read()["max_usd"] == 8


@pytest.mark.parametrize("patch,why", [
    ({"approved_by": "claude"}, "approved_by"), ({"max_usd": 8.01}, "over the"), ({"max_usd": 0}, "positive"), ({"max_usd": "8"}, "positive"), ({"max_usd": True}, "positive"),
    ({"expires": "2020-01-01"}, "expired"), ({"expires": "soon"}, "date"), ({"targets": ["production"]}, "target local"), ({"stages": ["broad"]}, "stage canary"),
    ({"public_set_sha256": "c" * 64}, "public request set"), ({"heldout_sha256": "c" * 64}, "held-out"),
])
def test_refusals(env, patch, why):
    write(env, **patch)
    with pytest.raises(gate.Refused, match=why):
        read()


def test_exactly_eight_is_allowed_and_a_cent_more_is_not():
    assert gate.MAX_AUTHORIZED_USD == 8.0
    assert sum(gate.STAGES.values()) <= gate.MAX_AUTHORIZED_USD


def test_an_unparseable_file_refuses(env):
    (env / "auth.json").write_text("{nope")
    with pytest.raises(gate.Refused, match="parse"):
        read()


def test_production_needs_the_exact_sentence(env):
    write(env, targets=["production"])
    with pytest.raises(gate.Refused, match="production_ack"):
        read(target="production")
    write(env, targets=["production"], production_ack=gate.PRODUCTION_ACK)
    assert read(target="production")


def test_the_overrides_exist_only_under_pytest(env, monkeypatch):
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    with pytest.raises(gate.Refused, match="only under pytest"):
        gate.auth_path()
    with pytest.raises(gate.Refused, match="only under pytest"):
        gate.stop_path()


def test_a_stop_is_sticky(env):
    write(env)
    gate.write_stop("a cost anomaly")
    with pytest.raises(gate.Refused, match="stop is in force"):
        read()


def ceilings(**k):
    return gate.Ceilings(ledger.Ledger(), **{"max_usd": 8.0, "stage": "canary", "turn_cap": 0.25, "run_id": "autotest-canary-1", **k})


def test_the_program_ceiling_counts_earlier_runs(env):
    led = ledger.Ledger()
    rid = led.reserve("autotest-sample-9", 1.9, tool="t", model="claude-haiku-4-5")
    led.settle(rid, 1.9)
    c = ceilings(max_usd=2.0, stage="broad")
    assert "ceiling" in c.refuse(0.11)
    assert c.refuse(0.09) is None


def test_other_tools_do_not_count_against_the_program(env):
    led = ledger.Ledger()
    led.settle(led.reserve("eval_run-1", 3.0, tool="t", model="claude-haiku-4-5"), 3.0)
    assert ceilings(max_usd=2.0).refuse(0.1) is None


def test_the_stage_ceiling(env):
    led = ledger.Ledger()
    led.settle(led.reserve("autotest-canary-1", 0.45, tool="t", model="claude-haiku-4-5"), 0.45)
    assert "stage canary" in ceilings().refuse(0.06)


def test_the_per_turn_cap(env):
    c = ceilings()
    c.turn_usd = 0.2
    assert "per-turn" in c.refuse(0.06)


def test_stops_on_anomalies(env):
    c = ceilings()
    usage = {"input": 100, "output": 10, "cache_read": 0, "cache_write": 0}
    assert c.after_call(worst=1.0, usage=None, stop_reason=None, model="claude-haiku-4-5")[1] == "a response with no usage"
    assert "over its own worst case" in ceilings().after_call(worst=1e-9, usage=usage, stop_reason=None, model="claude-haiku-4-5")[1]
    d = ceilings()
    d.turn_usd = 0.2
    assert "anomaly line" in d.after_call(worst=1.0, usage=usage, stop_reason=None, model="claude-haiku-4-5")[1]
    e = ceilings()
    assert e.after_call(worst=1.0, usage=usage, stop_reason="max_tokens", model="claude-haiku-4-5")[1] is None
    assert "refusal or max_tokens" in e.after_call(worst=1.0, usage=usage, stop_reason="max_tokens", model="claude-haiku-4-5")[1]
    f = ceilings()
    assert [f.after_error(), f.after_error()] == [None, None] and f.after_error() == "3 API errors in a row"


def test_a_high_mean_stops(env):
    c = ceilings()
    why = None
    for _ in range(gate.MEAN_AFTER_TURNS):
        c.start_turn()
        c.turn_usd = 0.06
        why = c.end_turn()
    assert "mean" in why


class FakeTurn:
    TurnError = type("TurnError", (Exception,), {})

    def __init__(self):
        self.seen = []

    def run_turn(self, **k):
        self.seen.append(k)
        k["caller"](**KW)
        return {"envelope": {"disposition": "apply", "ops": [], "reply": "ok"}, "usage": {"model": "claude-haiku-4-5", "model_calls": 1, "input_tokens": 1000, "output_tokens": 50}}


def resp(inp=1000, out=50):
    return types.SimpleNamespace(usage=types.SimpleNamespace(input_tokens=inp, output_tokens=out, cache_read_input_tokens=0, cache_creation_input_tokens=0), stop_reason="end_turn")


def session(c, create, tmp=None):
    return gate.Session(ceilings=c, client_create=create, turn_mod=FakeTurn(), key_fp="abcd1234", meter_cls=object, spend_log=str(tmp / "spend.jsonl") if tmp else None)


def test_every_call_is_reserved_first_and_settled_at_actual(env):
    led = ledger.Ledger()
    open_during = []

    def create(**_k):
        open_during.append(led.committed()[0])
        return resp()
    s = session(ceilings(), create, env)
    status, out = s.turn_request({"message": "hi", "conversationId": "c1"})
    assert status == 200 and open_during[0] > 0
    row = led.rows()[0]
    assert row["status"] == "settled" and row["run_id"].startswith("autotest-canary-") and 0 < row["actual_usd"] < row["reserved_usd"]
    assert out["usage"]["turn_usd"] == pytest.approx(row["actual_usd"])
    assert json.loads((env / "spend.jsonl").read_text().splitlines()[0])["usd"] == pytest.approx(row["actual_usd"], abs=1e-6)


def test_it_stops_at_the_ceiling_and_no_call_is_made(env):
    calls = []

    def create(**_k):
        calls.append(1)
        return resp()
    s = session(ceilings(max_usd=0.0001), create)
    status, out = s.turn_request({"message": "hi"})
    assert status == 503 and not calls and out["stopped"]
    assert (env / "stop.json").exists()
    assert s.turn_request({"message": "again"})[0] == 503 and not calls


def test_an_api_error_leaves_nothing_reserved_and_three_stop_the_run(env):
    led = ledger.Ledger()

    def create(**_k):
        raise RuntimeError("boom")
    s = session(ceilings(), create)
    for _ in range(3):
        assert s.turn_request({"message": "hi"})[0] == 503
    assert s.c.stopped == "3 API errors in a row" and led.committed()[0] == 0     # a timeout settles at the worst case: over-counts, never under
    assert led.committed()[1] > 0


def test_history_follows_the_route(env):
    s = session(ceilings(), lambda **_k: resp())
    s.turn_request({"message": "one", "conversationId": "c"})
    s.record({"conversationId": "c", "outcome": "Done"})
    s.turn_request({"message": "two", "conversationId": "c"})
    assert [h["role"] for h in s.turn.seen[1]["history"]] == ["member", "agent", "outcome"]
    s.turn_request({"message": "two", "conversationId": "c", "reroute": True})
    assert s.turn.seen[2]["history"][-1]["role"] == "agent"       # a reroute: the same message, not stored twice


def test_production_reservation_holds_a_whole_turn_and_settles_from_the_server(env):
    led = ledger.Ledger()
    rid = gate.reserve_turn(led, stage="canary", usd=0.25, max_usd=8.0)
    assert led.committed()[0] == pytest.approx(0.25)
    led.settle(rid, 0.02)
    assert led.committed() == (0.0, pytest.approx(0.02))
    with pytest.raises(gate.Refused):
        gate.reserve_turn(led, stage="canary", usd=0.25, max_usd=0.1)


def test_the_cli_refuses_without_the_file(env, capsys):
    assert gate.main(["check", "--target", "local", "--stage", "canary", "--public-sha", PUB]) == 2
    assert "no authorization file" in capsys.readouterr().out


def test_the_cli_refuses_without_the_key(env, capsys, monkeypatch):
    monkeypatch.delenv(ledger.EVAL_KEY_ENV, raising=False)
    write(env, heldout_sha256=None)
    assert gate.main(["check", "--target", "local", "--stage", "canary", "--public-sha", PUB]) == 2
    assert ledger.EVAL_KEY_ENV in capsys.readouterr().out


def test_no_environment_variable_grants_anything():
    src = open(gate.__file__, encoding="utf-8").read()
    assert src.count("os.environ.get(") == 2       # the two pytest-only paths
    assert "max_retries=0" in src
    assert "stub_research" in src


def test_the_real_turn_runs_through_the_session_and_the_http_shape(env):
    """The server's own run_turn behind the gate's HTTP handler, on loopback, with a stand-in SDK: the whole paid path but the bill."""
    import http.client
    import threading
    from http.server import ThreadingHTTPServer

    from api.services.uct_agent import turn
    from tests.test_uct_agent import _resp, env as make_env
    from tools.agent_eval_run import CeilingMeter

    ledger.stub_research(turn)
    caps = [c for c in json.load(open("app/src/agent/contract/manifest.golden.json", encoding="utf-8"))["capabilities"] if c["name"] == "chart.setTimeframe"]
    reply = make_env("apply", [{"action": "chart.setTimeframe", "target": "c1", "args": {"timeframe": "W"}}])
    sess = gate.Session(ceilings=ceilings(), client_create=lambda **_k: _resp(reply), turn_mod=turn, key_fp="abcd1234", meter_cls=lambda: CeilingMeter(2))
    srv = ThreadingHTTPServer(("127.0.0.1", 0), gate.handler_for(sess))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        c = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=20)
        c.request("POST", "/turn", json.dumps({"message": "weekly please", "context": {"surface": "charts", "charts": [{"ref": "c1", "label": "Chart (SPY)"}]}, "capabilities": caps, "manifestVersion": 1}), {"content-type": "application/json"})
        r = c.getresponse()
        out = json.loads(r.read())
    finally:
        srv.shutdown()
    assert r.status == 200 and out["envelope"]["ops"][0]["action"] == "chart.setTimeframe"
    assert out["usage"]["turn_usd"] > 0
    row = ledger.Ledger().rows()[0]
    assert row["status"] == "settled" and row["tool"] == gate.TOOL and row["run_id"].startswith(gate.RUN_PREFIX)
