"""Plan F Task 4: media repair and the shared hotlink fetch.

`media.missing_notices` turns a picture or file an earlier import lost into the visible
`missing_from_import` marker; `media.hotlinks` / `media.replace_src` find and swap still-hotlinked
images; `media.lost_file_link_notices` places the same marker beside a relative link to a file that
never came over (Task 3's `relative_file_unresolved`, counted as a lost link); and
`hotlink_fetch.fetch_and_store` is the one download/normalize/store core the member door and the
repair share. No network: the client is a mock transport, and DNS is stubbed.
"""
from __future__ import annotations

import asyncio
import copy
import io
import json
from pathlib import Path

import httpx
import pytest
from PIL import Image

from api.services import auth_db
from api.services.journal_two import hotlink_fetch, import_notice, import_repair, media_policy
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.import_repair import links, media
from api.services.journal_two.note_connectors.convert import REF_PREFIX

HOT = "http://cdn.example.com/a.png"


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (8, 6), (200, 30, 30)).save(buf, "PNG")
    return buf.getvalue()


PNG = _png()


def _doc(*blocks):
    return {"type": "doc", "content": list(blocks)}


def _para(*inline):
    return {"type": "paragraph", "content": list(inline)}


def _t(text, *marks):
    node = {"type": "text", "text": text}
    if marks:
        node["marks"] = [dict(m) for m in marks]
    return node


def _link(href):
    return {"type": "link", "attrs": {"href": href}}


def _img(**attrs):
    return {"type": "image", "attrs": attrs}


def _notice(name):
    return import_notice.notice_node("missing_from_import", name=name, source_url=None, ref=None, attempts=0)


# ── missing_notices ───────────────────────────────────────────────────────────

def test_missing_notices_replace_stranded_refs_and_empty_images():
    doc = _doc(
        _img(src=REF_PREFIX + "imgs/a.png", alt="Chart", title="t"),
        {"type": "attachmentChip", "attrs": {"href": REF_PREFIX + "files/report.pdf", "name": "Q3 report"}},
        {"type": "bulletList", "content": [{"type": "listItem", "content": [
            _para(_t("item")), _img(src=REF_PREFIX + "deep/path/b%20c.png")]}]},
        _img(src="   ", title="Empty"),
        _img(),
    )
    before = copy.deepcopy(doc)
    out, names = media.missing_notices(doc)
    assert doc == before  # never mutates its input
    assert out == _doc(
        _notice("Chart"),
        _notice("Q3 report"),
        {"type": "bulletList", "content": [{"type": "listItem", "content": [
            _para(_t("item")), _notice("b c.png")]}]},
        _notice("Empty"),
        _notice(None),
    )
    assert names == ["Chart", "Q3 report", "b c.png", "Empty", import_notice.NAME_FALLBACK]
    # final markers: nothing left for the engine to retry
    assert import_notice.media_pending_state(out) == import_notice.MEDIA_PENDING_NONE
    assert import_notice.marker_text("missing_from_import", "Chart").startswith("Chart didn't come over")


def test_missing_notices_leave_a_resolved_image_alone():
    doc = _doc(
        _img(src="/api/j2/notes/attachments/u1/n1/inline/x.png", alt="ok"),
        _img(src="https://cdn.example.com/hot.png"),
        {"type": "attachmentChip", "attrs": {"href": "/api/j2/notes/attachments/u1/n1/file/r.pdf", "name": "r.pdf"}},
        _para(_t("link", _link("import-link://notion:abc"))),
        _notice("already"),
    )
    out, names = media.missing_notices(doc)
    assert out == doc and names == []


def test_missing_notices_keep_a_pending_note_link_beside_a_stranded_ref():
    """M-6: the placeholder rewrite runs with `strip_unresolved_links=False`, so a still-pending
    `import-link://` mark in the same body keeps its href for the live heal."""
    link = _para(_t("target", _link("import-link://notion:abc")))
    doc = _doc(_img(src=REF_PREFIX + "a.png"), link, _img(src=REF_PREFIX + "a.png", alt="again"))
    out, names = media.missing_notices(doc)
    assert out == _doc(_notice("a.png"), link, _notice("a.png"))
    assert names == ["a.png", "a.png"]  # a repeated ref keeps its first name
    assert out["content"][0] is not out["content"][2]  # one copy per use, never aliased


