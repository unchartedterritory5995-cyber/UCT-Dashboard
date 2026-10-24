"""Wave 8 lane 8B -- the ONE public reducer (`api/services/journal_two/public_note_payload.py`),
node type by node type, in both modes.

⛔ THE TYPE LIST IS DERIVED, NEVER TYPED. Node imports `app/src/pages/journal-2-0/lib/
notebookSchema.js` (the table the editor's own schema guard reads) and hands back
`NOTEBOOK_TYPE_SCHEMA`'s keys: every node AND mark type a stored note can hold. For each one
this file declares what share mode and publish mode must do (`EXPECTED`) and builds a fixture
that holds it (`FIXTURES`). A type added to the editor tomorrow fails BY NAME here -- in the
reducer's `NODE_POLICY` and in this file -- until somebody decides what a stranger sees.

⛔ THE VENDOR TABLE IS DERIVED TOO. Every widget id in `app/src/widgets/registry.js` must have a
vendor row, and every fact `source` in `fact_registry.Source` must too. The owner's legal
sign-off (2026-09-25, L3 and its correction) is asserted in words: FMP and Finnhub figures
render; Massive-sourced charts and bar widgets are the neutral line; documentExcerpt follows
D-B4 unchanged (neutral).

The last section is the flip packet's "NEVER" list (`docs/notebook/share-publish-flip-packet.md`),
one test per item, against a published note.
"""
from __future__ import annotations

import copy
import functools
import json
import shutil
import subprocess
import tempfile
import typing
from pathlib import Path
from typing import Any, Callable

import pytest

from api.services.journal_two import public_note_payload as pnp

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_JS = ROOT / "app" / "src" / "pages" / "journal-2-0" / "lib" / "notebookSchema.js"
REGISTRY_JS = ROOT / "app" / "src" / "widgets" / "registry.js"

OWNER, NOTE, OTHER = "owner-u1", "note-n1", "other-n2"
BASE = "/api/j2/shared/TOK/att/"
OWN_ATT = f"/api/j2/notes/attachments/{OWNER}/{NOTE}/"
OTHER_ATT = f"/api/j2/notes/attachments/{OWNER}/{OTHER}/"

_HOOK = r"""
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[a-zA-Z]+$/.test(specifier)) {
    for (const ext of ['.js', '/index.js']) {
      try { const r = await nextResolve(specifier + ext, context); if (r) return r } catch {}
    }
  }
  return nextResolve(specifier, context)
}
"""
_DRIVER = r"""
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
register('./hook.mjs', import.meta.url)
const schema = await import(pathToFileURL(process.argv[2]).href)
const registry = await import(pathToFileURL(process.argv[3]).href)
process.stdout.write(JSON.stringify({
  types: Object.keys(schema.NOTEBOOK_TYPE_SCHEMA),
  attrs: Object.keys(schema.NOTEBOOK_ATTR_SCHEMA || {}),
  widgets: registry.WIDGET_IDS,
}))
"""


@functools.lru_cache(maxsize=1)
def _client_facts() -> dict:
    """ONE node spawn per run: the schema table's keys and the registry's widget ids, read
    the way the bundle reads them (imported, never regexed)."""
    node = shutil.which("node")
    assert node, "node is not on PATH -- this rail reads the client tables the way the bundle does"
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / "hook.mjs").write_text(_HOOK, encoding="utf-8")
        (Path(d) / "driver.mjs").write_text(_DRIVER, encoding="utf-8")
        r = subprocess.run([node, str(Path(d) / "driver.mjs"), str(SCHEMA_JS), str(REGISTRY_JS)],
                           capture_output=True, timeout=120)
    err = (r.stderr or b"").decode("utf-8", errors="replace")
    assert r.returncode == 0, f"node could not import the client tables: {err[:2000]}"
    return json.loads(r.stdout.decode("utf-8"))


def schema_types() -> list[str]:
    return sorted(_client_facts()["types"])


def widget_ids() -> list[str]:
    return sorted(_client_facts()["widgets"])


def schema_attrs() -> list[str]:
    """The client's attribute rows (`NOTEBOOK_ATTR_SCHEMA`, wave 13 13H-1), read as the bundle
    reads them."""
    return sorted(_client_facts()["attrs"])


# ── helpers ─────────────────────────────────────────────────────────────────────────────

def t(s: str, *marks: dict) -> dict:
    node = {"type": "text", "text": s}
    if marks:
        node["marks"] = list(marks)
    return node


def p(*inline: dict) -> dict:
    return {"type": "paragraph", "content": list(inline)}


def doc(*blocks: dict) -> dict:
    return {"type": "doc", "content": list(blocks)}


FACTS = {
    "fact-fmp": {"id": "fact-fmp", "ticker": "AAPL", "fact_type": "analyst_price_target_consensus",
                 "period": None, "value_number": 212.5, "value_text": None, "unit": "usd_per_share",
                 "observed_at": "2026-09-01T14:00:00+00:00", "source": "fmp",
                 "rights_class": "conditional", "caption": None},
    "fact-finnhub": {"id": "fact-finnhub", "ticker": "MSFT", "fact_type": "price", "period": None,
                     "value_number": 401.0, "value_text": None, "unit": "usd_per_share",
                     "observed_at": "2026-09-02T14:00:00+00:00", "source": "finnhub",
                     "rights_class": "independent", "caption": None},
    "fact-massive": {"id": "fact-massive", "ticker": "NVDA", "fact_type": "price", "period": None,
                     "value_number": 101.25, "value_text": None, "unit": "usd_per_share",
                     "observed_at": "2026-09-03T14:00:00+00:00", "source": "massive",
                     "rights_class": "independent", "caption": None},
    "fact-user": {"id": "fact-user", "ticker": "TSLA", "fact_type": "user_note", "period": None,
                  "value_number": None, "value_text": "my target 300", "unit": "text",
                  "observed_at": "2026-09-04T14:00:00+00:00", "source": "user",
                  "rights_class": "independent", "caption": "why I think so"},
    "fact-blocked": {"id": "fact-blocked", "ticker": "AMD", "fact_type": "user_note", "period": None,
                     "value_number": None, "value_text": "blocked words", "unit": "text",
                     "observed_at": "2026-09-05T14:00:00+00:00", "source": "user",
                     "rights_class": "blocked", "caption": None},
}

NOTE_LINKS_IN_PUBLICATION = {OTHER: ("/p/SLUG/n/PID-OTHER", "The other published note")}


def reduce(body: dict, mode: str, note_links: dict | None = None) -> dict:
    return pnp.reduce(copy.deepcopy(body), mode=mode, owner_id=OWNER, note_id=NOTE,
                      attachment_base=BASE, facts=FACTS, note_links=note_links)


def types_in(d: dict) -> set[str]:
    return set(pnp.walk_types(d))


def texts_in(d: Any) -> list[str]:
    out = []
    if isinstance(d, dict):
        if d.get("type") == "text":
            out.append(d.get("text", ""))
        for c in d.get("content") or []:
            out.extend(texts_in(c))
    return out


def find(d: Any, kind: str) -> list[dict]:
    out = []
    if isinstance(d, dict):
        if d.get("type") == kind:
            out.append(d)
        for c in d.get("content") or []:
            out.extend(find(c, kind))
    return out


NEUTRAL = pnp.NEUTRAL_LINE


def is_neutral_only(d: dict) -> bool:
    return texts_in(d) == [NEUTRAL]


# ── FIXTURES: one document per schema type, holding it in a valid place ─────────────────

def _widget(widget_id: str) -> dict:
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": widget_id, "mode": "snapshot", "capturedAt": "2026-09-01T12:00:00Z",
        "params": {"symbol": "AAPL", "view": "quarterly", "tf": "D", "settings": {"a": 1},
                   "data": {"quarterly": [1]}},
        "fallback": {"url": f"{OWN_ATT}inline/w.png", "w": 900, "h": 500},
        "tradeRef": "trade-9", "searchText": "[x]", "annotations": [{"id": 1}], "embedId": "e1",
        "ta": {"v": 1, "setupTag": "Breakout", "planBlock": {"shares": 200}},
        "caption": "the member's caption", "layout": {"width": "full", "height": 320}, "frozen": False}}


FIXTURES: dict[str, Callable[[], dict]] = {
    "doc": lambda: doc(p(t("hello"))),
    "paragraph": lambda: doc(p(t("hello"))),
    "text": lambda: doc(p(t("hello"))),
    "heading": lambda: doc({"type": "heading", "attrs": {"level": 2}, "content": [t("H")]}),
    "blockquote": lambda: doc({"type": "blockquote", "content": [p(t("q"))]}),
    "bulletList": lambda: doc({"type": "bulletList", "content": [
        {"type": "listItem", "content": [p(t("a"))]}]}),
    "orderedList": lambda: doc({"type": "orderedList", "content": [
        {"type": "listItem", "content": [p(t("a"))]}]}),
    "listItem": lambda: doc({"type": "bulletList", "content": [
        {"type": "listItem", "content": [p(t("a"))]}]}),
    "taskList": lambda: doc({"type": "taskList", "content": [
        {"type": "taskItem", "attrs": {"checked": True}, "content": [p(t("do"))]}]}),
    "taskItem": lambda: doc({"type": "taskList", "content": [
        {"type": "taskItem", "attrs": {"checked": False}, "content": [p(t("do"))]}]}),
    "codeBlock": lambda: doc({"type": "codeBlock", "attrs": {"language": "python"},
                              "content": [t("x = 1")]}),
    "hardBreak": lambda: doc(p(t("a"), {"type": "hardBreak"}, t("b"))),
    "horizontalRule": lambda: doc({"type": "horizontalRule"}),
    "table": lambda: doc({"type": "table", "content": [{"type": "tableRow", "content": [
        {"type": "tableHeader", "content": [p(t("h"))]},
        {"type": "tableCell", "content": [p(t("c"))]}]}]}),
    "callout": lambda: doc({"type": "callout", "attrs": {"variant": "info"}, "content": [p(t("c"))]}),
    "toggle": lambda: doc({"type": "toggle", "content": [
        {"type": "toggleSummary", "content": [t("s")]},
        {"type": "toggleContent", "content": [p(t("c"))]}]}),
    "videoTimestamp": lambda: doc(p({"type": "videoTimestamp", "attrs": {"seconds": 42}})),
    "blockMath": lambda: doc({"type": "blockMath", "attrs": {"latex": "E=mc^2"}}),
    "inlineMath": lambda: doc(p({"type": "inlineMath", "attrs": {"latex": "x"}})),
    "columns": lambda: doc({"type": "columns", "content": [
        {"type": "column", "content": [p(t("l"))]}, {"type": "column", "content": [p(t("r"))]}]}),
    "dateMention": lambda: doc(p({"type": "dateMention", "attrs": {"date": "2026-10-01"}})),
    "tableOfContents": lambda: doc({"type": "tableOfContents"}, {"type": "heading",
                                                                 "attrs": {"level": 2}, "content": [t("H")]}),
    "linkPreview": lambda: doc({"type": "linkPreview", "attrs": {
        "url": "https://example.com/a", "title": "Example", "domain": "example.com"}}),
    "webEmbed": lambda: doc({"type": "webEmbed", "attrs": {
        "provider": "youtube", "ref": "dQw4w9WgXcQ", "url": "https://youtu.be/dQw4w9WgXcQ"}}),
    "image": lambda: doc({"type": "image", "attrs": {"src": f"{OWN_ATT}inline/pic.png", "alt": "mine"}}),
    "imageFigure": lambda: doc({"type": "imageFigure", "content": [
        {"type": "image", "attrs": {"src": f"{OWN_ATT}inline/pic.png"}},
        {"type": "imageCaption", "content": [t("cap")]}]}),
    "attachmentChip": lambda: doc({"type": "attachmentChip", "attrs": {
        "href": f"{OWN_ATT}file/report.pdf", "name": "report.pdf"}}),
    "noteLink": lambda: doc(p(t("see "), {"type": "noteLink", "attrs": {"noteId": OTHER}})),
    "askCitation": lambda: doc({"type": "askInsert", "attrs": {"question": "q", "action": "rewrite"},
                                "content": [p(t("a"), {"type": "askCitation", "attrs": {
                                    "n": 1, "label": "Other title", "nav": {"note_id": OTHER}}})]}),
    "askInsert": lambda: doc({"type": "askInsert", "attrs": {"question": "what?", "scope": "notebook"},
                              "content": [p(t("an Ask answer"))]}),
    "widgetEmbed": lambda: doc(_widget("chart")),
    "financialFact": lambda: doc({"type": "financialFact", "attrs": {"factId": "fact-massive"}}),
    "documentExcerpt": lambda: doc({"type": "documentExcerpt", "attrs": {"excerptId": "ex-1"}}),
    # Wave 11 lane 11D: a trade-plan canvas holding a member card, a Massive chart and a level.
    "tradeCanvas": lambda: doc({"type": "tradeCanvas", "attrs": {"searchText": "Trade-plan canvas $NVDA", "board": {
        "v": 1, "items": [{"id": "i1", "kind": "text", "x": 0, "y": 0, "w": 200, "h": 100, "text": "my plan"},
                          {"id": "i2", "kind": "chart", "x": 0, "y": 0, "w": 400, "h": 260, "symbol": "NVDA",
                           "tf": "D", "mode": "live", "asOf": None}],
        "edges": [], "levels": [{"id": "l1", "role": "entry", "label": "Entry", "price": 182.5, "chartId": "i2"}]}}}),
    # marks
    "bold": lambda: doc(p(t("b", {"type": "bold"}))),
    "code": lambda: doc(p(t("c", {"type": "code"}))),
    "italic": lambda: doc(p(t("i", {"type": "italic"}))),
    "strike": lambda: doc(p(t("s", {"type": "strike"}))),
    "underline": lambda: doc(p(t("u", {"type": "underline"}))),
    # A value the toolbar writes. (This was `{"color": "#fff"}`, an attribute the editor's
    # textStyle mark does not declare; gallery mode now keeps only declared attributes with
    # checked values, security review I-4, so a mark that styles nothing does not travel.)
    "textStyle": lambda: doc(p(t("ts", {"type": "textStyle", "attrs": {"fontSize": "18px"}}))),
    "highlight": lambda: doc(p(t("h", {"type": "highlight", "attrs": {"color": "yellow"}}))),
    "textColor": lambda: doc(p(t("tc", {"type": "textColor", "attrs": {"color": "red"}}))),
    "link": lambda: doc(p(t("web", {"type": "link", "attrs": {"href": "https://example.com/x"}}))),
}
# Types reached by another type's fixture (they cannot stand alone in a valid document).
FIXTURES.update({
    "tableRow": FIXTURES["table"], "tableCell": FIXTURES["table"], "tableHeader": FIXTURES["table"],
    "toggleSummary": FIXTURES["toggle"], "toggleContent": FIXTURES["toggle"],
    "column": FIXTURES["columns"], "imageCaption": FIXTURES["imageFigure"],
})

