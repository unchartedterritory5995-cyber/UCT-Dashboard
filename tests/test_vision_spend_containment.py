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


# ═══ one member's share of the lane ══════════════════════════════════════════════════════════════
def test_one_members_timeouts_stop_at_their_share_and_the_lane_stays_open(real):
    """Before: one member's timeouts could reserve the whole $4 and refuse everyone else for the day."""
    client, worst = Client(lambda: (_ for _ in ()).throw(Timeout())), real.svc.worst_case_usd()
    share = real.svc.MEMBER_VISION_USD
    outs = [ask(real, client, user="heavy") for _ in range(40)]
    assert client.calls == int(share / worst)
    assert outs[-1]["gate"] == "vision:member-share"
    assert interactive(real) <= share
    assert ask(real, Client(), user="someone-else").get("gate") not in ("vision:spend-cap", "vision:member-share")


def test_the_share_is_inside_the_lane_and_the_lanes_total_is_unchanged(real):
    assert real.svc.MEMBER_VISION_USD == 1.00
    assert real.guard.interactive_limit_usd() == 4.0 and real.guard.hard_cap_usd() == 15.0
    client, worst = Client(lambda: (_ for _ in ()).throw(Timeout())), real.svc.worst_case_usd()
    outs = [ask(real, client, user=f"u{i // 2}") for i in range(80)]
    assert client.calls == int(real.guard.interactive_limit_usd() / worst)
    assert outs[-1]["gate"] == "vision:spend-cap"


def test_settled_reads_give_their_room_back_to_the_member(real):
    """The share counts dollars, so ordinary reads cost what they cost, not their reservation."""
    client, actual = Client(lambda: reply((1200, 300))), real.guard.estimate_cost(real.svc.MODEL, 1200, 300)
    outs = [ask(real, client, user="ordinary") for _ in range(40)]
    assert all(o.get("gate") != "vision:member-share" for o in outs)
    assert client.calls == 40 and interactive(real) == pytest.approx(actual * 40)


def test_racing_uploads_of_one_member_hold_the_share(real):
    client, worst = Client(lambda: (_ for _ in ()).throw(Timeout())), real.svc.worst_case_usd()
    share = real.svc.MEMBER_VISION_USD
    barrier = threading.Barrier(12)

    def one():
        barrier.wait()
        ask(real, client, user="racer")

    threads = [threading.Thread(target=one) for _ in range(12)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert client.calls == int(share / worst)


def test_raising_the_lane_does_not_raise_a_members_dollar(real, monkeypatch):
    """Before: the share was a fraction of the lane, so a raised lane quietly raised every member's ceiling."""
    monkeypatch.setenv("INTERACTIVE_AI_RESERVE_USD", "8.00")
    client, worst = Client(lambda: (_ for _ in ()).throw(Timeout())), real.svc.worst_case_usd()
    outs = [ask(real, client, user="heavy") for _ in range(20)]
    assert client.calls == int(1.00 / worst) and outs[-1]["gate"] == "vision:member-share"


def test_the_ledger_keeps_estimates_apart_from_confirmed_charges(real):
    ask(real, Client(lambda: reply((1200, 300))), user="ok")
    ask(real, Client(lambda: (_ for _ in ()).throw(Timeout())), user="timed-out")
    split = real.store.estimated_and_confirmed(real.day, "indicator-vision:")
    assert split["confirmed_usd"] == pytest.approx(real.guard.estimate_cost(real.svc.MODEL, 1200, 300), abs=1e-5)
    assert split["estimated_usd"] == pytest.approx(real.svc.worst_case_usd(), abs=1e-5)


def test_a_share_refusal_makes_no_ledger_row(real):
    worst = real.svc.worst_case_usd()
    slot = real.guard.reserve_member_call(real.day, "indicator-vision:x", real.svc.MODEL, worst,
                                          member_limit_usd=worst / 2)
    assert slot == {"refused": "member-share"} and interactive(real) == 0


def test_a_caller_with_no_share_is_unchanged(real):
    assert real.guard.reserve_member_call(real.day, "concierge:x", real.svc.MODEL, 0.5).get("id")


# ═══ the honest worst case ═══════════════════════════════════════════════════════════════════════
def _request(svc, note=""):
    return dict(model=svc.MODEL, max_tokens=svc.MAX_TOKENS, system=svc.system_prompt(), tools=[svc.anthropic_tool()],
                tool_choice={"type": "tool", "name": svc.TOOL_NAME}, messages=svc.user_turn(b"", "image/png", note))


def test_the_worst_case_is_about_33_cents_not_47(real):
    from api.services.uct_agent import budget
    assert real.svc.worst_case_usd() == pytest.approx(0.332, abs=0.001)
    assert budget.worst_case_usd(_request(real.svc)) > 0.40           # what the byte bound charges for the same call


def test_the_pinned_prompt_covers_the_prompt_as_it_stands(real):
    """Fails when the prompt or schema grows: re-measure it, or a reservation stops being a bound."""
    from api.services.uct_agent import budget
    assert budget.request_bytes(_request(real.svc)) / 2 + budget.FRAMING_TOKENS <= real.svc.PROMPT_TOKENS_WORST


def test_this_call_asks_for_no_cache_so_plain_input_rates_are_the_ceiling(real):
    import json
    assert "cache_control" not in json.dumps(_request(real.svc), default=str)


def test_a_note_counts_at_a_token_per_byte(real):
    from api.services.uct_agent import budget
    note = "n" * real.svc.NOTE_MAX
    extra = real.svc.worst_case_usd(note) - real.svc.worst_case_usd()
    assert extra == pytest.approx(budget._price(real.svc.MODEL, input=len(note)))


def test_a_timeout_settles_at_the_honest_figure(real):
    ask(real, Client(lambda: (_ for _ in ()).throw(Timeout())))
    assert interactive(real) == pytest.approx(real.svc.worst_case_usd()) and interactive(real) <= 0.34


def test_the_lane_is_no_larger_because_the_reservation_is_smaller(real):
    assert real.guard.interactive_limit_usd() == 4.0
    assert real.svc.MEMBER_VISION_USD == 1.00
