"""P4b Task 5: adopting a shared page layout, and the shared machinery (Helpful, report) on layout items.

Adoption is a READ plus one use record: the server hands back the LISTED layout through `safe_layout` and
counts the member once. It never writes the member's `journal_page_layout` preference (R-P4b-8): the client
applies the layout and saves it through the ordinary preference door, so a member's layout is theirs.
"""
from __future__ import annotations

import json

import pytest

from api.services.journal_two import page_layout_share as pls
from api.services.journal_two import template_gallery as gallery
# P4b-R-X17: the shared fixtures, imported by name (never copied).
from tests._style_library_helpers import api, conn  # noqa: F401
# Task 4's layout fixtures, imported by name for the same reason: a copy here would be a second
# authority over the switches and the preference write.
from tests.test_page_layout_share import TRADE, _save_pref, _set, sharing_on, SWITCHES  # noqa: F401


def _listed_layout(conn) -> str:
    """The author shares their trade page (TRADE) and an admin approves it. Returns the item id."""
    _save_pref(conn, "author", {"version": 1, "trade": TRADE})
    item = gallery.publish_layout("author", "trade", title="Prop trade page", description="", category="journal",
                                  trading_style="prop", conn=conn)
    gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=item["updatedAt"], conn=conn)
    return item["id"]


def _approve_a_revision(conn, gid: str) -> None:
    """The author saves a reordered trade list and shares again; an admin approves the held revision, so the
    listed version goes from 1 to 2."""
    _save_pref(conn, "author", {"version": 1, "trade": list(reversed(TRADE))})
    gallery.publish_layout("author", "trade", title="Prop trade page", description="", category="journal",
                           trading_style="prop", conn=conn)
    rev = next(r for r in gallery.admin_queue(conn=conn)["pending"] if r["id"] == gid)
    gallery.admin_act("admin", gid, "approve", reviewed_updated_at=rev["updatedAt"], conn=conn)


def _pref(conn, user_id: str) -> str | None:
    row = conn.execute("SELECT pref_value FROM user_preferences WHERE user_id = ? AND pref_key = ?",
                       (user_id, pls.LAYOUT_PREF)).fetchone()
    return None if row is None else row[0]


def _uses(conn, gid: str) -> list[str]:
    return [u["user_id"] for u in conn.execute(
        "SELECT user_id FROM j2_template_gallery_uses WHERE gallery_id = ? ORDER BY user_id", (gid,)).fetchall()]


# ── the service ─────────────────────────────────────────────────────────────────────────────────

def test_adopt_returns_the_listed_layout_and_counts_one_member_once(conn, sharing_on):
    gid = _listed_layout(conn)                      # author shares TRADE, admin approves
    out = gallery.adopt_layout("member", gid, version=1, conn=conn)
    assert out["layout"] == {"page": "trade", "lists": {"trade": TRADE}}
    assert out["version"] == 1
    assert out["credit"].startswith("Based on ")
    assert out["credit"].endswith("'s Prop trade page")
    gallery.adopt_layout("member", gid, version=1, conn=conn)
    gallery.adopt_layout("author", gid, version=1, conn=conn)
    assert _uses(conn, gid) == ["member"]
    assert conn.execute("SELECT COUNT(*) FROM user_preferences WHERE user_id = 'member'").fetchone()[0] == 0


def test_the_used_by_count_reads_the_adoption(conn, sharing_on):
    gid = _listed_layout(conn)
    assert gallery.get_item("viewer", gid, conn=conn)["usedBy"] == 0       # non-vacuity: it can move
    gallery.adopt_layout("member", gid, version=1, conn=conn)
    assert gallery.get_item("viewer", gid, conn=conn)["usedBy"] == 1


def test_adopting_a_moved_version_is_refused_and_records_nothing(conn, sharing_on):
    gid = _listed_layout(conn)
    _approve_a_revision(conn, gid)                  # version 2 is listed
    with pytest.raises(gallery.GalleryConflict) as e:
        gallery.adopt_layout("member", gid, version=1, conn=conn)
    assert str(e.value) == gallery.LAYOUT_MOVED_SENTENCE
    assert conn.execute("SELECT COUNT(*) FROM j2_template_gallery_uses WHERE gallery_id = ?", (gid,)).fetchone()[0] == 0
    out = gallery.adopt_layout("member", gid, version=2, conn=conn)       # control: the listed version adopts
    assert (out["version"], out["layout"]["lists"]["trade"]) == (2, list(reversed(TRADE)))


