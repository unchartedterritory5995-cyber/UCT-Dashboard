"""api/routers/marketcap_pit.py over the REAL reader (pit_serving) and published artifacts: flag, entitlement (the
real require_bars_access + meets_plan_gate; only the session lookup is substituted), no existence leak, contract,
cache identity across a pointer advance, fail-safe on unverifiable authority, pin override, read-only."""
from __future__ import annotations

import json
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.bars_auth as BA
from api.routers import marketcap_pit as MR
from api.services.marketcap import publication as P, pit_serving as S, release_contract as C

from .lifecycle_fixtures import make_build, make_prices, manifest_fields, passing_validation

B1, B2 = "MCAP_V1-20261002T050000Z", "MCAP_V1-20261003T050000Z"
USERS = {"tok-free": {"id": 1, "role": "user", "plan": "free"}, "tok-comped": {"id": 2, "role": "user", "plan": "comped"},
         "tok-pro": {"id": 3, "role": "user", "plan": "pro"}, "tok-admin": {"id": 4, "role": "admin", "plan": "free"}}


@pytest.fixture
def world(tmp_path, monkeypatch):
    root = str(tmp_path / "bucket")
    t = P.LocalTarget(root)
    prices = make_prices(str(tmp_path / "prices.db"))
    pub = {}
    for bid, last, bump in ((B1, 20260930, 1.0), (B2, 20261001, 1.5)):
        db = make_build(str(tmp_path / f"{bid}.db"), bid, last_day=last, bump=bump)
        latest = f"{str(last)[:4]}-{str(last)[4:6]}-{str(last)[6:]}"
        pub[bid] = P.publish_build(t, build_db=db, prices_db=prices,
                                   manifest_fields=manifest_fields(bid, P.file_sha(db)[0], latest=latest,
                                                                   cutoff=f"{latest}T23:00:00Z"),
                                   validation=passing_validation())["manifest_sha256"]
    P.advance(t, B1, pub[B1], expect_current=None, by="owner", reason="test cutover", acceptance="HUMAN_CUTOVER")
    monkeypatch.setenv("MCAP_PIT_SOURCE", "local")
    monkeypatch.setenv("MCAP_PIT_LOCAL_ROOT", root)
    monkeypatch.setenv("MCAP_PIT_ENABLED", "1")
    monkeypatch.delenv("MCAP_PIT_PIN", raising=False)
    monkeypatch.delenv("PUSH_SECRET", raising=False)
    monkeypatch.setattr(S, "CONTROL_TTL", 0.0)
    S.clear_cache()
    monkeypatch.setattr(BA, "validate_session",
                        lambda tok: ({k: v for k, v in USERS[tok].items() if k != "plan"} if tok in USERS else None))
    monkeypatch.setattr(BA, "get_user_plan", lambda uid: next(u["plan"] for u in USERS.values() if u["id"] == uid))
    app = FastAPI()
    app.include_router(MR.router)
    yield {"c": TestClient(app), "t": t, "pub": pub, "root": root}
    S.clear_cache()


def as_(c, tok):
    c.cookies.set("uct_session", tok)
    return c


PATHS = ["/api/marketcap/pit/GOOGL", "/api/marketcap/pit/GOOGL/latest", "/api/marketcap/pit-status"]


@pytest.mark.parametrize("path", PATHS + ["/api/marketcap/pit/!!bad", "/api/marketcap/pit/NOPE?start=junk"])
def test_flag_off_is_404_everywhere_even_for_admin(world, monkeypatch, path):
    monkeypatch.setenv("MCAP_PIT_ENABLED", "0")
    assert world["c"].get(path).status_code == 404
    assert as_(world["c"], "tok-admin").get(path).status_code == 404


@pytest.mark.parametrize("path", PATHS)
def test_unauthenticated_401(world, path):
    assert world["c"].get(path).status_code == 401


@pytest.mark.parametrize("path", PATHS)
def test_not_entitled_403(world, path):
    r = as_(world["c"], "tok-free").get(path)
    assert r.status_code == 403 and r.json()["detail"] == BA.UPGRADE_DETAIL


