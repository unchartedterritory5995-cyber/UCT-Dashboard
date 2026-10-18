"""P3b Task 4: an example note's IMAGE COPIES and their lifecycle.

The service is `api/services/journal_two/template_gallery.py` (`publish_example` copies, `example_image_path`
serves, `unpublish` / `admin_act` move and delete); the route is
`GET /api/j2/template-gallery/{item_id}/images/{n}` in `api/routers/notebook_template_gallery.py`; the account
purge is `api/services/journal_two/account_purge.py`.

Ruling P3b-R14: approved copies live at `<attachment_root>/gallery/<item_id>/<n>.<ext>`; a held revision's at
`<item_id>/v<version>/<n>.<ext>`; the stored src stays `/images/{n}`. `?rev=pending` serves the held copy, to the
author or an admin only. Approval moves the held copies into place and deletes the old; rejection deletes the held.

⛔ Every test runs on a TMP attachment root (`J2_ATTACHMENT_ROOT`), never C:\\data.
"""
from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path

import pytest

from api.services.journal_two import public_note_payload as public
from api.services.journal_two import template_gallery as gallery
from tests._style_library_helpers import api, conn, lib_on  # noqa: F401  (fixtures)
from tests.test_example_notes import _as, _note, _row, _shared_style, _src, ex_on, ocr  # noqa: F401

URL = "/api/j2/template-gallery"
EX = f"{URL}/examples"
COPY_SENTENCE = "Couldn't copy an image. Nothing was shared."
COUNT_SENTENCE = "An example can show up to 6 images."
TYPE_SENTENCE = "Only PNG, JPEG or WebP images can be shared."


@pytest.fixture
def att(monkeypatch, tmp_path):
    """A throwaway attachment root. `attachment_root()` reads the variable per call, so the note images written
    here are the ones the resolver finds, and the gallery copies land under it too."""
    root = tmp_path / "attachments"
    root.mkdir()
    monkeypatch.setenv("J2_ATTACHMENT_ROOT", str(root))
    return root


def _atomic_write(path: Path, data: bytes) -> None:
    """Temp file, then `os.replace` -- never an open-for-write on the final path."""
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def _write(att: Path, user: str, nid: str, name: str, data: bytes) -> None:
    d = att / user / "notes" / nid / "inline"
    d.mkdir(parents=True, exist_ok=True)
    _atomic_write(d / name, data)


def _note_with_files(conn, att, user="author", files=(), **kw):
    """A live note holding one image per (name, bytes) in `files`, each written to the note's own attachment folder."""
    nid = _note(conn, user, images=tuple(name for name, _ in files), **kw)
    for name, data in files:
        _write(att, user, nid, name, data)
    return nid


def _publish(api, nid, sid, on, title="Plan"):
    return api.post(EX, json={"noteId": nid, "styleItemId": sid, "imagesOn": on, "title": title})


def _gallery_root(att: Path) -> Path:
    return att / "gallery"


def _files(d: Path) -> dict[str, bytes]:
    """Every file under `d`, by its path relative to `d` (forward slashes)."""
    if not d.is_dir():
        return {}
    return {p.relative_to(d).as_posix(): p.read_bytes() for p in sorted(d.rglob("*")) if p.is_file()}


def _approve(conn, gid):
    gallery.admin_act("admin", gid, "approve", reviewed_updated_at=_row(conn, gid)["updated_at"], conn=conn)


# ── 1. the copies ───────────────────────────────────────────────────────────────────────────

def test_two_switched_on_images_are_copied_and_a_switched_off_one_is_not(api, conn, ex_on, ocr, att):
    sid = _shared_style(conn)
    nid = _note_with_files(conn, att, files=(("a.png", b"png-a"), ("b.jpg", b"jpg-b"), ("c.webp", b"webp-c")))
    on = [_src("author", nid, "a.png"), _src("author", nid, "c.webp")]
    r = _publish(api, nid, sid, on)
    assert r.status_code == 200, r.text
    gid = r.json()["template"]["id"]
    # the copies are numbered by the stored src's n, in body order, with the stored extension
    assert _files(_gallery_root(att) / gid) == {"0.png": b"png-a", "1.webp": b"webp-c"}
    body = json.loads(_row(conn, gid)["body_json"])
    srcs = [n["attrs"]["src"] for n in body["content"] if n.get("type") == "image"]
    assert srcs == [f"{URL}/{gid}/images/0", f"{URL}/{gid}/images/1"]
    # the switched-off jpg was never copied, and nothing else is left in the gallery root (no staging)
    assert sorted(p.name for p in _gallery_root(att).iterdir()) == [gid]
    assert b"jpg-b" not in b"".join(_files(_gallery_root(att)).values())