@pytest.mark.parametrize("bad", [None, "1", 1.0, True, 0, 3])
def test_a_version_that_is_not_the_listed_whole_number_is_a_conflict(conn, sharing_on, bad):
    gid = _listed_layout(conn)
    with pytest.raises(gallery.GalleryConflict) as e:
        gallery.adopt_layout("member", gid, version=bad, conn=conn)
    assert str(e.value) == gallery.LAYOUT_MOVED_SENTENCE
    assert _uses(conn, gid) == []


def test_a_held_revision_is_never_what_an_adopter_gets(conn, sharing_on):
    gid = _listed_layout(conn)
    _save_pref(conn, "author", {"version": 1, "trade": list(reversed(TRADE))})
    gallery.publish_layout("author", "trade", title="Prop trade page", description="", category="journal",
                           trading_style="prop", conn=conn)              # held, not approved
    out = gallery.adopt_layout("member", gid, version=1, conn=conn)
    assert out["layout"]["lists"]["trade"] == TRADE                       # payload_json, never pending_json


def test_a_stored_unknown_panel_never_reaches_an_adopter(conn, sharing_on):
    gid = _listed_layout(conn)
    conn.execute("UPDATE j2_template_gallery SET payload_json = ? WHERE id = ?", (json.dumps(
        {"page": "trade", "lists": {"trade": TRADE + [{"id": "futurePanel", "shown": True}], "market": []}}), gid))
    conn.commit()
    assert gallery.adopt_layout("member", gid, version=1, conn=conn)["layout"]["lists"] == {"trade": TRADE}
    assert gallery.get_item("member", gid, conn=conn)["payload"]["lists"] == {"trade": TRADE}


def test_a_list_whose_only_panels_left_the_registry_is_dropped_not_handed_over_empty(conn, sharing_on):
    """P4b-T5-R1: a stored today layout whose `market` list held only panels that have since left the registry.
    The adopter gets the lists that still hold a panel, and no empty `market` list."""
    gid = _listed_layout(conn)
    kept = [{"id": "regime", "shown": True}, {"id": "todayNote", "shown": False}]
    conn.execute("UPDATE j2_template_gallery SET payload_json = ? WHERE id = ?", (json.dumps(
        {"page": "today", "lists": {"premarket": kept, "market": [{"id": "retiredPanel", "shown": True}],
                                    "postclose": kept}}), gid))
    conn.commit()
    out = gallery.adopt_layout("member", gid, version=1, conn=conn)
    assert out["layout"] == {"page": "today", "lists": {"premarket": kept, "postclose": kept}}
    assert "market" not in out["layout"]["lists"]
    assert _uses(conn, gid) == ["member"]


def test_a_stored_row_whose_only_panels_all_left_the_registry_is_refused(conn, sharing_on):
    """P4b-T5-R1: every list emptied by registry drift leaves nothing to adopt: the unsupported refusal, and no
    use recorded."""
    gid = _listed_layout(conn)
    gone = [{"id": "retiredPanel", "shown": True}]
    conn.execute("UPDATE j2_template_gallery SET payload_json = ? WHERE id = ?", (json.dumps(
        {"page": "today", "lists": {"premarket": gone, "market": gone, "postclose": gone}}), gid))
    conn.commit()
    with pytest.raises(gallery.GalleryError) as e:
        gallery.adopt_layout("member", gid, version=1, conn=conn)
    assert str(e.value) == gallery.LAYOUT_UNSUPPORTED_SENTENCE
    assert _uses(conn, gid) == []


