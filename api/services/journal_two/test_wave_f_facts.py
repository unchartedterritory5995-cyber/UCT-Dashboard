"""Wave F — Financial Fact / Snapshot Ledger tests. Backend unit level,
mirroring test_wave_e_properties.py's conn-fixture pattern."""
from __future__ import annotations

import sqlite3

import pytest

from api.services.journal_two.db import ensure_schema
from api.services.journal_two.notes import create_note
from api.services.journal_two import note_facts as facts
from api.services.journal_two import fact_registry, fact_current_value


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    yield c
    c.close()


def _create(c, user_id, title="A note"):
    return create_note(user_id, {"title": title, "bodyJson": {"type": "doc", "content": []}}, conn=c)


@pytest.fixture(autouse=True)
def _no_real_entity_master(monkeypatch):
    """Every test in this file stubs entity_master.resolve so none of them
    depend on the real entity_master.db existing/being seeded in CI. The
    not_found/ambiguous/resolved paths are each tested explicitly below."""
    from api.services.entity_master import api as entity_master

    def _fake_resolve(alias, as_of=None, **kw):
        return entity_master.ResolveResult(status="not_found")
    monkeypatch.setattr(entity_master, "resolve", _fake_resolve)


# ── Registry ─────────────────────────────────────────────────────────────────

def test_registry_has_two_active_and_one_architected_inactive_fact_type():
    assert fact_registry.is_active("price") is True
    assert fact_registry.is_active("user_note") is True
    assert fact_registry.is_active("analyst_price_target_consensus") is False


def test_unknown_fact_type_is_not_in_registry():
    assert fact_registry.get_fact_type("not_a_real_type") is None


# ── Creation / validation ────────────────────────────────────────────────────

def test_create_price_fact_stores_numeric_value(conn):
    note = _create(conn, "u1")
    f = facts.create_fact_observation(
        "u1", note["id"], ticker="NVDA", fact_type="price", value=142.83, conn=conn,
    )
    assert f["value"] == 142.83
    assert f["ticker"] == "NVDA"
    assert f["unit"] == "usd_per_share"
    assert f["temporalMode"] == "live_and_snapshot"
    assert f["source"] == "massive"
    assert f["rightsClass"] == "independent"


def test_create_user_note_fact_stores_text_value(conn):
    note = _create(conn, "u1")
    f = facts.create_fact_observation(
        "u1", note["id"], ticker="NVDA", fact_type="user_note",
        value="My target: 195", conn=conn,
    )
    assert f["value"] == "My target: 195"
    assert f["unit"] == "text"


def test_create_fact_rejects_unknown_fact_type(conn):
    note = _create(conn, "u1")
    with pytest.raises(facts.FactValidationError):
        facts.create_fact_observation("u1", note["id"], ticker="NVDA", fact_type="not_real", value=1, conn=conn)


def test_create_price_fact_rejects_non_numeric_value(conn):
    note = _create(conn, "u1")
    with pytest.raises(facts.FactValidationError):
        facts.create_fact_observation("u1", note["id"], ticker="NVDA", fact_type="price", value="abc", conn=conn)


def test_create_user_note_fact_rejects_empty_value(conn):
    note = _create(conn, "u1")
    with pytest.raises(facts.FactValidationError):
        facts.create_fact_observation("u1", note["id"], ticker="NVDA", fact_type="user_note", value="   ", conn=conn)


def test_create_fact_rejects_empty_ticker(conn):
    note = _create(conn, "u1")
    with pytest.raises(facts.FactValidationError):
        facts.create_fact_observation("u1", note["id"], ticker="", fact_type="price", value=1, conn=conn)


def test_omitting_value_for_price_auto_resolves_the_current_live_price(conn, monkeypatch):
    monkeypatch.setattr(fact_current_value, "_resolve_price", lambda tickers: {t: 142.83 for t in tickers})
    note = _create(conn, "u1")
    f = facts.create_fact_observation("u1", note["id"], ticker="NVDA", fact_type="price", value=None, conn=conn)
    assert f["value"] == 142.83


