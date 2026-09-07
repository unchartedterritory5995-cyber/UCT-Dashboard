"""Wave H — Research Home + Ticker Research Workspace tests. Backend unit
level, mirroring test_wave_g_thesis.py's conn-fixture pattern."""
from __future__ import annotations

import sqlite3
import uuid

import pytest

from api.services.journal_two.db import ensure_schema
from api.services.journal_two.notes import create_note, update_note, add_favorite, record_note_opened
from api.services.journal_two import notebook_home
from api.services.journal_two import ticker_research


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


def _now_iso():
    from api.services.journal_two.notes import _now_iso as impl
    return impl()


def _add_embed(c, note_id, user_id, symbol, position=0, trade_ref=None, trade_ref_type=None):
    c.execute(
        "INSERT INTO j2_note_embeds (note_id, user_id, position, widget_id, symbol, trade_ref, trade_ref_type, captured_at)"
        " VALUES (?, ?, ?, 'chart', ?, ?, ?, ?)",
        (note_id, user_id, position, symbol, trade_ref, trade_ref_type, _now_iso()),
    )
    c.commit()


def _add_mention(c, note_id, user_id, symbol):
    c.execute(
        "INSERT INTO j2_note_mentions (note_id, user_id, symbol, created_at) VALUES (?, ?, ?, ?)",
        (note_id, user_id, symbol, _now_iso()),
    )
    c.commit()


def _add_position(c, user_id, symbol, *, closed_at=None):
    pid = uuid.uuid4().hex
    c.execute(
        "INSERT INTO j2_positions (id, user_id, symbol, side, entry_date, shares, original_shares,"
        " entry_price, stop_price, context_at_entry, created_at, updated_at, closed_at)"
        " VALUES (?, ?, ?, 'Long', '2026-01-01', 100, 100, 10, 9, '{}', ?, ?, ?)",
        (pid, user_id, symbol, _now_iso(), _now_iso(), closed_at),
    )
    c.commit()
    return pid


def _add_trade(c, user_id, symbol, position_id):
    tid = uuid.uuid4().hex
    c.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price, entry_date,"
        " exit_price, exit_date, original_stop, pnl_dollar, pnl_percent, hold_days, result, context_at_entry, created_at)"
        " VALUES (?, ?, ?, ?, 'Long', 100, 10, '2026-01-01', 12, '2026-01-05', 9, 200, 0.2, 4, 'Win', '{}', ?)",
        (tid, user_id, position_id, symbol, _now_iso()),
    )
    c.commit()
    return tid


# ── Research Home ────────────────────────────────────────────────────────────

def test_home_is_all_empty_for_a_fresh_account(conn):
    home = notebook_home.get_notebook_home("u1", conn=conn)
    assert home == {
        "continueWorking": [], "favorites": [], "activeTheses": [],
        "openPositionResearch": [], "needsReview": [],
    }


def test_home_continue_working_reflects_recents(conn):
    note = _create(conn, "u1", "Recent note")
    record_note_opened("u1", note["id"], conn=conn)
    home = notebook_home.get_notebook_home("u1", conn=conn)
    assert [n["id"] for n in home["continueWorking"]] == [note["id"]]


def test_home_favorites_reflects_favorited_notes(conn):
    note = _create(conn, "u1", "Fav note")
    add_favorite("u1", note["id"], conn=conn)
    home = notebook_home.get_notebook_home("u1", conn=conn)
    assert [n["id"] for n in home["favorites"]] == [note["id"]]


def test_home_active_theses_uses_the_same_predicate_as_wave_g_starter_view(conn):
    note = _create(conn, "u1", "NVDA Thesis")
    update_note("u1", note["id"], {"properties": {"builtin:thesis_status": "active"}}, conn=conn)
    other = _create(conn, "u1", "Watching only")
    update_note("u1", other["id"], {"properties": {"builtin:thesis_status": "watching"}}, conn=conn)
    home = notebook_home.get_notebook_home("u1", conn=conn)
    assert [n["id"] for n in home["activeTheses"]] == [note["id"]]


def test_home_needs_review_excludes_closed_and_future_dates(conn):
    due = _create(conn, "u1", "Due")
    update_note("u1", due["id"], {"properties": {"builtin:review_date": "2020-01-01"}}, conn=conn)
    future = _create(conn, "u1", "Future")
    update_note("u1", future["id"], {"properties": {"builtin:review_date": "2099-01-01"}}, conn=conn)
    closed = _create(conn, "u1", "Closed but due")
    update_note("u1", closed["id"], {
        "properties": {"builtin:review_date": "2020-01-01", "builtin:thesis_status": "closed"},
    }, conn=conn)
    home = notebook_home.get_notebook_home("u1", conn=conn)
    ids = {n["id"] for n in home["needsReview"]}
    assert ids == {due["id"]}


