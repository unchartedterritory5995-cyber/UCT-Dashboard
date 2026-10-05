"""Wave 14 integration, round 2 -- the sample notebook must never touch a member's numbers.

HARD REQUIREMENT: a member's P&L, stats, equity curve, reports, exports, Book or UCT20 numbers
and any analytics must NEVER include the sample notebook's example content.

VERDICT: exclusion of a seeded example TRADE could not be made airtight. `j2_trades` is read by
~60 modules across api/ with raw SQL (analytics, calendar, tax report, exports, playbook and
setup stats, discipline, community, the public track record, Compass, broker reconcile ...),
so there is no single choke point a sample flag could be filtered at, and every future query
would be one more place to forget it. So `sample_examples.seed` no longer writes a trade, a
position or an entry context at all; it keeps the example NOTES (plus one passed setup and one
resurfacing notice, which live in their own capability tables and feed no trade statistic).

This file proves it three ways:
  1. CENSUS -- after a seed, every table holding a row for the member is a note-side table on
     an explicit allowlist; no trade-side table holds anything. A control proves the census
     sees a real trade.
  2. PER CONSUMER CLASS -- every class of `j2_trades` consumer is called with its REAL read
     function before and after the seed and must answer identically. A control adds one real
     trade and proves the same comparison then differs, so the parity check can fail.
  3. REMOVE -- a preference recorded by the earlier (never shipped) version that DID seed a
     trade is still cleaned up completely by "Remove it".
Plus: Book (`modelbook_service`) and UCT20 (`uct20_nav`) read no j2 trade table at all, and the
promotion copy says no trade is added.

The database is a temp file (`auth_db._DB_PATH`); nothing here reaches `C:\\data`.
"""
from __future__ import annotations

import ast
import json
import re
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import auth_db, auth_service
from api.services.journal_two import (
    accounts, analytics, books_audit, calendar as j2_calendar, coach_data_assembler, community,
    discipline, excursions_store, overview, playbook_stats, public_profile, sample_examples,
    sample_notebook, setup_stats, tax_report, trades, verdict_scorecard,
)

ROOT = Path(__file__).resolve().parents[1]
U1 = "u-w14int-excl-1"
#: The member's real default account, provisioned before any reading so a before/after pair
#: reads the same account (set by the `db` fixture).
_ACCT: dict[str, str | None] = {"id": None}

#: Tables a seed may write for the member. Every one is note-side or capability-side and feeds
#: no trade statistic. `j2_accounts` is the lazy default account any first Journal read
#: provisions (`accounts.get_or_migrate_default_account`); it holds no trade.
ALLOWED = frozenset({
    "user_preferences", "voice_proactive_insights", "j2_accounts",
    "j2_notes", "j2_notes_fts", "j2_note_task_digest", "j2_note_folders", "j2_note_versions",
    "j2_note_embeds", "j2_note_links", "j2_note_documents", "j2_note_document_pages",
    "j2_note_document_pages_fts", "j2_note_excerpts", "j2_note_excerpt_refs",
    "j2_note_excerpts_fts", "j2_note_tag_index", "j2_chart_blocks", "j2_note_levels",
    "j2_note_resurface_fires", "j2_passed_setups",
})
#: A table whose name says it holds trading activity. Checked independently of ALLOWED, so
#: widening the allowlist by mistake still cannot let a trade-side table through.
TRADE_SIDE = re.compile(
    r"trade|position|option|strateg|execution|fill|broker|equity|excursion|verdict|"
    r"plan_grade|entry_context|review|day_note|discipline|intervention", re.I)


@pytest.fixture
def db(monkeypatch, tmp_path):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "excl.db"))
    auth_db.init_db()
    c = auth_db.get_connection()
    try:
        c.execute("INSERT INTO users (id, email, password_hash, display_name, role)"
                  " VALUES (?, ?, 'x', 'x', 'member')", (U1, f"{U1}@example.test"))
        c.commit()
        _ACCT["id"] = accounts.get_or_migrate_default_account(U1, conn=c)["id"]
        c.commit()
    finally:
        c.close()


def _user_tables(c) -> dict[str, int]:
    out = {}
    for (t,) in c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall():
        cols = {r[1] for r in c.execute(f"PRAGMA table_info('{t}')")}
        if "user_id" in cols:
            n = c.execute(f"SELECT COUNT(*) FROM '{t}' WHERE user_id = ?", (U1,)).fetchone()[0]
            if n:
                out[t] = n
    return out


