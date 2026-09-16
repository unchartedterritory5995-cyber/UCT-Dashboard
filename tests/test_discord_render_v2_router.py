"""V2 through the REAL route: signature, guild gate, dispatch — and the flag in both states.

The ack-path properties under test (docs/discord-render/03-architecture.md §3.1):
  * flag OFF, or a per-command kill switch off → the pre-V2 path answers, untouched;
  * flag ON → the job is OFFERED to the runtime and the route answers the defer, with no
    Starlette BackgroundTask and no SQLite read on the event loop;
  * a refusal is honest and immediate (queue full → contract + Retry; member busy);
  * Retry re-runs the stored request; autocomplete answers inside its budget.
"""
from __future__ import annotations

import ast
import json
import pathlib
import time

import pytest

from tests.discord_harness import UT_GUILD, _app_client, _keypair, _post

from api.services import discord_interactions as di
from api.services.discord_render import commands, contract
from api.services.discord_render.jobs_store import JobsStore
from api.services.discord_render.runtime import JobRuntime

REPO = pathlib.Path(__file__).resolve().parents[1]


class FakeStore:
    def __init__(self, rows=None):
        self.rows = rows or {}

    def get(self, cid):
        return self.rows.get(cid)


class FakeRuntime:
    def __init__(self, status="queued", rows=None):
        self.status = status
        self.offered, self.acks, self.refused, self.reach = [], [], [], []
        self.per_user_max = 2
        self.store = FakeStore(rows)

    def offer(self, job):
        self.offered.append(job)
        return (self.status, 1 if self.status == "queued" else None)

    def record_ack(self, cid, ms):
        self.acks.append((cid, ms))

    def record_refused(self, job, cls):
        self.refused.append((job.corr_id, cls))

    def record_refusal_reach(self, cid, ms):
        """⚰️ MISSING SINCE D-05, AND THE TEST DIED ON AN AttributeError RATHER THAN A
        VERDICT. S5c added `record_refusal_reach` to the runtime and `commands.py:215`
        calls it on the refusal branch; this double was never given the method, so the
        one test that drives a refusal through the real router raised instead of
        asserting. ⛔ A stale test DOUBLE fails in the flattering direction: the
        production code was right and the harness could not run it."""
        self.reach.append((cid, ms))


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for k in ("DISCORD_RENDER_V2_ENABLED", "DISCORD_RENDER_V2_CHART_ENABLED", "DISCORD_RENDER_V2_FLOW_ENABLED",
              "DISCORD_RENDER_V2_BUZZ_ENABLED", "DISCORD_RENDER_V2_CONTROLS_ENABLED", "CHART_FLOW_CHANNEL_ID",
              "FLOW_CMD_CHANNEL_ID", "DISCORD_CHART_ALLOWED_GUILDS"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("DISCORD_CHART_SELF_HEAL", "0")
    di.reset_rate_for_tests()
    yield
    di.reset_rate_for_tests()


@pytest.fixture
def client(monkeypatch):
    sk, pub = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pub)
    tc, rt = _app_client()
    return tc, rt, sk


@pytest.fixture
def v2(monkeypatch):
    monkeypatch.setenv("DISCORD_RENDER_V2_ENABLED", "1")
    fake = FakeRuntime()
    monkeypatch.setattr(commands, "get_runtime", lambda: fake)
    return fake


def _slash(name="chart", options=None, iid="1415926535897932384", channel="999"):
    return {"type": 2, "id": iid, "application_id": "APP", "token": "TOK", "guild_id": UT_GUILD,
            "channel_id": channel, "member": {"user": {"id": "u1"}},
            "data": {"name": name, "options": options if options is not None else [{"name": "ticker", "value": "NVDA"}]}}


def _click(custom_id, values=None, iid="2718281828459045235"):
    data = {"custom_id": custom_id, "component_type": 2}
    if values is not None:
        data["values"] = values
    return {"type": 3, "id": iid, "application_id": "APP", "token": "TOK2", "guild_id": UT_GUILD, "channel_id": "999",
            "member": {"user": {"id": "u1"}}, "data": data, "message": {"content": "NVDA · Daily", "attachments": [{"id": "55"}]}}


