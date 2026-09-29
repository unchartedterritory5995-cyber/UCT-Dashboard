"""TERM-062 / FB-S7-02 -- publish the cooldowns.

WHAT THIS FILE EXISTS TO MAKE IMPOSSIBLE
----------------------------------------
1. A PUBLISHED COOLDOWN THAT IS NOT THE ONE THE CODE APPLIES. Every value in
   `cooldowns.published_cooldowns()` is read from the constant the alert code
   itself uses, at call time. The rails below MOVE each constant and require the
   published value to move with it -- and, the other half, require the scheduler
   in `api/main.py` and the sweep in `document_arrival` to be built FROM those
   constants, so the constant is not a third copy nobody consumes
   (`lesson_a_comment_claiming_agreement_is_not_agreement`).
2. A NEW MEMBER-FACING TRIGGER TYPE SHIPPING WITHOUT A PUBLISHED COOLDOWN. The
   set of types with a member create route is DERIVED from the router, and must
   equal the published set.
3. THE DROPPED CROSS-MEMBER COUNT COMING BACK. A pre-save fire-frequency count
   over every member's watches was built and then dropped by owner ruling
   2026-09-29 (privacy: it told a member whether anyone on UCT watched a ticker).
   No alert-taxonomy route may answer it, and the cooldown module reads no member
   record at all.
"""
from __future__ import annotations

import ast
import os

import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient

from api.services.alert_taxonomy import cooldowns
from api.services.alert_taxonomy import db as at_db
from api.services.alert_taxonomy import delivery
from api.services.alert_taxonomy import document_arrival as da
from api.services.alert_taxonomy import predicates, receipts
from api.services.entity_master import schema as em_schema
from api.services.entity_master import store as em_store

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture(autouse=True)
def _isolated_dbs(tmp_path, monkeypatch):
    monkeypatch.setattr(at_db, "DB_PATH", str(tmp_path / "alert_taxonomy.db"))
    em_db_path = str(tmp_path / "em_default.db")
    monkeypatch.setattr(em_schema, "DB_PATH", em_db_path)
    em_store._local.conns = {}
    em_store._ALIAS_CACHE.clear()
    em_store._CACHE_LOADED = False
    em_schema.init_db(db_path=em_db_path)
    da.register()
    yield
    em_store._local.conns = {}
    em_store._ALIAS_CACHE.clear()
    em_store._CACHE_LOADED = False


@pytest.fixture(autouse=True)
def _no_real_delivery(monkeypatch):
    calls = []

    def fake(**kwargs):
        calls.append(kwargs)
        return {"claimed": True, "channels": {"in_app": "ok"}, "channels_ok": 1,
                "channels_failed": 0, "errors": {}}

    monkeypatch.setattr(delivery.watchlist_alert_service, "deliver_alert_payload", fake)
    return calls


def _entry(type_id=da.TYPE_ID):
    matches = [e for e in cooldowns.published_cooldowns() if e["type_id"] == type_id]
    assert len(matches) == 1, f"expected one published entry for {type_id}, got {matches}"
    return matches[0]


def _filing(accession, form="8-K", filed="2026-09-01"):
    return {"form": form, "filed": filed, "period": "", "accession": accession,
            "url": "https://sec.gov/x"}


def _filings(*accessions):
    return {"ticker": "AAPL", "company": "Apple Inc.", "cik": "1", "form_filter": "ANY",
            "count": len(accessions), "filings": [_filing(a) for a in accessions]}


# ─────────────────────────────────────────────────────────────────────────────
# 1. THE PUBLISHED VALUE IS THE APPLIED VALUE
# ─────────────────────────────────────────────────────────────────────────────

