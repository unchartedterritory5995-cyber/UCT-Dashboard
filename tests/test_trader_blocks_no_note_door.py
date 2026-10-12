"""Spec §P2 integrity rule, server half: trader blocks write no note, and no trader-blocks route is a
note-write door. Read by AST, with controls.

What is scanned (each must hold, each is non-vacuous):
  * api/services/journal_two/trader_blocks.py, whole;
  * api/services/journal_two/adherence_store.py, whole (the pre-entry PUT's write path);
  * every route in api/routers/notebook_journal_styles.py whose path starts `/trader-blocks`,
    found from the DECORATORS (never a typed list of function names).

What counts as a note write, DERIVED, never listed by hand:
  * SQL in a string literal that inserts into, updates, replaces into or deletes from any
    `j2_note*` table;
  * a reference to any function under api/services/journal_two/ (tests excluded) that runs such
    SQL, directly or through a function of its own module that does. The brief's eight writer
    names are a FLOOR the derivation must reach, which proves the derivation is not empty.

CODE, NEVER PROSE: comments are not in the AST, and string statements (docstrings, bare strings)
are removed before the scan, so a sentence ABOUT a write is not a write. The controls below prove
both directions: a planted write is seen, and a comment or docstring naming one is not.

Note: `notes.get_note` is NOT a read for this rail. It backfills `first_image_url` with an
`UPDATE j2_notes`, so the derivation classes it a writer; the read control uses `list_notes`.
"""
from __future__ import annotations

import ast
import re
import sys
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRADER_BLOCKS = ROOT / "api/services/journal_two/trader_blocks.py"
ADHERENCE_STORE = ROOT / "api/services/journal_two/adherence_store.py"
ROUTER = ROOT / "api/routers/notebook_journal_styles.py"
WRITER_TREE = ROOT / "api/services/journal_two"

#: The plan's writer names: a floor the derivation must reach, not the definition of a writer.
FLOOR = {"create_note", "update_note", "append_widget_embed", "append_financial_fact",
         "append_document_excerpt", "restore_note", "restore_note_version", "patch_note_tags"}

_WRITE_SQL = re.compile(
    r"\b(?:insert(?:\s+or\s+\w+)?\s+into|update|delete\s+from|replace\s+into)\s+j2_note\w*", re.I)


def _writes_sql(text: str) -> bool:
    return bool(_WRITE_SQL.search(" ".join(text.split())))


def _without_prose(tree: ast.AST) -> ast.AST:
    """Drop every string STATEMENT (docstrings and bare strings): prose, not code."""
    for node in ast.walk(tree):
        body = getattr(node, "body", None)
        if isinstance(body, list):
            node.body = [s for s in body
                         if not (isinstance(s, ast.Expr) and isinstance(s.value, ast.Constant)
                                 and isinstance(s.value.value, str))] or [ast.Pass()]
    return tree


@lru_cache(maxsize=1)
def note_writers() -> frozenset[str]:
    """Every module-level function under api/services/journal_two that writes a j2_note* table,
    directly or through a function of its own module that does."""
    found: set[str] = set()
    for path in sorted(WRITER_TREE.rglob("*.py")):
        if path.name.startswith("test_") or "__pycache__" in path.parts:
            continue
        tree = _without_prose(ast.parse(path.read_text(encoding="utf-8")))
        funcs = {n.name: n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
        writers = {name for name, f in funcs.items()
                   if any(isinstance(c, ast.Constant) and isinstance(c.value, str) and _writes_sql(c.value)
                          for c in ast.walk(f))}
        calls = {name: {c.func.id for c in ast.walk(f)
                        if isinstance(c, ast.Call) and isinstance(c.func, ast.Name) and c.func.id in funcs}
                 for name, f in funcs.items()}
        grew = True
        while grew:
            grew = False
            for name, callees in calls.items():
                if name not in writers and callees & writers:
                    writers.add(name)
                    grew = True
        found |= writers
    return frozenset(found)


def problems(src: str | ast.AST) -> list[str]:
    tree = _without_prose(ast.parse(src)) if isinstance(src, str) else src
    writers = note_writers()
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and _writes_sql(node.value):
            out.append(f"SQL on a note table: {node.value[:60]}")
        if isinstance(node, ast.Attribute) and node.attr in writers:
            out.append(f"calls a note writer: {node.attr}")
        if isinstance(node, ast.Name) and node.id in writers:
            out.append(f"names a note writer: {node.id}")
        if isinstance(node, ast.ImportFrom):
            out += [f"imports a note writer: {a.name}" for a in node.names if a.name in writers or a.name == "*"]
    return out


def trader_block_routes() -> dict[str, ast.AST]:
    """The router's `/trader-blocks...` route functions, found from their decorators."""
    tree = _without_prose(ast.parse(ROUTER.read_text(encoding="utf-8")))
    out = {}
    for node in tree.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for dec in node.decorator_list:
            if (isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute)
                    and isinstance(dec.func.value, ast.Name) and dec.func.value.id == "router"
                    and dec.args and isinstance(dec.args[0], ast.Constant)
                    and str(dec.args[0].value).startswith("/trader-blocks")):
                out[node.name] = node
    return out


