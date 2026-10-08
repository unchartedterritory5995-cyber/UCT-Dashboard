"""Security review MINOR findings M-6 and M-7, both on the community template gallery.

  * M-6  the gallery list parsed every row's full body (up to 200 rows of up to 200 KB) on
         every request, to build three preview lines. The preview is now stored when the
         template is published or seeded, and the list reads neither the body nor the parser.
  * M-7  deleting an author's account removed their gallery templates but left OTHER members'
         reports and use records about those templates in the table, pointing at nothing.
"""
from __future__ import annotations

import json

import pytest

from tests.test_notebook_template_gallery import (  # noqa: F401 -- fixtures
    A, ADMIN, B, C, _approve, _conn, _fresh_limiter, _member_template, _publish, db_path, p, svc, t,
)


def _body(*lines):
    return {"type": "doc", "content": [{"type": "heading", "attrs": {"level": 2}, "content": [t(lines[0])]},
                                       *[p(t(x)) for x in lines[1:]]]}


# ── M-6 ──────────────────────────────────────────────────────────────────────

def test_M6_the_list_reads_no_body_and_parses_none(svc, monkeypatch):
    for i in range(4):
        gid = _publish(svc, tid=_member_template(A, name=f"T{i}", body=_body(f"Plan {i}", "first line", "second line"),
                                                 with_properties=False), title=f"Template {i}")["id"]
        _approve(svc, gid)

    parsed = []
    real_preview, real_loads = svc.preview_lines, json.loads
    monkeypatch.setattr(svc, "preview_lines", lambda *a, **k: parsed.append("preview") or real_preview(*a, **k))

    def counting_loads(s, *a, **k):
        if isinstance(s, (str, bytes)) and len(s) > 0 and b'"type"' in (s if isinstance(s, bytes) else s.encode()) \
                and b'"doc"' in (s if isinstance(s, bytes) else s.encode()):
            parsed.append("body")
        return real_loads(s, *a, **k)

    monkeypatch.setattr(svc.json, "loads", counting_loads)
    conn = _conn()
    statements = []
    conn.set_trace_callback(statements.append)
    try:
        listed = svc.list_gallery(B, conn=conn)
        queue = svc.admin_queue(conn=conn)
    finally:
        conn.set_trace_callback(None)
        conn.close()

    member_rows = [x for x in listed if not x["firm"]]
    assert len(member_rows) == 4 and len(queue["pending"]) == 0
    assert parsed == [], f"the list still parsed template bodies: {parsed[:5]}"
    selects = [s for s in statements if "j2_template_gallery g" in s]
    assert selects, "the trace saw no gallery read"
    assert not any("body_json" in s or "g.*" in s for s in selects), (
        "the list query still reads the body column: " + selects[0][:200])
    for row in member_rows:
        assert [line["kind"] for line in row["preview"]] == ["heading", "text", "text"]
        assert row["preview"][1]["text"] == "first line"


def test_M6_the_stored_preview_is_the_bodys_own_and_follows_a_resubmit(svc):
    tid = _member_template(A, body=_body("First", "alpha", "beta"), with_properties=False)
    item = _publish(svc, tid=tid)
    conn = _conn()
    row = conn.execute("SELECT body_json, preview_json FROM j2_template_gallery WHERE id = ?", (item["id"],)).fetchone()
    assert json.loads(row["preview_json"]) == svc.preview_lines(json.loads(row["body_json"])) == item["preview"]
    conn.execute("UPDATE j2_note_templates SET body_json = ? WHERE id = ?",
                 (json.dumps(_body("Second", "gamma")), tid))
    conn.commit()
    conn.close()
    again = _publish(svc, tid=tid)
    assert [line["text"] for line in again["preview"]] == ["Second", "gamma"]
    assert [x["preview"] for x in svc.list_gallery(A, section="mine")] == [again["preview"]]


def test_M6_a_row_from_before_the_column_is_filled_in_once(svc):
    """A database that already holds gallery rows (the firm picks, any early submission) gets
    its previews at the next schema pass, and the firm picks carry one from the start."""
    firm = [x for x in svc.list_gallery(B) if x["firm"]]
    assert firm and all(x["preview"] for x in firm), "the seeded firm templates have no stored preview"
    gid = _publish(svc, tid=_member_template(A, body=_body("Old", "row"), with_properties=False))["id"]
    conn = _conn()
    conn.execute("UPDATE j2_template_gallery SET preview_json = NULL WHERE id = ?", (gid,))
    conn.commit()
    assert svc.get_item(A, gid, conn=conn)["preview"] == [{"kind": "heading", "text": "Old"},
                                                          {"kind": "text", "text": "row"}]
    svc.ensure_gallery_schema(conn)
    assert conn.execute("SELECT preview_json FROM j2_template_gallery WHERE id = ?", (gid,)).fetchone()[0]
    assert [x["preview"] for x in svc.list_gallery(A, section="mine", conn=conn)][0][0]["text"] == "Old"
    conn.close()


# ── M-7 ──────────────────────────────────────────────────────────────────────

def test_M7_deleting_an_author_removes_the_reports_and_uses_about_their_templates(svc):
    from api.services.journal_two import account_purge
    mine = _publish(svc, tid=_member_template(A, with_properties=False))["id"]
    _approve(svc, mine)
    other = _publish(svc, owner=C, tid=_member_template(C, with_properties=False), title="Carl's")["id"]
    _approve(svc, other)

    svc.report(B, mine, reason="spam", note="B's private words about A's template")
    svc.use_template(B, mine)
    svc.report(B, other, reason="broken", note="about Carl's")       # must survive
    svc.use_template(B, other)                                        # must survive
    svc.report(A, other, reason="other", note="A's own report")       # A's own: goes with A

    conn = _conn()
    out = account_purge.purge_user_data(A, conn)
    conn.commit()
    assert out["errors"] == [], out["errors"]

    def rows(sql):
        return [tuple(r) for r in conn.execute(sql)]

    assert rows("SELECT id FROM j2_template_gallery WHERE user_id IS NOT NULL") == [(other,)]
    reports = rows("SELECT gallery_id, user_id FROM j2_template_gallery_reports")
    uses = rows("SELECT gallery_id, user_id FROM j2_template_gallery_uses")
    conn.close()
    assert reports == [(other, B)], f"reports left behind or over-deleted: {reports}"
    assert uses == [(other, B)], f"use records left behind or over-deleted: {uses}"