@pytest.mark.parametrize("stored", [
    "{not json",
    json.dumps([1, 2]),
    json.dumps({"page": "sidebar", "lists": {"trade": TRADE}}),
    json.dumps({"page": "trade"}),
    json.dumps({"page": "trade", "lists": {}}),
    json.dumps({"page": "trade", "lists": {"trade": [{"id": "futurePanel", "shown": True}]}}),
])
def test_a_payload_that_cannot_be_read_is_unsupported_and_records_nothing(conn, sharing_on, stored):
    gid = _listed_layout(conn)
    conn.execute("UPDATE j2_template_gallery SET payload_json = ? WHERE id = ?", (stored, gid))
    conn.commit()
    with pytest.raises(gallery.GalleryError) as e:
        gallery.adopt_layout("member", gid, version=1, conn=conn)
    assert not isinstance(e.value, gallery.GalleryConflict)
    assert str(e.value) == gallery.LAYOUT_UNSUPPORTED_SENTENCE
    assert _uses(conn, gid) == []
    item = gallery.get_item("member", gid, conn=conn)                      # the read never 500s either
    assert item is not None


def test_an_unreadable_stored_layout_reads_as_none_on_get_item(conn, sharing_on):
    gid = _listed_layout(conn)
    conn.execute("UPDATE j2_template_gallery SET payload_json = '{not json' WHERE id = ?", (gid,))
    conn.commit()
    assert gallery.get_item("member", gid, conn=conn)["payload"] is None


def test_only_a_listed_layout_adopts(conn, sharing_on):
    from tests._style_library_helpers import _row
    pending = _row(conn, item_type="page_layout", status="pending", source_page="trade", user_id="author",
                   payload_json=json.dumps({"page": "trade", "lists": {"trade": TRADE}}))
    outline = _row(conn, item_type="outline", user_id="author")
    assert gallery.adopt_layout("member", pending, version=1, conn=conn) is None
    assert gallery.adopt_layout("member", outline, version=1, conn=conn) is None    # not a layout
    assert gallery.adopt_layout("member", "no-such-item", version=1, conn=conn) is None
    assert gallery.adopt_layout("member", None, version=1, conn=conn) is None
    assert conn.execute("SELECT COUNT(*) FROM j2_template_gallery_uses").fetchone()[0] == 0
    gid = _listed_layout(conn)
    assert gallery.adopt_layout("member", gid, version=1, conn=conn) is not None   # control


def test_withdraw_and_hide_leave_adopted_layouts_alone(conn, sharing_on):
    gid = _listed_layout(conn)
    _save_pref(conn, "member", {"version": 1, "trade": TRADE})        # what the member wrote after adopting
    before = _pref(conn, "member")
    assert before is not None                                         # non-vacuity
    gallery.admin_act("admin", gid, "hide", conn=conn)
    assert gallery.adopt_layout("member", gid, version=1, conn=conn) is None
    gallery.admin_act("admin", gid, "unhide", conn=conn)
    assert gallery.unpublish("author", gid, conn=conn) is True
    assert gallery.adopt_layout("member", gid, version=1, conn=conn) is None
    assert _pref(conn, "member") == before


def test_helpful_and_report_work_on_a_layout_and_404_while_off(conn, monkeypatch, sharing_on):
    gid = _listed_layout(conn)
    assert gallery.set_helpful("member", gid, True, conn=conn)["helpful"] is True
    assert gallery.report("member", gid, reason="spam", note="", conn=conn) is not None
    monkeypatch.setenv("NOTEBOOK_LAYOUT_SHARING_ENABLED", "0")
    assert gallery.set_helpful("member2", gid, True, conn=conn) is None
    assert gallery.report("member2", gid, reason="spam", note="", conn=conn) is None
    assert gallery.adopt_layout("member2", gid, version=1, conn=conn) is None


def test_use_template_refuses_a_layout(conn, sharing_on):
    # P4b-R-X8: a layout is not a template. `/use` on one must not write an empty note template or count a use.
    gid = _listed_layout(conn)
    assert gallery.use_template("member", gid, conn=conn) is None
    assert conn.execute("SELECT COUNT(*) FROM j2_note_templates WHERE user_id = 'member'").fetchone()[0] == 0
    assert _uses(conn, gid) == []


# ── the route ───────────────────────────────────────────────────────────────────────────────────

def _url(gid: str) -> str:
    return f"/api/j2/template-gallery/{gid}/adopt-layout"


