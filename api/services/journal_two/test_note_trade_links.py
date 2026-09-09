"""Wave 3 (Thesis-Trade Link) — typed trade/strategy reference tests.

j2_trades.id and j2_option_strategies.id are independent uuid4 namespaces,
so the normal resolver never "tries both tables" for a typed reference — it
queries exactly the one the type names. These tests exist specifically to
prove that design choice, including the id-collision case that justifies it.
"""
from __future__ import annotations

import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services.journal_two.db import ensure_schema
from api.services.journal_two import notes as svc
from api.services.journal_two import note_trade_links as links


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    yield c
    c.close()


def _seed_trade(conn, user_id, trade_id, symbol="NVDA", position_id=None):
    conn.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares,"
        " entry_price, entry_date, exit_price, exit_date, original_stop, pnl_dollar,"
        " pnl_percent, hold_days, result, context_at_entry, created_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (trade_id, user_id, position_id or f"pos-{trade_id}", symbol, "Long", 100,
         10.0, "2026-01-01", 12.0, "2026-01-05", 9.0, 200.0, 20.0, 4, "Win", "{}",
         "2026-01-01T00:00:00Z"),
    )
    conn.commit()


def _seed_position(conn, user_id, position_id, symbol="NVDA"):
    conn.execute(
        "INSERT INTO j2_positions (id, user_id, symbol, side, entry_date, shares,"
        " original_shares, entry_price, stop_price, context_at_entry, created_at,"
        " updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (position_id, user_id, symbol, "Long", "2026-01-01", 100, 100,
         10.0, 9.0, "{}", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
    )
    conn.commit()


