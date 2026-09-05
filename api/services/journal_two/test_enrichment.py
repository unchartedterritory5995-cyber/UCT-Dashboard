"""Tests for post-migration ticker enrichment (api/services/journal_two/enrichment.py).

Part 2 of the arrival/enrichment work (spec §8.1): after an import, scan the
imported notes for ticker mentions and offer a live chart on them. The matcher
itself is NOT reinvented here -- `scan_notes_for_tickers` is a thin, honest
wrapper over `api.services.buzz_extract.extract`, the same matcher `/buzz`
uses in production (curated TICKER_DESPITE_LOWERCASE, cashtag-beats-universe,
RS/EMA/MA/GAP/PEG excluded as ambiguous). These tests exist to prove TWO
things: (1) the wrapper composes correctly with the notebook's own data
(body_plain, per-user isolation, the note-embeds sidecar), and (2) the
inherited precision actually holds on journal-shaped prose, not just chat.
"""
from __future__ import annotations

import sqlite3

import pytest

from api.services.journal_two import enrichment
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.db import ensure_schema


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    yield c
    c.close()


def _doc(text):
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}


def _make_note(conn, user_id, text, title="Note"):
    n = notes_svc.create_note(user_id, {"title": title, "bodyJson": _doc(text)}, conn=conn)
    return n["id"]


# ── basic composition ────────────────────────────────────────────────────────

def test_scan_reports_notes_with_ticker_mentions(conn):
    n1 = _make_note(conn, "u1", "Bought some $NVDA today ahead of earnings.")
    n2 = _make_note(conn, "u1", "Just a plain diary entry about my morning routine.")
    result = enrichment.scan_notes_for_tickers("u1", [n1, n2], conn=conn)
    ids = {c["id"] for c in result["candidates"]}
    assert ids == {n1}
    row = next(c for c in result["candidates"] if c["id"] == n1)
    assert row["tickers"] == ["NVDA"]
    assert result["scanned"] == 2


def test_scan_only_sees_the_calling_users_own_notes(conn):
    mine = _make_note(conn, "u1", "Watching $TSLA into the print.")
    theirs = _make_note(conn, "u2", "Watching $TSLA into the print.")
    result = enrichment.scan_notes_for_tickers("u1", [mine, theirs], conn=conn)
    ids = {c["id"] for c in result["candidates"]}
    assert ids == {mine}
    assert result["scanned"] == 1  # theirs was never even readable by u1


def test_scan_ignores_unknown_note_ids(conn):
    n1 = _make_note(conn, "u1", "watching Dell here")
    result = enrichment.scan_notes_for_tickers("u1", [n1, "does-not-exist"], conn=conn)
    assert result["scanned"] == 1
    assert [c["id"] for c in result["candidates"]] == [n1]


def test_scan_returns_no_candidates_when_nothing_mentions_a_ticker(conn):
    n1 = _make_note(conn, "u1", "Grocery list: eggs, milk, bread.")
    result = enrichment.scan_notes_for_tickers("u1", [n1], conn=conn)
    assert result["candidates"] == []
    assert result["scanned"] == 1


def test_scan_excludes_a_note_that_already_carries_a_chart_embed_for_that_symbol(conn):
    n1 = _make_note(conn, "u1", "Bought $NVDA today ahead of earnings.")
    notes_svc.append_widget_embed(
        "u1", n1,
        {"v": 1, "widgetId": "chart", "params": {"symbol": "NVDA", "tf": "D"}, "mode": "live"},
        conn=conn,
    )
    result = enrichment.scan_notes_for_tickers("u1", [n1], conn=conn)
    assert result["candidates"] == []


def test_scan_still_offers_a_different_ticker_in_a_note_already_charted_on_one_symbol(conn):
    n1 = _make_note(conn, "u1", "Rotated out of $NVDA and into $AMD this week.")
    notes_svc.append_widget_embed(
        "u1", n1,
        {"v": 1, "widgetId": "chart", "params": {"symbol": "NVDA", "tf": "D"}, "mode": "live"},
        conn=conn,
    )
    result = enrichment.scan_notes_for_tickers("u1", [n1], conn=conn)
    assert len(result["candidates"]) == 1
    assert result["candidates"][0]["tickers"] == ["AMD"]


def test_scan_bounds_a_pathological_request_and_says_so(conn, monkeypatch):
    monkeypatch.setattr(enrichment, "_SCAN_MAX_NOTES", 2)
    ids = [_make_note(conn, "u1", f"Watching $NVDA #{i}") for i in range(5)]
    result = enrichment.scan_notes_for_tickers("u1", ids, conn=conn)
    assert result["scanned"] == 2
    assert result["truncated"] is True


# ── reused precision: the false-positive check ───────────────────────────────
# These sentences are deliberately journal-shaped (trading-journal register,
# not Discord chat) and deliberately hit the exact ambiguous set the brief
# calls out (RS/EMA/MA/GAP/PEG) plus a few of buzz_extract's own curated
# collisions, to prove the inherited precision actually survives the move
# from chat text to note text.

@pytest.mark.parametrize("text", [
    "RS line is basing here, watching for a turn.",
    "EMA reclaim looks constructive on the daily.",
    "MA stack is fully bullish across the board.",
    "There was a GAP fill into the 50 day today.",
    "PEG ratio still looks rich at these levels.",
    "Reviewing my trade plan for tomorrow AM.",
    "This IT infrastructure buildout theme is everywhere.",
    "Not sure if I should add here, will see how it holds up.",
])
def test_scan_does_not_flag_ambiguous_technical_terms_in_journal_prose(conn, text):
    n1 = _make_note(conn, "u1", text)
    result = enrichment.scan_notes_for_tickers("u1", [n1], conn=conn)
    assert result["candidates"] == [], f"false positive on: {text!r} -> {result['candidates']}"


def test_scan_still_finds_a_real_ticker_next_to_ambiguous_words(conn):
    # The point isn't that RS/EMA/MA never appear near a real ticker -- it's
    # that they don't themselves book a phantom mention.
    n1 = _make_note(conn, "u1", "DELL reclaiming the 20 EMA, RS line turning up too.")
    result = enrichment.scan_notes_for_tickers("u1", [n1], conn=conn)
    assert len(result["candidates"]) == 1
    assert result["candidates"][0]["tickers"] == ["DELL"]


# ── Wave 0 trash: a trashed note is never offered a ticker-embed suggestion ─

def test_scan_excludes_a_trashed_note_it_is_about_to_be_purged(conn):
    n1 = _make_note(conn, "u1", "Bought some $NVDA today ahead of earnings.")
    notes_svc.delete_note("u1", n1, conn=conn)
    result = enrichment.scan_notes_for_tickers("u1", [n1], conn=conn)
    assert result["candidates"] == []
    assert result["scanned"] == 0
