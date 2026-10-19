"""P5-FIN-R1 (final review C1): every gallery row that reaches the one visibility rule carries `kind`.

Since P5, `_library_hides` reads `row["kind"]` whenever `_hidden_styles() == "firm"`: the library switch on and
the starter-packs switch off, which is production's state the day P5 merges. P3b's example reads build their own
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

SOURCE = Path(gallery.__file__)
VISIBILITY_CALLS = {"_can_see", "_library_hides"}
_SELECT = re.compile(r"SELECT\s+(?P<cols>.+?)\s+FROM\s+j2_template_gallery\b", re.S | re.I)


@pytest.fixture
def starter_off(monkeypatch):
    monkeypatch.delenv("NOTEBOOK_STARTER_PACKS_ENABLED", raising=False)


def test_the_state_under_test_is_the_firm_state(ex_on, starter_off):
    """Control: the switches below are exactly the state in which `_library_hides` reads `kind`."""
    assert gallery._hidden_styles() == "firm"
    assert gallery.example_enabled()


def test_a_stranger_reads_an_example_its_style_and_its_image_with_starter_off(api, conn, ex_on, ocr, att,
                                                                               starter_off):
    sid = _shared_style(conn, approve=True)
    nid = _note_with_files(conn, att, files=(("a.png", b"listed-bytes"),))
    gid = _publish(api, nid, sid, [_src("author", nid, "a.png")]).json()["template"]["id"]
    _approve(conn, gid)
    assert gallery._hidden_styles() == "firm"                       # library on, starter off: prod's state
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
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name not in VISIBILITY_CALLS:
            called = {c.func.id for c in ast.walk(node)
                      if isinstance(c, ast.Call) and isinstance(c.func, ast.Name)}
            if called & VISIBILITY_CALLS:
                yield node


def _explicit_gallery_selects(fn: ast.FunctionDef):
    for c in ast.walk(fn):
        if isinstance(c, ast.Constant) and isinstance(c.value, str):
            for m in _SELECT.finditer(c.value):
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
