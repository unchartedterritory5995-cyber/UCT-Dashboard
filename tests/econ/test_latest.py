"""GET /api/econ/latest -- the newest few points of many series in one read (the Terminal's
ECON board). The same flag (404 dark, before the gate) and the same gate (the REAL
require_bars_access: 401 signed out, 403 not entitled) as the other econ routes; only the
session lookup is substituted. Every value below is invented (the shared seed from
test_publish plus five invented weeks of claims)."""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.bars_auth as BA
from api.routers import econ as ER
from api.services.econ import publish as P
from api.services.econ import serving
from api.services.econ import store as S

from .test_publish import NOW, T1, T2, _row, assert_no_internals, seed_store
from .test_router import USERS, as_

DAY = 86400
# five invented weekly prints, the last one first seen at W5
W = [T2 - 28 * DAY, T2 - 21 * DAY, T2 - 14 * DAY, T2 - 7 * DAY, T2]
CLAIMS = [("2026-08-02", "2026-08-08", 211000.0, W[0]), ("2026-08-09", "2026-08-15", 207000.0, W[1]),
          ("2026-08-16", "2026-08-22", 219000.0, W[2]), ("2026-08-23", "2026-08-29", None, W[3]),
          ("2026-08-30", "2026-09-05", 203000.0, W[4])]


def seed_latest(path: str) -> str:
    seed_store(path)
    s = S.connect(path)
    try:
        for i, (ps, pe, v, t) in enumerate(CLAIMS):
            rid = s.upsert_release(f"dol:claims:w{i}", "dol:claims", "live", t)
            s.write_observations("USICSA", rid, [_row(ps, pe, v, t)])
        s.put_state("USICSA", state="CURRENT", latest_period="2026-08-30", expected_period="2026-08-30",
                    last_success_at=W[4] + 120, latest_available_at=W[4])
    finally:
        s.close()
    return path


@pytest.fixture
def client(tmp_path, monkeypatch):
    db = seed_latest(str(tmp_path / "econ.db"))
    monkeypatch.setattr(P, "time", SimpleNamespace(time=lambda: NOW))
    monkeypatch.setenv("ECON_SERVING_SOURCE", "db")
    monkeypatch.setenv("ECON_DB_PATH", db)
    monkeypatch.setenv("ECON_ENABLED", "1")
    monkeypatch.delenv("PUSH_SECRET", raising=False)
    serving.clear_cache()
    monkeypatch.setattr(BA, "validate_session",
                        lambda tok: ({k: v for k, v in USERS[tok].items() if k != "plan"} if tok in USERS else None))
    monkeypatch.setattr(BA, "get_user_plan", lambda uid: next(u["plan"] for u in USERS.values() if u["id"] == uid))
    app = FastAPI()
    app.include_router(ER.router)
    yield TestClient(app)
    serving.clear_cache()


URL = "/api/econ/latest?symbols=USCPI,USCPIYOY,USICSA,USNFP,USUNRATE,USNOPE,USRETAILXA"


def row(body, sym):
    return next(r for r in body["series"] if r["symbol"] == sym)


# ── the flag and the gate, exactly as the other econ routes ─────────────────────────────

def test_flag_off_is_404_even_for_admin(client, monkeypatch):
    monkeypatch.delenv("ECON_ENABLED", raising=False)
    assert client.get(URL).status_code == 404
    assert as_(client, "tok-admin").get(URL).status_code == 404
    monkeypatch.setenv("ECON_ENABLED", "0")
    assert as_(client, "tok-pro").get(URL).status_code == 404
    # dark answers before parameter validation: a bad query does not reveal the route's shape
    assert as_(client, "tok-pro").get("/api/econ/latest?symbols=US%20CPI").status_code == 404


def test_signed_out_401_and_free_plan_403(client):
    assert client.get(URL).status_code == 401
    r = as_(client, "tok-free").get(URL)
    assert r.status_code == 403 and r.json()["detail"] == BA.UPGRADE_DETAIL


@pytest.mark.parametrize("tok", ["tok-comped", "tok-pro", "tok-admin"])
def test_entitled_members_200(client, tok):
    assert as_(client, tok).get(URL).status_code == 200


# ── the answer ───────────────────────────────────────────────────────────────────────────

