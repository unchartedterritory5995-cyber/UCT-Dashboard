"""Notebook follow-ups sweep, batch a (backend-gallery): G1-G6.

Each test fails on the base `91f12716c3` and passes with its fix; the mutation that proves it is named in the
test's docstring and recorded in the sweep ledger's `batch-a-report.md`.
"""
from __future__ import annotations

import json
import sys
import uuid

import pytest

from api.services.journal_two import public_note_payload as pnp
from api.services.journal_two import template_gallery as gallery
from tests._style_library_helpers import _publish as _publish_style, _style, api, conn, lib_on  # noqa: F401
from tests.test_example_note_images import _write, att  # noqa: F401  (fixture)
from tests.test_example_notes import EX, _note, _shared_style, _src, ex_on, ocr  # noqa: F401  (fixtures)
from tests.test_page_layout_share import SWITCHES, TRADE, _save_pref, _set, sharing_on  # noqa: F401
from tests.test_public_note_payload import FACTS, NOTE, OWNER, doc, find, p, t, texts_in


def _gallery_reduce(body: dict, mode: str, report: list | None = None) -> dict:
    return pnp.reduce(body, mode=mode, owner_id=OWNER, note_id=NOTE, attachment_base="", facts=FACTS,
                      note_links={}, report=report)


def _link(href: str) -> dict:
    return {"type": "link", "attrs": {"href": href}}


def _hrefs(out: dict) -> list[str]:
    return [m["attrs"]["href"] for n in find(out, "text") for m in n.get("marks", []) if m.get("type") == "link"]


def _examples(conn) -> int:
    return conn.execute("SELECT COUNT(*) FROM j2_template_gallery WHERE item_type = ?",
                        (gallery.EXAMPLE_ITEM,)).fetchone()[0]


# ── G1: an email in a web link's query string ──────────────────────────────────────────────

@pytest.fixture
def notes(monkeypatch):
    """Every `_Ctx.note(kind, before)` call. Gallery mode keeps no report (only example mode does), so the change
    the reducer records is read at the call itself."""
    seen: list = []
    real = pnp._Ctx.note

    def spy(self, kind, before="", after=""):
        seen.append((kind, str(before or "")))
        return real(self, kind, before, after)
    monkeypatch.setattr(pnp._Ctx, "note", spy)
    return seen


@pytest.mark.parametrize("href", [
    "https://x.com/a?email=me@example.com",
    "https://x.com/a?email=me%40example.com",          # percent-encoded @
    "https://x.com/a?e=me%2540example.com",            # an encoded %40
])
def test_G1_gallery_drops_a_web_link_carrying_an_email_and_keeps_the_words(href, notes):
    """Mutation: delete the `_email_in_href` branch in `_reduce_marks` -> the link survives, no email change."""
    out = _gallery_reduce(doc(p(t("contact", _link(href)))), "gallery")
    assert texts_in(out) == ["contact"]
    assert _hrefs(out) == []
    assert notes == [("email", "me@example.com")]
    assert "example.com" not in json.dumps(out)


def test_G1_CONTROL_share_keeps_it_and_gallery_keeps_a_link_with_no_address(notes):
    href = "https://x.com/a?email=me@example.com"
    assert _hrefs(_gallery_reduce(doc(p(t("contact", _link(href)))), "share")) == [href]
    plain = "https://x.com/@trader/status/1"            # an @ handle is not an email address
    assert _hrefs(_gallery_reduce(doc(p(t("post", _link(plain)))), "gallery")) == [plain]
    assert notes == []


# ── G2: hardening in the example paths ─────────────────────────────────────────────────────

def test_G2_a_unicode_digit_tail_is_skipped_by_the_reducer_not_a_500(monkeypatch):
    """Mutation: `not tail.isdigit()` in `_reduce_example` -> `int("²")` raises ValueError."""
    prefix = gallery.EXAMPLE_IMAGE_PATH.format(item_id="ITEM")
    odd = {"type": "doc", "content": [{"type": "image", "attrs": {"src": f"{prefix}²"}}]}
    monkeypatch.setattr(gallery.public, "reduce", lambda body, **kw: json.loads(json.dumps(odd)))
    body, kept = gallery._reduce_example(odd, user_id="u", note_id="n", images_on=[], brokers=(),
                                         item_id="ITEM", report=None)
    assert kept == []
    assert body["content"][0]["attrs"]["src"] == f"{prefix}²"


