"""Indicator vision (Opus, enabled in production): spend containment on the shared ledger.

No model or network is ever called: every client here is a stub. The ledger, its transaction and its
threads are real (SQLite in tmp_path), because what is under test is the bound, not the arithmetic.

Before this: the $4 interactive gate was read BEFORE a call and spend written AFTER it, a timed-out call or a
reply with no usage wrote nothing or $0, and the 10-an-hour count lived in one process's memory.
"""
from __future__ import annotations

import importlib
import threading
import types
import uuid

import pytest


PIXEL = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


class Timeout(Exception):
    """A client-side failure that is NOT an HTTP error response: the call may have been billed."""


def reply(usage=(1200, 300)):
    u = None if usage is None else types.SimpleNamespace(input_tokens=usage[0], output_tokens=usage[1])
    return types.SimpleNamespace(content=[], usage=u)


class Client:
    """A stub provider. `fn` raises or returns; `calls` counts what would have been billable."""

    def __init__(self, fn=lambda: reply()):
        self.fn, self.calls, self.messages, self._lock = fn, 0, self, threading.Lock()

    def create(self, **kw):
        with self._lock:
            self.calls += 1
        return self.fn()


@pytest.fixture
def real(monkeypatch, tmp_path):
    """The real ledger in a temp file, with the coded limits ($15 hard, $4 interactive)."""
    monkeypatch.setenv("CATALYST_DB_PATH", str(tmp_path / "catalysts.db"))
    for k in ("CATALYST_COST_HARD_CAP", "INTERACTIVE_AI_RESERVE_USD", "CATALYST_COST_CAP_DAILY"):
        monkeypatch.delenv(k, raising=False)
    from api.services.catalyst import store
    importlib.reload(store)
    store._init_db()
    from api.services.catalyst import cost_guard
    importlib.reload(cost_guard)
    from api.services import indicator_from_image as svc
    monkeypatch.setattr(svc, "cost_guard", cost_guard)
    yield types.SimpleNamespace(store=store, guard=cost_guard, svc=svc,
                                day=svc.concierge._market_date())
    monkeypatch.delenv("CATALYST_DB_PATH", raising=False)
    importlib.reload(store)
    importlib.reload(cost_guard)


def ask(r, client, user="u1", **kw):
    return r.svc.candidates_from_image(image_bytes=PIXEL, media_type="image/png", user_id=user,
                                       client=client, **kw)


def interactive(r) -> float:
    return r.guard.spend_by_kind(r.day)["interactive"]


# ═══ the reservation is the worst case, and the worst case bounds the call ═══════════════════════
def test_the_worst_case_bounds_a_full_call_and_fits_inside_the_interactive_limit(real):
    worst = real.svc.worst_case_usd("n" * real.svc.NOTE_MAX)
    # every output token + the documented image ceiling, at the model's own rates
    assert worst >= real.guard.estimate_cost(real.svc.MODEL, real.svc.IMAGE_TOKENS_WORST, real.svc.MAX_TOKENS)
    assert 0 < worst < real.guard.interactive_limit_usd()


def test_a_call_is_RESERVED_before_the_model_runs_and_settled_after(real):
    seen = {}

    def during():
        seen["open"] = interactive(real)
        return reply((1200, 300))

    out = ask(real, Client(during))
    assert seen["open"] == pytest.approx(real.svc.worst_case_usd())
    actual = real.guard.estimate_cost(real.svc.MODEL, 1200, 300)
    assert interactive(real) == pytest.approx(actual)
    assert out["cost_usd"] == pytest.approx(actual, abs=1e-5)


# ═══ the calls that report no cost: the leak this closes ═════════════════════════════════════════
@pytest.mark.parametrize("fn", [lambda: (_ for _ in ()).throw(Timeout()), lambda: reply(None)],
                         ids=["timeout", "no-usage"])
def test_a_call_that_reports_no_cost_is_charged_its_WORST_CASE(real, fn):
    ask(real, Client(fn))
    assert interactive(real) == pytest.approx(real.svc.worst_case_usd())


def test_endless_timeouts_STOP_at_the_interactive_limit(real):
    """The runaway shape: every call times out, nothing reports usage, and a ledger that wrote $0 never trips."""
    client, worst = Client(lambda: (_ for _ in ()).throw(Timeout())), real.svc.worst_case_usd()
    outs = [ask(real, client, user=f"u{i}") for i in range(60)]
    assert client.calls == int(real.guard.interactive_limit_usd() / worst)
    assert interactive(real) <= real.guard.interactive_limit_usd()
    assert outs[-1]["gate"] == "vision:spend-cap"


def test_an_HTTP_error_response_is_not_billed_but_still_uses_its_hourly_place(real):
    import anthropic
    import httpx
    err = anthropic.InternalServerError("overloaded", response=httpx.Response(
        500, request=httpx.Request("POST", "https://api.anthropic.com/v1/messages")), body=None)
    client = Client(lambda: (_ for _ in ()).throw(err))
    for _ in range(3):
        assert ask(real, client, max_per_hour=2)["gate"] in ("vision:transport", "vision:hourly")
    assert interactive(real) == 0
    assert client.calls == 2


