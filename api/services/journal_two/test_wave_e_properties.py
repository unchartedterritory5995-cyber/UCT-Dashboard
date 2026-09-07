"""Wave E (Structured Research Properties / Saved Views) — property
definitions, per-note values, financial-derived resolution, rename/delete
safety, and Wave C version-history integration.
"""
from __future__ import annotations

import sqlite3

import pytest

from api.services.journal_two.db import ensure_schema
from api.services.journal_two.notes import (
    create_note, get_note, get_note_version, list_note_versions,
    restore_note_version, update_note, NoteValidationError,
)
from api.services.journal_two import note_properties as props


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    yield c
    c.close()


def _create(c, user_id, title, **extra):
    return create_note(user_id, {"title": title, "bodyJson": {"type": "doc", "content": []}, **extra}, conn=c)


# ── Built-in properties ─────────────────────────────────────────────────────

def test_builtin_properties_are_not_db_rows(conn):
    defs = props.list_property_defs("u1", conn=conn)
    ids = {d["id"] for d in defs}
    assert "builtin:thesis_status" in ids
    assert "builtin:ticker" in ids
    row = conn.execute("SELECT COUNT(*) c FROM j2_note_properties").fetchone()
    assert row["c"] == 0  # nothing persisted for built-ins


def test_builtin_properties_cannot_be_renamed_or_deleted(conn):
    with pytest.raises(props.PropertyValidationError):
        props.update_property_def("u1", "builtin:thesis_status", name="Renamed", conn=conn)
    with pytest.raises(props.PropertyValidationError):
        props.delete_property_def("u1", "builtin:thesis_status", conn=conn)


def test_setting_a_builtin_derived_property_directly_is_rejected(conn):
    note = _create(conn, "u1", "N")
    with pytest.raises(props.PropertyValidationError):
        props.set_note_properties("u1", note["id"], {"builtin:ticker": "NVDA"}, conn)


# ── User-defined property CRUD ──────────────────────────────────────────────

def test_create_list_a_custom_select_property(conn):
    d = props.create_property_def(
        "u1", "Risk Level", "select",
        options=[{"label": "Low"}, {"label": "High"}], conn=conn,
    )
    assert d["type"] == "select"
    assert [o["label"] for o in d["options"]] == ["Low", "High"]
    defs = props.list_property_defs("u1", conn=conn)
    assert any(x["id"] == d["id"] and x["name"] == "Risk Level" for x in defs)


def test_create_property_rejects_blank_name_and_bad_type(conn):
    with pytest.raises(props.PropertyValidationError):
        props.create_property_def("u1", "  ", "text", conn=conn)
    with pytest.raises(props.PropertyValidationError):
        props.create_property_def("u1", "X", "not_a_type", conn=conn)


def test_rename_property_touches_only_the_definition_row_never_note_values(conn):
    d = props.create_property_def("u1", "Setup Quality", "text", conn=conn)
    note = _create(conn, "u1", "N")
    update_note("u1", note["id"], {"properties": {d["id"]: "A+"}}, conn=conn)

    renamed = props.update_property_def("u1", d["id"], name="Setup Grade", conn=conn)
    assert renamed["name"] == "Setup Grade"

    reloaded = get_note("u1", note["id"], conn=conn)
    assert reloaded["propertiesJson"][d["id"]] == "A+"  # value untouched by the rename


def test_rename_select_option_preserves_stored_option_id(conn):
    d = props.create_property_def(
        "u1", "Thesis Health", "select", options=[{"label": "Weak"}, {"label": "Strong"}], conn=conn,
    )
    weak_id = d["options"][0]["id"]
    note = _create(conn, "u1", "N")
    update_note("u1", note["id"], {"properties": {d["id"]: weak_id}}, conn=conn)

    updated = props.update_property_def(
        "u1", d["id"],
        options=[{"id": weak_id, "label": "Fragile"}, {"id": d["options"][1]["id"], "label": "Strong"}],
        conn=conn,
    )
    assert {o["id"]: o["label"] for o in updated["options"]}[weak_id] == "Fragile"

    reloaded = get_note("u1", note["id"], conn=conn)
    assert reloaded["propertiesJson"][d["id"]] == weak_id  # still resolves via the SAME id


