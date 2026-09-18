"""W3 — `/api/oi/confirmation-map` off the event loop, behavior preserved.

The route's whole body (sqlite reads over up to 5,000 contracts, format
detection, per-contract OI-growth computation) used to run directly inside the
`async def`, on the shared uvicorn loop (OI-44/R52's loop-blockers scanner
class). It is now wrapped in `run_in_threadpool`. This proves the wrap is
behaviorally transparent — same inputs, same response shape, same numbers —
not just "doesn't crash on import" (`tests/test_oi44_loop_blockers_gate.py`
proves the loop-safety half; this proves the correctness half).
"""
import sqlite3

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.middleware.auth_middleware import get_current_user
import api.flow_db as flow_db


def _as(user: dict):
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


@pytest.fixture
def client(tmp_path, monkeypatch):
    db_path = str(tmp_path / "flow.db")
    conn = sqlite3.connect(db_path)
    conn.execute(
        "CREATE TABLE contract_oi_snapshots "
        "(contract_key TEXT, snap_date TEXT, oi INTEGER)"
    )
    conn.executemany(
        "INSERT INTO contract_oi_snapshots (contract_key, snap_date, oi) VALUES (?, ?, ?)",
        [
            ("BE|C|370.0|9/18/2026", "2026-07-01", 5000),
            ("BE|C|370.0|9/18/2026", "2026-07-03", 6000),
            ("XOM|P|140.0|8/21/2026", "2026-08-01", 100),
            ("XOM|P|140.0|8/21/2026", "2026-08-03", 105),
        ],
    )
    conn.commit()
    conn.close()
    # __init__'s default arg is bound at class-definition time; patching the
    # module attribute alone would not reach it, so rebind the default itself.
    monkeypatch.setattr(flow_db.FlowDB.__init__, "__defaults__", (db_path,))
    c = _as({"id": 1, "role": "member", "email": "member@test"})
    yield c
    app.dependency_overrides.clear()


def test_a_real_growth_is_confirmed(client):
    resp = client.post(
        "/api/oi/confirmation-map",
        json={"contracts": [
            {"sym": "BE", "cp": "C", "strike": 370, "expiry": "9/18/2026",
             "first_trade_date": "7/2/2026"},
        ]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    key = "BE|C|370|9/18/2026"
    conf = body["confirmations"][key]
    assert conf["confirmed"] is True
    assert conf["first_oi"] == 5000
    assert conf["peak_oi"] == 6000


def test_no_growth_is_not_confirmed(client):
    resp = client.post(
        "/api/oi/confirmation-map",
        json={"contracts": [
            {"sym": "XOM", "cp": "P", "strike": 140, "expiry": "8/21/2026",
             "first_trade_date": "8/2/2026"},
        ]},
    )
    body = resp.json()
    key = "XOM|P|140|8/21/2026"
    conf = body["confirmations"][key]
    assert conf["confirmed"] is False
    assert conf["first_oi"] == 100
    assert conf["peak_oi"] == 105


def test_empty_contracts_short_circuits_before_the_threadpool(client):
    resp = client.post("/api/oi/confirmation-map", json={"contracts": []})
    assert resp.status_code == 200
    assert resp.json() == {"ok": False, "error": "No contracts provided"}


def test_too_many_contracts_is_rejected(client):
    contracts = [{"sym": "X", "cp": "C", "strike": 1, "expiry": "1/1/2027",
                 "first_trade_date": "1/1/2026"} for _ in range(5001)]
    resp = client.post("/api/oi/confirmation-map", json={"contracts": contracts})
    assert resp.json() == {"ok": False, "error": "Too many contracts (limit 5000)"}


def test_unauthenticated_caller_is_refused():
    app.dependency_overrides.clear()
    c = TestClient(app)
    resp = c.post("/api/oi/confirmation-map", json={"contracts": []})
    assert resp.status_code in (401, 403)