def test_a_jpeg_is_stored_with_the_jpg_extension_and_nothing_switched_on_copies_nothing(api, conn, ex_on, ocr, att):
    sid = _shared_style(conn)
    nid = _note_with_files(conn, att, files=(("a.jpeg", b"jpeg-a"),))
    gid = _publish(api, nid, sid, [_src("author", nid, "a.jpeg")]).json()["template"]["id"]
    assert _files(_gallery_root(att) / gid) == {"0.jpg": b"jpeg-a"}
    other = _note_with_files(conn, att, files=(("z.png", b"z"),))
    gid2 = _publish(api, other, sid, []).json()["template"]["id"]
    assert not (_gallery_root(att) / gid2).exists()


# ── 2. the limits (R-P3b-7) ─────────────────────────────────────────────────────────────────

def test_a_seventh_image_is_refused_and_nothing_is_written(api, conn, ex_on, ocr, att):
    sid = _shared_style(conn)
    files = tuple((f"i{k}.png", f"img{k}".encode()) for k in range(7))
    nid = _note_with_files(conn, att, files=files)
    before = conn.execute("SELECT COUNT(*) FROM j2_template_gallery").fetchone()[0]
    r = _publish(api, nid, sid, [_src("author", nid, name) for name, _ in files])
    assert (r.status_code, r.json()["detail"]) == (400, COUNT_SENTENCE)
    assert conn.execute("SELECT COUNT(*) FROM j2_template_gallery").fetchone()[0] == before
    assert _files(_gallery_root(att)) == {}
    # control: six is allowed
    six = _publish(api, nid, sid, [_src("author", nid, name) for name, _ in files[:6]])
    assert six.status_code == 200, six.text
    assert len(_files(_gallery_root(att) / six.json()["template"]["id"])) == 6


def test_a_gif_is_refused_and_nothing_is_written(api, conn, ex_on, ocr, att):
    sid = _shared_style(conn)
    nid = _note_with_files(conn, att, files=(("a.png", b"png"), ("moving.gif", b"GIF89a")))
    r = _publish(api, nid, sid, [_src("author", nid, "a.png"), _src("author", nid, "moving.gif")])
    assert (r.status_code, r.json()["detail"]) == (400, TYPE_SENTENCE)
    assert conn.execute("SELECT COUNT(*) FROM j2_template_gallery WHERE item_type = 'example_note'").fetchone()[0] == 0
    assert _files(_gallery_root(att)) == {}


def test_an_image_over_2_mb_is_refused(api, conn, ex_on, ocr, att):
    sid = _shared_style(conn)
    nid = _note_with_files(conn, att, files=(("big.png", b"x" * (2 * 1024 * 1024 + 1)),))
    r = _publish(api, nid, sid, [_src("author", nid, "big.png")])
    assert (r.status_code, r.json()["detail"]) == (400, gallery.EXAMPLE_IMAGE_SIZE_SENTENCE)
    assert _files(_gallery_root(att)) == {}
    _write(att, "author", nid, "big.png", b"x" * (2 * 1024 * 1024))      # control: exactly 2 MB is allowed
    assert _publish(api, nid, sid, [_src("author", nid, "big.png")]).status_code == 200


# ── 3 and 4. who the route serves ───────────────────────────────────────────────────────────