def test_deleting_a_property_never_deletes_the_note_or_its_other_values(conn):
    a = props.create_property_def("u1", "A", "text", conn=conn)
    b = props.create_property_def("u1", "B", "text", conn=conn)
    note = _create(conn, "u1", "N")
    update_note("u1", note["id"], {"properties": {a["id"]: "x", b["id"]: "y"}}, conn=conn)

    assert props.delete_property_def("u1", a["id"], conn=conn) is True

    reloaded = get_note("u1", note["id"], conn=conn)
    assert reloaded is not None  # note itself survives
    assert reloaded["propertiesJson"][b["id"]] == "y"  # sibling value survives
    assert a["id"] not in [d["id"] for d in props.list_property_defs("u1", conn=conn)]  # def hidden


def test_delete_is_idempotent_and_tenant_scoped(conn):
    d = props.create_property_def("u1", "X", "text", conn=conn)
    assert props.delete_property_def("u1", d["id"], conn=conn) is True
    assert props.delete_property_def("u1", d["id"], conn=conn) is False  # already gone
    d2 = props.create_property_def("u2", "Y", "text", conn=conn)
    assert props.delete_property_def("u1", d2["id"], conn=conn) is False  # foreign tenant


# ── Value validation ─────────────────────────────────────────────────────────

def test_number_property_rejects_a_non_numeric_value(conn):
    d = props.create_property_def("u1", "Position Size %", "number", conn=conn)
    note = _create(conn, "u1", "N")
    with pytest.raises(NoteValidationError):
        update_note("u1", note["id"], {"properties": {d["id"]: "not a number"}}, conn=conn)


def test_select_property_rejects_an_unknown_option_id(conn):
    d = props.create_property_def("u1", "Status", "select", options=[{"label": "Open"}], conn=conn)
    note = _create(conn, "u1", "N")
    with pytest.raises(NoteValidationError):
        update_note("u1", note["id"], {"properties": {d["id"]: "not-a-real-option-id"}}, conn=conn)


def test_setting_a_value_to_null_clears_it(conn):
    d = props.create_property_def("u1", "Note", "text", conn=conn)
    note = _create(conn, "u1", "N")
    update_note("u1", note["id"], {"properties": {d["id"]: "hello"}}, conn=conn)
    update_note("u1", note["id"], {"properties": {d["id"]: None}}, conn=conn)
    reloaded = get_note("u1", note["id"], conn=conn)
    assert d["id"] not in reloaded["propertiesJson"]


def test_a_property_edit_never_touches_a_sibling_property_merge_semantics(conn):
    a = props.create_property_def("u1", "A", "text", conn=conn)
    b = props.create_property_def("u1", "B", "text", conn=conn)
    note = _create(conn, "u1", "N")
    update_note("u1", note["id"], {"properties": {a["id"]: "1"}}, conn=conn)
    update_note("u1", note["id"], {"properties": {b["id"]: "2"}}, conn=conn)
    reloaded = get_note("u1", note["id"], conn=conn)
    assert reloaded["propertiesJson"] == {a["id"]: "1", b["id"]: "2"}


# ── Financial-derived resolution ────────────────────────────────────────────

def test_resolve_note_properties_includes_ticker_when_set(conn, monkeypatch):
    monkeypatch.setattr(
        "api.services.ticker_meta.get_ticker_meta",
        lambda sym: {"sector": "Technology", "industry": "Semiconductors", "theme": "AI Infrastructure"},
    )
    note = _create(conn, "u1", "N", ticker="NVDA")
    reloaded = get_note("u1", note["id"], conn=conn)
    resolved = {r["id"]: r["value"] for r in props.resolve_note_properties("u1", reloaded, conn)}
    assert resolved["builtin:ticker"] == "NVDA"
    assert resolved["builtin:sector"] == "Technology"
    assert resolved["builtin:theme"] == "AI Infrastructure"


def test_resolve_note_properties_omits_derived_values_with_no_ticker(conn):
    note = _create(conn, "u1", "N")
    reloaded = get_note("u1", note["id"], conn=conn)
    resolved = {r["id"]: r["value"] for r in props.resolve_note_properties("u1", reloaded, conn)}
    assert resolved["builtin:ticker"] is None


def test_a_provider_failure_degrades_to_not_set_never_raises(conn, monkeypatch):
    def _boom(sym):
        raise RuntimeError("provider down")
    monkeypatch.setattr("api.services.ticker_meta.get_ticker_meta", _boom)
    note = _create(conn, "u1", "N", ticker="NVDA")
    reloaded = get_note("u1", note["id"], conn=conn)
    resolved = {r["id"]: r["value"] for r in props.resolve_note_properties("u1", reloaded, conn)}
    assert resolved["builtin:ticker"] == "NVDA"  # the note's own field still resolves
    assert resolved.get("builtin:sector") is None  # the failed lookup degrades quietly


