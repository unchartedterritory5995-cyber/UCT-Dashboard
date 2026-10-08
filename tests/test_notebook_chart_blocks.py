"""Wave 13 lane 13I-1 -- the chart-block index and the freeze (`chart_blocks.py`), and the
routes over them (`api/routers/notebook_fingerprint.py`).

  * PROJECTION CONSISTENCY: save a note with a chart block -> its row exists; edit the block ->
    the row follows; remove the block -> the row is gone; trash -> hidden; hard delete -> gone.
    The index is maintained from the save path's own `j2_note_embeds` sidecar, never by a
    second writer into notes.
  * THE FREEZE: a block's fingerprint is computed once and a recompute changes nothing -- not a
    re-save, not a catch-up, not a later world. A transient read failure is never frozen.
  * ACCOUNT PURGE takes both tables, and only the deleted member's rows.
  * THE ROUTES: 404 while the flag is off (before the session), 402 for a free plan, another
    member's note is the one 404, and a freeze is idempotent.

No bars store, vendor or model is reachable: every fingerprint here comes from a stub `compute`.
"""
from __future__ import annotations

import importlib
import json
import os
import sqlite3
import tempfile

import pytest

from api.services.journal_two import chart_blocks
from api.services.journal_two import tech_fingerprint as tfp
from api.services.journal_two.db import ensure_schema
from api.services.journal_two import notes

TO_0930 = 1759255200 + 365 * 86400      # 2026-09-30 14:00 ET, the chart's frozen right edge


def _chart(embed_id="e-1", symbol="NVDA", to=TO_0930, tag=None, fp=None, captured="2026-09-30T18:00:00Z"):
    attrs = {"v": 1, "widgetId": "chart", "params": {"symbol": symbol, "tf": "D", "to": to},
             "capturedAt": captured, "embedId": embed_id, "mode": "snapshot", "annotations": []}
    ta = {}
    if tag:
        ta["setupTag"] = tag
    if fp:
        ta["fingerprint"] = fp
    if ta:
        attrs["ta"] = ta
    return {"type": "widgetEmbed", "attrs": attrs}


def _doc(*nodes):
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "plan"}]},
                                       *nodes]}


class Counter:
    """A stub `compute` that records every call and returns a fresh fingerprint each time."""

    def __init__(self):
        self.calls = []

    def __call__(self, symbol, as_of):
        self.calls.append((symbol, as_of))
        return {"v": 1, "symbol": symbol, "as_of": as_of, "mode": "bars", "call": len(self.calls),
                "fields": {"adr_pct": {"value": float(len(self.calls)), "source": "bars", "missing": None}}}


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    chart_blocks.ensure_schema(c)
    yield c
    c.close()


def _rows(c, user="u1"):
    return [dict(r) for r in c.execute(
        "SELECT note_id, embed_key, symbol, as_of, setup_tag FROM j2_chart_blocks WHERE user_id = ?"
        " ORDER BY note_id, position", (user,))]


# ── the pure read of a note ───────────────────────────────────────────────────

def test_extract_reads_symbol_day_tag_and_keys_in_document_order():
    body = _doc(_chart("e-1", "nvda", tag="VCP"), _chart(None, "AAPL", to=None),
                {"type": "widgetEmbed", "attrs": {"widgetId": "watchlist", "params": {}}},
                _chart("e-1", "MSFT"))
    b = chart_blocks.extract_blocks(body)
    assert [x["symbol"] for x in b] == ["NVDA", "AAPL", "MSFT"]          # the watchlist is not a chart
    assert b[0]["as_of"] == "2026-09-30" and b[0]["setup_tag"] == "VCP"
    assert b[1]["as_of"] == "2026-09-30"                                    # no `to`: the insert day
    assert b[1]["embed_key"] == "chart|2026-09-30T18:00:00Z"                # the legacy identity
    assert b[2]["embed_key"] == "e-1#2"                                     # a pasted copy's id clash
    assert chart_blocks.extract_blocks(_doc(_chart(symbol="NOT A TICKER")))[0]["symbol"] is None


# ── projection consistency ────────────────────────────────────────────────────