def test_home_open_position_research_uses_a_direct_join_never_equity_trade(conn):
    note = _create(conn, "u1", "AMD position note")
    pos_id = _add_position(conn, "u1", "AMD")
    _add_embed(conn, note["id"], "u1", "AMD", trade_ref=pos_id, trade_ref_type="position")

    closed_note = _create(conn, "u1", "Closed position note")
    closed_pos_id = _add_position(conn, "u1", "MSFT", closed_at=_now_iso())
    _add_embed(conn, closed_note["id"], "u1", "MSFT", trade_ref=closed_pos_id, trade_ref_type="position")

    trade_note = _create(conn, "u1", "Equity trade note (never an open position)")
    _add_embed(conn, trade_note["id"], "u1", "TSLA", trade_ref="some-trade-id", trade_ref_type="equity_trade")

    home = notebook_home.get_notebook_home("u1", conn=conn)
    assert [n["id"] for n in home["openPositionResearch"]] == [note["id"]]


def test_home_sections_are_tenant_scoped(conn):
    note = _create(conn, "u1", "u1 note")
    add_favorite("u1", note["id"], conn=conn)
    record_note_opened("u1", note["id"], conn=conn)
    home = notebook_home.get_notebook_home("u2", conn=conn)
    assert home["favorites"] == []
    assert home["continueWorking"] == []


def test_home_one_section_failing_never_blanks_the_rest(conn, monkeypatch):
    note = _create(conn, "u1", "Fav note")
    add_favorite("u1", note["id"], conn=conn)

    def _boom(*a, **k):
        raise RuntimeError("simulated failure")
    monkeypatch.setattr(notebook_home, "_active_theses", _boom)

    home = notebook_home.get_notebook_home("u1", conn=conn)
    assert home["activeTheses"] == []
    assert [n["id"] for n in home["favorites"]] == [note["id"]]


# ── Ticker Research Workspace ────────────────────────────────────────────────

def test_resolve_research_symbols_degrades_gracefully_when_unresolved(conn):
    identity = ticker_research.resolve_research_symbols("nvda")
    assert identity["symbol"] == "NVDA"
    assert identity["entityId"] is None
    assert identity["symbols"] == ["NVDA"]


def test_notes_membership_via_ticker_field(conn):
    note = _create(conn, "u1", "NVDA note", ticker="NVDA")
    summary = ticker_research.get_ticker_research_summary("u1", "NVDA", conn=conn)
    assert [n["id"] for n in summary["notes"]] == [note["id"]]


def test_notes_membership_via_embed_symbol(conn):
    note = _create(conn, "u1", "Chart note")
    _add_embed(conn, note["id"], "u1", "NVDA")
    summary = ticker_research.get_ticker_research_summary("u1", "NVDA", conn=conn)
    assert [n["id"] for n in summary["notes"]] == [note["id"]]


def test_notes_membership_via_cashtag_mention(conn):
    note = _create(conn, "u1", "Prose note")
    _add_mention(conn, note["id"], "u1", "NVDA")
    summary = ticker_research.get_ticker_research_summary("u1", "NVDA", conn=conn)
    assert [n["id"] for n in summary["notes"]] == [note["id"]]


def test_a_note_matching_multiple_sources_counts_once(conn):
    note = _create(conn, "u1", "Belt and suspenders", ticker="NVDA")
    _add_embed(conn, note["id"], "u1", "NVDA")
    _add_mention(conn, note["id"], "u1", "NVDA")
    summary = ticker_research.get_ticker_research_summary("u1", "NVDA", conn=conn)
    assert [n["id"] for n in summary["notes"]] == [note["id"]]


def test_plain_substring_is_never_sufficient_membership(conn):
    # A note that merely CONTAINS "NVDA" as a substring somewhere unrelated
    # (e.g. a different ticker "ANVDAX") must never qualify -- membership is
    # exact-match only against ticker/embed/mention, never a LIKE scan.
    _create(conn, "u1", "Unrelated", ticker="ANVDAX")
    summary = ticker_research.get_ticker_research_summary("u1", "NVDA", conn=conn)
    assert summary["notes"] == []


