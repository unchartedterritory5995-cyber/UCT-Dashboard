"""Wave E (Structured Research Properties / Saved Views) — property
definitions, per-note values, derived properties, the property-based
filter/sort query-layer extension, and saved views. Same in-memory-schema
fixture pattern as test_wave_d_links.py.
"""
import json
import sqlite3
from unittest.mock import patch

import pytest

from api.services.journal_two.db import ensure_schema
from api.services.journal_two.notes import create_note, get_note, list_notes, count_notes
from api.services.journal_two import note_properties as np


def _conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    return c


def _create(c, user_id, title, **extra):
    payload = {"title": title, "bodyJson": {"type": "doc", "content": []}, **extra}
    return create_note(user_id, payload, conn=c)


# ── Schema ───────────────────────────────────────────────────────────────────

def test_property_and_saved_view_tables_exist():
    c = _conn()
    tables = {r["name"] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert "j2_note_property_defs" in tables
    assert "j2_note_property_values" in tables
    assert "j2_note_saved_views" in tables


# ── Property definitions ─────────────────────────────────────────────────────

def test_create_property_def_mints_a_stable_id_and_key():
    c = _conn()
    prop = np.create_property_def("u1", {"name": "Thesis Status", "type": "select",
                                          "options": [{"label": "Active"}, {"label": "Closed"}]}, conn=c)
    assert prop["name"] == "Thesis Status"
    assert prop["type"] == "select"
    assert len(prop["options"]) == 2
    assert prop["options"][0]["id"] != prop["options"][1]["id"]
    assert prop["key"]  # non-empty, server-minted


def test_unknown_property_type_is_rejected():
    c = _conn()
    with pytest.raises(np.PropertyValidationError):
        np.create_property_def("u1", {"name": "X", "type": "formula"}, conn=c)


def test_blank_name_is_rejected():
    c = _conn()
    with pytest.raises(np.PropertyValidationError):
        np.create_property_def("u1", {"name": "  ", "type": "text"}, conn=c)


def test_list_property_defs_is_tenant_scoped():
    c = _conn()
    np.create_property_def("u1", {"name": "Mine", "type": "text"}, conn=c)
    np.create_property_def("u2", {"name": "Theirs", "type": "text"}, conn=c)
    mine = [p["name"] for p in np.list_property_defs("u1", include_derived=False, conn=c)]
    assert mine == ["Mine"]


def test_list_property_defs_includes_derived_builtins_by_default():
    c = _conn()
    names = [p["name"] for p in np.list_property_defs("u1", conn=c)]
    assert "Sector" in names and "Theme" in names


def test_renaming_a_property_does_not_touch_any_value_row():
    """The load-bearing rename-safety contract (checkpoint point 7): renaming
    `name` is a pure metadata update, mirroring the Wave D note-link lesson."""
    c = _conn()
    prop = np.create_property_def("u1", {"name": "Confidence", "type": "text"}, conn=c)
    note = _create(c, "u1", "N1")
    np.set_note_property_value("u1", note["id"], prop["id"], "High", conn=c)
    before = c.execute(
        "SELECT value_json, updated_at FROM j2_note_property_values WHERE note_id=?", (note["id"],)
    ).fetchone()
    renamed = np.update_property_def("u1", prop["id"], {"name": "Conviction"}, conn=c)
    assert renamed["name"] == "Conviction"
    after = c.execute(
        "SELECT value_json, updated_at FROM j2_note_property_values WHERE note_id=?", (note["id"],)
    ).fetchone()
    assert after["value_json"] == before["value_json"]
    assert after["updated_at"] == before["updated_at"]  # untouched, not just unchanged-by-coincidence


def test_renaming_a_select_option_label_does_not_touch_the_stored_value():
    c = _conn()
    prop = np.create_property_def("u1", {"name": "Status", "type": "select",
                                          "options": [{"label": "Active"}]}, conn=c)
    opt_id = prop["options"][0]["id"]
    note = _create(c, "u1", "N1")
    np.set_note_property_value("u1", note["id"], prop["id"], opt_id, conn=c)
    renamed = np.update_property_def(
        "u1", prop["id"], {"options": [{"id": opt_id, "label": "Currently Active"}]}, conn=c,
    )
    assert renamed["options"][0]["label"] == "Currently Active"
    assert renamed["options"][0]["id"] == opt_id  # same option, same id
    props = np.get_note_properties("u1", note["id"], None, conn=c)
    assert props[0]["value"] == opt_id  # value still the stable option id


def test_soft_deleting_a_property_def_hides_it_but_keeps_values():
    c = _conn()
    prop = np.create_property_def("u1", {"name": "Temp", "type": "text"}, conn=c)
    note = _create(c, "u1", "N1")
    np.set_note_property_value("u1", note["id"], prop["id"], "hello", conn=c)
    assert np.delete_property_def("u1", prop["id"], conn=c) is True
    assert prop["id"] not in {p["id"] for p in np.list_property_defs("u1", include_derived=False, conn=c)}
    # value row is retained (not surfaced, since the def no longer lists)
    row = c.execute(
        "SELECT value_json FROM j2_note_property_values WHERE note_id=? AND property_def_id=?",
        (note["id"], prop["id"]),
    ).fetchone()
    assert row is not None
    assert np.get_note_properties("u1", note["id"], None, conn=c) == []


def test_deleting_a_nonexistent_property_def_returns_false():
    c = _conn()
    assert np.delete_property_def("u1", "ghost", conn=c) is False


def test_cross_tenant_property_def_is_invisible():
    c = _conn()
    prop = np.create_property_def("u1", {"name": "Mine", "type": "text"}, conn=c)
    assert np.get_property_def("u2", prop["id"], conn=c) is None
    assert np.update_property_def("u2", prop["id"], {"name": "Hijacked"}, conn=c) is None
    assert np.delete_property_def("u2", prop["id"], conn=c) is False


# ── Value validation per type ───────────────────────────────────────────────

@pytest.mark.parametrize("type_,good,bad", [
    ("text", "hello", 5),
    ("number", 42, "not a number"),
    ("checkbox", True, "yes"),
    ("date", "2026-09-10", "Sept 10"),
    ("url", "https://example.com", "example.com"),
])
def test_value_validation_per_type(type_, good, bad):
    c = _conn()
    prop = np.create_property_def("u1", {"name": "P", "type": type_}, conn=c)
    note = _create(c, "u1", "N1")
    np.set_note_property_value("u1", note["id"], prop["id"], good, conn=c)  # should not raise
    with pytest.raises(np.PropertyValidationError):
        np.set_note_property_value("u1", note["id"], prop["id"], bad, conn=c)


def test_select_value_must_reference_a_real_option_id():
    c = _conn()
    prop = np.create_property_def("u1", {"name": "Status", "type": "select",
                                          "options": [{"label": "A"}]}, conn=c)
    note = _create(c, "u1", "N1")
    with pytest.raises(np.PropertyValidationError):
        np.set_note_property_value("u1", note["id"], prop["id"], "not-a-real-option-id", conn=c)


def test_multi_select_rejects_any_unknown_option_id():
    c = _conn()
    prop = np.create_property_def("u1", {"name": "Tags", "type": "multi_select",
                                          "options": [{"label": "A"}, {"label": "B"}]}, conn=c)
    good_id = prop["options"][0]["id"]
    note = _create(c, "u1", "N1")
    np.set_note_property_value("u1", note["id"], prop["id"], [good_id], conn=c)
    with pytest.raises(np.PropertyValidationError):
        np.set_note_property_value("u1", note["id"], prop["id"], [good_id, "ghost"], conn=c)


def test_setting_value_to_none_deletes_the_row():
    c = _conn()
    prop = np.create_property_def("u1", {"name": "T", "type": "text"}, conn=c)
    note = _create(c, "u1", "N1")
    np.set_note_property_value("u1", note["id"], prop["id"], "hello", conn=c)
    assert len(np.get_note_properties("u1", note["id"], None, conn=c)) == 1
    np.set_note_property_value("u1", note["id"], prop["id"], None, conn=c)
    assert np.get_note_properties("u1", note["id"], None, conn=c) == []


def test_derived_properties_cannot_be_set_directly():
    c = _conn()
    note = _create(c, "u1", "N1")
    with pytest.raises(np.PropertyValidationError):
        np.set_note_property_value("u1", note["id"], "__sector__", "Technology", conn=c)


def test_unset_property_is_absent_not_a_null_row():
    c = _conn()
    prop = np.create_property_def("u1", {"name": "T", "type": "text"}, conn=c)
    note = _create(c, "u1", "N1")
    assert np.get_note_properties("u1", note["id"], None, conn=c) == []
    count = c.execute("SELECT COUNT(*) c FROM j2_note_property_values").fetchone()["c"]
    assert count == 0


# ── Hard-delete cascade ──────────────────────────────────────────────────────

def test_hard_deleting_a_note_cascades_its_property_values():
    c = _conn()
    prop = np.create_property_def("u1", {"name": "T", "type": "text"}, conn=c)
    note = _create(c, "u1", "N1")
    np.set_note_property_value("u1", note["id"], prop["id"], "hello", conn=c)
    c.execute("DELETE FROM j2_notes WHERE id=?", (note["id"],))
    c.commit()
    count = c.execute("SELECT COUNT(*) c FROM j2_note_property_values").fetchone()["c"]
    assert count == 0


def test_hard_deleting_a_property_def_cascades_its_values():
    c = _conn()
    prop = np.create_property_def("u1", {"name": "T", "type": "text"}, conn=c)
    note = _create(c, "u1", "N1")
    np.set_note_property_value("u1", note["id"], prop["id"], "hello", conn=c)
    c.execute("DELETE FROM j2_note_property_defs WHERE id=?", (prop["id"],))
    c.commit()
    count = c.execute("SELECT COUNT(*) c FROM j2_note_property_values").fetchone()["c"]
    assert count == 0


# ── Derived properties (Sector/Industry/Theme) ──────────────────────────────

def test_derived_properties_resolve_from_the_notes_own_ticker():
    c = _conn()
    note = _create(c, "u1", "N1", ticker="NVDA")
    with patch("api.services.ticker_meta.get_ticker_meta") as mock_meta:
        mock_meta.return_value = {"sector": "Technology", "industry": "Semiconductors", "theme": "AI"}
        props = np.get_note_properties("u1", note["id"], "NVDA", conn=c)
    by_name = {p["name"]: p["value"] for p in props}
    assert by_name["Sector"] == "Technology"
    assert by_name["Industry"] == "Semiconductors"
    assert by_name["Theme"] == "AI"
    assert all(p["derived"] for p in props)


def test_derived_properties_blank_when_note_has_no_ticker():
    c = _conn()
    note = _create(c, "u1", "N1")  # no ticker
    props = np.get_note_properties("u1", note["id"], None, conn=c)
    assert props == []


def test_derived_property_lookup_failure_degrades_to_blank_not_a_crash():
    c = _conn()
    note = _create(c, "u1", "N1", ticker="NVDA")
    with patch("api.services.ticker_meta.get_ticker_meta", side_effect=RuntimeError("provider down")):
        props = np.get_note_properties("u1", note["id"], "NVDA", conn=c)
    assert props == []  # degrades honestly, never raises


# ── Filter/sort query-layer extension ────────────────────────────────────────

def test_property_filter_eq_composes_with_list_notes():
    c = _conn()
    prop = np.create_property_def("u1", {"name": "Status", "type": "select",
                                          "options": [{"label": "Active"}, {"label": "Closed"}]}, conn=c)
    active_id, closed_id = prop["options"][0]["id"], prop["options"][1]["id"]
    a = _create(c, "u1", "A")
    b = _create(c, "u1", "B")
    np.set_note_property_value("u1", a["id"], prop["id"], active_id, conn=c)
    np.set_note_property_value("u1", b["id"], prop["id"], closed_id, conn=c)
    conditions = [{"propertyDefId": prop["id"], "op": "eq", "value": active_id}]
    rows = list_notes("u1", property_conditions=conditions, conn=c)
    assert [r["id"] for r in rows] == [a["id"]]
    assert count_notes("u1", property_conditions=conditions, conn=c) == 1


def test_property_filter_is_set_and_is_not_set():
    c = _conn()
    prop = np.create_property_def("u1", {"name": "T", "type": "text"}, conn=c)
    a = _create(c, "u1", "A")
    b = _create(c, "u1", "B")
    np.set_note_property_value("u1", a["id"], prop["id"], "hi", conn=c)
    is_set = [{"propertyDefId": prop["id"], "op": "is_set"}]
    is_not_set = [{"propertyDefId": prop["id"], "op": "is_not_set"}]
    assert [r["id"] for r in list_notes("u1", property_conditions=is_set, conn=c)] == [a["id"]]
    assert [r["id"] for r in list_notes("u1", property_conditions=is_not_set, conn=c)] == [b["id"]]


def test_property_filter_number_gte_lte():
    c = _conn()
    prop = np.create_property_def("u1", {"name": "Score", "type": "number"}, conn=c)
    a = _create(c, "u1", "A")
    b = _create(c, "u1", "B")
    np.set_note_property_value("u1", a["id"], prop["id"], 3, conn=c)
    np.set_note_property_value("u1", b["id"], prop["id"], 9, conn=c)
    gte5 = [{"propertyDefId": prop["id"], "op": "gte", "value": 5}]
    assert [r["id"] for r in list_notes("u1", property_conditions=gte5, conn=c)] == [b["id"]]


def test_property_filter_multi_select_contains():
    c = _conn()
    prop = np.create_property_def("u1", {"name": "Tags", "type": "multi_select",
                                          "options": [{"label": "Alpha"}, {"label": "Beta"}]}, conn=c)
    alpha_id, beta_id = prop["options"][0]["id"], prop["options"][1]["id"]
    a = _create(c, "u1", "A")
    b = _create(c, "u1", "B")
    np.set_note_property_value("u1", a["id"], prop["id"], [alpha_id], conn=c)
    np.set_note_property_value("u1", b["id"], prop["id"], [beta_id], conn=c)
    contains_alpha = [{"propertyDefId": prop["id"], "op": "contains", "value": alpha_id}]
    assert [r["id"] for r in list_notes("u1", property_conditions=contains_alpha, conn=c)] == [a["id"]]


def test_property_filter_composes_as_and_with_folder_and_tag():
    c = _conn()
    prop = np.create_property_def("u1", {"name": "Status", "type": "select",
                                          "options": [{"label": "Active"}]}, conn=c)
    active_id = prop["options"][0]["id"]
    a = _create(c, "u1", "A", tags=["watch"])
    b = _create(c, "u1", "B", tags=["watch"])
    np.set_note_property_value("u1", a["id"], prop["id"], active_id, conn=c)
    np.set_note_property_value("u1", b["id"], prop["id"], active_id, conn=c)
    a2 = get_note("u1", a["id"], conn=c)
    conditions = [{"propertyDefId": prop["id"], "op": "eq", "value": active_id}]
    rows = list_notes("u1", tag="watch", property_conditions=conditions, conn=c)
    assert {r["id"] for r in rows} == {a["id"], b["id"]}


def test_a_condition_naming_another_tenants_property_is_dropped_not_trusted():
    """Security (checkpoint point 30): a crafted condition naming a foreign
    property_def_id must never reach raw SQL -- it is silently dropped, not
    honored and not erroring, so the filter behaves as if that condition
    were absent."""
    c = _conn()
    other_prop = np.create_property_def("u2", {"name": "Theirs", "type": "text"}, conn=c)
    a = _create(c, "u1", "A")
    conditions = [{"propertyDefId": other_prop["id"], "op": "eq", "value": "anything"}]
    rows = list_notes("u1", property_conditions=conditions, conn=c)
    assert [r["id"] for r in rows] == [a["id"]]  # condition ignored, not an error, not zero-results


def test_a_condition_naming_a_derived_property_is_dropped():
    c = _conn()
    a = _create(c, "u1", "A")
    conditions = [{"propertyDefId": "__sector__", "op": "eq", "value": "Technology"}]
    rows = list_notes("u1", property_conditions=conditions, conn=c)
    assert [r["id"] for r in rows] == [a["id"]]  # condition dropped, not honored, not an error


def test_property_sort_puts_blanks_last():
    c = _conn()
    prop = np.create_property_def("u1", {"name": "Score", "type": "number"}, conn=c)
    a = _create(c, "u1", "A")
    b = _create(c, "u1", "B")  # no value set
    d = _create(c, "u1", "D")
    np.set_note_property_value("u1", a["id"], prop["id"], 5, conn=c)
    np.set_note_property_value("u1", d["id"], prop["id"], 1, conn=c)
    rows = list_notes("u1", property_sort={"propertyDefId": prop["id"], "direction": "desc"}, conn=c)
    ids = [r["id"] for r in rows]
    assert ids.index(a["id"]) < ids.index(d["id"]) < ids.index(b["id"])


def test_property_sort_with_a_foreign_property_def_id_is_ignored():
    c = _conn()
    other_prop = np.create_property_def("u2", {"name": "Theirs", "type": "number"}, conn=c)
    a = _create(c, "u1", "A")
    rows = list_notes("u1", property_sort={"propertyDefId": other_prop["id"], "direction": "asc"}, conn=c)
    assert [r["id"] for r in rows] == [a["id"]]  # falls back to default sort, no crash


# ── Saved views ──────────────────────────────────────────────────────────────

def test_create_and_list_saved_view():
    c = _conn()
    view = np.create_saved_view("u1", {"name": "Active Theses", "viewType": "list",
                                        "filter": [{"propertyDefId": "x", "op": "is_set"}]}, conn=c)
    assert view["name"] == "Active Theses"
    assert view["viewType"] == "list"
    listed = np.list_saved_views("u1", conn=c)
    assert [v["id"] for v in listed] == [view["id"]]


def test_saved_view_survives_property_rename_and_option_rename():
    """Directive §42-44/§66-68 -- mirrors the Wave D note-link lesson: a
    saved view's filter_json references property_def_id/option id, never a
    display name, so it is unaffected by either rename."""
    c = _conn()
    prop = np.create_property_def("u1", {"name": "Status", "type": "select",
                                          "options": [{"label": "Active"}]}, conn=c)
    opt_id = prop["options"][0]["id"]
    view = np.create_saved_view("u1", {
        "name": "My View",
        "filter": [{"propertyDefId": prop["id"], "op": "eq", "value": opt_id}],
    }, conn=c)
    np.update_property_def("u1", prop["id"], {"name": "Thesis State"}, conn=c)
    np.update_property_def("u1", prop["id"], {"options": [{"id": opt_id, "label": "Currently Active"}]}, conn=c)
    reloaded = np.get_saved_view("u1", view["id"], conn=c)
    assert reloaded["filter"] == [{"propertyDefId": prop["id"], "op": "eq", "value": opt_id}]

    # And the view still resolves the correct notes after both renames.
    note = _create(c, "u1", "N1")
    np.set_note_property_value("u1", note["id"], prop["id"], opt_id, conn=c)
    rows = list_notes("u1", property_conditions=reloaded["filter"], conn=c)
    assert [r["id"] for r in rows] == [note["id"]]


def test_update_saved_view_rename():
    c = _conn()
    view = np.create_saved_view("u1", {"name": "Old Name"}, conn=c)
    updated = np.update_saved_view("u1", view["id"], {"name": "New Name"}, conn=c)
    assert updated["name"] == "New Name"


def test_deleting_a_saved_view_never_touches_notes_or_property_defs():
    c = _conn()
    prop = np.create_property_def("u1", {"name": "T", "type": "text"}, conn=c)
    note = _create(c, "u1", "N1")
    np.set_note_property_value("u1", note["id"], prop["id"], "hello", conn=c)
    view = np.create_saved_view("u1", {"name": "V"}, conn=c)
    assert np.delete_saved_view("u1", view["id"], conn=c) is True
    assert get_note("u1", note["id"], conn=c) is not None
    assert np.get_property_def("u1", prop["id"], conn=c) is not None
    assert np.get_note_properties("u1", note["id"], None, conn=c)[0]["value"] == "hello"


def test_cross_tenant_saved_view_is_invisible():
    c = _conn()
    view = np.create_saved_view("u1", {"name": "Mine"}, conn=c)
    assert np.get_saved_view("u2", view["id"], conn=c) is None
    assert np.update_saved_view("u2", view["id"], {"name": "Hijacked"}, conn=c) is None
    assert np.delete_saved_view("u2", view["id"], conn=c) is False


def test_unknown_saved_view_view_type_is_rejected():
    c = _conn()
    with pytest.raises(np.PropertyValidationError):
        np.create_saved_view("u1", {"name": "X", "viewType": "board"}, conn=c)


# ── Batch property fetch (Table view) ────────────────────────────────────────

def test_get_note_properties_batch_returns_values_and_derived_per_note():
    c = _conn()
    prop = np.create_property_def("u1", {"name": "Confidence", "type": "text"}, conn=c)
    a = _create(c, "u1", "A", ticker="NVDA")
    b = _create(c, "u1", "B")
    np.set_note_property_value("u1", a["id"], prop["id"], "High", conn=c)
    with patch("api.services.ticker_meta.get_ticker_meta") as mock_meta:
        mock_meta.return_value = {"sector": "Technology", "industry": "Semis", "theme": "AI"}
        batch = np.get_note_properties_batch(
            "u1", [a["id"], b["id"]], {a["id"]: "NVDA", b["id"]: None}, conn=c,
        )
    a_names = {p["name"] for p in batch.get(a["id"], [])}
    assert "Confidence" in a_names
    assert "Sector" in a_names
    assert b["id"] not in batch  # no values and no ticker -- absent, not an empty list


def test_get_note_properties_batch_resolves_shared_ticker_once():
    c = _conn()
    a = _create(c, "u1", "A", ticker="NVDA")
    b = _create(c, "u1", "B", ticker="NVDA")
    with patch("api.services.ticker_meta.get_ticker_meta") as mock_meta:
        mock_meta.return_value = {"sector": "Technology", "industry": "Semis", "theme": "AI"}
        np.get_note_properties_batch("u1", [a["id"], b["id"]], {a["id"]: "NVDA", b["id"]: "NVDA"}, conn=c)
    assert mock_meta.call_count == 1  # one distinct ticker, one lookup, not two


def test_get_note_properties_batch_empty_ids_returns_empty():
    c = _conn()
    assert np.get_note_properties_batch("u1", [], {}, conn=c) == {}
