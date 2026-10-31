"""Pine support loop, Phase B: the server rails (``docs/pine/support-loop/PHASE-B.md``).

Digest correctness (fixed gaps drop off, no member content), the once-a-day cache and
post, and the two gates: the admin route and the PUSH_SECRET machine door.
"""
from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user
from api.routers import indicator_support as router_mod
from api.services import auth_db
from api.services import indicator_support as svc
from api.services import indicator_support_loop as loop

SECRET = "test-push-secret-6f1d"
ADMIN = {"id": "u-admin", "role": "admin", "email": "admin@test"}
MEMBER = {"id": "u-member", "role": "user", "email": "m@test"}
SOURCE_SENTINEL = "secretLevelZ9 = ta.alma(close, 9, 0.85, 6)"
NOTE_SENTINEL = "my private note QX7"

MANIFEST = {
    "version": 1, "counts": {},
    "names": {
        "ta.alma": {"status": "name-unknown", "guard": "pine:function"},
        "ta.supertrend": {"status": "reachable", "probe": "ta.supertrend(close, 14)"},
        "request.security": {"status": "call-unmapped", "guard": "pine:request"},
        "array.get": {"status": "call-unmapped", "guard": "pine:collection"},
        "ta.kc": {"status": "unprobed"},
    },
    "fixes": [{"name": "array.get", "kind": "call-unmapped", "probe": "...", "status": "fixed"},
              {"name": "request.security", "kind": "call-unmapped", "probe": "...", "status": "open"}],
}


@pytest.fixture(autouse=True)
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth_test.db"))
    auth_db.init_db()
    monkeypatch.setenv(svc.FLAG_ENV, "1")
    monkeypatch.delenv(svc.GAP_LOG_OFF_ENV, raising=False)
    monkeypatch.delenv(loop.POST_OFF_ENV, raising=False)
    monkeypatch.setenv("PUSH_SECRET", SECRET)
    mp = tmp_path / "doorNameCoverage.json"
    mp.write_text(json.dumps(MANIFEST), encoding="utf-8")
    monkeypatch.setattr(loop, "DOOR_MANIFEST_PATH", mp)
    return tmp_path


def _seed():
    # ta.alma: 3 members; ta.supertrend (name-unknown, now reachable): 2;
    # array.get (call-unmapped, fixed by ledger): 2; request.security (call-unmapped,
    # door knows it, ledger says open): 1; ta.kc unprobed: 1; an unlisted name: 1.
    for u in ("a", "b", "c"):
        svc.record_gaps(f"u-{u}", [{"name": "ta.alma", "kind": "name-unknown"}])
    for u in ("a", "b"):
        svc.record_gaps(f"u-{u}", [{"name": "ta.supertrend", "kind": "name-unknown"},
                                   {"name": "array.get", "kind": "call-unmapped"}])
    svc.record_gaps("u-a", [{"name": "request.security", "kind": "call-unmapped"},
                            {"name": "ta.kc", "kind": "name-unknown"}], unlisted=1)
    rep = svc.create_report("u-reporter", consent=True, source=SOURCE_SENTINEL, note=NOTE_SENTINEL,
                            tradingview_link="https://www.tradingview.com/script/abc/",
                            symbol="AAPL", timeframe="D",
                            gaps=[{"name": "ta.alma", "kind": "name-unknown"}])
    return rep["id"]


# ─── digest correctness ──────────────────────────────────────────────────────