def test_multi_ticker_note_appears_in_both_workspaces_without_duplication(conn):
    note = _create(conn, "u1", "NVDA vs AMD")
    _add_mention(conn, note["id"], "u1", "NVDA")
    _add_mention(conn, note["id"], "u1", "AMD")
    nvda_summary = ticker_research.get_ticker_research_summary("u1", "NVDA", conn=conn)
    amd_summary = ticker_research.get_ticker_research_summary("u1", "AMD", conn=conn)
    assert [n["id"] for n in nvda_summary["notes"]] == [note["id"]]
    assert [n["id"] for n in amd_summary["notes"]] == [note["id"]]


def test_active_and_past_theses_split(conn):
    active = _create(conn, "u1", "Active thesis", ticker="NVDA")
    update_note("u1", active["id"], {"properties": {"builtin:research_type": "long_thesis", "builtin:thesis_status": "active"}}, conn=conn)
    invalidated = _create(conn, "u1", "Invalidated thesis", ticker="NVDA")
    update_note("u1", invalidated["id"], {"properties": {"builtin:research_type": "long_thesis", "builtin:thesis_status": "invalidated"}}, conn=conn)
    plain = _create(conn, "u1", "Plain note, not a thesis", ticker="NVDA")

    summary = ticker_research.get_ticker_research_summary("u1", "NVDA", conn=conn)
    assert [n["id"] for n in summary["activeTheses"]] == [active["id"]]
    assert [n["id"] for n in summary["pastTheses"]] == [invalidated["id"]]
    assert plain["id"] not in [n["id"] for n in summary["activeTheses"] + summary["pastTheses"]]


def test_legacy_thesis_tag_also_counts_as_thesis_shaped(conn):
    note = _create(conn, "u1", "Legacy tagged thesis", ticker="NVDA", tags=["thesis"])
    summary = ticker_research.get_ticker_research_summary("u1", "NVDA", conn=conn)
    assert [n["id"] for n in summary["pastTheses"]] == [note["id"]]  # no thesis_status set -> not 'active'


def test_facts_aggregate_via_ticker_when_entity_id_is_null(conn):
    from api.services.journal_two import note_facts
    note = _create(conn, "u1", "Fact note")
    note_facts.create_fact_observation("u1", note["id"], ticker="NVDA", fact_type="price", value=142.83, conn=conn)
    summary = ticker_research.get_ticker_research_summary("u1", "NVDA", conn=conn)
    assert len(summary["facts"]) == 1
    assert summary["facts"][0]["ticker"] == "NVDA"


def test_trade_summary_counts_open_positions_and_closed_trades(conn):
    open_pos = _add_position(conn, "u1", "NVDA")
    closed_pos = _add_position(conn, "u1", "NVDA", closed_at=_now_iso())
    _add_trade(conn, "u1", "NVDA", closed_pos)

    summary = ticker_research.get_ticker_research_summary("u1", "NVDA", conn=conn)
    assert summary["tradeSummary"] == {"openPositions": 1, "closedTrades": 1}


def test_ticker_workspace_with_zero_research_returns_an_honest_empty_summary(conn):
    summary = ticker_research.get_ticker_research_summary("u1", "ZZZZ", conn=conn)
    assert summary["notes"] == []
    assert summary["activeTheses"] == []
    assert summary["pastTheses"] == []
    assert summary["facts"] == []
    assert summary["tradeSummary"] == {"openPositions": 0, "closedTrades": 0}


def test_ticker_workspace_is_tenant_scoped(conn):
    note = _create(conn, "u1", "u1's NVDA note", ticker="NVDA")
    _add_position(conn, "u1", "NVDA")
    summary = ticker_research.get_ticker_research_summary("u2", "NVDA", conn=conn)
    assert summary["notes"] == []
    assert summary["tradeSummary"] == {"openPositions": 0, "closedTrades": 0}


def test_removing_a_notes_only_qualifying_entity_relationship_drops_it_from_the_workspace(conn):
    note = _create(conn, "u1", "Temp NVDA note")
    _add_mention(conn, note["id"], "u1", "NVDA")
    before = ticker_research.get_ticker_research_summary("u1", "NVDA", conn=conn)
    assert [n["id"] for n in before["notes"]] == [note["id"]]

    conn.execute("DELETE FROM j2_note_mentions WHERE note_id = ? AND symbol = ?", (note["id"], "NVDA"))
    conn.commit()
    after = ticker_research.get_ticker_research_summary("u1", "NVDA", conn=conn)
    assert after["notes"] == []