# ── flag off / kill switch: the old path, untouched ──────────────────────────

def test_flag_off_never_consults_v2(client, monkeypatch):
    tc, rt, sk = client

    async def boom(*a, **k):
        raise AssertionError("V2 must not run with the flag off")
    monkeypatch.setattr(commands, "handle", boom)
    ran = []
    monkeypatch.setattr(rt.di, "run_chart_job", lambda *a, **k: ran.append(a))
    r = _post(tc, sk, _slash())
    assert r.status_code == 200 and r.json() == {"type": 5}
    assert ran, "the pre-V2 background job ran"


def test_a_per_command_kill_switch_sends_that_command_back_to_the_old_path(client, v2, monkeypatch):
    tc, rt, sk = client
    monkeypatch.setenv("DISCORD_RENDER_V2_CHART_ENABLED", "0")
    ran = []
    monkeypatch.setattr(rt.di, "run_chart_job", lambda *a, **k: ran.append(a))
    assert _post(tc, sk, _slash()).json() == {"type": 5}
    assert ran and v2.offered == []


# ── flag on: offer, defer, no BackgroundTask, no prefs I/O on the loop ───────

def test_v2_chart_is_offered_and_deferred_without_a_background_task(client, v2, monkeypatch):
    tc, rt, sk = client
    monkeypatch.setattr(rt.di, "run_chart_job", lambda *a, **k: (_ for _ in ()).throw(AssertionError("old job ran")))
    monkeypatch.setattr(rt, "_prefs_for", lambda uid: (_ for _ in ()).throw(AssertionError("prefs read on the ack path")))
    r = _post(tc, sk, _slash())
    assert r.json() == {"type": 5}
    (job,) = v2.offered
    assert job.command == "chart" and job.label == "/chart NVDA" and job.token == "TOK"
    assert job.corr_id == commands.corr_id("1415926535897932384") and job.interaction_type == 2
    assert v2.acks and v2.acks[0][0] == job.corr_id and v2.acks[0][1] < 1000.0


def test_several_tickers_become_one_multi_job(client, v2):
    tc, _, sk = client
    _post(tc, sk, _slash(options=[{"name": "ticker", "value": "NVDA AMD AVGO"}]))
    assert [j.command for j in v2.offered] == ["multi"] and v2.offered[0].label == "/chart NVDA AMD AVGO"


def test_an_invalid_ticker_is_refused_privately_and_never_queued(client, v2):
    tc, _, sk = client
    r = _post(tc, sk, _slash(options=[{"name": "ticker", "value": "N*VDA"}])).json()
    assert r["type"] == 4 and r["data"]["flags"] == di.EPHEMERAL and v2.offered == []


def test_the_channel_gate_still_applies(client, v2, monkeypatch):
    tc, _, sk = client
    monkeypatch.setenv("CHART_FLOW_CHANNEL_ID", "123")
    r = _post(tc, sk, _slash(channel="999")).json()
    assert r["type"] == 4 and "<#123>" in r["data"]["content"] and v2.offered == []


def test_queue_full_is_an_immediate_honest_refusal_with_a_retry_button(client, monkeypatch):
    tc, _, sk = client
    monkeypatch.setenv("DISCORD_RENDER_V2_ENABLED", "1")
    full = FakeRuntime(status="full")
    monkeypatch.setattr(commands, "get_runtime", lambda: full)
    r = _post(tc, sk, _slash()).json()
    cid = commands.corr_id("1415926535897932384")
    assert r["type"] == 4 and r["data"]["flags"] == di.EPHEMERAL
    assert r["data"]["content"] == contract.failure_content("/chart NVDA", "queue_full", cid)
    assert r["data"]["components"] == contract.failure_components(cid)
    assert full.refused == [(cid, "queue_full")]            # recorded, so Retry can find it