def test_save_with_a_block_then_the_row_exists_remove_it_then_the_row_is_gone(conn):
    stub = Counter()
    n = notes.create_note("u1", {"title": "NVDA plan", "bodyJson": _doc(_chart(tag="VCP"))}, conn=conn)
    assert _rows(conn) == []                       # NOT in the save path: nothing until a catch-up
    chart_blocks.catch_up("u1", conn=conn, compute=stub)
    assert _rows(conn) == [{"note_id": n["id"], "embed_key": "e-1", "symbol": "NVDA",
                            "as_of": "2026-09-30", "setup_tag": "VCP"}]

    notes.update_note("u1", n["id"], {"bodyJson": _doc(_chart(symbol="AMD", tag="HTF"))}, conn=conn)
    chart_blocks.catch_up("u1", conn=conn, compute=stub)
    assert [(r["symbol"], r["setup_tag"]) for r in _rows(conn)] == [("AMD", "HTF")]

    notes.update_note("u1", n["id"], {"bodyJson": _doc()}, conn=conn)
    out = chart_blocks.catch_up("u1", conn=conn, compute=stub)
    assert _rows(conn) == [] and out["notes_removed"] == 1


def test_a_trashed_note_is_hidden_and_a_hard_deleted_one_is_gone(conn):
    stub = Counter()
    keep = notes.create_note("u1", {"title": "keep", "bodyJson": _doc(_chart("k"))}, conn=conn)
    gone = notes.create_note("u1", {"title": "gone", "bodyJson": _doc(_chart("g"))}, conn=conn)
    chart_blocks.catch_up("u1", conn=conn, compute=stub)
    assert {b["noteId"] for b in chart_blocks.list_blocks("u1", conn)} == {keep["id"], gone["id"]}

    notes.delete_note("u1", gone["id"], conn=conn)                       # trash
    chart_blocks.catch_up("u1", conn=conn, compute=stub)
    assert {b["noteId"] for b in chart_blocks.list_blocks("u1", conn)} == {keep["id"]}

    conn.execute("DELETE FROM j2_notes WHERE id = ?", (gone["id"],))     # the trash purge's delete
    conn.execute("DELETE FROM j2_note_embeds WHERE note_id = ?", (gone["id"],))
    conn.commit()
    chart_blocks.catch_up("u1", conn=conn, compute=stub)
    assert gone["id"] not in {r["note_id"] for r in _rows(conn)}
    assert conn.execute("SELECT COUNT(*) FROM j2_chart_fingerprints WHERE note_id = ?",
                        (gone["id"],)).fetchone()[0] == 0


def test_an_unchanged_note_is_not_reprojected(conn):
    stub = Counter()
    notes.create_note("u1", {"title": "a", "bodyJson": _doc(_chart())}, conn=conn)
    assert chart_blocks.catch_up("u1", conn=conn, compute=stub)["notes_projected"] == 1
    assert chart_blocks.catch_up("u1", conn=conn, compute=stub)["notes_projected"] == 0


def test_the_index_never_writes_a_note(conn):
    stub = Counter()
    n = notes.create_note("u1", {"title": "a", "bodyJson": _doc(_chart())}, conn=conn)
    before = dict(conn.execute("SELECT body_json, updated_at FROM j2_notes WHERE id = ?", (n["id"],)).fetchone())
    chart_blocks.catch_up("u1", conn=conn, compute=stub)
    chart_blocks.list_blocks("u1", conn)
    after = dict(conn.execute("SELECT body_json, updated_at FROM j2_notes WHERE id = ?", (n["id"],)).fetchone())
    assert before == after


def test_members_are_isolated(conn):
    stub = Counter()
    notes.create_note("u1", {"title": "a", "bodyJson": _doc(_chart())}, conn=conn)
    notes.create_note("u2", {"title": "b", "bodyJson": _doc(_chart(symbol="TSLA"))}, conn=conn)
    chart_blocks.catch_up("u1", conn=conn, compute=stub)
    chart_blocks.catch_up("u2", conn=conn, compute=stub)
    assert [b["symbol"] for b in chart_blocks.list_blocks("u1", conn)] == ["NVDA"]
    assert [b["symbol"] for b in chart_blocks.list_blocks("u2", conn)] == ["TSLA"]


# ── the freeze ────────────────────────────────────────────────────────────────

def test_a_frozen_fingerprint_is_never_recomputed(conn):
    stub = Counter()
    n = notes.create_note("u1", {"title": "a", "bodyJson": _doc(_chart())}, conn=conn)
    chart_blocks.catch_up("u1", conn=conn, compute=stub)
    first = chart_blocks.get_block("u1", n["id"], "e-1", conn)
    assert stub.calls == [("NVDA", "2026-09-30")]
    assert first["fingerprint"]["call"] == 1 and first["fingerprintSource"] == "ledger"

    # A re-save, a caption edit, catch-ups, and a direct freeze: nothing recomputes.
    body = _doc(_chart())
    body["content"][0]["content"][0]["text"] = "plan, edited"
    notes.update_note("u1", n["id"], {"bodyJson": body}, conn=conn)
    for _ in range(3):
        chart_blocks.catch_up("u1", conn=conn, compute=stub)
    again = chart_blocks.freeze(conn, "u1", n["id"], "e-1", "NVDA", "2026-09-30", compute=stub)
    assert stub.calls == [("NVDA", "2026-09-30")]
    assert again["fingerprint"] == first["fingerprint"] and again["frozen_at"] == first["frozenAt"]
    assert chart_blocks.get_block("u1", n["id"], "e-1", conn)["fingerprint"] == first["fingerprint"]