#: What each type must BECOME, per mode. Outcomes:
#:   kept      the type is still in the public copy
#:   gone      the type is not in the public copy
#:   text      replaced by plain text (noteLink -> "linked note")
#:   number    askCitation reduced to {n}
#:   neutral   replaced by the ONE neutral market-data line
EXPECTED: dict[str, tuple[str, str]] = {t_: ("kept", "kept") for t_ in (
    "doc", "paragraph", "text", "heading", "blockquote", "bulletList", "orderedList", "listItem",
    "taskList", "taskItem", "codeBlock", "hardBreak", "horizontalRule", "table", "tableRow",
    "tableCell", "tableHeader", "callout", "toggle", "toggleSummary", "toggleContent",
    "videoTimestamp", "blockMath", "inlineMath", "columns", "column", "dateMention",
    "tableOfContents", "linkPreview", "webEmbed", "image", "imageFigure", "imageCaption",
    "bold", "code", "italic", "strike", "underline", "textStyle", "highlight", "textColor", "link",
)}
EXPECTED.update({
    "attachmentChip": ("gone", "gone"),
    "noteLink": ("text", "text"),
    "askCitation": ("number", "gone"),
    "askInsert": ("kept", "gone"),          # the fixture is an Ask ANSWER (no `action`)
    "widgetEmbed": ("neutral", "neutral"),  # the fixture is a CHART (Massive)
    "financialFact": ("neutral", "neutral"),  # the fixture is a Massive price fact
    "documentExcerpt": ("neutral", "neutral"),
    "tradeCanvas": ("neutral", "neutral"),  # wave 11 11D: a plan mixes member text with Massive charts
})

#: Wave 12 lane 12A -- what each type becomes in the THIRD mode, `gallery` (a member template
#: published to the community gallery). Stricter than publish: every image and figure goes
#: (re-upload is a later step), every Ask answer AND writing-help block goes, and every
#: market-data node is the neutral line whatever its vendor. A type added to the editor
#: tomorrow fails by name here too.
EXPECTED_GALLERY: dict[str, str] = {t_: EXPECTED[t_][1] for t_ in EXPECTED}
EXPECTED_GALLERY.update({
    "image": "gone", "imageFigure": "gone", "imageCaption": "gone",
    "askInsert": "gone",                     # writing help too -- computed from private notes
    "askCitation": "gone",
    "financialFact": "neutral", "widgetEmbed": "neutral",
})


def test_the_derivation_reads_the_real_schema_table():
    """Non-vacuity: the node import returned the table, including types from every era."""
    ts = schema_types()
    for must in ("doc", "widgetEmbed", "askCitation", "columns", "link"):
        assert must in ts, (must, ts)


@pytest.mark.parametrize("type_", schema_types())
def test_every_schema_type_has_a_declared_policy(type_):
    assert type_ in pnp.NODE_POLICY, (
        f"`{type_}` is in lib/notebookSchema.js and has NO row in public_note_payload.NODE_POLICY -- "
        "decide what a stranger sees before a note holding it can be shared or published")
    # P3b Task 2: `example` is a fourth MODE with no column -- `node_action` derives it from
    # gallery's (rail: tests/test_example_reduce.py). The columns are the base modes.
    assert set(pnp.NODE_POLICY[type_]) == set(pnp.BASE_MODES) == {"share", "publish", "gallery"}, type_
    assert type_ in EXPECTED and type_ in FIXTURES and type_ in EXPECTED_GALLERY, (
        f"`{type_}` has a policy but no expectation/fixture in this rail")


def test_the_policy_names_no_type_the_schema_does_not_have():
    stale = sorted(set(pnp.NODE_POLICY) - set(schema_types()))
    assert not stale, f"NODE_POLICY rows for types the editor does not have: {stale}"


def _outcome(type_: str, body: dict, out: dict) -> str:
    present = type_ in types_in(out)
    if type_ == "noteLink":
        return "text" if (not present and "linked note" in texts_in(out)) else ("kept" if present else "gone")
    if type_ == "askCitation" and present:
        chips = find(out, "askCitation")
        return "number" if all(c.get("attrs") == {"n": 1} for c in chips) else "kept"
    if type_ in ("widgetEmbed", "financialFact", "documentExcerpt", "tradeCanvas") and not present:
        return "neutral" if NEUTRAL in texts_in(out) else "gone"
    return "kept" if present else "gone"


@pytest.mark.parametrize("mode", ["share", "publish"])
@pytest.mark.parametrize("type_", schema_types())
def test_each_type_becomes_what_is_declared(type_, mode):
    body = FIXTURES[type_]()
    assert type_ in types_in(body), f"the fixture for {type_} does not hold it"
    out = reduce(body, mode)
    want = EXPECTED[type_][0 if mode == "share" else 1]
    assert _outcome(type_, body, out) == want, (type_, mode, out)


@pytest.mark.parametrize("type_", schema_types())
def test_each_type_becomes_what_is_declared_in_gallery_mode(type_):
    body = FIXTURES[type_]()
    out = reduce(body, "gallery")
    assert _outcome(type_, body, out) == EXPECTED_GALLERY[type_], (type_, out)


def test_gallery_mode_drops_every_image_bearing_attribute_even_an_external_one():
    """CONTROL beside the M-6 rail: in share/publish an external image SURVIVES; in gallery
    mode it does not -- so this cannot pass by a reducer that never kept one."""
    web = {"type": "image", "attrs": {"src": "https://example.com/c.png"}}
    assert "image" in types_in(reduce(doc(web), "publish"))
    assert "image" not in types_in(reduce(doc(web), "gallery"))
    card = doc({"type": "linkPreview", "attrs": {"url": "https://example.com/a", "image": "https://example.com/i.png"}})
    assert find(reduce(card, "publish"), "linkPreview")[0]["attrs"]["image"] == "https://example.com/i.png"
    assert find(reduce(card, "gallery"), "linkPreview")[0]["attrs"]["image"] is None
    fund = _fundamentals_widget("https://example.com/w.png")
    assert "widgetEmbed" in types_in(reduce(fund, "publish"))         # FMP is SHOWN on a page
    assert texts_in(reduce(fund, "gallery")) == [NEUTRAL]             # never in a template


def test_gallery_mode_unchecks_tasks_and_the_other_modes_do_not():
    body = doc({"type": "taskList", "content": [
        {"type": "taskItem", "attrs": {"checked": True}, "content": [p(t("done"))]}]})
    assert find(reduce(body, "share"), "taskItem")[0]["attrs"]["checked"] is True
    assert find(reduce(body, "gallery"), "taskItem")[0]["attrs"]["checked"] is False


def test_gallery_mode_scrubs_email_addresses_as_text_and_as_mailto_links():
    mail = {"type": "link", "attrs": {"href": "mailto:me@example.com"}}
    body = doc(p(t("write to me@example.com or "), t("here", mail), t(" -- or the site", {
        "type": "link", "attrs": {"href": "https://example.com/contact"}})))
    shared = reduce(body, "share")
    assert "me@example.com" in json.dumps(shared)                      # share keeps an email (unchanged)
    out = reduce(body, "gallery")
    dumped = json.dumps(out)
    assert "me@example.com" not in dumped and "mailto:" not in dumped
    assert pnp.EMAIL_TEXT in texts_in(out)[0]
    assert "here" in texts_in(out) and "https://example.com/contact" in dumped


FOREIGN_HOST_IN_APP = [
    f"http://127.0.0.1:8580/journal/notebook?note={OTHER}",                       # a sandbox
    f"https://web-production-05cb6.up.railway.app/journal/notebook?note={OTHER}",  # the Railway name
    f"https://example.org/anything?x=1&note={OTHER}",                               # a note= query
    "http://localhost:8000/api/j2/notes/abc",
]


@pytest.mark.parametrize("url", FOREIGN_HOST_IN_APP)
def test_gallery_mode_scrubs_an_in_app_address_on_ANY_host(url):
    """Wave 12 12A walk run 2 (0b80ee9945, G1): the host test passed a pasted
    `http://127.0.0.1:8580/journal/notebook?note=<id>` as external. Gallery mode judges the
    address's SHAPE too -- as text, as a link mark, as a link card and as an embed's fallback."""
    link = {"type": "link", "attrs": {"href": url}}
    bodies = [doc(p(t(f"see {url} now"))), doc(p(t("words", link))),
              doc({"type": "linkPreview", "attrs": {"url": url, "title": "T"}}),
              doc({"type": "webEmbed", "attrs": {"provider": "youtube", "ref": "dQw4w9WgXcQ", "url": url}})]
    for body in bodies:
        out = json.dumps(reduce(body, "gallery"))
        assert OTHER not in out and "note=" not in out and "/journal/" not in out and "/api/" not in out, (url, out)


def test_CONTROL_gallery_shape_rule_keeps_ordinary_web_addresses_and_share_mode_is_unchanged():
    keep = "https://example.com/blog/how-i-trade?ref=nav"
    assert texts_in(reduce(doc(p(t(f"Read {keep}."))), "gallery")) == [f"Read {keep}."]
    foreign = FOREIGN_HOST_IN_APP[0]
    # share/publish still decide by host: this is recorded as an owner question, not changed here
    assert foreign in json.dumps(reduce(doc(p(t(foreign))), "share"))


def test_an_unknown_type_is_dropped_at_run_time():
    """Fail closed: a type nobody has declared never reaches a stranger."""
    out = reduce(doc(p(t("kept")), {"type": "brandNewNode", "attrs": {"secret": "s3"}}), "share")
    assert "brandNewNode" not in types_in(out) and "s3" not in json.dumps(out)
    assert texts_in(out) == ["kept"]


