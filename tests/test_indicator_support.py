"""Pine support loop, Phase A — the server rails (``docs/pine/support-loop/PHASE-A.md``).

Each class below is one privacy or safety guarantee that doc names, driven through
the real router over a real SQLite file. The override replaces ``get_current_user``
(the auth DEPENDENCY), never an ownership check, so a route that lost its
``user_id`` filter or its ``require_admin`` shows up red here.
"""
from __future__ import annotations

import datetime as dt
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user
from api.routers import indicator_support as router_mod
from api.services import auth_db
from api.services import indicator_support as svc

ALICE = {"id": "u-alice", "role": "user", "email": "a@test"}
BOB = {"id": "u-bob", "role": "user", "email": "b@test"}
ADMIN = {"id": "u-admin", "role": "admin", "email": "admin@test"}
SCRIPT = '//@version=5\nindicator("t")\nplot(ta.foo(close, 14))\n'


@pytest.fixture(autouse=True)
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth_test.db"))
    auth_db.init_db()
    monkeypatch.delenv(svc.FLAG_ENV, raising=False)
    monkeypatch.delenv(svc.GAP_LOG_OFF_ENV, raising=False)
    return tmp_path


@pytest.fixture
def app():
    a = FastAPI()
    a.include_router(router_mod.router)
    return a


def client_as(app, user):
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _count(table: str) -> int:
    conn = auth_db.get_connection()
    try:
        conn.executescript(svc._SCHEMA)
        return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    finally:
        conn.close()


def _gap_rows():
    conn = auth_db.get_connection()
    try:
        conn.executescript(svc._SCHEMA)
        return conn.execute("SELECT day, name, kind, member_key, hits FROM indicator_gap_hits"
                            " ORDER BY name").fetchall()
    finally:
        conn.close()


def _report(client, **over):
    body = {"consent": True, "source": SCRIPT, "note": "the line is higher",
            "tradingview_link": "https://www.tradingview.com/script/abc/",
            "symbol": "AAPL", "timeframe": "D",
            "gaps": [{"name": "ta.supertrend", "kind": "call-unmapped"}]}
    body.update(over)
    return client.post("/api/indicator-support/reports", json=body)


# ─── A2: a non-allowlisted name is never logged ──────────────────────────────

class TestGapAllowlist:
    def test_the_allowlist_is_the_shared_json_and_real(self):
        assert "ta.sma" in svc.PINE_BUILTINS
        assert "request.security" in svc.PINE_BUILTINS
        assert "mySecretThing" not in svc.PINE_BUILTINS

    def test_only_allowlisted_names_reach_the_table(self, app):
        c = client_as(app, ALICE)
        r = c.post("/api/indicator-support/gaps", json={"dialect": "pine", "gaps": [
            {"name": "ta.supertrend", "kind": "name-unknown"},
            {"name": "mySecretThing", "kind": "name-unknown"},
            {"name": "alice@example.com", "kind": "call-unmapped"},
            {"name": "request.financial", "kind": "bogus-kind"},
        ], "unlisted": 2})
        assert r.status_code == 200
        rows = _gap_rows()
        names = {row[1] for row in rows}
        # ⛔ THE RAIL: nothing the member typed survives, under any spelling.
        assert names == {"ta.supertrend", "request.financial", svc.UNLISTED}
        assert all(row[1] in svc.PINE_BUILTINS or row[1] == svc.UNLISTED for row in rows)
        kinds = {row[1]: row[2] for row in rows}
        assert kinds["request.financial"] == "call-unmapped"   # an unknown kind is never stored

    def test_a_non_scalar_name_is_refused_or_unlisted(self, app):
        c = client_as(app, ALICE)
        r = c.post("/api/indicator-support/gaps", json={"gaps": [
            {"name": {"nested": "secret"}, "kind": "name-unknown"}]})
        assert r.status_code == 422
        assert _gap_rows() == []

    def test_ranking_counts_distinct_members_and_caps_repeat_hits(self, app):
        for _ in range(3):
            svc.record_gaps("u1", [{"name": "ta.supertrend", "kind": "name-unknown"}])
        svc.record_gaps("u2", [{"name": "ta.supertrend", "kind": "name-unknown"}])
        svc.record_gaps("u2", [{"name": "ta.rci", "kind": "name-unknown"}])
        for _ in range(svc.HITS_CAP_PER_DAY + 10):
            svc.record_gaps("u3", [{"name": "ta.rci", "kind": "name-unknown"}])
        rank = svc.gap_ranking(30)
        top = {(r["name"], r["kind"]): r for r in rank}
        assert top[("ta.supertrend", "name-unknown")]["members"] == 2
        assert top[("ta.supertrend", "name-unknown")]["hits"] == 4
        assert top[("ta.rci", "name-unknown")]["hits"] == 1 + svc.HITS_CAP_PER_DAY
        assert rank[0]["members"] >= rank[-1]["members"]
        assert all("user_id" not in r and "member_key" not in r for r in rank)

    def test_gap_log_kill_switch(self, monkeypatch):
        monkeypatch.setenv(svc.GAP_LOG_OFF_ENV, "off")
        assert svc.record_gaps("u1", [{"name": "ta.sma", "kind": "name-unknown"}]) == 0
        assert _gap_rows() == []

    def test_ranking_is_admin_only(self, app):
        assert client_as(app, ALICE).get("/api/indicator-support/gaps").status_code == 403
        assert client_as(app, ADMIN).get("/api/indicator-support/gaps").status_code == 200