def test_a_new_symbol_or_day_is_a_new_freeze_and_an_undo_brings_the_old_one_back(conn):
    stub = Counter()
    n = notes.create_note("u1", {"title": "a", "bodyJson": _doc(_chart())}, conn=conn)
    chart_blocks.catch_up("u1", conn=conn, compute=stub)
    nvda = chart_blocks.get_block("u1", n["id"], "e-1", conn)["fingerprint"]
    notes.update_note("u1", n["id"], {"bodyJson": _doc(_chart(symbol="AMD"))}, conn=conn)
    chart_blocks.catch_up("u1", conn=conn, compute=stub)
    assert chart_blocks.get_block("u1", n["id"], "e-1", conn)["fingerprint"]["symbol"] == "AMD"
    notes.update_note("u1", n["id"], {"bodyJson": _doc(_chart())}, conn=conn)       # undo
    chart_blocks.catch_up("u1", conn=conn, compute=stub)
    assert chart_blocks.get_block("u1", n["id"], "e-1", conn)["fingerprint"] == nvda
    assert stub.calls == [("NVDA", "2026-09-30"), ("AMD", "2026-09-30")]


def test_a_transient_read_failure_is_never_frozen(conn):
    def flaky(symbol, as_of):
        return {"v": 1, "fields": {"patterns": {"value": None, "source": "pattern_vision",
                                                "missing": "patterns_unavailable"}}}

    def broken(symbol, as_of):
        raise sqlite3.OperationalError("database is locked")

    n = notes.create_note("u1", {"title": "a", "bodyJson": _doc(_chart())}, conn=conn)
    for bad in (flaky, broken):
        out = chart_blocks.catch_up("u1", conn=conn, compute=bad)
        assert out["frozen"] == 0 and out["pending"] == 1
    assert chart_blocks.get_block("u1", n["id"], "e-1", conn)["fingerprint"] is None
    assert chart_blocks.catch_up("u1", conn=conn, compute=Counter())["frozen"] == 1


def test_the_note_carried_fingerprint_wins_and_costs_no_compute(conn):
    stub = Counter()
    carried = {"v": 1, "symbol": "NVDA", "fields": {"adr_pct": {"value": 4.2, "source": "bars", "missing": None}}}
    n = notes.create_note("u1", {"title": "a", "bodyJson": _doc(_chart(fp=carried))}, conn=conn)
    chart_blocks.catch_up("u1", conn=conn, compute=stub)
    b = chart_blocks.get_block("u1", n["id"], "e-1", conn)
    assert (b["fingerprint"], b["fingerprintSource"], stub.calls) == (carried, "note", [])
    assert b["values"]["adr_pct"] == 4.2


def test_the_freeze_budget_bounds_one_catch_up(conn):
    stub = Counter()
    notes.create_note("u1", {"title": "a", "bodyJson": _doc(*[_chart(f"e{i}") for i in range(5)])}, conn=conn)
    out = chart_blocks.catch_up("u1", conn=conn, compute=stub, freeze_budget=2)
    assert (out["frozen"], out["pending"], len(stub.calls)) == (2, 3, 2)


# ── account purge ─────────────────────────────────────────────────────────────

def test_account_purge_takes_both_tables_and_only_that_member(conn):
    from api.services.journal_two import account_purge
    stub = Counter()
    for u in ("u1", "u2"):
        notes.create_note(u, {"title": u, "bodyJson": _doc(_chart())}, conn=conn)
        chart_blocks.catch_up(u, conn=conn, compute=stub)
    report = account_purge.purge_user_rows("u1", conn)
    assert report["rows_deleted"]["j2_chart_blocks"] == 1
    assert report["rows_deleted"]["j2_chart_fingerprints"] == 1
    for t in ("j2_chart_blocks", "j2_chart_fingerprints"):
        assert conn.execute(f"SELECT COUNT(*) FROM {t} WHERE user_id='u1'").fetchone()[0] == 0
        assert conn.execute(f"SELECT COUNT(*) FROM {t} WHERE user_id='u2'").fetchone()[0] == 1