def test_no_existence_leak_for_unauthorized_callers(world):
    c = world["c"]
    for tok in (None, "tok-free"):
        if tok:
            as_(c, tok)
        known, unknown, bad = (c.get("/api/marketcap/pit/GOOGL"), c.get("/api/marketcap/pit/ZZZZ"),
                               c.get("/api/marketcap/pit/!!bad?start=nope"))
        assert known.status_code == unknown.status_code == bad.status_code in (401, 403)
        assert known.json() == unknown.json() == bad.json()
        assert "x-mcap-build" not in {k.lower() for k in known.headers}


@pytest.mark.parametrize("tok", ["tok-comped", "tok-pro", "tok-admin"])
def test_entitled_members_200(world, tok):
    c = as_(world["c"], tok)
    assert c.get("/api/marketcap/pit/GOOGL").status_code == 200
    assert c.get("/api/marketcap/pit/GOOGL/latest").status_code == 200


def test_push_secret_service_bearer(world, monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "s3cret-value")
    c = world["c"]
    assert c.get("/api/marketcap/pit/GOOGL", headers={"Authorization": "Bearer s3cret-value"}).status_code == 200
    assert c.get("/api/marketcap/pit/GOOGL", headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_contract_series_and_latest(world):
    c = as_(world["c"], "tok-pro")
    r = c.get("/api/marketcap/pit/googl")
    j = r.json()
    assert {"ticker", "issuer_id", "listing", "company_level", "build_id", "points", "gaps", "structure",
            "authority", "currentness"} <= set(j)
    assert j["build_id"] == B1 and r.headers["x-mcap-build"] == B1 and j["company_level"] is True
    assert j["points"][-1][0] == "2026-09-30" and all(v > 0 for _d, v in j["points"])
    assert r.headers["cache-control"].startswith("private")
    arm = c.get("/api/marketcap/pit/ARM").json()
    assert arm["gaps"] and arm["gaps"][0]["reason"] == "TICKER_REUSE_DIFFERENT_ISSUER"
    lt = c.get("/api/marketcap/pit/GOOGL/latest").json()
    assert lt["date"] == "2026-09-30" and lt["company_market_cap"] > lt["security_market_cap"] > 0
    w = c.get("/api/marketcap/pit/GOOGL?start=2026-09-29&end=2026-09-29").json()
    assert [p[0] for p in w["points"]] == ["2026-09-29"]
    assert c.get("/api/marketcap/pit/ZZZZ").status_code == 404
    assert c.get("/api/marketcap/pit/GOOGL?start=2026-02-30").status_code == 422
    assert c.get("/api/marketcap/pit/GOOGL?start=2026-10-02&end=2026-10-01").status_code == 422


def test_cache_identity_advance_A_to_B_never_serves_A(world, monkeypatch):
    c = as_(world["c"], "tok-pro")
    monkeypatch.setattr(S, "CONTROL_TTL", 3600.0)                         # even with a long control TTL ...
    r1 = c.get("/api/marketcap/pit/GOOGL")
    e1 = r1.headers["etag"]
    assert c.get("/api/marketcap/pit/GOOGL", headers={"If-None-Match": e1}).status_code == 304
    P.advance(world["t"], B2, world["pub"][B2], expect_current=B1, by="refresh", reason="daily", acceptance="AUTOMATED_REFRESH")
    S.bound(force=True)                                                   # ... the next control read binds B (<= TTL)
    r2 = c.get("/api/marketcap/pit/GOOGL", headers={"If-None-Match": e1})
    assert r2.status_code == 200 and r2.json()["build_id"] == B2 and r2.headers["etag"] != e1
    assert r2.json()["points"][-1][0] == "2026-10-01"
    assert r2.json()["points"][0][1] != r1.json()["points"][0][1]        # B's values, not A's
    lt = c.get("/api/marketcap/pit/GOOGL/latest").json()
    assert lt["build_id"] == B2 and lt["date"] == "2026-10-01"


def test_rollback_B_to_A_is_served(world):
    c = as_(world["c"], "tok-pro")
    P.advance(world["t"], B2, world["pub"][B2], expect_current=B1, by="r", reason="d", acceptance="AUTOMATED_REFRESH")
    assert c.get("/api/marketcap/pit/GOOGL").json()["build_id"] == B2
    P.rollback(world["t"], B1, world["pub"][B1], expect_current=B2, by="owner", reason="drill")
    j = c.get("/api/marketcap/pit/GOOGL").json()
    assert j["build_id"] == B1 and j["authority"]["acceptance"] == "ROLLBACK"


def _write_pointer(root, p):
    path = os.path.join(root, *C.AUTHORITY_KEY.split("/"))
    with open(path, "w") as f:
        json.dump(p, f)


def test_unverifiable_pointer_keeps_last_verified_authority(world):
    c = as_(world["c"], "tok-pro")
    assert c.get("/api/marketcap/pit/GOOGL").json()["build_id"] == B1
    p = P.read_pointer(world["t"])
    _write_pointer(world["root"], {**p, "build_id": B2, "manifest_key": C.manifest_key(B2), "manifest_sha256": "0" * 64})
    r = c.get("/api/marketcap/pit/GOOGL")
    assert r.status_code == 200 and r.json()["build_id"] == B1          # B2 never bound with a wrong sha
    st = c.get("/api/marketcap/pit-status").json()
    assert st["authority"]["build_id"] == B1 and "does not hash" in st["reader_error"]


def test_never_verified_authority_is_503_not_data(world):
    S.clear_cache()
    p = P.read_pointer(world["t"])
    _write_pointer(world["root"], {**p, "manifest_sha256": "0" * 64})
    c = as_(world["c"], "tok-pro")
    for path in PATHS:
        r = c.get(path)
        assert r.status_code == 503 and "points" not in r.json()


def test_altered_document_is_503_for_that_ticker(world):
    c = as_(world["c"], "tok-pro")
    m = P.read_manifest(world["t"], B1, world["pub"][B1])
    path = os.path.join(world["root"], *C.obj_key(m["artifacts"]["documents"]["AAA"]).split("/"))
    with open(path, "wb") as f:
        f.write(b"x")
    assert c.get("/api/marketcap/pit/AAA").status_code == 503
    assert c.get("/api/marketcap/pit/GOOGL").status_code == 200


def test_pin_overrides_pointer_but_must_verify(world, monkeypatch):
    c = as_(world["c"], "tok-pro")
    monkeypatch.setenv("MCAP_PIT_PIN", f"{B2}:{world['pub'][B2]}")
    S.clear_cache()
    j = c.get("/api/marketcap/pit/GOOGL").json()
    assert j["build_id"] == B2 and j["authority"]["pinned"] is True
    monkeypatch.setenv("MCAP_PIT_PIN", f"{B2}:{'0' * 64}")
    S.clear_cache()
    assert c.get("/api/marketcap/pit/GOOGL").status_code == 503


def test_status_observability(world):
    c = as_(world["c"], "tok-admin")
    st = c.get("/api/marketcap/pit-status").json()
    assert st["authority"]["build_id"] == B1 and st["documents"] == 4
    assert st["knowledge"]["latest_valued_session"] == "2026-09-30"
    assert st["currentness"]["state"] in ("CURRENT", "DEGRADED_UPSTREAM_LATE", "STALE", "BUILD_FAILED")
    assert len(st["served_db_sha256"]) == 64
    assert "points" not in json.dumps(st)


def test_reader_is_read_only(world):
    before = {os.path.join(d, f): os.stat(os.path.join(d, f)).st_mtime_ns for d, _s, fs in os.walk(world["root"]) for f in fs}
    c = as_(world["c"], "tok-pro")
    for path in PATHS + ["/api/marketcap/pit/ARM", "/api/marketcap/pit/ZZZZ"]:
        c.get(path)
    after = {os.path.join(d, f): os.stat(os.path.join(d, f)).st_mtime_ns for d, _s, fs in os.walk(world["root"]) for f in fs}
    assert before == after


def test_router_is_isolated_from_build_machinery():
    import ast
    import inspect
    src = inspect.getsource(MR) + inspect.getsource(S)
    mods = {n.module for n in ast.walk(ast.parse(src)) if isinstance(n, ast.ImportFrom) and n.module}
    assert not any(m and ("build" in m or "serve" == m.split(".")[-1] or "sqlite" in m) for m in mods)
    assert "sqlite3" not in src