def test_an_unknown_mark_is_dropped_and_its_text_kept():
    out = reduce(doc(p(t("word", {"type": "comment", "attrs": {"id": "c-secret"}}))), "share")
    assert texts_in(out) == ["word"] and "c-secret" not in json.dumps(out)


# ── the existing share guarantees, kept ─────────────────────────────────────────────────

def test_prose_math_code_and_colours_survive_verbatim():
    body = doc(p(t("Area "), {"type": "inlineMath", "attrs": {"latex": "\\pi r^2"}}, t(" holds.")),
               {"type": "blockMath", "attrs": {"latex": "E = mc^2"}},
               {"type": "codeBlock", "attrs": {"language": "python"}, "content": [t("def f():\n    return 1")]},
               p(t("red", {"type": "textColor", "attrs": {"color": "red"}}), t(" and "),
                 t("marked", {"type": "highlight", "attrs": {"color": "blue"}})))
    for mode in ("share", "publish"):
        assert reduce(body, mode) == body, mode


def test_attachment_urls_of_this_note_are_rewritten_and_other_notes_images_dropped():
    body = doc({"type": "image", "attrs": {"src": f"{OWN_ATT}inline/a.png"}},
               {"type": "image", "attrs": {"src": f"{OTHER_ATT}inline/b.png"}},
               {"type": "imageFigure", "content": [{"type": "image", "attrs": {"src": f"{OTHER_ATT}inline/c.png"}},
                                                   {"type": "imageCaption", "content": [t("gone")]}]})
    out = reduce(body, "share")
    imgs = find(out, "image")
    assert [i["attrs"]["src"] for i in imgs] == [f"{BASE}inline/a.png"]
    assert "/api/j2/notes/attachments/" not in json.dumps(out) and OTHER not in json.dumps(out)
    assert "imageFigure" not in types_in(out)


def test_internal_link_marks_lose_the_link_and_keep_the_words():
    body = doc(p(t("a", {"type": "link", "attrs": {"href": f"/journal/notebook?note={OTHER}"}}),
                 t("b", {"type": "link", "attrs": {"href": "/journal-2-0/trade/t-1"}}),
                 t("c", {"type": "link", "attrs": {"href": "https://uctintelligence.com/journal"}}),
                 t("d", {"type": "link", "attrs": {"href": "https://example.com/ok"}}),
                 t("e", {"type": "link", "attrs": {"href": "mailto:me@example.com"}})))
    out = reduce(body, "share")
    assert texts_in(out) == ["a", "b", "c", "d", "e"]
    hrefs = [m["attrs"]["href"] for n in find(out, "text") for m in n.get("marks", [])]
    assert hrefs == ["https://example.com/ok", "mailto:me@example.com"]


# ── M-6: the URL attributes of KEPT nodes (wave-8 final review) ─────────────────────────
#
# `link` marks already lost an in-app href; these are the node attributes that carry a URL
# of their own. A preview card made from a pasted in-app address (`linkPasteOffer.js` does
# not exclude our host) carried `?note=<id>` onto the public page -- the leak ruling D-B7
# forbids. Every attribute below is driven with in-app addresses that name OTHER's id.

IN_APP_URLS = (
    f"https://uctintelligence.com/journal/notebook?note={OTHER}",
    f"https://www.uctintelligence.com/journal/notebook?note={OTHER}",
    f"/journal/notebook?note={OTHER}",
    f"?note={OTHER}",
    f"//uctintelligence.com/journal/notebook?note={OTHER}",
    f"https://example.com@uctintelligence.com/journal/notebook?note={OTHER}",   # userinfo trick
)
WEB_PAGE = "https://example.com/article"
WEB_IMAGE = "https://example.com/pic.png"


def _preview(url: str = WEB_PAGE, image: str | None = None) -> dict:
    return doc({"type": "linkPreview", "attrs": {"url": url, "title": "A card", "domain": "example.com",
                                                 "description": "d", "image": image}})


def _fundamentals_widget(fallback_url: str) -> dict:
    w = _widget("fundamentals")
    w["attrs"]["fallback"] = {"url": fallback_url, "w": 900, "h": 500}
    return doc(w)


#: attribute -> (a document holding `u` in that attribute, where `u` must NOT survive)
URL_ATTRS: dict[str, Callable[[str], dict]] = {
    "linkPreview.url": lambda u: _preview(url=u),
    "linkPreview.image": lambda u: _preview(image=u),
    "webEmbed.url": lambda u: doc({"type": "webEmbed", "attrs": {
        "provider": "youtube", "ref": "dQw4w9WgXcQ", "url": u}}),
    "image.src": lambda u: doc({"type": "image", "attrs": {"src": u, "alt": "x"}}),
    "imageFigure.image.src": lambda u: doc({"type": "imageFigure", "content": [
        {"type": "image", "attrs": {"src": u}}, {"type": "imageCaption", "content": [t("cap")]}]}),
    "widgetEmbed.fallback.url": _fundamentals_widget,     # FMP: a SHOWN widget keeps its fallback
}


@pytest.mark.parametrize("mode", ["share", "publish"])
@pytest.mark.parametrize("url", IN_APP_URLS)
@pytest.mark.parametrize("attr", sorted(URL_ATTRS))
def test_M6_no_in_app_url_in_a_kept_node_attribute_reaches_a_stranger(attr, url, mode):
    out = json.dumps(reduce(URL_ATTRS[attr](url), mode))
    assert OTHER not in out and "note=" not in out, (attr, url, mode, out)
    assert "uctintelligence.com" not in out, (attr, url, mode, out)


# ── Wave-8 walk W3: an in-app ADDRESS written as TEXT ───────────────────────────────────
#
# The walk pasted `https://uctintelligence.com/journal/notebook?note=<id>` into a published note
# through the real clipboard: the link MARK went (`_reduce_marks`), its TEXT -- the address
# itself -- stayed, and the other note's id reached the public page and its JSON. The same
# address pasted as plain text carries no mark at all. Every form in IN_APP_URLS is driven as
# text, with and without a link mark, mid-sentence and with trailing punctuation.

def _address_texts(url: str) -> list[dict]:
    link = {"type": "link", "attrs": {"href": url}}
    return [
        doc(p(t(url, link))),                                          # pasted, auto-linked
        doc(p(t(url))),                                                # pasted as plain text
        doc(p(t(f"See {url}, then decide."))),                         # mid-sentence
        doc(p(t("heading ")), {"type": "heading", "attrs": {"level": 2}, "content": [t(url)]}),
    ]


@pytest.mark.parametrize("mode", ["share", "publish"])
@pytest.mark.parametrize("url", IN_APP_URLS)
def test_W3_no_in_app_address_written_as_text_reaches_a_stranger(url, mode):
    for body in _address_texts(url):
        out = reduce(body, mode)
        dumped = json.dumps(out)
        assert OTHER not in dumped and "note=" not in dumped, (url, mode, dumped)
        assert any(pnp.IN_APP_LINK_TEXT in s for s in texts_in(out)), (url, mode, dumped)


@pytest.mark.parametrize("mode", ["share", "publish"])
def test_W3_CONTROLS_words_external_addresses_and_public_page_addresses_stay(mode):
    """The rule removes in-app ADDRESSES, not text: linked words keep their words, an external
    address stays as written, a public page's own address stays (it names a slug or a token,
    never a note id), trailing punctuation survives, and `//word` in prose is not an address."""
    link = {"type": "link", "attrs": {"href": f"/journal/notebook?note={OTHER}"}}
    assert texts_in(reduce(doc(p(t("my thesis", link))), mode)) == ["my thesis"]
    for keep in (WEB_PAGE, "https://uctintelligence.com/p/AbC123",
                 "https://uctintelligence.com/share/n/tok_xyz", "a // note on style, and //TODO"):
        assert texts_in(reduce(doc(p(t(f"Read {keep}."))), mode)) == [f"Read {keep}."], keep
    out = texts_in(reduce(doc(p(t(f"Open /journal/notebook?note={OTHER}."))), mode))
    assert out == [f"Open {pnp.IN_APP_LINK_TEXT}."], out


def test_M6_the_hero_follows_the_same_rule():
    for url in IN_APP_URLS:
        assert pnp.public_hero(url, owner_id=OWNER, note_id=NOTE, attachment_base=BASE) is None, url
    # CONTROLS: this note's own hero (rewritten to the proxy) and a web image survive.
    assert pnp.public_hero(f"{OWN_ATT}hero/h.png", owner_id=OWNER, note_id=NOTE,
                           attachment_base=BASE) == f"{BASE}hero/h.png"
    assert pnp.public_hero(WEB_IMAGE, owner_id=OWNER, note_id=NOTE, attachment_base=BASE) == WEB_IMAGE


@pytest.mark.parametrize("mode", ["share", "publish"])
def test_M6_CONTROLS_a_web_address_and_this_notes_own_proxy_survive_in_every_attribute(mode):
    """The rule above removes in-app addresses, not URL attributes: an external web address
    stays in every one of them, and an image of THIS note stays as its public proxy."""
    card = find(reduce(_preview(url=WEB_PAGE, image=WEB_IMAGE), mode), "linkPreview")
    assert card and card[0]["attrs"]["url"] == WEB_PAGE and card[0]["attrs"]["image"] == WEB_IMAGE
    embed = find(reduce(URL_ATTRS["webEmbed.url"]("https://youtu.be/dQw4w9WgXcQ"), mode), "webEmbed")
    assert embed and embed[0]["attrs"]["url"] == "https://youtu.be/dQw4w9WgXcQ"
    for attr in ("image.src", "imageFigure.image.src"):
        for src, want in ((WEB_IMAGE, WEB_IMAGE), (f"{OWN_ATT}inline/p.png", f"{BASE}inline/p.png")):
            imgs = find(reduce(URL_ATTRS[attr](src), mode), "image")
            assert [i["attrs"]["src"] for i in imgs] == [want], (attr, src, mode)
    widget = find(reduce(_fundamentals_widget(f"{OWN_ATT}inline/w.png"), mode), "widgetEmbed")
    assert widget and widget[0]["attrs"]["fallback"]["url"] == f"{BASE}inline/w.png"


@pytest.mark.parametrize("mode", ["share", "publish"])
def test_M6_what_each_attribute_becomes(mode):
    """The chosen reduction per attribute, stated: an in-app card goes whole (its title was
    fetched FROM the in-app page); a card keeps its external link and loses an in-app image;
    an embed keeps its player (rebuilt from provider + ref) and loses the in-app address;
    an in-app image goes, and its figure with it; a shown widget keeps no archived image."""
    u = IN_APP_URLS[0]
    assert "linkPreview" not in types_in(reduce(URL_ATTRS["linkPreview.url"](u), mode))
    card = find(reduce(URL_ATTRS["linkPreview.image"](u), mode), "linkPreview")[0]
    assert card["attrs"]["url"] == WEB_PAGE and card["attrs"]["image"] is None
    embed = find(reduce(URL_ATTRS["webEmbed.url"](u), mode), "webEmbed")[0]
    assert embed["attrs"] == {"provider": "youtube", "ref": "dQw4w9WgXcQ", "url": None}
    assert "image" not in types_in(reduce(URL_ATTRS["image.src"](u), mode))
    assert "imageFigure" not in types_in(reduce(URL_ATTRS["imageFigure.image.src"](u), mode))
    widget = find(reduce(URL_ATTRS["widgetEmbed.fallback.url"](u), mode), "widgetEmbed")[0]
    assert widget["attrs"]["fallback"] is None


def test_M6_no_other_scheme_reaches_an_image_bearing_attribute():
    for src in ("javascript:alert(1)", "data:image/png;base64,AAAA", "  ", "ftp://example.com/p.png",
                f"{BASE}../../notes/attachments/{OWNER}/{OTHER}/inline/x.png", None, 7):
        assert pnp._public_image_src(src, BASE) is None, src


def test_an_emptied_container_keeps_a_valid_shape():
    """A column whose only child was an Ask answer (publish) keeps an empty paragraph, so the
    editor still reads the document instead of refusing it."""
    body = doc({"type": "columns", "content": [
        {"type": "column", "content": [{"type": "askInsert", "attrs": {"question": "q"},
                                        "content": [p(t("answer"))]}]},
        {"type": "column", "content": [p(t("kept"))]}]})
    out = reduce(body, "publish")
    col = find(out, "column")[0]
    assert col["content"] == [{"type": "paragraph"}]