def test_pending_example_images_are_not_public(api, conn, ex_on, ocr, att):
    sid = _shared_style(conn)
    nid = _note_with_files(conn, att, files=(("a.png", b"pending-bytes"),))
    gid = _publish(api, nid, sid, [_src("author", nid, "a.png")]).json()["template"]["id"]
    assert _row(conn, gid)["status"] == "pending"                                       # non-vacuity
    _as(api, "stranger")
    r = api.get(f"{URL}/{gid}/images/0")
    assert (r.status_code, r.json()["detail"]) == (404, public.NOT_FOUND_DETAIL)
    for k, v in public.PUBLIC_HEADERS.items():                                          # the one 404, with its headers
        assert r.headers.get(k) == v
    _as(api, "author")
    r = api.get(f"{URL}/{gid}/images/0")
    assert (r.status_code, r.content) == (200, b"pending-bytes")
    _as(api, "admin", role="admin")
    r = api.get(f"{URL}/{gid}/images/0")
    assert (r.status_code, r.content) == (200, b"pending-bytes")


def test_an_approved_example_image_serves_to_any_paid_member_with_every_public_header(api, conn, ex_on, ocr, att):
    sid = _shared_style(conn)
    nid = _note_with_files(conn, att, files=(("a.png", b"listed-bytes"), ("b.webp", b"webp")))
    gid = _publish(api, nid, sid, [_src("author", nid, "a.png"), _src("author", nid, "b.webp")]).json()["template"]["id"]
    _approve(conn, gid)
    _as(api, "stranger")
    r = api.get(f"{URL}/{gid}/images/0")
    assert (r.status_code, r.content) == (200, b"listed-bytes")
    for k, v in public.PUBLIC_IMAGE_HEADERS.items():
        assert r.headers.get(k) == v, k
    assert r.headers["content-type"].startswith("image/png")
    assert api.get(f"{URL}/{gid}/images/1").headers["content-type"].startswith("image/webp")
    # misses: a number with no copy, a malformed number, an unknown item, a non-example item -- the one 404
    for path in (f"{URL}/{gid}/images/2", f"{URL}/{gid}/images/x", f"{URL}/{gid}/images/%2E%2E",
                 f"{URL}/nope/images/0", f"{URL}/{sid}/images/0"):
        assert api.get(path).status_code == 404, path
    # a free member is refused at the plan check
    _as(api, "freebie", plan="free")
    assert api.get(f"{URL}/{gid}/images/0").status_code == 402
    # hidden: gone for a stranger, still the author's
    gallery.admin_act("admin", gid, "hide", conn=conn)
    _as(api, "stranger")
    assert api.get(f"{URL}/{gid}/images/0").status_code == 404
    _as(api, "author")
    assert api.get(f"{URL}/{gid}/images/0").status_code == 200


def test_the_image_route_is_absent_while_the_example_switch_is_off(api, conn, ex_on, ocr, att, monkeypatch):
    sid = _shared_style(conn)
    nid = _note_with_files(conn, att, files=(("a.png", b"x"),))
    gid = _publish(api, nid, sid, [_src("author", nid, "a.png")]).json()["template"]["id"]
    _approve(conn, gid)
    assert api.get(f"{URL}/{gid}/images/0").status_code == 200                           # control
    monkeypatch.setenv("NOTEBOOK_EXAMPLE_NOTES_ENABLED", "0")
    assert api.get(f"{URL}/{gid}/images/0").status_code == 404
    assert (_gallery_root(att) / gid / "0.png").is_file()                                 # stored, never deleted


# ── 5. withdraw ─────────────────────────────────────────────────────────────────────────────

def test_withdrawing_the_style_withdraws_its_examples_and_files(api, conn, ex_on, ocr, att):
    sid = _shared_style(conn, approve=True)
    keep_sid = _shared_style(conn, approve=True)
    nid = _note_with_files(conn, att, files=(("a.png", b"a"),))
    gid = _publish(api, nid, sid, [_src("author", nid, "a.png")]).json()["template"]["id"]
    _approve(conn, gid)
    kept = _publish(api, nid, keep_sid, [_src("author", nid, "a.png")]).json()["template"]["id"]
    _as(api, "stranger")
    gallery.report("stranger", gid, reason="spam", conn=conn)
    assert api.get(f"{URL}/{gid}/images/0").status_code == 200                           # non-vacuity
    _as(api, "author")
    assert api.delete(f"{URL}/{sid}").status_code == 200
    assert _row(conn, sid) is None
    assert _row(conn, gid) is None                                                        # the example went too
    assert conn.execute("SELECT COUNT(*) FROM j2_template_gallery_reports WHERE gallery_id = ?",
                        (gid,)).fetchone()[0] == 0
    assert not (_gallery_root(att) / gid).exists()
    _as(api, "stranger")
    assert api.get(f"{URL}/{gid}/images/0").status_code == 404
    # control: the example of the OTHER style, and its files, are untouched
    assert _row(conn, kept) is not None
    assert _files(_gallery_root(att) / kept) == {"0.png": b"a"}


