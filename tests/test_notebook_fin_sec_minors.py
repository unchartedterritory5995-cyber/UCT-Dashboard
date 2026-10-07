"""Security review MINOR findings M-3, M-4 and M-5: a member's own odd data answers a handled
result, never a 500, and no internal error text reaches the client.

  * M-5  `chart_plan.compass_size` returned the text of whatever exception the sizing call
         raised. It now returns one fixed sentence and logs the detail.
  * M-3  a chart block's fingerprint is copied out of the member's own note. A malformed one
         (a field that is a string, a list, a number) made `tech_fingerprint.summary_values`
         raise, and every fingerprint, visual-playbook and find-similar read then answered 500
         for that member. A malformed note fingerprint is now not a fingerprint (the block is
         frozen from bars like any other), and the reader itself tolerates a bad stored row.
  * M-4  the chart-block walkers recursed with no depth limit, so a very deeply nested note
         body raised RecursionError and answered 500 for its owner. The walk is now a loop,
         and a body too deep to parse reads as a note with no charts.

Each route test drives the real router with the member's bad row in the database and asserts
the page still answers, with the member's OTHER, well-formed chart still listed.
"""
from __future__ import annotations

import importlib
import json
import logging
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services.journal_two import chart_blocks, chart_plan, notes
from api.services.journal_two import tech_fingerprint as tfp
from api.services.journal_two.db import ensure_schema

TO_0930 = 1759255200 + 365 * 86400
FP_FLAG = "NOTEBOOK_TA_FINGERPRINT_ENABLED"


# ── M-5 ──────────────────────────────────────────────────────────────────────

def test_M5_a_sizing_failure_answers_a_fixed_sentence_and_logs_the_detail(caplog):
    secret = "sqlite3.OperationalError: unable to open /data/brain/uct_intelligence.db token=abc123"

    def boom(*a, **k):
        raise RuntimeError(secret)

    with caplog.at_level(logging.WARNING):
        out = chart_plan.compass_size(50, 48, 100_000, 1, paid=True, size_fn=boom)
    assert out == {"ok": False, "reason": chart_plan.COMPASS_FAILED_REASON}
    assert "/data" not in json.dumps(out) and "abc123" not in json.dumps(out) and "sqlite3" not in json.dumps(out)
    assert any("abc123" in (r.getMessage() + str(r.exc_info)) or "abc123" in caplog.text for r in caplog.records), (
        "the detail was dropped instead of logged")


# ── fixtures for the route tests ─────────────────────────────────────────────

def _chart(embed_id, symbol="NVDA", fp=None, tag="VCP"):
    attrs = {"v": 1, "widgetId": "chart", "params": {"symbol": symbol, "tf": "D", "to": TO_0930},
             "capturedAt": "2026-09-30T18:00:00Z", "embedId": embed_id, "mode": "snapshot", "annotations": [],
             "ta": {"setupTag": tag}}
    if fp is not None:
        attrs["ta"]["fingerprint"] = fp
    return {"type": "widgetEmbed", "attrs": attrs}


def _doc(*nodes):
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "plan"}]}, *nodes]}


def _good_fp(symbol="AMD"):
    return {"v": 1, "symbol": symbol, "as_of": "2026-09-30", "mode": "bars",
            "fields": {"adr_pct": {"value": 4.2, "source": "bars", "missing": None}}}


#: Fingerprints a member could have in a note that are NOT the shape `compute` writes.
MALFORMED = {
    "field-is-a-string": {"v": 1, "fields": {"adr_pct": "high"}},
    "field-is-a-list": {"v": 1, "fields": {"adr_pct": [1, 2, 3]}},
    "field-is-a-number": {"v": 1, "fields": {"adr_pct": 7, "rs_rank": True}},
    "fields-is-a-list": {"v": 1, "fields": ["adr_pct"]},
    "fields-is-a-string": {"v": 1, "fields": "none"},
    "value-is-an-object": {"v": 1, "fields": {"adr_pct": {"value": {"a": 1}}, "rs_rank": {"value": [9]}}},
    "no-fields": {"v": "x"},
}


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
    c.execute("INSERT INTO users (id, email, password_hash, display_name, role) VALUES ('m1','m1@example.com','x','m1','member')")
    c.commit()
    c.close()
    yield tmp.name
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