def test_a_process_that_dies_mid_call_leaves_its_worst_case_on_the_ledger(real):
    class Dead(BaseException):
        pass

    with pytest.raises(Dead):
        ask(real, Client(lambda: (_ for _ in ()).throw(Dead())))
    assert interactive(real) == pytest.approx(real.svc.worst_case_usd())


# ═══ concurrency, on real threads and real SQLite ════════════════════════════════════════════════
def test_concurrent_calls_cannot_overrun_the_limit(real):
    """Before: 40 threads all read $0 and all ran. The count admitted is exact, and it is bounded."""
    worst = real.svc.worst_case_usd()
    release, client = threading.Event(), None

    def slow():
        release.wait(10)                  # nothing settles until every thread has been decided
        raise Timeout()

    client = Client(slow)
    barrier, outs = threading.Barrier(40), []

    def one(i):
        barrier.wait()
        outs.append(ask(real, client, user=f"m{i}"))

    ts = [threading.Thread(target=one, args=(i,)) for i in range(40)]
    [t.start() for t in ts]
    expected = int(real.guard.interactive_limit_usd() / worst)
    for _ in range(400):                   # the refusals return at once; the admitted calls wait
        if len(outs) == 40 - expected:
            break
        threading.Event().wait(0.05)
    release.set()
    [t.join() for t in ts]
    assert client.calls == expected
    assert sum(o["gate"] == "vision:spend-cap" for o in outs) == 40 - expected
    assert interactive(real) <= real.guard.interactive_limit_usd()


def test_a_restarted_module_sees_the_same_reservation(real):
    """The reservation is in SQLite, not in memory. (A reload, not a real second OS process.)"""
    ask(real, Client(lambda: reply(None)), user="u1")
    importlib.reload(real.store)            # the state a separate process starts from
    assert interactive(real) == pytest.approx(real.svc.worst_case_usd())


# ═══ the hourly count: durable, per member ═══════════════════════════════════════════════════════
def test_the_hourly_count_survives_a_restart_and_is_per_member(real):
    client = Client()
    for _ in range(3):
        assert ask(real, client, max_per_hour=3).get("gate") != "vision:hourly"
    out = ask(real, client, max_per_hour=3)
    assert out["gate"] == "vision:hourly" and out["retry_after"] >= 1
    assert client.calls == 3
    assert ask(real, client, user="other", max_per_hour=3).get("gate") != "vision:hourly"


def test_the_hourly_window_rolls_off(real):
    r = real.guard.reserve_member_call(real.day, "indicator-vision:u", "m", 0.01, max_per_hour=1, now=1_000_000)
    assert "id" in r
    assert real.guard.reserve_member_call(real.day, "indicator-vision:u", "m", 0.01, max_per_hour=1,
                                          now=1_000_000 + 3599)["refused"] == "hourly"
    assert "id" in real.guard.reserve_member_call(real.day, "indicator-vision:u", "m", 0.01, max_per_hour=1,
                                                  now=1_000_000 + 3601)


def test_the_ROUTE_refuses_the_eleventh_picture_after_a_restart(real, monkeypatch):
    """The owner's question, end to end: the process counter is emptied, and the 11th is still a 429."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import indicator_vision as route, user_definitions
    monkeypatch.setenv("INDICATOR_VISION_ENABLED", "1")
    client = Client()
    monkeypatch.setattr(real.svc, "_default_client", lambda: client)
    monkeypatch.setattr(route.telemetry, "log_event", lambda *a, **k: None)
    app = FastAPI()
    app.include_router(route.router)
    uid = f"member-{uuid.uuid4()}"
    app.dependency_overrides[route.require_paid] = lambda: {"id": uid, "plan": "pro"}
    assert route.require_paid is user_definitions.require_paid
    http = TestClient(app)

    def post():
        return http.post("/api/indicator-vision/candidates", files={"file": ("c.png", PIXEL, "image/png")})

    for _ in range(route.VISION_MAX_PER_HOUR):
        assert post().status_code == 200
    route._calls.clear()                    # a deploy: the process's memory is gone
    r = post()
    assert r.status_code == 429 and "Retry-After" in r.headers
    assert client.calls == route.VISION_MAX_PER_HOUR
    route._calls.clear()


# ═══ fail closed, and no route around the ledger ═════════════════════════════════════════════════
def test_an_unusable_ledger_refuses_the_call(real, monkeypatch):
    monkeypatch.setattr(real.guard, "may_member_spend", lambda d: True)

    def broken(**kw):
        raise OSError("disk")

    monkeypatch.setattr(real.store, "reserve_cost", broken)
    client = Client()
    assert ask(real, client)["gate"] == "vision:spend-cap"
    assert client.calls == 0


def test_the_hard_ceiling_refuses_even_with_interactive_room(real):
    real.guard.record(real.day, "AAPL", "claude-opus-5", 0, 0, search_requests=1500)     # $15 of background rows
    client = Client()
    assert ask(real, client)["gate"] == "vision:spend-cap" and client.calls == 0


def test_no_vision_model_call_escapes_the_reservation():
    """A second `.messages.create` in this module would be a call the ledger never admitted."""
    import re
    from pathlib import Path
    src = Path("api/services/indicator_from_image.py").read_text(encoding="utf-8")
    assert len(re.findall(r"\.messages\.create\(", src)) == 1
    assert src.index("reserve_member_call(") < src.index(".messages.create(")