def test_withdrawing_an_example_deletes_its_directory(api, conn, ex_on, ocr, att):
    sid = _shared_style(conn, approve=True)
    nid = _note_with_files(conn, att, files=(("a.png", b"a"),))
    gid = _publish(api, nid, sid, [_src("author", nid, "a.png")]).json()["template"]["id"]
    _approve(conn, gid)
    _write(att, "author", nid, "a.png", b"held")
    _publish(api, nid, sid, [_src("author", nid, "a.png")])                                # a held revision too
    assert (_gallery_root(att) / gid / "v2" / "0.png").is_file()                          # non-vacuity
    assert api.delete(f"{URL}/{gid}").status_code == 200
    assert not (_gallery_root(att) / gid).exists()
    assert _row(conn, sid) is not None                                                    # the style stays


def test_a_member_cannot_withdraw_someone_elses_example_or_its_files(api, conn, ex_on, ocr, att):
    sid = _shared_style(conn)
    nid = _note_with_files(conn, att, files=(("a.png", b"a"),))
    gid = _publish(api, nid, sid, [_src("author", nid, "a.png")]).json()["template"]["id"]
    _as(api, "stranger")
    assert api.delete(f"{URL}/{gid}").status_code == 404
    assert _files(_gallery_root(att) / gid) == {"0.png": b"a"}


# ── 6. account purge ────────────────────────────────────────────────────────────────────────

def test_purge_removes_rows_and_files_for_that_member_only(api, conn, ex_on, ocr, att):
    from api.services.journal_two import account_purge as ap
    mine = _shared_style(conn, "author")
    theirs = _shared_style(conn, "other")
    nid = _note_with_files(conn, att, "author", files=(("a.png", b"mine"),))
    onid = _note_with_files(conn, att, "other", files=(("b.png", b"theirs"),))
    gid = _publish(api, nid, mine, [_src("author", nid, "a.png")]).json()["template"]["id"]
    _as(api, "other")
    ogid = _publish(api, onid, theirs, [_src("other", onid, "b.png")]).json()["template"]["id"]
    assert (_gallery_root(att) / gid).is_dir() and (_gallery_root(att) / ogid).is_dir()  # non-vacuity
    report = ap.purge_user_data("author", conn)
    assert report["ok"] is True, report
    assert report["example_image_dirs_removed"] == 1
    assert _row(conn, gid) is None and not (_gallery_root(att) / gid).exists()
    assert not (att / "author").exists()
    # the other member's example, and its copies, are untouched
    assert _row(conn, ogid) is not None
    assert _files(_gallery_root(att) / ogid) == {"0.png": b"theirs"}


# ── 7. all or nothing ───────────────────────────────────────────────────────────────────────

def test_a_copy_failure_leaves_no_directory_behind(api, conn, ex_on, ocr, att, monkeypatch):
    sid = _shared_style(conn)
    nid = _note_with_files(conn, att, files=(("a.png", b"a"), ("b.png", b"b")))
    on = [_src("author", nid, "a.png"), _src("author", nid, "b.png")]
    real, calls = gallery._copy_image, []

    def flaky(src, dest):
        calls.append(dest)
        if len(calls) == 2:
            raise OSError("disk full")
        return real(src, dest)
    monkeypatch.setattr(gallery, "_copy_image", flaky)
    from api.services import daily_counters
    from api.services.journal_two.calendar import et_today
    charged = daily_counters.value(et_today(), "notebook_gallery_publish", "author")
    r = _publish(api, nid, sid, on)
    assert (r.status_code, r.json()["detail"]) == (500, COPY_SENTENCE)
    assert len(calls) == 2                                                                # the first copy was made
    assert conn.execute("SELECT COUNT(*) FROM j2_template_gallery WHERE item_type = 'example_note'").fetchone()[0] == 0
    # no copy, no staging directory, nothing at all under the gallery root
    assert not _gallery_root(att).exists() or list(_gallery_root(att).iterdir()) == []
    # the day's charge was given back (the shared `_charged_publish` refund path)
    assert daily_counters.value(et_today(), "notebook_gallery_publish", "author") == charged


