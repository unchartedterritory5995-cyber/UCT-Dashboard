import uuid
from fastapi.testclient import TestClient

from api.main import app
from api.services.auth_db import init_db
from api.services.auth_service import create_user, create_session


def _login(client):
    user = create_user(f"scr_{uuid.uuid4()}@example.com", "password123")
    token = create_session(user["id"])
    client.cookies.set("uct_session", token)
    return user["id"]


def _seed_screener(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    import api.services.screener.snapshot_db as db
    db.init_db()
    db.upsert_rows([
        {"ticker": "AAA", "rsi14": 25, "uct_composite": 80, "price": 10.0,
         "sector": "Tech", "company": "Alpha", "snapshot_date": "2026-06-19",
         "built_at": 1},
        {"ticker": "BBB", "rsi14": 85, "uct_composite": 60, "price": 20.0,
         "sector": "Tech", "company": "Beta", "snapshot_date": "2026-06-19",
         "built_at": 1},
    ])


def test_meta_requires_auth():
    client = TestClient(app)
    init_db()
    assert client.get("/api/screener/meta").status_code == 401
    assert client.post("/api/screener/scan", json={"filters": []}).status_code == 401


def test_meta_and_scan_after_login(tmp_path, monkeypatch):
    _seed_screener(tmp_path, monkeypatch)
    client = TestClient(app)
    init_db()
    _login(client)

    r = client.get("/api/screener/meta")
    assert r.status_code == 200
    body = r.json()
    assert any(f["key"] == "sector" for f in body["filters"])
    assert any(v["key"] == "overview" for v in body["views"])

    r2 = client.post("/api/screener/scan",
                     json={"filters": [{"key": "rsi14", "op": "lte", "max": 60}],
                           "view": "overview"})
    assert r2.status_code == 200
    out = r2.json()
    assert out["total"] == 1
    assert out["rows"][0]["ticker"] == "AAA"


def test_scan_rejects_bad_filter(tmp_path, monkeypatch):
    _seed_screener(tmp_path, monkeypatch)
    client = TestClient(app)
    init_db()
    _login(client)
    r = client.post("/api/screener/scan",
                    json={"filters": [{"key": "evil", "op": "eq", "value": 1}]})
    assert r.status_code == 400


def test_refresh_requires_admin(tmp_path, monkeypatch):
    _seed_screener(tmp_path, monkeypatch)
    client = TestClient(app)
    init_db()
    _login(client)  # member, not admin
    assert client.post("/api/screener/refresh").status_code == 403


def test_refresh_admin_starts(tmp_path, monkeypatch):
    _seed_screener(tmp_path, monkeypatch)
    client = TestClient(app)
    init_db()
    uid = _login(client)
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        conn.execute("UPDATE users SET role='admin' WHERE id=?", (uid,))
        conn.commit()
    finally:
        conn.close()
    r = client.post("/api/screener/refresh?max_tickers=1")
    assert r.status_code == 200
    assert r.json()["started"] is True


def test_saved_screens_roundtrip(tmp_path, monkeypatch):
    _seed_screener(tmp_path, monkeypatch)
    client = TestClient(app)
    init_db()
    _login(client)
    r = client.get("/api/screener/saved-screens")
    assert r.status_code == 200
    assert len(r.json()["starters"]) >= 3
    created = client.post("/api/screener/saved-screens",
                          json={"name": "My RSI", "spec": {"filters": [], "view": "overview"}})
    assert created.status_code == 200
    sid = created.json()["id"]
    assert any(s["id"] == sid for s in client.get("/api/screener/saved-screens").json()["saved"])
    assert client.request("DELETE", f"/api/screener/saved-screens/{sid}").json()["deleted"] is True
