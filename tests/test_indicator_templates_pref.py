"""FT-070 / COV-11 — the server half of the `indicator_templates` preference.

A member's saved indicator templates (Chart Settings -> Indicators -> Indicator templates,
`app/src/components/chart/IndicatorTemplatesBar.jsx`) are one JSON list under one
preference key. Before the 2026-10-11 pre-arm review the key was `_PREF_OPAQUE`: any string
of any size was stored and then served back inside EVERY `GET /api/auth/preferences`, so a
member who saved many large templates (or any caller posting a crafted value) grew the blob
every page load reads, without a bound.

The bounds are the client's own, read from `builder/indicatorTemplates.js` rather than
retyped, so a save the client allows is never a 400 and a value the client cannot produce is
refused:

  * at most MAX_INDICATOR_TEMPLATES templates, MAX_TEMPLATE_INDICATORS indicators each;
  * a name of at most TEMPLATE_NAME_MAX characters;
  * the whole value at most MAX_INDICATOR_TEMPLATES_BYTES UTF-8 bytes (what the client
    measures with TextEncoder before it saves).

Unknown fields inside a template are carried, as `joystick_hub`'s are: a field a newer build
writes must not turn into a permanent 400 for an older one.
"""
import json
import os
import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import auth as auth_router
from tests.authclients import PAID_MEMBER, authorize

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATES_JS = os.path.join(REPO, "app", "src", "components", "chart", "builder", "indicatorTemplates.js")


def _js_const(name):
    with open(TEMPLATES_JS, encoding="utf-8") as fh:
        src = fh.read()
    m = re.search(r"export const " + name + r"\s*=\s*(\d+)\b", src)
    assert m, f"{name} not found in indicatorTemplates.js — the read is broken"
    return int(m.group(1))


@pytest.fixture(scope="module")
def client():
    from api.services import auth_db

    auth_db.init_db()
    app = FastAPI()
    app.include_router(auth_router.router)
    authorize(app, PAID_MEMBER)
    return TestClient(app)


def _post(client, value):
    return client.post("/api/auth/preferences", json={"key": "indicator_templates", "value": value})


def _tpl(i=0, n=1, name=None, **extra):
    return {
        "contract": "uct.indicators.template/1",
        "id": f"it{i:08d}",
        "name": name if name is not None else f"Template {i}",
        "savedAt": 1,
        "instances": [{"key": f"k{j + 1}", "defId": "rsi", "inputs": {"period": 7}, "label": "RSI (7)"} for j in range(n)],
        "alerts": [],
        **extra,
    }


def test_the_server_bounds_ARE_the_clients_bounds():
    """One number on each side, pinned equal — a client allowance the server refuses is a
    "Couldn't save" in a member's face for a template the UI said was fine."""
    assert auth_router._INDICATOR_TEMPLATES_MAX == _js_const("MAX_INDICATOR_TEMPLATES")
    assert auth_router._INDICATOR_TEMPLATE_INDICATORS_MAX == _js_const("MAX_TEMPLATE_INDICATORS")
    assert auth_router._INDICATOR_TEMPLATE_NAME_MAX == _js_const("TEMPLATE_NAME_MAX")
    assert auth_router._INDICATOR_TEMPLATES_MAX_BYTES == _js_const("MAX_INDICATOR_TEMPLATES_BYTES")
    assert auth_router._PREFERENCE_KEYS["indicator_templates"] == "indicator_templates"


def test_a_list_the_client_produces_is_accepted(client):
    full = [_tpl(i, n=3) for i in range(auth_router._INDICATOR_TEMPLATES_MAX)]
    assert _post(client, json.dumps(full)).status_code == 200
    assert _post(client, json.dumps([])).status_code == 200
    assert _post(client, "").status_code == 200          # the client's "cleared" write


def test_an_unknown_field_from_another_build_is_carried(client):
    assert _post(client, json.dumps([_tpl(1, futureField={"x": 1})])).status_code == 200


@pytest.mark.parametrize("value,why", [
    ("x", "not JSON"),
    (json.dumps({"id": "a"}), "not a list"),
    (json.dumps(["a"]), "an entry that is not an object"),
    (json.dumps([{**_tpl(1), "id": ""}]), "an empty id"),
    (json.dumps([{**_tpl(1), "name": ""}]), "an empty name"),
    (json.dumps([{**_tpl(1), "instances": {}}]), "instances not a list"),
    (json.dumps([{**_tpl(1), "instances": [{"key": "k1"}]}]), "an indicator with no defId"),
])
def test_a_malformed_value_is_refused(client, value, why):
    resp = _post(client, value)
    assert resp.status_code == 400, why
    assert "indicator_templates" in resp.json()["detail"]


def test_more_templates_than_the_client_allows_is_refused(client):
    over = [_tpl(i) for i in range(auth_router._INDICATOR_TEMPLATES_MAX + 1)]
    assert _post(client, json.dumps(over)).status_code == 400


def test_more_indicators_than_the_client_captures_is_refused(client):
    n = auth_router._INDICATOR_TEMPLATE_INDICATORS_MAX
    assert _post(client, json.dumps([_tpl(1, n=n)])).status_code == 200
    assert _post(client, json.dumps([_tpl(1, n=n + 1)])).status_code == 400


def test_a_name_longer_than_the_client_allows_is_refused(client):
    n = auth_router._INDICATOR_TEMPLATE_NAME_MAX
    assert _post(client, json.dumps([_tpl(1, name="é" * n)])).status_code == 200
    assert _post(client, json.dumps([_tpl(1, name="x" * (n + 1))])).status_code == 400


def test_the_byte_ceiling_is_measured_in_utf8_bytes(client):
    cap = auth_router._INDICATOR_TEMPLATES_MAX_BYTES
    # multi-byte characters: under the cap in characters, over it in bytes
    fat = [_tpl(1, note="é" * (cap // 2 + 10))]
    raw = json.dumps(fat, ensure_ascii=False)
    assert len(raw) < cap < len(raw.encode("utf-8"))
    resp = _post(client, raw)
    assert resp.status_code == 400
    assert "indicator_templates" in resp.json()["detail"]


def test_a_refused_write_stores_nothing(client):
    good = json.dumps([_tpl(7, name="Keep me")])
    assert _post(client, good).status_code == 200
    assert _post(client, "x").status_code == 400
    assert client.get("/api/auth/preferences").json().get("indicator_templates") == good
