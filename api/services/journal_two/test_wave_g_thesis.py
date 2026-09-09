"""Wave G — Thesis Intelligence (evidence) + Thesis Changelog tests. Backend
unit level, mirroring test_wave_f_facts.py's conn-fixture pattern."""
from __future__ import annotations

import sqlite3

import pytest

from api.services.journal_two.db import ensure_schema
from api.services.journal_two.notes import (
    create_note, update_note, restore_note_version, list_note_versions,
)
from api.services.journal_two import thesis_evidence as ev
from api.services.journal_two import thesis_changelog as changelog
from api.services.journal_two import note_facts as facts


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    yield c
    c.close()


@pytest.fixture(autouse=True)
def _no_real_entity_master(monkeypatch):
    from api.services.entity_master import api as entity_master

    def _fake_resolve(alias, as_of=None, **kw):
        return entity_master.ResolveResult(status="not_found")
    monkeypatch.setattr(entity_master, "resolve", _fake_resolve)


def _create(c, user_id, title="A note", **extra):
    return create_note(user_id, {"title": title, "bodyJson": {"type": "doc", "content": []}, **extra}, conn=c)


# ── Evidence CRUD ────────────────────────────────────────────────────────────

def test_add_evidence_pointing_to_another_note(conn):
    thesis = _create(conn, "u1", "My NVDA thesis")
    source = _create(conn, "u1", "Some research note")
    e = ev.add_evidence(
        "u1", thesis["id"], target_type="note", target_id=source["id"],
        stance="supports", caption="strong datacenter growth", conn=conn,
    )
    assert e["targetType"] == "note"
    assert e["targetId"] == source["id"]
    assert e["stance"] == "supports"
    assert e["removedAt"] is None


def test_add_evidence_pointing_to_a_fact(conn):
    thesis = _create(conn, "u1", "My NVDA thesis")
    fact = facts.create_fact_observation(
        "u1", thesis["id"], ticker="NVDA", fact_type="price", value=142.83, conn=conn,
    )
    e = ev.add_evidence(
        "u1", thesis["id"], target_type="fact", target_id=fact["id"],
        stance="opposes", conn=conn,
    )
    assert e["targetType"] == "fact"
    assert e["stance"] == "opposes"


def test_unknown_target_type_rejected(conn):
    thesis = _create(conn, "u1")
    with pytest.raises(ev.ThesisEvidenceValidationError):
        ev.add_evidence("u1", thesis["id"], target_type="widget", target_id="x", stance="supports", conn=conn)


def test_unknown_stance_rejected(conn):
    thesis = _create(conn, "u1")
    other = _create(conn, "u1")
    with pytest.raises(ev.ThesisEvidenceValidationError):
        ev.add_evidence("u1", thesis["id"], target_type="note", target_id=other["id"], stance="neutral", conn=conn)


def test_evidence_on_a_nonexistent_thesis_note_rejected(conn):
    other = _create(conn, "u1")
    with pytest.raises(ev.ThesisEvidenceValidationError):
        ev.add_evidence("u1", "not-a-real-note", target_type="note", target_id=other["id"], stance="supports", conn=conn)


def test_evidence_pointing_at_a_nonexistent_target_rejected(conn):
    thesis = _create(conn, "u1")
    with pytest.raises(ev.ThesisEvidenceValidationError):
        ev.add_evidence("u1", thesis["id"], target_type="note", target_id="not-a-real-note", stance="supports", conn=conn)


def test_list_note_evidence_excludes_removed_by_default(conn):
    thesis = _create(conn, "u1")
    other = _create(conn, "u1")
    e = ev.add_evidence("u1", thesis["id"], target_type="note", target_id=other["id"], stance="supports", conn=conn)
    ev.remove_evidence("u1", e["id"], conn=conn)
    assert ev.list_note_evidence("u1", thesis["id"], conn=conn) == []
    assert len(ev.list_note_evidence("u1", thesis["id"], include_removed=True, conn=conn)) == 1


def test_remove_evidence_is_soft_delete(conn):
    thesis = _create(conn, "u1")
    other = _create(conn, "u1")
    e = ev.add_evidence("u1", thesis["id"], target_type="note", target_id=other["id"], stance="supports", conn=conn)
    removed = ev.remove_evidence("u1", e["id"], conn=conn)
    assert removed["removedAt"] is not None
    row = conn.execute("SELECT * FROM j2_thesis_evidence WHERE id = ?", (e["id"],)).fetchone()
    assert row is not None  # still present, not hard-deleted


