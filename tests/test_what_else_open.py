"""TERM-093 — the "what else was open, named" capture (api/services/what_else_open.py).

Rails, each failing for a different reason:
  (dark)   flag unset -> every route 404 for an ADMIN, and the table is never created.
  (who)    a member is refused (the subject is the owner-desk, admin role).
  (a)      an eligible occasion with no response is UNANSWERED — never absent, never 'none'.
  (b)      the read-back publishes recorded/eligible with the denominator, and n as n.
  (once)   an answer is written once and never overwritten, and only by its subject.
  (c)      no third-party site is probed — asserted over the diff's own source.
  (nodel)  no DELETE route and no DELETE statement: stopping is unsetting the flag.
  (mount)  the frontend's declared occasion is one the backend accepts.
"""
from __future__ import annotations

import re
import sqlite3
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware
from api.routers import what_else_open as router_mod
from api.services import what_else_open as weo

REPO = Path(__file__).resolve().parents[1]
FRONTEND = REPO / "app" / "src" / "components" / "instruments" / "WhatElseOpenPrompt.jsx"
DRILL = REPO / "app" / "src" / "pages" / "breadth" / "drill" / "BreadthDrillModal.jsx"
BASE = "/api/instruments/what-else-open/occasion"
SUMMARY = "/api/admin/instruments/what-else-open"

ADMIN = {"id": "adm-1", "email": "a@example.test", "role": "admin"}
ADMIN2 = {"id": "adm-2", "email": "b@example.test", "role": "admin"}
MEMBER = {"id": "mem-1", "email": "m@example.test", "role": "member"}


@pytest.fixture
def db(tmp_path, monkeypatch):
    path = tmp_path / "weo.db"

    def _conn():
        c = sqlite3.connect(str(path))
        c.row_factory = sqlite3.Row
        return c

    monkeypatch.setattr(weo.auth_db, "get_connection", _conn)
    monkeypatch.setattr(weo, "_init_done", False)
    return path


def _client(user):
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[auth_middleware.get_current_user] = lambda: user
    return TestClient(app)


