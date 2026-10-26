"""Notebook widgets wave 11, Task 11.9: the member's suggested value for each "pick yours" choice.

`gallery_suggest.suggest` answers, per asked type, the member's own most-used value (`{"value", "label"}`) or None,
from bounded newest-first scans of the member's own rows only. No data is None, never a zero (W9-R7); a number is
never suggested; member B's rows never reach member A."""
from __future__ import annotations

import json
import uuid

import pytest

from api.services.journal_two import gallery_suggest as gs
from api.services.journal_two.widget_engine import share
from tests.test_widget_sources import (  # noqa: F401 -- `conn` is a fixture used by name
    NOW, UID, add_account, add_trade, add_user, conn,
)

B = "u-suggest-b"
PROP = "c" * 32


def _note(c, uid, *, folder=None, props=None, created="2026-10-20T15:00:00Z", import_source=None):
    nid = str(uuid.uuid4())
    c.execute("INSERT INTO j2_notes (id, user_id, title, folder_id, properties_json, created_at, updated_at,"
              " import_source) VALUES (?, ?, 't', ?, ?, ?, ?, ?)",
              (nid, uid, folder, json.dumps(props) if props else None, created, created, import_source))
    c.commit()
    return nid


def _folder(c, uid, name):
    fid = str(uuid.uuid4())
    c.execute("INSERT INTO j2_note_folders (id, user_id, name, created_at) VALUES (?, ?, ?, ?)",
              (fid, uid, name, NOW))
    c.commit()
    return fid


def _prop(c, uid, pid, name, ptype="number"):
    c.execute("INSERT INTO j2_note_properties (id, user_id, name, type, created_at, updated_at)"
              " VALUES (?, ?, ?, ?, ?, ?)", (pid, uid, name, ptype, NOW, NOW))
    c.commit()


def _routine(c, uid, name, *, tick_at=None, archived=None):
    rid = str(uuid.uuid4())
    c.execute("INSERT INTO j2_routines (id, user_id, name, items_json, settings_json, created_at, updated_at,"
              " archived_at) VALUES (?, ?, ?, '[]', '{}', ?, ?, ?)", (rid, uid, name, NOW, NOW, archived))
    if tick_at:
        c.execute("INSERT INTO j2_routine_ticks (user_id, routine_id, day, item_id, ticked, updated_at)"
                  " VALUES (?, ?, '2026-10-20', 'i1', 1, ?)", (uid, rid, tick_at))
    c.commit()
    return rid


def _tracker(c, uid, name, *, value_at=None):
    tid = str(uuid.uuid4())
    c.execute("INSERT INTO j2_trackers (id, user_id, name, kind, settings_json, created_at, updated_at)"
              " VALUES (?, ?, ?, 'scale', '{}', ?, ?)", (tid, uid, name, NOW, NOW))
    if value_at:
        c.execute("INSERT INTO j2_tracker_values (user_id, tracker_id, day, value, updated_at)"
                  " VALUES (?, ?, '2026-10-20', 3, ?)", (uid, tid, value_at))
    c.commit()
    return tid