def test_rows_in_the_order_asked_with_their_own_state(client):
    r = as_(client, "tok-pro").get(URL)
    body = r.json()
    assert set(body) == {"columns", "points_per_series", "series", "attributions"}
    assert body["columns"] == ["t", "v", "ps", "pe", "pit"] and body["points_per_series"] == 3
    assert [x["symbol"] for x in body["series"]] == ["USCPI", "USCPIYOY", "USICSA", "USNFP", "USUNRATE",
                                                    "USNOPE", "USRETAILXA"]
    assert [x["state"] for x in body["series"]] == ["ok", "ok", "ok", "ok", "no_data", "not_found", "not_found"]
    assert r.headers["cache-control"].startswith("private") and r.headers["etag"].startswith('"')
    assert_no_internals(body)


def test_the_newest_three_points_only_with_a_missing_value_kept_as_null(client):
    body = as_(client, "tok-pro").get(URL).json()
    claims = row(body, "USICSA")["points"]
    assert [p[2] for p in claims] == ["2026-08-16", "2026-08-23", "2026-08-30"]
    assert [p[1] for p in claims] == [219000.0, None, 203000.0]          # never 0, never dropped
    assert [p[0] for p in claims] == W[2:]
    nfp = row(body, "USNFP")["points"]
    assert [p[1] for p in nfp] == [159000.0, None]


def test_revised_value_at_first_availability(client):
    cpi = row(as_(client, "tok-pro").get(URL).json(), "USCPI")["points"]
    assert [(p[0], p[1], p[2]) for p in cpi] == [(T1, 320.5, "2026-07-01"), (T2, 321.0, "2026-08-01")]


def test_meta_units_derivation_and_credit_keys(client):
    body = as_(client, "tok-pro").get(URL).json()
    yoy = row(body, "USCPIYOY")["meta"]
    assert yoy["units"] == {"display": "%", "fmt": "pct1", "scale": 1}
    assert yoy["derivation"]["op"] == "yoy_pct" and yoy["source"]["line"] == "UCT calculation from BLS data"
    assert row(body, "USICSA")["meta"]["units"]["fmt"] == "num0"
    assert set(body["attributions"]) == {"bls", "dol"}
    assert body["attributions"]["bls"]["access_date_required"] is True
    assert "{access_date}" in body["attributions"]["bls"]["text"]
    assert "terms_quote" not in str(body["attributions"])


def test_currentness_next_release_and_retrieved_at(client):
    body = as_(client, "tok-pro").get(URL).json()
    cpi = row(body, "USCPI")
    assert cpi["currentness"] == {"state": "CURRENT", "latest_period": "2026-08-01", "expected_period": "2026-08-01",
                                  "next_release": {"date": "2026-10-15", "time": "08:30", "tz": "America/New_York",
                                                   "precision": "exact"}}
    assert cpi["retrieved_at"] == T2 + 60
    assert row(body, "USICSA")["retrieved_at"] == W[4] + 120
    assert row(body, "USCPIYOY")["retrieved_at"] is None                 # no state row: no date invented
    none = row(body, "USUNRATE")
    assert none["points"] == [] and none["currentness"]["state"] == "UNINITIALIZED"
    assert "meta" not in row(body, "USNOPE") and "points" not in row(body, "USRETAILXA")


def test_duplicates_answer_once_and_the_canonical_id_is_accepted(client):
    body = as_(client, "tok-pro").get("/api/econ/latest?symbols=USCPI,econ:USCPI,uscpi,ECON:USCPI").json()
    assert [x["symbol"] for x in body["series"]] == ["USCPI"]


def test_the_cap_and_bad_symbols_are_422(client):
    c = as_(client, "tok-pro")
    forty = ",".join(f"USZZ{i}" for i in range(40))
    r = c.get(f"/api/econ/latest?symbols={forty}")
    assert r.status_code == 200 and len(r.json()["series"]) == 40
    assert all(x["state"] == "not_found" for x in r.json()["series"])
    assert c.get(f"/api/econ/latest?symbols={forty},USZZ40").status_code == 422
    for q in ("symbols=", "symbols=,,", "symbols=US%20CPI", "symbols=USCPI;X", "symbols=" + "A" * 33,
              "symbols=FOO:USCPI", ""):
        assert c.get(f"/api/econ/latest?{q}").status_code == 422, q