def test_a_member_with_too_much_in_flight_is_told_so(client, monkeypatch):
    tc, _, sk = client
    monkeypatch.setenv("DISCORD_RENDER_V2_ENABLED", "1")
    busy = FakeRuntime(status="user_busy")
    monkeypatch.setattr(commands, "get_runtime", lambda: busy)
    r = _post(tc, sk, _slash()).json()
    assert r["type"] == 4 and "already have 2 requests" in r["data"]["content"]


def test_v2_flow_is_labelled_with_its_window(client, v2):
    tc, _, sk = client
    _post(tc, sk, _slash("flow", [{"name": "ticker", "value": "DPRO"}, {"name": "days", "value": "30"}]))
    assert v2.offered[0].command == "flow" and v2.offered[0].label == "/flow DPRO · 30 days"


def test_a_control_click_is_a_deferred_update_job(client, v2):
    tc, _, sk = client
    cid = di.component_id("NVDA", "W", "house", True)
    assert _post(tc, sk, _click(cid)).json() == {"type": 6}
    (job,) = v2.offered
    assert job.command == "controls" and job.interaction_type == 3


def test_help_pick_stays_on_the_synchronous_old_path(client, v2, monkeypatch):
    tc, rt, sk = client
    monkeypatch.setattr(rt.di, "followup_ephemeral", lambda *a, **k: True)
    sel = di.chart_components(di.ChartRequest("NVDA", "D", expanded=True), dict(di.prefs_mod.DEFAULTS))[-1]["components"][0]
    r = _post(tc, sk, _click(sel["custom_id"], values=[di.HELP_VALUE])).json()
    assert r["type"] == 7 and v2.offered == []


def test_retry_reruns_the_stored_request_on_the_new_token(client, monkeypatch):
    tc, _, sk = client
    monkeypatch.setenv("DISCORD_RENDER_V2_ENABLED", "1")
    stored = {"command": "flow", "ephemeral": 0,
              "args_json": json.dumps({"args": {"data": {"name": "flow", "options": [{"name": "ticker", "value": "DPRO"}]}},
                                       "label": "/flow DPRO · today"})}
    rt_fake = FakeRuntime(rows={"7f3a9c21": stored})
    monkeypatch.setattr(commands, "get_runtime", lambda: rt_fake)
    r = _post(tc, sk, _click(contract.retry_custom_id("7f3a9c21"))).json()
    assert r == {"type": 6}
    (job,) = rt_fake.offered
    assert job.command == "flow" and job.token == "TOK2" and job.label == "/flow DPRO · today"
    assert job.args["data"]["options"][0]["value"] == "DPRO"


def test_retry_of_an_unknown_request_says_it_expired(client, v2):
    tc, _, sk = client
    r = _post(tc, sk, _click(contract.retry_custom_id("deadbeef"))).json()
    assert r["type"] == 4 and "expired" in r["data"]["content"] and v2.offered == []


def test_autocomplete_answers_inside_its_budget_even_when_search_hangs(client, v2, monkeypatch):
    tc, rt, sk = client
    monkeypatch.setattr(commands, "AUTOCOMPLETE_BUDGET_S", 0.3)
    monkeypatch.setattr(rt, "fetch_ticker_choices", lambda q: (time.sleep(2.0), [])[1])
    payload = {"type": 4, "id": "9", "application_id": "APP", "token": "T", "guild_id": UT_GUILD,
               "data": {"name": "chart", "options": [{"name": "ticker", "value": "AEHL", "focused": True}]}}
    t0 = time.perf_counter()
    r = _post(tc, sk, payload).json()
    assert time.perf_counter() - t0 < 1.5
    assert r == {"type": 8, "data": {"choices": [{"name": "AEHL - chart it", "value": "AEHL"}]}}


# ── worker-side handlers ────────────────────────────────────────────────────

class Ctx:
    def __init__(self, job):
        self.job = job
        self.edits, self.fails = [], []

    def edit(self, app_id, token, **kw):
        self.edits.append(kw)
        return {"id": "m", "attachments": []}

    def fail(self, cls, detail=""):
        self.fails.append(cls)
        return True