def test_a_missing_source_file_is_a_failed_copy(api, conn, ex_on, ocr, att):
    sid = _shared_style(conn)
    nid = _note(conn, images=("gone.png",), write_files=False)                            # no file on disk
    r = _publish(api, nid, sid, [_src("author", nid, "gone.png")])
    assert (r.status_code, r.json()["detail"]) == (500, COPY_SENTENCE)
    assert conn.execute("SELECT COUNT(*) FROM j2_template_gallery WHERE item_type = 'example_note'").fetchone()[0] == 0


def test_a_failed_copy_of_a_held_revision_leaves_the_listed_example_as_it_was(api, conn, ex_on, ocr, att, monkeypatch):
    sid = _shared_style(conn, approve=True)
    nid = _note_with_files(conn, att, files=(("a.png", b"listed"),))
    gid = _publish(api, nid, sid, [_src("author", nid, "a.png")]).json()["template"]["id"]
    _approve(conn, gid)
    before = dict(_row(conn, gid))

    def broken(src, dest):
        raise OSError("disk full")
    monkeypatch.setattr(gallery, "_copy_image", broken)
    r = _publish(api, nid, sid, [_src("author", nid, "a.png")], title="Again")
    assert (r.status_code, r.json()["detail"]) == (500, COPY_SENTENCE)
    assert dict(_row(conn, gid)) == before                                                # no held revision written
    assert _files(_gallery_root(att)) == {f"{gid}/0.png": b"listed"}


def test_a_failure_between_the_swap_and_the_commit_restores_the_old_copies(api, conn, ex_on, ocr, att, monkeypatch):
    """The copies are swapped in under the lock; a failure after the swap, before the commit, swaps them back and
    rolls the row back with them."""
    sid = _shared_style(conn)
    nid = _note_with_files(conn, att, files=(("a.png", b"first"),))
    gid = _publish(api, nid, sid, [_src("author", nid, "a.png")]).json()["template"]["id"]
    title_before = _row(conn, gid)["title"]
    _write(att, "author", nid, "a.png", b"second")
    real_put, swapped = gallery._DirMoves.put, []

    def put_then_fail(self, *a, **k):
        real_put(self, *a, **k)
        swapped.append(_files(_gallery_root(att) / gid))
        raise sqlite3.OperationalError("database is locked")
    monkeypatch.setattr(gallery._DirMoves, "put", put_then_fail)
    with pytest.raises(sqlite3.OperationalError):
        gallery.publish_example(None, "author", nid, sid, [_src("author", nid, "a.png")], "Again")
    assert swapped == [{"0.png": b"second"}]                                              # the swap had happened
    assert _row(conn, gid)["title"] == title_before
    assert _files(_gallery_root(att)) == {f"{gid}/0.png": b"first"}                      # and was undone, nothing left


def test_the_copies_are_made_outside_the_write_lock(api, conn, ex_on, ocr, att, monkeypatch):
    sid = _shared_style(conn, approve=True)
    nid = _note_with_files(conn, att, files=(("a.png", b"a"),))
    seen, real = [], gallery._copy_image

    def probe(src, dest):
        other = sqlite3.connect(os.environ["AUTH_DB_PATH"], timeout=0, isolation_level=None)
        try:
            other.execute("BEGIN IMMEDIATE")
            other.execute("ROLLBACK")
            seen.append("free")
        except sqlite3.OperationalError as e:
            seen.append(f"locked: {e}")
        finally:
            other.close()
        return real(src, dest)
    monkeypatch.setattr(gallery, "_copy_image", probe)
    gid = _publish(api, nid, sid, [_src("author", nid, "a.png")]).json()["template"]["id"]
    _approve(conn, gid)
    assert _publish(api, nid, sid, [_src("author", nid, "a.png")], title="Again").status_code == 200   # held
    assert seen == ["free", "free"], seen


# ── 8. held revisions: approve and reject ───────────────────────────────────────────────────