# ─── A3: the flag being OFF stores nothing ───────────────────────────────────

class TestFlagOff:
    def test_flag_off_refuses_and_stores_nothing(self, app):
        c = client_as(app, ALICE)
        r = _report(c)
        assert r.status_code == 404
        assert _count("indicator_support_reports") == 0
        assert c.get("/api/indicator-support/config").json()["reports_enabled"] is False

    def test_flag_on_stores_one(self, app, monkeypatch):
        monkeypatch.setenv(svc.FLAG_ENV, "1")
        c = client_as(app, ALICE)
        r = _report(c)
        assert r.status_code == 200, r.text
        assert _count("indicator_support_reports") == 1
        assert c.get("/api/indicator-support/config").json()["reports_enabled"] is True


# ─── A3: no source without consent=true ──────────────────────────────────────

class TestConsent:
    @pytest.mark.parametrize("consent", [False, None, 1, "true", "yes", [True], {"v": True}])
    def test_anything_but_boolean_true_is_refused(self, app, monkeypatch, consent):
        monkeypatch.setenv(svc.FLAG_ENV, "1")
        r = _report(client_as(app, ALICE), consent=consent)
        assert r.status_code == 422
        assert r.json()["detail"]["code"] == "consent"
        assert _count("indicator_support_reports") == 0

    def test_missing_consent_key_is_refused(self, app, monkeypatch):
        monkeypatch.setenv(svc.FLAG_ENV, "1")
        c = client_as(app, ALICE)
        r = c.post("/api/indicator-support/reports", json={"source": SCRIPT})
        assert r.status_code == 422
        assert _count("indicator_support_reports") == 0

    def test_the_table_itself_refuses_consent_zero(self):
        conn = auth_db.get_connection()
        try:
            conn.executescript(svc._SCHEMA)
            with pytest.raises(Exception):
                conn.execute(
                    f"INSERT INTO indicator_support_reports ({svc._COLS})"
                    " VALUES ('x','u',0,'s','h',1,NULL,NULL,NULL,NULL,'[]','v','new','t','t')")
        finally:
            conn.close()


# ─── A3: ownership and admin ─────────────────────────────────────────────────