def test_removing_already_removed_evidence_returns_none(conn):
    thesis = _create(conn, "u1")
    other = _create(conn, "u1")
    e = ev.add_evidence("u1", thesis["id"], target_type="note", target_id=other["id"], stance="supports", conn=conn)
    ev.remove_evidence("u1", e["id"], conn=conn)
    assert ev.remove_evidence("u1", e["id"], conn=conn) is None


def test_hard_deleting_the_thesis_note_cascades_its_evidence(conn):
    thesis = _create(conn, "u1")
    other = _create(conn, "u1")
    ev.add_evidence("u1", thesis["id"], target_type="note", target_id=other["id"], stance="supports", conn=conn)
    conn.execute("DELETE FROM j2_notes WHERE id = ?", (thesis["id"],))
    row = conn.execute("SELECT * FROM j2_thesis_evidence WHERE note_id = ?", (thesis["id"],)).fetchone()
    assert row is None


# ── Tenant isolation ─────────────────────────────────────────────────────────

def test_cannot_add_evidence_targeting_another_users_note(conn):
    thesis = _create(conn, "u1")
    foreign = _create(conn, "u2", "u2's private note")
    with pytest.raises(ev.ThesisEvidenceValidationError):
        ev.add_evidence("u1", thesis["id"], target_type="note", target_id=foreign["id"], stance="supports", conn=conn)


def test_cannot_add_evidence_to_another_users_thesis_note(conn):
    foreign_thesis = _create(conn, "u2")
    own = _create(conn, "u1")
    with pytest.raises(ev.ThesisEvidenceValidationError):
        ev.add_evidence("u1", foreign_thesis["id"], target_type="note", target_id=own["id"], stance="supports", conn=conn)


def test_cannot_remove_another_users_evidence(conn):
    thesis = _create(conn, "u1")
    other = _create(conn, "u1")
    e = ev.add_evidence("u1", thesis["id"], target_type="note", target_id=other["id"], stance="supports", conn=conn)
    assert ev.remove_evidence("u2", e["id"], conn=conn) is None


# ── Changelog: property_changed / thesis_edited ────────────────────────────

def test_property_change_produces_a_changelog_event(conn, monkeypatch):
    import api.services.journal_two.notes as notes_mod
    monkeypatch.setattr(notes_mod, "J2_VERSION_COALESCE_MINUTES", 0)
    thesis = _create(conn, "u1")
    update_note("u1", thesis["id"], {"properties": {"builtin:thesis_status": "watching"}}, conn=conn)
    update_note("u1", thesis["id"], {"properties": {"builtin:thesis_status": "active"}}, conn=conn)
    events = changelog.get_thesis_changelog("u1", thesis["id"], conn=conn)
    prop_events = [e for e in events if e["type"] == "property_changed" and e["propertyId"] == "builtin:thesis_status"]
    assert len(prop_events) >= 1
    assert prop_events[0]["to"] == "active"


def test_a_custom_property_change_is_not_surfaced_in_the_changelog(conn, monkeypatch):
    # v1 scope is deliberately narrow (checkpoint decision 46/§35): only the
    # four builtin user-set thesis properties are tracked events.
    import api.services.journal_two.notes as notes_mod
    from api.services.journal_two import note_properties as props
    monkeypatch.setattr(notes_mod, "J2_VERSION_COALESCE_MINUTES", 0)
    d = props.create_property_def("u1", "Custom Field", "text", conn=conn)
    thesis = _create(conn, "u1")
    update_note("u1", thesis["id"], {"properties": {d["id"]: "first"}}, conn=conn)
    update_note("u1", thesis["id"], {"properties": {d["id"]: "second"}}, conn=conn)
    events = changelog.get_thesis_changelog("u1", thesis["id"], conn=conn)
    assert not [e for e in events if e["type"] == "property_changed"]


def test_ticker_change_never_produces_a_property_changed_event(conn, monkeypatch):
    # builtin:ticker/sector/industry/theme/trade_ref are financial_derived
    # (live-computed, never stored in properties_json) -- checkpoint §32's
    # central concern, verified here structurally rather than assumed.
    import api.services.journal_two.notes as notes_mod
    monkeypatch.setattr(notes_mod, "J2_VERSION_COALESCE_MINUTES", 0)
    thesis = _create(conn, "u1", ticker="AAPL")
    update_note("u1", thesis["id"], {"ticker": "NVDA"}, conn=conn)
    update_note("u1", thesis["id"], {"ticker": "MSFT"}, conn=conn)
    events = changelog.get_thesis_changelog("u1", thesis["id"], conn=conn)
    assert not [e for e in events if e["type"] == "property_changed"]


