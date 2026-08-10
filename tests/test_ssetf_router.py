# tests/test_ssetf_router.py
import threading

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from api.middleware.auth_middleware import (
    get_current_user, get_current_user_with_plan, require_admin,
)
from api.routers import single_stock_etfs as router_mod
from api.services import single_stock_etfs as ss

@pytest.fixture()
def client(tmp_path, monkeypatch):
    # ⛔ NO DETACHED REBUILD THREADS. `single_stock_etfs.py:235` calls
    # `_maybe_self_heal()` on any stale read — and a freshly-created scratch DB is
    # always stale — which spawns a daemon `ssetf-heal` thread (`:265`) running a
    # REAL rebuild. Nothing joined it, so it outlived its test and crossed the
    # NEXT test's `importlib.reload(ss)` below. Two things then break:
    #
    #   * the reload rebinds `_REBUILD_LOCK` to a NEW lock while the thread holds
    #     the old one, so its `finally: _REBUILD_LOCK.release()` (`:316`) raises
    #     `RuntimeError: release unlocked lock` — measured on 10 runs out of 10,
    #     with this file running ALONE;
    #   * worse, the thread `sqlite3.connect`s the next test's scratch path, which
    #     CREATES the file. `_ensure_init` short-circuits on
    #     `if _INIT_DONE and os.path.exists(_db_path())` (`:129`), so the schema is
    #     never written and the next test dies on
    #     `sqlite3.OperationalError: no such table: etfs`.
    #
    # That second outcome is timing-dependent, which is why it surfaced only in
    # big chunks (run A chunk 10 and run B2 chunk 03) and never in this file alone.
    # Stubbing the spawn keeps every assertion in this file intact — nothing here
    # tests self-heal — and removes the only unjoined thread.
    monkeypatch.setattr(ss, "_spawn_rebuild", lambda trigger: None)
    monkeypatch.setenv("SSETF_DB_PATH", str(tmp_path / "ssetf.db"))
    import importlib; importlib.reload(ss)
    # The reload re-executes the module, so the stub above (installed on the
    # pre-reload module dict) is gone. Reinstall it on the live module.
    monkeypatch.setattr(ss, "_spawn_rebuild", lambda trigger: None)
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1", "role": "user"}
    app.dependency_overrides[require_admin] = lambda: {"id": "a1", "role": "admin"}
    # 🔴 `/{symbol}` became PAID on 2026-08-09 (see the router docstring): its
    # dependency moved from `get_current_user` to `require_paid` ->
    # `get_current_user_with_plan`. This fixture kept overriding only the OLD
    # one, so the real plan lookup ran and died on `no such table:
    # subscriptions` in the sandbox auth DB. The two lookup tests have been red
    # ever since — a product change quietly turning a rail red is exactly the
    # noise that trains people to skip a red suite.
    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": "u1", "role": "user", "plan": "pro", "subscription_status": "active"}
    return TestClient(app)

def test_a_FREE_user_is_refused_the_family_map(tmp_path, monkeypatch):
    """⛔ THE PAYWALL ITSELF, PROVEN RATHER THAN ASSUMED.

    `/{symbol}` was moved behind `require_paid` on 2026-08-09 because signup is
    open and free and this is curated reference data the firm BUILDS. Nothing
    asserted the refusal — and the `client` fixture above now overrides the plan
    dependency with a PAID user, so every other test in this file would stay
    green if the gate were deleted tomorrow.

    Overrides `get_current_user_with_plan` (the real dependency) rather than
    `require_paid`, so the gate's own `is_paid_user` decision is what runs.
    """
    monkeypatch.setattr(ss, "_spawn_rebuild", lambda trigger: None)
    monkeypatch.setenv("SSETF_DB_PATH", str(tmp_path / "ssetf_free.db"))
    import importlib; importlib.reload(ss)
    monkeypatch.setattr(ss, "_spawn_rebuild", lambda trigger: None)

    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": "free1", "role": "user", "plan": "free",
                 "subscription_status": None}
    r = TestClient(app).get("/api/single-stock-etfs/KO")

    assert r.status_code == 402, (
        f"a FREE user reached the single-stock ETF family map ({r.status_code}); "
        f"the paid gate added 2026-08-09 is not holding")


def test_status_not_shadowed_by_symbol_wildcard(client):
    r = client.get("/api/single-stock-etfs/status")
    assert r.status_code == 200
    assert "etf_count" in r.json()          # status payload, NOT the family shape

def test_symbol_lookup_empty_shape(client):
    r = client.get("/api/single-stock-etfs/KO")
    assert r.status_code == 200
    assert r.json() == {"underlying": None, "long": [], "short": [],
                        "best_long": None, "best_short": None}

def test_rebuild_returns_started(client, monkeypatch):
    """The OTHER unjoined thread: `POST /rebuild` answers immediately and does
    the work on a detached thread (`api/routers/single_stock_etfs.py:28`). The
    endpoint's contract is still "returns started" — we simply do not leave
    until the rebuild it promised has actually finished."""
    monkeypatch.setattr(ss, "_fetch_finviz_market", lambda: [])

    finished = threading.Event()
    real_rebuild = ss.rebuild

    def _tracked(*args, **kwargs):
        try:
            return real_rebuild(*args, **kwargs)
        finally:
            finished.set()

    # The router resolves `ss.rebuild` inside the thread body, so patching the
    # module attribute is what the spawned thread will actually call.
    monkeypatch.setattr(ss, "rebuild", _tracked)

    r = client.post("/api/single-stock-etfs/rebuild")
    assert r.status_code == 200 and r.json()["status"] == "started"
    assert finished.wait(30), "the background rebuild never finished"

def _seed_nbis_family(monkeypatch):
    """Seed one NBIS family member so lookup('NBIS') returns a POPULATED family
    when enabled — makes the kill-switch test discriminate (flag-off must empty a
    non-empty family, not just echo an already-empty table)."""
    with ss._write_conn() as c:
        c.execute(
            "INSERT INTO etfs (etf_ticker, underlying, direction, factor, name, price,"
            " avg_volume, avg_dollar_vol, vol_source, updated_at)"
            " VALUES ('NBIU','NBIS','long',2.0,'Issuer 2x Long NBIS',50.0,1e6,5e7,'finviz',1)")
    ss.invalidate_cache()

def test_kill_switch_returns_empty(client, monkeypatch):
    # With the flag ON (default) a seeded family is returned...
    _seed_nbis_family(monkeypatch)
    on = client.get("/api/single-stock-etfs/NBIS").json()
    assert on["underlying"] == "NBIS" and on["best_long"] == "NBIU"
    # ...and with the flag OFF the SAME seeded table returns the empty shape.
    # (Discriminating: deleting the router's _enabled() guard makes this fail.)
    monkeypatch.setenv("SINGLE_STOCK_ETFS_ENABLED", "0")
    ss.invalidate_cache()
    off = client.get("/api/single-stock-etfs/NBIS").json()
    assert off["underlying"] is None and off["long"] == []

def test_anon_is_rejected(tmp_path, monkeypatch):
    monkeypatch.setenv("SSETF_DB_PATH", str(tmp_path / "s.db"))
    app = FastAPI(); app.include_router(router_mod.router)
    c = TestClient(app)
    assert c.post("/api/single-stock-etfs/rebuild").status_code in (401, 403)
    assert c.get("/api/single-stock-etfs/status").status_code in (401, 403)
    assert c.get("/api/single-stock-etfs/NBIS").status_code in (401, 403)
