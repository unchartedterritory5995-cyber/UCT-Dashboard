"""Wave 13 lane 13D -- resurfacing: Awareness rules R7-R9, the level index, the sub-cap.

  * R1-R6 ARE BYTE-IDENTICAL: rules.py's first 12,811 bytes (LF) are exactly the blob they were
    before this lane (git d90b2e5f), and R1/R2/R4/R5/R6 produce a pinned output on fixtures.
  * EACH RULE FIRES ON ITS FIXTURE AND NOT JUST OFF THE BOUNDARY: R7's 0.5% band and its
    cross, R8's 8%, R9's day-of and 3-day lookback.
  * THE SUB-CAP: two a member a day, its OWN count -- a full shared 8/day budget never blocks
    one, and resurfacing rows never spend a shared slot.
  * IN-APP ONLY: every R7-R9 importance is under the away floor, and even a candidate forced to
    importance 10 never reaches deliver_alert_payload.
  * THE INDEX is a projection of plan_extract (the one reader) -- with that reader stubbed out,
    no price level exists; placeholder stops never index; a trashed note leaves; the version
    that NAMED a level is the one the notice opens.
  * PURGE takes both tables. FLAG OFF: the pass never runs and no link is attached.

No network: prices are written into the shared live-price cache by the test; no model call.
"""
from __future__ import annotations

import ast
import gc
import hashlib
import importlib
import inspect
import os
import sqlite3
import tempfile
import uuid
from datetime import date
from pathlib import Path
from unittest import mock

import pytest

from api.services.awareness import rules
from api.services.awareness.rules import InsightCandidate

REPO = Path(__file__).resolve().parents[1]
RULES = REPO / "api" / "services" / "awareness" / "rules.py"

#: The R1-R6 file as it stood before lane 13D (git blob d90b2e5f5e08ff5fecb6e08f8a13351dbabdae4c),
#: LF-normalised: its length and sha256. 13D only APPENDS after it.
BASE_RULES_BYTES = 12811
BASE_RULES_SHA256 = "5015a06d18dbef7f18ae2dfad69a972d3bd82af418b7c31c0f6e2b2f336dd8b8"


# ── R1-R6: byte-identical ─────────────────────────────────────────────────────

def test_R1_to_R6_source_is_byte_identical_to_the_pre_13D_blob():
    raw = RULES.read_bytes().replace(b"\r\n", b"\n")
    assert len(raw) > BASE_RULES_BYTES, "rules.py shrank below the R1-R6 prefix"
    prefix = raw[:BASE_RULES_BYTES]
    assert hashlib.sha256(prefix).hexdigest() == BASE_RULES_SHA256, (
        "the R1-R6 part of awareness/rules.py changed. 13D appends R7-R9 after it and NEVER "
        "edits R1-R6 (S7 is absorbing them).")
    # The appended part starts after the old file's last line, never inside it.
    assert prefix.endswith(b"return out\n")


def _r1_r6_fixture():
    scan = {
        "live_prices": {"NVDA": 88.0, "AMD": 101.5, "TSLA": 250.0, "ORCL": 126.0},
        "regime": {"label": "bull_trend", "prev_label": "chop", "confidence": 0.8},
        "earnings_by_symbol": {"AMD": "2026-07-03", "AAPL": "2026-07-02", "MSFT": "2026-07-09"},
        "earnings_window_days": 3,
        "today": date(2026, 7, 2),
    }
    user = {
        "positions": [
            {"symbol": "NVDA", "side": "Long", "entry_price": 100.0, "stop_price": 90.0, "source": None},
            {"symbol": "AMD", "side": "Long", "entry_price": 110.0, "stop_price": 100.0, "source": None},
            {"symbol": "TSLA", "side": "Short", "entry_price": 240.0, "stop_price": 255.0, "source": None},
            {"symbol": "ORCL", "side": "Long", "entry_price": 126.0049, "stop_price": 126.005,
             "source": "broker"},
        ],
        "watch_syms": {"AAPL", "MSFT"},
        "mentioned_symbols": {"NVDA"},
    }
    return scan, user


def _sig(c: InsightCandidate):
    return (c.kind, c.symbol, c.headline, c.body, round(c.base_signal, 6), c.personal_multiplier,
            c.urgency, c.dedup_key)