class TestPublishedIsDerived:
    def test_check_interval_is_the_sweep_constant_and_moves_with_it(self, monkeypatch):
        monkeypatch.setenv(da.SWEEP_FLAG, "1")
        assert _entry()["check_every_minutes"] == da.SWEEP_EVERY_MINUTES
        monkeypatch.setattr(da, "SWEEP_EVERY_MINUTES", 15)
        moved = _entry()
        assert moved["check_every_minutes"] == 15
        assert "every 15 minutes" in moved["sentence"]

    def test_the_real_interval_divides_the_hour(self):
        # `CronTrigger(minute="*/N")` restarts at :00, so "every N minutes" is only
        # TRUE when N divides 60 (*/7 fires :56 then :00, a 4-minute gap). The
        # published sentence depends on it.
        assert 60 % da.SWEEP_EVERY_MINUTES == 0

    def test_rearm_grain_is_the_field_the_fire_key_is_built_from(self, monkeypatch):
        assert _entry()["rearm_grain"] == da.FIRE_KEY_GRAIN
        monkeypatch.setattr(da, "FIRE_KEY_GRAIN", "form")
        assert _entry()["rearm_grain"] == "form"
        # and the fire key itself follows the same constant -- one authority
        assert da.fire_key_for(_filing("acc-9", form="10-Q")) == "occ:10-Q"

    def test_max_alerts_per_check_moves_with_its_constant(self, monkeypatch):
        monkeypatch.setenv(da.SWEEP_FLAG, "1")
        assert _entry()["max_alerts_per_check"] == da.MAX_FIRES_PER_SWEEP
        monkeypatch.setattr(da, "MAX_FIRES_PER_SWEEP", 3)
        moved = _entry()
        assert moved["max_alerts_per_check"] == 3
        assert "you get 3 alerts" in moved["sentence"]

    def test_a_paused_sweep_is_published_as_paused_never_as_a_cadence(self, monkeypatch):
        monkeypatch.setenv(da.SWEEP_FLAG, "0")
        paused = _entry()
        assert paused["checking"] is False
        assert paused["check_every_minutes"] is None
        assert "paused" in paused["sentence"]
        assert "minutes" not in paused["sentence"]
        monkeypatch.delenv(da.SWEEP_FLAG, raising=False)
        assert _entry()["checking"] is False     # unset == off, the flag's own default


class TestTheCodeAppliesThePublishedValue:
    """The other half: a constant nobody consumes is a published TYPO."""

    def _main_tree(self):
        with open(os.path.join(ROOT, "api", "main.py"), encoding="utf-8") as fh:
            return ast.parse(fh.read())

    def _sweep_add_job(self, tree):
        for node in ast.walk(tree):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "add_job"):
                for kw in node.keywords:
                    if (kw.arg == "id" and isinstance(kw.value, ast.Constant)
                            and kw.value.value == "alert_taxonomy_document_arrival"):
                        return node
        return None

    @staticmethod
    def _names(node):
        out = set()
        for n in ast.walk(node):
            if isinstance(n, ast.Name):
                out.add(n.id)
            elif isinstance(n, ast.Attribute):
                out.add(n.attr)
        return out

    def test_main_schedules_the_sweep_from_the_published_interval(self):
        call = self._sweep_add_job(self._main_tree())
        assert call is not None, "the document-arrival add_job is gone -- re-derive this rail"
        trigger = next(kw.value for kw in call.keywords if kw.arg == "trigger")
        minute = next((kw.value for kw in trigger.keywords if kw.arg == "minute"), None)
        assert minute is not None
        assert not isinstance(minute, ast.Constant), (
            "the sweep cadence is a string literal in api/main.py -- the published "
            "check_every_minutes would be a second authority over it")
        assert "SWEEP_EVERY_MINUTES" in self._names(minute)

    def test_main_gates_the_sweep_on_the_published_flag_reader(self):
        tree = self._main_tree()
        call = self._sweep_add_job(tree)
        guards = [n for n in ast.walk(tree) if isinstance(n, ast.If)
                  and any(c is call for b in n.body for c in ast.walk(b))]
        assert guards, "the sweep add_job is not under an if -- re-derive this rail"
        innermost = guards[-1]
        assert "sweep_enabled" in self._names(innermost.test), (
            "api/main.py decides whether the sweep runs by something other than "
            "document_arrival.sweep_enabled() -- the published 'checking' would lie")

    def test_several_filings_between_checks_fire_exactly_the_published_maximum(self, monkeypatch):
        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=10: _filings("acc-0"))
        pid = da.register_predicate_for_user("u1", "AAPL")
        # three filings landed since the baseline, newest first
        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=5: _filings("acc-3", "acc-2", "acc-1", "acc-0"))
        result = da.run_document_arrival_sweep()
        fires = receipts.fires_for_predicate(pid)
        assert result["fired"] == len(fires) == da.MAX_FIRES_PER_SWEEP
        assert fires[0]["fire_key"] == da.fire_key_for(_filing("acc-3"))
        assert _entry()["rearm_grain"] == "accession"

    def test_the_same_filing_never_alerts_twice(self, monkeypatch):
        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=10: _filings("acc-0"))
        pid = da.register_predicate_for_user("u1", "AAPL")
        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=5: _filings("acc-1"))
        da.run_document_arrival_sweep()
        predicates.update_last_seen_state(pid, {"accession": "acc-0"})   # a rewound watermark
        second = da.run_document_arrival_sweep()
        assert second["fired"] == 0
        assert len(receipts.fires_for_predicate(pid)) == 1


