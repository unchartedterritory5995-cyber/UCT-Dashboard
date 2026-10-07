"""Security review finding I-4 (and the related MINOR M-8): a community-gallery template may
carry only attributes the server has named, with values the server has checked.

Before this, the gallery copy kept EVERY attribute of a kept node and EVERY attribute of a kept
mark. TipTap's FontFamily and FontSize write their attribute straight into an inline `style`
(`style: `font-family: ${attributes.fontFamily}``), so one member's published template could
put CSS into another member's editor, and the admin preview does not render that style.

What is pinned here:
  * HOSTILE VALUES NEVER REACH THE STORED TEMPLATE (publish time), THE SERVED TEMPLATE
    (preview), OR THE COPY IN ANOTHER MEMBER'S TEMPLATES (use time). Each hostile value is tried
    in every attribute position, in unknown attributes, and as an unknown top-level key.
  * DEFENCE IN DEPTH: a hostile row written straight into the gallery table (as if it were
    published before this fix) is cleaned again when it is served and when it is used.
  * A fixture that CAN tell the right filter from a wrong one: the toolbar's own values all
    survive, unchanged.
  * The value lists are the client's: the font list, the colour palette, the callout styles
    and the embed providers are PARSED from the client files and held equal.
  * M-8: an email address or an in-app address inside attribute text is scrubbed too.
"""
from __future__ import annotations

import importlib
import json
import os
import re
import sqlite3
import tempfile
import uuid
from pathlib import Path

import pytest

from api.services.journal_two import public_note_payload as public

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "app" / "src"
A, B, ADMIN = "user-sec-author", "user-sec-member", "user-sec-admin"

LONG = "L0NGVALUE" * 600                       # 5,400 characters

#: (label, hostile value, the fragment that must not survive anywhere).
HOSTILE = [
    ("position-fixed", "x;position:fixed;inset:0", "position:fixed"),
    ("spaced", "Arial; position: fixed; inset: 0; opacity: 0", "position: fixed"),
    ("url", "x;background-image:url(https://evil.example/p)", "url("),
    ("expression", "expression(alert(1))", "expression("),
    ("close-style", "</style><script>alert(1)</script>", "</style>"),
    ("long", LONG, "L0NGVALUE"),
    ("css-escape", "x;\\70 osition:fixed", "\\70 osition"),
    ("unicode-escape", "x;position:fixed", "position:fixed"),
    ("important", "red !important; display:none", "!important"),
    ("js-url", "javascript:alert(1)", "javascript:"),
    ("data-url", "data:text/html;base64,PHNjcmlwdD4=", "data:text"),
    ("quote-break", "\"><img src=x onerror=alert(1)>", "onerror"),
]


def t(s, *marks):
    n = {"type": "text", "text": s}
    if marks:
        n["marks"] = list(marks)
    return n


def p(*inline, **extra):
    return {"type": "paragraph", "content": list(inline), **extra}


