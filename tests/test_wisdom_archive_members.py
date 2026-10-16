"""The TSDR trader archive for PAID MEMBERS and in-app tools (owner ruling 2026-10-15).

SYNTHETIC data only — the repo is public.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a member read answering an unpaid member (must be 402) or anyone at all with the flag off (404);
2. the member routes not being require_paid, or not being mounted through the wisdom registry;
3. the flag being admin/internal again (it is member-visible and declared so in the ledger);
4. Ask AI carrying a TRADER ARCHIVE block while the flag is off, or touching wisdom.db to decide;
5. the block being unbounded, uncited, or missing the scored outcome;
6. a setup playbook accepting an unknown field, a non-team author or an oversized list, or the
   Ask AI playbook line appearing with the flag off, uncited, or unbounded;
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
               "/api/wisdom/archive/trader/tsdr", "/api/wisdom/archive/playbooks",
               "/api/wisdom/archive/playbook/synthetic_setup")


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
    assert c.post(BATCH, json={"kind": "setups", "items": [_playbook()]}, headers=AUTH).json()["inserted"] == 1


def _stats(n, edge, z=None):
    out = {"n": n, "n_scored": n, "win20": 0.55, "med_r20": 0.01, "mean_r20": 0.02, "med_edge20": 0.012,
           "mean_simR": 0.4, "mean_edgeR": edge, "thin": n < 30}
    if z is not None:
        out["edgeR_z"] = z
    return out


def _playbook(**over):
    pb = {
        "setup_id": "synthetic_setup", "name": "Synthetic setup / test pattern", "family": "test",
        "aliases": ["synthetic setup", "SYN"], "used_by": ["tsdr", "bracco"],
        "stats": _stats(140, 0.25, 1.4), "stats_trades": _stats(60, 0.3, 1.1),
        "context": {"market": {"downtrend": _stats(40, 0.9), "uptrend": _stats(90, -0.1)},
                    "trader": {"TSDR": _stats(12, 1.5)}},
        "teachings": [{"record_id": "t9102", "author_id": "bracco", "date": "2025-03-04",
                       "note": "synthetic lesson about patience in a breakout"},
                      {"record_id": "t9101", "author_id": "tsdr", "date": "2025-01-02", "note": "x" * 900}],
        "winners": [{"call_id": "t9101#0", "record_id": "t9101", "ticker": "ZZTA", "author_id": "tsdr",
                     "posted": "2025-01-02", "direction": "long", "action": "entry",
                     "evidence": "synthetic pivot", "r20": 0.1, "sim_R": 3.0, "regime": "uptrend"}],
        "failures": [],
    }
    pb.update(over)
    return pb


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
                     "/api/wisdom/archive/trader/{author}", "/api/wisdom/archive/playbooks",
                     "/api/wisdom/archive/playbook/{setup}"}
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


# ── 6. setup playbooks ───────────────────────────────────────────────────────

def test_a_playbook_reads_back_named_and_clipped_and_an_unknown_setup_is_404(wisdom_db, on):
    _seed()
    paid = _client(PAID_MEMBER)
    pb = paid.get("/api/wisdom/archive/playbook/synthetic_setup").json()
    assert pb["name"].startswith("Synthetic setup") and pb["stats"]["all"]["n_scored"] == 140
    assert [u["author"] for u in pb["used_by"]] == ["tsdr", "bracco"] and pb["used_by"][0]["trader"]
    assert pb["teachings"][0]["trader"] and pb["winners"][0]["ticker"] == "ZZTA"
    from api.services.wisdom.archive import service
    assert len(pb["teachings"][1]["note"]) <= service.TEACHING_NOTE_CHARS          # clipped, not refused
    rows = paid.get("/api/wisdom/archive/playbooks").json()["setups"]
    assert [r["setup_id"] for r in rows] == ["synthetic_setup"] and rows[0]["n_teachings"] == 2
    missing = paid.get("/api/wisdom/archive/playbook/no_such_setup")
    assert missing.status_code == 404 and missing.json()["detail"] == "No playbook for that setup"


@pytest.mark.parametrize("bad, why", [
    ({"images": ["a.png"]}, "unknown fields"),
    ({"used_by": ["somebody_else"]}, "used_by"),
    ({"stats": {"n": 3, "share_count": 100}}, "unknown stats fields"),
    ({"teachings": [{"record_id": "t1", "author_id": "not_a_trader", "date": "2025-01-01", "note": "x"}]},
     "team authors"),
    ({"winners": [{"call_id": "t1#0", "record_id": "t2", "ticker": "ZZTA", "author_id": "tsdr"}]},
     "call_id/record_id"),
    ({"context": {"weather": {}}}, "unknown context groups"),
    ({"aliases": ["a"] * 41}, "aliases"),
    ({"setup_id": "Has Spaces"}, "setup_id malformed"),
])
def test_the_setup_validator_refuses_what_it_does_not_name(wisdom_db, on, bad, why):
    c = _client(None)
    out = c.post(BATCH, json={"kind": "setups", "items": [_playbook(**bad)]}, headers=AUTH).json()
    assert out["rejected"] == 1 and why in out["errors"][0]["error"], out
    ok = c.post(BATCH, json={"kind": "setups", "items": [_playbook()]}, headers=AUTH).json()
    assert ok["inserted"] == 1                                                      # control: valid lands


def test_the_batch_names_setups_among_its_kinds(wisdom_db, on):
    r = _client(None).post(BATCH, json={"kind": "nope", "items": []}, headers=AUTH)
    assert r.status_code == 422 and "setups" in r.json()["detail"]


def test_match_setups_reads_aliases_word_bounded_and_case_sensitive_when_short(wisdom_db, on):
    _seed()
    from api.services.wisdom.archive import service

    with store.read() as conn:
        assert service.match_setups(conn, "is the synthetic setup any good") == ["synthetic_setup"]
        assert service.match_setups(conn, "what about a SYN today") == ["synthetic_setup"]
        assert service.match_setups(conn, "syn is lower case so not the alias") == []
        assert service.match_setups(conn, "synthetics are not a word match") == []


def test_ask_ai_carries_one_cited_bounded_playbook_line_when_a_setup_is_named(wisdom_db, on):
    _seed()
    text, cites = archive_askai.archive_block("does the synthetic setup work", query_tickers=[])
    line = text[len(archive_askai.HEADER):].split(" | ")[0]
    assert line.startswith("[PLAYBOOK · Synthetic setup")
    assert "140 scored calls" in line and "not proven" in line                     # z 1.4 < 3
    assert "market downtrend (n 40" in line and "TSDR (n 12" not in line          # n >= 30 only
    assert "t9102" in line and len(line) <= archive_askai.PLAYBOOK_CHARS
    pcites = [c for c in cites if c["kind"] == archive_askai.PLAYBOOK_KIND]
    assert [c["record_id"] for c in pcites] == ["t9102", "t9101"]
    assert len(text) <= archive_askai.MAX_BLOCK_CHARS
    plain, _ = archive_askai.archive_block("zzzunmatchedword", query_tickers=[])
    assert plain == ""                                                             # control: no setup named


def test_a_z_of_three_reads_as_a_measured_edge(wisdom_db, on):
    _seed()
    c = _client(None)
    c.post(BATCH, json={"kind": "setups", "items": [_playbook(stats=_stats(500, 0.4, 3.2))]}, headers=AUTH)
    text, _ = archive_askai.archive_block("synthetic setup", query_tickers=[])
    assert "measured edge" in text and "not proven" not in text


def test_the_playbook_line_is_absent_with_the_flag_off(wisdom_db, on, monkeypatch):
    _seed()
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "0")
    assert archive_askai.archive_block("does the synthetic setup work", query_tickers=[]) == ("", [])
