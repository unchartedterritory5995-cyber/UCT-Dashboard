"""Desktop app telemetry (desktop plan 5.1, v2 Task 30): enum-only validation,
limits, kill switch, retention, halt triggers, alerts, and the doors.

Every test points `DESKTOP_EVENTS_DB_PATH` at its own tmp file.
"""
from __future__ import annotations

import json
import sqlite3
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services import desktop_events as de

INSTALL_A = "a" * 32
INSTALL_B = "b" * 32
NOW = 1_800_000_000.0


@pytest.fixture
def store(tmp_path, monkeypatch):
    path = tmp_path / "desktop_events.db"
    monkeypatch.setenv("DESKTOP_EVENTS_DB_PATH", str(path))
    monkeypatch.delenv(de.KILL_SWITCH, raising=False)
    monkeypatch.setattr(de, "_last_prune", 0.0)
    return path


def _rows(path):
    c = sqlite3.connect(path)
    c.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in c.execute("SELECT * FROM desktop_events ORDER BY id")]
    finally:
        c.close()


def _ev(**over):
    e = {"event": "launch_ok", "shell_version": "0.1.4", "os": "win32-10.0.26200",
         "install": INSTALL_A}
    e.update(over)
    return e


# ── Enum-only: refused, never cleaned ────────────────────────────────────────

@pytest.mark.parametrize("field,value", [
    ("event", "launch_ok; DROP TABLE"), ("event", "made_up"), ("event", None), ("event", 1),
    ("shell_version", "0.1"), ("shell_version", "v0.1.4"), ("shell_version", "0.1.4 (beta)"),
    ("shell_version", "0.1.4-BETA"), ("shell_version", "0.1.4-beta.1.2.3"), ("shell_version", None),
    ("os", "Windows 11"), ("os", "win32-10.0.26200 C:\\Users\\Patrick"), ("os", "android"),
    ("error_code", "crashed at C:\\Users\\x"), ("error_code", "net_-105"), ("error_code", "ERR_FAILED"),
    ("error_code", 5), ("install", "not-hex"), ("install", "A" * 32), ("install", "a" * 31),
])
def test_a_value_outside_its_set_refuses_the_event(store, field, value):
    out = de.record_events([_ev(**{field: value})], user_id=None, ip="1.2.3.4", now=NOW)
    assert out == {"stored": 0, "dropped": 0, "invalid": 1}
    assert not store.exists() or _rows(store) == []


def test_versions_keep_their_digits_and_codes_store_as_sent(store):
    out = de.record_events([
        _ev(),
        _ev(event="load_failed", error_code="net_105", shell_version="1.12.3-beta.2"),
        _ev(event="renderer_crash", error_code="oom", os="win32"),
        _ev(event="update_error", error_code="signature"),
    ], user_id=None, ip="1.2.3.4", now=NOW)
    assert out == {"stored": 4, "dropped": 0, "invalid": 0}
    rows = _rows(store)
    assert [r["shell_version"] for r in rows] == ["0.1.4", "1.12.3-beta.2", "0.1.4", "0.1.4"]
    assert [r["error_code"] for r in rows] == ["", "net_105", "oom", "signature"]


def test_no_row_holds_the_raw_install_id_or_the_ip(store):
    de.record_events([_ev()], user_id=None, ip="203.0.113.77", now=NOW)
    raw = store.read_bytes() + (store.with_name(store.name + "-wal").read_bytes()
                                if store.with_name(store.name + "-wal").exists() else b"")
    assert INSTALL_A.encode() not in raw
    assert b"203.0.113.77" not in raw
    row = _rows(store)[0]
    assert row["install_hash"] and row["install_hash"] != INSTALL_A


def test_unknown_extra_fields_are_never_stored(store):
    de.record_events([_ev(message="secret note text", url="https://x/share/n/tok")],
                     user_id=None, ip="1.2.3.4", now=NOW)
    row = _rows(store)[0]
    assert "secret" not in json.dumps(row) and "share" not in json.dumps(row)


def test_client_ts_is_kept_only_inside_its_window(store):
    de.record_events([_ev(ts=NOW - 3600), _ev(ts=NOW - 30 * 86400), _ev(ts=NOW + 5 * 86400),
                      _ev(ts=float("nan")), _ev(ts=True)], user_id=None, ip="1.2.3.4", now=NOW)
    assert [r["client_ts"] for r in _rows(store)] == [NOW - 3600, None, None, None, None]


def test_a_bad_event_does_not_sink_the_batch(store):
    out = de.record_events([_ev(), "nope", _ev(event="bogus"), _ev(event="desk_restored")],
                           user_id=None, ip="1.2.3.4", now=NOW)
    assert out == {"stored": 2, "dropped": 0, "invalid": 2}


# ── Limits ───────────────────────────────────────────────────────────────────