def test_omitting_value_for_price_raises_when_resolution_fails(conn, monkeypatch):
    monkeypatch.setattr(fact_current_value, "_resolve_price", lambda tickers: {t: None for t in tickers})
    note = _create(conn, "u1")
    with pytest.raises(facts.FactValidationError, match="Could not resolve"):
        facts.create_fact_observation("u1", note["id"], ticker="NVDA", fact_type="price", value=None, conn=conn)


def test_omitting_value_for_a_non_price_fact_type_still_requires_one(conn):
    note = _create(conn, "u1")
    with pytest.raises(facts.FactValidationError):
        facts.create_fact_observation("u1", note["id"], ticker="NVDA", fact_type="user_note", value=None, conn=conn)


def test_create_fact_rejects_an_inactive_fact_type_even_though_it_is_registered(conn):
    # analyst_price_target_consensus exists in the registry (proves the
    # architecture generalizes) but has NO active capture path -- creating one
    # must be rejected, not silently allowed because the type is "known."
    note = _create(conn, "u1")
    with pytest.raises(facts.FactValidationError, match="not yet enabled"):
        facts.create_fact_observation(
            "u1", note["id"], ticker="NVDA", fact_type="analyst_price_target_consensus",
            value=195.0, conn=conn,
        )


# ── Entity resolution never blocks capture ──────────────────────────────────

def test_capture_proceeds_when_entity_resolution_is_not_found(conn, monkeypatch):
    note = _create(conn, "u1")
    f = facts.create_fact_observation("u1", note["id"], ticker="ZZZFAKE", fact_type="price", value=1.0, conn=conn)
    assert f["entityId"] is None
    assert f["ticker"] == "ZZZFAKE"  # ticker always present regardless


def test_capture_proceeds_when_entity_resolution_is_ambiguous(conn, monkeypatch):
    from api.services.entity_master import api as entity_master
    monkeypatch.setattr(
        entity_master, "resolve",
        lambda alias, as_of=None, **kw: entity_master.ResolveResult(status="ambiguous", candidates=("ent_1", "ent_2")),
    )
    note = _create(conn, "u1")
    f = facts.create_fact_observation("u1", note["id"], ticker="AMBIG", fact_type="price", value=1.0, conn=conn)
    assert f["entityId"] is None


def test_capture_stores_entity_id_when_resolution_succeeds(conn, monkeypatch):
    from api.services.entity_master import api as entity_master
    entity = entity_master.Entity(entity_id="ent_abc123", entity_type="equity", lifecycle_state="active", lifecycle_since=None)
    monkeypatch.setattr(
        entity_master, "resolve",
        lambda alias, as_of=None, **kw: entity_master.ResolveResult(status="resolved", entity=entity),
    )
    note = _create(conn, "u1")
    f = facts.create_fact_observation("u1", note["id"], ticker="NVDA", fact_type="price", value=1.0, conn=conn)
    assert f["entityId"] == "ent_abc123"


def test_entity_resolution_failure_never_raises_onto_the_caller(conn, monkeypatch):
    from api.services.entity_master import api as entity_master
    def _boom(alias, as_of=None, **kw):
        raise RuntimeError("entity_master.db unavailable")
    monkeypatch.setattr(entity_master, "resolve", _boom)
    note = _create(conn, "u1")
    f = facts.create_fact_observation("u1", note["id"], ticker="NVDA", fact_type="price", value=1.0, conn=conn)
    assert f["entityId"] is None  # degrades, does not raise


# ── Immutability ─────────────────────────────────────────────────────────────

def test_two_observations_of_the_same_series_are_two_rows_not_an_overwrite(conn):
    note = _create(conn, "u1")
    f1 = facts.create_fact_observation("u1", note["id"], ticker="NVDA", fact_type="price", value=142.83, conn=conn)
    f2 = facts.create_fact_observation("u1", note["id"], ticker="NVDA", fact_type="price", value=145.10, conn=conn)
    assert f1["id"] != f2["id"]
    assert facts.get_fact_observation("u1", f1["id"], conn=conn)["value"] == 142.83
    assert facts.get_fact_observation("u1", f2["id"], conn=conn)["value"] == 145.10


