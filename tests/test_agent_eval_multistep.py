"""tools/agent_eval_multistep.py — the multi-step planner eval bridge (prepared, NOT run). No model call and no network
anywhere in this file: the paid path is exercised with a fake Messages client on a scratch eval ledger.

Proves: (1) the dry run makes ZERO network calls (non-loopback connects refused and counted, `anthropic` never
imported, no key read) and counts every member request and call; (2) the HARD STOP refuses the call that would pass
the authorised amount BEFORE it is made, and every later request is refused without a call; (3) the cumulative ledger
records each call content-free (key fingerprint only); (4) the cumulative cap and an oversize request also stop the run
before any spend; (5) the bound arithmetic and the production pins."""
from __future__ import annotations

import json
import socket
import sys
import threading
import types
import urllib.request

import pytest

from tools import agent_eval_ledger as L
from tools import agent_eval_multistep as M

CTX = {"surface": "charts", "charts": [{"ref": "c1", "label": "Chart (SPY)", "symbol": "SPY"}]}
CAPS = [
    {"name": "chart.setType", "domain": "chart", "target": "chart", "summary": "Change how price is drawn.",
     "hints": None, "risk": "local", "reversible": True,
     "args": {"type": "object", "properties": {"type": {"type": "string", "enum": ["candles", "bars", "line"]}},
              "required": ["type"], "additionalProperties": False}},
]
KEY = "sk-eval-TEST-not-a-real-key-0123456789"


def _body(msg, cid=None):
    return {"conversationId": cid, "message": msg, "context": CTX, "capabilities": CAPS}


def _resp(inp=3000, out=120, write=0):
    env = {"disposition": "answer", "reply": "ok", "question": None, "ops": [], "unsupported_category": None}
    return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=json.dumps(env))], stop_reason="end_turn",
                                 usage=types.SimpleNamespace(input_tokens=inp, output_tokens=out, cache_read_input_tokens=0,
                                                             cache_creation_input_tokens=write))


@pytest.fixture(autouse=True)
def _pinned(monkeypatch):
    for k in M.CLEARED_ENV:
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("UCT_AGENT_MODEL", M.MODEL)
    monkeypatch.setattr(M.turn, "_research", M.turn._research)
    monkeypatch.setattr(M.turn, "_record_cost", M.turn._record_cost)
    L.stub_research(M.turn)


@pytest.fixture
def led(tmp_path, monkeypatch):
    path = str(tmp_path / "ledger.db")
    monkeypatch.setenv(L.LEDGER_ENV, path)
    (tmp_path / L.CAP_FILE_NAME).write_text(json.dumps({"cap_usd": 21.0}), encoding="utf-8")
    return L.Ledger(path)


def _paid(out_dir, led, max_usd, create, run_id="t-run"):
    guard = M.RunGuard(max_usd)
    rec = M.Recorder(str(out_dir), {})
    return M.Bridge(arm="v1", guard=guard, rec=rec, dry=False, create=create, led=led, run_id=run_id,
                    key_fp=L.key_fingerprint(KEY)), guard, rec


def test_dry_run_makes_zero_network_calls_and_counts_every_request(tmp_path, monkeypatch):
    sys.modules.pop("anthropic", None)
    monkeypatch.delenv(L.EVAL_KEY_ENV, raising=False)
    seen = M.install_loopback_only()
    try:
        guard = M.RunGuard(None)
        rec = M.Recorder(str(tmp_path / "dry"), {})
        b = M.Bridge(arm="nlm1", guard=guard, rec=rec, dry=True, run_id="dry")
        srv = M.make_server(b)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{srv.server_address[1]}"

        def post(path, case, body):
            req = urllib.request.Request(url + path, data=json.dumps({"case": case, "body": body}).encode(),
                                         headers={"content-type": "application/json"}, method="POST")
            with urllib.request.urlopen(req) as r:
                return json.loads(r.read())
        # case A01: two model turns in one conversation; case B02: a deterministic turn recorded, then one model turn
        a1 = post("/api/agent/turn", "suite > A01.some-title", _body("make it bars"))
        assert a1["envelope"]["disposition"] == "answer"
        post("/api/agent/turn", "suite > A01.some-title", _body("now a line", a1["conversationId"]))
        r = post("/api/agent/record", "suite > B02 x", {"member": "add rsi", "outcome": "Added RSI."})
        post("/api/agent/turn", "suite > B02 x", _body("and bars", r["conversationId"]))
        with pytest.raises(OSError):                                    # nothing leaves this machine
            socket.create_connection(("192.0.2.1", 443), timeout=1)
        srv.shutdown()
    finally:
        socket.socket.connect = M._REAL_CONNECT
    assert b.stub_calls == 3 and len(rec.calls) == 3
    s = M.summarize(rec.calls, rec.requests, guard)
    assert s["member_requests"] == 3 and s["calls"] == 3 and s["cases"] == 2 and s["actual_usd"] == 0
    assert s["max_calls_per_request"] == 1 and 0 < s["max_request_bytes"] <= M.MAX_REQUEST_BYTES
    assert {c["case"] for c in rec.calls} == {"A01", "B02"}              # the id, never the title
    assert all(c["dry"] and c["worst_usd"] > 0 and c["turn_request_id"] for c in rec.calls)
    assert len({c["turn_request_id"] for c in rec.calls}) == 3
    assert seen["refused"] == 1
    assert "anthropic" not in sys.modules                                 # the SDK is never even imported
    raw = open(rec.calls_path, encoding="utf-8").read() + open(rec.req_path, encoding="utf-8").read()
    for words in ("make it bars", "some-title", "add rsi", "now a line"):
        assert words not in raw