#: R1-R6's output on the fixture above, captured from the unchanged code. A change here means a
#: R1-R6 BEHAVIOUR changed, which this lane must never do.
GOLDEN_R1_R6 = [
    ("stop_hit", "NVDA", "NVDA is AT or THROUGH its stop",
     "Long NVDA: stop 90.00, current price 88.00. Review the position now.", 1.0, 1.3, 2.0,
     "NVDA:stop_hit"),
    ("stop_proximity", "AMD", "AMD is nearing its stop",
     "Long AMD: stop 100.00, current price 101.50 (1.5% away).", 0.552217, 1.2, 1.3,
     "AMD:stop_near"),
    ("stop_proximity", "TSLA", "TSLA is nearing its stop",
     "Short TSLA: stop 255.00, current price 250.00 (2.0% away).", 0.5, 1.2, 1.3,
     "TSLA:stop_near"),
]


def test_R1_to_R6_output_is_unchanged_on_a_fixture():
    scan, user = _r1_r6_fixture()
    out = [_sig(c) for c in rules.rule_stop_watch(scan, user)]
    assert out == GOLDEN_R1_R6
    thesis = [_sig(c) for c in rules.rule_thesis_stop_review(scan, user)]
    assert thesis == [("thesis_stop_review", "NVDA", "Your NVDA research may need a second look",
                       "Long NVDA just hit its stop. You've written research on this ticker — worth "
                       "reviewing before you re-enter or move on.", 1.0, 1.2, 1.5, "NVDA:thesis_review")]
    earn = sorted(_sig(c) for c in rules.rule_earnings_proximity(scan, user))
    assert [(k, s, d) for k, s, _h, _b, _bs, _pm, _u, d in earn] == [
        ("earnings_proximity", "AAPL", "AAPL:earnings"),
        ("earnings_proximity", "AMD", "AMD:earnings")]
    regime = rules.rule_regime_flip(scan, user)
    assert [(c.kind, c.dedup_key, c.urgency) for c in regime] == [("regime_flip", "REGIME:bull_trend", 1.4)]


# ── R7: a level the note named ────────────────────────────────────────────────

def _lv(role="stop", price=100.0, last_side=None, **kw):
    row = {"user_id": "u1", "note_id": "n1", "level_id": f"{role}@{price}", "symbol": "NVDA",
           "role": role, "price": price, "on_date": None, "version_id": "v1",
           "named_at": "2026-09-12T15:00:00", "last_side": last_side,
           "note_title": "NVDA swing plan", "note_updated_at": "2026-09-20T15:00:00"}
    row.update(kw)
    return row


def _ctx(price=None, change=None, today=date(2026, 10, 2)):
    q = {}
    if price is not None or change is not None:
        q["NVDA"] = {"price": price, "change_pct": change}
    return {"note_quotes": q, "today": today}


def test_R7_fires_inside_the_band_and_not_just_off_it():
    level = 100.0
    at_edge = rules.rule_note_level_touch(_ctx(price=level * (1 + rules.NOTE_TOUCH_BAND_PCT)),
                                          {"note_levels": [_lv()]})
    assert len(at_edge) == 1 and at_edge[0].kind == "note_level_touch"
    just_off = rules.rule_note_level_touch(_ctx(price=100.51), {"note_levels": [_lv()]})
    assert just_off == []
    below_edge = rules.rule_note_level_touch(_ctx(price=99.5), {"note_levels": [_lv()]})
    assert len(below_edge) == 1
    assert rules.rule_note_level_touch(_ctx(price=99.49), {"note_levels": [_lv()]}) == []


def test_R7_fires_on_a_cross_between_cycles_but_not_on_a_first_sighting_outside_the_band():
    lv_above = _lv(last_side="above")
    crossed = rules.rule_note_level_touch(_ctx(price=97.0), {"note_levels": [lv_above]})
    assert len(crossed) == 1
    c = crossed[0]
    assert (c.note_id, c.version_id, c.fire_key) == ("n1", "v1", "n1|stop@100.0")
    assert "97.00" in c.body and "100.00" in c.body and "here's what you thought then" in c.body.lower()
    # same side as before, outside the band: nothing
    assert rules.rule_note_level_touch(_ctx(price=97.0), {"note_levels": [_lv(last_side="below")]}) == []
    # never seen before, outside the band: nothing (no cross can be claimed)
    assert rules.rule_note_level_touch(_ctx(price=97.0), {"note_levels": [_lv()]}) == []