class TestDigest:
    def test_fixed_gaps_drop_off_and_open_ones_rank_by_members(self):
        _seed()
        d = loop.build_digest()
        open_names = [(g["name"], g["kind"]) for g in d["gaps"]["open"]]
        fixed = {(g["name"], g["kind"]) for g in d["gaps"]["fixed_on_master"]}
        assert open_names[0] == ("ta.alma", "name-unknown")           # 3 members, ranks first
        assert d["gaps"]["open"][0]["rank"] == 1 and d["gaps"]["open"][0]["members"] == 3
        # name-unknown + the door now serves it -> fixed; call-unmapped + passing ledger repro -> fixed
        assert fixed == {("ta.supertrend", "name-unknown"), ("array.get", "call-unmapped")}
        # the door KNOWS request.security, but a name probe never closes a call-unmapped gap
        assert ("request.security", "call-unmapped") in open_names
        assert ("ta.kc", "name-unknown") in open_names                # unprobed reads OPEN
        assert all(not g["fixed_on_master"] for g in d["gaps"]["open"])
        assert svc.UNLISTED not in {n for n, _ in open_names}
        assert d["gaps"]["unlisted"]["members"] == 1
        assert d["gaps"]["open_total"] == 3

    def test_an_unreadable_manifest_fixes_nothing(self, db, monkeypatch):
        _seed()
        monkeypatch.setattr(loop, "DOOR_MANIFEST_PATH", db / "missing.json")
        d = loop.build_digest()
        assert d["gaps"]["fixed_on_master"] == []
        assert d["door_manifest"]["sha"] == "unreadable"

    def test_the_digest_carries_no_member_content_and_no_member_id(self):
        rid = _seed()
        d = loop.build_digest()
        blob = json.dumps(d)
        for forbidden in (SOURCE_SENTINEL, NOTE_SENTINEL, "u-reporter", "tradingview.com/script/abc",
                          svc.member_key("u-a")):
            assert forbidden not in blob
        r = d["reports"]["open"][0]
        assert r["id"] == rid and r["has_note"] is True and r["has_link"] is True
        assert "source" not in r and "note" not in r and "reporter" not in r
        assert d["reports"]["counts"] == {"new": 1, "triaged": 0}

    def test_closed_reports_leave_the_digest(self):
        rid = _seed()
        svc.admin_set_status(rid, "fixed")
        assert loop.build_digest()["reports"]["open"] == []

    def test_built_once_per_day_and_rebuilt_when_the_door_changes(self, db, monkeypatch):
        _seed()
        first = loop.daily_digest()
        svc.record_gaps("u-z", [{"name": "ta.alma", "kind": "name-unknown"}])
        assert loop.daily_digest() == first                 # cached: same day, same manifest
        m = dict(MANIFEST, names=dict(MANIFEST["names"], **{"ta.alma": {"status": "reachable"}}))
        (db / "doorNameCoverage.json").write_text(json.dumps(m), encoding="utf-8")
        again = loop.daily_digest()                         # a deploy changed the door
        assert "ta.alma" in {g["name"] for g in again["gaps"]["fixed_on_master"]}
        assert "ta.alma" not in {g["name"] for g in again["gaps"]["open"]}


class TestFixedRule:
    @pytest.mark.parametrize("name,kind,want", [
        ("ta.supertrend", "name-unknown", True), ("request.security", "name-unknown", True),
        ("ta.alma", "name-unknown", False), ("ta.kc", "name-unknown", False),
        ("ta.unheard", "name-unknown", False), (svc.UNLISTED, "call-unmapped", False),
        ("array.get", "call-unmapped", True), ("request.security", "call-unmapped", False),
        ("ta.supertrend", "call-unmapped", False),
    ])
    def test_every_uncertainty_resolves_open(self, name, kind, want):
        assert loop.fixed_on_master(MANIFEST, name, kind) is want

    def test_none_manifest_fixes_nothing(self):
        assert loop.fixed_on_master(None, "ta.supertrend", "name-unknown") is False

    def test_the_committed_manifest_covers_the_whole_allowlist(self):
        real = json.loads(loop.svc.ALLOWLIST_PATH.parent.joinpath("doorNameCoverage.json")
                          .read_text(encoding="utf-8"))
        assert set(real["names"]) == set(svc.PINE_BUILTINS)
        assert {v["status"] for v in real["names"].values()} <= {
            "reachable", "call-unmapped", "name-unknown", "unprobed"}
        assert real["names"]["ta.sma"]["status"] == "reachable"   # control


class TestPost:
    def test_posts_once_a_day_names_and_counts_only(self, monkeypatch):
        _seed()
        sent = []
        from api.services import discord_notify
        monkeypatch.setattr(discord_notify, "_send_webhook", lambda embed, url=None: sent.append(embed))
        assert loop.run_daily_digest()["posted"] is True
        assert loop.run_daily_digest() == {"ok": True, "posted": False, "reason": "already-posted"}
        assert len(sent) == 1
        text = json.dumps(sent[0])
        assert "ta.alma" in text and "1 new" in text
        for forbidden in (SOURCE_SENTINEL, NOTE_SENTINEL, "u-reporter", SECRET):
            assert forbidden not in text

    def test_off_switch_and_nothing_to_act_on(self, monkeypatch):
        sent = []
        from api.services import discord_notify
        monkeypatch.setattr(discord_notify, "_send_webhook", lambda embed, url=None: sent.append(embed))
        assert loop.run_daily_digest()["reason"] == "nothing-to-act-on"
        _seed()
        loop.daily_digest(refresh=True)
        monkeypatch.setenv(loop.POST_OFF_ENV, "off")
        assert loop.run_daily_digest()["reason"] == "post-off"
        assert sent == []