def _held(api, conn, att):
    """An approved example showing `old` bytes, then a held revision of it showing `new` ones."""
    sid = _shared_style(conn, approve=True)
    nid = _note_with_files(conn, att, files=(("a.png", b"old"),))
    gid = _publish(api, nid, sid, [_src("author", nid, "a.png")]).json()["template"]["id"]
    _approve(conn, gid)
    _write(att, "author", nid, "a.png", b"new")
    _write(att, "author", nid, "b.png", b"extra")
    body = json.loads(conn.execute("SELECT body_json FROM j2_notes WHERE id = ?", (nid,)).fetchone()[0])
    body["content"].append({"type": "image", "attrs": {"src": _src("author", nid, "b.png")}})
    conn.execute("UPDATE j2_notes SET body_json = ? WHERE id = ?", (json.dumps(body), nid))
    conn.commit()
    r = _publish(api, nid, sid, [_src("author", nid, "a.png"), _src("author", nid, "b.png")], title="Again")
    assert r.status_code == 200, r.text
    assert _row(conn, gid)["pending_json"]                                                # non-vacuity: held
    return sid, nid, gid


def test_a_held_revisions_copies_live_beside_the_listed_ones_and_serve_on_rev_pending(api, conn, ex_on, ocr, att):
    _sid, _nid, gid = _held(api, conn, att)
    assert _files(_gallery_root(att) / gid) == {"0.png": b"old", "v2/0.png": b"new", "v2/1.png": b"extra"}
    rev = json.loads(_row(conn, gid)["pending_json"])
    srcs = [n["attrs"]["src"] for n in rev["payload"]["bodyJson"]["content"] if n.get("type") == "image"]
    assert srcs == [f"{URL}/{gid}/images/0", f"{URL}/{gid}/images/1"]                    # the stored src has no version
    _as(api, "stranger")
    assert api.get(f"{URL}/{gid}/images/0").content == b"old"
    assert api.get(f"{URL}/{gid}/images/0?rev=pending").status_code == 404               # a held copy is not public
    assert api.get(f"{URL}/{gid}/images/1").status_code == 404
    for who, role in (("author", "member"), ("admin", "admin")):
        _as(api, who, role=role)
        assert api.get(f"{URL}/{gid}/images/0").content == b"old"
        assert api.get(f"{URL}/{gid}/images/0?rev=pending").content == b"new"
        assert api.get(f"{URL}/{gid}/images/1?rev=pending").content == b"extra"
        assert api.get(f"{URL}/{gid}/images/0?rev=other").status_code == 404


def test_approving_a_held_revision_moves_its_copies_into_place_and_deletes_the_old_ones(api, conn, ex_on, ocr, att):
    _sid, _nid, gid = _held(api, conn, att)
    _approve(conn, gid)
    assert _row(conn, gid)["version"] == 2 and _row(conn, gid)["pending_json"] is None
    assert _files(_gallery_root(att) / gid) == {"0.png": b"new", "1.png": b"extra"}
    assert sorted(p.name for p in _gallery_root(att).iterdir()) == [gid]                # no trash left behind
    _as(api, "stranger")
    assert api.get(f"{URL}/{gid}/images/0").content == b"new"
    assert api.get(f"{URL}/{gid}/images/1").content == b"extra"


def test_rejecting_a_held_revision_deletes_its_copies_and_keeps_the_listed_ones(api, conn, ex_on, ocr, att):
    _sid, _nid, gid = _held(api, conn, att)
    gallery.admin_act("admin", gid, "reject", note="Crop the account number.", conn=conn)
    assert _row(conn, gid)["pending_json"] is None and _row(conn, gid)["status"] == "approved"
    assert _files(_gallery_root(att) / gid) == {"0.png": b"old"}
    _as(api, "stranger")
    assert api.get(f"{URL}/{gid}/images/0").content == b"old"


def test_a_replaced_held_revision_replaces_its_copies(api, conn, ex_on, ocr, att):
    sid, nid, gid = _held(api, conn, att)
    _write(att, "author", nid, "a.png", b"newer")
    assert _publish(api, nid, sid, [_src("author", nid, "a.png")], title="Third").status_code == 200
    assert _files(_gallery_root(att) / gid) == {"0.png": b"old", "v2/0.png": b"newer"}