class TestOwnership:
    def _alice_report(self, app, monkeypatch):
        monkeypatch.setenv(svc.FLAG_ENV, "1")
        r = _report(client_as(app, ALICE))
        assert r.status_code == 200
        return r.json()["id"]

    def test_member_cannot_read_another_members_report(self, app, monkeypatch):
        rid = self._alice_report(app, monkeypatch)
        bob = client_as(app, BOB)
        assert bob.get(f"/api/indicator-support/reports/mine/{rid}").status_code == 404
        assert bob.get("/api/indicator-support/reports/mine").json()["reports"] == []
        alice = client_as(app, ALICE)
        got = alice.get(f"/api/indicator-support/reports/mine/{rid}")
        assert got.status_code == 200 and got.json()["source"] == SCRIPT

    def test_member_cannot_withdraw_another_members_report(self, app, monkeypatch):
        rid = self._alice_report(app, monkeypatch)
        assert client_as(app, BOB).delete(f"/api/indicator-support/reports/mine/{rid}").status_code == 404
        assert _count("indicator_support_reports") == 1
        assert client_as(app, ALICE).delete(f"/api/indicator-support/reports/mine/{rid}").status_code == 200
        assert _count("indicator_support_reports") == 0

    def test_non_admins_cannot_list_or_read_or_triage(self, app, monkeypatch):
        rid = self._alice_report(app, monkeypatch)
        alice = client_as(app, ALICE)
        assert alice.get("/api/indicator-support/reports").status_code == 403
        assert alice.get(f"/api/indicator-support/reports/{rid}").status_code == 403
        assert alice.patch(f"/api/indicator-support/reports/{rid}", json={"status": "fixed"}).status_code == 403
        admin = client_as(app, ADMIN)
        lst = admin.get("/api/indicator-support/reports").json()["reports"]
        assert len(lst) == 1 and "source" not in lst[0] and lst[0]["reporter"] == ALICE["id"]
        one = admin.get(f"/api/indicator-support/reports/{rid}").json()
        assert one["source"] == SCRIPT and one["gaps"] == [{"name": "ta.supertrend", "kind": "call-unmapped"}]
        assert admin.patch(f"/api/indicator-support/reports/{rid}", json={"status": "triaged"}).status_code == 200
        # ⚠️ the override is app-wide: re-assert who is asking.
        alice = client_as(app, ALICE)
        assert alice.get("/api/indicator-support/reports/mine").json()["reports"][0]["status"] == "triaged"

    def test_the_member_view_never_carries_another_field_set(self, app, monkeypatch):
        self._alice_report(app, monkeypatch)
        row = client_as(app, ALICE).get("/api/indicator-support/reports/mine").json()["reports"][0]
        assert "source" not in row and "reporter" not in row


# ─── A3: rate limit and size cap ─────────────────────────────────────────────

