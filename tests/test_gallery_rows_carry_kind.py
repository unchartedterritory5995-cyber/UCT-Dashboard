"""P5-FIN-R1 (final review C1): every gallery row that reaches the one visibility rule carries `kind`.

Since P5, `_library_hides` reads `row["kind"]` whenever `_hidden_styles()` hides a kind: the library switch on and
the starter-packs switch off, which is production's state the day P5 merges. Since wave 11 (Task 11.7) that answer is
`"firm+official"` while wave 11 is off too (production's state the day it merges): the rule then reads `kind` for the
official rows as well. P3b's example reads build their own
narrow SELECTs of the style an example shows (`_example_style_shown`, `_linked_style`) and of the example itself
(the image route), and pass those rows to `_can_see`. A SELECT that leaves `kind` out answers IndexError, so every
example read and every example image route answers 500 once NOTEBOOK_EXAMPLE_NOTES_ENABLED is armed. git merged
those SELECTs silently.

Two rails:
* behaviour: library ON, starter OFF, examples ON, a stranger reads an approved example, its style and its image,
  and each answers 200;
* structure: every function in template_gallery.py that calls `_can_see` or `_library_hides` and names an
  explicit column list FROM j2_template_gallery names both `item_type` and `kind` in it, so the next narrow
  SELECT fails here by name rather than as a 500 in production.

P4b final (the C1 class at the P4b merge): the same holds for P4b's LAYOUT reads, so the rails reach them too.
* behaviour: in the same firm state, with layout sharing on, every layout door a member or an admin walks
  answers (a stranger's read, adopt, Helpful, report, the author's status and a reshare, an admin's read of the
  held revision and its approval);
* structure, widened: the scan follows CALLERS transitively (`adopt_layout` reaches the rule through `_listed_row`;
  P5 landing review M-1), reads f-string SQL and a `JOIN j2_template_gallery`, and the two shared readers every
  layout row comes through, `_row` (`g.*`) and the list's `_LIST_COLUMNS`, are held to `item_type` and `kind`.
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

from api.services.journal_two import template_gallery as gallery
from tests._style_library_helpers import api, conn, lib_on  # noqa: F401  (fixtures)
from tests.test_example_notes import URL, _as, ex_on, ocr  # noqa: F401  (fixtures + helpers)
from tests.test_example_note_images import _approve, _note_with_files, _publish, att  # noqa: F401
from tests.test_example_notes import _shared_style, _src
from tests._style_library_helpers import TRADE, _save_pref, sharing_on  # noqa: F401  (fixture + helpers)
from tests.test_page_layout_adopt import _listed_layout

SOURCE = Path(gallery.__file__)
VISIBILITY_CALLS = {"_can_see", "_library_hides"}
# The column list never crosses a FROM; the gallery table is either the FROM table or a JOIN target behind one.
_SELECT = re.compile(r"SELECT\s+(?P<cols>(?:(?!\bFROM\b).)+?)\s+FROM\s+(?:j2_template_gallery\b"
                     r"|\w+(?:\s+\w+)?\s+(?:LEFT\s+|INNER\s+)?JOIN\s+j2_template_gallery\b)", re.S | re.I)


@pytest.fixture
def starter_off(monkeypatch):
    monkeypatch.delenv("NOTEBOOK_STARTER_PACKS_ENABLED", raising=False)
    monkeypatch.delenv("NOTEBOOK_WIDGETS_W11_ENABLED", raising=False)     # wave 11 off: production's state


def test_the_state_under_test_is_the_firm_state(ex_on, starter_off):
    """Control: the switches below are exactly the state in which `_library_hides` reads `kind`."""
    assert gallery._hidden_styles() == "firm+official"
    assert gallery.example_enabled()


def test_a_stranger_reads_an_example_its_style_and_its_image_with_starter_off(api, conn, ex_on, ocr, att,
                                                                               starter_off):
    sid = _shared_style(conn, approve=True)
    nid = _note_with_files(conn, att, files=(("a.png", b"listed-bytes"),))
    gid = _publish(api, nid, sid, [_src("author", nid, "a.png")]).json()["template"]["id"]
    _approve(conn, gid)
    assert gallery._hidden_styles() == "firm+official"              # library on, starter + wave 11 off: prod
    _as(api, "stranger")
    example = api.get(f"{URL}/{gid}")                                 # _can_see -> _example_style_shown
    assert example.status_code == 200, example.text
    assert example.json()["template"]["linkedStyle"]["id"] == sid     # _linked_style -> _can_see
    style = api.get(f"{URL}/{sid}")
    assert style.status_code == 200, style.text
    assert [e["id"] for e in style.json()["template"]["examples"]] == [gid]
    image = api.get(f"{URL}/{gid}/images/0")                          # the image route's own SELECT
    assert (image.status_code, image.content) == (200, b"listed-bytes")


def _functions_reaching_the_rule(tree: ast.Module):
    """Every function that calls the rule, AND every function that calls one of those, to any depth: a row a
    helper hands back (`_listed_row` to `adopt_layout`) reaches the rule as surely as one read in place."""
    fns = [n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)]
    calls = {f.name: {c.func.id for c in ast.walk(f) if isinstance(c, ast.Call) and isinstance(c.func, ast.Name)}
             for f in fns}
    reach = set(VISIBILITY_CALLS)
    grew = True
    while grew:
        grew = False
        for name, called in calls.items():
            if name not in reach and called & reach:
                reach.add(name)
                grew = True
    for f in fns:
        if f.name in reach and f.name not in VISIBILITY_CALLS:
            yield f


def _sql_strings(fn: ast.FunctionDef):
    """Every SQL text in the function, once each: plain strings, and f-strings whole, with each `{...}` read as a
    placeholder (an f-string's literal pieces are not read again on their own)."""
    inside = {id(p) for j in ast.walk(fn) if isinstance(j, ast.JoinedStr) for p in j.values}
    for c in ast.walk(fn):
        if isinstance(c, ast.Constant) and isinstance(c.value, str) and id(c) not in inside:
            yield c.value
        elif isinstance(c, ast.JoinedStr):
            yield "".join(p.value if isinstance(p, ast.Constant) else "{}" for p in c.values)


def _explicit_gallery_selects(fn: ast.FunctionDef):
    for text in _sql_strings(fn):
        for m in _SELECT.finditer(text):
            cols = m.group("cols").strip()
            if cols not in ("*", "g.*") and "COUNT(" not in cols.upper():
                yield {x.strip().split(".")[-1] for x in cols.split(",")}


def test_every_explicit_select_that_reaches_the_rule_names_item_type_and_kind():
    tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
    seen, missing = 0, []
    for fn in _functions_reaching_the_rule(tree):
        for cols in _explicit_gallery_selects(fn):
            seen += 1
            if not {"item_type", "kind"} <= cols:
                missing.append((fn.name, sorted(cols)))
    assert seen >= 4, f"the scan found only {seen} SELECTs: it has stopped seeing the reads it guards"
    assert missing == [], missing


def test_the_scan_follows_layout_callers_and_holds_the_shared_readers():
    """P4b final C1: the layout doors are in the scan's reach, and the two readers their rows come through carry
    both columns: `_row` reads `g.*` and the list's columns name `g.item_type` and `g.kind`."""
    tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
    reached = {f.name for f in _functions_reaching_the_rule(tree)}
    assert {"adopt_layout", "get_item", "set_helpful", "report", "admin_act", "_listed_row", "use_template"} <= reached
    assert "g.*" in gallery._select()
    listed = {c.strip().split(".")[-1] for c in gallery._LIST_COLUMNS.rstrip(",").split(",")}
    assert {"item_type", "kind", "source_page"} <= listed


def test_the_widened_scan_sees_a_caller_an_fstring_and_a_join():
    """Control: each widening can fail. A narrow SELECT one call away from the rule, in an f-string, and behind a
    JOIN, each surfaces without `kind`."""
    bad = ast.parse(
        "def helper(conn, gid):\n"
        "    return conn.execute('SELECT g.* FROM j2_template_gallery g WHERE id = ?', (gid,)).fetchone()\n"
        "def rule_user(row):\n"
        "    return _library_hides(row)\n"
        "def caller(conn, gid, t):\n"
        "    row = conn.execute(f'SELECT id, item_type FROM j2_template_gallery WHERE {t} = ?', (gid,)).fetchone()\n"
        "    other = conn.execute('SELECT g.id, g.item_type FROM j2_template_gallery_uses x'\n"
        "                         ' JOIN j2_template_gallery g ON g.id = x.gallery_id').fetchone()\n"
        "    return rule_user(row) or rule_user(other)\n")
    fns = {f.name: f for f in _functions_reaching_the_rule(bad)}
    assert set(fns) == {"rule_user", "caller"}
    assert sorted(sorted(c) for c in _explicit_gallery_selects(fns["caller"])) == [["id", "item_type"],
                                                                                   ["id", "item_type"]]


def test_every_layout_door_answers_in_the_firm_state(conn, ex_on, starter_off, sharing_on):
    """P4b final C1, behaviour: library on, starter packs off (`_library_hides` reads `kind`), examples on and layout
    sharing on. Each layout door a member, its author or an admin walks reads a row that reaches the rule; a narrow
    SELECT on any of them is an IndexError here."""
    assert gallery._hidden_styles() == "firm+official" and gallery.layout_sharing_enabled()   # the state under test
    gid = _listed_layout(conn)
    assert gallery.get_item("stranger", gid, conn=conn)["itemType"] == "page_layout"
    assert gallery.adopt_layout("stranger", gid, version=1, conn=conn)["version"] == 1
    assert gallery.set_helpful("stranger", gid, True, conn=conn)["helpful"] is True
    assert gallery.report("stranger", gid, reason="spam", note="", conn=conn) is not None
    status = gallery.layout_status("author", conn=conn)
    assert status["shared"]["trade"]["id"] == gid
    _save_pref(conn, "author", {"version": 1, "trade": list(reversed(TRADE))})
    held = gallery.publish_layout("author", "trade", title="Prop trade page", description="", category="journal",
                                  trading_style="prop", conn=conn)
    assert held["hasRevision"] is True
    full = gallery.get_item("admin", gid, is_admin=True, conn=conn)
    assert full["pendingRevision"]["payload"]["lists"]["trade"] == list(reversed(TRADE))
    approved = gallery.admin_act("admin", gid, "approve", reviewed_updated_at=full["updatedAt"], conn=conn)
    assert approved is not None


def test_the_scan_can_see_a_select_without_kind():
    """Control: the scan is not vacuous. A function shaped like P3b's pre-fix `_example_style_shown` fails it."""
    bad = ast.parse(
        "def f(conn, link):\n"
        "    style = conn.execute('SELECT id, user_id, item_type, status, hidden FROM j2_template_gallery'\n"
        "                         ' WHERE id = ?', (link,)).fetchone()\n"
        "    return _can_see(style, '', False, conn)\n")
    fns = list(_functions_reaching_the_rule(bad))
    assert [f.name for f in fns] == ["f"]
    assert [sorted(c) for c in _explicit_gallery_selects(fns[0])] == [["hidden", "id", "item_type", "status",
                                                                        "user_id"]]