def test_hard_stop_refuses_the_call_that_would_pass_the_authorised_amount(tmp_path, led):
    made = []
    probe, _, prec = _paid(tmp_path / "probe", led, None, lambda **kw: _resp(), run_id="probe")
    assert probe.turn(_body("step 9"), "Z99")[0] == 200
    one = prec.calls[0]["worst_usd"]
    authorised = round(one * 2.5, 6)

    def create(**kw):                     # each call really costs ~90% of its worst case (a cache write of most of it)
        made.append(kw["model"])
        return _resp(inp=0, out=0, write=int(0.9 * one / 1.25e-6))
    # call 1: 0 + 1.0 <= 2.5 (settles at 0.9); call 2: 0.9 + 1.0 <= 2.5 (settles at 1.8); call 3: 1.8 + 1.0 > 2.5 → STOP
    b, guard, rec = _paid(tmp_path / "run", led, authorised, create)
    codes = [b.turn(_body(f"step {i}"), f"C{i:02d}")[0] for i in range(5)]
    assert len(made) == 2                                                 # the third call was never made
    assert codes == [200, 200, 503, 503, 503]
    assert guard.aborted and "HARD STOP" in guard.aborted
    assert guard.committed <= authorised
    assert [r["result"] for r in rec.requests] == ["ok", "ok", "hard_stop", "stopped", "stopped"]
    rows = [r for r in led.rows() if r["run_id"] == "t-run"]
    assert len(rows) == 2 and all(r["status"] == "settled" and r["tool"] == M.TOOL for r in rows)
    assert sum(r["actual_usd"] for r in rows) <= authorised
    assert all(r["key_fp"] == L.key_fingerprint(KEY) for r in rows)
    assert KEY not in json.dumps(rows) and KEY not in open(rec.calls_path, encoding="utf-8").read()
    assert all(c["turn_request_id"] and c["category"] == "turn" for c in rec.calls)


def test_a_provider_error_is_released_and_a_timeout_is_charged_at_its_worst_case(tmp_path, led):
    def timeout(**kw):
        raise TimeoutError("read timeout")
    b, guard, rec = _paid(tmp_path, led, 5.0, timeout)
    assert b.turn(_body("make it bars"), "C01")[0] == 503
    assert rec.calls[0]["actual_usd"] == rec.calls[0]["worst_usd"] and guard.committed == rec.calls[0]["worst_usd"]
    assert led.committed()[1] == pytest.approx(rec.calls[0]["worst_usd"])


def test_the_cumulative_cap_also_stops_the_run(tmp_path, led):
    with open(L.cap_file_path(led.path), "w", encoding="utf-8") as f:
        json.dump({"cap_usd": 0.01}, f)
    made = []
    b, guard, _ = _paid(tmp_path, led, 5.0, lambda **kw: made.append(1) or _resp())
    assert b.turn(_body("make it bars"), "C01")[0] == 503
    assert made == [] and "cumulative ledger refused" in guard.aborted and guard.committed == 0


def test_an_oversize_request_is_refused_before_any_spend(tmp_path, led, monkeypatch):
    monkeypatch.setattr(M, "MAX_REQUEST_BYTES", 1000)
    made = []
    b, guard, _ = _paid(tmp_path, led, 5.0, lambda **kw: made.append(1) or _resp())
    assert b.turn(_body("make it bars"), "C01")[0] == 503
    assert made == [] and "MAX_REQUEST_BYTES" in guard.aborted and led.committed() == (0.0, 0.0)


def test_the_bound_and_the_pins():
    one = M.per_call_worst_bound()
    assert one == pytest.approx((M.MAX_REQUEST_BYTES + L.FRAMING_TOKENS) * 1.25e-6 + M.turn.MAX_TOKENS * 5e-6, rel=1e-6)
    b = M.bound(71)
    assert b["max_calls"] == 142 and b["per_request_worst_usd"] == pytest.approx(2 * one)
    assert b["per_request_worst_usd"] <= M.budget.turn_cap_usd()
    assert M.turn.model() == M.MODEL == "claude-haiku-4-5" and M.turn.MAX_TOKENS == 2048
    from api.routers import uct_agent as route
    assert route.NO_TITLE_YET == M.NO_TITLE_YET
    assert M.case_id("NLM-1 acceptance > P07.some-slug") == "P07" and M.case_id("x > F12") == "F12"
    assert M.case_id("x > no id here").startswith("h")
