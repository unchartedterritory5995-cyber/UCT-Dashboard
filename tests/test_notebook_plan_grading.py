"""Wave 13 lane 13A -- plan vs execution grading (`plan_grading.py` + its router).

Rails, each a ruling:
  * R4 constants pinned value by value, and every tolerance tested ON its boundary and one tick
    past it, long and short (a `<=` turned `<`, or a sign flipped, reds here);
  * the freeze: the first match is stored; editing the plan afterwards -- and a second matcher
    -- never changes it; only Re-link does, and the replaced row is kept;
  * the plan is read AS IT STOOD AT ENTRY (version history); a plan only readable after entry is
    graded and labelled "plan edited after entry";
  * precedence (explicit link, then verdict, then a note within 30 days) and the tie;
  * Unplanned is labelled, never hidden; the MIRROR: 30 broker trades in, 30 out, byte-identical;
  * stable keys: a broker purge + reinsert (fresh ids, same external_id) keeps the frozen plan;
  * R3 sample wording; options counted, not graded; the gate (404 before the session) and the
    route round-trip; the purge and the address-space census.
"""
from __future__ import annotations

import hashlib
import importlib
import json
import os
import tempfile
import uuid
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

FLAG = "NOTEBOOK_PLAN_GRADING_ENABLED"
U, OTHER = "user-plan-a", "user-plan-b"
ROOT = Path(__file__).resolve().parents[1]


# ── fixtures ────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = auth_db.get_connection()
    for uid in (U, OTHER):
        conn.execute("INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)",
                     (uid, f"{uid}@example.com", "x", uid, "member"))
    conn.commit()
    conn.close()
    yield tmp.name
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


@pytest.fixture
def conn(db_path):
    from api.services.auth_db import get_connection
    c = get_connection()
    yield c
    c.close()


@pytest.fixture
def pg(db_path):
    from api.services.journal_two import plan_grading
    return plan_grading


@pytest.fixture
def app(db_path):
    from api.routers import notebook_plan_grades
    fa = FastAPI()
    fa.include_router(notebook_plan_grades.router)
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": U, "role": "member", "plan": "pro"}
    fa.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {"id": U, "role": "member", "plan": "pro"}
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    return TestClient(app)


def add_trade(conn, *, symbol="NVDA", side="Long", shares=100, entry=100.0, exit_=110.0,
              entry_date="2026-09-10T14:30:00+00:00", exit_date="2026-09-15T15:00:00+00:00",
              stop=95.0, setup=None, source=None, external_id=None, user=U, ctx="{}", tid=None,
              account_id=None):
    tid = tid or f"t-{uuid.uuid4().hex[:10]}"
    conn.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price, entry_date,"
        " exit_price, exit_date, original_stop, setup, notes, pnl_dollar, pnl_percent, r_multiple, hold_days,"
        " result, context_at_entry, created_at, source, external_id, account_id)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,NULL,1,?,?,?,?,?,?)",
        (tid, user, f"manual-{tid}", symbol, side, shares, entry, entry_date, exit_, exit_date, stop, setup,
         (exit_ - entry) * shares * (1 if side == "Long" else -1), 0.1, "Win", ctx, exit_date, source,
         external_id, account_id))
    conn.commit()
    return tid


def add_note(conn, *, body, ticker="NVDA", created="2026-09-05T12:00:00+00:00", updated=None,
             props=None, user=U, title="Plan", nid=None, tags=()):
    nid = nid or f"n-{uuid.uuid4().hex[:10]}"
    conn.execute(
        "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, ticker, tags, created_at, updated_at,"
        " properties_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (nid, user, title, json.dumps(body), "", ticker, json.dumps(list(tags)), created, updated or created,
         json.dumps(props) if props is not None else None))
    conn.commit()
    return nid


def edit_note(conn, nid, body, at):
    """What notes.update_note does to the history: the pre-edit state becomes a version stamped
    with the time it became current, then the row takes the new body."""
    row = conn.execute("SELECT * FROM j2_notes WHERE id = ?", (nid,)).fetchone()
    conn.execute("INSERT INTO j2_note_versions (id, user_id, note_id, title, subtitle, body_json, body_plain,"
                 " properties_json, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                 (uuid.uuid4().hex, row["user_id"], nid, row["title"], None, row["body_json"], "",
                  row["properties_json"], row["updated_at"]))
    conn.execute("UPDATE j2_notes SET body_json = ?, updated_at = ? WHERE id = ?", (json.dumps(body), at, nid))
    conn.commit()