# ── the routes ────────────────────────────────────────────────────────────────

from fastapi import FastAPI                                 # noqa: E402
from fastapi.testclient import TestClient                   # noqa: E402

from api.middleware import auth_middleware as authmw        # noqa: E402

PAID = {"plan": "pro"}
FREE = {"plan": "free"}


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    c = auth_db.get_connection()
    ensure_schema(c)
    for uid in ("m1", "m2"):
        c.execute("INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)",
                  (uid, f"{uid}@example.com", "x", uid, "member"))
    c.commit()
    c.close()
    yield tmp.name
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


@pytest.fixture
def client(db_path, monkeypatch):
    from api.routers import notebook_fingerprint
    stub = Counter()
    monkeypatch.setattr(tfp, "compute", stub)
    app = FastAPI()
    app.include_router(notebook_fingerprint.router)
    c = TestClient(app)
    c.app_ = app
    c.stub = stub
    yield c
    app.dependency_overrides.clear()


def as_user(client, uid, plan=PAID):
    user = {"id": uid, "role": "member", **plan}
    client.app_.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    client.app_.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)


def _note(uid, body):
    from api.services import auth_db
    c = auth_db.get_connection()
    try:
        return notes.create_note(uid, {"title": "plan", "bodyJson": body}, conn=c)
    finally:
        c.close()


def test_every_route_is_404_while_the_flag_is_off_even_signed_out(client, monkeypatch):
    monkeypatch.delenv(tfp.FLAG, raising=False)
    for method, path in (("get", "/meta"), ("get", "/compute?symbol=NVDA"), ("get", "/blocks"),
                         ("get", "/blocks/n/e"), ("post", "/blocks/n/e/freeze")):
        r = getattr(client, method)("/api/j2/notebook-fingerprint" + path)
        assert r.status_code == 404, (path, r.status_code)


def test_a_free_plan_is_refused_and_a_paid_one_is_served(client, monkeypatch):
    monkeypatch.setenv(tfp.FLAG, "1")
    as_user(client, "m1", FREE)
    assert client.get("/api/j2/notebook-fingerprint/meta").status_code == 402
    as_user(client, "m1", PAID)
    r = client.get("/api/j2/notebook-fingerprint/meta")
    assert r.status_code == 200 and r.json()["fields"] == list(tfp.FIELDS)


def test_compute_refuses_a_future_day(client, monkeypatch):
    monkeypatch.setenv(tfp.FLAG, "1")
    as_user(client, "m1")
    monkeypatch.setattr(tfp, "compute", lambda s, a: tfp.normalize_as_of(a))
    assert client.get("/api/j2/notebook-fingerprint/compute?symbol=NVDA&asOf=2999-01-01").status_code == 422


def test_blocks_list_freeze_and_another_members_note(client, monkeypatch):
    monkeypatch.setenv(tfp.FLAG, "1")
    n = _note("m1", _doc(_chart(tag="VCP")))
    as_user(client, "m1")
    r = client.get("/api/j2/notebook-fingerprint/blocks?setupTag=VCP").json()
    assert r["count"] == 1 and r["blocks"][0]["symbol"] == "NVDA" and r["pending"] == 0
    frozen = r["blocks"][0]["fingerprint"]
    f = client.post(f"/api/j2/notebook-fingerprint/blocks/{n['id']}/e-1/freeze")
    assert f.status_code == 200 and f.json()["block"]["fingerprint"] == frozen
    assert len(client.stub.calls) == 1                                  # idempotent: no recompute

    as_user(client, "m2")
    assert client.get(f"/api/j2/notebook-fingerprint/blocks/{n['id']}/e-1").status_code == 404
    assert client.post(f"/api/j2/notebook-fingerprint/blocks/{n['id']}/e-1/freeze").status_code == 404
    assert client.get("/api/j2/notebook-fingerprint/blocks").json()["count"] == 0


def test_the_freeze_route_freezes_a_pending_block_from_the_notes_own_symbol(client, monkeypatch):
    monkeypatch.setenv(tfp.FLAG, "1")
    n = _note("m1", _doc(_chart(symbol="AMD")))
    as_user(client, "m1")
    r = client.post(f"/api/j2/notebook-fingerprint/blocks/{n['id']}/e-1/freeze")
    assert r.status_code == 200
    assert client.stub.calls == [("AMD", "2026-09-30")]
    assert r.json()["block"]["fingerprint"]["symbol"] == "AMD"
