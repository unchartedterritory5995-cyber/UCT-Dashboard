"""Gap 3 — `/chart` is shadowed, proved through the REAL route with a REAL signature.

⛔⛔ WHY THIS EXISTS. Monday's shadow evidence held eight records, every one of them `/flow` and
none of them `/chart`. Two explanations fit that equally: nobody ran `/chart` overnight, or the
shadow hook never fires for it — and **an absence is only evidence if the instrument could have
seen a presence.** The log pull answered half of it (it is EXACT: eight interactions, all `/flow`,
all inside one eleven-second burst, so there was no `/chart` traffic to record). This file answers
the other half, and answers it permanently: if the hook is ever wired to one command and not
another, a test fails instead of a Monday going quiet.

⛔ THROUGH THE ROUTE, NOT THROUGH `observe_ack`. Calling `observe_ack` directly proves the emitter
works and says nothing about whether the route reaches it — which is exactly the gap that made the
`/chart` question unanswerable. This drives `POST /api/discord/interactions` with a genuine Ed25519
signature over a genuine chart payload, and reads what the emitter emitted.

⛔ AND THE SIGNATURE IS REAL. Monkeypatching `verify_signature` to return True would leave the one
gate between the socket and `request.state.drender_interaction` untested, and that assignment is
what the shadow reads. A keypair costs three lines.
"""
from __future__ import annotations

import json

import pytest
from nacl.signing import SigningKey

from api.services import discord_interactions as di
from api.services.discord_render import observe


@pytest.fixture()
def signed(monkeypatch):
    """A client that signs like Discord does, against a key the app is told to trust."""
    from fastapi.testclient import TestClient

    from api.routers import discord_interactions as router

    key = SigningKey.generate()
    monkeypatch.setattr(router, "_public_key", lambda: key.verify_key.encode().hex())
    monkeypatch.setattr(di, "guild_allowed", lambda interaction: True)
    monkeypatch.setenv("RENDER_V2_SHADOW", "1")
    monkeypatch.delenv("DISCORD_RENDER_V2_ENABLED", raising=False)

    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(router.router)
    client = TestClient(app)

    def post(interaction: dict):
        body = json.dumps(interaction).encode()
        ts = "1757800000"
        sig = key.sign(ts.encode() + body).signature.hex()
        return client.post("/api/discord/interactions", content=body,
                           headers={"X-Signature-Ed25519": sig, "X-Signature-Timestamp": ts,
                                    "Content-Type": "application/json"})
    return post


@pytest.fixture()
def emitted(monkeypatch):
    seen: list[tuple] = []
    real = observe.event
    monkeypatch.setattr(observe, "event", lambda name, **kw: seen.append((name, kw)) or real(name, **kw))
    return seen


def _interaction(command: str, ticker: str = "NVDA") -> dict:
    return {"type": 2, "id": "i1", "application_id": "app", "token": "tok", "guild_id": "g1",
            "channel_id": "c1", "member": {"user": {"id": "u1"}},
            "data": {"name": command, "options": [{"name": "ticker", "value": ticker}]}}


def _shadow_records(seen) -> list[dict]:
    return [kw for name, kw in seen if name == "shadow"]


def _drain(pool_wait: float = 5.0) -> None:
    """The shadow runs on `commands._io_pool` AFTER the reply, so the assertion has to wait for it.

    ⛔ A sleep would make this flaky on a contended box and green on a broken hook when the box is
    fast. Draining the pool's queue is the deterministic form."""
    import time

    from api.services.discord_render.commands import _io_pool
    fut = _io_pool.submit(lambda: None)      # FIFO: it completes after everything already queued
    fut.result(timeout=pool_wait)
    time.sleep(0.05)                          # the emit happens inside the prior task, not after it


@pytest.mark.parametrize("command", ["chart", "flow"])
def test_every_command_that_reaches_the_route_produces_a_shadow_record(signed, emitted, command):
    """⛔ PARAMETRISED OVER BOTH, so "it works for flow" can never again be mistaken for "it works".

    The bug this forbids is a hook registered per command. There is no such registration today —
    the route submits unconditionally — and this is what keeps that true."""
    resp = signed(_interaction(command))
    assert resp.status_code == 200, resp.text
    _drain()
    recs = _shadow_records(emitted)
    assert recs, f"no shadow record at all for /{command} — the hook did not fire"
    assert any(r.get("cmd") == command for r in recs), (
        f"a shadow record was emitted but not for /{command}: {[r.get('cmd') for r in recs]}")


def test_the_chart_record_carries_the_fields_the_monday_line_reads(signed, emitted):
    """⛔ A RECORD WITH NO CONTENT IS THE DEFECT THIS PROGRAMME ALREADY SHIPPED ONCE.

    Shadow mode ran live for twenty minutes emitting `{"evt":"shadow","cmd":"chart","ms":12.3}` —
    the right rate, plausible latency, nothing to read — because `observe.event` drops
    non-allowlisted fields SILENTLY. `shadow_report.py` reads `outcome` and `detail`; if either
    stops arriving, Monday's line is content-free and looks fine."""
    assert signed(_interaction("chart")).status_code == 200
    _drain()
    chart = [r for r in _shadow_records(emitted) if r.get("cmd") == "chart"]
    assert chart, "no /chart shadow record"
    rec = chart[-1]
    assert isinstance(rec.get("ms"), (int, float))
    assert rec.get("outcome") in ("agree", "divergence", "could_not_tell", "budget", "error"), rec
    detail = rec.get("detail") or ""
    for field in ("n=", "refuse=", "unans=", "idx=", "pre="):
        assert field in detail, f"the Monday line's `detail` lost {field!r}: {detail!r}"


def test_the_shadow_does_not_change_what_the_member_gets(signed, emitted):
    """⛔ THE ONE THING A SHADOW MUST NOT DO. With the master flag off the reply is the pre-V2
    path's, and it must be identical whether the shadow is on or off."""
    with_shadow = signed(_interaction("chart")).json()
    _drain()
    before = len(_shadow_records(emitted))

    import os
    os.environ["RENDER_V2_SHADOW"] = "0"
    try:
        without = signed(_interaction("chart")).json()
    finally:
        os.environ["RENDER_V2_SHADOW"] = "1"
    _drain()
    assert with_shadow == without, "the shadow changed the member's reply"
    # the control: the second call really did skip the shadow, so this is a comparison of two
    # different states and not of one state with itself
    assert len(_shadow_records(emitted)) == before, "the shadow ran with RENDER_V2_SHADOW=0"