def link_note(conn, nid, tid, user=U):
    conn.execute("INSERT INTO j2_note_embeds (note_id, user_id, position, widget_id, symbol, trade_ref,"
                 " trade_ref_type) VALUES (?,?,?,?,?,?,?)", (nid, user, 0, "chart", "NVDA", tid, "equity_trade"))
    conn.commit()


def add_verdict(conn, *, symbol="NVDA", entry=100.0, stop=96.0, target=120.0, shares=50,
                created="2026-09-09T12:00:00+00:00", side="Long", label="GO", user=U, setup="Breakout"):
    vid = f"v-{uuid.uuid4().hex[:10]}"
    conn.execute("INSERT INTO j2_verdicts (id, user_id, account_id, symbol, side, shares, entry_price, stop_price,"
                 " target_price, setup, label, paragraph, source, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                 (vid, user, "acct", symbol, side, shares, entry, stop, target, setup, label, "p", "hard_check", created))
    conn.commit()
    return vid


def plan_body(entry=100, stop=95, target=120, shares=100):
    lines = [f"Entry: {entry}", f"Stop: {stop}", f"Target: {target}", f"Shares: {shares}"]
    return {"type": "doc", "content": [{"type": "bulletList", "content": [
        {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": s}]}]}
        for s in lines]}]}


def trade_row(conn, tid):
    return conn.execute("SELECT * FROM j2_trades WHERE id = ?", (tid,)).fetchone()


# ── R4: the constants, value by value ──────────────────────────────────────────────────────

def test_the_constants_block_is_pinned_value_by_value(pg):
    assert dict(pg.CONSTANTS) == {
        "ENTRY_TOL_R": 0.25, "ENTRY_TOL_PCT": 0.005, "STOP_SLIP_R": 0.25, "SIZE_TOL_PCT": 0.10,
        "TARGET_SHORTFALL_R": 0.25, "MATCH_WINDOW_DAYS": 30, "SAMPLE_TOO_FEW_BELOW": 10,
        "SAMPLE_NORMAL_FROM": 25, "DISCIPLINE_WINDOWS": (20, 60), "RANGE_Z": 1.96,
    }
    with pytest.raises(TypeError):
        pg.CONSTANTS["ENTRY_TOL_R"] = 1   # read-only: one block, never patched at runtime


# ── the four checks on their boundaries ───────────────────────────────────────────────────

LONG_PLAN = {"entry": 100.0, "stop": 96.0, "target": 120.0, "shares": 100.0, "roles": {}}   # R = 4
SHORT_PLAN = {"entry": 100.0, "stop": 104.0, "target": 80.0, "shares": 100.0, "roles": {}}  # R = 4


def checks(pg, plan, side, entry, exit_, shares=100, mfe=None):
    return pg.grade_checks(plan, {"side": side, "entryPrice": entry, "exitPrice": exit_, "shares": shares},
                           mfe_price=mfe)


@pytest.mark.parametrize("plan,side,on,past", [
    # tolerance = max(0.25 x 4, 0.5% x 100) = 1.0
    (LONG_PLAN, "Long", 101.0, 101.01), (LONG_PLAN, "Long", 99.0, 98.99),
    (SHORT_PLAN, "Short", 99.0, 98.99), (SHORT_PLAN, "Short", 101.0, 101.01),
])
def test_entry_kept_on_the_boundary_missed_one_tick_past(pg, plan, side, on, past):
    assert checks(pg, plan, side, on, 110 if side == "Long" else 90)["entry"]["state"] == "kept"
    assert checks(pg, plan, side, past, 110 if side == "Long" else 90)["entry"]["state"] == "missed"


def test_entry_tolerance_is_the_larger_of_quarter_r_and_half_a_percent(pg):
    tight = {"entry": 100.0, "stop": 99.0, "target": 105.0, "shares": 10.0, "roles": {}}   # R=1: 0.25 < 0.5
    assert checks(pg, tight, "Long", 100.5, 104)["entry"]["state"] == "kept"
    assert checks(pg, tight, "Long", 100.51, 104)["entry"]["state"] == "missed"
    assert checks(pg, tight, "Long", 100.5, 104)["entry"]["tolerance"] == 0.5


@pytest.mark.parametrize("plan,side,on,past", [
    # honoured at or better than stop -/+ 0.25R = 95.0 (long) / 105.0 (short)
    (LONG_PLAN, "Long", 95.0, 94.99), (SHORT_PLAN, "Short", 105.0, 105.01),
])
def test_stop_honoured_on_the_slippage_line_not_one_tick_past(pg, plan, side, on, past):
    assert checks(pg, plan, side, 100, on)["stop"]["state"] == "kept"
    assert checks(pg, plan, side, 100, past)["stop"]["state"] == "missed"


@pytest.mark.parametrize("on,past", [(110, 110.01), (90, 89.99)])
def test_size_within_ten_percent_on_the_boundary(pg, on, past):
    assert checks(pg, LONG_PLAN, "Long", 100, 110, shares=on)["size"]["state"] == "kept"
    assert checks(pg, LONG_PLAN, "Long", 100, 110, shares=past)["size"]["state"] == "missed"


@pytest.mark.parametrize("plan,side,hit,short_of,mfe_hit,mfe_miss", [
    # hit within 0.25R of target: long 119, short 81; reached = MFE at/through the target
    (LONG_PLAN, "Long", 119.0, 118.99, 120.0, 119.99),
    (SHORT_PLAN, "Short", 81.0, 81.01, 80.0, 80.01),
])
def test_target_hit_reached_not_taken_not_reached(pg, plan, side, hit, short_of, mfe_hit, mfe_miss):
    assert checks(pg, plan, side, 100, hit)["target"]["state"] == "hit"
    assert checks(pg, plan, side, 100, short_of)["target"]["state"] == "unknown"     # no excursion yet
    assert checks(pg, plan, side, 100, short_of, mfe=mfe_hit)["target"]["state"] == "reached_not_taken"
    assert checks(pg, plan, side, 100, short_of, mfe=mfe_miss)["target"]["state"] == "not_reached"


def test_a_missing_input_reads_none_and_an_unreadable_one_says_so(pg):
    no_stop = {"entry": 100.0, "stop": None, "target": None, "shares": None, "roles": {}}
    c = checks(pg, no_stop, "Long", 100, 110)
    assert [c[k]["state"] for k in ("entry", "stop", "size", "target")] == ["none"] * 4
    assert c["followedPlan"] is None
    bad = {**LONG_PLAN, "entry": None, "roles": {"entry": {"state": "unreadable"}}}
    assert checks(pg, bad, "Long", 100, 110)["entry"]["state"] == "unreadable"


def test_a_plan_on_the_wrong_side_does_not_grade_stop_or_target(pg):
    c = checks(pg, LONG_PLAN, "Short", 100, 90)
    assert c["sideMismatch"] is True
    assert c["stop"]["state"] == "none" and c["target"]["state"] == "none"


def test_followed_plan_means_entry_stop_and_size_all_kept(pg):
    assert checks(pg, LONG_PLAN, "Long", 100, 110)["followedPlan"] is True
    assert checks(pg, LONG_PLAN, "Long", 100, 90)["followedPlan"] is False


# ── matching, the freeze, as-of-entry ──────────────────────────────────────────────────────

def test_a_window_note_matches_and_freezes(conn, pg):
    nid = add_note(conn, body=plan_body())
    tid = add_trade(conn)
    p = pg.grade_payload(conn, U, trade_row(conn, tid))
    assert p["status"] == "planned"
    assert p["plan"]["noteId"] == nid and p["plan"]["matchTier"] == "window"
    assert p["checks"]["entry"]["state"] == "kept"
    assert conn.execute("SELECT COUNT(*) FROM j2_trade_plan_links").fetchone()[0] == 1


def test_FREEZE_editing_the_plan_after_the_match_never_changes_the_grade(conn, pg):
    nid = add_note(conn, body=plan_body(entry=100, stop=95))
    tid = add_trade(conn, entry=100)
    before = pg.grade_payload(conn, U, trade_row(conn, tid))
    edit_note(conn, nid, plan_body(entry=130, stop=120), "2026-09-20T12:00:00+00:00")
    after = pg.grade_payload(conn, U, trade_row(conn, tid))
    assert after["plan"]["entry"] == before["plan"]["entry"] == 100.0
    assert after["checks"] == before["checks"]
    assert after["plan"]["matchedAt"] == before["plan"]["matchedAt"]


def test_FREEZE_a_second_matcher_cannot_overwrite_the_first(conn, pg):
    from api.services.journal_two import plan_extract
    nid = add_note(conn, body=plan_body(entry=100))
    tid = add_trade(conn)
    row = trade_row(conn, tid)
    pg.match_trade(conn, U, row)
    moment = pg.entry_moment(row["entry_date"])
    fake = {"kind": "note", "id": nid, "reading": plan_extract.read_note_plan(plan_body(entry=999), symbol="NVDA"),
            "version_id": "v", "plan_as_of": "x", "edited_after_entry": False}
    assert pg.freeze(conn, U, "id:" + tid, "NVDA", fake, "window", moment) is False
    assert pg.get_link(conn, U, "id:" + tid)["plan"]["entry"] == 100.0


def test_the_plan_is_read_as_it_stood_at_entry(conn, pg):
    """Edited AFTER entry but before anyone graded it: the pre-entry version is what counts."""
    nid = add_note(conn, body=plan_body(entry=100, stop=95), created="2026-09-05T12:00:00+00:00")
    edit_note(conn, nid, plan_body(entry=150, stop=140), "2026-09-12T12:00:00+00:00")
    tid = add_trade(conn, entry_date="2026-09-10T14:30:00+00:00")
    p = pg.grade_payload(conn, U, trade_row(conn, tid))
    assert p["plan"]["entry"] == 100.0
    assert "edited_after_entry" not in p["labels"]
    assert p["plan"]["versionId"] != "current@2026-09-12T12:00:00+00:00"


def test_a_plan_only_readable_after_entry_is_graded_and_labelled(conn, pg):
    empty = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "TBD"}]}]}
    nid = add_note(conn, body=empty, created="2026-09-05T12:00:00+00:00")
    edit_note(conn, nid, plan_body(entry=100, stop=95), "2026-09-12T12:00:00+00:00")
    tid = add_trade(conn)
    p = pg.grade_payload(conn, U, trade_row(conn, tid))
    assert p["status"] == "planned" and "edited_after_entry" in p["labels"]


