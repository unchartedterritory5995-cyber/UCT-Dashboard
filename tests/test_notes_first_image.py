"""Notebook card thumbnail: first-inline-image extraction, persistence on save,
and lazy backfill of legacy notes on open."""
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.notes import _extract_first_image
from api.services.auth_db import get_connection

IMG = "https://cdn.example.com/pic.png"


def _doc(*content):
    return {"type": "doc", "content": list(content)}


def _img(src):
    return {"type": "image", "attrs": {"src": src}}


def _p(text):
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def test_extract_first_image_finds_first_in_document_order():
    assert _extract_first_image(_doc(_p("intro"), _img(IMG), _img("second.png"))) == IMG


def test_extract_first_image_walks_nested_content():
    assert _extract_first_image(_doc({"type": "blockquote", "content": [_img(IMG)]})) == IMG


def test_extract_first_image_none_when_no_image():
    assert _extract_first_image(_doc(_p("just text"))) is None
    assert _extract_first_image(None) is None
    assert _extract_first_image({}) is None
    # An image node with no usable src is not a match.
    assert _extract_first_image(_doc({"type": "image", "attrs": {}})) is None


def test_create_and_list_carry_first_image_url():
    note = notes_svc.create_note("u_fi", {"title": "Has image", "bodyJson": _doc(_p("x"), _img(IMG))})
    assert note["firstImageUrl"] == IMG
    row = next(r for r in notes_svc.list_notes("u_fi") if r["id"] == note["id"])
    assert row["firstImageUrl"] == IMG


def test_update_recomputes_first_image_url():
    note = notes_svc.create_note("u_fi2", {"title": "No image", "bodyJson": _doc(_p("x"))})
    assert note["firstImageUrl"] is None
    notes_svc.update_note("u_fi2", note["id"], {"bodyJson": _doc(_img(IMG))})
    row = next(r for r in notes_svc.list_notes("u_fi2") if r["id"] == note["id"])
    assert row["firstImageUrl"] == IMG


def test_import_confirm_populates_first_image_url_on_insert_and_update():
    doc = _doc(_img(IMG))
    notes_svc.import_confirm("u_imp", {"source": "t", "destFolderId": None, "notes": [
        {"importKey": "k1", "title": "Imp", "bodyJson": doc, "tags": [], "folderPath": []},
    ]})
    assert notes_svc.list_notes("u_imp")[0]["firstImageUrl"] == IMG
    # Re-import the same key with a new first image → the UPDATE branch recomputes.
    doc2 = _doc(_img("https://cdn.example.com/z.png"))
    notes_svc.import_confirm("u_imp", {"source": "t", "destFolderId": None, "notes": [
        {"importKey": "k1", "title": "Imp2", "bodyJson": doc2, "tags": [], "folderPath": []},
    ]})
    assert notes_svc.list_notes("u_imp")[0]["firstImageUrl"] == "https://cdn.example.com/z.png"


def test_get_note_lazy_backfills_a_legacy_null_without_touching_updated_at():
    note = notes_svc.create_note("u_fi3", {"title": "legacy", "bodyJson": _doc(_img(IMG))})
    updated_at = note["updatedAt"]
    # Simulate a note saved before the column existed.
    conn = get_connection()
    try:
        conn.execute("UPDATE j2_notes SET first_image_url = NULL WHERE id = ?", (note["id"],))
        conn.commit()
    finally:
        conn.close()

    got = notes_svc.get_note("u_fi3", note["id"])
    assert got["firstImageUrl"] == IMG
    assert got["updatedAt"] == updated_at  # opening a note must not shift its time
    # ...and it's now persisted so the list projection shows it too.
    row = next(r for r in notes_svc.list_notes("u_fi3") if r["id"] == note["id"])
    assert row["firstImageUrl"] == IMG