def test_R7_needs_a_cached_price_and_a_price_role():
    assert rules.rule_note_level_touch(_ctx(), {"note_levels": [_lv()]}) == []
    assert rules.rule_note_level_touch(_ctx(price=100.0), {"note_levels": [_lv(role="note", price=None)]}) == []


# ── R8: a large move ──────────────────────────────────────────────────────────

def test_R8_fires_at_8_percent_and_not_just_under():
    rows = {"note_levels": [_lv(role="note", price=None, level_id="note")]}
    up = rules.rule_note_big_move(_ctx(price=50.0, change=8.0), rows)
    assert [c.kind for c in up] == ["note_big_move"] and "up 8.0%" in up[0].headline
    down = rules.rule_note_big_move(_ctx(price=50.0, change=-8.0), rows)
    assert len(down) == 1 and "down 8.0%" in down[0].headline
    assert rules.rule_note_big_move(_ctx(price=50.0, change=7.99), rows) == []
    assert rules.rule_note_big_move(_ctx(price=50.0, change=-7.99), rows) == []


def test_R8_is_one_per_symbol_and_opens_the_latest_note():
    rows = {"note_levels": [
        _lv(role="note", price=None, note_id="old", note_updated_at="2026-01-01T00:00:00"),
        _lv(role="stop", price=90.0, note_id="new", note_updated_at="2026-09-01T00:00:00"),
    ]}
    out = rules.rule_note_big_move(_ctx(price=50.0, change=12.0), rows)
    assert len(out) == 1 and out[0].note_id == "new" and out[0].fire_key == "move|NVDA"


# ── R9: a named date ──────────────────────────────────────────────────────────

def test_R9_fires_on_the_day_and_within_the_lookback_but_not_before_or_after():
    today = date(2026, 10, 2)

    def run(on):
        return rules.rule_note_date_due(_ctx(today=today), {"note_levels": [
            _lv(role="review_date", price=None, on_date=on, level_id=f"review_date@{on}")]})

    assert len(run("2026-10-02")) == 1 and "is today" in run("2026-10-02")[0].headline
    assert len(run("2026-09-29")) == 1                       # 3 days ago: still reached
    assert run("2026-09-28") == []                           # 4 days ago: too late
    assert run("2026-10-03") == []                           # tomorrow: not yet
    assert run("2026-10-02")[0].once is True


# ── importance: under the away floor, every rule ──────────────────────────────

def test_every_R7_R9_importance_is_under_the_away_floor():
    from api.services.awareness import engine as eng
    cands = (rules.rule_note_level_touch(_ctx(price=100.0), {"note_levels": [
                 _lv(role=r, price=100.0) for r in ("entry", "stop", "target")]})
             + rules.rule_note_big_move(_ctx(price=100.0, change=60.0), {"note_levels": [_lv()]})
             + rules.rule_note_date_due(_ctx(), {"note_levels": [
                 _lv(role="catalyst_date", price=None, on_date="2026-10-02")]}))
    assert {c.kind for c in cands} == {"note_level_touch", "note_big_move", "note_date_due"}
    for c in cands:
        imp = rules.compute_relevance_score(c.base_signal, c.personal_multiplier, c.urgency)
        assert 4 <= imp < eng._DELIVER_IMPORTANCE_FLOOR, (c.kind, imp)


def test_the_rule_kinds_are_exactly_the_sub_capped_kinds():
    from api.services import voice_proactive_service as vps
    src = inspect.getsource(rules.rule_note_level_touch) + inspect.getsource(rules.rule_note_big_move) \
        + inspect.getsource(rules.rule_note_date_due)
    kinds = {k for k in vps.RESURFACE_KINDS if f'kind="{k}"' in src}
    assert kinds == set(vps.RESURFACE_KINDS)


# ── a database: auth.db with the j2 tables, as the engine sees it ─────────────