def test_a_note_written_after_the_trade_is_never_an_unlinked_plan(conn, pg):
    add_note(conn, body=plan_body(), created="2026-09-11T12:00:00+00:00")
    tid = add_trade(conn, entry_date="2026-09-10T14:30:00+00:00")
    assert pg.grade_payload(conn, U, trade_row(conn, tid))["status"] == "unplanned"


def test_a_note_older_than_the_window_is_not_a_plan_for_it(conn, pg):
    add_note(conn, body=plan_body(), created="2026-08-01T12:00:00+00:00")
    tid = add_trade(conn, entry_date="2026-09-10T14:30:00+00:00")
    assert pg.grade_payload(conn, U, trade_row(conn, tid))["status"] == "unplanned"


def test_a_review_note_is_never_read_as_the_next_trades_plan(conn, pg):
    """The review note's grade table names an Entry and a Stop; its tag keeps it out."""
    add_note(conn, body=plan_body(), tags=["plan-review"])
    tid = add_trade(conn)
    assert pg.grade_payload(conn, U, trade_row(conn, tid))["status"] == "unplanned"
    src = (ROOT / "app/src/pages/journal-2-0/lib/planReview.js").read_text(encoding="utf-8")
    assert f"export const REVIEW_TAG = '{pg.REVIEW_TAG}'" in src   # one fact in two files


