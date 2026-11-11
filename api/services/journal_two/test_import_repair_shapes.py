"""Plan F Task 1: shape detectors for already-imported notes.

One broken fixture per shape that counts exactly 1, and its clean twin that counts 0. The
clean twins are the near-misses a careless detector would flag (a stranded-looking ref in an
importNotice attr, an in-app href, our own image host, ticker text, a URL in a code mark...).
"""
from __future__ import annotations

import json

import pytest

from api.services.journal_two import import_repair
from api.services.journal_two.import_repair import shapes
from api.services.journal_two.note_connectors.convert import LINK_PREFIX, REF_PREFIX


def _doc(*blocks):
    return {"type": "doc", "content": list(blocks)}


def _p(*inline):
    return {"type": "paragraph", "content": list(inline)}


def _t(text, *marks):
    node = {"type": "text", "text": text}
    if marks:
        node["marks"] = list(marks)
    return node


def _link(href):
    return {"type": "link", "attrs": {"href": href}}


def _img(**attrs):
    return {"type": "image", "attrs": attrs}


PAIRS = [
    ("dead_import_link",
     _doc(_p(_t("Target", _link(LINK_PREFIX + "notion:abc")))),
     _doc(_p(_t("Target", _link("/journal?j2tab=notebook&note=abc"))))),
    ("obsidian_pct_key",
     _doc(_p(_t("Target", _link(LINK_PREFIX + "obsidian:vault/Target%20Note.md")))),
     _doc(_p(_t("Target", _link(LINK_PREFIX + "obsidian:vault/Target Note.md"))))),
    ("relative_note_href",
     _doc(_p(_t("Target", _link("Notes/Target Note.md")))),
     _doc(_p(_t("Heading", _link("#heading"))))),
    ("bare_url",
     _doc(_p(_t("read https://example.com/post today"))),
     _doc(_p(_t("NVDA.US and BRK.B")),
          _p(_t("https://x.com", {"type": "code"})),
          _p(_t("https://example.com/post", _link("https://example.com/post"))))),
    ("hotlinked_image",
     _doc(_img(src="https://cdn.example.com/a.png")),
     _doc(_img(src="https://uctintelligence.com/api/j2/notes/attachments/u/x.png"))),
    ("stranded_media_ref",
     _doc(_img(src=REF_PREFIX + "a.png")),
     _doc({"type": "importNotice", "attrs": {"reason": "fetch_failed", "name": "a.png",
                                             "sourceUrl": None, "ref": REF_PREFIX + "a.png",
                                             "attempts": 1}})),
    # The attachmentChip half of the same shape: a chip whose href is still a ref, and a chip
    # whose href was resolved to stored media.
    ("stranded_media_ref",
     _doc({"type": "attachmentChip", "attrs": {"href": REF_PREFIX + "f.pdf", "name": "f.pdf"}}),
     _doc({"type": "attachmentChip", "attrs": {"href": "/api/j2/notes/attachments/u/f.pdf",
                                               "name": "f.pdf"}})),
    ("empty_image",
     _doc(_img(src="  ")),
     _doc(_img(src="/api/j2/notes/attachments/u/x.png"))),
    ("obsidian_literal_embed",
     _doc(_p(_t("![[Pasted image 20240101.png]]"))),
     _doc(_p(_t("see image.png for details")))),
]


@pytest.mark.parametrize("shape,broken,clean", PAIRS, ids=[p[0] for p in PAIRS])
def test_each_shape_counts_its_broken_fixture_and_never_its_clean_twin(shape, broken, clean):
    assert shapes.detect_shapes(broken).get(shape) == 1
    assert shape not in shapes.detect_shapes(clean)


def test_every_detectable_shape_has_a_pair():
    detectable = set(shapes.WRITABLE_SHAPES) | set(shapes.COUNT_ONLY_SHAPES)
    assert {p[0] for p in PAIRS} == detectable - {"orphan_media"}


def test_constants_are_exact():
    assert shapes.WRITABLE_SHAPES == ("dead_import_link", "obsidian_pct_key", "relative_note_href",
                                      "bare_url", "hotlinked_image", "stranded_media_ref",
                                      "empty_image")
    assert shapes.COUNT_ONLY_SHAPES == ("obsidian_literal_embed", "orphan_media")
    assert shapes.LOSS_SHAPES == ("stranded_media_ref", "empty_image", "orphan_media")
    assert import_repair.NOTE_CLASSES == ("file", "connector_live", "connector_relist",
                                          "connector_orphaned")


