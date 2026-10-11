"""The UCT Agent's SERVER gate as a filter, for the scripted chain harness (tools/agent_live_chain.py).

Reads {"envelope": ..., "body": ...} as JSON on stdin and prints what the server would hand the
browser: turn.sanitize_envelope's output, or {"refused": "<member sentence>"} where the endpoint
answers HTTP 400. The same function run_turn applies to a real model's envelope — no model call.

Its own process so the harness never imports api.* (the census pin below redirects every
*_DB_PATH to a sandbox, which must not reach the harness's live-mode backend environment).
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import conftest  # noqa: E402,F401 -- the census and the tripwire, before any api.* import (every *_DB_PATH → a sandbox)
from api.services.uct_agent import turn  # noqa: E402


def gate(envelope: dict, body: dict) -> dict:
    caps = {c["name"] for c in turn.validate_manifest(body.get("capabilities") or [])}
    try:
        return turn.sanitize_envelope(envelope, turn._context_refs(body.get("context") or {}), caps or None)
    except turn.TurnError as e:
        return {"refused": str(e)}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    req = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    print(json.dumps(gate(req["envelope"], req["body"])))