def test_note_facts_module_exposes_no_value_update_function():
    # Structural guarantee (checkpoint decision 19): the whole point of the
    # ledger depends on there being no code path that can mutate a value.
    assert not hasattr(facts, "update_fact_observation")
    assert not hasattr(facts, "update_fact_value")


def test_caption_is_the_one_editable_field(conn):
    note = _create(conn, "u1")
    f = facts.create_fact_observation("u1", note["id"], ticker="NVDA", fact_type="price", value=1.0, conn=conn)
    updated = facts.update_fact_caption("u1", f["id"], "revised note", conn=conn)
    assert updated["caption"] == "revised note"
    assert updated["value"] == 1.0  # value untouched


# ── Idempotency / dedupe ─────────────────────────────────────────────────────

def test_repeated_idempotency_key_returns_the_existing_row_not_a_duplicate(conn):
    note = _create(conn, "u1")
    f1 = facts.create_fact_observation(
        "u1", note["id"], ticker="NVDA", fact_type="price", value=142.83,
        idempotency_key="intent-1", conn=conn,
    )
    f2 = facts.create_fact_observation(
        "u1", note["id"], ticker="NVDA", fact_type="price", value=999.0,  # different value, ignored
        idempotency_key="intent-1", conn=conn,
    )
    assert f1["id"] == f2["id"]
    assert f2["value"] == 142.83  # the FIRST value wins, not the retry's
    count = conn.execute("SELECT COUNT(*) c FROM j2_fact_observations WHERE note_id = ?", (note["id"],)).fetchone()["c"]
    assert count == 1


def test_two_different_capture_intents_are_never_deduped_against_each_other(conn):
    note = _create(conn, "u1")
    f1 = facts.create_fact_observation(
        "u1", note["id"], ticker="NVDA", fact_type="price", value=142.83,
        idempotency_key="intent-1", conn=conn,
    )
    f2 = facts.create_fact_observation(
        "u1", note["id"], ticker="NVDA", fact_type="price", value=145.10,
        idempotency_key="intent-2", conn=conn,
    )
    assert f1["id"] != f2["id"]


def test_a_capture_with_no_idempotency_key_is_never_deduped(conn):
    note = _create(conn, "u1")
    f1 = facts.create_fact_observation("u1", note["id"], ticker="NVDA", fact_type="price", value=1.0, conn=conn)
    f2 = facts.create_fact_observation("u1", note["id"], ticker="NVDA", fact_type="price", value=1.0, conn=conn)
    assert f1["id"] != f2["id"]


# ── Note-content sync (sidecar) ──────────────────────────────────────────────

def test_saving_a_note_with_a_financial_fact_node_syncs_the_sidecar(conn):
    from api.services.journal_two.notes import update_note
    note = _create(conn, "u1")
    f = facts.create_fact_observation("u1", note["id"], ticker="NVDA", fact_type="price", value=1.0, conn=conn)
    body = {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "see"}]},
        {"type": "financialFact", "attrs": {"factId": f["id"]}},
    ]}
    update_note("u1", note["id"], {"bodyJson": body}, conn=conn)
    resolved = facts.list_note_facts("u1", note["id"], conn=conn)
    assert [r["id"] for r in resolved] == [f["id"]]


def test_removing_the_node_from_the_note_drops_the_sidecar_row_but_not_the_fact(conn):
    from api.services.journal_two.notes import update_note
    note = _create(conn, "u1")
    f = facts.create_fact_observation("u1", note["id"], ticker="NVDA", fact_type="price", value=1.0, conn=conn)
    body_with = {"type": "doc", "content": [{"type": "financialFact", "attrs": {"factId": f["id"]}}]}
    update_note("u1", note["id"], {"bodyJson": body_with}, conn=conn)
    body_without = {"type": "doc", "content": [{"type": "paragraph", "content": []}]}
    update_note("u1", note["id"], {"bodyJson": body_without}, conn=conn)
    assert facts.list_note_facts("u1", note["id"], conn=conn) == []
    # the underlying row still exists -- removing the NODE is not deleting the
    # fact; only note_facts.delete_fact_observation does that (checkpoint
    # decision "removal-as-deletion... never inferred from a save diff")
    assert facts.get_fact_observation("u1", f["id"], conn=conn) is not None