def test_G2_a_unicode_digit_tail_is_skipped_by_the_preview_not_a_500(api, conn, ex_on, ocr, monkeypatch):
    """Mutation: `if tail.isdigit()` in `preview_example` -> `int("²")` raises ValueError."""
    nid = _note(conn)
    prefix = gallery.EXAMPLE_IMAGE_PATH.format(item_id=gallery._PREVIEW_ITEM_ID)
    odd = {"type": "doc", "content": [{"type": "image", "attrs": {"src": f"{prefix}²"}},
                                      {"type": "image", "attrs": {"src": f"{prefix}0"}}]}
    monkeypatch.setattr(gallery, "_reduce_example", lambda *a, **kw: (json.loads(json.dumps(odd)), ["/kept.png"]))
    out = gallery.preview_example(conn, "author", nid, [])
    srcs = [n["attrs"]["src"] for n in find(out["bodyJson"], "image")]
    assert srcs == [f"{prefix}²", "/kept.png"]        # control: the ASCII "0" is still rebound


def test_G2_the_example_image_route_refuses_a_trailing_newline():
    """Mutation: `$` in place of `\\Z` in `EXAMPLE_IMAGE_ROUTE` -> `.match` admits one trailing newline."""
    good = "/api/j2/template-gallery/abc123/images/0"
    assert pnp.EXAMPLE_IMAGE_ROUTE.match(good)                    # control
    assert pnp.EXAMPLE_IMAGE_ROUTE.match(good + "\n") is None


def test_G2_publish_rolls_back_even_when_the_undo_raises(api, conn, ex_on, ocr, monkeypatch):
    """Mutation: drop the `try/finally` around `moves.undo()` in `publish_example` -> the connection is left
    inside BEGIN IMMEDIATE."""
    sid = _shared_style(conn)
    nid = _note(conn)

    def boom_bind(*a, **kw):
        assert conn.in_transaction                     # non-vacuity: the failure lands under the write lock
        raise RuntimeError("bind failed")

    def boom_undo(self):
        raise OSError("undo failed")

    monkeypatch.setattr(gallery, "_bind_images", boom_bind)
    monkeypatch.setattr(gallery._DirMoves, "undo", boom_undo)
    with pytest.raises(OSError):
        gallery.publish_example(conn, "author", nid, sid, [], "Plan")
    assert not conn.in_transaction
    assert _examples(conn) == 0


def test_G2_admin_act_rolls_back_even_when_the_undo_raises(api, conn, ex_on, ocr, monkeypatch):
    """Mutation: drop the `try/finally` around `moves.undo()` in `admin_act` -> the reject's UPDATE is left
    uncommitted inside an open transaction."""
    sid = _shared_style(conn)
    nid = _note(conn)
    item = gallery.publish_example(conn, "author", nid, sid, [], "Plan")

    def boom_set_aside(self, path):
        assert conn.in_transaction                     # non-vacuity: the reject's UPDATE has run
        raise gallery.GalleryServerError(gallery.EXAMPLE_MOVE_SENTENCE)

    def boom_undo(self):
        raise OSError("undo failed")

    monkeypatch.setattr(gallery._DirMoves, "set_aside", boom_set_aside)
    monkeypatch.setattr(gallery._DirMoves, "undo", boom_undo)
    with pytest.raises(OSError):
        gallery.admin_act("admin", item["id"], "reject", note="Not an example.",
                          reviewed_updated_at=item["updatedAt"], conn=conn)
    assert not conn.in_transaction
    row = conn.execute("SELECT status FROM j2_template_gallery WHERE id = ?", (item["id"],)).fetchone()
    assert row["status"] == "pending"                  # the reject was rolled back
