"""The TSDR trader archive for PAID MEMBERS and in-app tools (owner ruling 2026-10-15).

SYNTHETIC data only — the repo is public.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a member read answering an unpaid member (must be 402) or anyone at all with the flag off (404);
2. the member routes not being require_paid, or not being mounted through the wisdom registry;
3. the flag being admin/internal again (it is member-visible and declared so in the ledger);
4. Ask AI carrying a TRADER ARCHIVE block while the flag is off, or touching wisdom.db to decide;
5. the block being unbounded, uncited, or missing the scored outcome;
(The Compass tools are railed in tests/test_trader_archive_compass_tools.py.)
"""
from __future__ import annotations

import json
import pathlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import wisdom_archive
from api.services.wisdom.archive import askai as archive_askai
from api.services.wisdom.archive import tools as archive_tools
from api.services.wisdom.core import flags, store
from tests.authclients import ADMIN, FREE_MEMBER, PAID_MEMBER, authorize

REPO = pathlib.Path(__file__).resolve().parents[1]
SECRET = "s3cret-archive-member-test"
BATCH = "/api/internal/wisdom/archive/batch"
AUTH = {"Authorization": f"Bearer {SECRET}"}
MEMBER_GETS = ("/api/wisdom/archive/ticker/ZZTA", "/api/wisdom/archive/setup/synthetic_setup",
               "/api/wisdom/archive/search?q=breakout", "/api/wisdom/archive/stats",
               "/api/wisdom/archive/trader/tsdr")


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")
    monkeypatch.setenv("PUSH_SECRET", SECRET)


def _app():
    a = FastAPI()
    a.include_router(wisdom_archive.member_router)
    a.include_router(wisdom_archive.internal_router)
    return a


def _client(user):
    app = _app()
    if user is not None:
        authorize(app, user)
    return TestClient(app, raise_server_exceptions=False)


def _seed():
    c = _client(None)
    recs = [
        {"record_id": "t9101", "author_id": "tsdr", "stated_date": "2025-01-02", "record_type": "CALL",
         "tickers": ["ZZTA"], "note": "synthetic pivot breakout on rising volume", "quote": "", "image_count": 0},
        {"record_id": "t9102", "author_id": "bracco", "stated_date": "2025-03-04", "record_type": "LESSON",
         "tickers": [], "note": "synthetic lesson about patience in a breakout", "quote": "", "image_count": 0},
    ]
    calls = [
        {"call_id": "t9101#0", "record_id": "t9101", "author_id": "tsdr", "ticker": "ZZTA", "direction": "long",
         "setup": "synthetic_setup", "posted": "2025-01-02T14:00:00", "entry": 10.0, "stop": 9.0,
         "outcome": {"r5": 0.02, "r20": 0.10, "status": "scored"}},
    ]
    assert c.post(BATCH, json={"kind": "records", "items": recs}, headers=AUTH).json()["inserted"] == 2
    assert c.post(BATCH, json={"kind": "calls", "items": calls}, headers=AUTH).json()["inserted"] == 1


# ── 1. the paid gate and the flag ────────────────────────────────────────────

def test_an_unpaid_member_gets_402_and_a_paid_member_200(wisdom_db, on):
    _seed()
    free = _client(FREE_MEMBER)
    for path in MEMBER_GETS:
        r = free.get(path)
        assert r.status_code == 402, (path, r.status_code)
        assert r.json()["detail"] == "The trader archive requires a paid plan"
    paid = _client(PAID_MEMBER)
    for path in MEMBER_GETS:
        assert paid.get(path).status_code == 200, path                       # control
    assert _client(ADMIN).get(MEMBER_GETS[0]).status_code == 200              # admins are paid too


def test_an_anonymous_caller_is_refused_never_served(wisdom_db, on):
    anon = _client(None)
    for path in MEMBER_GETS:
        assert anon.get(path).status_code in (401, 403), path


@pytest.mark.parametrize("raw", ["0", "", "false", "off"])
def test_flag_off_is_404_for_a_paid_member_on_every_route(wisdom_db, on, monkeypatch, raw):
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", raw)
    paid = _client(PAID_MEMBER)
    for path in MEMBER_GETS:
        assert paid.get(path).status_code == 404, path
    # and the unpaid answer does not leak the flag: still 402, checked before the flag
    assert _client(FREE_MEMBER).get(MEMBER_GETS[0]).status_code == 402


def test_payloads_carry_trader_names_summaries_and_outcomes(wisdom_db, on):
    _seed()
    paid = _client(PAID_MEMBER)
    t = paid.get("/api/wisdom/archive/ticker/zzta").json()
    assert t["ticker"] == "ZZTA" and t["n_calls"] == 1 and t["n_scored"] == 1
    assert abs(t["mean_r20"] - 0.10) < 1e-9
    assert t["records"][0]["trader"] and t["calls"][0]["outcome"]["r20"] == 0.10
    tr = paid.get("/api/wisdom/archive/trader/tsdr").json()
    assert tr["author"] == "tsdr" and tr["n_records"] == 1 and tr["n_calls"] == 1 and tr["trader"]
    assert [r["record_id"] for r in tr["records"]] == ["t9101"]
    stats = paid.get("/api/wisdom/archive/stats").json()
    assert set(stats["traders"]) == {"tsdr", "bracco"}
    assert paid.get("/api/wisdom/archive/trader/not-a-trader").status_code == 422


