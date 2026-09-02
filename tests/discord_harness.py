"""Signed-request harness for the Discord interactions endpoint.

Lifted verbatim out of test_discord_chart.py 2026-09-02 so the /buzz tests can
drive the REAL route -- signature verification, guild gate, dispatch and all --
instead of calling the handler's internals or keeping a second copy of the
transport. Same names, so the chart file's ~74 call sites are unchanged by the
move.

⛔ Test through the ROUTE, not around it. The behaviours these support (a reply's
ephemeral flag, a throttle) are decided IN the route; a test that calls the
inner builder proves the payload's shape and nothing about what Discord is
actually handed.
"""
from __future__ import annotations

import json

UT_GUILD = "882293203485720596"  # Uncharted Territory, one of the two allowed servers


def _keypair():
    from nacl.signing import SigningKey
    sk = SigningKey.generate()
    return sk, sk.verify_key.encode().hex()


def _sign(sk, ts: str, body: bytes) -> str:
    return sk.sign(ts.encode() + body).signature.hex()


def _app_client():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import discord_interactions as rt
    app = FastAPI()
    app.include_router(rt.router)
    return TestClient(app), rt


def _post(client, sk, payload: dict, *, ts="1700000000", sign=True, bad_sig=False):
    body = json.dumps(payload).encode()
    headers = {"content-type": "application/json"}
    if sign:
        headers["X-Signature-Ed25519"] = ("00" * 64) if bad_sig else _sign(sk, ts, body)
        headers["X-Signature-Timestamp"] = ts
    return client.post("/api/discord/interactions", content=body, headers=headers)