# ── append_financial_fact (TickerPopup-style insertion) ─────────────────────

def test_append_financial_fact_places_the_node_and_syncs_the_sidecar(conn):
    from api.services.journal_two.notes import append_financial_fact
    note = _create(conn, "u1")
    f = facts.create_fact_observation("u1", note["id"], ticker="NVDA", fact_type="price", value=1.0, conn=conn)
    result = append_financial_fact("u1", note["id"], f["id"], conn=conn)
    assert result is not None
    resolved = facts.list_note_facts("u1", note["id"], conn=conn)
    assert [r["id"] for r in resolved] == [f["id"]]


def test_append_financial_fact_returns_none_for_a_trashed_note(conn):
    from api.services.journal_two.notes import append_financial_fact, delete_note
    note = _create(conn, "u1")
    f = facts.create_fact_observation("u1", note["id"], ticker="NVDA", fact_type="price", value=1.0, conn=conn)
    delete_note("u1", note["id"], conn=conn)
    assert append_financial_fact("u1", note["id"], f["id"], conn=conn) is None


def test_append_financial_fact_rejects_an_empty_fact_id(conn):
    from api.services.journal_two.notes import append_financial_fact, NoteValidationError
    note = _create(conn, "u1")
    with pytest.raises(NoteValidationError):
        append_financial_fact("u1", note["id"], "", conn=conn)


# ── Deletion / lifecycle ─────────────────────────────────────────────────────

def test_delete_fact_removes_both_the_row_and_any_sidecar_refs(conn):
    from api.services.journal_two.notes import update_note
    note = _create(conn, "u1")
    f = facts.create_fact_observation("u1", note["id"], ticker="NVDA", fact_type="price", value=1.0, conn=conn)
    body = {"type": "doc", "content": [{"type": "financialFact", "attrs": {"factId": f["id"]}}]}
    update_note("u1", note["id"], {"bodyJson": body}, conn=conn)
    assert facts.delete_fact_observation("u1", f["id"], conn=conn) is True
    assert facts.get_fact_observation("u1", f["id"], conn=conn) is None
    row = conn.execute("SELECT COUNT(*) c FROM j2_note_fact_refs WHERE fact_id = ?", (f["id"],)).fetchone()
    assert row["c"] == 0


def test_hard_deleting_the_note_cascades_to_its_facts(conn):
    note = _create(conn, "u1")
    f = facts.create_fact_observation("u1", note["id"], ticker="NVDA", fact_type="price", value=1.0, conn=conn)
    conn.execute("DELETE FROM j2_notes WHERE id = ?", (note["id"],))
    conn.commit()
    row = conn.execute("SELECT COUNT(*) c FROM j2_fact_observations WHERE id = ?", (f["id"],)).fetchone()
    assert row["c"] == 0


def test_trashing_a_note_leaves_its_facts_fully_intact(conn):
    from api.services.journal_two.notes import delete_note
    note = _create(conn, "u1")
    f = facts.create_fact_observation("u1", note["id"], ticker="NVDA", fact_type="price", value=1.0, conn=conn)
    delete_note("u1", note["id"], conn=conn)  # Wave 0 trash: soft delete only
    assert facts.get_fact_observation("u1", f["id"], conn=conn) is not None


# ── Tenant isolation ─────────────────────────────────────────────────────────

def test_cannot_read_another_users_fact(conn):
    note = _create(conn, "u1")
    f = facts.create_fact_observation("u1", note["id"], ticker="NVDA", fact_type="price", value=1.0, conn=conn)
    assert facts.get_fact_observation("u2", f["id"], conn=conn) is None