def test_missing_notices_is_a_fixed_point():
    once, _ = media.missing_notices(_doc(_img(src=REF_PREFIX + "a.png"), _img(src="")))
    twice, names = media.missing_notices(once)
    assert twice == once and names == []


def _figure(image, *caption):
    return {"type": "imageFigure", "content": [image, {"type": "imageCaption", "content": list(caption)}]}


def _assert_figures_are_well_formed(node):
    """TipTap's `imageFigure` content rule is `image imageCaption` (imageFigureNode.js)."""
    if isinstance(node, list):
        for child in node:
            _assert_figures_are_well_formed(child)
    elif isinstance(node, dict):
        if node.get("type") == "imageFigure":
            assert [c.get("type") for c in node.get("content") or []] == ["image", "imageCaption"], node
        _assert_figures_are_well_formed(node.get("content"))


def test_a_lost_image_inside_a_figure_dissolves_the_figure_as_the_importer_does():
    """Fix round 1, I-1: a marker cannot sit inside `imageFigure`. As `uctJson.js` does for a
    refused image, the figure becomes the marker and its caption as a paragraph (an empty
    caption leaves nothing)."""
    doc = _doc(
        _figure(_img(src=None, alt="Q3 chart"), _t("Revenue, "), _t("by quarter", {"type": "bold"})),
        _figure(_img(src=REF_PREFIX + "imgs/b.png")),
        _figure(_img(src="/api/j2/notes/attachments/u1/n1/inline/ok.png"), _t("fine")),
    )
    out, names = media.missing_notices(doc)
    assert out == _doc(
        _notice("Q3 chart"), _para(_t("Revenue, "), _t("by quarter", {"type": "bold"})),
        _notice("b.png"),
        doc["content"][2],  # a resolved figure is untouched
    )
    assert names == ["Q3 chart", "b.png"]
    _assert_figures_are_well_formed(out)
    again, more = media.missing_notices(out)
    assert again == out and more == []


def test_missing_notices_use_the_shapes_predicates(monkeypatch):
    """Fix round 1, M-2: what is a stranded ref and what is an empty image are decided ONCE, in
    `shapes`; the detector counts and the repair marks the same nodes."""
    from api.services.journal_two.import_repair import shapes
    node = _img(src="/x.png", alt="picked")
    assert shapes.stranded_ref(_img(src=REF_PREFIX + "a/b.png")) == "a/b.png"
    assert shapes.stranded_ref({"type": "attachmentChip", "attrs": {"href": REF_PREFIX + "f.pdf"}}) == "f.pdf"
    assert shapes.is_empty_image(_img(src="  ")) and shapes.is_empty_image(_img())
    assert not shapes.is_empty_image(node) and shapes.stranded_ref(node) is None
    monkeypatch.setattr(shapes, "is_empty_image", lambda n: n.get("attrs", {}).get("alt") == "picked")
    out, names = media.missing_notices(_doc(node))
    assert out == _doc(_notice("picked")) and names == ["picked"]
    monkeypatch.undo()
    monkeypatch.setattr(shapes, "stranded_ref", lambda n: "r" if n.get("attrs", {}).get("alt") == "picked" else None)
    out, names = media.missing_notices(_doc(node))
    assert names == ["picked"]


# ── hotlinks / replace_src ────────────────────────────────────────────────────

def test_hotlinks_are_distinct_in_document_order_by_the_one_predicate():
    doc = _doc(
        _img(src="https://b.example/2.png"), _img(src="HTTPS://a.example/1.png"),
        _img(src="https://b.example/2.png"), _img(src="https://www.uctintelligence.com/x.png"),
        _img(src="/api/j2/notes/attachments/u/x.png"), _img(src=REF_PREFIX + "r.png"),
        {"type": "attachmentChip", "attrs": {"href": "https://c.example/f.pdf"}},
    )
    assert media.hotlinks(doc) == ["https://b.example/2.png", "HTTPS://a.example/1.png"]