def test_writing_help_keeps_its_label_in_both_modes():
    attrs = {"insertedAt": "2026-09-25T09:41:00", "scope": "selection", "question": "Rewrite -- shorter",
             "action": "rewrite", "model": "claude-sonnet-5"}
    body = doc({"type": "askInsert", "attrs": dict(attrs), "content": [p(t("tighter"))]})
    for mode in ("share", "publish"):
        out = reduce(body, mode)
        assert find(out, "askInsert")[0]["attrs"] == attrs, mode


def test_publish_links_a_note_in_the_same_publication_and_nothing_else():
    body = doc(p({"type": "noteLink", "attrs": {"noteId": OTHER}}, t(" / "),
                 {"type": "noteLink", "attrs": {"noteId": "not-published"}}))
    out = reduce(body, "publish", note_links=NOTE_LINKS_IN_PUBLICATION)
    runs = find(out, "text")
    assert runs[0]["text"] == "The other published note"
    assert runs[0]["marks"] == [{"type": "link", "attrs": {"href": "/p/SLUG/n/PID-OTHER"}}]
    assert runs[-1] == {"type": "text", "text": "linked note"}
    assert "not-published" not in json.dumps(out)
    # share mode never links, even when a publication map is passed
    assert "/p/" not in json.dumps(reduce(body, "share", note_links=NOTE_LINKS_IN_PUBLICATION))


def test_adjacent_neutral_lines_collapse_to_one():
    out = reduce(doc(_widget("chart"), _widget("themes"), p(t("between")), _widget("breadth")), "share")
    assert texts_in(out) == [NEUTRAL, "between", NEUTRAL]


# ── the vendor table (owner legal sign-off 2026-09-25, L3 + correction) ─────────────────

def test_the_vendor_derivation_reads_the_real_registry():
    ids = widget_ids()
    assert "chart" in ids and "fundamentals" in ids, ids


@pytest.mark.parametrize("widget_id", widget_ids())
def test_every_registered_widget_has_a_vendor_row(widget_id):
    assert ("widgetEmbed", widget_id) in pnp.MARKET_DATA_VENDORS, (
        f"widget `{widget_id}` has no vendor row -- a stranger's view of its archived image is undecided")


def test_every_fact_source_has_a_vendor_row():
    from api.services.journal_two import fact_registry
    sources = set(typing.get_args(fact_registry.Source)) | {d.source for d in fact_registry.FACT_TYPES.values()}
    assert sources, "no fact sources derived"
    for s in sorted(sources):
        assert ("financialFact", s) in pnp.MARKET_DATA_VENDORS, s


def test_every_vendor_has_a_verdict():
    for key, vendor in pnp.MARKET_DATA_VENDORS.items():
        assert vendor in pnp.VENDOR_VERDICT, (key, vendor)


def test_the_owner_sign_off_in_words():
    v = pnp.market_data_verdict
    assert v("widgetEmbed", "chart") == pnp.NEUTRAL          # Massive bars
    assert v("widgetEmbed", "fundamentals") == pnp.SHOWN     # FMP, owner-named
    assert v("financialFact", "fmp") == pnp.SHOWN
    assert v("financialFact", "finnhub") == pnp.SHOWN
    assert v("financialFact", "massive") == pnp.NEUTRAL
    assert v("documentExcerpt", None) == pnp.NEUTRAL         # D-B4, unchanged
    assert v("widgetEmbed", "a-widget-nobody-declared") == pnp.NEUTRAL  # unknown -> neutral
    assert pnp.VENDOR_VERDICT["massive"] == pnp.NEUTRAL


def test_loosening_massive_is_one_line():
    """The change the owner may make later: flip ONE verdict and every Massive row follows."""
    massive_rows = [k for k, vend in pnp.MARKET_DATA_VENDORS.items() if vend == "massive"]
    assert ("widgetEmbed", "chart") in massive_rows
    saved = pnp.VENDOR_VERDICT["massive"]
    try:
        pnp.VENDOR_VERDICT["massive"] = pnp.SHOWN
        assert all(pnp.market_data_verdict(*k) == pnp.SHOWN for k in massive_rows)
    finally:
        pnp.VENDOR_VERDICT["massive"] = saved


# ── M-11: market data NESTED in a container, in SHARE mode (wave-8 final review) ────────
#
# The ruling-critical case the top-level fixtures cannot see: a Massive chart or price
# inside columns, a callout, a table cell or an Ask insert (share links KEEP Ask answers,
# G-064) must still become the neutral line, and an FMP / Finnhub figure nested the same way
# must still render. Recursion is generic, which is exactly why it is pinned here.

NESTED_CONTAINERS: dict[str, Callable[[dict], dict]] = {
    "columns": lambda n: doc({"type": "columns", "content": [
        {"type": "column", "content": [n]}, {"type": "column", "content": [p(t("right"))]}]}),
    "callout": lambda n: doc({"type": "callout", "attrs": {"variant": "info"}, "content": [n]}),
    "tableCell": lambda n: doc({"type": "table", "content": [{"type": "tableRow", "content": [
        {"type": "tableHeader", "content": [p(t("head"))]}, {"type": "tableCell", "content": [n]}]}]}),
    "askInsert": lambda n: doc({"type": "askInsert", "attrs": {"question": "q", "scope": "notebook"},
                                "content": [n]}),
}
#: the container type that must still be there, so the node was reduced IN PLACE
_CONTAINER_TYPE = {"columns": "column", "callout": "callout", "tableCell": "tableCell", "askInsert": "askInsert"}

MASSIVE_NODES: dict[str, Callable[[], dict]] = {
    "chart widget": lambda: _widget("chart"),
    "price fact (massive)": lambda: {"type": "financialFact", "attrs": {"factId": "fact-massive"}},
}
#: approved-vendor nodes -> (the type that stays, a string of the figure that must render)
APPROVED_NODES: dict[str, tuple[Callable[[], dict], str, str]] = {
    "fundamentals widget (fmp)": (lambda: _widget("fundamentals"), "widgetEmbed", "fundamentals"),
    "consensus fact (fmp)": (lambda: {"type": "financialFact", "attrs": {"factId": "fact-fmp"}},
                             "paragraph", "$212.50"),
    "price fact (finnhub)": (lambda: {"type": "financialFact", "attrs": {"factId": "fact-finnhub"}},
                             "paragraph", "$401.00"),
}


@pytest.mark.parametrize("node", sorted(MASSIVE_NODES))
@pytest.mark.parametrize("container", sorted(NESTED_CONTAINERS))
def test_M11_a_nested_massive_node_is_the_neutral_line_in_share_mode(container, node):
    body = NESTED_CONTAINERS[container](MASSIVE_NODES[node]())
    out = reduce(body, "share")
    assert _CONTAINER_TYPE[container] in types_in(out), (container, out)     # reduced in place
    assert "widgetEmbed" not in types_in(out) and "financialFact" not in types_in(out), out
    assert NEUTRAL in texts_in(out), (container, node, out)
    raw = json.dumps(out)
    assert "101.25" not in raw and "w.png" not in raw and "AAPL" not in raw, raw   # no Massive data


@pytest.mark.parametrize("node", sorted(APPROVED_NODES))
@pytest.mark.parametrize("container", sorted(NESTED_CONTAINERS))
def test_M11_a_nested_fmp_or_finnhub_node_is_kept_in_share_mode(container, node):
    build, kept_type, figure = APPROVED_NODES[node]
    out = reduce(NESTED_CONTAINERS[container](build()), "share")
    assert _CONTAINER_TYPE[container] in types_in(out), (container, out)
    assert NEUTRAL not in texts_in(out), (container, node, out)
    if kept_type == "widgetEmbed":
        widgets = find(out, "widgetEmbed")
        assert [w["attrs"]["widgetId"] for w in widgets] == [figure], out
    else:
        assert any(figure in s for s in texts_in(out)), (container, node, texts_in(out))


@pytest.mark.parametrize("mode", ["share", "publish"])
def test_a_shown_widget_keeps_exactly_what_the_archived_render_reads(mode):
    out = reduce(doc(_widget("fundamentals")), mode)
    w = find(out, "widgetEmbed")[0]["attrs"]
    assert set(w) <= set(pnp.EMBED_KEPT_ATTRS) | {"params"}
    assert w["params"] == {"symbol": "AAPL", "view": "quarterly"}
    assert w["fallback"] == {"url": f"{BASE}inline/w.png", "w": 900, "h": 500}
    assert w["caption"] == "the member's caption"
    for gone in ("tradeRef", "searchText", "annotations", "embedId", "ta"):
        assert gone not in w, gone


# ── wave 13 13H-1: every ATTRIBUTE row takes a decision in every mode ────────────────────

def test_every_schema_attribute_row_has_a_decision_in_every_mode():
    rows = schema_attrs()
    assert "widgetEmbed.ta" in rows, f"non-vacuity: read {rows}"
    missing = [r for r in rows if r not in pnp.ATTR_POLICY]
    assert missing == [], f"attribute rows with no public decision: {missing}"
    for row in rows:
        assert set(pnp.ATTR_POLICY[row]) == set(pnp.BASE_MODES), row   # example: attr_decision
        assert set(pnp.ATTR_POLICY[row].values()) <= {"drop", "keep"}, row


def test_a_dropped_widget_attribute_is_never_on_the_embed_allowlist():
    """The row and the reducer are two statements of one decision: a "drop" row whose
    attribute sits on EMBED_KEPT_ATTRS would publish what the table says it drops."""
    for row, decision in pnp.ATTR_POLICY.items():
        node_type, _, attr = row.partition(".")
        if node_type == "widgetEmbed" and "drop" in decision.values():
            assert attr not in pnp.EMBED_KEPT_ATTRS, row


@pytest.mark.parametrize("mode", ["share", "publish", "gallery"])
@pytest.mark.parametrize("widget_id", ["chart", "fundamentals"])
def test_ta_never_reaches_a_stranger_in_any_mode(mode, widget_id):
    """`fundamentals` is SHOWN in share/publish (the allowlist path); `chart` is the neutral
    line there; gallery neutralises both. Whichever path, no public node carries `ta`, and
    neither its setup tag nor its planned shares appears as text."""
    out = reduce(doc(_widget(widget_id)), mode)
    blob = json.dumps(out)
    assert '"ta"' not in blob and "Breakout" not in blob, (mode, widget_id, blob[:400])


@pytest.mark.parametrize("mode", ["share", "publish", "gallery"])
def test_a_mood_checkin_never_reaches_a_stranger(mode):
    """P2 Tier 3 Task 3: the check-in is the member's own mood and focus, so its vendor row is
    "private" -- a public copy carries the neutral line and nothing of the node: no level, no word, no
    day. (Its searchText is the fixed catalog line, which names no mood either.)"""
    assert pnp.MARKET_DATA_VENDORS[("widgetEmbed", "moodCheckIn")] == "private"
    node = {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": "moodCheckIn", "embedId": "e-mood", "mode": "snapshot",
        "params": {"mood": "4", "focus": "5", "day": "2026-10-17"},
        "searchText": "[mood and focus check-in]", "capturedAt": "2026-10-17T13:00:00Z"}}
    out = reduce(doc(p(t("before")), node, p(t("after"))), mode)
    assert texts_in(out) == ["before", NEUTRAL, "after"]
    blob = json.dumps(out)
    for leak in ("moodCheckIn", "2026-10-17", '"mood"', '"focus"', "Good", "Great", "Locked in", "e-mood"):
        assert leak not in blob, (mode, leak)


@pytest.mark.parametrize("mode", ["share", "publish"])
def test_facts_render_by_vendor(mode):
    body = doc(*[{"type": "financialFact", "attrs": {"factId": f}} for f in (
        "fact-fmp", "fact-finnhub", "fact-massive", "fact-user", "fact-blocked", "fact-not-this-note")])
    out = reduce(body, mode)
    lines = texts_in(out)
    assert lines[0] == "AAPL · Analyst Price Target (Consensus): $212.50 (captured 2026-09-01)"
    assert lines[1].startswith("MSFT · Price: $401.00")
    assert lines[2] == NEUTRAL                                    # Massive
    assert lines[3] == "TSLA · Note: my target 300 — why I think so (captured 2026-09-04)"
    assert lines[4] == NEUTRAL                                    # rights_class blocked
    assert len(lines) == 5                                        # a foreign fact id: nothing
    assert "financialFact" not in types_in(out) and "fact-" not in json.dumps(out)