def _as(api, who):
    from api.middleware import auth_middleware as authmw
    overrides = api.app.dependency_overrides
    if who == "unpaid":
        unpaid = {"id": "member", "role": "member", "plan": "free"}
        overrides[authmw.get_current_user_with_plan] = lambda: dict(unpaid)
    elif who == "signed_out":
        overrides.pop(authmw.get_current_user, None)
        overrides.pop(authmw.get_current_user_with_plan, None)
    elif who == "member":
        member = {"id": "member", "role": "member", "plan": "pro"}
        overrides[authmw.get_current_user] = lambda: dict(member)
        overrides[authmw.get_current_user_with_plan] = lambda: dict(member)


def _charged(conn) -> int | None:
    from api.services.journal_two.calendar import et_today
    if conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'daily_usage_counters'").fetchone() is None:
        return None                                 # the counter table is created by the first charge
    row = conn.execute("SELECT value FROM daily_usage_counters WHERE scope = ? AND subject = ? AND day = ?",
                       ("notebook_gallery_adopt", "member", et_today())).fetchone()
    return None if row is None else row[0]


def test_adopt_layout_route_returns_the_layout_and_spends_the_adopt_day(api, conn, sharing_on):
    gid = _listed_layout(conn)
    _as(api, "member")
    r = api.post(_url(gid), json={"version": 1})
    assert r.status_code == 200, r.text
    out = r.json()
    assert set(out) == {"layout", "version", "credit"}
    assert out["layout"] == {"page": "trade", "lists": {"trade": TRADE}}
    assert _charged(conn) == 1                                     # non-vacuity: a success IS charged
    assert _pref(conn, "member") is None                           # R-P4b-8: no server write to the preference


def test_adopt_layout_route_is_the_one_404_for_everyone_while_sharing_is_off(api, conn, monkeypatch):
    _set(monkeypatch, {"NOTEBOOK_STYLE_LIBRARY_ENABLED": True, "JOURNAL_PAGE_LAYOUTS_ENABLED": True,
                       "NOTEBOOK_LAYOUT_SHARING_ENABLED": True})
    gid = _listed_layout(conn)
    monkeypatch.setenv("NOTEBOOK_LAYOUT_SHARING_ENABLED", "0")
    one_404 = api.get("/api/j2/template-gallery/no-such-item")
    assert one_404.status_code == 404
    answers = []
    for who in ("member", "unpaid", "signed_out"):
        _as(api, who)
        answers += [api.post(_url(gid), json={"version": 1}), api.post(_url(gid), content=b"{bad"),
                    api.post(_url(gid), json={"version": True})]
    assert [r.status_code for r in answers] == [404] * 9
    assert all(r.json() == one_404.json() for r in answers)
    assert _uses(conn, gid) == []


def test_adopt_layout_route_needs_a_paid_plan(api, conn, sharing_on):
    gid = _listed_layout(conn)
    _as(api, "unpaid")
    assert api.post(_url(gid), json={"version": 1}).status_code == 402
    assert _uses(conn, gid) == []


@pytest.mark.parametrize("body", [{"version": True}, {"version": "1"}, {"version": 1.5}, {"version": None}, {}])
def test_a_version_that_is_not_a_whole_number_is_a_400_with_the_sentence(api, conn, sharing_on, body):
    gid = _listed_layout(conn)
    _as(api, "member")
    r = api.post(_url(gid), json=body)
    assert (r.status_code, r.json()["detail"]) == (400, "Say which version you previewed: version must be a whole number.")
    assert _charged(conn) is None                                  # a 400 spends nothing
    assert _uses(conn, gid) == []


def test_a_refused_adopt_layout_gives_the_day_back(api, conn, sharing_on):
    gid = _listed_layout(conn)
    _as(api, "member")
    assert api.post(_url(gid), json={"version": 1}).status_code == 200
    before = _charged(conn)
    assert before == 1                                             # non-vacuity
    _approve_a_revision(conn, gid)
    r = api.post(_url(gid), json={"version": 1})                   # the 409
    assert (r.status_code, r.json()["detail"]) == (409, gallery.LAYOUT_MOVED_SENTENCE)
    assert _charged(conn) == before
    r = api.post(_url("no-such-item"), json={"version": 1})        # the 404 (a None)
    assert r.status_code == 404
    assert _charged(conn) == before
    conn.execute("UPDATE j2_template_gallery SET payload_json = '{not json' WHERE id = ?", (gid,))
    conn.commit()
    r = api.post(_url(gid), json={"version": 2})                   # the 400 (unsupported)
    assert (r.status_code, r.json()["detail"]) == (400, gallery.LAYOUT_UNSUPPORTED_SENTENCE)
    assert _charged(conn) == before


