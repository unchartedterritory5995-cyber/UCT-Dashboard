"""Notebook follow-ups sweep, batch a (backend-gallery): G1-G6.

Each test fails on the base `dbdf76d76d` and passes with its fix; the mutation that proves it is named in the
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