# ── the flip packet's NEVER list, one rail each, on a PUBLISHED note ────────────────────

LEAKY_NOTE = {
    "title": "Published research", "subtitle": "sub", "heroImageUrl": f"{OWN_ATT}hero/h.png",
    "updatedAt": "2026-09-25T00:00:00Z", "userId": OWNER, "tags": ["private-tag"], "ticker": "ZZTK",
    "folderId": "folder-private", "propertiesJson": {"builtin:review_date": "2031-07-19"},
    "authorName": "Pat Member", "email": "member@example.com", "backlinks": [{"noteId": OTHER}],
    "bodyJson": doc(
        {"type": "askInsert", "attrs": {"question": "Ask q", "scope": "notebook"},
         "content": [p(t("an ask answer"), {"type": "askCitation", "attrs": {
             "n": 1, "label": "Other private title", "nav": {"note_id": OTHER}}})]},
        p(t("mine "), {"type": "askCitation", "attrs": {"n": 2, "label": "Other private title"}}),
        p({"type": "noteLink", "attrs": {"noteId": OTHER}},
          t("trade", {"type": "link", "attrs": {"href": "/journal-2-0/trade/t-99"}})),
        {"type": "attachmentChip", "attrs": {"href": f"{OWN_ATT}file/r.pdf", "name": "r.pdf"}},
        _widget("chart"), _widget("optionsflow"),
    ),
}


@pytest.fixture
def published():
    return pnp.public_note(copy.deepcopy(LEAKY_NOTE), mode="publish", owner_id=OWNER, note_id=NOTE,
                           attachment_base="/api/j2/published/SLUG/att/", facts=FACTS)


def test_renders_title_subtitle_hero_and_body(published):
    assert set(published) == set(pnp.PUBLIC_NOTE_KEYS)
    assert published["title"] == "Published research" and published["subtitle"] == "sub"
    assert published["heroImageUrl"] == "/api/j2/published/SLUG/att/hero/h.png"
    assert "mine " in texts_in(published["bodyJson"])


def test_never_ask_answers(published):
    assert "an ask answer" not in json.dumps(published) and "Ask q" not in json.dumps(published)


def test_never_askcitation_chips(published):
    assert "askCitation" not in types_in(published["bodyJson"])


def test_never_properties(published):
    assert "2031-07-19" not in json.dumps(published) and "review_date" not in json.dumps(published)


def test_never_tags_folder_path_or_ticker(published):
    blob = json.dumps(published)
    for leak in ("private-tag", "folder-private", "ZZTK"):
        assert leak not in blob, leak


def test_never_trade_links(published):
    assert "/journal-2-0/trade/" not in json.dumps(published)


def test_never_backlinks_or_unlinked_mentions(published):
    assert "backlinks" not in json.dumps(published) and "mentions" not in json.dumps(published)


def test_never_other_notes_titles_or_ids(published):
    blob = json.dumps(published)
    assert OTHER not in blob and "Other private title" not in blob


def test_never_file_attachments(published):
    assert "attachmentChip" not in types_in(published["bodyJson"]) and "r.pdf" not in json.dumps(published)


def test_never_vendor_data_nodes(published):
    assert "widgetEmbed" not in types_in(published["bodyJson"])
    assert NEUTRAL in texts_in(published["bodyJson"])


def test_never_the_authors_identity(published):
    blob = json.dumps(published)
    for leak in (OWNER, "Pat Member", "member@example.com"):
        assert leak not in blob, leak


# ── Notebook widgets (Task 5): account kinds are neutral unless the member switches them on ──

ACCOUNT_LINE = pnp.ACCOUNT_NEUTRAL_LINE


def _pnl(share: Any = True) -> dict:
    node = _widget("myPnlStats")
    node["attrs"]["params"] = {
        "asOf": "2026-10-20T14:00:00Z", "source": "broker", "range": "30d", "netPnl": 1234.5,
        "winRate": 0.55, "avgR": 0.4, "tradeCount": 12, "equity": [1, 2, 3], "empty": False,
        "accountNumber": "PRIVATE-ACCT-0042", "share": share}
    return node


def _positions(share: Any = True) -> dict:
    node = _widget("myPositionsRisk")
    node["attrs"]["params"] = {
        "asOf": "2026-10-20T14:00:00Z", "source": "broker", "accountSize": 50000,
        "rows": [{"symbol": "AAPL", "positionId": "pos-secret-1", "riskPct": 1.0},
                 {"symbol": "MSFT", "positionId": "pos-secret-2", "riskPct": 0.5}],
        "truncated": 3, "empty": False, "share": share}
    return node


def test_account_neutral_line_is_the_exact_words_and_exported():
    assert ACCOUNT_LINE == "A private account item is not shown on public pages."
    assert "ACCOUNT_NEUTRAL_LINE" in pnp.__all__
    assert ACCOUNT_LINE != NEUTRAL


def test_member_optin_vendor_fails_closed():
    assert pnp.VENDOR_VERDICT["member-optin"] == pnp.NEUTRAL
    for kind in ("myPnlStats", "myPositionsRisk", "myRulesCheck", "myMistakes",
                 "tradeRecap", "myPnlCalendar", "mySetupEdge"):
        assert pnp.MARKET_DATA_VENDORS[("widgetEmbed", kind)] == "member-optin", kind
        assert pnp.market_data_verdict("widgetEmbed", kind) == pnp.NEUTRAL, kind
    for kind in ("tickerCard", "myWatchlistToday", "myNamesReporting", "marketOnMyNames", "tickerFlow",
                 "myScreenToday", "roomBuzzOnMyNames", "myEarningsReactions"):
        assert pnp.MARKET_DATA_VENDORS[("widgetEmbed", kind)] == "mixed", kind


@pytest.mark.parametrize("mode", ["share", "publish"])
@pytest.mark.parametrize("make", [_pnl, _positions])
def test_account_kind_neutral_without_share(mode, make):
    for share in (None, False):
        node = make(share)
        if share is None:
            node["attrs"]["params"].pop("share")
        out = reduce(doc(node), mode)
        assert texts_in(out) == [ACCOUNT_LINE], (mode, share, out)
        assert "widgetEmbed" not in types_in(out)
        assert "1234.5" not in json.dumps(out) and "PRIVATE-ACCT-0042" not in json.dumps(out)


@pytest.mark.parametrize("mode", ["share", "publish"])
def test_account_kind_shown_with_share(mode):
    out = reduce(doc(_pnl(True)), mode)
    emb = find_embed(out)
    assert emb["attrs"]["widgetId"] == "myPnlStats"
    params = emb["attrs"]["params"]
    assert params["netPnl"] == 1234.5 and params["share"] is True
    assert "accountNumber" not in params          # only the named keys survive


@pytest.mark.parametrize("mode", ["share", "publish"])
def test_positions_shown_strips_position_id(mode):
    out = reduce(doc(_positions(True)), mode)
    emb = find_embed(out)
    rows = emb["attrs"]["params"]["rows"]
    assert [r["symbol"] for r in rows] == ["AAPL", "MSFT"]
    assert emb["attrs"]["params"]["truncated"] == 3
    assert "positionId" not in json.dumps(out)
    assert "pos-secret" not in json.dumps(out)


def find_embed(d: dict) -> dict:
    found = find(d, "widgetEmbed")
    assert len(found) == 1, d
    return found[0]


@pytest.mark.parametrize("make", [_pnl, _positions])
def test_account_kind_gallery_always_neutral(make):
    out = reduce(doc(make(True)), "gallery")
    assert texts_in(out) == [ACCOUNT_LINE]
    assert "widgetEmbed" not in types_in(out)
    assert "positionId" not in json.dumps(out)


@pytest.mark.parametrize("make", [_pnl, _positions])
def test_share_switched_off_hides_again(make):
    on = reduce(doc(make(True)), "share")
    assert "widgetEmbed" in types_in(on)
    off = reduce(doc(make(False)), "share")
    assert texts_in(off) == [ACCOUNT_LINE]


@pytest.mark.parametrize("mode", ["share", "publish"])
@pytest.mark.parametrize("bad", ["true", 1, "True", [True], {"v": True}])
def test_share_truthy_string_is_not_true(mode, bad):
    out = reduce(doc(_pnl(bad)), mode)
    assert texts_in(out) == [ACCOUNT_LINE], (bad, out)


@pytest.mark.parametrize("mode", ["share", "publish", "gallery"])
@pytest.mark.parametrize("kind", ["myWatchlistToday", "myNamesReporting", "tickerCard"])
def test_market_widget_kinds_neutral(mode, kind):
    out = reduce(doc(_widget(kind)), mode)
    assert texts_in(out) == [NEUTRAL]


def test_adjacent_mixed_neutral_lines_collapse_per_line():
    two_account = reduce(doc(_pnl(False), _positions(False)), "share")
    assert texts_in(two_account) == [ACCOUNT_LINE]
    mixed = reduce(doc(_widget("tickerCard"), _pnl(False)), "share")
    assert texts_in(mixed) == [NEUTRAL, ACCOUNT_LINE]
    mixed2 = reduce(doc(_pnl(False), _widget("tickerCard"), _widget("chart")), "share")
    assert texts_in(mixed2) == [ACCOUNT_LINE, NEUTRAL]
    gallery = reduce(doc(_pnl(True), _positions(True)), "gallery")
    assert texts_in(gallery) == [ACCOUNT_LINE]


def test_nested_account_kind_in_a_container_follows_the_same_rule():
    body = doc({"type": "blockquote", "content": [_pnl(False)]})
    assert texts_in(reduce(body, "share")) == [ACCOUNT_LINE]
    body = doc({"type": "blockquote", "content": [_positions(True)]})
    assert "positionId" not in json.dumps(reduce(body, "publish"))


# ── Task 12: myRulesCheck and myMistakes follow the same share switch ──

def _rules_check(share: Any = True) -> dict:
    node = _widget("myRulesCheck")
    node["attrs"]["params"] = {
        "asOf": "2026-10-20T14:00:00Z", "source": "manual", "range": {"from": "2026-10-19", "to": "2026-10-20"},
        "rules": [{"rule": "Volume dried up", "kept": 2, "total": 3}], "empty": None,
        "accountNumber": "PRIVATE-ACCT-0042", "share": share}
    return node


def _mistakes(share: Any = True) -> dict:
    node = _widget("myMistakes")
    node["attrs"]["params"] = {
        "asOf": "2026-10-20T14:00:00Z", "source": "broker",
        "rows": [{"mistake": "fomo", "cost30d": -300.0, "countNow": 4, "countPrior": 2, "trend": "more",
                  "positionId": "pos-secret-9"}],
        "empty": None, "accountNumber": "PRIVATE-ACCT-0042", "share": share}
    return node


@pytest.mark.parametrize("mode", ["share", "publish"])
@pytest.mark.parametrize("make", [_rules_check, _mistakes])
def test_wave2_account_kind_neutral_without_share(mode, make):
    for share in (None, False, "true", 1):
        node = make(share)
        if share is None:
            node["attrs"]["params"].pop("share")
        out = reduce(doc(node), mode)
        assert texts_in(out) == [ACCOUNT_LINE], (mode, share, out)
        assert "widgetEmbed" not in types_in(out)
        blob = json.dumps(out)
        for leak in ("Volume dried up", "fomo", "-300", "PRIVATE-ACCT-0042"):
            assert leak not in blob, (mode, share, leak)


@pytest.mark.parametrize("mode", ["share", "publish"])
def test_rules_check_shown_with_share_keeps_only_the_named_keys(mode):
    emb = find_embed(reduce(doc(_rules_check(True)), mode))
    params = emb["attrs"]["params"]
    assert emb["attrs"]["widgetId"] == "myRulesCheck"
    assert params["rules"] == [{"rule": "Volume dried up", "kept": 2, "total": 3}]
    assert params["range"] == {"from": "2026-10-19", "to": "2026-10-20"} and params["share"] is True
    assert "accountNumber" not in params


@pytest.mark.parametrize("mode", ["share", "publish"])
def test_mistakes_shown_with_share_keeps_only_the_named_keys_and_no_position_id(mode):
    out = reduce(doc(_mistakes(True)), mode)
    emb = find_embed(out)
    params = emb["attrs"]["params"]
    assert emb["attrs"]["widgetId"] == "myMistakes"
    assert params["rows"][0]["mistake"] == "fomo" and params["rows"][0]["trend"] == "more"
    assert "accountNumber" not in params
    assert "positionId" not in json.dumps(out) and "pos-secret-9" not in json.dumps(out)