def test_precedence_explicit_link_beats_verdict_beats_window(conn, pg):
    add_note(conn, body=plan_body(entry=101), title="window")
    vid = add_verdict(conn, entry=102, stop=97)
    tid = add_trade(conn)
    assert pg.grade_payload(conn, U, trade_row(conn, tid))["plan"]["verdictId"] == vid
    linked = add_note(conn, body=plan_body(entry=103), title="linked", created="2026-09-01T12:00:00+00:00")
    tid2 = add_trade(conn)
    link_note(conn, linked, tid2)
    p = pg.grade_payload(conn, U, trade_row(conn, tid2))
    assert p["plan"]["noteId"] == linked and p["plan"]["matchTier"] == "explicit"


def test_the_verdict_the_trade_was_entered_against_wins_over_a_later_one(conn, pg):
    old = add_verdict(conn, entry=99, stop=95, created="2026-09-08T12:00:00+00:00")
    add_verdict(conn, entry=101, stop=97, created="2026-09-09T12:00:00+00:00")
    tid = add_trade(conn, ctx=json.dumps({"compass_verdict_id": old}))
    assert pg.grade_payload(conn, U, trade_row(conn, tid))["plan"]["verdictId"] == old


def test_a_tie_is_the_members_pick_and_nothing_is_frozen(conn, pg):
    a = add_note(conn, body=plan_body(entry=100), title="A")
    b = add_note(conn, body=plan_body(entry=101), title="B")
    tid = add_trade(conn)
    p = pg.grade_payload(conn, U, trade_row(conn, tid))
    assert p["status"] == "needs_pick" and {c["id"] for c in p["candidates"]} == {a, b}
    assert conn.execute("SELECT COUNT(*) FROM j2_trade_plan_links").fetchone()[0] == 0
    pg.relink(conn, U, trade_row(conn, tid), note_id=b)
    assert pg.grade_payload(conn, U, trade_row(conn, tid))["plan"]["entry"] == 101.0