def _stub_compute(symbol, as_of):
    return {"v": 1, "symbol": symbol, "as_of": as_of, "mode": "bars",
            "fields": {"adr_pct": {"value": 3.0, "source": "bars", "missing": None}}}


@pytest.fixture
def client(db_path, monkeypatch):
    from api.routers import notebook_fingerprint, notebook_setups_board, notebook_visual_playbook
    from api.services.journal_two import setups_board, similar_matches, visual_playbook
    monkeypatch.setattr(tfp, "compute", _stub_compute)
    for flag in (FP_FLAG, visual_playbook.FLAG, setups_board.FLAG, similar_matches.FLAG):
        monkeypatch.setenv(flag, "1")
    app = FastAPI()
    app.include_router(notebook_fingerprint.router)
    app.include_router(notebook_visual_playbook.router)
    app.include_router(notebook_setups_board.router)
    app.include_router(notebook_setups_board.similar_router)
    user = {"id": "m1", "role": "member", "plan": "pro"}
    app.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)
    yield TestClient(app, raise_server_exceptions=False)
    app.dependency_overrides.clear()


def _conn():
    from api.services import auth_db
    return auth_db.get_connection()


def _note(body, title="plan"):
    c = _conn()
    try:
        n = notes.create_note("m1", {"title": title, "bodyJson": body}, conn=c)
        c.commit()
        return n
    finally:
        c.close()


READS = (
    "/api/j2/notebook-fingerprint/blocks",
    "/api/j2/notebook-visual-playbook/cards",
    "/api/j2/notebook-visual-playbook/cards?range=adr_pct:1:",
    "/api/j2/setups-board",
    "/api/j2/similar-names/templates",
)


def _assert_every_read_answers(client, label):
    for url in READS:
        r = client.get(url)
        assert r.status_code == 200, f"{label}: GET {url} answered {r.status_code}: {r.text[:160]}"


# ── M-3 ──────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("label", sorted(MALFORMED))
def test_M3_a_malformed_fingerprint_in_a_note_never_answers_500(client, label):
    good = _note(_doc(_chart("good", "AMD", fp=_good_fp())), title="good")
    bad = _note(_doc(_chart("bad", "NVDA", fp=MALFORMED[label])), title="bad")
    _assert_every_read_answers(client, label)

    blocks = client.get("/api/j2/notebook-fingerprint/blocks").json()["blocks"]
    by_note = {b["noteId"]: b for b in blocks}
    assert by_note[good["id"]]["values"]["adr_pct"] == 4.2          # the page is still usable
    assert by_note[good["id"]]["fingerprintSource"] == "note"
    # the malformed one is not a fingerprint: the block is frozen from bars like any other
    assert by_note[bad["id"]]["fingerprintSource"] == "ledger"
    assert by_note[bad["id"]]["values"]["adr_pct"] == 3.0
    one = client.get(f"/api/j2/notebook-fingerprint/blocks/{bad['id']}/bad")
    assert one.status_code == 200
    assert client.get(f"/api/j2/similar-names/{bad['id']}/bad").status_code == 200


def test_M3_a_malformed_fingerprint_already_stored_in_the_index_is_tolerated(client):
    """The row was projected before the note-side check existed: the reader must not raise."""
    good = _note(_doc(_chart("good", "AMD", fp=_good_fp())), title="good")
    bad = _note(_doc(_chart("bad", "NVDA")), title="bad")
    assert client.get("/api/j2/notebook-fingerprint/blocks").status_code == 200
    c = _conn()
    c.execute("UPDATE j2_chart_blocks SET note_fingerprint = ? WHERE note_id = ?",
              (json.dumps({"v": 1, "fields": {"adr_pct": "high", "rs_rank": [1]}}), bad["id"]))
    c.commit()
    c.close()
    _assert_every_read_answers(client, "stored malformed row")
    blocks = {b["noteId"]: b for b in client.get("/api/j2/notebook-fingerprint/blocks").json()["blocks"]}
    assert blocks[good["id"]]["values"]["adr_pct"] == 4.2
    assert blocks[bad["id"]]["values"]["adr_pct"] is None