# ── the rails ─────────────────────────────────────────────────────────────────────────────

def test_the_writer_derivation_reaches_the_floor():
    writers = note_writers()
    assert FLOOR <= writers, f"the derivation missed {sorted(FLOOR - writers)}: it is not reading the code"
    assert "list_notes" not in writers                                   # the read the control uses


def test_trader_blocks_writes_no_note():
    src = TRADER_BLOCKS.read_text(encoding="utf-8")
    tree = ast.parse(src)
    defined = {n.name for n in tree.body if isinstance(n, ast.FunctionDef)}
    assert {"build_position_sizing", "save_pre_entry"} <= defined          # non-vacuity: the real file
    assert problems(src) == []


def test_the_pre_entry_write_path_writes_no_note():
    src = ADHERENCE_STORE.read_text(encoding="utf-8")
    assert "def upsert_adherence" in src                                  # non-vacuity: the real file
    assert problems(src) == []


def test_no_trader_blocks_route_is_a_note_door():
    routes = trader_block_routes()
    assert {"trader_market_context", "trader_pre_entry"} <= set(routes), sorted(routes)
    for name, fn in routes.items():
        assert problems(ast.Module(body=[fn], type_ignores=[])) == [], name


# ── controls: a planted write is seen; prose about a write is not ───────────────────────────

def test_control_a_planted_write_is_seen():
    assert problems('conn.execute("UPDATE j2_notes SET title = ?")')
    assert problems('conn.execute("""INSERT OR REPLACE INTO\n   j2_notes (id) VALUES (?)""")')
    assert problems('c.execute("DELETE FROM j2_note_versions WHERE id = ?")')
    assert problems('c.execute(f"update j2_notes set body_json = {x}")')
    assert problems("notes_service.update_note(u, n, {})")
    assert problems("from api.services.journal_two.notes import create_note")
    assert problems("from api.services.journal_two.notes import *")
    assert problems("f = create_note")
    assert problems("notes.get_note(u, n)")                              # it writes: see the docstring


def test_control_prose_about_a_write_is_not_a_write():
    assert problems('# conn.execute("UPDATE j2_notes SET body_json = ?") and notes.update_note(...)\nx = 1') == []
    assert problems('def f():\n    """Never calls create_note or UPDATE j2_notes SET body_json."""\n    return 1') == []
    assert problems('"""module prose: INSERT INTO j2_notes, restore_note_version"""\nx = 2') == []
    assert problems("x = notes.list_notes(u)") == []                     # a read is not a write
    assert problems('conn.execute("SELECT body_json FROM j2_notes WHERE id = ?")') == []
    assert problems('conn.execute("INSERT OR REPLACE INTO j2_trade_adherence (user_id) VALUES (?)")') == []


def test_control_the_route_scan_sees_a_planted_door(tmp_path, monkeypatch):
    """The decorator scan must see a planted trader-blocks route that writes a note."""
    planted = tmp_path / "router.py"
    planted.write_text(
        '@router.put("/trader-blocks/x")\n'
        'def planted(user):\n'
        '    """R-P2-7: writes the adherence store, never a note."""\n'
        '    return notes_service.update_note(user["id"], "n", {})\n'
        '@router.get("/journal-styles")\n'
        'def other():\n'
        '    return notes_service.create_note("u", {})\n', encoding="utf-8")
    monkeypatch.setattr(sys.modules[__name__], "ROUTER", planted)
    routes = trader_block_routes()
    assert set(routes) == {"planted"}
    assert problems(ast.Module(body=[routes["planted"]], type_ignores=[])) == ["calls a note writer: update_note"]