def test_relink_is_the_one_door_and_records_what_it_replaced(conn, pg):
    a = add_note(conn, body=plan_body(entry=100), title="A")
    tid = add_trade(conn)
    pg.grade_payload(conn, U, trade_row(conn, tid))
    b = add_note(conn, body=plan_body(entry=104, stop=99), title="B", created="2026-09-06T12:00:00+00:00")
    link = pg.relink(conn, U, trade_row(conn, tid), note_id=b)
    assert link["noteId"] == b and link["relinkCount"] == 1 and link["relinkedAt"]
    prev = json.loads(conn.execute("SELECT previous_json FROM j2_trade_plan_links").fetchone()[0])
    assert prev[0]["note_id"] == a
    none = pg.relink(conn, U, trade_row(conn, tid), none=True)
    assert none["sourceKind"] == "none"
    assert pg.grade_payload(conn, U, trade_row(conn, tid))["status"] == "member_none"
    with pytest.raises(pg.RelinkError):
        pg.relink(conn, U, trade_row(conn, tid), note_id="no-such-note")


def test_unplanned_is_labelled_and_matches_later_when_a_plan_is_linked(conn, pg):
    tid = add_trade(conn)
    assert pg.grade_payload(conn, U, trade_row(conn, tid))["status"] == "unplanned"
    assert conn.execute("SELECT COUNT(*) FROM j2_trade_plan_links").fetchone()[0] == 0   # not frozen
    nid = add_note(conn, body=plan_body(), created="2026-09-20T12:00:00+00:00", ticker=None)
    link_note(conn, nid, tid)
    p = pg.grade_payload(conn, U, trade_row(conn, tid))
    assert p["status"] == "planned" and "edited_after_entry" in p["labels"]


def test_a_date_only_entry_is_judged_by_day_and_labelled(conn, pg):
    add_note(conn, body=plan_body(), created="2026-09-10T20:00:00+00:00")   # 4 pm ET on entry day
    tid = add_trade(conn, entry_date="2026-09-10T00:00:00+00:00")
    p = pg.grade_payload(conn, U, trade_row(conn, tid))
    assert p["dateOnly"] is True and p["entryDay"] == "2026-09-10"
    assert p["status"] == "planned" and "date_only" in p["labels"]


def test_a_placeholder_stop_is_graded_on_the_plans_stop(conn, pg):
    add_note(conn, body=plan_body(entry=100, stop=96))
    tid = add_trade(conn, stop=100.0, source="broker", external_id="ext-1", exit_=94.5)
    p = pg.grade_payload(conn, U, trade_row(conn, tid))
    assert "stop_from_plan" in p["labels"]
    assert p["checks"]["stop"]["state"] == "missed" and p["checks"]["r"] == 4.0