def test_rate_limit_per_key_counts_from_the_store(store, monkeypatch):
    monkeypatch.setattr(de, "RATE_LIMIT", 3)
    a = de.record_events([_ev()] * 2, user_id=None, ip="1.1.1.1", now=NOW)
    b = de.record_events([_ev()] * 2, user_id=None, ip="1.1.1.1", now=NOW + 1)
    c = de.record_events([_ev()] * 2, user_id=None, ip="2.2.2.2", now=NOW + 2)
    assert (a["stored"], b["stored"], b["dropped"], c["stored"]) == (2, 1, 1, 2)
    later = de.record_events([_ev()], user_id=None, ip="1.1.1.1", now=NOW + de.RATE_WINDOW_S + 5)
    assert later["stored"] == 1


def test_batch_cap_drops_the_tail(store):
    out = de.record_events([_ev()] * (de.MAX_EVENTS_PER_REQUEST + 7), user_id="u1", ip=None, now=NOW)
    assert out["stored"] == de.MAX_EVENTS_PER_REQUEST and out["dropped"] == 7


def test_row_ceiling_deletes_the_oldest(store, monkeypatch):
    monkeypatch.setattr(de, "MAX_ROWS", 5)
    for i in range(8):
        de.record_events([_ev(event="load_failed", error_code=f"net_{i}")], user_id=None,
                         ip=f"9.9.9.{i}", now=NOW + i)
    assert [r["error_code"] for r in _rows(store)] == ["net_3", "net_4", "net_5", "net_6", "net_7"]


def test_retention_prunes_rows_past_ninety_days(store):
    de.record_events([_ev()], user_id=None, ip="1.1.1.1", now=NOW)
    de._last_prune = 0.0
    de.record_events([_ev(event="desk_restored")], user_id=None, ip="1.1.1.1",
                     now=NOW + de.RETENTION_DAYS * 86400 + 10)
    assert [r["event"] for r in _rows(store)] == ["desk_restored"]


def test_signed_in_is_a_flag_not_an_identity(store):
    de.record_events([_ev()], user_id="user-123", ip="1.1.1.1", now=NOW)
    row = _rows(store)[0]
    assert row["signed_in"] == 1
    assert "user-123" not in json.dumps(row)


# ── Halt triggers ────────────────────────────────────────────────────────────

def test_the_same_crash_on_two_machines_is_a_halt_trigger(store):
    de.record_events([_ev(event="renderer_crash", error_code="crashed")], user_id=None, ip="1.1.1.1", now=NOW)
    assert de.halt_triggers(now=NOW + 1) == []
    de.record_events([_ev(event="renderer_crash", error_code="crashed", install=INSTALL_A)],
                     user_id=None, ip="1.1.1.1", now=NOW + 2)
    assert de.halt_triggers(now=NOW + 3) == [], "one machine twice is not two machines"
    de.record_events([_ev(event="renderer_crash", error_code="crashed", install=INSTALL_B)],
                     user_id=None, ip="2.2.2.2", now=NOW + 4)
    t = de.halt_triggers(now=NOW + 5)
    assert len(t) == 1 and t[0]["kind"] == "same_signature" and t[0]["machines"] == 2


def test_different_crash_reasons_are_different_signatures(store):
    de.record_events([_ev(event="renderer_crash", error_code="crashed")], user_id=None, ip="1.1.1.1", now=NOW)
    de.record_events([_ev(event="renderer_crash", error_code="oom", install=INSTALL_B)],
                     user_id=None, ip="2.2.2.2", now=NOW)
    assert de.halt_triggers(now=NOW + 1) == []


def test_update_error_on_two_machines_is_a_halt_trigger(store):
    for inst, ip in ((INSTALL_A, "1.1.1.1"), (INSTALL_B, "2.2.2.2")):
        de.record_events([_ev(event="update_error", error_code="integrity", install=inst)],
                         user_id=None, ip=ip, now=NOW)
    assert [t["event"] for t in de.halt_triggers(now=NOW + 1)] == ["update_error"]


def test_a_launch_failure_loop_on_one_machine_is_a_halt_trigger(store):
    de.record_events([_ev(event="load_failed", error_code="net_105")] * (de.LOOP_THRESHOLD - 1),
                     user_id=None, ip="1.1.1.1", now=NOW)
    assert de.halt_triggers(now=NOW + 1) == []
    de.record_events([_ev(event="load_failed", error_code="net_105")], user_id=None, ip="1.1.1.1", now=NOW + 2)
    t = de.halt_triggers(now=NOW + 3)
    assert [x["kind"] for x in t] == ["launch_failure_loop"]
    de.record_events([_ev()], user_id=None, ip="1.1.1.1", now=NOW + 4)
    assert de.halt_triggers(now=NOW + 5) == [], "a successful launch ends the loop"


def test_triggers_only_look_at_the_window(store):
    for inst, ip in ((INSTALL_A, "1.1.1.1"), (INSTALL_B, "2.2.2.2")):
        de.record_events([_ev(event="gpu_crash", error_code="crashed", install=inst)],
                         user_id=None, ip=ip, now=NOW)
    assert de.halt_triggers(now=NOW + 25 * 3600) == []


# ── Alerts ───────────────────────────────────────────────────────────────────