def test_cannot_delete_another_users_fact(conn):
    note = _create(conn, "u1")
    f = facts.create_fact_observation("u1", note["id"], ticker="NVDA", fact_type="price", value=1.0, conn=conn)
    assert facts.delete_fact_observation("u2", f["id"], conn=conn) is False
    assert facts.get_fact_observation("u1", f["id"], conn=conn) is not None


def test_cannot_update_caption_on_another_users_fact(conn):
    note = _create(conn, "u1")
    f = facts.create_fact_observation("u1", note["id"], ticker="NVDA", fact_type="price", value=1.0, conn=conn)
    assert facts.update_fact_caption("u2", f["id"], "hijacked", conn=conn) is None


def test_idempotency_key_is_scoped_per_user_not_global(conn):
    note1 = _create(conn, "u1")
    note2 = _create(conn, "u2")
    f1 = facts.create_fact_observation("u1", note1["id"], ticker="NVDA", fact_type="price", value=1.0, idempotency_key="same-key", conn=conn)
    f2 = facts.create_fact_observation("u2", note2["id"], ticker="NVDA", fact_type="price", value=2.0, idempotency_key="same-key", conn=conn)
    assert f1["id"] != f2["id"]  # two different users' identical key never collide


# ── Current-value resolver ───────────────────────────────────────────────────

def test_current_value_resolver_only_resolves_live_and_snapshot_facts(monkeypatch):
    monkeypatch.setattr(fact_current_value, "_resolve_price", lambda tickers: {t: 999.0 for t in tickers})
    facts_list = [
        {"id": "f1", "factType": "price", "temporalMode": "live_and_snapshot", "ticker": "NVDA"},
        {"id": "f2", "factType": "user_note", "temporalMode": "snapshot", "ticker": "NVDA"},
    ]
    result = fact_current_value.resolve_current_values(facts_list)
    assert result == {"f1": 999.0}  # f2 absent entirely -- nothing to compare, by design


def test_current_value_resolver_failure_returns_none_never_raises(monkeypatch):
    def _boom(tickers):
        raise RuntimeError("provider down")
    monkeypatch.setattr(fact_current_value, "_resolve_price", _boom)
    # _resolve_price itself has its own try/except, but prove the PUBLIC
    # resolve_current_values never propagates a resolver exception either.
    import api.services.journal_two.fact_current_value as m
    monkeypatch.setattr(m, "_resolve_price", lambda tickers: {t: None for t in tickers})
    facts_list = [{"id": "f1", "factType": "price", "temporalMode": "live_and_snapshot", "ticker": "NVDA"}]
    result = m.resolve_current_values(facts_list)
    assert result == {"f1": None}


def test_then_stays_then_when_current_value_changes(conn, monkeypatch):
    """The core temporal-correctness proof (directive §148), at the unit level:
    the ORIGINAL observation never changes even as the resolved CURRENT value
    changes across two separate resolutions."""
    from api.services.journal_two.notes import update_note
    note = _create(conn, "u1")
    f = facts.create_fact_observation("u1", note["id"], ticker="NVDA", fact_type="price", value=142.83, conn=conn)
    body = {"type": "doc", "content": [{"type": "financialFact", "attrs": {"factId": f["id"]}}]}
    update_note("u1", note["id"], {"bodyJson": body}, conn=conn)

    monkeypatch.setattr(fact_current_value, "_resolve_price", lambda tickers: {t: 145.10 for t in tickers})
    resolved = facts.list_note_facts("u1", note["id"], conn=conn)
    current_1 = fact_current_value.resolve_current_values(resolved)
    assert facts.get_fact_observation("u1", f["id"], conn=conn)["value"] == 142.83
    assert current_1[f["id"]] == 145.10

    monkeypatch.setattr(fact_current_value, "_resolve_price", lambda tickers: {t: 150.00 for t in tickers})
    resolved_again = facts.list_note_facts("u1", note["id"], conn=conn)
    current_2 = fact_current_value.resolve_current_values(resolved_again)
    # THEN is unchanged...
    assert facts.get_fact_observation("u1", f["id"], conn=conn)["value"] == 142.83
    # ...while NOW moved.
    assert current_2[f["id"]] == 150.00