def test_wave2_param_keys_are_the_ones_the_builders_emit():
    assert pnp.EMBED_PARAM_KEYS["myRulesCheck"] == ("asOf", "source", "range", "kept", "total", "rules", "empty", "share",
                                                    "truncated", "tooLarge")
    assert pnp.EMBED_PARAM_KEYS["myMistakes"] == ("asOf", "source", "rows", "empty", "share", "truncated", "tooLarge")


def _cap_honesty_keys(kind: str) -> set[str]:
    """The keys notebook_widgets.cap_payload ITSELF adds to a `kind` payload, read off its real output (fix
    F1b, review M-4): the too-large form, a trimmed list, and (for a kind that publishes `mistakes`) a
    mistake list past MISTAKES_MAX. Derived from the cap, never restated."""
    from api.services.journal_two import notebook_widgets as nw
    base = {"asOf": "2026-10-20T14:00:00Z", "source": "manual"}
    added: set[str] = set()
    big = nw.cap_payload({**base, "blob": "x" * (nw.PAYLOAD_CAP_BYTES + 10)}, kind)
    added |= set(big) - set(base) - {"blob"}
    key = nw.LIST_KEY[kind]
    trimmed = nw.cap_payload({**base, key: [{"pad": "x" * 2000} for _ in range(20)]}, kind)
    added |= set(trimmed) - set(base) - {key}
    if "mistakes" in pnp.EMBED_ROW_KEYS.get(kind, {}):
        clipped = nw.cap_payload({**base, "mistakes": [f"m{i}" for i in range(nw.MISTAKES_MAX + 3)]}, kind)
        added |= set(clipped) - set(base) - {"mistakes"}
    return added


def test_m4_every_cap_honesty_key_reaches_a_shown_account_widget():
    from api.services.journal_two import notebook_widgets as nw
    for kind in sorted(nw.ACCOUNT_KINDS):
        added = _cap_honesty_keys(kind)
        assert {"tooLarge", "empty", "truncated"} <= added, (kind, added)     # control: the fixtures hit the cap
        assert added <= set(pnp.EMBED_PARAM_KEYS[kind]), (kind, added - set(pnp.EMBED_PARAM_KEYS[kind]))
    assert "mistakesTruncated" in _cap_honesty_keys("tradeRecap")


@pytest.mark.parametrize("mode", ["share", "publish"])
def test_m4_the_too_large_sentence_reaches_a_public_reader(mode):
    """A shown account widget whose data hit the cap is published WITH its sentence, never as a blank frame."""
    from api.services.journal_two import notebook_widgets as nw
    for kind in sorted(nw.ACCOUNT_KINDS):
        node = _widget(kind)
        payload = nw.cap_payload({"asOf": "2026-10-20T14:00:00Z", "source": "manual",
                                  "blob": "x" * (nw.PAYLOAD_CAP_BYTES + 10)}, kind)
        node["attrs"]["params"] = dict(payload, share=True)
        params = find_embed(reduce(doc(node), mode))["attrs"]["params"]
        assert params.get("tooLarge") is True and params.get("empty") == nw.TOO_LARGE_SENTENCE, (kind, params)
    node = _widget("tradeRecap")
    node["attrs"]["params"] = dict(nw.cap_payload({"asOf": "2026-10-20T14:00:00Z", "source": "manual",
                                                   "mistakes": [f"m{i}" for i in range(nw.MISTAKES_MAX + 5)]},
                                                  "tradeRecap"), share=True)
    params = find_embed(reduce(doc(node), mode))["attrs"]["params"]
    assert params["mistakesTruncated"] == 5 and len(params["mistakes"]) == nw.MISTAKES_MAX


# ── Notebook widgets wave 3 (Task 14): the two market kinds stay neutral, switch or no switch ──

_WAVE3_PARAMS = {
    "marketOnMyNames": {"asOf": "2026-10-20T14:00:00Z", "source": "market", "sectorBasis": "your names",
                        "rows": [{"symbol": "NVDA", "ret5d": 4.2, "sector": "Technology",
                                  "sectorRet5d": 1.1, "vsSector": 3.1}]},
    "tickerFlow": {"asOf": "2026-10-20T14:00:00Z", "source": "market", "symbol": "NVDA",
                   "bullPremium": 987654, "bearPremium": 12345, "window": "Today",
                   "topPrints": [{"cp": "C", "strike": 200.0, "exp": "11/20/2026", "premium": 987654}]},
}


@pytest.mark.parametrize("mode", ["share", "publish"])
@pytest.mark.parametrize("kind", sorted(_WAVE3_PARAMS))
def test_wave3_market_kind_is_neutral_even_with_share(mode, kind):
    for share in (None, False, True):
        node = _widget(kind)
        node["attrs"]["params"] = dict(_WAVE3_PARAMS[kind], **({} if share is None else {"share": share}))
        out = reduce(doc(node), mode)
        assert texts_in(out) == [NEUTRAL], (kind, mode, share, out)
        assert "widgetEmbed" not in types_in(out)
        assert "987654" not in json.dumps(out) and "3.1" not in json.dumps(out)


# ── Notebook widgets wave 6 (Task 19): the three account kinds follow the share switch ──

_WAVE6_ACCOUNT_PARAMS = {
    "tradeRecap": {"asOf": "2026-10-20T14:00:00Z", "source": "broker", "symbol": "NVDA", "side": "Long",
                   "entryDate": "2026-09-01", "exitDate": "2026-09-10", "entryPrice": 100.0, "exitPrice": 110.0,
                   "r": 2.0, "pnl": 995.0, "setup": "Flag", "holdDays": 9, "mistakes": ["fomo"],
                   "bars": [{"t": "2026-09-01", "o": 1, "h": 2, "l": 0.5, "c": 1.5}],
                   "tradeId": "trade-secret-77", "accountNumber": "PRIVATE-ACCT-0042"},
    "myPnlCalendar": {"asOf": "2026-10-20T14:00:00Z", "source": "manual", "month": "2026-10",
                      "days": [{"day": "2026-10-01", "pnl": 120.0}],
                      "best": {"day": "2026-10-01", "pnl": 120.0}, "worst": {"day": "2026-10-01", "pnl": 120.0},
                      "accountNumber": "PRIVATE-ACCT-0042"},
    "mySetupEdge": {"asOf": "2026-10-20T14:00:00Z", "source": "mixed",
                    "rows": [{"setup": "Flag", "n": 30, "expectancyR": 0.42, "winRate": 0.55, "thin": False,
                              "positionId": "pos-secret-6"}],
                    "truncated": 2, "accountNumber": "PRIVATE-ACCT-0042"},
}


def _wave6(kind: str, share: Any = True) -> dict:
    node = _widget(kind)
    node["attrs"]["params"] = dict(copy.deepcopy(_WAVE6_ACCOUNT_PARAMS[kind]),
                                   **({} if share is None else {"share": share}))
    return node


def test_wave6_account_kinds_have_their_embed_keys_and_never_trade_id():
    for kind in _WAVE6_ACCOUNT_PARAMS:
        assert pnp.MARKET_DATA_VENDORS[("widgetEmbed", kind)] == "member-optin", kind
        assert "share" in pnp.EMBED_PARAM_KEYS[kind], kind
        assert "tradeId" not in pnp.EMBED_PARAM_KEYS[kind] and "positionId" not in pnp.EMBED_PARAM_KEYS[kind]


def test_wave6_embed_keys_are_the_ones_the_builders_emit():
    from api.services.journal_two import notebook_widgets as nw
    import inspect
    emitted = {
        "tradeRecap": ("asOf", "source", "symbol", "side", "entryDate", "exitDate", "entryPrice", "exitPrice",
                       "r", "pnl", "setup", "holdDays", "mistakes", "bars"),
        "myPnlCalendar": ("asOf", "source", "month", "days", "best", "worst", "empty"),
        "mySetupEdge": ("asOf", "source", "rows", "empty", "truncated"),
    }
    for kind, keys in emitted.items():
        assert set(pnp.EMBED_PARAM_KEYS[kind]) == set(keys) | {"share"} | _cap_honesty_keys(kind), kind
        src = inspect.getsource(nw._BUILDERS[kind])
        for k in keys:
            assert f'"{k}"' in src, (kind, k)              # every kept key is one the builder writes


@pytest.mark.parametrize("mode", ["share", "publish"])
@pytest.mark.parametrize("kind", sorted(_WAVE6_ACCOUNT_PARAMS))
def test_wave6_account_kind_neutral_without_share(mode, kind):
    for share in (None, False, "true", 1):
        out = reduce(doc(_wave6(kind, share)), mode)
        assert texts_in(out) == [ACCOUNT_LINE], (kind, mode, share, out)
        assert "widgetEmbed" not in types_in(out)
        blob = json.dumps(out)
        for leak in ("NVDA", "995", "120.0", "Flag", "PRIVATE-ACCT-0042", "trade-secret-77"):
            assert leak not in blob, (kind, mode, share, leak)


@pytest.mark.parametrize("kind", sorted(_WAVE6_ACCOUNT_PARAMS))
def test_wave6_account_kind_gallery_always_neutral(kind):
    out = reduce(doc(_wave6(kind, True)), "gallery")
    assert texts_in(out) == [ACCOUNT_LINE] and "widgetEmbed" not in types_in(out)


@pytest.mark.parametrize("mode", ["share", "publish"])
def test_trade_recap_shown_with_share_never_carries_the_trade_id(mode):
    out = reduce(doc(_wave6("tradeRecap", True)), mode)
    emb = find_embed(out)
    params = emb["attrs"]["params"]
    assert emb["attrs"]["widgetId"] == "tradeRecap"
    assert params["symbol"] == "NVDA" and params["r"] == 2.0 and params["bars"][0]["t"] == "2026-09-01"
    assert params["share"] is True
    blob = json.dumps(out)
    assert "tradeId" not in blob and "trade-secret-77" not in blob
    assert "tradeRef" not in blob and "accountNumber" not in params


@pytest.mark.parametrize("mode", ["share", "publish"])
def test_pnl_calendar_and_setup_edge_shown_with_share_keep_only_named_keys(mode):
    cal = find_embed(reduce(doc(_wave6("myPnlCalendar", True)), mode))["attrs"]["params"]
    assert cal["month"] == "2026-10" and cal["best"] == {"day": "2026-10-01", "pnl": 120.0}
    assert "accountNumber" not in cal
    out = reduce(doc(_wave6("mySetupEdge", True)), mode)
    edge = find_embed(out)["attrs"]["params"]
    assert edge["rows"][0]["setup"] == "Flag" and edge["truncated"] == 2
    assert "accountNumber" not in edge and "pos-secret-6" not in json.dumps(out)


_WAVE6_MARKET_PARAMS = {
    "myScreenToday": {"asOf": "2026-10-20T14:00:00Z", "source": "market", "name": "My screen",
                      "hits": [{"symbol": "NVDA", "price": 987654, "changePct": 3.1}],
                      "coverage": {"evaluated": 1, "answered": 1, "dropped": 0, "notComputable": 0, "withheld": 0},
                      "definitionId": "u_0123456789ab"},
    "roomBuzzOnMyNames": {"asOf": "2026-10-20T14:00:00Z", "source": "market",
                          "rows": [{"symbol": "NVDA", "mentions": 987654, "people": 3}]},
    "myEarningsReactions": {"asOf": "2026-10-20T14:00:00Z", "source": "market",
                            "rows": [{"symbol": "NVDA", "day": "2026-10-15", "epsActual": 987654,
                                      "nextDayPct": 3.1}]},
}


@pytest.mark.parametrize("mode", ["share", "publish"])
@pytest.mark.parametrize("kind", sorted(_WAVE6_MARKET_PARAMS))
def test_wave6_market_kind_is_neutral_even_with_share(mode, kind):
    for share in (None, False, True):
        node = _widget(kind)
        node["attrs"]["params"] = dict(_WAVE6_MARKET_PARAMS[kind], **({} if share is None else {"share": share}))
        out = reduce(doc(node), mode)
        assert texts_in(out) == [NEUTRAL], (kind, mode, share, out)
        assert "widgetEmbed" not in types_in(out)
        assert "987654" not in json.dumps(out) and "u_0123456789ab" not in json.dumps(out)


