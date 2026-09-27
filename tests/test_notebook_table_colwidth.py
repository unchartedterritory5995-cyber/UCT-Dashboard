"""Wave 10 lane 10B — G-134: a resized table's column widths.

The editor stores a column's width as the `colwidth` attribute on every cell
of the column (prosemirror-tables' own shape: a list of pixel widths, one per
spanned column). What this pins, server side:

  * a body carrying widths is STORED and READ BACK unchanged — create, save an
    edit, re-read — so a resize survives save and reload;
  * the Markdown export DROPS the widths deliberately (GFM has no column
    widths) and produces exactly the table it produces without them — and the
    exporter's own docstring says so, so the drop is a decision, not an
    accident nobody noticed;
  * `colwidth` is not a node TYPE, so it needs no row in the schema table
    (`notebook_schema.NOTEBOOK_TYPE_SCHEMA` registers types; the cell types it
    rides on are level 0).
"""
from __future__ import annotations

import copy
import importlib
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services.journal_two import notes_export
from api.services.journal_two.notes_export import tiptap_to_markdown


def _para(text):
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def _cell(text, kind="tableCell", width=None):
    attrs = {"colspan": 1, "rowspan": 1, "colwidth": [width] if width else None}
    return {"type": kind, "attrs": attrs, "content": [_para(text)]}


def _table(widths=(None, None)):
    w0, w1 = widths
    return {"type": "table", "content": [
        {"type": "tableRow", "content": [_cell("Sym", "tableHeader", w0), _cell("Px", "tableHeader", w1)]},
        {"type": "tableRow", "content": [_cell("NVDA", width=w0), _cell("120", width=w1)]},
        {"type": "tableRow", "content": [_cell("AMD", width=w0), _cell("9.5", width=w1)]},
    ]}


def _doc(table):
    return {"type": "doc", "content": [_para("Watchlist"), table]}


# ── export: Markdown drops widths, deliberately ─────────────────────────────

def test_markdown_export_of_a_resized_table_is_the_same_table_widths_dropped():
    sized = tiptap_to_markdown(_doc(_table((180, 96))))
    plain = tiptap_to_markdown(_doc(_table()))
    assert sized == plain
    assert "| Sym | Px |" in sized and "| NVDA | 120 |" in sized
    assert "180" not in sized and "96" not in sized


def test_the_exporter_SAYS_it_drops_column_widths():
    doc = notes_export._table.__doc__ or ""
    assert "column widths" in doc.lower() and "dropped" in doc.lower(), doc


# ── the schema table registers types, not attributes ────────────────────────

def test_colwidth_rides_on_level_zero_cell_types_and_is_not_a_schema_type():
    from api.services.journal_two import notebook_schema
    table = notebook_schema.NOTEBOOK_TYPE_SCHEMA
    assert table["tableCell"] == 0 and table["tableHeader"] == 0
    assert "colwidth" not in table


# ── storage: save and reload keep the widths ────────────────────────────────

@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


@pytest.fixture
def client(db_path):
    from api.routers import journal_two as journal_two_router
    fa = FastAPI()
    fa.include_router(journal_two_router.router)
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u-colwidth", "role": "member"}
    yield TestClient(fa)
    fa.dependency_overrides.clear()


def _widths(body):
    table = next(n for n in body["content"] if n.get("type") == "table")
    return [[c["attrs"]["colwidth"] for c in row["content"]] for row in table["content"]]


def test_a_resized_table_survives_save_and_reload(client):
    r = client.post("/api/j2/notes", json={"title": "Watchlist", "bodyJson": _doc(_table())})
    assert r.status_code == 200, r.text
    note = r.json()["note"]
    assert _widths(note["bodyJson"]) == [[None, None]] * 3

    resized = _doc(_table((180, 96)))
    r = client.put(f"/api/j2/notes/{note['id']}",
                   json={"bodyJson": copy.deepcopy(resized), "baseUpdatedAt": note["updatedAt"]})
    assert r.status_code == 200, r.text

    r = client.get(f"/api/j2/notes/{note['id']}")
    assert r.status_code == 200, r.text
    reread = r.json()["note"]["bodyJson"]
    assert _widths(reread) == [[[180], [96]]] * 3
    assert reread == resized