def test_size_counts_every_close_of_one_entry(conn, pg):
    add_note(conn, body=plan_body(shares=300))
    a = add_trade(conn, shares=100)
    add_trade(conn, shares=200, exit_date="2026-09-16T15:00:00+00:00")
    p = pg.grade_payload(conn, U, trade_row(conn, a))
    assert p["enteredShares"] == 300 and p["checks"]["size"]["state"] == "kept"
    assert "size_from_closes" in p["labels"]


def test_the_setup_chip_appears_for_a_broker_trade_without_a_setup(conn, pg):
    add_verdict(conn, setup="Breakout")
    tid = add_trade(conn, source="broker", external_id="ext-s")
    assert pg.grade_payload(conn, U, trade_row(conn, tid))["setupChip"] == {"setup": "Breakout"}
    tid2 = add_trade(conn, source="broker", external_id="ext-s2", setup="Pullback")
    assert pg.grade_payload(conn, U, trade_row(conn, tid2))["setupChip"] is None


# ── mirror, stable keys ────────────────────────────────────────────────────────────────────

def _trades_digest(conn):
    rows = conn.execute("SELECT * FROM j2_trades ORDER BY id").fetchall()
    return hashlib.sha256(json.dumps([list(r) for r in rows]).encode()).hexdigest(), len(rows)


def test_MIRROR_thirty_broker_trades_in_thirty_out_and_none_altered(conn, pg):
    add_note(conn, body=plan_body(), ticker="NVDA")
    ids = [add_trade(conn, symbol="NVDA" if i % 3 else "AMD", source="broker", external_id=f"x{i}",
                     stop=100.0 if i % 2 else 95.0, exit_date=f"2026-09-{11 + i % 15:02d}T15:00:00+00:00")
           for i in range(30)]
    digest_before = _trades_digest(conn)
    st = pg.statuses(conn, U, ids)
    rec = pg.discipline_record(conn, U)
    for tid in ids:
        pg.grade_payload(conn, U, trade_row(conn, tid))
    assert set(st) == set(ids), "a trade was left out of the status answer"
    assert rec["windows"][1]["trades"] == 30 and rec["windows"][1]["equity"] == 30
    w = rec["windows"][1]
    assert w["planned"] + w["unplanned"] + w["needsPick"] == 30
    assert _trades_digest(conn) == digest_before, "grading wrote to j2_trades"


def test_STABLE_KEYS_a_broker_purge_and_reinsert_keeps_the_frozen_plan(conn, pg):
    """The member's Re-link (to B) must survive the purge. A matcher that re-ran on the fresh id
    would find TWO window plans (A and B) and answer needs_pick, so this cannot pass by
    re-deriving the same answer."""
    add_note(conn, body=plan_body(entry=100), title="A")
    tid = add_trade(conn, source="broker", external_id="fp-123")
    first = pg.grade_payload(conn, U, trade_row(conn, tid))
    b = add_note(conn, body=plan_body(entry=104, stop=99), title="B", created="2026-09-06T12:00:00+00:00")
    pg.relink(conn, U, trade_row(conn, tid), note_id=b)
    conn.execute("DELETE FROM j2_trades WHERE user_id = ? AND source = 'broker'", (U,))   # _purge_imported
    conn.commit()
    new_id = add_trade(conn, source="broker", external_id="fp-123")
    assert new_id != tid
    p = pg.grade_payload(conn, U, trade_row(conn, new_id))
    assert p["tradeRef"] == "ext:fp-123" and p["status"] == "planned"
    assert p["plan"]["entry"] == 104.0 and p["plan"]["noteId"] == b and p["plan"]["relinkCount"] == 1
    assert first["plan"]["entry"] == 100.0