def _seed_strategy(conn, user_id, strategy_id, underlying="NVDA"):
    conn.execute(
        "INSERT INTO j2_option_strategies (id, user_id, underlying, strategy_type,"
        " direction, net_entry, entry_date, context_at_entry, created_at, updated_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?)",
        (strategy_id, user_id, underlying, "long_call", "bullish", -500.0,
         "2026-01-01", "{}", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
    )
    conn.commit()


def _seed_note_with_embed(conn, user_id, note_id, trade_ref, trade_ref_type, position=0):
    """Seed a note row + one j2_note_embeds row directly -- exercises the
    projection table the resolver/reverse-lookup actually read, without
    needing a full body_json round trip for these unit tests."""
    conn.execute(
        "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags,"
        " created_at, updated_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (note_id, user_id, "Thesis", '{"type":"doc","content":[]}', "", "[]",
         "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
    )
    conn.execute(
        "INSERT INTO j2_note_embeds (note_id, user_id, position, widget_id,"
        " trade_ref, trade_ref_type) VALUES (?,?,?,?,?,?)",
        (note_id, user_id, position, "chart", trade_ref, trade_ref_type),
    )
    conn.commit()


# ── Resolver: typed references ────────────────────────────────────────────

def test_resolves_equity_trade_typed_reference(conn):
    _seed_trade(conn, "u1", "t1")
    r = links.resolve_trade_ref(conn, "u1", "t1", "equity_trade")
    assert r == {"kind": "equity_trade", "id": "t1", "legacyInferred": False, "symbol": "NVDA"}


def test_resolves_option_strategy_typed_reference(conn):
    _seed_strategy(conn, "u1", "s1")
    r = links.resolve_trade_ref(conn, "u1", "s1", "option_strategy")
    assert r == {"kind": "option_strategy", "id": "s1", "legacyInferred": False, "symbol": "NVDA"}


def test_invalid_trade_ref_type_is_rejected(conn):
    _seed_trade(conn, "u1", "t1")
    r = links.resolve_trade_ref(conn, "u1", "t1", "bogus_type")
    assert r == {"kind": "invalid_type"}


def test_nonexistent_trade_ref_is_unresolved(conn):
    r = links.resolve_trade_ref(conn, "u1", "does-not-exist", "equity_trade")
    assert r == {"kind": "unresolved"}


def test_empty_trade_ref(conn):
    assert links.resolve_trade_ref(conn, "u1", None, None) == {"kind": "empty"}
    assert links.resolve_trade_ref(conn, "u1", "", None) == {"kind": "empty"}


# ── THE regression rail: id collision across the two tables ──────────────

def test_same_id_collision_across_tables_resolves_by_type_not_query_order(conn):
    """The design's whole justification: create the SAME id in both tables
    for one user, then prove typed resolution never confuses them."""
    _seed_trade(conn, "u1", "123")
    _seed_strategy(conn, "u1", "123")

    trade_result = links.resolve_trade_ref(conn, "u1", "123", "equity_trade")
    strategy_result = links.resolve_trade_ref(conn, "u1", "123", "option_strategy")

    assert trade_result == {"kind": "equity_trade", "id": "123", "legacyInferred": False, "symbol": "NVDA"}
    assert strategy_result == {"kind": "option_strategy", "id": "123", "legacyInferred": False, "symbol": "NVDA"}
    # No ambiguity leaking between the two typed calls.
    assert trade_result["kind"] != strategy_result["kind"]


def test_same_id_collision_across_two_users_never_cross_resolves(conn):
    """User A's trade id=123 and User B's strategy id=123 (or vice versa)
    must never let one user resolve/see the other's object."""
    _seed_trade(conn, "userA", "123")
    _seed_strategy(conn, "userB", "123")

    # userA asking for "123" as equity_trade resolves to THEIR OWN trade.
    assert links.resolve_trade_ref(conn, "userA", "123", "equity_trade") == {
        "kind": "equity_trade", "id": "123", "legacyInferred": False, "symbol": "NVDA"}
    # userA asking for "123" as option_strategy finds nothing (that strategy is userB's).
    assert links.resolve_trade_ref(conn, "userA", "123", "option_strategy") == {"kind": "unresolved"}
    # userB asking for "123" as equity_trade finds nothing (that trade is userA's).
    assert links.resolve_trade_ref(conn, "userB", "123", "equity_trade") == {"kind": "unresolved"}
    # userB asking for "123" as option_strategy resolves to THEIR OWN strategy.
    assert links.resolve_trade_ref(conn, "userB", "123", "option_strategy") == {
        "kind": "option_strategy", "id": "123", "legacyInferred": False, "symbol": "NVDA"}


# ── Legacy (untyped, Wave-1-shaped) references ────────────────────────────

def test_legacy_untyped_reference_uniquely_resolvable(conn):
    _seed_trade(conn, "u1", "t1")
    r = links.resolve_trade_ref(conn, "u1", "t1", None)
    assert r == {"kind": "equity_trade", "id": "t1", "legacyInferred": True, "symbol": "NVDA"}


def test_legacy_untyped_reference_ambiguous_is_never_guessed(conn):
    _seed_trade(conn, "u1", "123")
    _seed_strategy(conn, "u1", "123")
    r = links.resolve_trade_ref(conn, "u1", "123", None)
    assert r == {"kind": "ambiguous_legacy"}


def test_legacy_untyped_reference_nonexistent(conn):
    r = links.resolve_trade_ref(conn, "u1", "ghost", None)
    assert r == {"kind": "unresolved"}


# ── Position references (pre-trade thesis flow, AddPositionModal) ─────────
# A position has no j2_trades row until it closes, so a thesis note authored
# at position-creation time references the OPEN position by its own real id.
# These prove the reference GRADUATES automatically once the position closes
# into a trade, and never guesses across multiple partial closes.

def test_resolves_open_position_typed_reference(conn):
    _seed_position(conn, "u1", "p1")
    r = links.resolve_trade_ref(conn, "u1", "p1", "position")
    assert r == {"kind": "position", "id": "p1", "legacyInferred": False, "symbol": "NVDA"}


def test_nonexistent_position_ref_is_unresolved(conn):
    r = links.resolve_trade_ref(conn, "u1", "ghost", "position")
    assert r == {"kind": "unresolved"}


def test_position_reference_graduates_to_its_resulting_trade(conn):
    _seed_position(conn, "u1", "p1")
    _seed_trade(conn, "u1", "t1", position_id="p1")
    r = links.resolve_trade_ref(conn, "u1", "p1", "position")
    assert r == {
        "kind": "equity_trade", "id": "t1", "legacyInferred": False,
        "symbol": "NVDA", "graduatedFromPosition": "p1",
    }


def test_position_reference_with_multiple_partial_closes_never_guesses(conn):
    _seed_position(conn, "u1", "p1")
    _seed_trade(conn, "u1", "t1", position_id="p1")
    _seed_trade(conn, "u1", "t2", position_id="p1")
    r = links.resolve_trade_ref(conn, "u1", "p1", "position")
    assert r == {"kind": "position", "id": "p1", "legacyInferred": False, "symbol": "NVDA"}


def test_position_reference_never_cross_resolves_another_users_position(conn):
    # j2_positions.id is a single globally-unique PK (unlike the
    # equity_trade/option_strategy pair, which are separate physical tables),
    # so the cross-tenant risk here is a query that forgets the user_id
    # filter -- proven by userB never resolving userA's real position id.
    _seed_position(conn, "userA", "p1")
    assert links.resolve_trade_ref(conn, "userA", "p1", "position")["symbol"] == "NVDA"
    r = links.resolve_trade_ref(conn, "userB", "p1", "position")
    assert r == {"kind": "unresolved"}


def test_notes_linked_to_a_position_are_reachable_from_the_graduated_trade(conn):
    _seed_position(conn, "u1", "p1")
    _seed_trade(conn, "u1", "t1", position_id="p1")
    _seed_note_with_embed(conn, "u1", "n1", "p1", "position")
    assert links.notes_linked_to_trade(conn, "u1", "t1", "equity_trade") == ["n1"]


def test_notes_linked_to_a_position_with_multiple_partial_closes_are_not_merged(conn):
    _seed_position(conn, "u1", "p1")
    _seed_trade(conn, "u1", "t1", position_id="p1")
    _seed_trade(conn, "u1", "t2", position_id="p1")
    _seed_note_with_embed(conn, "u1", "n1", "p1", "position")
    # Neither resulting trade may claim the position's note -- which one it
    # "is about" is exactly the ambiguity this design refuses to guess.
    assert links.notes_linked_to_trade(conn, "u1", "t1", "equity_trade") == []
    assert links.notes_linked_to_trade(conn, "u1", "t2", "equity_trade") == []


# ── Reverse lookup: trade/strategy -> linked notes ────────────────────────

def test_trade_side_reverse_lookup_finds_linked_notes(conn):
    _seed_trade(conn, "u1", "t1")
    _seed_note_with_embed(conn, "u1", "n1", "t1", "equity_trade")
    ids = links.notes_linked_to_trade(conn, "u1", "t1", "equity_trade")
    assert ids == ["n1"]


def test_strategy_side_reverse_lookup_finds_linked_notes(conn):
    _seed_strategy(conn, "u1", "s1")
    _seed_note_with_embed(conn, "u1", "n1", "s1", "option_strategy")
    ids = links.notes_linked_to_trade(conn, "u1", "s1", "option_strategy")
    assert ids == ["n1"]


def test_reverse_lookup_requires_a_valid_type():
    with pytest.raises(ValueError):
        links.notes_linked_to_trade(sqlite3.connect(":memory:"), "u1", "x", "bogus")


def test_multiple_notes_linked_to_one_trade(conn):
    _seed_trade(conn, "u1", "t1")
    _seed_note_with_embed(conn, "u1", "n1", "t1", "equity_trade")
    _seed_note_with_embed(conn, "u1", "n2", "t1", "equity_trade")
    ids = links.notes_linked_to_trade(conn, "u1", "t1", "equity_trade")
    assert ids == ["n1", "n2"]


def test_reverse_lookup_excludes_ambiguous_legacy_rows(conn):
    """An id colliding across both tables, referenced by an UNTYPED (legacy)
    embed, must not appear on EITHER side's linked-notes list -- showing it
    on one side would be a guess."""
    _seed_trade(conn, "u1", "123")
    _seed_strategy(conn, "u1", "123")
    _seed_note_with_embed(conn, "u1", "n1", "123", None)  # legacy, untyped
    assert links.notes_linked_to_trade(conn, "u1", "123", "equity_trade") == []
    assert links.notes_linked_to_trade(conn, "u1", "123", "option_strategy") == []


def test_reverse_lookup_includes_uniquely_resolvable_legacy_row(conn):
    _seed_trade(conn, "u1", "t1")
    _seed_note_with_embed(conn, "u1", "n1", "t1", None)  # legacy, untyped
    assert links.notes_linked_to_trade(conn, "u1", "t1", "equity_trade") == ["n1"]


def test_reverse_lookup_tenant_scoped(conn):
    _seed_trade(conn, "u1", "t1")
    _seed_note_with_embed(conn, "u1", "n1", "t1", "equity_trade")
    # A different user asking about the SAME trade_ref sees nothing -- they
    # don't own that trade (and in this fixture, don't even have a row for it).
    assert links.notes_linked_to_trade(conn, "u2", "t1", "equity_trade") == []


# ── HTTP layer: the two new endpoints ──────────────────────────────────────

PAID = {"id": "u1", "email": "u1@example.test", "role": "member", "plan": "pro"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from api.services import auth_db
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from api.routers import journal_two

    db_path = str(tmp_path / "j2_notes_trade_links.db")
    c = sqlite3.connect(db_path)
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    c.close()
    monkeypatch.setattr(auth_db, "_DB_PATH", db_path)

    app = FastAPI()
    app.include_router(journal_two.router)
    app.dependency_overrides[get_current_user] = lambda: dict(PAID)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(PAID)
    return TestClient(app)


def _seed_via_client(client, db_path):
    c = sqlite3.connect(db_path)
    c.row_factory = sqlite3.Row
    return c


def test_note_to_trade_navigation_via_endpoint(client, tmp_path):
    db_path = str(tmp_path / "j2_notes_trade_links.db")
    c = sqlite3.connect(db_path)
    _seed_trade(c, "u1", "t1")
    c.close()

    note = client.post("/api/j2/notes", json={"title": "Thesis"}).json()["note"]
    client.post(f"/api/j2/notes/{note['id']}/embeds", json={
        "attrs": {"widgetId": "chart", "params": {"symbol": "NVDA"},
                  "tradeRef": "t1", "tradeRefType": "equity_trade"},
    })
    r = client.get(f"/api/j2/notes/{note['id']}/trade-ref/resolve")
    assert r.status_code == 200
    links_out = r.json()["links"]
    assert len(links_out) == 1
    assert links_out[0]["tradeRef"] == "t1"
    assert links_out[0]["tradeRefType"] == "equity_trade"
    assert links_out[0]["resolution"]["kind"] == "equity_trade"


def test_note_to_strategy_navigation_via_endpoint(client, tmp_path):
    db_path = str(tmp_path / "j2_notes_trade_links.db")
    c = sqlite3.connect(db_path)
    _seed_strategy(c, "u1", "s1")
    c.close()

    note = client.post("/api/j2/notes", json={"title": "Thesis"}).json()["note"]
    client.post(f"/api/j2/notes/{note['id']}/embeds", json={
        "attrs": {"widgetId": "chart", "params": {"symbol": "NVDA"},
                  "tradeRef": "s1", "tradeRefType": "option_strategy"},
    })
    r = client.get(f"/api/j2/notes/{note['id']}/trade-ref/resolve")
    links_out = r.json()["links"]
    assert links_out[0]["resolution"]["kind"] == "option_strategy"


def test_trade_side_endpoint_lists_linked_notes(client, tmp_path):
    db_path = str(tmp_path / "j2_notes_trade_links.db")
    c = sqlite3.connect(db_path)
    _seed_trade(c, "u1", "t1")
    c.close()

    note = client.post("/api/j2/notes", json={"title": "Thesis"}).json()["note"]
    client.post(f"/api/j2/notes/{note['id']}/embeds", json={
        "attrs": {"widgetId": "chart", "params": {"symbol": "NVDA"},
                  "tradeRef": "t1", "tradeRefType": "equity_trade"},
    })
    r = client.get("/api/j2/notes/by-trade-ref", params={"tradeRef": "t1", "tradeRefType": "equity_trade"})
    assert r.status_code == 200
    assert [n["id"] for n in r.json()["notes"]] == [note["id"]]


def test_position_reference_via_endpoint_graduates_to_the_closed_trade(client, tmp_path):
    """End-to-end: a thesis note is linked to an OPEN position (the
    AddPositionModal pre-trade flow); once that position closes into a
    trade, the SAME note surfaces from the trade's reverse lookup without
    any re-write of the note's stored reference."""
    db_path = str(tmp_path / "j2_notes_trade_links.db")
    c = sqlite3.connect(db_path)
    _seed_position(c, "u1", "p1")
    c.close()

    note = client.post("/api/j2/notes", json={"title": "Pre-trade thesis"}).json()["note"]
    client.post(f"/api/j2/notes/{note['id']}/embeds", json={
        "attrs": {"widgetId": "chart", "params": {"symbol": "NVDA"},
                  "tradeRef": "p1", "tradeRefType": "position"},
    })

    # While still open: resolves as the position itself.
    r = client.get(f"/api/j2/notes/{note['id']}/trade-ref/resolve")
    assert r.json()["links"][0]["resolution"]["kind"] == "position"

    # The position closes into a real trade (position_id back-pointer).
    c = sqlite3.connect(db_path)
    c.row_factory = sqlite3.Row
    _seed_trade(c, "u1", "t1", position_id="p1")
    c.close()

    r = client.get(f"/api/j2/notes/{note['id']}/trade-ref/resolve")
    assert r.json()["links"][0]["resolution"]["kind"] == "equity_trade"
    assert r.json()["links"][0]["resolution"]["id"] == "t1"

    # And the closed trade's own reverse lookup finds the same note.
    r = client.get("/api/j2/notes/by-trade-ref", params={"tradeRef": "t1", "tradeRefType": "equity_trade"})
    assert [n["id"] for n in r.json()["notes"]] == [note["id"]]


def test_by_trade_ref_endpoint_rejects_invalid_type(client):
    r = client.get("/api/j2/notes/by-trade-ref", params={"tradeRef": "t1", "tradeRefType": "bogus"})
    assert r.status_code == 422


def test_by_trade_ref_endpoint_requires_type_param(client):
    r = client.get("/api/j2/notes/by-trade-ref", params={"tradeRef": "t1"})
    assert r.status_code == 422  # FastAPI's own missing-required-query-param error


def test_resolve_endpoint_404s_for_missing_note(client):
    r = client.get("/api/j2/notes/does-not-exist/trade-ref/resolve")
    assert r.status_code == 404


def test_resolve_endpoint_tenant_isolated(tmp_path):
    """A note with no embeds for a DIFFERENT user's note_id is unreachable
    (404, not empty links) -- ownership is checked before anything else."""
    from api.services import auth_db
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from api.routers import journal_two

    db_path = str(tmp_path / "j2_notes_trade_links_iso.db")
    c = sqlite3.connect(db_path)
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    c.close()

    import api.services.auth_db as auth_db_mod
    orig = auth_db_mod._DB_PATH
    auth_db_mod._DB_PATH = db_path
    try:
        app = FastAPI()
        app.include_router(journal_two.router)
        app.dependency_overrides[get_current_user] = lambda: {**PAID, "id": "u1"}
        app.dependency_overrides[get_current_user_with_plan] = lambda: {**PAID, "id": "u1"}
        c1 = TestClient(app)
        note = c1.post("/api/j2/notes", json={"title": "u1 private"}).json()["note"]

        app2 = FastAPI()
        app2.include_router(journal_two.router)
        app2.dependency_overrides[get_current_user] = lambda: {**PAID, "id": "u2"}
        app2.dependency_overrides[get_current_user_with_plan] = lambda: {**PAID, "id": "u2"}
        c2 = TestClient(app2)
        r = c2.get(f"/api/j2/notes/{note['id']}/trade-ref/resolve")
        assert r.status_code == 404
    finally:
        auth_db_mod._DB_PATH = orig


# ── Note lifecycle: trash / restore, and a since-deleted authoritative trade ─

def test_trashing_and_restoring_a_note_preserves_its_trade_link(client):
    note = client.post("/api/j2/notes", json={"title": "Thesis"}).json()["note"]
    client.post(f"/api/j2/notes/{note['id']}/embeds", json={
        "attrs": {"widgetId": "chart", "params": {"symbol": "NVDA"},
                  "tradeRef": "t1", "tradeRefType": "equity_trade"},
    })
    assert client.delete(f"/api/j2/notes/{note['id']}").status_code == 200
    assert client.post(f"/api/j2/notes/{note['id']}/restore").status_code == 200
    r = client.get(f"/api/j2/notes/{note['id']}/trade-ref/resolve")
    assert r.status_code == 200
    assert r.json()["links"][0]["tradeRef"] == "t1"


def test_a_deleted_authoritative_trade_resolves_as_unresolved_not_an_error(client):
    """The trade a note links to was later removed from j2_trades entirely
    (a real lifecycle case, e.g. a broker re-sync). The note itself must
    remain valid and the resolution must fail HONESTLY (unresolved), never
    500 or silently point somewhere wrong."""
    note = client.post("/api/j2/notes", json={"title": "Thesis"}).json()["note"]
    client.post(f"/api/j2/notes/{note['id']}/embeds", json={
        "attrs": {"widgetId": "chart", "params": {"symbol": "NVDA"},
                  "tradeRef": "t1", "tradeRefType": "equity_trade"},
    })
    r = client.get(f"/api/j2/notes/{note['id']}/trade-ref/resolve")
    assert r.status_code == 200
    assert r.json()["links"][0]["resolution"] == {"kind": "unresolved"}


# ── Idempotency ────────────────────────────────────────────────────────────

def test_resaving_the_same_embed_is_idempotent(client, tmp_path):
    db_path = str(tmp_path / "j2_notes_trade_links.db")
    c = sqlite3.connect(db_path)
    _seed_trade(c, "u1", "t1")
    c.close()

    note = client.post("/api/j2/notes", json={"title": "Thesis"}).json()["note"]
    attrs = {"widgetId": "chart", "params": {"symbol": "NVDA"},
             "tradeRef": "t1", "tradeRefType": "equity_trade"}
    client.post(f"/api/j2/notes/{note['id']}/embeds", json={"attrs": attrs})
    client.post(f"/api/j2/notes/{note['id']}/embeds", json={"attrs": attrs})
    r = client.get("/api/j2/notes/by-trade-ref", params={"tradeRef": "t1", "tradeRefType": "equity_trade"})
    # Two embeds, but ONE note -- reverse lookup is DISTINCT note_ids.
    assert [n["id"] for n in r.json()["notes"]] == [note["id"]]


def test_invalid_trade_ref_type_degrades_instead_of_failing_the_note_save(client):
    """Note save is authoritative -- an unrecognized tradeRefType must never
    block the write. It degrades to untyped (NULL), same philosophy as a
    malformed attrs shape elsewhere in this file."""
    note = client.post("/api/j2/notes", json={"title": "Thesis"}).json()["note"]
    r = client.post(f"/api/j2/notes/{note['id']}/embeds", json={
        "attrs": {"widgetId": "chart", "params": {"symbol": "NVDA"},
                  "tradeRef": "t1", "tradeRefType": "not_a_real_type"},
    })
    assert r.status_code == 200
    resolved = client.get(f"/api/j2/notes/{note['id']}/trade-ref/resolve").json()
    assert resolved["links"][0]["tradeRefType"] is None