# ── Wave C version-history integration ──────────────────────────────────────

def test_a_property_change_captures_a_version_after_the_coalescing_window(conn, monkeypatch):
    import api.services.journal_two.notes as notes_mod
    monkeypatch.setattr(notes_mod, "J2_VERSION_COALESCE_MINUTES", 0)
    d = props.create_property_def("u1", "Confidence Note", "text", conn=conn)
    note = _create(conn, "u1", "N")
    update_note("u1", note["id"], {"properties": {d["id"]: "first"}}, conn=conn)
    update_note("u1", note["id"], {"properties": {d["id"]: "second"}}, conn=conn)
    versions = list_note_versions("u1", note["id"], conn=conn)
    assert len(versions) >= 1
    v = get_note_version("u1", note["id"], versions[-1]["id"], conn=conn)
    assert v["propertiesJson"] is None  # pre-first-property-set snapshot: nothing captured


def test_restoring_an_old_version_replaces_not_merges_properties(conn, monkeypatch):
    # _maybe_capture_version always snapshots the PRE-edit state, so the
    # version capturing {a: old} isn't created until the NEXT edit after it
    # (list_note_versions is newest-first -- that's versions[0] below).
    import api.services.journal_two.notes as notes_mod
    monkeypatch.setattr(notes_mod, "J2_VERSION_COALESCE_MINUTES", 0)
    a = props.create_property_def("u1", "A", "text", conn=conn)
    b = props.create_property_def("u1", "B", "text", conn=conn)
    note = _create(conn, "u1", "N")
    update_note("u1", note["id"], {"properties": {a["id"]: "old"}}, conn=conn)
    update_note("u1", note["id"], {"properties": {b["id"]: "new-only"}}, conn=conn)
    versions = list_note_versions("u1", note["id"], conn=conn)
    assert len(versions) >= 2

    restored = restore_note_version("u1", note["id"], versions[0]["id"], conn=conn)
    assert restored["propertiesJson"].get(a["id"]) == "old"
    assert b["id"] not in restored["propertiesJson"]  # replaced, not merged


def test_a_metadata_only_save_never_creates_a_spurious_version_for_properties(conn):
    d = props.create_property_def("u1", "X", "text", conn=conn)
    note = _create(conn, "u1", "N")
    update_note("u1", note["id"], {"ticker": "AAPL"}, conn=conn)  # no properties key at all
    assert list_note_versions("u1", note["id"], conn=conn) == []


# ── Saved views ──────────────────────────────────────────────────────────────

def test_create_and_list_saved_views(conn):
    v = props.create_saved_view("u1", "Active Theses", "table", {"propertyFilter": []}, conn=conn)
    assert v["name"] == "Active Theses"
    assert v["viewType"] == "table"
    listed = props.list_saved_views("u1", conn=conn)
    assert len(listed) == 1 and listed[0]["id"] == v["id"]


def test_saved_view_survives_a_property_rename(conn):
    d = props.create_property_def("u1", "Thesis Health", "select", options=[{"label": "Strong"}], conn=conn)
    spec = {"propertyFilter": [{"propertyId": d["id"], "op": "eq", "value": d["options"][0]["id"]}]}
    v = props.create_saved_view("u1", "Strong Theses", "list", spec, conn=conn)
    props.update_property_def("u1", d["id"], name="Conviction", conn=conn)
    reloaded = props.get_saved_view("u1", v["id"], conn=conn)
    assert reloaded["spec"] == spec  # untouched -- keyed by id, not name


def test_deleting_a_saved_view_is_soft_and_tenant_scoped(conn):
    v = props.create_saved_view("u1", "V", "list", {}, conn=conn)
    assert props.delete_saved_view("u2", v["id"], conn=conn) is False
    assert props.delete_saved_view("u1", v["id"], conn=conn) is True
    assert props.list_saved_views("u1", conn=conn) == []


# ── Tenant isolation ─────────────────────────────────────────────────────────

def test_property_defs_are_tenant_isolated(conn):
    props.create_property_def("u1", "Mine", "text", conn=conn)
    props.create_property_def("u2", "Theirs", "text", conn=conn)
    names_u1 = {d["name"] for d in props.list_property_defs("u1", conn=conn) if not props.is_builtin_property_id(d["id"])}
    assert names_u1 == {"Mine"}