def test_an_exception_in_adopt_layout_gives_the_day_back(api, conn, sharing_on, monkeypatch):
    gid = _listed_layout(conn)
    _as(api, "member")

    def boom(*a, **k):
        raise RuntimeError("boom")

    monkeypatch.setattr(gallery, "adopt_layout", boom)
    from fastapi.testclient import TestClient
    client = TestClient(api.app, raise_server_exceptions=False)
    assert client.post(_url(gid), json={"version": 1}).status_code == 500
    assert _charged(conn) in (None, 0)


# ── P4b-T6-R1: the preview is what adopt applies ───────────────────────────────────────────────────

def _store_drifted_today(conn, gid: str, column: str = "payload_json") -> list[dict]:
    """A stored today layout whose `market` list held only a panel that has since left the registry."""
    kept = [{"id": "regime", "shown": True}, {"id": "todayNote", "shown": False}]
    payload = {"page": "today", "lists": {"premarket": kept, "market": [{"id": "retiredPanel", "shown": True}],
                                          "postclose": kept}}
    if column == "payload_json":
        conn.execute("UPDATE j2_template_gallery SET payload_json = ? WHERE id = ?", (json.dumps(payload), gid))
    else:
        rev = {"title": "V2", "description": "", "category": "journal", "tradingStyle": "prop", "payload": payload}
        conn.execute("UPDATE j2_template_gallery SET pending_json = ? WHERE id = ?", (json.dumps(rev), gid))
    conn.commit()
    return kept


def test_the_preview_shows_exactly_the_lists_adopt_applies(conn, sharing_on):
    """P4b-T6-R1: a list registry drift has emptied is left out of GET /{id} (member and the reviewer's
    pendingRevision) exactly as adopt leaves it out. An empty list and an absent one mean different things to the
    client (X2: a missing panel is appended hidden), so a preview carrying `market: []` would not match the adopt."""
    gid = _listed_layout(conn)
    kept = _store_drifted_today(conn, gid)
    _store_drifted_today(conn, gid, column="pending_json")
    want = {"premarket": kept, "postclose": kept}
    adopted = gallery.adopt_layout("member", gid, version=1, conn=conn)["layout"]["lists"]
    member = gallery.get_item("member", gid, conn=conn)["payload"]["lists"]
    admin = gallery.get_item("admin", gid, is_admin=True, conn=conn)
    assert adopted == want
    assert member == adopted
    assert admin["payload"]["lists"] == adopted
    assert admin["pendingRevision"]["payload"]["lists"] == adopted
    assert "market" not in member and "market" not in admin["pendingRevision"]["payload"]["lists"]


def test_a_layout_drift_emptied_everywhere_reads_as_not_usable_never_as_an_empty_layout(conn, sharing_on):
    """P4b-T6-R1: when every list is gone, adopt refuses (LAYOUT_UNSUPPORTED_SENTENCE) and the read serves the same
    `payload: None` an unreadable layout gets, for the listed payload and for a held revision alike."""
    gid = _listed_layout(conn)
    gone = {"page": "today", "lists": {"premarket": [{"id": "retiredPanel", "shown": True}],
                                       "market": [{"id": "retiredPanel", "shown": True}]}}
    rev = {"title": "V2", "description": "", "category": "journal", "tradingStyle": "prop", "payload": gone}
    conn.execute("UPDATE j2_template_gallery SET payload_json = ?, pending_json = ? WHERE id = ?",
                 (json.dumps(gone), json.dumps(rev), gid))
    conn.commit()
    with pytest.raises(gallery.GalleryError) as e:
        gallery.adopt_layout("member", gid, version=1, conn=conn)
    assert str(e.value) == gallery.LAYOUT_UNSUPPORTED_SENTENCE
    assert gallery.get_item("member", gid, conn=conn)["payload"] is None
    admin = gallery.get_item("admin", gid, is_admin=True, conn=conn)
    assert admin["payload"] is None and admin["pendingRevision"]["payload"] is None