def test_body_edit_produces_a_thesis_edited_event(conn, monkeypatch):
    import api.services.journal_two.notes as notes_mod
    monkeypatch.setattr(notes_mod, "J2_VERSION_COALESCE_MINUTES", 0)
    thesis = _create(conn, "u1")
    update_note("u1", thesis["id"], {"title": "Updated title"}, conn=conn)
    update_note("u1", thesis["id"], {"title": "Updated again"}, conn=conn)
    events = changelog.get_thesis_changelog("u1", thesis["id"], conn=conn)
    assert any(e["type"] == "thesis_edited" for e in events)


def test_restoring_a_version_produces_a_distinct_restored_event_not_a_generic_edit(conn, monkeypatch):
    import api.services.journal_two.notes as notes_mod
    monkeypatch.setattr(notes_mod, "J2_VERSION_COALESCE_MINUTES", 0)
    thesis = _create(conn, "u1", "Original title")
    update_note("u1", thesis["id"], {"title": "Second title"}, conn=conn)
    update_note("u1", thesis["id"], {"title": "Third title"}, conn=conn)
    versions = list_note_versions("u1", thesis["id"], conn=conn)
    target_version_id = versions[-1]["id"]  # the oldest captured checkpoint

    restore_note_version("u1", thesis["id"], target_version_id, conn=conn)

    events = changelog.get_thesis_changelog("u1", thesis["id"], conn=conn)
    restored_events = [e for e in events if e["type"] == "restored"]
    assert len(restored_events) == 1
    assert restored_events[0]["restoredFromVersionId"] == target_version_id
    # The restore's own content transition must NOT ALSO appear as a
    # generic thesis_edited event -- it would double-report one action.
    edited_at_restore_time = [e for e in events if e["type"] == "thesis_edited" and e["at"] == restored_events[0]["at"]]
    assert edited_at_restore_time == []


# ── Changelog: evidence / facts / trades ────────────────────────────────────

def test_evidence_added_and_removed_produce_changelog_events(conn):
    thesis = _create(conn, "u1")
    other = _create(conn, "u1")
    e = ev.add_evidence("u1", thesis["id"], target_type="note", target_id=other["id"], stance="supports", conn=conn)
    events = changelog.get_thesis_changelog("u1", thesis["id"], conn=conn)
    assert any(x["type"] == "evidence_added" and x["evidenceId"] == e["id"] for x in events)

    ev.remove_evidence("u1", e["id"], conn=conn)
    events = changelog.get_thesis_changelog("u1", thesis["id"], conn=conn)
    assert any(x["type"] == "evidence_removed" and x["evidenceId"] == e["id"] for x in events)


def test_fact_capture_produces_a_changelog_event(conn):
    thesis = _create(conn, "u1")
    fact = facts.create_fact_observation(
        "u1", thesis["id"], ticker="NVDA", fact_type="price", value=142.83, conn=conn,
    )
    from api.services.journal_two.notes import append_financial_fact
    append_financial_fact("u1", thesis["id"], fact["id"], conn=conn)
    events = changelog.get_thesis_changelog("u1", thesis["id"], conn=conn)
    assert any(e["type"] == "fact_captured" and e["factId"] == fact["id"] for e in events)


def test_current_value_resolution_never_produces_a_changelog_event(conn):
    # checkpoint §28: a fact's current-value refresh has no write path at
    # all, so calling the resolver repeatedly must never grow the changelog.
    from api.services.journal_two import fact_current_value
    thesis = _create(conn, "u1")
    fact = facts.create_fact_observation(
        "u1", thesis["id"], ticker="NVDA", fact_type="price", value=142.83, conn=conn,
    )
    from api.services.journal_two.notes import append_financial_fact
    append_financial_fact("u1", thesis["id"], fact["id"], conn=conn)
    before = len(changelog.get_thesis_changelog("u1", thesis["id"], conn=conn))
    fact_current_value.resolve_current_values([fact])
    fact_current_value.resolve_current_values([fact])
    after = len(changelog.get_thesis_changelog("u1", thesis["id"], conn=conn))
    assert before == after


def test_changelog_is_empty_for_a_fresh_thesis(conn):
    thesis = _create(conn, "u1")
    assert changelog.get_thesis_changelog("u1", thesis["id"], conn=conn) == []


def test_changelog_is_tenant_scoped(conn):
    thesis = _create(conn, "u1")
    other = _create(conn, "u1")
    ev.add_evidence("u1", thesis["id"], target_type="note", target_id=other["id"], stance="supports", conn=conn)
    assert changelog.get_thesis_changelog("u2", thesis["id"], conn=conn) == []