def _real_trade() -> str:
    t = trades.create_trade_manual(U1, {
        "symbol": "MSFT", "side": "Long", "shares": 10, "entryPrice": 100.0,
        "entryDate": (date.today() - timedelta(days=6)).isoformat(), "exitPrice": 110.0,
        "exitDate": (date.today() - timedelta(days=2)).isoformat(), "originalStop": 95.0,
        "setup": "Classic Flag/Pullback", "accountId": _ACCT["id"],
    }, {"breakevenRange": {"enabled": False, "unit": "$", "value": 0}})
    return t["id"]


# ── 1. census ───────────────────────────────────────────────────────────────────────────────

def test_a_seed_writes_only_note_side_tables(db):
    out = sample_notebook.seed(U1)
    pref = json.loads(auth_service.get_user_preferences(U1)[sample_notebook.PREF_KEY])
    assert pref["examples"]["errors"] == {}
    assert pref["examples"]["tradeId"] is None and pref["examples"]["entryContext"] is None
    c = auth_db.get_connection()
    try:
        written = _user_tables(c)
    finally:
        c.close()
    assert "j2_notes" in written and written["j2_notes"] == len(out["ids"])   # non-vacuity
    trade_side = sorted(t for t in written if TRADE_SIDE.search(t) and t != "j2_accounts")
    assert trade_side == [], f"the sample wrote trade-side rows: {trade_side}"
    assert sorted(set(written) - ALLOWED) == [], "a seed wrote a table nobody vetted"


def test_CONTROL_the_census_sees_a_real_trade(db):
    _real_trade()
    c = auth_db.get_connection()
    try:
        written = _user_tables(c)
    finally:
        c.close()
    assert written.get("j2_trades") == 1
    assert any(TRADE_SIDE.search(t) for t in written if t != "j2_accounts")


# ── 2. every class of trade consumer reads the same before and after a seed ─────────────────

def _today() -> date:
    return date.today()


def _monday() -> str:
    d = _today()
    return (d - timedelta(days=d.weekday())).isoformat()


