"""api/routers/econ.py -- flag, entitlement (the REAL require_bars_access + meets_plan_gate;
only the session lookup is substituted), payload, ETag/304, param validation, and
the negative controls."""
from __future__ import annotations

import copy
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.bars_auth as BA
from api.routers import econ as ER
from api.services.econ import publish as P
from api.services.econ import registry as R
from api.services.econ import serving

from .test_publish import (ASOF_T1, LATEST, PAYLOAD_KEYS, T1, assert_first_availability_placement,
                           assert_no_internals, seed_store)

USERS = {
    "tok-free": {"id": 1, "role": "user", "plan": "free"},
    "tok-comped": {"id": 2, "role": "user", "plan": "comped"},
    "tok-pro": {"id": 3, "role": "user", "plan": "pro"},
    "tok-admin": {"id": 4, "role": "admin", "plan": "free"},
}


@pytest.fixture
def client(tmp_path, monkeypatch):
    db = seed_store(str(tmp_path / "econ.db"))
    monkeypatch.setenv("ECON_SERVING_SOURCE", "db")
    monkeypatch.setenv("ECON_DB_PATH", db)
    monkeypatch.setenv("ECON_ENABLED", "1")
    monkeypatch.delenv("PUSH_SECRET", raising=False)
    serving.clear_cache()
    # ⛔ identity only: the gate (require_bars_access -> meets_plan_gate) runs for real
    monkeypatch.setattr(BA, "validate_session",
                        lambda tok: ({k: v for k, v in USERS[tok].items() if k != "plan"} if tok in USERS else None))
    monkeypatch.setattr(BA, "get_user_plan", lambda uid: next(u["plan"] for u in USERS.values() if u["id"] == uid))
    app = FastAPI()
    app.include_router(ER.router)
    yield TestClient(app)
    serving.clear_cache()


def as_(client, tok):
    client.cookies.set("uct_session", tok)
    return client


PATHS = ["/api/econ/catalog", "/api/econ/series/USCPI", "/api/econ/status"]


@pytest.mark.parametrize("path", PATHS + ["/api/econ/series/USCPI?asof=nope"])
def test_flag_off_is_404_everywhere_even_for_admin(client, monkeypatch, path):
    monkeypatch.delenv("ECON_ENABLED", raising=False)
    assert client.get(path).status_code == 404
    assert as_(client, "tok-admin").get(path).status_code == 404
    monkeypatch.setenv("ECON_ENABLED", "0")
    assert client.get(path).status_code == 404


@pytest.mark.parametrize("path", PATHS[:2])
def test_unauthenticated_401(client, path):
    assert client.get(path).status_code == 401


@pytest.mark.parametrize("path", PATHS[:2])
def test_not_entitled_403(client, path):
    r = as_(client, "tok-free").get(path)
    assert r.status_code == 403 and r.json()["detail"] == BA.UPGRADE_DETAIL


@pytest.mark.parametrize("tok", ["tok-comped", "tok-pro", "tok-admin"])
def test_entitled_members_200(client, tok):
    c = as_(client, tok)
    assert c.get("/api/econ/catalog").status_code == 200
    assert c.get("/api/econ/series/USCPI").status_code == 200