def test_another_members_trade_is_not_visible(conn, pg, client, monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    theirs = add_trade(conn, user=OTHER)
    assert client.get(f"/api/j2/plan-grades/trades/{theirs}").status_code == 404
    assert client.get(f"/api/j2/plan-grades/status?ids={theirs}").json() == {"statuses": {}}


# ── R3 sample wording, the discipline record ───────────────────────────────────────────────

@pytest.mark.parametrize("n,band,wording", [(0, "too_few", "too few to judge"), (9, "too_few", "too few to judge"),
                                            (10, "thin", "thin sample"), (24, "thin", "thin sample"),
                                            (25, "normal", None), (60, "normal", None)])
def test_sample_wording_bands(pg, n, band, wording):
    s = pg.rate_stat(min(n, 5), n)
    assert (s["band"], s["wording"]) == (band, wording)
    assert (s["range"] is not None) == (band == "thin")


def test_the_thin_range_is_a_wilson_interval(pg):
    assert pg.wilson(10, 20) == (0.299, 0.701)
    assert pg.rate_stat(10, 20)["range"] == [0.299, 0.701]


def test_the_discipline_record_counts_options_without_grading_them(conn, pg):
    add_note(conn, body=plan_body())
    add_trade(conn)
    add_trade(conn, symbol="AMD")
    conn.execute("INSERT INTO j2_option_strategies (id, user_id, account_id, underlying, strategy_type, direction,"
                 " net_entry, entry_date, status, closed_at, created_at, updated_at) VALUES"
                 " ('o1', ?, 'acct', 'NVDA', 'long_call', 'bullish', 1.5, '2026-09-01', 'closed', '2026-09-20',"
                 " 'x', 'x')", (U,))
    conn.commit()
    w = pg.discipline_record(conn, U)["windows"][0]
    assert (w["trades"], w["equity"], w["options"], w["planned"], w["unplanned"]) == (3, 2, 1, 1, 1)
    assert w["planRate"]["wording"] == "too few to judge"


# ── the gate, the routes ───────────────────────────────────────────────────────────────────

def test_the_gate_is_off_by_default_and_answers_404_before_the_session(app, client, monkeypatch, pg):
    monkeypatch.delenv(FLAG, raising=False)
    assert pg.enabled() is False
    app.dependency_overrides.clear()     # signed out: an ON gate would answer 401
    for path in ("/api/j2/plan-grades/trades/x", "/api/j2/plan-grades/status?ids=a",
                 "/api/j2/plan-grades/discipline"):
        assert client.get(path).status_code == 404
    assert client.post("/api/j2/plan-grades/trades/x/relink", content=b"not json").status_code == 404
    monkeypatch.setenv(FLAG, "1")
    assert client.get("/api/j2/plan-grades/discipline").status_code == 401


def test_the_routes_round_trip(conn, client, monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    a = add_note(conn, body=plan_body(entry=100), title="A")
    tid = add_trade(conn)
    r = client.get(f"/api/j2/plan-grades/trades/{tid}")
    assert r.status_code == 200 and r.json()["status"] == "planned"
    assert client.get(f"/api/j2/plan-grades/status?ids={tid},nope").json()["statuses"][tid]["status"] == "planned"
    assert client.post(f"/api/j2/plan-grades/trades/{tid}/relink", json={}).status_code == 400
    assert client.post(f"/api/j2/plan-grades/trades/{tid}/relink", json={"none": True, "noteId": a}).status_code == 400
    r = client.post(f"/api/j2/plan-grades/trades/{tid}/relink", json={"none": True})
    assert r.status_code == 200 and r.json()["status"] == "member_none"
    assert client.post(f"/api/j2/plan-grades/trades/{tid}/relink", content=b"[1]").status_code == 422
    too_many = ",".join(f"i{i}" for i in range(201))
    assert client.get(f"/api/j2/plan-grades/status?ids={too_many}").status_code == 400
    d = client.get("/api/j2/plan-grades/discipline").json()
    assert [w["size"] for w in d["windows"]] == [20, 60]


# ── purge, census ──────────────────────────────────────────────────────────────────────────

def test_account_deletion_purges_the_links(conn, pg):
    add_note(conn, body=plan_body())
    tid = add_trade(conn)
    pg.grade_payload(conn, U, trade_row(conn, tid))
    from api.services.journal_two import account_purge
    report = account_purge.purge_user_data(U, conn)
    assert report["rows_deleted"].get("j2_trade_plan_links") == 1
    assert conn.execute("SELECT COUNT(*) FROM j2_trade_plan_links").fetchone()[0] == 0


def test_the_table_is_not_a_named_saved_object_so_needs_no_address(pg):
    from api.services import address_space
    tables = address_space.saved_object_tables(ROOT / "api")
    assert "j2_trade_plan_links" not in tables
    assert "j2_notes" in tables   # non-vacuity: the census sees the schema