# ── 2. wiring ────────────────────────────────────────────────────────────────

def _dep_names(route) -> set:
    names, stack = set(), [route.dependant]
    while stack:
        d = stack.pop()
        if d.call is not None:
            names.add(getattr(d.call, "__name__", ""))
        stack.extend(d.dependencies)
    return names


def test_every_member_route_is_require_paid_and_the_registry_mounts_it():
    from api.services.wisdom import registry

    paths = {r.path for r in wisdom_archive.member_router.routes}
    assert paths == {"/api/wisdom/archive/ticker/{sym}", "/api/wisdom/archive/setup/{setup}",
                     "/api/wisdom/archive/search", "/api/wisdom/archive/stats",
                     "/api/wisdom/archive/trader/{author}"}
    for r in wisdom_archive.member_router.routes:
        deps = _dep_names(r)
        assert "require_paid" in deps, r.path
        assert "require_admin" not in deps, r.path                           # not over-gated to admin
    assert "/api/wisdom/archive" in {r.prefix for r in registry.routers()}


# ── 3. the flag is member-visible, default off, declared ─────────────────────

def test_the_flag_is_member_visible_default_off_and_declared_with_an_owner_decision(monkeypatch):
    monkeypatch.delenv("WISDOM_ARCHIVE_ENABLED", raising=False)
    assert flags.archive_enabled() is False
    row = next(g for g in flags.GATES if g[0] == "WISDOM_ARCHIVE_ENABLED")
    assert row[2] is True
    assert not any(g[0] == "WISDOM_ARCHIVE_ADMIN_ENABLED" for g in flags.GATES)
    ledger = json.loads((REPO / "docs" / "feature_flags.json").read_text(encoding="utf-8"))["flags"]
    entry = ledger["WISDOM_ARCHIVE_ENABLED"]
    assert entry["exposure"] == "members" and entry["status"] == "dark"
    assert "2026-10-15" in entry["owner_decision"]
    assert "WISDOM_ARCHIVE_ADMIN_ENABLED" not in ledger


# ── 4-5. Ask AI ──────────────────────────────────────────────────────────────

def test_ask_ai_block_is_absent_with_the_flag_off_and_never_opens_the_store(monkeypatch):
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "0")

    def boom(*a, **k):
        raise AssertionError("the store was opened while the flag is off")

    monkeypatch.setattr(store, "read", boom)
    assert archive_askai.archive_block("what did they say about ZZTA", query_tickers=["ZZTA"]) == ("", [])


def test_ask_ai_block_is_cited_bounded_and_carries_the_outcome(wisdom_db, on):
    _seed()
    text, cites = archive_askai.archive_block("what did they say about ZZTA breakout", query_tickers=["ZZTA"])
    assert text.startswith(archive_askai.HEADER)
    assert "t9101" in text and "2025-01-02" in text and "r20 +10.0%" in text
    assert len(text) <= archive_askai.MAX_BLOCK_CHARS
    assert cites and cites[0]["record_id"] == "t9101" and cites[0]["kind"] == "trader_archive"
    assert len(cites) <= archive_askai.MAX_HITS
    # control: a question matching nothing adds nothing
    assert archive_askai.archive_block("zzzunmatchedword", query_tickers=[]) == ("", [])


def _stub_router(monkeypatch):
    import api.routers.ai_search as ai
    from api.services import ai_search_dossier, ai_search_log, ai_search_memory

    def uct(q):
        meta = ai._empty_meta()
        meta["query_tickers"] = ["ZZTA"]
        return "CTX", "salt0", meta

    monkeypatch.setattr(ai, "_uct_context", uct)
    monkeypatch.setattr(ai, "_brain_context", lambda q, t, v: "")
    monkeypatch.setattr(ai, "_wisdom_context", lambda q, m: ("", []))
    monkeypatch.setattr(ai_search_memory, "retrieve_context", lambda *a, **k: "")
    monkeypatch.setattr(ai_search_dossier, "maybe_run", lambda: None)
    monkeypatch.setattr(ai_search_log, "classify_question_type", lambda q: "other")
    return ai


def test_grounded_system_carries_the_block_only_with_the_flag(wisdom_db, on, monkeypatch):
    _seed()
    ai = _stub_router(monkeypatch)
    system_on, salt_on, meta_on = ai._grounded_system("what did they say about ZZTA")
    assert "TRADER ARCHIVE" in system_on and "trader_archive" in meta_on["grounding_sources"]
    assert salt_on.endswith("|trader_archive") and meta_on["archive_citations"]
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "0")
    system_off, salt_off, meta_off = ai._grounded_system("what did they say about ZZTA")
    assert "TRADER ARCHIVE" not in system_off and "trader_archive" not in meta_off["grounding_sources"]
    assert system_off == system_on.split(archive_askai.HEADER)[0]            # byte-identical prefix