@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    monkeypatch.setenv("DATA_DIR", os.path.dirname(tmp.name) or ".")
    monkeypatch.delenv("AWARENESS_NOTE_RESURFACE_ENABLED", raising=False)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    from api.services.awareness import regime_snapshots
    importlib.reload(regime_snapshots)
    regime_snapshots.init_schema()
    from api.services.awareness import engine as eng
    importlib.reload(eng)
    yield tmp.name
    gc.collect()
    try:
        os.unlink(tmp.name)
    except PermissionError:
        pass


def _conn():
    from api.services.auth_db import get_connection
    return get_connection()


def _seed_user(uid):
    c = _conn()
    try:
        c.execute("INSERT INTO users (id, email, password_hash, display_name, role) "
                  "VALUES (?, ?, 'x', 'x', 'member')", (uid, f"{uid}@x.com"))
        c.commit()
    finally:
        c.close()


def _doc(*lines):
    return {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": t}]} for t in lines]}


def _note(uid, ticker, *lines, title="NVDA swing plan"):
    from api.services.journal_two import notes
    c = _conn()
    try:
        n = notes.create_note(uid, {"title": title, "ticker": ticker, "bodyJson": _doc(*lines)}, conn=c)
        c.commit()
        return n
    finally:
        c.close()


def _update(uid, nid, *lines, properties=None):
    from api.services.journal_two import notes
    c = _conn()
    try:
        patch = {"bodyJson": _doc(*lines)}
        if properties is not None:
            patch["properties"] = properties
        notes.update_note(uid, nid, patch, conn=c)
        c.commit()
    finally:
        c.close()


def _px(sym, price, change=0.0):
    from api.routers.live_prices import cache, _px_key
    cache.set(_px_key(sym), {"price": price, "change_pct": change}, ttl=600)


def _insights(uid):
    c = _conn()
    try:
        return [dict(r) for r in c.execute(
            "SELECT id, kind, symbol, headline, importance FROM voice_proactive_insights"
            " WHERE user_id = ? ORDER BY id", (uid,))]
    finally:
        c.close()


def _enable(monkeypatch, day="2026-10-02"):
    monkeypatch.setenv("AWARENESS_ENGINE_ENABLED", "1")
    monkeypatch.setenv("AWARENESS_NOTE_RESURFACE_ENABLED", "1")
    from api.services.journal_two import calendar
    monkeypatch.setattr(calendar, "et_today", lambda: day)
    from api.services.awareness import engine as eng
    monkeypatch.setattr(eng, "_build_market_scan_ctx", lambda user_ctxs: {
        "live_prices": {}, "regime": {"label": None, "confidence": None, "prev_label": None},
        "earnings_by_symbol": {}, "today": date(2026, 10, 2)})
    # a fresh price cache key space for every test
    for s in ("NVDA", "AMD", "TSLA"):
        from api.routers.live_prices import cache, _px_key
        cache.invalidate(_px_key(s))


# ── the sub-cap ───────────────────────────────────────────────────────────────

def test_with_the_shared_cap_full_a_resurfacing_still_fires_and_the_sub_cap_is_two(db_path):
    from api.services import voice_proactive_service as vps
    _seed_user("u1")
    for i in range(vps.MAX_INSIGHTS_PER_USER_PER_DAY):
        assert vps.add_insight("u1", kind="scanner_match", symbol=f"S{i}", headline="h", importance=5)
    assert vps.add_insight("u1", kind="scanner_match", symbol="FULL", headline="h", importance=5) is None
    a = vps.add_insight("u1", kind="note_level_touch", symbol="NVDA", headline="h", importance=6)
    b = vps.add_insight("u1", kind="note_date_due", symbol="AMD", headline="h", importance=5)
    assert a and b, "a full shared budget blocked resurfacing"
    assert vps.add_insight("u1", kind="note_big_move", symbol="TSLA", headline="h", importance=6) is None


def test_resurfacing_rows_never_spend_a_shared_slot(db_path):
    from api.services import voice_proactive_service as vps
    _seed_user("u1")
    assert vps.add_insight("u1", kind="note_level_touch", symbol="NVDA", headline="h", importance=6)
    assert vps.add_insight("u1", kind="note_big_move", symbol="AMD", headline="h", importance=6)
    for i in range(vps.MAX_INSIGHTS_PER_USER_PER_DAY):
        assert vps.add_insight("u1", kind="watchlist_alert", symbol=f"W{i}", headline="h", importance=5), i
    assert vps.add_insight("u1", kind="watchlist_alert", symbol="NINE", headline="h", importance=5) is None


# ── the pass, end to end ──────────────────────────────────────────────────────

def test_a_cross_of_a_named_stop_fires_once_opens_the_version_that_named_it_and_a_second_cross_is_silent(
        db_path, monkeypatch):
    from api.services.awareness import engine as eng
    from api.services import voice_proactive_service as vps
    _enable(monkeypatch)
    _seed_user("u1")
    n = _note("u1", "NVDA", "Stop: 100")
    _update("u1", n["id"], "Stop: 100", "Target: 130")      # first edit -> a version naming the stop
    c = _conn()
    try:
        v = c.execute("SELECT id FROM j2_note_versions WHERE note_id = ?", (n["id"],)).fetchone()["id"]
    finally:
        c.close()

    _px("NVDA", 104.0)
    with mock.patch("api.services.watchlist_alert_service.deliver_alert_payload") as deliver:
        first = eng.run_awareness_scan()
        assert first["resurface"]["fired"] == 0           # first sighting, 4% away: side recorded
        _px("NVDA", 98.0)                                  # crossed below
        second = eng.run_awareness_scan()
        _px("NVDA", 103.0)                                 # crossed back up: same level, same day
        third = eng.run_awareness_scan()
    deliver.assert_not_called()
    assert second["resurface"]["fired"] == 1 and third["resurface"]["fired"] == 0
    rows = _insights("u1")
    assert [(r["kind"], r["symbol"]) for r in rows] == [("note_level_touch", "NVDA")]
    assert rows[0]["importance"] < 8

    listed = vps.list_history("u1")
    assert listed[0]["link"] == f"/journal/notebook?note={n['id']}&resurfaceVersion={v}"


def test_a_new_day_rearms_the_level(db_path, monkeypatch):
    from api.services.awareness import engine as eng
    _enable(monkeypatch, day="2026-10-02")
    _seed_user("u1")
    _note("u1", "NVDA", "Stop: 100")
    _px("NVDA", 100.2)
    assert eng.run_awareness_scan()["resurface"]["fired"] == 1
    # add_insight's own 6h per-symbol cooldown would also silence a re-run; age the row past it
    # so the ONLY thing left holding the level quiet is the one-per-level-per-day ledger
    c = _conn()
    try:
        c.execute("UPDATE voice_proactive_insights SET created_at = '2020-01-01 00:00:00'")
        c.commit()
    finally:
        c.close()
    assert eng.run_awareness_scan()["resurface"]["fired"] == 0          # same day: the ledger
    from api.services.journal_two import calendar
    monkeypatch.setattr(calendar, "et_today", lambda: "2026-10-03")
    assert eng.run_awareness_scan()["resurface"]["fired"] == 1          # a new day re-arms it


def test_a_level_with_no_saved_version_opens_the_note_as_it_is(db_path, monkeypatch):
    from api.services.awareness import engine as eng
    from api.services import voice_proactive_service as vps
    _enable(monkeypatch)
    _seed_user("u1")
    n = _note("u1", "NVDA", "Target: 120")
    _px("NVDA", 120.3)
    assert eng.run_awareness_scan()["resurface"]["fired"] == 1
    assert vps.list_history("u1")[0]["link"] == f"/journal/notebook?note={n['id']}"


def test_a_review_date_of_today_fires_once_ever(db_path, monkeypatch):
    from api.services.awareness import engine as eng
    _enable(monkeypatch)
    _seed_user("u1")
    n = _note("u1", "AMD", "thesis")
    _update("u1", n["id"], "thesis", properties={"builtin:review_date": "2026-10-02"})
    assert eng.run_awareness_scan()["resurface"]["fired"] == 1
    assert [r["kind"] for r in _insights("u1")] == ["note_date_due"]
    c = _conn()
    try:
        c.execute("UPDATE voice_proactive_insights SET created_at = '2020-01-01 00:00:00'")
        c.commit()
    finally:
        c.close()
    from api.services.journal_two import calendar
    monkeypatch.setattr(calendar, "et_today", lambda: "2026-10-03")
    assert eng.run_awareness_scan()["resurface"]["fired"] == 0          # a date is reached once


def test_a_big_move_fires_for_a_note_with_no_level(db_path, monkeypatch):
    from api.services.awareness import engine as eng
    _enable(monkeypatch)
    _seed_user("u1")
    _note("u1", "TSLA", "just a thesis, no numbers", title="TSLA thoughts")
    _px("TSLA", 300.0, change=9.1)
    assert eng.run_awareness_scan()["resurface"]["fired"] == 1
    assert [r["kind"] for r in _insights("u1")] == ["note_big_move"]


def test_no_deliver_alert_payload_is_reachable_even_at_importance_10(db_path, monkeypatch):
    from api.services.awareness import engine as eng
    _enable(monkeypatch)
    _seed_user("u1")
    _note("u1", "NVDA", "Stop: 100")
    _px("NVDA", 100.0)
    loud = rules.ResurfaceCandidate(kind="note_level_touch", symbol="NVDA", headline="h", body="b",
                                    base_signal=1.0, personal_multiplier=1.3, urgency=2.0,
                                    dedup_key="x", note_id="n", fire_key="loud")
    monkeypatch.setattr(rules, "rule_note_level_touch", lambda s, u: [loud])
    with mock.patch("api.services.watchlist_alert_service.deliver_alert_payload") as deliver:
        out = eng.run_awareness_scan()
    assert out["resurface"]["fired"] == 1
    assert _insights("u1")[0]["importance"] == 10
    deliver.assert_not_called()


# ── the index ─────────────────────────────────────────────────────────────────

def test_levels_come_only_from_plan_extract(monkeypatch):
    from api.services.journal_two import note_levels, plan_extract
    body = _doc("Entry: 95", "Stop: 90", "Target: 120")
    assert {r["role"] for r in note_levels.read_note_rows(body, None, [], "NVDA").values()} == \
        {"entry", "stop", "target"}
    monkeypatch.setattr(plan_extract, "note_levels", lambda *a, **k: [])
    assert note_levels.read_note_rows(body, None, [], "NVDA") == {}


def test_a_placeholder_stop_is_never_a_level():
    from api.services.journal_two import note_levels
    rows = note_levels.read_note_rows(_doc("Entry: 126.005", "Stop: 126.005", "Target: 140"),
                                      None, [], "ORCL")
    assert {r["role"] for r in rows.values()} == {"entry", "target"}


def test_a_trashed_note_leaves_the_index(db_path, monkeypatch):
    from api.services.journal_two import note_levels, notes
    _seed_user("u1")
    n = _note("u1", "NVDA", "Stop: 100")
    c = _conn()
    try:
        note_levels.catch_up_all(c)
        assert sorted(r["role"] for r in note_levels.load_index(c)["u1"]) == ["note", "stop"]
        notes.delete_note("u1", n["id"], conn=c)                         # trash
        c.commit()
        assert note_levels.load_index(c) == {}                           # never read once trashed
        out = note_levels.catch_up_all(c)
        assert out["notes_removed"] == 1
        assert c.execute("SELECT COUNT(*) FROM j2_note_levels WHERE note_id = ?", (n["id"],)).fetchone()[0] == 0
    finally:
        c.close()


def test_the_projection_is_by_watermark_and_never_writes_a_note(db_path):
    from api.services.journal_two import note_levels
    _seed_user("u1")
    n = _note("u1", "NVDA", "Stop: 100")
    c = _conn()
    try:
        before = dict(c.execute("SELECT body_json, updated_at FROM j2_notes WHERE id = ?", (n["id"],)).fetchone())
        assert note_levels.catch_up_all(c)["notes_projected"] == 1
        assert note_levels.catch_up_all(c)["notes_projected"] == 0          # unchanged -> untouched
        after = dict(c.execute("SELECT body_json, updated_at FROM j2_notes WHERE id = ?", (n["id"],)).fetchone())
        assert before == after
    finally:
        c.close()


def test_a_note_about_several_tickers_names_no_levels(db_path):
    from api.services.journal_two import note_levels
    _seed_user("u1")
    n = _note("u1", None, "Stop: 100")
    c = _conn()
    try:
        for s in ("NVDA", "AMD"):
            c.execute("INSERT INTO j2_note_mentions (note_id, user_id, symbol, created_at)"
                      " VALUES (?, 'u1', ?, CURRENT_TIMESTAMP)", (n["id"], s))
        c.commit()
        note_levels.catch_up_all(c)
        assert note_levels.load_index(c) == {}
        roles = [r[0] for r in c.execute("SELECT role FROM j2_note_levels WHERE note_id = ?", (n["id"],))]
        assert roles == ["none"]                                           # the watermark only
    finally:
        c.close()


# ── purge ─────────────────────────────────────────────────────────────────────

def test_account_purge_takes_both_tables_and_only_that_member(db_path, monkeypatch):
    from api.services.awareness import engine as eng
    from api.services.journal_two import account_purge
    _enable(monkeypatch)
    for u in ("u1", "u2"):
        _seed_user(u)
        _note(u, "NVDA", "Stop: 100")
    _px("NVDA", 100.1)
    assert eng.run_awareness_scan()["resurface"]["fired"] == 2
    c = _conn()
    try:
        report = account_purge.purge_user_rows("u1", c)
        assert report["rows_deleted"]["j2_note_levels"] == 2
        assert report["rows_deleted"]["j2_note_resurface_fires"] == 1
        for t in ("j2_note_levels", "j2_note_resurface_fires"):
            assert c.execute(f"SELECT COUNT(*) FROM {t} WHERE user_id = 'u1'").fetchone()[0] == 0
            assert c.execute(f"SELECT COUNT(*) FROM {t} WHERE user_id = 'u2'").fetchone()[0] > 0
    finally:
        c.close()


# ── flag off: inert ───────────────────────────────────────────────────────────

def test_flag_off_the_pass_never_runs_and_no_link_is_attached(db_path, monkeypatch):
    from api.services.awareness import engine as eng
    from api.services import voice_proactive_service as vps
    _enable(monkeypatch)
    monkeypatch.delenv("AWARENESS_NOTE_RESURFACE_ENABLED", raising=False)
    _seed_user("u1")
    _note("u1", "NVDA", "Stop: 100")
    _px("NVDA", 100.0)
    out = eng.run_awareness_scan()
    assert "resurface" not in out
    c = _conn()
    try:
        assert c.execute("SELECT name FROM sqlite_master WHERE name = 'j2_note_levels'").fetchone() is None
    finally:
        c.close()
    assert _insights("u1") == []
    # a resurfacing row that exists (armed earlier, then unset) carries no door while off
    vps.add_insight("u1", kind="note_level_touch", symbol="NVDA", headline="h", importance=6)
    assert "link" not in vps.list_history("u1")[0]


# ── cost: the shared cache only ───────────────────────────────────────────────

def test_the_resurfacing_code_reads_prices_from_the_shared_cache_only():
    from api.services.awareness import engine as eng
    from api.services.journal_two import note_levels
    src = inspect.getsource(eng._note_quotes)
    tree = ast.parse(src)
    calls = {ast.unparse(n.func) for n in ast.walk(tree) if isinstance(n, ast.Call)}
    assert "_px_cache.get" in calls                                     # the control: it reads
    assert not {c for c in calls if "fetch" in c.lower() or "snapshot" in c.lower()}
    imported = {a.name for n in ast.walk(ast.parse(Path(note_levels.__file__).read_text(encoding="utf-8")))
                if isinstance(n, (ast.Import, ast.ImportFrom)) for a in n.names}
    imported |= {n.module for n in ast.walk(ast.parse(Path(note_levels.__file__).read_text(encoding="utf-8")))
                 if isinstance(n, ast.ImportFrom) and n.module}
    assert not {m for m in imported if any(x in (m or "") for x in ("massive", "requests", "httpx", "live_prices"))}
    pass_src = inspect.getsource(eng._run_resurface_pass) + inspect.getsource(eng._fire_resurface)
    assert "deliver_alert_payload" not in pass_src and "_fire_candidate(" not in pass_src