def _export_json():
    from api.middleware.auth_middleware import get_current_user
    from api.routers import journal_two
    app = FastAPI()
    app.include_router(journal_two.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": U1, "role": "member"}
    r = TestClient(app).get("/api/j2/trades/export?format=json")
    assert r.status_code == 200, r.text
    return r.json()


def _with_conn(fn):
    def run():
        c = auth_db.get_connection()
        try:
            return fn(c)
        finally:
            c.close()
    return run


#: (consumer class, the real read it serves members with). Each reads j2_trades.
CONSUMERS = {
    "trade log": _with_conn(lambda c: trades.list_trades_for_user(U1, c)),
    "export (csv/json route)": _export_json,
    "analytics: P&L stats + equity curve": _with_conn(lambda c: analytics.get_analytics(U1, conn=c)),
    "calendar P&L": _with_conn(lambda c: j2_calendar.get_calendar(
        U1, view="month", year=_today().year, month=_today().month, conn=c)),
    "tax report": _with_conn(lambda c: tax_report.get_tax_report(U1, _today().year, conn=c)),
    "overview": _with_conn(lambda c: overview.get_overview(user_id=U1, account_id=_ACCT['id'], conn=c)),
    "playbook stats": _with_conn(lambda c: playbook_stats.get_playbook_stats(U1, conn=c)),
    "setup stats": _with_conn(lambda c: setup_stats.get_setup_stats(
        U1, _ACCT['id'], "Classic Flag/Pullback", conn=c)),
    "discipline": _with_conn(lambda c: discipline.compute_discipline_state(U1, _ACCT['id'], conn=c)),
    "verdict scorecard": _with_conn(lambda c: verdict_scorecard.get_verdict_scorecard(U1, conn=c)),
    "books audit": _with_conn(lambda c: books_audit.run_books_audit(U1, conn=c)),
    "Compass weekly data": _with_conn(lambda c: coach_data_assembler.assemble_week(
        user_id=U1, account_id=_ACCT['id'], week_start=_monday(), conn=c)),
    "excursions": _with_conn(lambda c: excursions_store.list_excursions_for_user(U1, conn=c)),
    "community trader summaries": _with_conn(lambda c: community.list_trader_summaries(conn=c)),
    "community shared trades": _with_conn(lambda c: community.list_shared_trades(conn=c)),
}

#: Keys that carry the wall clock or an id minted per call, never trade content.
#: Exact names or an `_at`/`At` suffix only -- a looser pattern ("ends in ts") would strip
#: `stats`, `counts`, `buckets` and make the parity check vacuous.
_VOLATILE = re.compile(r"^(id|ts|now|timestamp|as_?of|asOf)$|(_at|At)$")


def _stable(x):
    if isinstance(x, dict):
        return {k: _stable(v) for k, v in x.items() if not _VOLATILE.search(str(k))}
    if isinstance(x, (list, tuple)):
        return [_stable(v) for v in x]
    return x


@pytest.mark.parametrize("name", sorted(CONSUMERS))
def test_every_trade_consumer_reads_the_same_after_a_seed(db, name):
    read = CONSUMERS[name]
    before = _stable(read())
    sample_notebook.seed(U1)
    assert _stable(read()) == before, f"{name}: the sample notebook changed what it reports"


#: The consumers a single closed trade MUST move -- the control that proves the parity check
#: above can fail. (Community and the public record need an opt-in and excursions a bar
#: backfill; their trade reads are covered by the census.)
MUST_MOVE = ("trade log", "export (csv/json route)", "analytics: P&L stats + equity curve",
             "calendar P&L", "tax report", "playbook stats", "overview", "setup stats",
             "Compass weekly data", "books audit", "verdict scorecard")
# `discipline` is absent on purpose: it reads today's losses and rule breaks, and one winning
# trade two days ago correctly leaves it unchanged. Its parity above still holds; the census
# is what proves the seed gives it nothing to read.


@pytest.mark.parametrize("name", MUST_MOVE)
def test_CONTROL_a_real_trade_does_change_the_consumer(db, name):
    read = CONSUMERS[name]
    before = _stable(read())
    _real_trade()
    assert _stable(read()) != before, f"{name}: the parity check cannot see a trade"


def test_the_public_track_record_reads_the_same_after_a_seed(db):
    token = public_profile.create_or_rotate(U1)["token"]
    before = _stable(public_profile.track_record(token))
    sample_notebook.seed(U1)
    assert _stable(public_profile.track_record(token)) == before


# ── 3. Remove takes it off cleanly, including a trade an earlier version recorded ───────────

def test_remove_leaves_no_sample_row_behind(db):
    sample_notebook.seed(U1)
    sample_notebook.remove(U1)
    c = auth_db.get_connection()
    try:
        assert c.execute("SELECT COUNT(*) FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL",
                         (U1,)).fetchone()[0] == 0
        assert c.execute("SELECT COUNT(*) FROM j2_passed_setups WHERE user_id = ?"
                         " AND dismissed_at IS NULL", (U1,)).fetchone()[0] == 0
        assert c.execute("SELECT COUNT(*) FROM j2_trades WHERE user_id = ?", (U1,)).fetchone()[0] == 0
    finally:
        c.close()


def test_remove_deletes_a_trade_recorded_by_the_earlier_version(db):
    """A dev-box preference from the never-shipped first version names a trade id. Remove must
    still delete it, through the trades door's own delete."""
    sample_notebook.seed(U1)
    tid = _real_trade()
    raw = json.loads(auth_service.get_user_preferences(U1)[sample_notebook.PREF_KEY])
    raw["examples"]["tradeId"] = tid
    auth_service.set_user_preference(U1, sample_notebook.PREF_KEY, json.dumps(raw))
    out = sample_notebook.remove(U1)
    assert out["examplesRemoved"]["tradeDeleted"] is True
    c = auth_db.get_connection()
    try:
        assert c.execute("SELECT COUNT(*) FROM j2_trades WHERE user_id = ?", (U1,)).fetchone()[0] == 0
    finally:
        c.close()


# ── Book and UCT20 read no j2 trade table at all ─────────────────────────────────────────────

@pytest.mark.parametrize("rel", ["api/services/modelbook_service.py", "api/services/uct20_nav.py"])
def test_book_and_uct20_never_read_the_member_trade_tables(rel):
    src = (ROOT / rel).read_text(encoding="utf-8")
    ast.parse(src)                                   # non-vacuity: the file is real Python
    assert len(src) > 1000
    for table in ("j2_trades", "j2_positions", "j2_option_strategies"):
        assert table not in src, f"{rel} reads {table}"


# ── the promotion copy is truthful ───────────────────────────────────────────────────────────

def test_the_promotion_copy_says_no_trade_is_added():
    src = (ROOT / "app/src/pages/journal-2-0/components/notebook/onboarding/capabilityList.js"
           ).read_text(encoding="utf-8")
    m = re.search(r"sampleTail:\s*'([^']*)'", src)
    assert m, "sampleTail not found"
    tail = m.group(1)
    assert "no trades" in tail
    assert "example notes" in tail and "one click" in tail
