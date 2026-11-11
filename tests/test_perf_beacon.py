"""Real-user speed beacon (desktop speed plan 10.1): api/services/perf_beacon.py + its router."""
from __future__ import annotations

import sqlite3
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services import perf_beacon as pb


@pytest.fixture
def store(tmp_path, monkeypatch):
    path = tmp_path / "perf.db"
    monkeypatch.setenv("PERF_BEACON_DB_PATH", str(path))
    monkeypatch.delenv(pb.KILL_SWITCH, raising=False)
    monkeypatch.setattr(pb, "_last_prune", 0.0)
    return path


def _report(**over):
    r = {"page": "/charts", "client": "browser", "ttfb": 120, "fcp": 600, "lcp": 900, "dom_ready": 700,
         "load": 1500, "long_task_ms": 80, "long_tasks": 2,
         "api": [{"route": "/api/bars", "ms": 140, "ok": True}, {"route": "/api/breadth-monitor/session", "ms": 60, "ok": False}]}
    r.update(over)
    return r


def _rows(path, table="perf_loads"):
    if not path.exists():
        return []  # a refused report never opens the store
    conn = sqlite3.connect(path)
    try:
        conn.row_factory = sqlite3.Row
        return [dict(r) for r in conn.execute(f"SELECT * FROM {table}")]
    finally:
        conn.close()


def test_a_valid_report_is_stored_with_country_and_no_ip(store):
    assert pb.record(_report(), ip="203.0.113.9", country_header="us") == {"stored": 1, "dropped": 0, "invalid": 0}
    (row,) = _rows(store)
    assert row["page"] == "/charts" and row["client"] == "browser" and row["country"] == "US" and row["lcp"] == 900
    assert "203.0.113.9" not in str(row) and len(row["rate_key"]) == 24
    assert [(a["route"], a["ms"], a["ok"]) for a in _rows(store, "perf_api")] == [("/api/bars", 140, 1), ("/api/breadth-monitor/session", 60, 0)]


@pytest.mark.parametrize("bad", [
    {"page": "/charts/NVDA"},              # more than the first segment
    {"page": "/charts?sym=NVDA"},
    {"page": "charts"},
    {"client": "safari"},
    {"lcp": -1}, {"lcp": 10 ** 9}, {"lcp": "900"}, {"lcp": True}, {"lcp": float("nan")},
    {"api": [{"route": "/api/bars/NVDA", "ms": 1, "ok": True}]},              # a ticker in the path
    {"api": [{"route": "/api/j2/notes/123", "ms": 1, "ok": True}]},           # an id / third segment
    {"api": [{"route": "/api/j2/a1b2c3", "ms": 1, "ok": True}]},              # digits in the second segment
    {"api": [{"route": "https://evil.example/api/x", "ms": 1, "ok": True}]},
    {"api": [{"route": "/api/bars", "ms": 1, "ok": "yes"}]},
    {"api": [{"route": "/api/bars", "ms": 1, "ok": True}] * (pb.MAX_API + 1)},
])
def test_anything_but_numbers_and_enums_is_refused_not_cleaned(store, bad):
    assert pb.record(_report(**bad), ip="1.1.1.1", country_header="US")["invalid"] == 1
    assert _rows(store) == []


def test_country_comes_only_from_the_header_and_only_as_two_letters(store):
    pb.record(_report(country="FR"), ip="1.1.1.1", country_header="not-a-country")
    assert _rows(store)[0]["country"] == ""


def test_rate_limit_per_ip_is_counted_from_the_store(store):
    now = time.time()
    for _ in range(pb.RATE_LIMIT):
        assert pb.record(_report(), ip="9.9.9.9", country_header="US", now=now)["stored"] == 1
    assert pb.record(_report(), ip="9.9.9.9", country_header="US", now=now)["dropped"] == 1
    assert pb.record(_report(), ip="8.8.8.8", country_header="US", now=now)["stored"] == 1
    assert pb.record(_report(), ip="9.9.9.9", country_header="US", now=now + 3601)["stored"] == 1


def test_row_ceiling_deletes_the_oldest_with_their_api_rows(store, monkeypatch):
    monkeypatch.setattr(pb, "MAX_LOADS", 3)
    for i in range(5):
        pb.record(_report(ttfb=i), ip=f"10.0.0.{i}", country_header="US")
    rows = _rows(store)
    assert [r["ttfb"] for r in rows] == [2, 3, 4]
    assert len(_rows(store, "perf_api")) == 3 * 2


def test_retention_prunes_old_loads(store):
    old = time.time() - (pb.RETENTION_DAYS + 1) * 86400
    pb.record(_report(), ip="1.1.1.1", country_header="US", now=old)
    pb._last_prune = 0.0
    pb.record(_report(), ip="2.2.2.2", country_header="US")
    assert len(_rows(store)) == 1


def test_summary_percentiles_by_page_route_and_country(store):
    now = time.time()
    for i, lcp in enumerate([100, 200, 300, 400]):
        pb.record(_report(lcp=lcp), ip=f"10.0.1.{i}", country_header="US", now=now)
    pb.record(_report(page="/dashboard", client="desktop", lcp=5000), ip="10.0.2.1", country_header="CA", now=now)
    s = pb.summary(24, now=now + 1)
    assert s["loads"] == 5
    charts = next(p for p in s["pages"] if p["page"] == "/charts")
    assert charts["client"] == "browser" and charts["loads"] == 4
    assert charts["lcp"] == {"p50": 200, "p75": 300, "p95": 400}
    bars = next(a for a in s["api"] if a["route"] == "/api/bars")
    assert bars["calls"] == 5 and bars["failed_pct"] == 0.0
    breadth = next(a for a in s["api"] if a["route"] == "/api/breadth-monitor/session")
    assert breadth["failed_pct"] == 100.0
    assert s["countries"][0] == {"country": "US", "loads": 4, "lcp_p75": 300}


@pytest.fixture
def client(store):
    from api.routers import perf_beacon as router_mod
    app = FastAPI()
    app.include_router(router_mod.router)
    return app, TestClient(app)


def test_the_door_takes_anonymous_reports_and_reads_the_cloudflare_country(client, store):
    _, c = client
    r = c.post("/api/perf/beacon", json=_report(), headers={"CF-IPCountry": "US"})
    assert r.status_code == 200 and r.json() == {"ok": True, "enabled": True, "stored": 1, "dropped": 0, "invalid": 0}
    assert _rows(store)[0]["country"] == "US"


def test_the_kill_switch_stores_nothing_and_tells_the_page_to_stop(client, store, monkeypatch):
    _, c = client
    monkeypatch.setenv(pb.KILL_SWITCH, "0")
    assert c.post("/api/perf/beacon", json=_report()).json() == {"ok": True, "enabled": False}
    assert not store.exists() or _rows(store) == []


def test_oversized_and_unreadable_bodies_are_refused(client):
    _, c = client
    assert c.post("/api/perf/beacon", content=b"x" * (pb.MAX_BODY_BYTES + 1)).status_code == 413
    assert c.post("/api/perf/beacon", content=b"{not json").status_code == 400


def test_the_admin_read_needs_an_admin(client, store):
    app, c = client
    assert c.get("/api/admin/perf").status_code in (401, 403)
    app.dependency_overrides[authmw.require_admin] = lambda: {"id": "admin", "role": "admin"}
    pb.record(_report(), ip="1.1.1.1", country_header="US")
    assert c.get("/api/admin/perf").json()["loads"] == 1