def _hostile_body(h):
    """`h` in every attribute position the gallery keeps, in attributes nobody declared, and
    as a key no node has."""
    return {"type": "doc", "style": h, "content": [
        {"type": "heading", "attrs": {"level": h, "style": h, "class": h}, "content": [t("Plan")]},
        {"type": "heading", "attrs": {"level": 99}, "content": [t("Deep")]},
        p(t("styled", {"type": "textStyle", "attrs": {"fontFamily": h, "fontSize": h, "color": h, "style": h}}),
          style=h, attrs={"style": h, "textAlign": h}),
        p(t("coloured", {"type": "textColor", "attrs": {"color": h}}),
          t("marked", {"type": "highlight", "attrs": {"color": h}}),
          t("bold", {"type": "bold", "attrs": {"style": h}, "style": h})),
        p(t("link", {"type": "link", "attrs": {"href": "https://example.com/ok", "target": h, "rel": h,
                                                 "class": h, "title": h}}),
          t("bad link", {"type": "link", "attrs": {"href": h}})),
        {"type": "callout", "attrs": {"emoji": h, "variant": h}, "content": [p(t("note"))]},
        {"type": "codeBlock", "attrs": {"language": h}, "content": [t("x = 1")]},
        {"type": "orderedList", "attrs": {"start": h, "type": h}, "content": [
            {"type": "listItem", "attrs": {"style": h}, "content": [p(t("one"))]}]},
        {"type": "taskList", "content": [
            {"type": "taskItem", "attrs": {"checked": h, "style": h}, "content": [p(t("task"))]}]},
        {"type": "toggle", "attrs": {"open": h}, "content": [
            {"type": "toggleSummary", "content": [t("more")]},
            {"type": "toggleContent", "content": [p(t("inside"))]}]},
        {"type": "table", "content": [{"type": "tableRow", "content": [
            {"type": "tableHeader", "attrs": {"colspan": h, "rowspan": h, "colwidth": [h], "align": h,
                                              "style": h, "backgroundColor": h},
             "content": [p(t("H"))]},
            {"type": "tableCell", "attrs": {"colspan": 1, "rowspan": 1, "colwidth": h, "align": h},
             "content": [p(t("C"))]}]}]},
        # title and description are the card's WORDS (rendered as text, shown in the admin
        # preview): they are capped and scrubbed, not matched against a list, so they are
        # tested on their own below.
        {"type": "linkPreview", "attrs": {"url": "https://example.com/a", "title": "A page",
                                          "description": "About it", "domain": h, "image": h,
                                          "style": h, "favicon": h}},
        {"type": "linkPreview", "attrs": {"url": h, "title": "gone"}},
        {"type": "webEmbed", "attrs": {"provider": h, "ref": h, "url": h}},
        {"type": "webEmbed", "attrs": {"provider": "youtube", "ref": h, "url": "https://youtu.be/x"}},
        {"type": "dateMention", "attrs": {"date": h}},
        {"type": "videoTimestamp", "attrs": {"seconds": h}},
        {"type": "blockMath", "attrs": {"latex": "\\href{" + h + "}{x}"}},
        p({"type": "inlineMath", "attrs": {"latex": "\\htmlStyle{" + h + "}{x}"}}),
    ]}


def _strings(node):
    """Every string in a document: values AND keys."""
    if isinstance(node, dict):
        for k, v in node.items():
            yield k
            yield from _strings(v)
    elif isinstance(node, list):
        for v in node:
            yield from _strings(v)
    elif isinstance(node, str):
        yield node


def _assert_clean(doc, fragment, where):
    hits = [s[:80] for s in _strings(doc) if fragment in s]
    assert not hits, f"{fragment!r} reached {where}: {hits[:3]}"


def _gallery(body):
    return public.reduce(body, mode="gallery", owner_id=A, note_id="", attachment_base="",
                         facts={}, note_links={})


# ── the reducer ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("label,hostile,fragment", HOSTILE, ids=[h[0] for h in HOSTILE])
def test_a_hostile_value_survives_nowhere_in_a_gallery_copy(label, hostile, fragment):
    out = _gallery(_hostile_body(hostile))
    _assert_clean(out, fragment, "the gallery copy")
    # and the words themselves are all still there: the filter did not just empty the document
    flat = json.dumps(out)
    for kept in ("Plan", "styled", "coloured", "marked", "link", "note", "x = 1", "one", "task",
                 "inside", "https://example.com/ok"):
        assert kept in flat, kept


def test_CONTROL_the_same_values_do_survive_the_modes_this_fix_does_not_touch():
    """The hostile fixture really carries the value: share mode (out of this lane's scope, see
    docs/notebook/fin-sec.md) still shows it, so the assertions above measure the gallery
    filter and not an empty fixture."""
    hostile, fragment = HOSTILE[0][1], HOSTILE[0][2]
    out = public.reduce(_hostile_body(hostile), mode="share", owner_id=A, note_id="n1",
                        attachment_base="/api/share/x/", facts={}, note_links={})
    assert any(fragment in s for s in _strings(out))