# ─── the gates ───────────────────────────────────────────────────────────────

@pytest.fixture
def app():
    a = FastAPI()
    a.include_router(router_mod.router)
    a.include_router(router_mod.internal_router)
    return a


def _bearer(v):
    return {"Authorization": f"Bearer {v}"}


INTERNAL = [("get", "/api/internal/indicator-support/digest", None),
            ("get", "/api/internal/indicator-support/reports", None),
            ("get", "/api/internal/indicator-support/reports/{rid}", None),
            ("patch", "/api/internal/indicator-support/reports/{rid}", {"status": "triaged"})]


class TestGates:
    @pytest.mark.parametrize("method,path,body", INTERNAL)
    def test_machine_door_refuses_without_the_bearer(self, app, monkeypatch, method, path, body):
        rid = _seed()
        c = TestClient(app)
        url = path.format(rid=rid)
        kw = {"json": body} if body else {}
        for headers in ({}, _bearer("wrong"), {"Authorization": SECRET}, _bearer(SECRET + "x"),
                        {"Authorization": "Bearer café".encode("latin-1")}):
            r = getattr(c, method)(url, headers=headers, **kw)
            assert r.status_code == 401, (headers, r.status_code)
            assert SECRET not in r.text
        monkeypatch.setenv("PUSH_SECRET", "")
        assert getattr(c, method)(url, headers=_bearer(""), **kw).status_code == 401   # fail CLOSED
        assert svc.admin_get_report(rid)["status"] == "new"                            # nothing changed

    def test_machine_door_with_the_bearer(self, app):
        rid = _seed()
        c = TestClient(app)
        h = _bearer(SECRET)
        d = c.get("/api/internal/indicator-support/digest", headers=h).json()
        assert d["gaps"]["open"][0]["name"] == "ta.alma"
        lst = c.get("/api/internal/indicator-support/reports", headers=h).json()["reports"]
        assert SOURCE_SENTINEL not in json.dumps(lst) and NOTE_SENTINEL not in json.dumps(lst)
        one = c.get(f"/api/internal/indicator-support/reports/{rid}", headers=h).json()
        assert one["source"] == SOURCE_SENTINEL and one["note"] == NOTE_SENTINEL
        assert "reporter" not in one and "u-reporter" not in json.dumps(one)
        assert c.patch(f"/api/internal/indicator-support/reports/{rid}", headers=h,
                       json={"status": "nonsense"}).status_code == 422
        assert c.patch(f"/api/internal/indicator-support/reports/{'0' * 32}", headers=h,
                       json={"status": "fixed"}).status_code == 404
        assert c.patch(f"/api/internal/indicator-support/reports/{rid}", headers=h,
                       json={"status": "triaged"}).json() == {"ok": True, "status": "triaged"}
        assert svc.admin_get_report(rid)["status"] == "triaged"

    def test_admin_digest_is_admin_only(self, app):
        _seed()
        app.dependency_overrides[get_current_user] = lambda: MEMBER
        assert TestClient(app).get("/api/indicator-support/digest").status_code == 403
        app.dependency_overrides[get_current_user] = lambda: ADMIN
        assert TestClient(app).get("/api/indicator-support/digest").json()["gaps"]["open_total"] == 3

    def test_the_machine_door_is_read_only_plus_status(self):
        routes = {(tuple(sorted(r.methods)), r.path) for r in router_mod.internal_router.routes}
        assert routes == {
            (("GET",), "/api/internal/indicator-support/digest"),
            (("GET",), "/api/internal/indicator-support/reports"),
            (("GET",), "/api/internal/indicator-support/reports/{report_id}"),
            (("PATCH",), "/api/internal/indicator-support/reports/{report_id}"),
        }
        for r in router_mod.internal_router.routes:
            names = {d.call.__name__ for d in r.dependant.dependencies}
            assert "require_push_secret" in names, r.path