def test_M3_summary_values_reads_only_well_formed_fields():
    assert tfp.summary_values({"fields": {"adr_pct": {"value": 2.5}}})["adr_pct"] == 2.5
    for bad in ("x", [1], 7, True, {"value": {"a": 1}}, {"value": [1]}, {"novalue": 1}):
        assert tfp.summary_values({"fields": {"adr_pct": bad}})["adr_pct"] is None, bad
    assert set(tfp.summary_values({"fields": ["a"]}).values()) == {None}
    assert tfp.summary_values("nope") == {}


def test_M3_a_well_formed_note_fingerprint_is_still_the_one_served():
    """CONTROL: the check drops malformed fingerprints only."""
    blocks = chart_blocks.extract_blocks(_doc(_chart("a", fp=_good_fp()), _chart("b", fp=MALFORMED["field-is-a-string"])))
    assert blocks[0]["note_fingerprint"] == _good_fp()
    assert blocks[1]["note_fingerprint"] is None
    full = _stub_compute("NVDA", "2026-09-30")
    assert chart_blocks.extract_blocks(_doc(_chart("c", fp=full)))[0]["note_fingerprint"] == full


# ── M-4 ──────────────────────────────────────────────────────────────────────

def _nested(depth, leaf):
    node = leaf
    for _ in range(depth):
        node = {"type": "blockquote", "content": [node]}
    return {"type": "doc", "content": [node]}


def test_M4_the_chart_walk_reads_a_very_deep_body_without_recursing():
    from api.services.journal_two import visual_playbook
    deep = _nested(5000, _chart("deep", "TSLA"))
    blocks = chart_blocks.extract_blocks(deep)
    assert [b["symbol"] for b in blocks] == ["TSLA"]
    assert [a["embedId"] for a in visual_playbook._chart_nodes(deep)] == ["deep"]


def test_M4_the_two_walkers_agree_on_document_order():
    """`position` in the index is an index into `_chart_nodes`: the two walks must match."""
    from api.services.journal_two import visual_playbook
    body = {"type": "doc", "content": [
        _chart("a"),
        {"type": "columns", "content": [
            {"type": "column", "content": [_chart("b"), {"type": "blockquote", "content": [_chart("c")]}]},
            {"type": "column", "content": [_chart("d")]}]},
        {"type": "widgetEmbed", "attrs": {"widgetId": "watchlist"}},
        _chart("e"),
    ]}
    order = [b["embed_id"] for b in chart_blocks.extract_blocks(body)]
    assert order == ["a", "b", "c", "d", "e"]
    assert [a["embedId"] for a in visual_playbook._chart_nodes(body)] == order


def test_M4_a_body_too_deep_for_the_json_parser_reads_as_no_charts():
    """At this depth `json.loads` itself raises RecursionError, which is not a ValueError."""
    depth = 60_000
    too_deep = '{"type":"doc","content":[' + '{"type":"blockquote","content":[' * depth + "]}" * depth + "]}"
    with pytest.raises(RecursionError):
        json.loads(too_deep)                                    # the control: it really is too deep
    assert chart_blocks.parse_body(too_deep) is None
    assert chart_blocks.extract_blocks(chart_blocks.parse_body(too_deep)) == []
    assert chart_blocks.parse_body('{"type":"doc"}') == {"type": "doc"}
    assert chart_blocks.parse_body("{not json") is None


@pytest.mark.parametrize("depth", [3000, 60_000])
def test_M4_a_deeply_nested_note_never_answers_500_for_its_owner(client, depth):
    good = _note(_doc(_chart("good", "AMD", fp=_good_fp())), title="good")
    # Built as text: json.dumps itself cannot serialise this depth. 3,000 levels parses and
    # used to break the recursive walk; 60,000 does not parse at all.
    leaf = json.dumps(_chart("deep", "TSLA"), separators=(",", ":"))
    deep_body = ('{"type":"doc","content":[' + '{"type":"blockquote","content":[' * depth + leaf
                 + "]}" * depth + "]}")
    shallow = _note(_doc(_chart("deep", "TSLA")), title="deep")
    c = _conn()
    c.execute("UPDATE j2_notes SET body_json = ?, updated_at = '2026-10-03T00:00:00+00:00' WHERE id = ?",
              (deep_body, shallow["id"]))
    c.commit()
    c.close()
    _assert_every_read_answers(client, "deep body")
    blocks = {b["noteId"] for b in client.get("/api/j2/notebook-fingerprint/blocks").json()["blocks"]}
    assert good["id"] in blocks