def test_zero_counts_are_omitted_and_counts_add_up():
    assert shapes.detect_shapes(_doc(_p(_t("plain")))) == {}
    doc = _doc(_img(src="http://a.example/1.png"), _img(src="https://b.example/2.png"),
               _img(), _img(src=7), {"type": "attachmentChip", "attrs": {"href": REF_PREFIX + "f.pdf"}})
    assert shapes.detect_shapes(doc) == {"hotlinked_image": 2, "empty_image": 2, "stranded_media_ref": 1}


def test_uppercase_scheme_image_is_a_hotlink():
    assert shapes.detect_shapes(_doc(_img(src="HTTPS://cdn.example.com/a.png"))) == {"hotlinked_image": 1}


def test_bare_filename_alone_in_a_paragraph_is_a_literal_embed():
    assert shapes.detect_shapes(_doc(_p(_t("chart.PNG")))) == {"obsidian_literal_embed": 1}
    # A linked file name is a link, not a stranded embed; its dead link is still counted.
    linked = _doc(_p(_t("chart.png", _link(LINK_PREFIX + "obsidian:v/chart.png"))))
    assert shapes.detect_shapes(linked) == {"dead_import_link": 1}


def test_detect_shapes_never_mutates_the_doc():
    doc = _doc(_p(_t("read https://example.com/post today")))
    before = json.dumps(doc, sort_keys=True)
    shapes.detect_shapes(doc)
    assert json.dumps(doc, sort_keys=True) == before


@pytest.mark.parametrize("href,expected", [
    ("Notes/Target.md", True), ("../Target.md", True), ("Target", True),
    ("https://x.com", False), ("mailto:a@b.c", False), ("obsidian://open?vault=v", False),
    ("#h", False), ("?q=1", False), ("//cdn.example/x", False),
    ("/journal?j2tab=notebook&note=abc", False), ("/terminal?cmd=NVDA", False),
    ("/api/j2/notes/attachments/u/x.png", False), (LINK_PREFIX + "k", False), (REF_PREFIX + "r", False),
    ("", False), ("   ", False), (None, False), (5, False),
])
def test_is_relative_href(href, expected):
    assert shapes.is_relative_href(href) is expected


@pytest.mark.parametrize("src,expected", [
    ("https://cdn.example.com/a.png", True), ("http://cdn.example.com/a.png", True),
    ("https://uctintelligence.com/x.png", False), ("https://www.uctintelligence.com/x.png", False),
    ("https://UCTIntelligence.com/x.png", False), ("https://uctintelligence.com.evil.io/x.png", True),
    # The scheme is case-insensitive, as browsers treat it.
    ("HTTPS://cdn.example.com/a.png", True), ("Http://cdn.example.com/a.png", True),
    ("HTTPS://UCTINTELLIGENCE.COM/x.png", False), ("hTtPs://www.UctIntelligence.com/x.png", False),
    ("HTTPS://uctintelligence.com.evil.io/x.png", True),
    ("/api/j2/notes/attachments/u/x.png", False), ("data:image/png;base64,AA", False),
    (None, False), (3, False),
])
def test_is_hotlink_src(src, expected):
    assert shapes.is_hotlink_src(src) is expected


USER, NOTE = "user-1", "note-1"


@pytest.fixture
def attachment_root(tmp_path, monkeypatch):
    from api.services.journal_two import notes as notes_svc
    root = tmp_path / "j2_attachments"
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", root)
    return root


def test_orphan_media_counts_only_unreferenced_files(attachment_root):
    base = attachment_root / USER / "notes" / NOTE
    (base / "inline").mkdir(parents=True)
    (base / "file" / "sub").mkdir(parents=True)
    (base / "inline" / "kept1234.png").write_bytes(b"x")
    (base / "file" / "sub" / "lost5678.pdf").write_bytes(b"y")
    body_text = json.dumps(_doc(_img(src=f"/api/j2/notes/attachments/{USER}/notes/{NOTE}/inline/kept1234.png")))
    assert shapes.orphan_media_count(USER, NOTE, body_text) == 1


def test_orphan_media_is_zero_when_the_note_has_no_media_dir(attachment_root):
    assert shapes.orphan_media_count(USER, NOTE, "{}") == 0
