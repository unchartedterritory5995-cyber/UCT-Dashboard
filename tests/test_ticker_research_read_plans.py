"""The Ticker Research workspace reads carry NO correlated sidecar subquery (wave 7 lane J, J8).

`ticker_research._notes_for_symbols` and `_documents_for_symbols` matched a note to a
symbol with `OR EXISTS (SELECT 1 FROM j2_note_embeds e WHERE e.note_id = n.id ...)` and the
same for `j2_note_mentions` -- the shape lane I measured and removed from `notes.py` this
wave (`GET /notes?embed_symbol=`: 717 ms p95 at 10k notes, ~14.8 s at 50k; 16.7 s -> 63 ms
from the fix). With no ANALYZE statistics the planner answers each EXISTS from
`idx_j2_note_embeds_user_sym` once PER NOTE. The fix is lane I's: ONE note-id set from the
sidecars (`notes._symbol_note_ids_sql`, the one answer to "which notes relate to this
symbol"), then a join.

Two rails:
* the PLAN -- every statement is captured from the real function through sqlite's own
  trace callback (expanded SQL, never retyped here), then EXPLAINed: no step may be a
  correlated subquery;
* the ANSWER -- old vs new on one seeded library: same rows, same order. The OLD
  statements are frozen below verbatim from `8d34a5fdf` (the historical reference a
  differential needs; they are never run by the product again).
"""
from __future__ import annotations

import sqlite3

import pytest

from api.services.journal_two import db as j2db
from api.services.journal_two import ticker_research as tr

U, V = "u1", "u2"

# ⛔ FROZEN: api/services/journal_two/ticker_research.py at 8d34a5fdf, the correlated shape.
_OLD_NOTES_SQL = (
    "SELECT DISTINCT n.id, n.user_id, n.account_id, n.folder_id, n.title, n.subtitle,"
    " substr(coalesce(n.body_plain, ''), 1, {chars}) AS body_plain,"
    " n.hero_image_url, n.first_image_url, n.ticker, n.tags, n.created_at, n.updated_at,"
    " n.deleted_at, n.properties_json"
    " FROM j2_notes n"
    " WHERE n.user_id = ? AND n.deleted_at IS NULL"
    " AND (n.ticker IN ({ph})"
    " OR EXISTS (SELECT 1 FROM j2_note_embeds e WHERE e.note_id = n.id AND e.user_id = n.user_id AND e.symbol IN ({ph}))"
    " OR EXISTS (SELECT 1 FROM j2_note_mentions m WHERE m.note_id = n.id AND m.user_id = n.user_id AND m.symbol IN ({ph})))"
    " ORDER BY n.updated_at DESC LIMIT ?"
)
_OLD_DOCS_SQL = (
    "SELECT DISTINCT d.id, d.note_id, d.attachment_url, d.name, d.status,"
    " d.page_count, d.created_at{capture}"
    " FROM j2_note_documents d"
    " JOIN j2_notes n ON n.id = d.note_id AND n.user_id = d.user_id"
    " WHERE d.user_id = ? AND n.deleted_at IS NULL"
    " AND (n.ticker IN ({ph})"
    " OR EXISTS (SELECT 1 FROM j2_note_embeds e WHERE e.note_id = n.id AND e.user_id = n.user_id AND e.symbol IN ({ph}))"
    " OR EXISTS (SELECT 1 FROM j2_note_mentions m WHERE m.note_id = n.id AND m.user_id = n.user_id AND m.symbol IN ({ph})))"
    " ORDER BY d.created_at DESC LIMIT ?"
)


def _note(c, nid, user, minute, *, ticker=None, deleted=False):
    ts = f"2026-09-01T00:{minute:02d}:00+00:00"
    c.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, ticker,"
              " created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
              (nid, user, f"title {nid}", '{"type":"doc"}', f"body {nid}", "[]", ticker, ts, ts,
               ts if deleted else None))


def _embed(c, nid, user, pos, symbol):
    c.execute("INSERT INTO j2_note_embeds (note_id, user_id, position, widget_id, symbol)"
              " VALUES (?,?,?,'chart',?)", (nid, user, pos, symbol))


def _mention(c, nid, user, symbol):
    c.execute("INSERT INTO j2_note_mentions (note_id, user_id, symbol, created_at)"
              " VALUES (?,?,?,'2026-09-01')", (nid, user, symbol))


def _doc(c, did, nid, user, minute):
    c.execute("INSERT INTO j2_note_documents (id, user_id, note_id, attachment_url, name, status,"
              " created_at) VALUES (?,?,?,?,?,'ready',?)",
              (did, user, nid, f"/att/{did}.pdf", f"{did}.pdf", f"2026-09-02T00:{minute:02d}:00+00:00"))


