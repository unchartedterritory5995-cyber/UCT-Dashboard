"""Gold-set drawing review: bulk load / list / correction / export.

Rails:
  * every route refuses anonymous and member callers; load + export also take
    Bearer PUSH_SECRET, and a wrong or unconfigured secret never passes;
  * bulk load is idempotent on item_id and keeps saved corrections;
  * inputs are bounded (<=250 items, drawings size/count caps, verdict enum);
  * NO write into pattern_exemplars or pattern_verdicts from this flow;
  * the export returns the exact drawings_json saved.
Fixtures are synthetic (no ledger text: the repo is public).
"""
import importlib
import json
import sqlite3
import uuid

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.services.auth_db import init_db as auth_init_db
from api.services.auth_service import create_user, create_session

SECRET = "gold-test-secret-" + uuid.uuid4().hex


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_DB_PATH", str(tmp_path / "pv.db"))
    monkeypatch.setenv("PUSH_SECRET", SECRET)
    import api.services.pattern_vision.store as s
    importlib.reload(s)
    s.init_db()
    return s


@pytest.fixture
def client(store):
    auth_init_db()
    return TestClient(app)


def _login(client, role="member"):
    user = create_user(f"gold_{uuid.uuid4()}@example.com", "password123")
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        conn.execute("UPDATE users SET role = ? WHERE id = ?", (role, user["id"]))
        conn.execute(
            "INSERT INTO subscriptions (id, user_id, plan, status) VALUES (?, ?, 'pro', 'active')",
            (uuid.uuid4().hex, user["id"]),
        )
        conn.commit()
    finally:
        conn.close()
    client.cookies.set("uct_session", create_session(user["id"]))
    return user["id"]


def _seed(n=1):
    return [{"id": f"s{i}", "type": "trendline",
             "points": [{"time": "2025-03-03", "price": 10.0 + i},
                        {"time": "2025-04-01", "price": 12.5 + i}]} for i in range(n)]


def _item(i, **kw):
    it = {"item_id": f"gt-{i:04d}", "ticker": "ABCD", "tf": "D", "label": "bull_flag",
          "asof_date": "2025-04-01", "start_date": "2025-01-02", "seed_drawings": _seed(2)}
    it.update(kw)
    return it


def _payload(n=3, batch="gtest", **kw):
    return {"batch": batch, "items": [_item(i, **kw) for i in range(n)]}


BEARER = {"Authorization": f"Bearer {SECRET}"}


def _counts(store):
    c = sqlite3.connect(store.get_db_path())
    try:
        return {t: c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                for t in ("pattern_exemplars", "pattern_verdicts", "pattern_feedback",
                          "gold_review_items", "gold_review_corrections")}
    finally:
        c.close()


# ---- auth gates --------------------------------------------------------------

def test_every_gold_route_refuses_anonymous(client):
    assert client.post("/api/patterns/admin/gold-items", json=_payload()).status_code == 401
    assert client.get("/api/patterns/admin/gold-items").status_code == 401
    assert client.post("/api/patterns/admin/gold-items/gt-0000/correction",
                       json={"verdict": "ok"}).status_code == 401
    assert client.get("/api/patterns/admin/gold-corrections").status_code == 401


def test_every_gold_route_refuses_a_member(client):
    _login(client, role="member")
    assert client.post("/api/patterns/admin/gold-items", json=_payload()).status_code == 403
    assert client.get("/api/patterns/admin/gold-items").status_code == 403
    assert client.post("/api/patterns/admin/gold-items/gt-0000/correction",
                       json={"verdict": "ok"}).status_code == 403
    assert client.get("/api/patterns/admin/gold-corrections").status_code == 403


def test_push_secret_opens_load_and_export_only(client, store):
    assert client.post("/api/patterns/admin/gold-items", json=_payload(),
                       headers=BEARER).status_code == 200
    assert client.get("/api/patterns/admin/gold-corrections", headers=BEARER).status_code == 200
    # list + correction stay cookie-admin only: a bearer alone is not a session
    assert client.get("/api/patterns/admin/gold-items", headers=BEARER).status_code == 401
    assert client.post("/api/patterns/admin/gold-items/gt-0000/correction",
                       json={"verdict": "ok"}, headers=BEARER).status_code == 401