class TestLimits:
    def test_rate_limit_per_hour(self, app, monkeypatch):
        monkeypatch.setenv(svc.FLAG_ENV, "1")
        c = client_as(app, ALICE)
        for i in range(svc.RATE_PER_HOUR):
            assert _report(c, source=f"{SCRIPT}// {i}\n").status_code == 200
        r = _report(c, source=f"{SCRIPT}// over\n")
        assert r.status_code == 429
        assert _count("indicator_support_reports") == svc.RATE_PER_HOUR
        # another member is not affected
        assert _report(client_as(app, BOB)).status_code == 200

    def test_rate_limit_per_day(self, monkeypatch):
        monkeypatch.setenv(svc.FLAG_ENV, "1")
        t0 = dt.datetime(2026, 10, 30, 0, 0, tzinfo=dt.timezone.utc)
        for i in range(svc.RATE_PER_DAY):
            svc.create_report("u1", consent=True, source=f"x{i}", now=t0 + dt.timedelta(minutes=13 * i))
        with pytest.raises(svc.ReportRefused) as e:
            svc.create_report("u1", consent=True, source="over",
                              now=t0 + dt.timedelta(minutes=13 * svc.RATE_PER_DAY))
        assert e.value.status == 429

    def test_size_cap_in_bytes(self, app, monkeypatch):
        monkeypatch.setenv(svc.FLAG_ENV, "1")
        c = client_as(app, ALICE)
        # multi-byte characters: under the CHARACTER cap, over the BYTE cap
        big = "é" * (svc.MAX_SOURCE_BYTES // 2 + 1)
        r = _report(c, source=big)
        assert r.status_code == 413
        assert _count("indicator_support_reports") == 0
        ok = _report(c, source="a" * svc.MAX_SOURCE_BYTES)
        assert ok.status_code == 200

    def test_note_and_link_caps(self, app, monkeypatch):
        monkeypatch.setenv(svc.FLAG_ENV, "1")
        c = client_as(app, ALICE)
        assert _report(c, note="n" * (svc.MAX_NOTE_CHARS + 1)).status_code == 422
        assert _report(c, tradingview_link="https://evil.example.com/x").status_code == 422
        assert _count("indicator_support_reports") == 0

    def test_a_repeat_of_the_same_script_is_not_stored_twice(self, app, monkeypatch):
        monkeypatch.setenv(svc.FLAG_ENV, "1")
        c = client_as(app, ALICE)
        first = _report(c).json()
        again = _report(c, source=SCRIPT.replace("\n", "\r\n")).json()
        assert again["duplicate"] is True and again["id"] == first["id"]
        assert _count("indicator_support_reports") == 1


# ─── retention ───────────────────────────────────────────────────────────────

class TestRetention:
    def test_closed_30_days_and_any_365_days(self, monkeypatch):
        monkeypatch.setenv(svc.FLAG_ENV, "1")
        t0 = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
        fixed = svc.create_report("u1", consent=True, source="a", now=t0)["id"]
        open_ = svc.create_report("u1", consent=True, source="b", now=t0)["id"]
        svc.admin_set_status(fixed, "fixed", now=t0)
        assert svc.purge_expired(t0 + dt.timedelta(days=29)) == 0
        assert svc.purge_expired(t0 + dt.timedelta(days=31)) == 1
        assert svc.admin_get_report(fixed) is None and svc.admin_get_report(open_) is not None
        assert svc.purge_expired(t0 + dt.timedelta(days=366)) == 1
        assert _count("indicator_support_reports") == 0


def test_router_is_mounted_and_rate_family_declared():
    from api.main import app as real_app
    from api import rate_limit_policy as rlp
    paths = {getattr(r, "path", "") for r in real_app.routes}
    assert "/api/indicator-support/reports" in paths
    assert "/api/indicator-support/gaps" in paths
    assert any("/api/indicator-support" in f.prefixes for f in rlp.FAMILIES.values())


def test_stored_gap_list_is_json_of_allowlisted_pairs(monkeypatch):
    monkeypatch.setenv(svc.FLAG_ENV, "1")
    r = svc.create_report("u1", consent=True, source="z", gaps=[
        {"name": "secretVar", "kind": "name-unknown"}, {"name": "ta.kc", "kind": "call-unmapped"}])
    full = svc.admin_get_report(r["id"])
    assert full["gaps"] == [{"name": "ta.kc", "kind": "call-unmapped"},
                            {"name": svc.UNLISTED, "kind": "call-unmapped"}]
    assert "secretVar" not in json.dumps(full["gaps"])


# ─── follow-up: the member key, and gap retention ────────────────────────────

class TestMemberKey:
    """`indicator_gap_hits` holds HMAC(PUSH_SECRET, member id), never the id."""

    def test_no_raw_user_id_is_stored(self, monkeypatch, db):
        monkeypatch.setenv("PUSH_SECRET", "test-secret-1")
        uid = "u-raw-identifiable-7f3a"
        svc.record_gaps(uid, [{"name": "ta.sma", "kind": "call-unmapped"}], 1)
        rows = _gap_rows()
        assert rows, "control: rows were written"
        assert all(r[3] == svc.member_key(uid) and r[3] != uid for r in rows)
        # ⛔ and the id appears NOWHERE in the database file's table
        conn = auth_db.get_connection()
        try:
            dump = chr(10).join(conn.iterdump())
        finally:
            conn.close()
        gap_lines = [ln for ln in dump.splitlines() if "indicator_gap_hits" in ln]
        assert gap_lines and not any(uid in ln for ln in gap_lines)

    def test_the_key_is_keyed_by_the_secret(self, monkeypatch):
        monkeypatch.setenv("PUSH_SECRET", "secret-a")
        a = svc.member_key("u1")
        monkeypatch.setenv("PUSH_SECRET", "secret-b")
        assert svc.member_key("u1") != a
        import hashlib
        assert a != hashlib.sha256(b"u1").hexdigest()

    def test_same_member_on_two_days_counts_as_one(self, monkeypatch):
        monkeypatch.setenv("PUSH_SECRET", "s")
        g = [{"name": "ta.supertrend", "kind": "name-unknown"}]
        today = svc._now()
        svc.record_gaps("u1", g, day=today.strftime("%Y-%m-%d"))
        svc.record_gaps("u1", g, day=(today - dt.timedelta(days=3)).strftime("%Y-%m-%d"))
        row = {(r["name"], r["kind"]): r for r in svc.gap_ranking(30)}[("ta.supertrend", "name-unknown")]
        assert row["members"] == 1 and row["hits"] == 2 and row["days_seen"] == 2

    def test_two_members_count_as_two(self, monkeypatch):
        monkeypatch.setenv("PUSH_SECRET", "s")
        g = [{"name": "ta.supertrend", "kind": "name-unknown"}]
        svc.record_gaps("u1", g)
        svc.record_gaps("u2", g)
        row = svc.gap_ranking(30)[0]
        assert row["members"] == 2

    def test_the_daily_cap_still_applies_per_member(self, monkeypatch):
        monkeypatch.setenv("PUSH_SECRET", "s")
        g = [{"name": "ta.rci", "kind": "name-unknown"}]
        for _ in range(svc.HITS_CAP_PER_DAY + 7):
            svc.record_gaps("u1", g)
        svc.record_gaps("u2", g)
        row = svc.gap_ranking(30)[0]
        assert row["hits"] == svc.HITS_CAP_PER_DAY + 1 and row["members"] == 2

    def test_an_old_raw_id_table_is_replaced(self):
        conn = auth_db.get_connection()
        try:
            conn.execute("CREATE TABLE indicator_gap_hits (day TEXT, name TEXT, kind TEXT,"
                         " user_id TEXT, hits INTEGER, PRIMARY KEY (day, name, kind, user_id))")
            conn.execute("INSERT INTO indicator_gap_hits VALUES ('2026-10-30','ta.sma','name-unknown','u-raw',1)")
            conn.commit()
        finally:
            conn.close()
        svc.record_gaps("u1", [{"name": "ta.sma", "kind": "name-unknown"}])
        rows = _gap_rows()
        assert len(rows) == 1 and rows[0][3] != "u-raw"


class TestGapRetention:
    def test_purge_removes_rows_older_than_400_days_and_keeps_recent(self):
        now = dt.datetime(2026, 10, 30, 12, tzinfo=dt.timezone.utc)
        g = [{"name": "ta.sma", "kind": "name-unknown"}]
        old = (now - dt.timedelta(days=svc.GAP_RETAIN_DAYS + 1)).strftime("%Y-%m-%d")
        edge = (now - dt.timedelta(days=svc.GAP_RETAIN_DAYS)).strftime("%Y-%m-%d")
        recent = (now - dt.timedelta(days=5)).strftime("%Y-%m-%d")
        for d in (old, edge, recent):
            svc.record_gaps("u1", g, day=d)
        assert len(_gap_rows()) == 3
        assert svc.purge_gap_hits(now) == 1
        assert sorted(r[0] for r in _gap_rows()) == [edge, recent]

    def test_retention_runs_where_report_retention_runs(self, monkeypatch):
        old = (svc._now() - dt.timedelta(days=svc.GAP_RETAIN_DAYS + 10)).strftime("%Y-%m-%d")
        svc.record_gaps("u1", [{"name": "ta.sma", "kind": "name-unknown"}], day=old)
        svc.record_gaps("u1", [{"name": "ta.rsi", "kind": "name-unknown"}])
        monkeypatch.setenv(svc.FLAG_ENV, "1")
        svc.create_report("u9", consent=True, source="x")
        assert [r[1] for r in _gap_rows()] == ["ta.rsi"]
