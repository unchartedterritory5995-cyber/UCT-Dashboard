"""The PC Claude-call meter (tools/pc_llm_meter): every Messages call a PC job makes
becomes one ledger row, attributed to the job's entry script, without touching the
job's own code. SDK runs happen in a CHILD interpreter (a real anthropic client over
an httpx MockTransport), so the hook never leaks into this test session. Nothing
here reaches the network."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

METER_DIR = Path(__file__).resolve().parents[1] / "tools" / "pc_llm_meter"

MESSAGE = {"id": "msg_1", "type": "message", "role": "assistant", "model": "claude-sonnet-5",
           "content": [{"type": "text", "text": "hi"}], "stop_reason": "end_turn", "stop_sequence": None,
           "usage": {"input_tokens": 1200, "output_tokens": 50, "cache_read_input_tokens": 300}}

SSE = "".join(f"event: {e}\ndata: {json.dumps(d)}\n\n" for e, d in [
    ("message_start", {"type": "message_start", "message": {**MESSAGE, "id": "msg_2", "content": [],
                                                            "usage": {"input_tokens": 900, "output_tokens": 1}}}),
    ("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
    ("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "yo"}}),
    ("content_block_stop", {"type": "content_block_stop", "index": 0}),
    ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                       "usage": {"output_tokens": 77}}),
    ("message_stop", {"type": "message_stop"}),
])


def _run_job(tmp_path: Path, body: str, *, env_extra: dict | None = None) -> dict:
    """Run `body` as a scheduled job at <tmp>/somerepo/job.py with the meter armed the
    way the .pth arms it. Returns what the meter captured and tried to send."""
    repo = tmp_path / "somerepo"
    repo.mkdir(exist_ok=True)
    (repo / "helper.py").write_text(textwrap.dedent('''
        def ask(client, stream=False):
            if stream:
                with client.messages.stream(model="claude-sonnet-5", max_tokens=10,
                                            messages=[{"role": "user", "content": "x"}]) as s:
                    for _ in s.text_stream:
                        pass
                return None
            return client.messages.create(model="claude-sonnet-5", max_tokens=10,
                                          messages=[{"role": "user", "content": "x"}])
    '''))
    job = repo / "job.py"
    job.write_text(textwrap.dedent(f'''
        import json, os, sys
        sys.path.insert(0, {str(METER_DIR)!r})
        sys.path.insert(0, {str(repo)!r})
        import uct_llm_meter as m
        m._HOME = os.path.normcase({str(tmp_path)!r})
        sent = []
        m._post = lambda rows: sent.append(rows) or True
        m._arm()                                   # what the .pth does at startup
        import anthropic, httpx
        MSG = {json.dumps(MESSAGE)!r}
        SSE = {SSE!r}
        def handler(req):
            if json.loads(req.content).get("stream"):
                return httpx.Response(200, text=SSE, headers={{"content-type": "text/event-stream"}})
            return httpx.Response(200, text=MSG, headers={{"content-type": "application/json"}})
        client = anthropic.Anthropic(api_key="test", http_client=httpx.Client(transport=httpx.MockTransport(handler)))
        import helper
    ''') + textwrap.dedent(body) + textwrap.dedent('''
        rows_before = list(m._rows)
        m.flush()
        print("RESULT" + json.dumps({"active": m.active(), "buffered": rows_before, "sent": sent}))
    '''))
    env = {k: v for k, v in os.environ.items() if k not in ("PYTEST_CURRENT_TEST", "UCT_LLM_METER")}
    env.update(env_extra or {})
    r = subprocess.run([sys.executable, str(job)], capture_output=True, text=True, env=env, timeout=120)
    line = next((ln for ln in r.stdout.splitlines() if ln.startswith("RESULT")), None)
    assert line, r.stdout + r.stderr
    return json.loads(line[len("RESULT"):])


def test_a_job_call_is_recorded_against_the_jobs_entry_script(tmp_path):
    out = _run_job(tmp_path, "msg = helper.ask(client)\nassert msg.content[0].text == 'hi'\n")
    assert out["active"] is True
    (row,) = out["buffered"]
    assert row["door"] == "somerepo/job.py"
    assert row["func"] == "somerepo/helper.py:ask"
    assert (row["model"], row["input_tokens"], row["output_tokens"], row["cache_read_tokens"]) == \
        ("claude-sonnet-5", 1200, 50, 300)
    assert row["service"] == "pc" and row["request_id"] == "msg_1" and "cost_usd" not in row
    assert out["sent"] == [[row]]


def test_a_streamed_call_records_the_final_usage(tmp_path):
    out = _run_job(tmp_path, "helper.ask(client, stream=True)\n")
    (row,) = out["buffered"]
    assert row["kind"] == "stream" and row["input_tokens"] == 900 and row["output_tokens"] == 77


def test_the_meter_stays_off_when_switched_off(tmp_path):
    out = _run_job(tmp_path, "helper.ask(client)\n", env_extra={"UCT_LLM_METER": "0"})
    assert out["active"] is False and out["buffered"] == [] and out["sent"] == []


def test_the_websites_own_ledger_wins_in_its_own_process(tmp_path):
    body = ("import types; fake = types.ModuleType('api.services.llm_usage'); fake._installed = True\n"
            "sys.modules['api.services.llm_usage'] = fake\nhelper.ask(client)\n")
    out = _run_job(tmp_path, body)
    assert out["buffered"] == []


def test_a_failed_send_keeps_the_rows_for_the_next_try():
    sys.path.insert(0, str(METER_DIR))
    try:
        import uct_llm_meter as m
    finally:
        sys.path.remove(str(METER_DIR))
    m._rows[:] = [{"door": "a"}, {"door": "b"}]
    orig = m._post
    try:
        m._post = lambda rows: False
        assert m.flush() == 0 and len(m._rows) == 2
        m._post = lambda rows: True
        assert m.flush() == 2 and m._rows == []
    finally:
        m._post = orig
        m._rows[:] = []


@pytest.mark.parametrize("path,expected", [
    ("{home}/morning-wire/pipeline.py", "morning-wire/pipeline.py"),
    ("{home}/AppData/Roaming/Python/x.py", None),
    ("{home}/uct-intelligence/.venv/Lib/site-packages/anthropic/x.py", None),
    ("C:/elsewhere/x.py", None),
])
def test_only_repo_code_under_home_is_named(path, expected, monkeypatch):
    sys.path.insert(0, str(METER_DIR))
    try:
        import uct_llm_meter as m
    finally:
        sys.path.remove(str(METER_DIR))
    home = os.path.normcase(os.path.abspath("C:/Users/someone" if os.name == "nt" else "/home/someone"))
    monkeypatch.setattr(m, "_HOME", home)
    assert m._rel(path.format(home=home)) == expected


RAW_JOB = '''
import requests
from requests.adapters import HTTPAdapter

class FakeAdapter(HTTPAdapter):
    def send(self, request, **kw):
        r = requests.Response()
        r.request, r.url = request, request.url
        r.status_code = STATUS
        r.headers["content-type"] = "application/json"
        r._content = (MSG if STATUS == 200 else '{"type":"error"}').encode()
        return r

sess = requests.Session()
sess.mount("https://", FakeAdapter())
def raw_call():
    return sess.post("https://api.anthropic.com/v1/messages", json={"model": "claude-opus-5", "max_tokens": 5,
                     "messages": [{"role": "user", "content": "x"}]}, headers={"x-api-key": "test"})
resp = raw_call()
sess.post("https://example.com/v1/messages", json={})          # not Anthropic: never recorded
'''


def test_a_raw_http_call_through_requests_is_recorded(tmp_path):
    out = _run_job(tmp_path, "STATUS = 200\n" + RAW_JOB + "assert resp.json()['id'] == 'msg_1'\n")
    (row,) = out["buffered"]
    assert row["door"] == "somerepo/job.py" and row["func"] == "somerepo/job.py:raw_call"
    assert (row["model"], row["input_tokens"], row["output_tokens"]) == ("claude-sonnet-5", 1200, 50)
    assert row["ok"] is True


def test_a_raw_http_error_is_recorded_as_a_failed_attempt(tmp_path):
    out = _run_job(tmp_path, "STATUS = 400\n" + RAW_JOB)
    (row,) = out["buffered"]
    assert row["ok"] is False and row["model"] == "claude-opus-5" and row["input_tokens"] == 0