def test_wrong_bearer_is_401_even_with_an_admin_cookie(client):
    _login(client, role="admin")
    bad = {"Authorization": "Bearer nope"}
    assert client.post("/api/patterns/admin/gold-items", json=_payload(),
                       headers=bad).status_code == 401
    assert client.get("/api/patterns/admin/gold-corrections", headers=bad).status_code == 401


def test_unset_push_secret_never_matches(client, monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "")
    for h in ({"Authorization": "Bearer "}, {"Authorization": "Bearer"}):
        assert client.post("/api/patterns/admin/gold-items", json=_payload(),
                           headers=h).status_code == 401


def test_guard_is_registered_with_the_auth_surface_audit():
    from api import auth_surface_check as asc
    assert "require_admin_or_push_secret" in asc.GUARD_NAMES


# ---- load: idempotency + caps ---------------------------------------------

def test_bulk_load_is_idempotent_on_item_id_and_keeps_corrections(client, store):
    _login(client, role="admin")
    r = client.post("/api/patterns/admin/gold-items", json=_payload(3))
    assert r.status_code == 200 and r.json()["loaded"] == 3
    assert client.post("/api/patterns/admin/gold-items/gt-0001/correction",
                       json={"verdict": "ok"}).status_code == 200
    # reload the same ids with a changed label: replaced, not duplicated
    r = client.post("/api/patterns/admin/gold-items", json=_payload(3, label="flat_base"))
    assert r.status_code == 200
    c = _counts(store)
    assert c["gold_review_items"] == 3
    assert c["gold_review_corrections"] == 1
    body = client.get("/api/patterns/admin/gold-items?batch=gtest").json()
    assert {i["label"] for i in body["items"]} == {"flat_base"}
    assert body["total"] == 3 and body["done"] == 1


def test_load_caps(client):
    _login(client, role="admin")
    url = "/api/patterns/admin/gold-items"
    assert client.post(url, json=_payload(250)).status_code == 200
    assert client.post(url, json=_payload(251)).status_code == 422
    assert client.post(url, json={"batch": "gtest", "items": []}).status_code == 422
    assert client.post(url, json=_payload(1, seed_drawings=_seed(61))).status_code == 422
    huge = [{"id": "x", "type": "text", "text": "a" * 70000, "points": []}]
    assert client.post(url, json=_payload(1, seed_drawings=huge)).status_code == 422
    assert client.post(url, json=_payload(1, item_id="../etc")).status_code == 422
    assert client.post(url, json=_payload(1, asof_date="April 1")).status_code == 422
    assert client.post(url, json=_payload(1, tf="5m")).status_code == 422
    assert client.post(url, json=_payload(1, batch="bad batch!")).status_code == 422
    dup = {"batch": "gtest", "items": [_item(0), _item(0)]}
    assert client.post(url, json=dup).status_code == 422


# ---- corrections ----------------------------------------------------------

def test_correction_validation(client):
    _login(client, role="admin")
    client.post("/api/patterns/admin/gold-items", json=_payload(1))
    url = "/api/patterns/admin/gold-items/gt-0000/correction"
    assert client.post(url, json={"verdict": "maybe"}).status_code == 422
    assert client.post(url, json={"verdict": "fixed", "drawings_json": "{not json"}).status_code == 422
    assert client.post(url, json={"verdict": "fixed",
                                  "drawings_json": json.dumps({"a": 1})}).status_code == 422
    assert client.post(url, json={"verdict": "fixed",
                                  "drawings_json": json.dumps(_seed(61))}).status_code == 422
    assert client.post(url, json={"verdict": "ok", "note": "n" * 2001}).status_code == 422
    assert client.post("/api/patterns/admin/gold-items/gt-9999/correction",
                       json={"verdict": "ok"}).status_code == 404
    for v in ("ok", "fixed", "not_a_pattern", "skip"):
        assert client.post(url, json={"verdict": v}).status_code == 200


