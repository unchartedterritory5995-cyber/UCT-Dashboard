"""Security review finding I-6: an approval names the exact version the reviewer saw.

Publishing a template again replaces the same gallery row's body and sends it back to pending.
Approval used to check neither the status nor a version, so a member could submit a clean
template, then resubmit a different body while the admin had the first one open, and the
admin's click listed the second body. "What is listed is always what was reviewed" did not hold.

Now an approval carries the `updatedAt` of the version the reviewer looked at, and the UPDATE
is conditional on it (compare-and-set in the WHERE clause, so there is no gap between the
check and the write). A mismatch, or no version at all, answers 409 and lists nothing.
"""
from __future__ import annotations

import json

import pytest

from tests.test_notebook_template_gallery import (  # noqa: F401 -- fixtures
    A, ADMIN, B, _conn, _fresh_limiter, _member_template, _publish, app, as_user, client, db_path,
    gate_on, p, svc, t,
)


def _body(words):
    return {"type": "doc", "content": [p(t(words))]}


def _row(gid):
    c = _conn()
    try:
        return dict(c.execute("SELECT status, body_json, updated_at, listed_at FROM j2_template_gallery"
                              " WHERE id = ?", (gid,)).fetchone())
    finally:
        c.close()


def _resubmit(svc, tid, words):
    c = _conn()
    c.execute("UPDATE j2_note_templates SET body_json = ? WHERE id = ?", (json.dumps(_body(words)), tid))
    c.commit()
    c.close()
    return _publish(svc, tid=tid)


def test_approving_the_version_that_was_swapped_out_lists_nothing(svc):
    tid = _member_template(A, body=_body("the clean first version"), with_properties=False)
    gid = _publish(svc, tid=tid)["id"]
    seen = svc.get_item(ADMIN, gid, is_admin=True)              # the admin opens the preview
    assert "clean first version" in json.dumps(seen["bodyJson"])

    _resubmit(svc, tid, "SWAPPED second version nobody reviewed")

    with pytest.raises(svc.GalleryConflict) as exc:
        svc.admin_act(ADMIN, gid, "approve", reviewed_updated_at=seen["updatedAt"])
    assert "again" in str(exc.value).lower()
    row = _row(gid)
    assert row["status"] == "pending" and row["listed_at"] is None
    assert svc.get_item(B, gid) is None                         # not listed for any member
    assert gid not in [x["id"] for x in svc.list_gallery(B)]


def test_approving_the_current_version_lists_exactly_what_was_seen(svc):
    tid = _member_template(A, body=_body("the version the admin saw"), with_properties=False)
    gid = _publish(svc, tid=tid)["id"]
    seen = svc.get_item(ADMIN, gid, is_admin=True)
    out = svc.admin_act(ADMIN, gid, "approve", reviewed_updated_at=seen["updatedAt"])
    assert out["status"] == "approved"
    assert json.loads(_row(gid)["body_json"]) == seen["bodyJson"]
    assert "the version the admin saw" in json.dumps(svc.get_item(B, gid)["bodyJson"])


def test_an_approval_that_names_no_version_is_refused(svc):
    gid = _publish(svc)["id"]
    for missing in (None, "", 5, ["x"]):
        with pytest.raises(svc.GalleryConflict):
            svc.admin_act(ADMIN, gid, "approve", reviewed_updated_at=missing)
    with pytest.raises(svc.GalleryConflict):
        svc.admin_act(ADMIN, gid, "approve")
    assert _row(gid)["status"] == "pending"


def test_the_other_review_actions_need_no_version(svc):
    """Only approval lists content. Reject, hide, unhide, feature and unfeature are unchanged."""
    gid = _publish(svc)["id"]
    svc.admin_act(ADMIN, gid, "reject", note="Add your exit rules.")
    svc.admin_act(ADMIN, gid, "hide")
    svc.admin_act(ADMIN, gid, "unhide")
    row = _row(gid)
    out = svc.admin_act(ADMIN, gid, "approve", reviewed_updated_at=row["updated_at"])
    assert out["status"] == "approved"
    svc.admin_act(ADMIN, gid, "feature")
    svc.admin_act(ADMIN, gid, "unfeature")


def test_the_route_answers_409_and_says_to_look_again(app, client, gate_on, svc):
    tid = _member_template(A, body=_body("first"), with_properties=False)
    gid = _publish(svc, tid=tid)["id"]
    as_user(app, ADMIN, role="admin")
    seen = client.get(f"/api/j2/template-gallery/{gid}").json()["template"]

    _resubmit(svc, tid, "second, unreviewed")

    url = f"/api/j2/template-gallery/admin/items/{gid}"
    stale = client.patch(url, json={"action": "approve", "reviewedUpdatedAt": seen["updatedAt"]})
    assert stale.status_code == 409, stale.text
    assert "again" in stale.json()["detail"].lower()
    assert client.patch(url, json={"action": "approve"}).status_code == 409
    assert _row(gid)["status"] == "pending"

    fresh = client.get(f"/api/j2/template-gallery/{gid}").json()["template"]
    assert "second, unreviewed" in json.dumps(fresh["bodyJson"])
    ok = client.patch(url, json={"action": "approve", "reviewedUpdatedAt": fresh["updatedAt"]})
    assert ok.status_code == 200 and ok.json()["template"]["status"] == "approved"


def test_the_review_queue_and_the_preview_both_carry_the_version(svc):
    gid = _publish(svc)["id"]
    queue_row = svc.admin_queue()["pending"][0]
    assert queue_row["id"] == gid
    assert queue_row["updatedAt"] == svc.get_item(ADMIN, gid, is_admin=True)["updatedAt"] == _row(gid)["updated_at"]