def test_etag_304(client):
    c = as_(client, "tok-pro")
    tag = c.get(URL).headers["etag"]
    again = c.get(URL, headers={"If-None-Match": tag})
    assert again.status_code == 304 and not again.content
    assert c.get(URL, headers={"If-None-Match": '"stale"'}).status_code == 200


def test_no_provider_call_and_no_publish_on_the_request(client, monkeypatch):
    from api.services import data_sync
    from api.services.econ import http as H

    def boom(*a, **k):
        raise AssertionError("a provider or publisher was reached from the member route")

    monkeypatch.setattr(H.HttpClient, "__init__", boom)
    monkeypatch.setattr(data_sync, "put_bytes", boom)
    monkeypatch.setattr(P, "_publish_doc", boom)
    assert as_(client, "tok-pro").get(URL).status_code == 200


def test_a_second_read_in_the_cache_lifetime_opens_no_database(client, monkeypatch):
    opened = []
    real = serving._open_db
    monkeypatch.setattr(serving, "_open_db", lambda: opened.append(1) or real())
    c = as_(client, "tok-pro")
    assert c.get(URL).status_code == 200
    first = len(opened)
    assert c.get(URL).status_code == 200
    assert first > 0 and len(opened) == first


def test_negative_control_the_servability_rail_is_what_refuses_a_disabled_series(client, monkeypatch):
    monkeypatch.setattr(P, "servable", lambda e: (bool(e), "ok"))
    serving.clear_cache()
    body = as_(client, "tok-pro").get(URL).json()
    with pytest.raises(AssertionError):
        assert row(body, "USRETAILXA")["state"] == "not_found"


# ── every serving mode gives the same rows; a second read in the cache lifetime reads nothing ─

@pytest.fixture(params=["db", "local", "r2"])
def mode(request, tmp_path, monkeypatch):
    from api.services import data_sync
    db = seed_latest(str(tmp_path / "econ.db"))
    serving.clear_cache()
    P.clear_memo()
    monkeypatch.setattr(P, "time", SimpleNamespace(time=lambda: NOW))
    monkeypatch.setenv("ECON_SERVING_SOURCE", request.param)
    monkeypatch.setenv("ECON_DB_PATH", db)
    reads = []
    if request.param in ("local", "r2"):
        objs = {}
        monkeypatch.setattr(data_sync, "put_bytes", lambda k, b, ct: objs.__setitem__(k, b) or True)
        monkeypatch.setattr(data_sync, "get_bytes", lambda k: reads.append(k) or objs.get(k))
        root = str(tmp_path / "art")
        monkeypatch.setenv("ECON_ARTIFACT_DIR", root)
        s = S.connect(db)
        try:
            P.publish_all(s, local_root=root if request.param == "local" else "", r2=(request.param == "r2"), now=NOW)
        finally:
            s.close()
        monkeypatch.setenv("ECON_DB_PATH", str(tmp_path / "absent.db"))      # the DB is not read
    yield SimpleNamespace(name=request.param, reads=reads)
    serving.clear_cache()


SYMS = ["USCPI", "USCPIYOY", "USICSA", "USNFP", "USUNRATE", "USNOPE"]


def test_every_mode_answers_the_same_rows(mode):
    st, body, tag = serving.latest(SYMS)
    assert st == 200 and tag.startswith('"')
    got = {r["symbol"]: (r["state"], [p[1] for p in r.get("points", [])]) for r in body["series"]}
    assert got == {"USCPI": ("ok", [320.5, 321.0]), "USCPIYOY": ("ok", [2.9, 3.0]),
                   "USICSA": ("ok", [219000.0, None, 203000.0]), "USNFP": ("ok", [159000.0, None]),
                   "USUNRATE": ("no_data", []), "USNOPE": ("not_found", [])}
    assert row(body, "USCPI")["currentness"]["next_release"]["date"] == "2026-10-15"
    assert row(body, "USCPI")["retrieved_at"] == T2 + 60


def test_a_second_read_in_the_cache_lifetime_reads_no_artifact(mode):
    serving.latest(SYMS)
    first = len(mode.reads)
    serving.latest(SYMS)
    serving.latest(list(reversed(SYMS)))
    assert len(mode.reads) == first
    if mode.name == "r2":
        assert first > 0                                                     # the control: r2 reads are counted