# ── Ruling R60: a shown account widget publishes its rows through a per-kind row allowlist ──

_SECRET = {"positionId": "SECRET-pos", "nested": {"positionId": "SECRET-nested", "tradeId": "SECRET-trade"},
           "extraKey": "<b>SECRET-extra</b>", "accountNumber": "SECRET-acct"}

_R60_PARAMS = {
    "myPositionsRisk": {"rows": [{"symbol": "AAPL", "side": "Long", "kind": "stock", "sizePct": 2.0, "openPnl": 77.7,
                                  "stopPrice": 95.0, "distToStopPct": 5.0, "noStop": False, **_SECRET}]},
    "myMistakes": {"rows": [{"mistake": "fomo", "cost30d": -10.0, "countNow": 2, "countPrior": 1, "trend": "more",
                             **_SECRET}]},
    "mySetupEdge": {"rows": [{"setup": "Flag", "n": 30, "expectancyR": 0.4, "winRate": 0.5, "thin": False,
                              **_SECRET}]},
    "myRulesCheck": {"range": {"from": "2026-10-13", "to": "2026-10-20", **_SECRET},
                     "rules": [{"rule": "Wait for the open", "kept": 3, "total": 4, **_SECRET}]},
    "myPnlCalendar": {"days": [{"day": "2026-10-01", "pnl": 120.0, **_SECRET}],
                      "best": {"day": "2026-10-01", "pnl": 120.0, **_SECRET},
                      "worst": {"day": "2026-10-01", "pnl": 120.0, **_SECRET}},
    "tradeRecap": {"bars": [{"t": "2026-09-01", "o": 1, "h": 2, "l": 0.5, "c": 1.5, **_SECRET}],
                   "mistakes": ["fomo", {"positionId": "SECRET-in-a-list"}, ["SECRET-list"]]},
    "myPnlStats": {"range": {"from": "2026-10-13", "to": "2026-10-20", **_SECRET},
                   "equity": [["2026-10-13", 100.0], ["2026-10-14", {"tradeId": "SECRET-eq"}], {"positionId": "SECRET-x"}]},
}


@pytest.mark.parametrize("mode", ["share", "publish"])
@pytest.mark.parametrize("kind", sorted(_R60_PARAMS))
def test_r60_rows_keep_only_their_allowlisted_scalar_keys(kind, mode):
    node = _widget(kind)
    node["attrs"]["params"] = dict(copy.deepcopy(_R60_PARAMS[kind]), asOf="2026-10-20T14:00:00Z", share=True)
    out = reduce(doc(node), mode)
    blob = json.dumps(out)
    assert "SECRET" not in blob, (kind, mode, blob)
    params = find_embed(out)["attrs"]["params"]
    for key, allowed in pnp.EMBED_ROW_KEYS[kind].items():
        val = params.get(key)
        items = val if isinstance(val, list) else [val]
        for item in items:
            if isinstance(item, dict):
                assert set(item) <= set(allowed), (kind, key, item)
                assert item, (kind, key)                           # control: the allowed figures survived
    # control: the figure the member chose to share is there
    assert any(str(x) in blob for x in ("77.7", "fomo", "Flag", "Wait for the open", "120.0", "1.5", "100.0"))


def test_r60_every_structured_param_a_builder_emits_has_a_row_allowlist():
    """A list or object kept by EMBED_PARAM_KEYS without an EMBED_ROW_KEYS entry would be silently dropped
    from a shown widget; the table must name every one the account builders write."""
    structured = {"myPnlStats": {"range", "equity"}, "myPositionsRisk": {"rows"}, "myRulesCheck": {"range", "rules"},
                  "myMistakes": {"rows"}, "tradeRecap": {"bars", "mistakes"},
                  "myPnlCalendar": {"days", "best", "worst"}, "mySetupEdge": {"rows"},
                  # Task 8.12; ACCOUNT_KINDS gains it in 8.13, so it is compared on both sides until then
                  "builtWidget": {"measures", "value", "compare", "rows", "series", "points", "cells"}}
    from api.services.journal_two import notebook_widgets as nw
    assert "builtWidget" not in nw.ACCOUNT_KINDS, (
        "8.13 landed: drop the {'builtWidget'} tolerance in R60 and test_account_kinds_agree...")
    assert set(structured) == set(nw.ACCOUNT_KINDS) | {"builtWidget"} == set(pnp.EMBED_ROW_KEYS)
    for kind, keys in structured.items():
        assert set(pnp.EMBED_ROW_KEYS[kind]) == keys, kind
        assert keys <= set(pnp.EMBED_PARAM_KEYS[kind]), kind
        for allowed in pnp.EMBED_ROW_KEYS[kind].values():
            assert "positionId" not in allowed and "tradeId" not in allowed and "definitionId" not in allowed


#: Ruling R64: what the client now STORES in a widget's params at insert, beside the frozen payload -- the F1
#: payload honesty/provenance keys and every request key (notebook_widgets.SETTING_KEYS, `range`, and the
#: identifiers a list, screen, account, trade, note or folder is named by).
_R64_STORED = {
    "empty": "SENTENCE-empty", "failed": True, "sourceDetail": "SECRET-sourceDetail", "priceBasis": "broker",
    "earningsUnknown": True, "timingUnknown": True, "nextDayNote": "SECRET-nextDayNote", "tooLarge": True,
    "mistakesTruncated": 3,
    "list": "SECRET-list", "from": "1999-01-01", "to": "1999-12-31", "symbol": "ZZQQ", "month": "1999-07",
    "range": {"from": "1999-01-01", "to": "1999-12-31"}, "definitionId": "u_0123456789ab", "tradeId": "SECRET-trade",
    "accountId": "SECRET-acct", "positionId": "SECRET-pos", "listId": "SECRET-listid", "watchKey": "SECRET-watch",
    "scanKey": "SECRET-scan", "noteId": "SECRET-note", "folderId": "SECRET-folder", "setupId": "SECRET-setup",
}
#: Never on a public page for ANY account kind: request keys with no payload meaning, provenance, identifiers.
_R64_NEVER = {"list", "from", "to", "definitionId", "tradeId", "accountId", "positionId", "listId", "watchKey",
              "scanKey", "noteId", "folderId", "setupId", "sourceDetail", "priceBasis", "nextDayNote", "failed",
              "earningsUnknown", "timingUnknown"}


def test_r64_the_never_keys_are_in_no_account_allowlist():
    from api.services.journal_two import notebook_widgets as nw
    assert set(nw.SETTING_KEYS) - {"symbol", "month"} <= _R64_NEVER         # control: every request key is covered
    for kind in sorted(nw.ACCOUNT_KINDS):
        assert not set(pnp.EMBED_PARAM_KEYS[kind]) & _R64_NEVER, (kind, set(pnp.EMBED_PARAM_KEYS[kind]) & _R64_NEVER)


@pytest.mark.parametrize("mode", ["share", "publish"])
def test_r64_stored_request_and_provenance_keys_reach_a_public_page_only_through_the_allowlist(mode):
    """Every account kind with EVERY stored key set: share off is the neutral line and nothing else; share on
    publishes only that kind's EMBED_PARAM_KEYS, so a request key or sourceDetail/priceBasis reaches a stranger
    only where the member-optin table already names that exact key."""
    from api.services.journal_two import notebook_widgets as nw
    for kind in sorted(nw.ACCOUNT_KINDS):
        for share in (None, False, True):
            node = _widget(kind)
            node["attrs"]["params"] = dict(copy.deepcopy(_R64_STORED), asOf="2026-10-20T14:00:00Z",
                                           **({} if share is None else {"share": share}))
            out = reduce(doc(node), mode)
            blob = json.dumps(out)
            if share is not True:
                assert texts_in(out) == [ACCOUNT_LINE] and "widgetEmbed" not in types_in(out), (kind, share)
                assert "SECRET" not in blob and "1999" not in blob and "ZZQQ" not in blob, (kind, share)
                continue
            params = find_embed(out)["attrs"]["params"]
            assert set(params) <= set(pnp.EMBED_PARAM_KEYS[kind]), (kind, set(params) - set(pnp.EMBED_PARAM_KEYS[kind]))
            assert not set(params) & _R64_NEVER, kind
            assert "SECRET" not in blob, (kind, blob)
            assert params["asOf"] == "2026-10-20T14:00:00Z" and params["share"] is True    # control: shown


def test_m6_an_empty_tuple_entry_keeps_no_keys_it_fails_closed(monkeypatch):
    """Fix F1b (review M-6): the item shapes are matched by identity, so an EMBED_ROW_KEYS entry written `()`
    to mean "keep no keys" keeps NOTHING -- it used to equal SCALAR_ITEMS and pass every scalar through."""
    params = {"mistakes": ["fomo", "chased"], "bars": [{"t": "2026-09-01", "c": 1.5}],
              "range": {"from": "2026-10-13", "to": "2026-10-20"}, "share": True}
    # control: with the real table the member's figures are there
    real = pnp.allowed_params("tradeRecap", params)
    assert real["mistakes"] == ["fomo", "chased"] and real["bars"] == [{"t": "2026-09-01", "c": 1.5}]
    monkeypatch.setitem(pnp.EMBED_ROW_KEYS, "tradeRecap", {"mistakes": (), "bars": ()})
    out = pnp.allowed_params("tradeRecap", params)
    assert out["mistakes"] == [] and out["bars"] == [], out          # review m7: no items, so no count either
    monkeypatch.setitem(pnp.EMBED_ROW_KEYS, "myPnlStats", {"range": (), "equity": ()})
    out = pnp.allowed_params("myPnlStats", {"range": params["range"], "equity": [["2026-10-13", 100.0]]})
    assert out == {"range": {}, "equity": []}, out
    # a shape placed where a dict's keys are read names no key either
    monkeypatch.setitem(pnp.EMBED_ROW_KEYS, "myPnlStats", {"range": pnp.SCALAR_ITEMS})
    assert pnp.allowed_params("myPnlStats", {"range": params["range"]}) == {"range": {}}
    assert () is not pnp.SCALAR_ITEMS and () != pnp.SCALAR_ITEMS
    # review m7: a () entry on a many-row list publishes nothing a stranger could count
    monkeypatch.setitem(pnp.EMBED_ROW_KEYS, "mySetupEdge", {"rows": ()})
    rows = [{"setup": f"S{i}", "n": i} for i in range(7)]
    assert pnp.allowed_params("mySetupEdge", {"rows": rows})["rows"] == []


def test_r60_the_positions_row_allowlist_is_the_builders_row_less_its_id(monkeypatch):
    """Derived, not restated (fix F1b, review M-7): the keys of a stock row AND an option row as
    `myPositionsRisk` actually BUILDS them, less positionId, are exactly the allowlist -- so a key the
    builder adds and the allowlist misses (or one the allowlist names and no row carries) reds here."""
    from datetime import datetime, timezone
    from api.services.journal_two import notebook_widgets as nw
    import api.routers.live_prices as lp
    import api.services.journal_two.options as op
    import api.services.journal_two.positions as ps
    import api.services.portfolio_heat as ph
    stock = {"id": "p1", "symbol": "NVDA", "side": "Long", "shares": 10, "entryPrice": 100.0,
             "stopPrice": 95.0, "source": "manual"}
    option = {"id": "st-1", "underlying": "CRWV", "strategyType": "long_call", "netEntry": 1200.0,
              "brokerCurrentValue": 1500.0, "source": "broker", "status": "open",
              "legs": [{"side": "buy", "contractType": "call", "strike": 110.0, "expiration": "2026-10-16",
                        "qty": 2, "entryPrice": 6.0}]}
    monkeypatch.setattr(ps, "list_open_positions", lambda user_id, *a, **k: [stock])
    monkeypatch.setattr(op, "list_strategies", lambda user_id, status=None, **k: [option] if status == "open" else [])
    monkeypatch.setattr(ph, "portfolio_heat", lambda user_id, *a, **k: {"ok": True, "per_position": [
        {"symbol": "NVDA", "side": "Long", "dist_to_stop_pct": 5.0, "stop_price": 95.0, "placeholder_stop": False}]})
    monkeypatch.setattr(nw, "_account_size", lambda user_id: 50000.0)
    monkeypatch.setattr(nw, "_accounts_by_id", lambda user_id: {})
    monkeypatch.setattr(lp, "get_live_prices", lambda tickers="": {"NVDA": {"price": 110.0}})
    rows = nw.build("myPositionsRisk", "u1", {}, now=datetime(2026, 10, 20, 15, 0, tzinfo=timezone.utc))["rows"]
    assert sorted(r["kind"] for r in rows) == ["option", "stock"]           # control: both kinds were built
    allowed = set(pnp.EMBED_ROW_KEYS["myPositionsRisk"]["rows"])
    for row in rows:
        assert set(row) - {"positionId"} == allowed, (row["kind"], set(row) ^ (allowed | {"positionId"}))
        assert "positionId" in row and "positionId" not in allowed