def test_a_pending_example_replaced_in_place_replaces_its_copies(api, conn, ex_on, ocr, att):
    sid = _shared_style(conn)
    nid = _note_with_files(conn, att, files=(("a.png", b"a"), ("b.png", b"b")))
    on = [_src("author", nid, "a.png"), _src("author", nid, "b.png")]
    gid = _publish(api, nid, sid, on).json()["template"]["id"]
    assert _files(_gallery_root(att) / gid) == {"0.png": b"a", "1.png": b"b"}
    assert _publish(api, nid, sid, on[1:], title="Fewer").json()["template"]["id"] == gid
    assert _files(_gallery_root(att) / gid) == {"0.png": b"b"}
    assert _publish(api, nid, sid, [], title="None").status_code == 200
    assert not (_gallery_root(att) / gid).exists()
    assert sorted(_gallery_root(att).iterdir()) == []


def test_a_failed_move_on_approval_lists_nothing_and_keeps_both_sets(api, conn, ex_on, ocr, att, monkeypatch):
    _sid, _nid, gid = _held(api, conn, att)
    before = dict(_row(conn, gid))
    real, hits = gallery._rename, []

    def refuse_second(a, b):
        hits.append((a, b))
        if len(hits) == 2:
            raise PermissionError("in use")
        return real(a, b)
    monkeypatch.setattr(gallery, "_rename", refuse_second)
    with pytest.raises(gallery.GalleryServerError):
        _approve(conn, gid)
    monkeypatch.setattr(gallery, "_rename", real)
    # the first move was made, the second refused, and the first then reversed (the undo goes through the seam too)
    assert len(hits) == 3 and hits[2] == (hits[0][1], hits[0][0]), hits
    assert dict(_row(conn, gid)) == before                                                # nothing was listed
    assert _files(_gallery_root(att) / gid) == {"0.png": b"old", "v2/0.png": b"new", "v2/1.png": b"extra"}
    assert sorted(p.name for p in _gallery_root(att).iterdir()) == [gid]


# ── fix round 1 (review I-1, M-1, M-2; rulings P3b-T4-R6, P3b-T4-R7) ──────────────────────────────

def _lock_probe() -> str:
    """'held' when another connection cannot take auth.db's write lock right now, else 'free'."""
    other = sqlite3.connect(os.environ["AUTH_DB_PATH"], timeout=0, isolation_level=None)
    try:
        other.execute("BEGIN IMMEDIATE")
        other.execute("ROLLBACK")
        return "free"
    except sqlite3.OperationalError:
        return "held"
    finally:
        other.close()


def test_a_republish_right_after_a_reject_commits_keeps_its_held_copies(api, conn, ex_on, ocr, att, monkeypatch):
    """R6(a): the reject's own cleanup runs after its commit. A republish is injected into exactly that gap -- the first
    directory removal the reject makes after it has committed -- and writes a fresh held revision in `v2`. Its copies
    must survive, so `pending_json` and the files on disk agree."""
    sid, nid, gid = _held(api, conn, att)
    _write(att, "author", nid, "a.png", b"fresh")
    real, fired = gallery._remove_dir, []

    def republish_first(path):
        if not fired:
            fired.append(path)
            assert _row(conn, gid)["pending_json"] is None                              # the reject has committed
            assert _publish(api, nid, sid, [_src("author", nid, "a.png")], title="Fresh").status_code == 200
        return real(path)
    monkeypatch.setattr(gallery, "_remove_dir", republish_first)
    gallery.admin_act("admin", gid, "reject", note="Crop the account number.", conn=conn)
    monkeypatch.setattr(gallery, "_remove_dir", real)
    assert fired                                                                          # non-vacuity: the gap ran
    assert json.loads(_row(conn, gid)["pending_json"])["title"] == "Fresh"               # the republish is held
    assert _files(_gallery_root(att) / gid) == {"0.png": b"old", "v2/0.png": b"fresh"}
    _as(api, "author")
    assert api.get(f"{URL}/{gid}/images/0?rev=pending").content == b"fresh"
    assert sorted(p.name for p in _gallery_root(att).iterdir()) == [gid]                # the declined copies are gone