def _et(h):
    return datetime(2027, 1, 5, h, 30, tzinfo=ZoneInfo("America/New_York")).timestamp()


def test_alert_tick_posts_each_trigger_once_and_one_digest_a_day(store):
    t0 = _et(8)
    for inst, ip in ((INSTALL_A, "1.1.1.1"), (INSTALL_B, "2.2.2.2")):
        de.record_events([_ev(event="renderer_crash", error_code="crashed", install=inst)],
                         user_id=None, ip=ip, now=t0)
    posts = []
    first = de.alert_tick(now=t0 + 60, post=posts.append)
    second = de.alert_tick(now=t0 + 3600, post=posts.append)
    assert first == {"halts": 1, "digest": 1} and second == {"halts": 0, "digest": 0}
    assert len(posts) == 2
    assert posts[0].startswith("Desktop HALT: renderer_crash (crashed) on 0.1.4 from 2 machines")
    assert "HALT TRIGGERS: 1" in posts[1] and "renderer_crash crashed on 0.1.4" in posts[1]


def test_no_digest_before_seven_et_or_when_nothing_was_reported(store):
    posts = []
    assert de.alert_tick(now=_et(9), post=posts.append) == {"halts": 0, "digest": 0}
    de.record_events([_ev()], user_id=None, ip="1.1.1.1", now=_et(5))
    assert de.alert_tick(now=_et(6), post=posts.append) == {"halts": 0, "digest": 0}
    assert posts == []


def test_alert_tick_is_silent_with_the_kill_switch_off(store, monkeypatch):
    for inst, ip in ((INSTALL_A, "1.1.1.1"), (INSTALL_B, "2.2.2.2")):
        de.record_events([_ev(event="update_error", error_code="feed", install=inst)],
                         user_id=None, ip=ip, now=_et(8))
    monkeypatch.setenv(de.KILL_SWITCH, "0")
    posts = []
    assert de.alert_tick(now=_et(9), post=posts.append) == {"halts": 0, "digest": 0}
    assert posts == []


def test_digest_text_never_names_a_machine_or_an_address(store):
    de.record_events([_ev(event="load_failed", error_code="net_105")] * de.LOOP_THRESHOLD,
                     user_id=None, ip="198.51.100.9", now=_et(8))
    posts = []
    de.alert_tick(now=_et(9), post=posts.append)
    text = "\n".join(posts)
    assert "198.51.100.9" not in text and INSTALL_A not in text
    assert "launch-failure loop" in text


# ── The doors ────────────────────────────────────────────────────────────────

@pytest.fixture
def client(store):
    from api.routers import desktop_events as router_mod
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[authmw.get_current_user_optional] = lambda: None
    return TestClient(app)


def test_the_door_accepts_anonymous_events(client, store):
    r = client.post("/api/desktop/event", json={"events": [_ev(), _ev(event="unclean_exit")]})
    assert r.status_code == 200
    assert r.json() == {"ok": True, "enabled": True, "stored": 2, "dropped": 0, "invalid": 0}
    assert [x["signed_in"] for x in _rows(store)] == [0, 0]


def test_the_door_accepts_a_single_event_object(client, store):
    r = client.post("/api/desktop/event", json=_ev(event="first_signin"))
    assert r.json()["stored"] == 1


def test_kill_switch_off_writes_nothing_and_says_so(client, store, monkeypatch):
    monkeypatch.setenv(de.KILL_SWITCH, "off")
    r = client.post("/api/desktop/event", json=_ev())
    assert r.status_code == 200 and r.json()["enabled"] is False
    assert not store.exists() or _rows(store) == []


def test_an_oversized_body_is_refused_before_parsing(client, store):
    r = client.post("/api/desktop/event", content=b"x" * (de.MAX_BODY_BYTES + 1),
                    headers={"content-type": "application/json"})
    assert r.status_code == 413


def test_a_non_json_or_non_object_body_is_a_400(client):
    assert client.post("/api/desktop/event", content=b"{nope",
                       headers={"content-type": "application/json"}).status_code == 400
    assert client.post("/api/desktop/event", json=[_ev()]).status_code == 400


def test_the_admin_read_requires_admin(store):
    from api.routers import desktop_events as router_mod
    app = FastAPI()
    app.include_router(router_mod.router)
    c = TestClient(app)
    assert c.get("/api/admin/desktop-events").status_code in (401, 403)
    app.dependency_overrides[authmw.require_admin] = lambda: {"id": "admin", "role": "admin"}
    de.record_events([_ev()], user_id=None, ip="1.1.1.1", now=time.time())
    body = c.get("/api/admin/desktop-events").json()
    assert body["machines"] == 1 and body["rows"][0]["event"] == "launch_ok"


def test_the_door_is_mounted_on_the_real_app():
    from api.main import app
    paths = {(m, r.path) for r in app.routes for m in getattr(r, "methods", ()) or ()}
    assert ("POST", "/api/desktop/event") in paths
    assert ("GET", "/api/admin/desktop-events") in paths
