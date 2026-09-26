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
    # marks
    "bold": lambda: doc(p(t("b", {"type": "bold"}))),
    "code": lambda: doc(p(t("c", {"type": "code"}))),
    "italic": lambda: doc(p(t("i", {"type": "italic"}))),
    "strike": lambda: doc(p(t("s", {"type": "strike"}))),
    "underline": lambda: doc(p(t("u", {"type": "underline"}))),
    "textStyle": lambda: doc(p(t("ts", {"type": "textStyle", "attrs": {"color": "#fff"}}))),
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
    assert set(pnp.NODE_POLICY[type_]) == {"share", "publish"}, type_
    assert type_ in EXPECTED and type_ in FIXTURES, (
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
    if type_ in ("widgetEmbed", "financialFact", "documentExcerpt") and not present:
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


@pytest.mark.parametrize("mode", ["share", "publish"])
def test_a_shown_widget_keeps_exactly_what_the_archived_render_reads(mode):
    out = reduce(doc(_widget("fundamentals")), mode)
    w = find(out, "widgetEmbed")[0]["attrs"]
    assert set(w) <= set(pnp.EMBED_KEPT_ATTRS) | {"params"}
    assert w["params"] == {"symbol": "AAPL", "view": "quarterly"}
    assert w["fallback"] == {"url": f"{BASE}inline/w.png", "w": 900, "h": 500}
    assert w["caption"] == "the member's caption"
    for gone in ("tradeRef", "searchText", "annotations", "embedId"):
        assert gone not in w, gone


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
