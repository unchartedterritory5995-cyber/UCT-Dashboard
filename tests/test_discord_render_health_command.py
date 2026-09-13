"""/renderhealth — admin-only V2 health in Discord (step 2.2, OI-09).

What must hold:
  * it is NOT in the default command set — registering it changes the command list in every
    server, so it is registered at flip time — and it is admin-only when it is registered;
  * a member without the admin bit is refused SERVER-SIDE, because `default_member_permissions`
    is only a default a server can override per role;
  * the reply is private and answered inside the ack budget, with no chart-renderer HTTP probe
    on the event loop (it shows the observer's cached reading).
"""
from __future__ import annotations

import importlib
import json
import time

import httpx
import pytest

from tests.discord_harness import UT_GUILD, _app_client, _keypair, _post

from api.services import discord_interactions as di
from api.services.discord_render import commands, observe
from api.services.discord_render.jobs_store import JobsStore


class RT:
    owner = "pod-X"
    commit = "abc123def456"

    def __init__(self, store):
        self.store = store

    def depth(self):
        return {"interactive": 0, "background": 0, "active": 1, "workers": 6, "bg_running": 0}


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for k in ("DISCORD_RENDER_ADMIN_USER_IDS", "DISCORD_CHART_ALLOWED_GUILDS", "DISCORD_RENDER_ALERT_WEBHOOK"):
        monkeypatch.delenv(k, raising=False)
    di.reset_rate_for_tests()
    yield
    di.reset_rate_for_tests()


@pytest.fixture
def v2(monkeypatch, tmp_path):
    sk, pub = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pub)
    monkeypatch.setenv("DISCORD_RENDER_V2_ENABLED", "1")
    store = JobsStore(str(tmp_path / "jobs.db"))
    # The handler PEEKS `_runtime` (it must never start V2 just to answer), so the fake is
    # installed as the module's runtime rather than behind get_runtime().
    monkeypatch.setattr(commands, "_runtime", RT(store))
    monkeypatch.setattr(commands, "get_runtime",
                        lambda: (_ for _ in ()).throw(AssertionError("/renderhealth started the V2 runtime")))
    monkeypatch.setattr(commands, "_observer", None)
    tc, router = _app_client()

    def probe(*a, **k):
        raise AssertionError("chart-renderer probed on the ack path")
    monkeypatch.setattr(router, "_renderer_health", probe)
    yield tc, sk, store
    store.close()


def _health(perms=None, uid="u1"):
    member = {"user": {"id": uid}}
    if perms is not None:
        member["permissions"] = perms
    return {"type": 2, "id": "3141592653589793238", "application_id": "APP", "token": "TOK", "guild_id": UT_GUILD,
            "channel_id": "999", "member": member, "data": {"name": "renderhealth"}}


# ── registration ────────────────────────────────────────────────────────────

def test_it_is_not_in_the_default_command_set():
    assert "renderhealth" not in [c["name"] for c in di.build_commands()]
    assert "renderhealth" not in [c["name"] for c in di.build_commands(activity=True)]


def test_when_asked_for_it_is_admin_only_and_guild_only():
    cmd = next(c for c in di.build_commands(renderhealth=True) if c["name"] == "renderhealth")
    assert cmd["default_member_permissions"] == "8"
    assert cmd["integration_types"] == [0] and cmd["contexts"] == [0]


def test_the_register_tool_puts_it_only_with_the_flag():
    tool = importlib.import_module("tools.discord_chart_commands")
    bodies = []

    def handler(request):
        bodies.append(json.loads(request.content))
        return httpx.Response(200, json=bodies[-1])
    client = tool.make_client("bot-token", transport=httpx.MockTransport(handler))
    tool.register(client, "999", "123")
    tool.register(client, "999", "123", renderhealth=True)
    assert "renderhealth" not in [c["name"] for c in bodies[0]]
    assert "renderhealth" in [c["name"] for c in bodies[1]]


# ── the handler ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("perms", [None, "0", "2048", "not-a-number"])
def test_a_member_without_the_admin_bit_is_refused(v2, perms):
    tc, sk, _ = v2
    r = _post(tc, sk, _health(perms)).json()
    assert r["type"] == 4 and r["data"]["flags"] == di.EPHEMERAL
    assert r["data"]["content"] == "/renderhealth is for server admins."


def test_an_admin_gets_the_health_privately(v2):
    tc, sk, store = v2
    store.insert({"corr_id": "dead0001", "command": "chart", "state": "queued", "token": "T", "app_id": "A"})
    store.claim("dead0001", "pod", 60)
    store.finish("dead0001", "messaged", owner="pod", ack_ms=40.0, failure_class="deadline")
    r = _post(tc, sk, _health(str(0x8 | 0x400))).json()
    assert r["type"] == 4 and r["data"]["flags"] == di.EPHEMERAL
    text = r["data"]["content"]
    assert text.startswith("Render V2") and "deadline×1" in text and "dead0001" in text
    assert "Renderer: not probed yet" in text and len(text) <= 2000


