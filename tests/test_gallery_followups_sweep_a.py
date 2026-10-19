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


# ── G3: the style's kind is read again under the write lock ────────────────────────────────

def test_G3_a_style_resubmitted_as_another_kind_mid_publish_is_refused(api, conn, ex_on, ocr, monkeypatch):
    """Mutation: delete the recompute of `kind` after the second `_linkable_style` -> the publish succeeds and
    stores the stale `noteKind`."""
    sid = _shared_style(conn)
    nid = _note(conn)
    real = gallery._reduce_example

    def flip_then_reduce(*a, **kw):
        out = real(*a, **kw)
        payload = json.loads(conn.execute("SELECT payload_json FROM j2_template_gallery WHERE id = ?",
                                          (sid,)).fetchone()[0])
        assert payload["kindId"] == "weekend_prep"     # non-vacuity: the kind does move
        payload["kindId"] = "trade_plan"
        conn.execute("UPDATE j2_template_gallery SET payload_json = ? WHERE id = ?", (json.dumps(payload), sid))
        conn.commit()
        return out

    monkeypatch.setattr(gallery, "_reduce_example", flip_then_reduce)
    r = api.post(EX, json={"noteId": nid, "styleItemId": sid, "imagesOn": [], "title": "Plan"})
    assert (r.status_code, r.json()["detail"]) == (400, gallery.EXAMPLE_KIND_SENTENCE)
    assert _examples(conn) == 0


# ── G4: the type of every image before any file ────────────────────────────────────────────

def test_G4_a_missing_png_then_a_gif_answers_the_fixable_type_sentence(api, conn, ex_on, ocr, att):
    """Mutation: check the type inside the per-image loop again -> the missing PNG answers 500 first."""
    sid = _shared_style(conn)
    nid = _note(conn, images=("missing.png", "moving.gif"), write_files=False)
    _write(att, "author", nid, "moving.gif", b"GIF89a")          # the PNG is never written
    on = [_src("author", nid, "missing.png"), _src("author", nid, "moving.gif")]
    r = api.post(EX, json={"noteId": nid, "styleItemId": sid, "imagesOn": on, "title": "Plan"})
    assert (r.status_code, r.json()["detail"]) == (400, gallery.EXAMPLE_IMAGE_TYPE_SENTENCE)
    assert _examples(conn) == 0


def test_G4_CONTROL_a_missing_png_alone_is_still_the_copy_500(api, conn, ex_on, ocr, att):
    sid = _shared_style(conn)
    nid = _note(conn, images=("missing.png",), write_files=False)
    r = api.post(EX, json={"noteId": nid, "styleItemId": sid, "imagesOn": [_src("author", nid, "missing.png")],
                           "title": "Plan"})
    assert (r.status_code, r.json()["detail"]) == (500, gallery.EXAMPLE_COPY_SENTENCE)


# ── G5: two concurrent first publishes ─────────────────────────────────────────────────────

class _TwinBeforeInsert:
    """Stands in for `gallery.uuid`: the first `uuid4()` drawn by `_held_or_replaced_once` (after its lookup found
    no row, just before its INSERT) first writes the twin's row, as a double-click's other request would."""

    def __init__(self, insert_twin):
        self._insert_twin = insert_twin
        self.fired = 0

    def uuid4(self):
        if not self.fired and sys._getframe(1).f_code.co_name == "_held_or_replaced_once":
            self.fired += 1
            self._insert_twin()
        return uuid.uuid4()

    def __getattr__(self, name):
        return getattr(uuid, name)


def _twin(conn, *, key_column: str, key: str, item_type: str) -> str:
    gid = uuid.uuid4().hex
    conn.execute(
        f"INSERT INTO j2_template_gallery (id, user_id, {key_column}, kind, title, description, category,"
        " body_json, status, created_at, updated_at, preview_json, item_type, payload_json, version)"
        " VALUES (?, 'author', ?, 'member', 'Twin', '', 'journal', '{}', 'pending', 'x', 'x', '[]', ?, '{}', 1)",
        (gid, key, item_type))
    conn.commit()
    return gid


def test_G5_a_style_publish_that_loses_the_insert_race_updates_the_twin(conn, lib_on, monkeypatch):
    """Mutation: let the INSERT's `IntegrityError` propagate (no retry) -> the losing publish raises (a 500)."""
    s = _style(conn, "author")
    gallery.author_handle("author", conn)
    twin_ids = []
    fake = _TwinBeforeInsert(lambda: twin_ids.append(
        _twin(conn, key_column="source_style_id", key=s["id"], item_type="style")))
    monkeypatch.setattr(gallery, "uuid", fake)
    item = _publish_style(conn, s["id"], "author", title="Weekend Prep")
    assert fake.fired == 1                             # non-vacuity: the twin really was written first
    assert item["id"] == twin_ids[0]
    rows = conn.execute("SELECT id, title FROM j2_template_gallery WHERE source_style_id = ?", (s["id"],)).fetchall()
    assert [(r["id"], r["title"]) for r in rows] == [(twin_ids[0], "Weekend Prep")]
    assert not conn.in_transaction


def test_G5_a_layout_publish_that_loses_the_insert_race_updates_the_twin(conn, sharing_on, monkeypatch):
    """Mutation: as above, for `publish_layout`."""
    _save_pref(conn, "author", {"version": 1, "trade": TRADE})
    gallery.author_handle("author", conn)
    twin_ids = []
    fake = _TwinBeforeInsert(lambda: twin_ids.append(
        _twin(conn, key_column="source_page", key="trade", item_type="page_layout")))
    monkeypatch.setattr(gallery, "uuid", fake)
    item = gallery.publish_layout("author", "trade", title="Prop trade page", description="", category="journal",
                                  trading_style="prop", conn=conn)
    assert fake.fired == 1
    assert item["id"] == twin_ids[0]
    rows = conn.execute("SELECT id, title FROM j2_template_gallery WHERE source_page = 'trade'").fetchall()
    assert [(r["id"], r["title"]) for r in rows] == [(twin_ids[0], "Prop trade page")]