def test_a_failed_publish_puts_the_copies_back_while_it_still_holds_the_lock(api, conn, ex_on, ocr, att, monkeypatch):
    """R6(b): the undo runs BEFORE the rollback. A failure after the swap; at the moment `undo()` starts, another
    connection still cannot take the write lock, and the transaction is still open."""
    sid = _shared_style(conn)
    nid = _note_with_files(conn, att, files=(("a.png", b"first"),))
    gid = _publish(api, nid, sid, [_src("author", nid, "a.png")]).json()["template"]["id"]
    _write(att, "author", nid, "a.png", b"second")
    real_put, real_undo, seen = gallery._DirMoves.put, gallery._DirMoves.undo, []

    def put_then_fail(self, *a, **k):
        real_put(self, *a, **k)
        raise sqlite3.OperationalError("database is locked")

    def spy_undo(self):
        seen.append((self.active, _lock_probe()))
        return real_undo(self)
    monkeypatch.setattr(gallery._DirMoves, "put", put_then_fail)
    monkeypatch.setattr(gallery._DirMoves, "undo", spy_undo)
    with pytest.raises(sqlite3.OperationalError):
        gallery.publish_example(None, "author", nid, sid, [_src("author", nid, "a.png")], "Again")
    assert seen == [(True, "held")], seen
    assert _lock_probe() == "free"                                                        # released afterwards
    assert _files(_gallery_root(att)) == {f"{gid}/0.png": b"first"}


def test_a_failed_approval_move_is_undone_while_it_still_holds_the_lock(api, conn, ex_on, ocr, att, monkeypatch):
    """R6(b) in `admin_act`: a refused second move during the promotion; the undo starts with the lock still held."""
    _sid, _nid, gid = _held(api, conn, att)
    real, hits = gallery._rename, []
    real_undo, seen = gallery._DirMoves.undo, []

    def refuse_second(a, b):
        hits.append((a, b))
        if len(hits) == 2:
            raise PermissionError("in use")
        return real(a, b)

    def spy_undo(self):
        seen.append((self.active, _lock_probe(), conn.in_transaction))
        return real_undo(self)
    monkeypatch.setattr(gallery, "_rename", refuse_second)
    monkeypatch.setattr(gallery._DirMoves, "undo", spy_undo)
    with pytest.raises(gallery.GalleryServerError):
        _approve(conn, gid)
    assert seen == [(True, "held", True)], seen
    assert not conn.in_transaction
    assert _files(_gallery_root(att) / gid) == {"0.png": b"old", "v2/0.png": b"new", "v2/1.png": b"extra"}


def test_an_image_number_must_be_one_to_three_ascii_digits(api, conn, ex_on, ocr, att):
    """R7 (M-1): a Unicode digit `str.isdigit` admits (and `int` may refuse) is the 404, never a 500."""
    sid = _shared_style(conn)
    nid = _note_with_files(conn, att, files=(("a.png", b"a"),))
    gid = _publish(api, nid, sid, [_src("author", nid, "a.png")]).json()["template"]["id"]
    _approve(conn, gid)
    assert api.get(f"{URL}/{gid}/images/0").status_code == 200                           # control
    for n in ("%C2%B2", "%D9%A0", "%EF%BC%90", "0000", "1000", "-1", "+0", " 0"):
        assert api.get(f"{URL}/{gid}/images/{n}").status_code == 404, n
    for n in (chr(0xB2), chr(0x660), "0" + chr(10)):          # superscript two, Arabic-Indic zero, a trailing newline
        assert gallery.example_image_path("author", gid, n) is None, repr(n)
    assert gallery.example_image_path("author", gid, "000") == _gallery_root(att) / gid / "0.png"


def test_an_item_id_with_a_trailing_newline_is_not_one_segment(att):
    """R7 (M-2): the one-segment check is a full match."""
    for bad in ("abc" + chr(10), "abc" + chr(13) + chr(10), "", "a/b", "..", "a" * 65):
        with pytest.raises(ValueError):
            gallery._item_dir(bad)
    (_gallery_root(att) / "abc").mkdir(parents=True)
    assert gallery.remove_example_images(["abc" + chr(10)]) == 0
    assert (_gallery_root(att) / "abc").is_dir()
    assert gallery.remove_example_images(["abc"]) == 1                                     # control