def test_it_answers_with_v2_off_and_starts_nothing(monkeypatch, tmp_path):
    """⛔ The command is registered BEFORE the flip, so it must answer while V2 is off — and must
    not start the runtime or create the jobs database as a side effect of being asked."""
    sk, pub = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pub)
    monkeypatch.delenv("DISCORD_RENDER_V2_ENABLED", raising=False)     # V2 OFF
    db = tmp_path / "jobs.db"
    monkeypatch.setenv("DISCORD_RENDER_DB_PATH", str(db))
    monkeypatch.setattr(commands, "_runtime", None)
    monkeypatch.setattr(commands, "_observer", None)
    monkeypatch.setattr(commands, "get_runtime",
                        lambda: (_ for _ in ()).throw(AssertionError("/renderhealth started the V2 runtime")))
    tc, _ = _app_client()
    r = _post(tc, sk, _health("8")).json()
    assert r["type"] == 4 and r["data"]["flags"] == di.EPHEMERAL
    assert "off" in r["data"]["content"] and "DISCORD_RENDER_V2_ENABLED" in r["data"]["content"]
    assert not db.exists(), "asking for health created the jobs database"


def test_with_v2_off_it_reads_an_existing_database_without_starting_the_runtime(monkeypatch, tmp_path):
    sk, pub = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pub)
    monkeypatch.delenv("DISCORD_RENDER_V2_ENABLED", raising=False)
    db = tmp_path / "jobs.db"
    monkeypatch.setenv("DISCORD_RENDER_DB_PATH", str(db))
    s = JobsStore(str(db))
    s.insert({"corr_id": "00000001", "command": "chart", "state": "queued", "token": "T", "app_id": "A"})
    s.claim("00000001", "pod", 60)
    s.finish("00000001", "delivered", owner="pod", ack_ms=40.0, final_ms=2100.0, quality="image")
    s.close()
    monkeypatch.setattr(commands, "_runtime", None)
    monkeypatch.setattr(commands, "_observer", None)
    monkeypatch.setattr(commands, "get_runtime",
                        lambda: (_ for _ in ()).throw(AssertionError("/renderhealth started the V2 runtime")))
    tc, _ = _app_client()
    text = _post(tc, sk, _health("8")).json()["data"]["content"]
    assert text.startswith("Render V2") and "runtime not started" in text


def test_an_allowlisted_user_passes_without_the_bit(v2, monkeypatch):
    tc, sk, _ = v2
    monkeypatch.setenv("DISCORD_RENDER_ADMIN_USER_IDS", "u9, u1")
    assert _post(tc, sk, _health("0")).json()["data"]["content"].startswith("Render V2")


def test_it_shows_the_observers_cached_renderer_reading(v2, monkeypatch):
    tc, sk, store = v2
    obs = observe.Observer(store, renderer_fn=lambda: {"reachable": False, "ready": False, "error": "ConnectError"},
                           post_fn=lambda *a: True, webhook_fn=lambda: "")
    obs.run_once()
    obs.run_once()                                   # two consecutive misses: what the alert rule needs
    monkeypatch.setattr(commands, "_observer", obs)
    text = _post(tc, sk, _health("8")).json()["data"]["content"]
    assert "Renderer: NOT READY (ConnectError)" in text and "renderer_not_ready" in text


def test_a_slow_store_gets_an_honest_answer_inside_the_budget(v2, monkeypatch):
    tc, sk, _ = v2
    monkeypatch.setattr(commands, "HEALTH_BUDGET_S", 0.2)
    # Returns a REAL payload after the budget: a handler that ignored the budget would print
    # "Render V2 …" after 1.5 s, which both assertions below would catch.
    monkeypatch.setattr(observe, "health_payload", lambda *a, **k: (time.sleep(1.5), {"queue": None})[1])
    t0 = time.perf_counter()
    r = _post(tc, sk, _health("8")).json()
    assert time.perf_counter() - t0 < 1.2
    assert "did not answer within 0.2 s" in r["data"]["content"] and r["data"]["flags"] == di.EPHEMERAL


# ── lifecycle ───────────────────────────────────────────────────────────────

def test_start_runs_the_observer_and_stop_ends_it(monkeypatch, tmp_path):
    from api.routers import discord_interactions as router
    monkeypatch.setenv("DISCORD_RENDER_DB_PATH", str(tmp_path / "jobs.db"))
    unconfigured = lambda *a, **k: None  # noqa: E731
    monkeypatch.setattr(router, "_renderer_health", unconfigured)
    monkeypatch.setattr(commands, "_runtime", None)
    monkeypatch.setattr(commands, "_observer", None)
    commands.start()
    obs = commands._observer
    try:
        assert obs is not None and obs._thread is not None and obs._thread.is_alive()
        assert obs.renderer_fn is unconfigured and obs.store is commands._runtime.store
    finally:
        commands.stop()
    assert commands._observer is None and commands._runtime is None and obs._stop.is_set()