def test_most_used_per_type(conn):
    main = add_account(conn, UID, "Main")
    swing = add_account(conn, UID, "Swing")
    # Flag is used 3 times, one of them on a FLAGGED trade: "most used" counts it (analytics_excluded not applied)
    add_trade(conn, UID, day="2026-10-20", setup="Flag", symbol="NVDA", mistakes=["fomo"], account=main)
    add_trade(conn, UID, day="2026-10-21", setup="Flag", symbol="NVDA", emotions=["calm"], account=main)
    add_trade(conn, UID, day="2026-10-22", setup="Flag", symbol="AMD", mistakes=["fomo"], excluded=1,
              account=main)
    add_trade(conn, UID, day="2026-10-23", setup="Base", symbol="AMD", account=swing)
    add_trade(conn, UID, day="2026-10-23", setup="Base", symbol="TSLA", account=swing)
    research = _folder(conn, UID, "Research")
    journal = _folder(conn, UID, "Journal")
    _prop(conn, UID, PROP, "Conviction")
    _prop(conn, UID, "d" * 32, "Sleep hours")
    for _ in range(3):
        _note(conn, UID, folder=research, props={"builtin:note_kind": "daily_prep", PROP: 4})
    _note(conn, UID, folder=journal, props={"builtin:note_kind": "trade_plan", "d" * 32: 7})
    _routine(conn, UID, "Old routine", tick_at="2026-10-19T10:00:00Z")
    newest = _routine(conn, UID, "Morning routine", tick_at="2026-10-22T10:00:00Z")
    _routine(conn, UID, "Archived routine", tick_at="2026-10-23T10:00:00Z", archived=NOW)
    _tracker(conn, UID, "Energy", value_at="2026-10-19T10:00:00Z")
    sleep = _tracker(conn, UID, "Sleep", value_at="2026-10-22T10:00:00Z")

    out = gs.suggest(UID, share.SLOT_TYPES, conn=conn)

    assert set(out) == set(share.SLOT_TYPES)
    assert out["setup"] == {"value": "Flag", "label": "Flag"}
    assert out["tag"] == {"value": "fomo", "label": "fomo"}
    assert out["symbol"] == {"value": "AMD", "label": "AMD"}       # 2 vs 2: the newest (first met) wins
    assert out["account"] == {"value": main, "label": "Main"}     # the member's own name
    assert out["folder"] == {"value": research, "label": "Research"}
    assert out["note_kind"] == {"value": "daily_prep", "label": "Daily prep"}
    assert out["property"] == {"value": PROP, "label": "Conviction"}
    assert out["routine"] == {"value": newest, "label": "Morning routine"}   # never the archived one
    assert out["tracker"] == {"value": sleep, "label": "Sleep"}
    assert out["number"] is None


def test_no_data_answers_none_never_zero(conn):
    out = gs.suggest(UID, share.SLOT_TYPES, conn=conn)
    assert out == {t: None for t in share.SLOT_TYPES}
    # a value of nothing (blank setups, empty tags) is not a value either
    add_trade(conn, UID, day="2026-10-20", setup="  ", mistakes=[])
    out = gs.suggest(UID, ("setup", "tag", "account"), conn=conn)
    assert out == {"setup": None, "tag": None, "account": None}
    for v in out.values():
        assert v not in (0, "0", "", {}, [])
    # an unknown type is not answered at all
    assert gs.suggest(UID, ("bogus",), conn=conn) == {}


def test_bounded_scan_5001(conn):
    add_trade(conn, UID, day="2026-10-20", setup="Flag")
    _note(conn, UID, folder=_folder(conn, UID, "F"))
    seen: list[str] = []
    conn.set_trace_callback(seen.append)
    try:
        gs.suggest(UID, share.SLOT_TYPES, conn=conn)
    finally:
        conn.set_trace_callback(None)
    trades = [s for s in seen if "FROM j2_trades" in s]
    notes = [s for s in seen if "FROM j2_notes" in s]
    assert len(trades) == 1 and len(notes) == 1                    # ONE scan each, for every type it answers
    assert "ORDER BY exit_date DESC LIMIT 5001" in trades[0]
    assert "analytics_excluded" not in trades[0]                   # flagged trades included for "most used"
    assert "LIMIT 5001" in notes[0] and "ORDER BY created_at DESC" in notes[0]
    assert "import_source" in notes[0]                             # the sample notebook is never "most used"
    assert gs.SCAN_LIMIT == 5001
    for s in seen:
        if "j2_routine_ticks" in s or "j2_tracker_values" in s:
            assert "LIMIT 1" in s


def test_second_member_never_crosses(conn):
    add_user(conn, B)
    b_acc = add_account(conn, B, "B main")
    for d in ("2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"):
        add_trade(conn, B, day=d, setup="B only", symbol="BONLY", mistakes=["b-tag"], account=b_acc)
    b_folder = _folder(conn, B, "B folder")
    _prop(conn, B, "e" * 32, "B prop")
    for _ in range(3):
        _note(conn, B, folder=b_folder, props={"builtin:note_kind": "trade_plan", "e" * 32: 1})
    _routine(conn, B, "B routine", tick_at="2026-10-23T10:00:00Z")
    _tracker(conn, B, "B tracker", value_at="2026-10-23T10:00:00Z")
    # A has nothing at all: every answer is None, never one of B's
    assert gs.suggest(UID, share.SLOT_TYPES, conn=conn) == {t: None for t in share.SLOT_TYPES}
    # A's own single use wins over B's four
    add_trade(conn, UID, day="2026-10-20", setup="A setup", symbol="AONE", account=b_acc)   # B's id on A's row
    out = gs.suggest(UID, ("setup", "symbol", "account"), conn=conn)
    assert out["setup"]["value"] == "A setup" and out["symbol"]["value"] == "AONE"
    assert out["account"] is None                                  # an id that is not A's account is never answered
    # an A note filed in B's folder id answers nothing either
    _note(conn, UID, folder=b_folder)
    assert gs.suggest(UID, ("folder",), conn=conn) == {"folder": None}