def test_the_worker_resolves_the_default_timeframe_from_prefs(monkeypatch):
    from api.routers import discord_interactions as router
    monkeypatch.setattr(router, "_prefs_for", lambda uid: {**di.prefs_mod.DEFAULTS, "tf": "W"})
    seen = {}
    monkeypatch.setattr(di, "run_chart_job", lambda app, tok, req, **kw: seen.update(req=req, kw=kw) or "ok")
    job = commands._job(_slash(), "chart", "/chart NVDA")
    commands._handle_chart(Ctx(job))
    assert seen["req"].tf == "W" and seen["kw"]["fail_fn"] is not None


def test_the_flow_worker_gets_the_short_timeout_the_cid_and_the_contract(monkeypatch):
    from api.routers import discord_interactions as router
    seen = {}
    monkeypatch.setattr(router, "run_flow_card_job", lambda app, tok, tkr, days, **kw: seen.update(tkr=tkr, days=days, **kw))
    job = commands._job(_slash("flow", [{"name": "ticker", "value": "DPRO"}]), "flow", "/flow DPRO · today")
    ctx = Ctx(job)
    commands._handle_flow(ctx)
    assert (seen["tkr"], seen["days"], seen["timeout_s"], seen["cid"]) == ("DPRO", "1", commands.FLOW_TIMEOUT_S, job.corr_id)
    # ⚠️ Since P2.1 this is the adapter's wrapper, not `ctx.fail` itself — the wrapper corrects the
    # router's generic `flow_error` to the class the adapter actually observed (OI-23). The property
    # this test was written for is unchanged and is asserted the stronger way: whatever the handler
    # hands over must end up in the CONTRACT, not in a per-site sentence.
    assert seen["fail_fn"] is not None
    seen["fail_fn"]("flow_timeout", "no answer in 10s")
    assert ctx.fails == ["flow_timeout"], (
        "the failure reporter the handler passed did not reach the contract")


def test_end_to_end_a_real_runtime_delivers_and_records_a_chart(tmp_path, monkeypatch):
    from api.routers import discord_interactions as router
    monkeypatch.setattr(router, "_prefs_for", lambda uid: dict(di.prefs_mod.DEFAULTS))

    def fake_run_chart_job(app, tok, req, *, edit_fn, fail_fn, **kw):
        edit_fn(app, tok, content="NVDA · Daily", png=b"\x89PNG", filename="NVDA.png")
        return "ok"
    monkeypatch.setattr(di, "run_chart_job", fake_run_chart_job)
    store = JobsStore(str(tmp_path / "jobs.db"))
    runtime = JobRuntime(store=store, handlers=commands.HANDLERS, edit_fn=lambda *a, **k: {"id": "m"},
                         delivery=None, owner="pod-T")
    job = commands._job(_slash(), "chart", "/chart NVDA")
    out = runtime.run_job(job)
    assert out["state"] == "delivered" and store.get(job.corr_id)["token"] is None


# ── lifespan wiring rail ────────────────────────────────────────────────────

def test_lifespan_starts_v2_before_serving_and_releases_leases_after():
    """AST over api/main.py: a start call before the lifespan's `yield`, a stop call after it.
    Without the start, a restarted pod never resumes the jobs a dead one left; without the
    stop, every lease waits out 20 s. Both are invisible in a green suite otherwise."""
    tree = ast.parse((REPO / "api" / "main.py").read_text(encoding="utf-8"))
    life = next(n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef) and n.name == "lifespan")
    yield_line = next(n.lineno for n in ast.walk(life) if isinstance(n, ast.Yield))
    starts, stops = [], []
    for n in ast.walk(life):
        if isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name) and n.value.id.startswith("_render_v2"):
            (starts if n.attr == "start" else stops if n.attr == "stop" else []).append(n.lineno)
    assert starts and min(starts) < yield_line, "discord-render V2 start must run before the lifespan yields"
    assert stops and min(stops) > yield_line, "discord-render V2 stop must run after the lifespan yields"
    # control: the walk can see an attribute it is not looking for
    assert any(isinstance(n, ast.Attribute) and n.attr == "shutdown" for n in ast.walk(life))