def _tables(path):
    if not path.exists():
        return set()
    c = sqlite3.connect(str(path))
    try:
        return {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        c.close()


def _open(client, oid="occ12345", occasion="wf_c13_breadth_drill"):
    return client.post(BASE, json={"occasion_id": oid, "occasion": occasion})


# ── (dark) ──────────────────────────────────────────────────────────────────

def test_dark_every_route_is_404_for_an_admin_and_no_table_is_created(db, monkeypatch):
    monkeypatch.delenv(weo.FLAG, raising=False)
    c = _client(ADMIN)
    assert _open(c).status_code == 404
    assert c.post(f"{BASE}/occ12345/answer", json={"tools": ["none"]}).status_code == 404
    assert c.get(SUMMARY).status_code == 404
    assert "what_else_open_occasions" not in _tables(db)


# ── (who) ───────────────────────────────────────────────────────────────────

def test_a_member_is_refused_even_when_armed(db, monkeypatch):
    monkeypatch.setenv(weo.FLAG, "1")
    c = _client(MEMBER)
    assert _open(c).status_code == 403
    assert c.get(SUMMARY).status_code == 403


# ── (a) + (b) ───────────────────────────────────────────────────────────────

def test_an_unanswered_occasion_is_recorded_as_unanswered_not_absent_not_none(db, monkeypatch):
    monkeypatch.setenv(weo.FLAG, "1")
    c = _client(ADMIN)
    assert c.get(SUMMARY).json()["eligible"] == 0          # absent: nothing known
    r = _open(c)
    assert r.status_code == 200 and r.json()["created"] is True
    s = c.get(SUMMARY).json()
    assert (s["eligible"], s["answered"], s["unanswered"]) == (1, 0, 1)
    assert s["by_tool_over_answered"]["none"] == 0, "an unanswered occasion was read as 'none'"
    assert s["recorded_over_eligible"] == "0/1"


def test_the_read_back_publishes_the_denominator_and_n_as_n(db, monkeypatch):
    monkeypatch.setenv(weo.FLAG, "1")
    a, b = _client(ADMIN), _client(ADMIN2)
    _open(a, "occAAAA1"); _open(a, "occAAAA2"); _open(b, "occBBBB1")
    assert a.post(f"{BASE}/occAAAA1/answer", json={"tools": ["finviz", "tradingview"]}).status_code == 200
    assert b.post(f"{BASE}/occBBBB1/answer", json={"tools": ["none"]}).status_code == 200
    s = a.get(SUMMARY).json()
    assert s["recorded_over_eligible"] == "2/3"
    assert s["n_subjects"] == 2
    assert s["by_tool_over_answered"]["finviz"] == 1
    assert s["by_tool_over_answered"]["none"] == 1
    assert s["by_occasion"]["wf_c13_breadth_drill"] == {"eligible": 3, "answered": 2}


def test_a_remount_of_the_same_open_does_not_count_twice(db, monkeypatch):
    monkeypatch.setenv(weo.FLAG, "1")
    c = _client(ADMIN)
    assert _open(c).json()["created"] is True
    assert _open(c).json()["created"] is False
    assert c.get(SUMMARY).json()["eligible"] == 1


# ── (once) ──────────────────────────────────────────────────────────────────

def test_an_answer_is_written_once_and_only_by_its_subject(db, monkeypatch):
    monkeypatch.setenv(weo.FLAG, "1")
    a, b = _client(ADMIN), _client(ADMIN2)
    _open(a)
    assert b.post(f"{BASE}/occ12345/answer", json={"tools": ["none"]}).status_code == 409
    assert a.post(f"{BASE}/occ12345/answer", json={"tools": ["finviz"]}).status_code == 200
    assert a.post(f"{BASE}/occ12345/answer", json={"tools": ["none"]}).status_code == 409
    s = a.get(SUMMARY).json()
    assert s["by_tool_over_answered"]["finviz"] == 1 and s["by_tool_over_answered"]["none"] == 0


@pytest.mark.parametrize("body", [
    {"tools": []},
    {"tools": ["none", "finviz"]},
    {"tools": ["bloomberg"]},
    {"tools": ["finviz"], "other_text": "x"},
])
def test_malformed_answers_are_refused(db, monkeypatch, body):
    monkeypatch.setenv(weo.FLAG, "1")
    c = _client(ADMIN)
    _open(c)
    assert c.post(f"{BASE}/occ12345/answer", json=body).status_code == 400


def test_an_undeclared_occasion_is_refused(db, monkeypatch):
    monkeypatch.setenv(weo.FLAG, "1")
    assert _open(_client(ADMIN), occasion="anything_else").status_code == 400


# ── (c) no probe ────────────────────────────────────────────────────────────

_PROBES = (r"window\.open", r"document\.referrer", r"\bhistory\.", r"\bchrome\.",
           r"postMessage", r"https?://", r"navigator\.", r"localStorage", r"<iframe", r"\bImage\(")


def test_the_instrument_never_probes_a_third_party_site():
    src = FRONTEND.read_text(encoding="utf-8") + Path(weo.__file__).read_text(encoding="utf-8")
    hits = [p for p in _PROBES if re.search(p, src)]
    assert not hits, f"the instrument reaches past what the subject names: {hits}"
    fetch_targets = re.findall(r"fetch\(\s*([^,\)]+)", FRONTEND.read_text(encoding="utf-8"))
    assert fetch_targets, "the rail found no fetch at all — it is reading the wrong file"
    for t in fetch_targets:
        assert t.strip().startswith(("BASE", "`${BASE}")), f"fetch to something other than our route: {t}"


# ── (nodel) ─────────────────────────────────────────────────────────────────

def test_there_is_no_delete_route_and_no_delete_statement():
    methods = {m for r in router_mod.router.routes for m in getattr(r, "methods", set())}
    assert "DELETE" not in methods
    assert not re.search(r"\bDELETE\s+FROM\b", Path(weo.__file__).read_text(encoding="utf-8"), re.I)


# ── (mount) ─────────────────────────────────────────────────────────────────

def test_the_drill_mounts_the_prompt_with_a_declared_occasion():
    src = DRILL.read_text(encoding="utf-8")
    used = re.findall(r'<WhatElseOpenPrompt\s+occasion="([^"]+)"', src)
    assert used, "BreadthDrillModal no longer mounts the instrument"
    assert set(used) <= set(weo.OCCASIONS), f"undeclared occasion(s): {set(used) - set(weo.OCCASIONS)}"