def test_hotlinks_call_the_shapes_predicate(monkeypatch):
    """C11: `shapes.is_hotlink_src` is THE hotlink check; media never restates it."""
    from api.services.journal_two.import_repair import shapes
    monkeypatch.setattr(shapes, "is_hotlink_src", lambda src: src == "/mine.png")
    assert media.hotlinks(_doc(_img(src="/mine.png"), _img(src="https://x.example/a.png"))) == ["/mine.png"]


def test_replace_src_keeps_alt_and_title():
    doc = _doc(_img(src=HOT, alt="Chart", title="Q3", width=200),
               _para(_t("x")), _img(src="https://other.example/b.png", alt="keep"))
    before = copy.deepcopy(doc)
    out = media.replace_src(doc, HOT, "/api/j2/notes/attachments/u1/n1/inline/a.png")
    assert doc == before
    assert out["content"][0] == _img(src="/api/j2/notes/attachments/u1/n1/inline/a.png",
                                     alt="Chart", title="Q3", width=200)
    assert out["content"][1:] == doc["content"][1:]


# ── lost file links (Task 3's relative_file_unresolved) ───────────────────────

@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "j2_attachments")
    media_policy._USAGE_MEMO.clear()
    return tmp_path


def _lost(doc, *, import_key="obsidian:Vault/Here.md", import_source="Obsidian", user="u1"):
    conn = auth_db.get_connection()
    try:
        index = links.build_file_key_index(conn, user)
    finally:
        conn.close()
    return media.lost_file_link_notices(doc, import_key=import_key, import_source=import_source, index=index)


def test_a_lost_file_link_gets_the_marker_beside_it_and_keeps_its_href(db):
    doc = _doc(_para(_t("see "), _t("the deck", _link("files/Deck%20v2.pdf")), _t(" and "),
                     _t("notes", _link("Missing.md"))),
               _para(_t("web", _link("www.example.com"))))
    before = copy.deepcopy(doc)
    out, lost = _lost(doc)
    assert doc == before  # fix round 1, M-6: never mutates its input
    assert lost == 1
    # the link stays exactly as written (Task 3: never made worse); the marker follows its block
    assert out == _doc(doc["content"][0], _notice("Deck v2.pdf"), doc["content"][1])
    again, lost_again = _lost(out)
    assert again == out and lost_again == 1  # counted every run, marked once


def test_lost_file_links_inside_a_list_and_two_in_one_paragraph(db):
    doc = _doc({"type": "bulletList", "content": [{"type": "listItem", "content": [
        _para(_t("a", _link("a.pdf")), _t(" b", _link("sub/b.png")))]}]})
    out, lost = _lost(doc)
    assert lost == 2
    item = out["content"][0]["content"][0]["content"]
    assert item[1:] == [_notice("a.pdf"), _notice("b.png")]


def test_a_lost_file_link_in_a_figure_caption_is_marked_after_the_figure(db):
    """I-1: never inside `imageFigure` (`image imageCaption`): the marker follows the figure."""
    fig = _figure(_img(src="/api/j2/notes/attachments/u1/n1/inline/ok.png"),
                  _t("source: "), _t("data", _link("data/table.csv")))
    doc = _doc(fig, _para(_t("after")))
    out, lost = _lost(doc)
    assert lost == 1
    assert out == _doc(fig, _notice("table.csv"), _para(_t("after")))
    _assert_figures_are_well_formed(out)
    again, _ = _lost(out)
    assert again == out


def test_lost_file_links_are_marked_only_in_file_notes_by_their_source_rule(db):
    """Only a link Task 3's rule calls a non-note file is a lost file: a missing NOTE link, a
    resolvable one, an in-app or web link never gets the marker."""
    _import_note("obsidian:Vault/Other.md")
    doc = _doc(_para(_t("o", _link("Other.md")), _t("m", _link("Missing.md")),
                     _t("w", _link("https://x.example/a.pdf")), _t("j", _link("/journal?note=1"))))
    out, lost = _lost(doc)
    assert out == doc and lost == 0


def _import_note(key, source="Obsidian", user="u1"):
    out = notes_svc.import_confirm(user, {"source": source, "destFolderId": None, "notes": [{
        "importKey": key, "title": key, "bodyJson": _doc(_para(_t("x"))), "tags": [], "folderPath": [],
        "updatedAt": "2026-08-01T00:00:00+00:00"}]})
    return (out["created"] + out["updated"])[0]["id"]