def test_number_never_suggested(conn):
    add_trade(conn, UID, day="2026-10-20", setup="Flag", pnl=500.0)
    assert gs.suggest(UID, ("number",), conn=conn) == {"number": None}
    assert gs.suggest(UID, ("number", "setup"), conn=conn)["number"] is None
    with pytest.raises(ValueError):
        gs.suggest("", ("setup",), conn=conn)


# -- fix round 1 (ruling c2, review M-2, M-3) ----------------------------------------------------------

def test_suggestion_matches_the_choice_source(conn):
    """Ruling c2: a notes tag choice suggests a NOTE tag; a mistake tag choice a mistake; a notes symbol choice
    a note ticker. Each scan runs once however many choices read it."""
    add_trade(conn, UID, day="2026-10-20", symbol="NVDA", mistakes=["fomo"], emotions=["calm"])
    add_trade(conn, UID, day="2026-10-21", symbol="NVDA", mistakes=["fomo"], emotions=["calm", "bored"])
    add_trade(conn, UID, day="2026-10-22", symbol="NVDA", emotions=["calm"])
    for tags, ticker in ((["earnings", "swing"], "aapl"), (["earnings"], "AAPL"), (["swing", "earnings"], "MSFT")):
        nid = _note(conn, UID)
        conn.execute("UPDATE j2_notes SET tags = ?, ticker = ? WHERE id = ?", (json.dumps(tags), ticker, nid))
    conn.commit()
    slots = [{"id": "p1", "type": "tag", "source": "notes", "field": "tag"},
             {"id": "p2", "type": "tag", "source": "closed_trades", "field": "mistake"},
             {"id": "p3", "type": "tag", "source": "closed_trades", "field": "emotion"},
             {"id": "p4", "type": "symbol", "source": "notes", "field": "ticker"},
             {"id": "p5", "type": "symbol", "source": "closed_trades", "field": "symbol"},
             {"id": "p6", "type": "number", "source": "closed_trades", "field": "net"},
             {"id": "bad", "type": "nope"}]
    seen: list[str] = []
    conn.set_trace_callback(seen.append)
    try:
        out = gs.suggest_for(UID, slots, conn=conn)
    finally:
        conn.set_trace_callback(None)
    assert out == {"p1": {"value": "earnings", "label": "earnings"},
                   "p2": {"value": "fomo", "label": "fomo"},
                   "p3": {"value": "calm", "label": "calm"},
                   "p4": {"value": "AAPL", "label": "AAPL"},
                   "p5": {"value": "NVDA", "label": "NVDA"},
                   "p6": None}
    assert sum("FROM j2_trades" in s for s in seen) == 1 and sum("FROM j2_notes" in s for s in seen) == 1


def test_both_scans_run_on_an_index_without_a_sort(conn):
    """Review M-2: each scan reads an index in its own order (no temp B-tree sorts every row before the limit)."""
    plans = [conn.execute("EXPLAIN QUERY PLAN " + gs.trades_sql(), (UID,)).fetchall(),
             conn.execute("EXPLAIN QUERY PLAN " + gs.notes_sql(UID)[0], gs.notes_sql(UID)[1]).fetchall()]
    for rows in plans:
        text = " | ".join(str(r[-1]) for r in rows)
        assert "USING INDEX" in text and "TEMP B-TREE" not in text, text


def test_the_bound_decides_the_answer(conn, monkeypatch):
    """Review M-3: the scan stops at `SCAN_LIMIT` newest rows: past the bound, older rows cannot decide."""
    for d in ("2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"):
        add_trade(conn, UID, day=d, setup="Old")
    for d in ("2026-10-20", "2026-10-21", "2026-10-22"):
        add_trade(conn, UID, day=d, setup="New")
    assert gs.suggest(UID, ("setup",), conn=conn)["setup"]["value"] == "Old"
    monkeypatch.setattr(gs, "SCAN_LIMIT", 3)
    assert gs.suggest(UID, ("setup",), conn=conn)["setup"]["value"] == "New"
    assert "LIMIT 3" in gs.trades_sql() and "LIMIT 3" in gs.notes_sql(UID)[0]
