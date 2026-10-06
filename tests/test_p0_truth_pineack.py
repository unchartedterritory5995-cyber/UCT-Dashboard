"""P0 TRUTH CORPUS — gate slice "pineack" (owner decision D).

The server is the save authority (`user_definitions._admit_new_maths`, slice
"save"). Before this gate the Pine member-pane door (`MemberPane` "Add this
script to my chart" -> `BuilderSheet.attachPine` -> `saveUserDefinition`) had no
acknowledgement control, so a `preview-repaints` import could never attach.

These cases POST the documents the member-pane door REALLY builds
(`memberPaneDefinition`, frozen in `tests/fixtures/p0_pineack/member_pane_docs.json`
and held equal to today's build by `p0.pineack.truth.test.js`) to the real route.
The door's own behaviour (button disabled until ticked, the body it sends) is
`app/src/components/chart/builder/memberPaneRepaintAck.test.jsx`.

Every case states ASKED / CLAIMED / DID and classifies the outcome.
"""
from __future__ import annotations

import copy
import json
import pathlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import user_definitions as router_mod
from api.services import alert_rev_migration as rev
from api.services import indicator_alert_service as ias
from api.services import user_definitions as svc

USER = "u1"
DOCS = json.loads((pathlib.Path(__file__).parent / "fixtures" / "p0_pineack"
                   / "member_pane_docs.json").read_text(encoding="utf-8"))


def pine_doc(kind: str) -> dict:
    d = copy.deepcopy(DOCS[kind]["definition"])
    d.pop("id", None)
    return d


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    rev.init_schema()
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": USER, "role": "user", "plan": "premium"}
    return TestClient(app)


def _stored(client) -> list:
    return client.get("/api/user-definitions").json()["definitions"]


def test_fixture_modes_are_what_the_cases_assume():
    assert DOCS["clean"]["definition"]["meta"]["repaint"] == "non-repainting"
    assert DOCS["preview"]["definition"]["meta"]["repaint"] == "preview-repaints"
    assert DOCS["repaints"]["definition"]["meta"]["repaint"] == "repaints"


def test_K1_VALUE_non_repainting_pine_saves_normally(client):
    """ASKED: attach `plot(ta.sma(close, 5))` from the member pane.
    CLAIMED: saved, no acknowledgement needed.
    DID BEFORE (this gate): 200. DID AFTER: 200. EXPECTED: VALUE."""
    r = client.post("/api/user-definitions", json={"definition": pine_doc("clean")})
    assert r.status_code == 200, r.text
    assert len(_stored(client)) == 1


def test_K2_REFUSAL_preview_repainting_pine_without_ack_direct_api(client):
    """ASKED: attach a weekly lookahead-ON `request.security` (measured
    `preview-repaints`) with no acknowledgement — a direct API call, bypassing
    the disabled button.
    CLAIMED: refused until the author acknowledges the badge.
    DID BEFORE (this gate): 422 `repaint-ack` — and the door had no way to send
    the ack, so the script could never attach. DID AFTER: still 422 for a request
    without the ack (the UI now offers the tick). EXPECTED: REFUSAL."""
    r = client.post("/api/user-definitions", json={"definition": pine_doc("preview")})
    assert r.status_code == 422, r.text
    assert r.json()["refusal"]["gate"] == "repaint-ack"
    assert _stored(client) == []


@pytest.mark.parametrize("ack", [True, {"value": True}])
def test_K3_VALUE_preview_repainting_pine_with_ack_saves(client, ack):
    """ASKED: the same script, with "I understand this indicator may repaint"
    ticked (the door sends `repaint_acknowledged: true`).
    CLAIMED: saved with badge `preview-repaints`; the ack is never stored.
    DID BEFORE (this gate): unreachable from the door. DID AFTER: 200.
    EXPECTED: VALUE."""
    r = client.post("/api/user-definitions",
                    json={"definition": pine_doc("preview"), "repaint_acknowledged": ack})
    assert r.status_code == 200, r.text
    rows = _stored(client)
    assert len(rows) == 1
    assert "repaintAck" not in (rows[0]["definition"].get("meta") or {})
    assert "repaint_acknowledged" not in json.dumps(rows[0])


@pytest.mark.parametrize("ack", [True, {"value": True}])
def test_K4_REFUSAL_hard_repaints_pine_refused_even_if_acknowledged(client, ack):
    """ASKED: attach `plot(bar_index == last_bar_index ? close : na)` (measured
    `repaints`) WITH an acknowledgement in the request.
    CLAIMED: a formula whose past values change is never saved; no tick unlocks it.
    DID BEFORE/AFTER: 422 `repaint`. EXPECTED: REFUSAL."""
    r = client.post("/api/user-definitions",
                    json={"definition": pine_doc("repaints"), "repaint_acknowledged": ack})
    assert r.status_code == 422, r.text
    assert r.json()["refusal"]["gate"] == "repaint"
    assert "repaints" in r.json()["detail"]
    assert _stored(client) == []