def test_gold_flow_never_writes_exemplars_or_verdicts(client, store, monkeypatch):
    """The production judge reads pattern_exemplars and members read
    pattern_verdicts: the gold flow must leave both untouched. Asserted two ways:
    row counts, and the store's writers for those tables are never called."""
    calls = []
    for name in ("add_exemplar", "put_verdict", "delete_exemplar", "record_feedback"):
        monkeypatch.setattr(store, name, lambda *a, _n=name, **k: calls.append(_n))
    _login(client, role="admin")
    before = _counts(store)
    client.post("/api/patterns/admin/gold-items", json=_payload(4))
    for i, v in enumerate(("ok", "fixed", "not_a_pattern", "skip")):
        r = client.post(f"/api/patterns/admin/gold-items/gt-{i:04d}/correction",
                        json={"verdict": v, "drawings_json": json.dumps(_seed(1)), "note": "x"})
        assert r.status_code == 200
    client.get("/api/patterns/admin/gold-items")
    client.get("/api/patterns/admin/gold-corrections")
    after = _counts(store)
    assert calls == []
    for t in ("pattern_exemplars", "pattern_verdicts", "pattern_feedback"):
        assert after[t] == before[t] == 0, t
    assert after["gold_review_corrections"] == 4


def test_gold_tables_are_separate_from_judge_tables(store):
    """A control for the rail above: the judge's exemplar reader sees nothing
    from a gold correction, while a real exemplar write IS seen."""
    store.upsert_gold_items("gtest", [{"item_id": "gt-0000", "ticker": "ABCD",
                                       "asof_date": "2025-04-01"}])
    store.add_gold_correction("gt-0000", "fixed", drawings_json="[]")
    assert store.exemplar_pngs("bull_flag") == []
    store.add_exemplar("bull_flag", b"\x89PNG", ticker="ABCD")
    assert len(store.exemplar_pngs("bull_flag")) == 1


# ---- list + export round trip --------------------------------------------

def test_list_reports_latest_correction_and_progress(client):
    _login(client, role="admin")
    client.post("/api/patterns/admin/gold-items", json=_payload(3))
    client.post("/api/patterns/admin/gold-items/gt-0000/correction", json={"verdict": "skip"})
    client.post("/api/patterns/admin/gold-items/gt-0000/correction", json={"verdict": "fixed"})
    client.post("/api/patterns/admin/gold-items/gt-0002/correction", json={"verdict": "skip"})
    body = client.get("/api/patterns/admin/gold-items").json()
    by_id = {i["item_id"]: i for i in body["items"]}
    assert by_id["gt-0000"]["correction"]["verdict"] == "fixed"
    assert by_id["gt-0001"]["correction"] is None
    assert json.loads(by_id["gt-0001"]["seed_drawings_json"]) == _seed(2)
    assert (body["total"], body["done"], body["skipped"]) == (3, 1, 1)


def test_export_round_trips_exact_drawings_json(client):
    admin_id = _login(client, role="admin")
    client.post("/api/patterns/admin/gold-items", json=_payload(2))
    client.post("/api/patterns/admin/gold-items", json=_payload(1, batch="other"))
    saved = json.dumps([{"id": "a", "type": "rect",
                         "points": [{"time": "2025-02-03", "price": 9.875},
                                    {"time": "2025-03-14", "price": 11.0}],
                         "color": "#22c55e"}])
    client.post("/api/patterns/admin/gold-items/gt-0001/correction",
                json={"verdict": "fixed", "drawings_json": saved, "note": "moved the top"})
    rows = client.get("/api/patterns/admin/gold-corrections?batch=gtest",
                      headers=BEARER).json()["corrections"]
    assert len(rows) == 1
    row = rows[0]
    assert row["drawings_json"] == saved            # byte-exact
    assert row["verdict"] == "fixed" and row["note"] == "moved the top"
    assert row["item_id"] == "gt-0001" and row["ticker"] == "ABCD"
    assert row["asof_date"] == "2025-04-01" and row["by_user"] == str(admin_id)
    assert json.loads(row["seed_drawings_json"]) == _seed(2)