def _toolbar_body():
    """What the editor's own controls produce."""
    return {"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 3}, "content": [t("Plan")]},
        p(t("styled", {"type": "textStyle", "attrs": {"fontFamily": "Georgia, \"Times New Roman\", serif",
                                                       "fontSize": "18px"}}),
          t("red", {"type": "textColor", "attrs": {"color": "red"}}),
          t("hl", {"type": "highlight", "attrs": {"color": "yellow"}}),
          t("plain hl", {"type": "highlight", "attrs": {"color": None}}),
          t("a link", {"type": "link", "attrs": {"href": "https://example.com/guide", "target": "_blank",
                                                  "rel": "noreferrer"}})),
        {"type": "callout", "attrs": {"emoji": "🔥", "variant": "warning"}, "content": [p(t("note"))]},
        {"type": "codeBlock", "attrs": {"language": "python"}, "content": [t("x = 1")]},
        {"type": "orderedList", "attrs": {"start": 3, "type": None}, "content": [
            {"type": "listItem", "content": [p(t("one"))]}]},
        {"type": "toggle", "attrs": {"open": False}, "content": [
            {"type": "toggleSummary", "content": [t("more")]},
            {"type": "toggleContent", "content": [p(t("inside"))]}]},
        {"type": "table", "content": [{"type": "tableRow", "content": [
            {"type": "tableHeader", "attrs": {"colspan": 2, "rowspan": 1, "colwidth": [120, 80], "align": "center"},
             "content": [p(t("H"))]},
            {"type": "tableCell", "attrs": {"colspan": 1, "rowspan": 1, "colwidth": None, "align": None},
             "content": [p(t("C"))]}]}]},
        {"type": "linkPreview", "attrs": {"url": "https://example.com/a", "title": "A page",
                                          "description": "About it", "domain": "example.com", "image": None}},
        {"type": "webEmbed", "attrs": {"provider": "youtube", "ref": "dQw4w9WgXcQ",
                                       "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}},
        {"type": "webEmbed", "attrs": {"provider": "tradingview", "ref": "NASDAQ:NVDA", "url": None}},
        p({"type": "dateMention", "attrs": {"date": "2026-10-02"}},
          {"type": "videoTimestamp", "attrs": {"seconds": 95}},
          {"type": "inlineMath", "attrs": {"latex": "R = \\frac{reward}{risk}"}}),
        {"type": "blockMath", "attrs": {"latex": "E = p \\cdot W - (1 - p) \\cdot L"}},
    ]}


def test_what_the_toolbar_writes_passes_through_unchanged():
    body = _toolbar_body()
    assert _gallery(body) == body


def test_the_filter_is_stable_run_twice():
    for body in (_toolbar_body(), _hostile_body(HOSTILE[0][1])):
        once = _gallery(body)
        assert _gallery(once) == once


def test_a_font_size_is_a_number_of_pixels_in_range():
    def size_after(v):
        out = _gallery({"type": "doc", "content": [p(t("x", {"type": "textStyle", "attrs": {"fontSize": v}}))]})
        marks = out["content"][0]["content"][0].get("marks") or []
        return marks[0]["attrs"].get("fontSize") if marks else None
    assert size_after("8px") == "8px" and size_after("72px") == "72px" and size_after("96px") == "96px"
    for bad in ("7px", "97px", "999px", "12", "12pt", "1e9px", "12px;color:red", " 12px", "12PX", 12, True, None):
        assert size_after(bad) is None, bad


def test_a_link_is_http_or_https_only_and_carries_fixed_target_and_rel():
    def link_after(attrs):
        out = _gallery({"type": "doc", "content": [p(t("x", {"type": "link", "attrs": attrs}))]})
        marks = out["content"][0]["content"][0].get("marks") or []
        return marks[0]["attrs"] if marks else None
    ok = link_after({"href": "https://example.com/a?b=1", "target": "_self", "rel": "opener", "class": "x"})
    assert ok == {"href": "https://example.com/a?b=1", "target": "_blank", "rel": "noreferrer"}
    assert link_after({"href": "http://example.com/"})["href"] == "http://example.com/"
    for bad in ("javascript:alert(1)", "data:text/html,x", "ftp://example.com/x", "//example.com/x",
                "vbscript:x", " https://example.com/" + "a" * 3000, "https://exa mple.com/\"onmouseover=x",
                "https://example.com/<script>"):
        assert link_after({"href": bad}) is None, bad


def test_M8_text_inside_attributes_gets_the_gallery_scrub():
    body = {"type": "doc", "content": [
        {"type": "linkPreview", "attrs": {"url": "https://example.com/a",
                                          "title": "Mail trader@example.com",
                                          "description": "see https://uctintelligence.com/journal/notebook?note=SECRET-ID",
                                          "domain": "trader@example.com"}},
        {"type": "blockMath", "attrs": {"latex": "\\text{ask trader@example.com}"}},
    ]}
    out = _gallery(body)
    for s in _strings(out):
        assert "trader@example.com" not in s and "SECRET-ID" not in s, s
    flat = json.dumps(out)
    assert public.EMAIL_TEXT in flat and public.IN_APP_LINK_TEXT in flat


def test_a_link_cards_words_are_capped_and_stay_words():
    out = _gallery({"type": "doc", "content": [
        {"type": "linkPreview", "attrs": {"url": "https://example.com/a", "title": LONG,
                                          "description": LONG, "domain": "example.com"}}]})
    attrs = out["content"][0]["attrs"]
    assert len(attrs["title"]) == 300 and len(attrs["description"]) == 600
    assert set(attrs) == {"url", "title", "description", "domain"}
    for bad in (5, ["x"], {"a": 1}, True):
        out = _gallery({"type": "doc", "content": [
            {"type": "linkPreview", "attrs": {"url": "https://example.com/a", "title": bad}}]})
        assert "title" not in out["content"][0]["attrs"]


# ── the value lists are the client's ─────────────────────────────────────────

def test_the_font_list_is_the_toolbars():
    src = (SRC / "utils" / "fontFamilies.js").read_text(encoding="utf-8")
    block = src.split("export const FONT_OPTIONS", 1)[1].split("])", 1)[0]
    values = [json.loads('"' + m.replace('\\"', '"').replace('"', '\\"') + '"')
              for m in re.findall(r"value:\s*'([^']*)'", block)]
    values = [v for v in values if v]
    assert len(values) >= 20, "the font table did not parse"
    assert set(public.GALLERY_FONT_FAMILIES) == set(values)


def test_the_colour_palette_callout_styles_and_embed_providers_are_the_clients():
    lib = SRC / "pages" / "journal-2-0" / "lib"
    colours = lib.joinpath("textColor.js").read_text(encoding="utf-8")
    block = colours.split("export const NOTE_COLORS", 1)[1].split("]", 1)[0]
    names = re.findall(r"name:\s*'([a-z]+)'", block)
    assert len(names) >= 4 and set(public.GALLERY_COLOR_NAMES) == set(names)

    callout = lib.joinpath("calloutNode.js").read_text(encoding="utf-8")
    line = re.search(r"export const CALLOUT_VARIANTS = Object\.freeze\(\[([^\]]*)\]\)", callout).group(1)
    assert set(public.GALLERY_CALLOUT_VARIANTS) == set(re.findall(r"'([a-z]+)'", line))

    embeds = lib.joinpath("webEmbeds.js").read_text(encoding="utf-8")
    block = embeds.split("export const EMBED_PROVIDERS = Object.freeze({", 1)[1]
    providers = re.findall(r"^  ([a-z]+): \{", block, flags=re.MULTILINE)
    assert len(providers) >= 2 and set(public.GALLERY_EMBED_REFS) == set(providers)


def test_every_kept_type_with_attributes_has_a_row_and_no_dropped_type_does():
    """A type the gallery keeps but the table does not name loses ALL its attributes (fail
    closed). This pins the rows that exist today, so removing one is a decision."""
    kept = {name for name, row in public.NODE_POLICY.items()
            if row["gallery"] in ("keep", "task", "mark", "link-mark")}
    assert set(public.GALLERY_ATTR_POLICY) <= kept, set(public.GALLERY_ATTR_POLICY) - kept
    for required in ("heading", "orderedList", "codeBlock", "taskItem", "tableCell", "tableHeader",
                     "callout", "toggle", "linkPreview", "webEmbed", "dateMention", "videoTimestamp",
                     "inlineMath", "blockMath", "link", "textStyle", "textColor", "highlight"):
        assert required in public.GALLERY_ATTR_POLICY, required


# ── publish time, serve time, use time ───────────────────────────────────────

@pytest.fixture
def svc(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = auth_db.get_connection()
    for uid in (A, B, ADMIN):
        conn.execute("INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)",
                     (uid, f"{uid}@example.com", "x", uid, "admin" if uid == ADMIN else "member"))
    conn.commit()
    conn.close()
    from api.services.journal_two import template_gallery
    yield template_gallery
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


def _conn() -> sqlite3.Connection:
    from api.services.auth_db import get_connection
    return get_connection()


def _member_template(owner, body):
    tid = uuid.uuid4().hex
    c = _conn()
    c.execute("INSERT INTO j2_note_templates (id, user_id, name, title, body_json, properties_json,"
              " created_at, updated_at) VALUES (?,?,?,?,?,NULL,?,?)",
              (tid, owner, "T", "T", json.dumps(body), "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z"))
    c.commit()
    c.close()
    return tid


def _one(sql, *args):
    c = _conn()
    try:
        return c.execute(sql, args).fetchone()[0]
    finally:
        c.close()


@pytest.mark.parametrize("label,hostile,fragment", HOSTILE[:6], ids=[h[0] for h in HOSTILE[:6]])
def test_publish_approve_preview_and_use_never_carry_a_hostile_value(svc, label, hostile, fragment):
    tid = _member_template(A, _hostile_body(hostile))
    item = svc.publish(A, tid, title="Checklist", description="d", category="trade_plan")
    gid = item["id"]
    stored = json.loads(_one("SELECT body_json FROM j2_template_gallery WHERE id = ?", gid))
    _assert_clean(stored, fragment, "the stored gallery template")

    svc.admin_act(ADMIN, gid, "approve")
    served = svc.get_item(B, gid)
    _assert_clean(served["bodyJson"], fragment, "the served gallery template")

    used = svc.use_template(B, gid)
    copy = json.loads(_one("SELECT body_json FROM j2_note_templates WHERE id = ?", used["template"]["id"]))
    _assert_clean(copy, fragment, "the copy in another member's templates")
    assert "styled" in json.dumps(copy)


def test_a_hostile_row_already_in_the_gallery_is_cleaned_when_served_and_when_used(svc):
    """Defence in depth: the stored row is hostile (written as if before this fix)."""
    hostile, fragment = HOSTILE[0][1], HOSTILE[0][2]
    gid = uuid.uuid4().hex
    c = _conn()
    c.execute("INSERT INTO j2_template_gallery (id, user_id, source_template_id, kind, title, description,"
              " category, body_json, status, listed_at, created_at, updated_at)"
              " VALUES (?, ?, 'src-1', 'member', 'Old', '', 'journal', ?, 'approved', ?, ?, ?)",
              (gid, A, json.dumps(_hostile_body(hostile)), "2026-10-01T00:00:00Z",
               "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z"))
    c.commit()
    c.close()
    assert fragment in _one("SELECT body_json FROM j2_template_gallery WHERE id = ?", gid), "the fixture is not hostile"

    _assert_clean(svc.get_item(B, gid)["bodyJson"], fragment, "the served gallery template")
    used = svc.use_template(B, gid)
    copy = json.loads(_one("SELECT body_json FROM j2_note_templates WHERE id = ?", used["template"]["id"]))
    _assert_clean(copy, fragment, "the copy in another member's templates")
    assert "styled" in json.dumps(copy)