@pytest.fixture
def conn(tmp_path):
    c = sqlite3.connect(str(tmp_path / "research.db"))
    c.row_factory = sqlite3.Row
    j2db.ensure_schema(c)
    # Every route in, every route out -- each note on its own minute (the product has no
    # tiebreak on updated_at, so equal stamps would make ANY order a correct one).
    _note(c, "n01", U, 1, ticker="AMD")                           # the note's own ticker
    _note(c, "n02", U, 2); _embed(c, "n02", U, 0, "AMD")           # a chart embed
    _note(c, "n03", U, 3); _mention(c, "n03", U, "AMD")            # a $cashtag mention
    _note(c, "n04", U, 4, ticker="AMD")                            # all three routes at once
    _embed(c, "n04", U, 0, "AMD"); _mention(c, "n04", U, "AMD")
    _note(c, "n05", U, 5); _embed(c, "n05", U, 0, "AMD"); _embed(c, "n05", U, 1, "AMD")  # two embeds
    _note(c, "n06", U, 6, deleted=True); _embed(c, "n06", U, 0, "AMD")                  # in the Trash
    _note(c, "n07", U, 7); _embed(c, "n07", U, 0, "NVDA")          # another symbol
    _note(c, "n08", V, 8, ticker="AMD"); _embed(c, "n08", V, 0, "AMD")                  # another member
    _note(c, "n09", U, 9)                                           # unrelated
    _note(c, "n10", U, 10); _mention(c, "n10", U, "XLNX")          # an alias symbol
    _note(c, "n11", U, 11); _embed(c, "n11", U, 0, None)           # an embed with no symbol
    for i in range(12, 20):                                         # enough to truncate at 5
        _note(c, f"n{i}", U, i); _mention(c, f"n{i}", U, "AMD")
    for i, nid in enumerate(("n01", "n02", "n03", "n06", "n07", "n08", "n09", "n10", "n15", "n04")):
        _doc(c, f"d{i:02d}", nid, V if nid == "n08" else U, i)
    c.commit()
    yield c
    c.close()


def _captured(conn, fn):
    """Every statement `fn` ran, as sqlite EXPANDED it (bound values inlined)."""
    stmts: list[str] = []
    conn.set_trace_callback(stmts.append)
    try:
        fn(conn)
    finally:
        conn.set_trace_callback(None)
    return stmts


READS = {
    "_notes_for_symbols": lambda c: tr._notes_for_symbols(U, ["AMD", "XLNX"], 5, c),
    "_theses_for_symbols": lambda c: tr._theses_for_symbols(U, ["AMD"], c),
    "_documents_for_symbols": lambda c: tr._documents_for_symbols(U, ["AMD", "XLNX"], 5, c),
}


@pytest.mark.parametrize("name", sorted(READS))
def test_the_workspace_reads_carry_no_correlated_sidecar_subquery(conn, name):
    stmts = [s for s in _captured(conn, READS[name])
             if s.lstrip().upper().startswith("SELECT") and "j2_note_embeds" in s]
    assert stmts, f"{name} ran no SELECT over the sidecars -- the rail would check nothing"
    for sql in stmts:
        steps = [r[3] for r in conn.execute("EXPLAIN QUERY PLAN " + sql)]
        assert not any("CORRELATED" in s for s in steps), (name, steps)


def _old_notes(conn, symbols, limit):
    from api.services.journal_two.notes import _LIST_PLAIN_CHARS
    ph = ",".join("?" * len(symbols))
    sql = _OLD_NOTES_SQL.format(chars=_LIST_PLAIN_CHARS, ph=ph)
    return [r["id"] for r in conn.execute(sql, (U, *symbols, *symbols, *symbols, limit))]


def _old_docs(conn, symbols, limit):
    from api.services.journal_two.web_capture import capture_columns
    ph = ",".join("?" * len(symbols))
    sql = _OLD_DOCS_SQL.format(capture=capture_columns(conn, "d"), ph=ph)
    return [r["id"] for r in conn.execute(sql, (U, *symbols, *symbols, *symbols, limit))]


CASES = [(["AMD"], 5), (["AMD"], 200), (["AMD", "NVDA", "XLNX"], 200), (["AMD", "XLNX"], 3),
         (["NVDA"], 200), (["ZZZ"], 200)]


@pytest.mark.parametrize("symbols,limit", CASES)
def test_old_and_new_notes_match_row_for_row_in_the_same_order(conn, symbols, limit):
    new = [n["id"] for n in tr._notes_for_symbols(U, symbols, limit, conn)]
    assert new == _old_notes(conn, symbols, limit)


@pytest.mark.parametrize("symbols,limit", CASES)
def test_old_and_new_documents_match_row_for_row_in_the_same_order(conn, symbols, limit):
    new = [d["id"] for d in tr._documents_for_symbols(U, symbols, limit, conn)]
    assert new == _old_docs(conn, symbols, limit)


def test_CONTROL_the_fixture_exercises_every_route_the_two_shapes_must_agree_on(conn):
    """Non-vacuity: a differential over an empty answer proves nothing."""
    got = [n["id"] for n in tr._notes_for_symbols(U, ["AMD", "XLNX"], 200, conn)]
    for nid in ("n01", "n02", "n03", "n04", "n05", "n10"):       # ticker, embed, mention, all, dup, alias
        assert nid in got, (nid, got)
    for nid in ("n06", "n07", "n08", "n09", "n11"):              # trash, other symbol/member, unrelated
        assert nid not in got, (nid, got)
    assert len(got) == len(set(got)), "a note matched twice"
    docs = [d["id"] for d in tr._documents_for_symbols(U, ["AMD"], 200, conn)]
    assert docs and "d03" not in docs and "d05" not in docs, docs  # trash note's doc, other member's doc