# ─────────────────────────────────────────────────────────────────────────────
# 4. COMPLETENESS -- derived from the router, with a control
# ─────────────────────────────────────────────────────────────────────────────

class TestEveryMemberTypeIsPublished:
    def test_the_published_set_is_the_member_create_route_set(self):
        from api.routers import alert_taxonomy as router_mod
        member = cooldowns.member_create_type_ids(router_mod.router.routes)
        assert member, "derived no member create routes -- the derivation is broken"
        assert member == {e["type_id"] for e in cooldowns.published_cooldowns()}

    def test_the_derivation_sees_a_new_create_route(self):
        r = APIRouter()

        @r.post("/api/alerts/taxonomy/document-arrival")
        def _a():  # pragma: no cover
            return {}

        @r.post("/api/alerts/taxonomy/price-level")
        def _b():  # pragma: no cover
            return {}

        @r.get("/api/alerts/taxonomy/price-level")
        def _c():  # pragma: no cover
            return {}

        @r.post("/api/admin/alerts/taxonomy/run-document-arrival-sweep")
        def _d():  # pragma: no cover
            return {}

        assert cooldowns.member_create_type_ids(r.routes) == {"document-arrival", "price-level"}


# ─────────────────────────────────────────────────────────────────────────────
# THE ROUTES
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def member_client():
    from api.main import app
    from api.middleware.auth_middleware import get_current_user
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1", "role": "member"}
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


class TestRoutes:
    def test_cooldowns_requires_auth(self):
        from api.main import app
        r = TestClient(app).get("/api/alerts/taxonomy/cooldowns")
        assert r.status_code in (401, 403)

    def test_cooldowns_route_publishes_the_register(self, member_client, monkeypatch):
        monkeypatch.setenv(da.SWEEP_FLAG, "1")
        r = member_client.get("/api/alerts/taxonomy/cooldowns")
        assert r.status_code == 200
        body = r.json()
        assert body == {"cooldowns": cooldowns.published_cooldowns()}

    def test_the_watch_list_carries_the_published_cooldown(self, member_client, monkeypatch):
        monkeypatch.setenv(da.SWEEP_FLAG, "1")
        r = member_client.get("/api/alerts/taxonomy/document-arrival?active_only=false")
        assert r.status_code == 200
        assert r.json()["cooldown"] == _entry()


class TestTheDroppedCountStaysDropped:
    """Owner ruling 2026-09-29: the cross-member fire-frequency count is gone."""

    def test_no_alert_taxonomy_route_answers_a_frequency_question(self):
        from api.main import app
        taxonomy = [r.path for r in app.routes
                    if getattr(r, "path", "").startswith("/api/alerts/taxonomy/")]
        assert "/api/alerts/taxonomy/cooldowns" in taxonomy, \
            "derived no taxonomy routes -- re-derive this rail"
        assert not [p for p in taxonomy if "frequen" in p], taxonomy

    def test_the_cooldown_module_reads_no_member_record(self):
        with open(cooldowns.__file__, encoding="utf-8") as fh:
            tree = ast.parse(fh.read())
        imported = {a.name for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)
                    for a in n.names}
        assert "document_arrival" in imported, "control: the import walk sees nothing"
        assert not ({"db", "receipts", "predicates"} & imported), imported
        assert not hasattr(cooldowns, "fire_frequency")