def test_push_secret_service_bearer(client, monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "s3cret-value")
    r = client.get("/api/econ/series/USCPI", headers={"Authorization": "Bearer s3cret-value"})
    assert r.status_code == 200
    assert client.get("/api/econ/series/USCPI", headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_status_is_unauthenticated_and_values_free(client):
    r = client.get("/api/econ/status")
    assert r.status_code == 200 and r.headers["cache-control"].startswith("private")
    text = r.text
    for v in ("320.5", "321.0", "320.0", "159000"):
        assert v not in text
    assert {x["symbol"] for x in r.json()["series"]} == {e["symbol"] for e in R.load_registry() if P.servable(e)[0]}


def test_series_latest_payload(client):
    r = as_(client, "tok-comped").get("/api/econ/series/USCPI")
    body = r.json()
    assert set(body) == PAYLOAD_KEYS
    assert body["id"] == "ECON:USCPI" and body["view"] == "latest"
    assert body["meta"]["units"] == {"display": "index", "fmt": "num3", "scale": 1}
    assert body["meta"]["presentation"] == {"style": "line"} and body["meta"]["frequency"] == "M"
    assert_first_availability_placement(body["points"], LATEST)
    assert_no_internals(body)
    assert r.headers["cache-control"].startswith("private") and r.headers["etag"].startswith('"')


def test_series_accepts_canonical_id_and_asof(client):
    c = as_(client, "tok-pro")
    body = c.get(f"/api/econ/series/ECON:USCPI?asof={T1 + 1}").json()
    assert body["view"] == "asof" and body["asof"] == T1 + 1
    assert_first_availability_placement(body["points"], ASOF_T1)
    assert c.get("/api/econ/series/econ%3AUSCPI").status_code == 200


def test_derived_series(client):
    body = as_(client, "tok-pro").get("/api/econ/series/USCPIYOY").json()
    assert body["meta"]["derivation"]["op"] == "yoy_pct"
    assert body["meta"]["source"]["line"] == "UCT calculation from BLS data"
    assert [p[1] for p in body["points"]] == [2.9, 3.0]


@pytest.mark.parametrize("sym", ["USCPIFOOD", "USPPIFDNSA", "USUMCSENT", "USNOPE", "AAPL", "ECON:AAPL"])
def test_disabled_unverified_red_unknown_404(client, sym):
    r = as_(client, "tok-pro").get(f"/api/econ/series/{sym}")
    assert r.status_code == 404 and "points" not in r.json()


def test_negative_control_serving_a_disabled_series_fails_the_rail(client, monkeypatch):
    """⛔ If the servability rail is removed, the disabled series is served -- and the
    assertion `test_disabled_unverified_red_unknown_404` makes would FAIL."""
    monkeypatch.setattr(P, "servable", lambda e: (bool(e), "ok"))
    serving.clear_cache()
    r = as_(client, "tok-pro").get("/api/econ/series/USCPIFOOD")
    with pytest.raises(AssertionError):
        assert r.status_code == 404 and "points" not in r.json()


def test_negative_control_period_end_placement_fails_alignment(client, monkeypatch):
    real = P.points_from_store
    monkeypatch.setattr(P, "points_from_store",
                        lambda *a, **k: [[T1 + 99 * 86400 if p[2] == "2026-07-01" else p[0], *p[1:]] for p in real(*a, **k)])
    serving.clear_cache()
    body = as_(client, "tok-pro").get("/api/econ/series/USCPI").json()
    with pytest.raises(AssertionError):
        assert_first_availability_placement(body["points"], LATEST)


def test_red_enabled_by_hand_edit_is_still_refused(client, monkeypatch):
    real_get = R.get

    def get(s):
        e = real_get(s)
        if e and e["symbol"] == "USCPI":
            e = copy.deepcopy(e); e["licensing"]["class"] = "RED"
        return e

    monkeypatch.setattr(R, "get", get)
    serving.clear_cache()
    assert as_(client, "tok-pro").get("/api/econ/series/USCPI").status_code == 404


def test_etag_304(client):
    c = as_(client, "tok-pro")
    for path in ("/api/econ/series/USCPI", "/api/econ/catalog", "/api/econ/status"):
        r = c.get(path)
        tag = r.headers["etag"]
        again = c.get(path, headers={"If-None-Match": tag})
        assert again.status_code == 304 and again.headers["etag"] == tag and not again.content
        assert c.get(path, headers={"If-None-Match": '"other", ' + tag}).status_code == 304
        assert c.get(path, headers={"If-None-Match": '"stale"'}).status_code == 200


def test_etag_changes_with_content(client):
    c = as_(client, "tok-pro")
    a = c.get("/api/econ/series/USCPI").headers["etag"]
    b = c.get(f"/api/econ/series/USCPI?asof={T1 + 1}").headers["etag"]
    assert a != b


@pytest.mark.parametrize("q", ["asof=nope", "asof=-1", "asof=1.5", "start=2026-13-01", "start=20260101",
                               "end=2026-02-30", "start=2026-09-01&end=2026-01-01", "start=x"])
def test_bad_query_params_422(client, q):
    assert as_(client, "tok-pro").get(f"/api/econ/series/USCPI?{q}").status_code == 422


def test_catalog_shape(client):
    body = as_(client, "tok-pro").get("/api/econ/catalog").json()
    assert set(body) == {"series", "attributions"}
    row = next(r for r in body["series"] if r["symbol"] == "USCPI")
    assert row["id"] == "ECON:USCPI" and row["source"]["provider_series_id"] == "CUSR0000SA0"
    assert row["source"]["attribution_key"] == "bls" and "bls" in body["attributions"]
    assert_no_internals(body)
    assert json.dumps(body).count('"symbol"') == 42


def test_asof_payload_carries_no_currentness_claim(client):
    c = as_(client, "tok-pro")
    body = c.get(f"/api/econ/series/USCPI?asof={T1 + 1}").json()
    assert body["view"] == "asof" and body["currentness"] == {"state": None, "historical": True}
    live = c.get("/api/econ/series/USCPI").json()["currentness"]          # negative control
    assert live.get("historical") is None and isinstance(live["state"], str)