# ── Notebook widgets phase 2 (Task 8.12): a built widget on a public page ──

_BUILT_CANARIES = ("CANARY-DEF-9f1", "CANARY-SUMMARY-9f1", "CANARY-FILTER-9f1", "CANARY-ACCOUNT-9f1",
                   "CANARY-SCOPE-9f1", "CANARY-FOOT-9f1", "CANARY-DETAIL-9f1", "CANARY-DEFID-9f1")
_BUILT_NEVER = ("def", "defRef", "defId", "defRev", "latestRev", "summary", "scopeLabel", "filter", "accountId",
                "range", "coverage", "sample", "footnotes", "sourceDetail")
_VALUES = {"v1": 12.5, "v2": None, "v3": None, "n1": 7, "n2": None, "n3": None, "s1": "", "s2": "", "s3": "", "n": 7}


def _built(share: Any = True) -> dict:
    node = _widget("builtWidget")
    node["attrs"]["params"] = {
        "asOf": "2026-10-20T14:00:00Z", "source": "broker", "sourceDetail": "CANARY-DETAIL-9f1",
        "title": "Net P&L by setup", "view": "bar", "summary": "CANARY-SUMMARY-9f1",
        "defId": "CANARY-DEFID-9f1", "defRev": 4, "latestRev": 5,
        "def": {"plan_version": 1, "note": "CANARY-DEF-9f1", "filters": {"setup": "CANARY-FILTER-9f1"}},
        "defRef": "CANARY-DEFID-9f1", "scopeLabel": "CANARY-SCOPE-9f1 CANARY-ACCOUNT-9f1",
        "range": {"kind": "last_90d", "from": "2026-07-22"}, "accountId": "CANARY-ACCOUNT-9f1",
        "filter": {"setup": "CANARY-FILTER-9f1"}, "coverage": {"evaluated": 7}, "sample": False,
        "footnotes": ["CANARY-FOOT-9f1"],
        "measures": [{"label": "Net P&L", "unit": "usd", "kind": "sum", "fmt": "money", "id": "CANARY-DEF-9f1"}],
        "value": dict(_VALUES), "compare": dict(_VALUES), "compareLabel": "vs last 90 days",
        "rows": [{"label": "Breakout", "label2": None, **_VALUES, "flagged": False, "tradeId": "CANARY-DEF-9f1"}],
        "series": [{"label": "Mon", "label2": None, **_VALUES, "flagged": False}],
        "points": [{"x": 1.0, "y": 2.0, "d": "2026-10-19", "r": 1.5, "tradeId": "CANARY-DEF-9f1"}],
        "cells": [{"label": "Mon", "v1": 1.0, "n1": 3, "s1": "", "extra": "CANARY-DEF-9f1"}],
        "count": 7, "rangeLabel": "Last 90 days", "capped": False, "notice": None, "truncated": 0,
        "tooLarge": False, "empty": None, "share": share}
    return node


def test_built_vendor_row_and_allowlist_shape():
    assert pnp.MARKET_DATA_VENDORS[("widgetEmbed", "builtWidget")] == "member-optin"
    assert pnp.market_data_verdict("widgetEmbed", "builtWidget") == pnp.NEUTRAL
    assert pnp.EMBED_PARAM_KEYS["builtWidget"] == (
        "asOf", "source", "title", "view", "measures", "value", "compare", "compareLabel", "rows", "series",
        "points", "cells", "count", "rangeLabel", "capped", "notice", "truncated", "tooLarge", "empty", "share",
        "labelKind", "label2Kind")      # the last two (ruling R-25) say which labels are account names
    assert not set(pnp.EMBED_PARAM_KEYS["builtWidget"]) & set(_BUILT_NEVER)


@pytest.mark.parametrize("mode", ["share", "publish", "gallery", "example"])
def test_built_neutral_without_share(mode):
    for share in (None, False):
        node = _built(share)
        if share is None:
            node["attrs"]["params"].pop("share")
        out = reduce(doc(node), mode)
        blob = json.dumps(out)
        assert "widgetEmbed" not in types_in(out), (mode, share)
        assert not any(c in blob for c in _BUILT_CANARIES) and "Net P&L" not in blob, (mode, share)
        if mode != "example":                      # an example note drops an account kind, as it does for private
            assert texts_in(out) == [ACCOUNT_LINE], (mode, share, out)


def test_built_shown_with_share_has_no_def_summary_or_filter_values():
    for mode in ("share", "publish"):
        out = reduce(doc(_built(True)), mode)
        emb = find_embed(out)
        params = emb["attrs"]["params"]
        blob = json.dumps(out)
        assert not any(c in blob for c in _BUILT_CANARIES), (mode, [c for c in _BUILT_CANARIES if c in blob])
        assert set(params) <= set(pnp.EMBED_PARAM_KEYS["builtWidget"])
        assert not set(params) & set(_BUILT_NEVER)
        # control: the result itself is there
        assert params["share"] is True and params["title"] == "Net P&L by setup" and params["count"] == 7
        assert params["value"] == _VALUES and params["compare"] == _VALUES
        assert params["rows"] == [{"label": "Breakout", "label2": None, **_VALUES, "flagged": False}]
        assert params["points"] == [{"x": 1.0, "y": 2.0, "d": "2026-10-19", "r": 1.5}]
        assert params["cells"] == [{"label": "Mon", "v1": 1.0, "n1": 3, "s1": ""}]
        assert params["measures"] == [{"label": "Net P&L", "unit": "usd", "kind": "sum", "fmt": "money"}]


def test_built_footnotes_and_source_detail_never_reach_public_output():
    """Review obligation: the payload carries both keys; neither is in the allowlist, so neither is published."""
    for mode in ("share", "publish"):
        out = reduce(doc(_built(True)), mode)
        params = find_embed(out)["attrs"]["params"]
        assert "footnotes" not in params and "sourceDetail" not in params
        blob = json.dumps(out)
        assert "footnotes" not in blob and "sourceDetail" not in blob
        assert "CANARY-FOOT-9f1" not in blob and "CANARY-DETAIL-9f1" not in blob


def test_built_gallery_always_neutral():
    for share in (None, False, True, "true"):
        node = _built(share)
        out = reduce(doc(node), "gallery")
        assert "widgetEmbed" not in types_in(out), share
        assert not any(c in json.dumps(out) for c in _BUILT_CANARIES), share
        assert texts_in(out) == [ACCOUNT_LINE], (share, out)


@pytest.mark.parametrize("mode", ["share", "publish", "gallery", "example"])
@pytest.mark.parametrize("bad", ["true", "True", 1, [True], {"v": True}])
def test_share_string_true_is_neutral(mode, bad):
    out = reduce(doc(_built(bad)), mode)
    assert "widgetEmbed" not in types_in(out)
    assert not any(c in json.dumps(out) for c in _BUILT_CANARIES)
    if mode != "example":
        assert texts_in(out) == [ACCOUNT_LINE]


# ── fix round 1 (I-2 ruling R-25, M4, M5) ──

def _split_built(**over: Any) -> dict:
    node = _built(True)
    params = node["attrs"]["params"]
    params.update({"labelKind": "account", "label2Kind": "account",
                   "rows": [{"label": "ACCT-CANARY-ALPHA", "label2": "ACCT-CANARY-BETA", **_VALUES, "flagged": False},
                            {"label": "ACCT-CANARY-BETA", "label2": "ACCT-CANARY-ALPHA", **_VALUES,
                             "flagged": False},
                            {"label": "ACCT-CANARY-ALPHA", "label2": None, **_VALUES, "flagged": False}],
                   "series": [{"label": "ACCT-CANARY-BETA", "label2": "ACCT-CANARY-GAMMA", **_VALUES,
                               "flagged": False}],
                   "cells": [{"label": "ACCT-CANARY-GAMMA", "v1": 1.0, "n1": 3, "s1": ""},
                             {"label": "ACCT-CANARY-ALPHA", "v1": 2.0, "n1": 1, "s1": ""}]})
    params.update(over)
    return node


@pytest.mark.parametrize("mode", ["share", "publish"])
def test_r25_account_labels_become_numbered_accounts_stable_across_lists(mode):
    out = reduce(doc(_split_built()), mode)
    blob = json.dumps(out)
    assert "ACCT-CANARY" not in blob, blob
    params = find_embed(out)["attrs"]["params"]
    # label numbering: first appearance across rows, series, cells -> ALPHA=1, BETA=2, GAMMA=3
    assert [r["label"] for r in params["rows"]] == ["Account 1", "Account 2", "Account 1"]
    assert params["series"][0]["label"] == "Account 2"
    assert [c["label"] for c in params["cells"]] == ["Account 3", "Account 1"]
    # label2 has its own numbering by first appearance: BETA=1, ALPHA=2, GAMMA=3
    assert [r["label2"] for r in params["rows"]] == ["Account 1", "Account 2", None]
    assert params["series"][0]["label2"] == "Account 3"
    assert params["labelKind"] == "account" and params["label2Kind"] == "account"


def test_r25_only_the_marked_field_is_relabelled():
    node = _split_built(label2Kind=None)
    node["attrs"]["params"]["rows"][0]["label2"] = "Breakout"
    params = find_embed(reduce(doc(node), "share"))["attrs"]["params"]
    assert params["rows"][0]["label"] == "Account 1" and params["rows"][0]["label2"] == "Breakout"
    # no marker at all (a setup split): labels pass untouched
    node = _split_built(labelKind=None, label2Kind=None)
    params = find_embed(reduce(doc(node), "share"))["attrs"]["params"]
    assert params["rows"][0]["label"] == "ACCT-CANARY-ALPHA"


def test_built_cap_honesty_and_too_large_flags_survive_for_a_shown_widget():
    """The cap's own sentences reach a stranger as they reach the member: truncated, tooLarge, empty and the
    notice are allowlisted."""
    node = _built(True)
    node["attrs"]["params"].update({"truncated": 12, "tooLarge": True, "empty": None,
                                    "notice": "This result is too big to show here."})
    params = find_embed(reduce(doc(node), "share"))["attrs"]["params"]
    assert params["truncated"] == 12 and params["tooLarge"] is True
    assert params["notice"] == "This result is too big to show here."
    for key in ("truncated", "tooLarge", "notice", "empty"):
        assert key in pnp.EMBED_PARAM_KEYS["builtWidget"], key


def test_built_attrs_canary_pins_what_passes_today():
    """M5: what a SHARED builtWidget's attrs let through today. EMBED_KEPT_ATTRS is shared by every kind; this
    pins current behaviour and does not change it."""
    node = _built(True)
    attrs = node["attrs"]
    attrs["frozen"] = {"def": "ATTR-CANARY-FROZEN", "rows": ["ATTR-CANARY-FROZEN-ROW"]}
    attrs["caption"] = "ATTR-CANARY-CAPTION"
    attrs["fallback"] = {"url": "/api/j2/notes/attachments/OTHER/N/inline/x.png", "w": 9, "h": 9}
    attrs["searchText"] = "ATTR-CANARY-SEARCH"
    attrs["tradeRef"] = "ATTR-CANARY-TRADEREF"
    out = reduce(doc(node), "share")
    kept = find_embed(out)["attrs"]
    blob = json.dumps(out)
    assert set(kept) <= set(pnp.EMBED_KEPT_ATTRS) | {"params"}
    for dropped in ("ATTR-CANARY-SEARCH", "ATTR-CANARY-TRADEREF"):
        assert dropped not in blob, dropped
    assert kept["caption"] == "ATTR-CANARY-CAPTION"                 # control: kept attrs do pass
    assert kept["fallback"] is None                                 # another note's image never survives
    # CONCERN (reported, not changed): `frozen` is in the shared EMBED_KEPT_ATTRS and is copied whole.
    assert kept.get("frozen") == attrs["frozen"], kept.get("frozen")