# ── hotlink_fetch.fetch_and_store ─────────────────────────────────────────────

@pytest.fixture
def web(monkeypatch):
    from api.services.journal_two.note_connectors.providers import base as base_module

    async def _public(host):
        return ["142.250.0.1"]

    monkeypatch.setattr(base_module, "_resolve_host", _public)
    state = {"routes": {}, "calls": []}

    async def handler(request: httpx.Request) -> httpx.Response:
        url = f"{request.url.scheme}://{request.headers['host']}{request.url.raw_path.decode()}"
        state["calls"].append(url)
        answer = state["routes"].get(url)
        if answer is None:
            raise AssertionError(f"unexpected request to {url}")
        out = answer()
        return await out if asyncio.iscoroutine(out) else out

    state["factory"] = lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return state


def test_fetch_and_store_stores_our_copy(db, web):
    web["routes"][HOT] = lambda: httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
    released = []
    stored = asyncio.run(hotlink_fetch.fetch_and_store(
        "u1", "n1", HOT, client_factory=web["factory"], after_download=lambda: released.append(1)))
    assert isinstance(stored, media_policy.StoredMedia)
    assert stored.kind == "image" and stored.name == "a.png"
    assert stored.url.startswith("/api/j2/notes/attachments/u1/n1/")
    assert web["calls"] == [HOT] and released == [1]
    on_disk = [p for p in (db / "j2_attachments" / "u1" / "notes" / "n1").rglob("*") if p.is_file()]
    assert [p.read_bytes() for p in on_disk] == [PNG]


def test_fetch_and_store_raises_on_refusal(db, web):
    web["routes"][HOT] = lambda: httpx.Response(404)
    web["routes"]["http://cdn.example.com/page.png"] = lambda: httpx.Response(
        200, content=b"<html>not an image</html>", headers={"content-type": "text/html"})
    from api.services.journal_two.note_connectors import engine as note_engine
    released = []
    # Fix round 1, M-5: the reason the door maps each refusal to (`media_failure_reason`), so a
    # bug inside `store` (a NameError) could never pass as a refusal.
    for url, reason in ((HOT, "fetch_failed"), ("http://cdn.example.com/page.png", "unsupported")):
        with pytest.raises(Exception) as err:
            asyncio.run(hotlink_fetch.fetch_and_store("u1", "n1", url, client_factory=web["factory"],
                                                      after_download=lambda: released.append(1)))
        assert note_engine.media_failure_reason(err.value) == reason, (url, err.value)
    assert released == [1, 1]  # the download hook runs on failure too (the door's slot)
    assert not (db / "j2_attachments" / "u1").exists()  # nothing stored


def test_fetch_and_store_has_one_deadline_for_the_whole_download(db, web):
    async def slow():
        await asyncio.sleep(5)
        return httpx.Response(200, content=PNG, headers={"content-type": "image/png"})

    web["routes"][HOT] = slow
    with pytest.raises(asyncio.TimeoutError):
        asyncio.run(hotlink_fetch.fetch_and_store("u1", "n1", HOT, client_factory=web["factory"],
                                                  deadline_s=0.2))


def test_the_door_and_the_repair_share_one_value_each():
    """C1: the router keeps its names (its tests patch them) and derives each from the one
    module that owns it."""
    from api.routers import journal_two as router
    assert hotlink_fetch.FETCH_TIMEOUT_S == 30.0 and hotlink_fetch.FETCH_DEADLINE_S == 60.0
    assert router._MEDIA_FETCH_TIMEOUT_S == hotlink_fetch.FETCH_TIMEOUT_S
    assert router.MEDIA_FETCH_DEADLINE_S == hotlink_fetch.FETCH_DEADLINE_S
    src = Path(router.__file__).read_text(encoding="utf-8")
    assert "hotlink_fetch.fetch_and_store(" in src
    assert "fetch_content_url(" not in src.split("async def notes_media_fetch_endpoint", 1)[1].split("\n@router", 1)[0]
