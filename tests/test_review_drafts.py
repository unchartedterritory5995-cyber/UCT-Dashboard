"""Wave 13 lane 13F -- the review-drafts router + orchestrator (DB-backed).

`tests/test_leak_finder.py` already pins every detector against fixtures with known
n and dollars; this file proves the WIRING: real rows in `j2_trades` flow through
`review_drafts.py` into a payload whose numbers equal their authority's own field,
member-scoped, gated by `NOTEBOOK_REVIEW_DRAFTS_ENABLED`.
"""
from __future__ import annotations

import importlib
import os
import tempfile
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

FLAG = "NOTEBOOK_REVIEW_DRAFTS_ENABLED"
U, OTHER = "user-rd-a", "user-rd-b"
ACCOUNT = "acc-rd-1"


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
        conn.execute(
            "INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)",
            (uid, f"{uid}@example.com", "x", uid, "member"),
        )
    conn.execute(
        "INSERT INTO j2_accounts (id, user_id, name, color, starting_balance, account_size,"
        " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
        (ACCOUNT, U, "Main", "#fff", 10000.0, 10000.0, "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"),
    )
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
def client(db_path, monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    from api.routers import notebook_review_drafts
    fa = FastAPI()
    fa.include_router(notebook_review_drafts.router)
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": U, "role": "member", "plan": "pro"}
    fa.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {"id": U, "role": "member", "plan": "pro"}
    yield TestClient(fa)
    fa.dependency_overrides.clear()


def add_trade(conn, *, symbol, entry_date, exit_date, entry_price, exit_price, shares=100.0,
             stop=90.0, setup=None, r=None, result=None, pnl=None, fees=0.0, hour_et=10,
             trading_day_et=None, user=U, account=ACCOUNT, tid=None, context_at_entry="{}"):
    tid = tid or f"t-{uuid.uuid4().hex[:10]}"
    pnl = pnl if pnl is not None else round((exit_price - entry_price) * shares, 2)
    r = r if r is not None else round((exit_price - entry_price) / (entry_price - stop), 4)
    result = result or ("Win" if pnl > 0 else "Loss" if pnl < 0 else "BE")
    trading_day_et = trading_day_et or exit_date[:10]
    conn.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price, entry_date,"
        " exit_price, exit_date, original_stop, setup, notes, pnl_dollar, pnl_percent, r_multiple, hold_days,"
        " result, context_at_entry, created_at, account_id, fees, hour_et, trading_day_et)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,1,?,?,?,?,?,?,?)",
        (tid, user, f"pos-{tid}", symbol, "Long", shares, entry_price, entry_date, exit_price, exit_date,
         stop, setup, pnl, pnl / (entry_price * shares), r, result, context_at_entry, exit_date, account,
         fees, hour_et, trading_day_et),
    )
    conn.commit()
    return tid


def test_the_gate_is_a_router_dependency(db_path, monkeypatch):
    monkeypatch.delenv(FLAG, raising=False)
    from api.routers import notebook_review_drafts
    fa = FastAPI()
    fa.include_router(notebook_review_drafts.router)
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": U, "role": "member", "plan": "pro"}
    fa.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {"id": U, "role": "member", "plan": "pro"}
    c = TestClient(fa)
    assert c.get("/api/j2/review-drafts/daily", params={"day": "2026-09-30"}).status_code == 404
    assert c.get("/api/j2/review-drafts/weekly", params={"weekStart": "2026-09-28"}).status_code == 404
    assert c.get("/api/j2/review-drafts/monthly", params={"month": "2026-09"}).status_code == 404
    fa.dependency_overrides.clear()


def test_daily_aggregates_equal_coach_data_assemblers_own_field(conn, client):
    add_trade(conn, symbol="NVDA", entry_date="2026-09-30T13:30:00+00:00",
             exit_date="2026-09-30T19:00:00+00:00", entry_price=100.0, exit_price=102.0)
    add_trade(conn, symbol="AAPL", entry_date="2026-09-30T14:00:00+00:00",
             exit_date="2026-09-30T19:30:00+00:00", entry_price=200.0, exit_price=195.0)

    from api.services.journal_two import coach_data_assembler
    authority = coach_data_assembler.assemble_day(user_id=U, account_id=ACCOUNT, day_iso="2026-09-30", conn=conn)

    r = client.get("/api/j2/review-drafts/daily", params={"day": "2026-09-30", "accountId": ACCOUNT})
    assert r.status_code == 200
    payload = r.json()
    assert payload["aggregates"] == authority["today"]["aggregates"]
    assert payload["tradeCount"] == 2


def test_weekly_tradecount_matches_the_periods_own_raw_fetch(conn, client):
    for i, day in enumerate(["2026-09-28", "2026-09-29", "2026-09-30"]):
        add_trade(conn, symbol="NVDA", entry_date=f"{day}T13:30:00+00:00",
                 exit_date=f"{day}T19:00:00+00:00", entry_price=100.0, exit_price=101.0 + i, tid=f"w{i}")
    # outside the window (the following Monday)
    add_trade(conn, symbol="NVDA", entry_date="2026-10-05T13:30:00+00:00",
             exit_date="2026-10-05T19:00:00+00:00", entry_price=100.0, exit_price=101.0, tid="out1")

    r = client.get("/api/j2/review-drafts/weekly", params={"weekStart": "2026-09-28", "accountId": ACCOUNT})
    assert r.status_code == 200
    payload = r.json()
    assert payload["tradeCount"] == 3
    assert payload["range"] == {"start": "2026-09-28", "end": "2026-10-02"}


def test_monthly_uses_the_shared_primitives_and_the_numbers_still_close(conn, client):
    add_trade(conn, symbol="NVDA", entry_date="2026-09-03T13:30:00+00:00",
             exit_date="2026-09-03T19:00:00+00:00", entry_price=100.0, exit_price=110.0, tid="m1")
    add_trade(conn, symbol="AAPL", entry_date="2026-09-20T13:30:00+00:00",
             exit_date="2026-09-20T19:00:00+00:00", entry_price=200.0, exit_price=190.0, tid="m2")
    # a different month, must not leak in
    add_trade(conn, symbol="NVDA", entry_date="2026-10-01T13:30:00+00:00",
             exit_date="2026-10-01T19:00:00+00:00", entry_price=100.0, exit_price=120.0, tid="m3")

    r = client.get("/api/j2/review-drafts/monthly", params={"month": "2026-09", "accountId": ACCOUNT})
    assert r.status_code == 200
    payload = r.json()
    assert payload["tradeCount"] == 2
    assert payload["aggregates"]["trade_count"] == 2
    expected_net = round((110.0 - 100.0) * 100 + (190.0 - 200.0) * 100, 2)
    assert payload["aggregates"]["net_pnl_dollar"] == expected_net


def test_member_scoping_another_members_trades_never_appear(conn, client):
    other_account = "acc-rd-other"
    conn.execute(
        "INSERT INTO j2_accounts (id, user_id, name, color, starting_balance, account_size,"
        " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
        (other_account, OTHER, "Main", "#fff", 10000.0, 10000.0, "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"),
    )
    conn.commit()
    add_trade(conn, symbol="NVDA", entry_date="2026-09-30T13:30:00+00:00",
             exit_date="2026-09-30T19:00:00+00:00", entry_price=100.0, exit_price=101.0,
             user=OTHER, account=other_account, tid="other1")
    add_trade(conn, symbol="AAPL", entry_date="2026-09-30T13:30:00+00:00",
             exit_date="2026-09-30T19:00:00+00:00", entry_price=50.0, exit_price=51.0,
             user=U, account=ACCOUNT, tid="mine1")

    r = client.get("/api/j2/review-drafts/daily", params={"day": "2026-09-30", "accountId": ACCOUNT})
    payload = r.json()
    assert payload["tradeCount"] == 1
    assert payload["bestTrade"]["symbol"] == "AAPL"


def test_best_and_worst_trade_are_the_actual_extremes_and_cite_their_exit(conn, client):
    add_trade(conn, symbol="NVDA", entry_date="2026-09-30T13:30:00+00:00",
             exit_date="2026-09-30T19:00:00+00:00", entry_price=100.0, exit_price=120.0,
             stop=90.0, tid="best1")  # r = 2.0
    add_trade(conn, symbol="TSLA", entry_date="2026-09-30T13:30:00+00:00",
             exit_date="2026-09-30T20:00:00+00:00", entry_price=200.0, exit_price=180.0,
             stop=190.0, tid="worst1")  # r = (180-200)/(200-190) = -2.0

    r = client.get("/api/j2/review-drafts/daily", params={"day": "2026-09-30", "accountId": ACCOUNT})
    payload = r.json()
    assert payload["bestTrade"]["symbol"] == "NVDA"
    assert payload["bestTrade"]["id"] == "best1"
    assert payload["worstTrade"]["symbol"] == "TSLA"
    assert payload["worstTrade"]["id"] == "worst1"


def test_leaks_survive_into_the_full_payload(conn, client):
    # A loss, then a same-symbol re-entry within the window -- the revenge detector's
    # own fixture shape, proven in test_leak_finder.py; here only proving it SURVIVES
    # the full router round trip.
    add_trade(conn, symbol="NVDA", entry_date="2026-09-30T13:00:00+00:00",
             exit_date="2026-09-30T13:30:00+00:00", entry_price=100.0, exit_price=95.0,
             stop=94.0, tid="loss1")
    add_trade(conn, symbol="NVDA", entry_date="2026-09-30T13:45:00+00:00",
             exit_date="2026-09-30T14:15:00+00:00", entry_price=95.0, exit_price=93.0,
             stop=92.0, tid="reentry1")

    r = client.get("/api/j2/review-drafts/daily", params={"day": "2026-09-30", "accountId": ACCOUNT})
    payload = r.json()
    kinds = {f["kind"] for f in payload["leaks"]}
    assert "revenge_reentry" in kinds
    revenge = next(f for f in payload["leaks"] if f["kind"] == "revenge_reentry")
    assert {t["id"] for t in revenge["trades"]} == {"reentry1"}
    # the rail: a finding's trades sum to its dollars
    assert round(sum(t["pnlDollar"] for t in revenge["trades"]), 2) == revenge["dollarImpact"]["netPnl"]


def test_the_sample_constants_ride_the_payload_for_the_client_to_word_anything_itself(conn, client):
    add_trade(conn, symbol="NVDA", entry_date="2026-09-30T13:30:00+00:00",
             exit_date="2026-09-30T19:00:00+00:00", entry_price=100.0, exit_price=101.0)
    r = client.get("/api/j2/review-drafts/daily", params={"day": "2026-09-30", "accountId": ACCOUNT})
    payload = r.json()
    assert payload["sample"]["tooFewBelow"] == 10
    assert payload["sample"]["normalFrom"] == 25


# ── fin-data I2: the daily draft files a trade under its trading day ───────────────────────
#
# A manual trade entered with a date and no time is stored at UTC midnight
# (`trades._combine_manual_datetime`). That instant is 8 PM Eastern the day BEFORE, so an
# Eastern-midnight window over `exit_date` filed it under the wrong day. `trading_day_et`
# (the column `filters._DAY` reads, and the one the scorecard inside this same draft uses)
# is the authority for which day a trade belongs to.

def _date_only_trade(conn, day, **kw):
    """The journal's own date-only convention: exact UTC midnight, trading day = the typed day."""
    return add_trade(conn, entry_date=f"{day}T00:00:00+00:00", exit_date=f"{day}T00:00:00+00:00",
                     trading_day_et=day, hour_et=None, **kw)


def test_a_date_only_trade_is_in_its_own_days_draft_and_not_the_day_befores(conn, client):
    tid = _date_only_trade(conn, "2026-10-01", symbol="NVDA", entry_price=100.0, exit_price=103.0)

    own = client.get("/api/j2/review-drafts/daily", params={"day": "2026-10-01", "accountId": ACCOUNT}).json()
    before = client.get("/api/j2/review-drafts/daily", params={"day": "2026-09-30", "accountId": ACCOUNT}).json()

    assert own["tradeCount"] == 1 and own["bestTrade"]["id"] == tid
    assert before["tradeCount"] == 0 and before["bestTrade"] is None


def test_every_half_of_one_daily_draft_counts_the_same_trades(conn, client):
    """The numbers table, the trade list and the scorecard are three readers. They must name
    one set of trades, date-only and timed alike."""
    _date_only_trade(conn, "2026-10-01", symbol="NVDA", entry_price=100.0, exit_price=103.0,
                     context_at_entry='{"compass_verdict_id": "v1", "compass_verdict_label": "SKIP"}')
    add_trade(conn, symbol="AAPL", entry_date="2026-10-01T14:00:00+00:00",
              exit_date="2026-10-01T19:30:00+00:00", entry_price=200.0, exit_price=195.0)
    # The neighbours, each of which must stay out: a date-only trade the day before and after.
    _date_only_trade(conn, "2026-09-30", symbol="MSFT", entry_price=50.0, exit_price=51.0)
    _date_only_trade(conn, "2026-10-02", symbol="AMZN", entry_price=50.0, exit_price=49.0)

    from api.services.journal_two import verdict_scorecard
    from api.services.journal_two.filters import FilterSpec
    payload = client.get("/api/j2/review-drafts/daily", params={"day": "2026-10-01", "accountId": ACCOUNT}).json()
    scorecard = verdict_scorecard.get_verdict_scorecard(
        U, ACCOUNT, spec=FilterSpec(date_from="2026-10-01", date_to="2026-10-01"), conn=conn)

    assert payload["tradeCount"] == 2
    assert payload["aggregates"]["trade_count"] == payload["tradeCount"]
    assert scorecard["coverage"]["tradesTotal"] == payload["tradeCount"]
    assert payload["aggregates"]["net_pnl_dollar"] == pytest.approx(300.0 - 500.0)
    assert payload["baseline"]["n"] == 2


def test_a_timed_trade_after_8pm_eastern_stays_on_its_eastern_day(conn, client):
    """The other direction: 9 PM Eastern is already the next UTC date."""
    tid = add_trade(conn, symbol="NVDA", entry_date="2026-10-01T19:00:00+00:00",
                    exit_date="2026-10-02T01:00:00+00:00", entry_price=100.0, exit_price=101.0,
                    trading_day_et="2026-10-01")
    own = client.get("/api/j2/review-drafts/daily", params={"day": "2026-10-01", "accountId": ACCOUNT}).json()
    after = client.get("/api/j2/review-drafts/daily", params={"day": "2026-10-02", "accountId": ACCOUNT}).json()
    assert own["tradeCount"] == 1 and own["bestTrade"]["id"] == tid
    assert own["aggregates"]["trade_count"] == 1
    assert after["tradeCount"] == 0


def test_a_row_from_before_the_trading_day_column_falls_back_to_its_exit_date(conn, client):
    """`filters._DAY`'s own fallback: no `trading_day_et` reads the exit date's first ten chars."""
    tid = add_trade(conn, symbol="NVDA", entry_date="2026-10-01T14:00:00+00:00",
                    exit_date="2026-10-01T19:00:00+00:00", entry_price=100.0, exit_price=101.0)
    conn.execute("UPDATE j2_trades SET trading_day_et = NULL WHERE id = ?", (tid,))
    conn.commit()
    payload = client.get("/api/j2/review-drafts/daily", params={"day": "2026-10-01", "accountId": ACCOUNT}).json()
    assert payload["tradeCount"] == 1 and payload["aggregates"]["trade_count"] == 1


def test_the_daily_draft_reads_the_day_through_the_filter_modules_own_spine():
    """One authority, not a second copy: the daily fetch splices `filters._DAY` itself."""
    import inspect
    from api.services.journal_two import filters, review_drafts
    src = inspect.getsource(review_drafts)
    assert "trading_day_et, substr(exit_date" not in src.split('"""', 2)[2], \
        "review_drafts.py restates the trading-day expression; import filters._DAY instead"
    assert review_drafts._DAY is filters._DAY


# ── fin-flags I5: review drafts never write plan-grading state while plan grading is off ────
#
# A draft grades each trade through `plan_grading.grade_payload`, and a first match FREEZES the
# plan (`j2_trade_plan_links`, ruling R4). With review drafts armed and plan grading not, a
# draft froze plans the member could neither see nor Re-link (that control is behind the
# plan-grading switch). A feature must not write another feature's data while it is off.

PG_FLAG = "NOTEBOOK_PLAN_GRADING_ENABLED"


def _own_plan_note(conn, symbol="NVDA", stop=95.0, written="2026-09-29T12:00:00+00:00"):
    from api.services.journal_two import notes, sample_examples
    out = notes.import_confirm(U, {"source": "file", "notes": [{
        "importKey": f"own:{symbol}", "title": f"My {symbol} plan", "tags": [], "folderPath": [],
        "ticker": symbol, "createdAt": written, "updatedAt": written,
        "bodyJson": sample_examples._thesis_note_body(symbol, stop)}]}, conn=conn)
    assert not out["failed"]
    return out["created"][0]["id"]


def _plan_links(conn):
    return conn.execute("SELECT trade_ref, note_id FROM j2_trade_plan_links WHERE user_id = ?", (U,)).fetchall()


def _three_drafts(client):
    return [
        client.get("/api/j2/review-drafts/daily", params={"day": "2026-09-30", "accountId": ACCOUNT}).json(),
        client.get("/api/j2/review-drafts/weekly", params={"weekStart": "2026-09-28", "accountId": ACCOUNT}).json(),
        client.get("/api/j2/review-drafts/monthly", params={"month": "2026-09", "accountId": ACCOUNT}).json(),
    ]


def test_with_plan_grading_off_a_draft_writes_no_plan_link_and_shows_no_grade(conn, client, monkeypatch):
    monkeypatch.delenv(PG_FLAG, raising=False)
    _own_plan_note(conn)
    add_trade(conn, symbol="NVDA", entry_date="2026-09-30T13:30:00+00:00",
              exit_date="2026-09-30T19:00:00+00:00", entry_price=100.0, exit_price=94.0, stop=95.0)
    for payload in _three_drafts(client):
        assert payload["tradeCount"] == 1
        assert payload["discipline"] is None, "a plan-grading surface was built with plan grading off"
        assert payload["links"]["plans"] == []
        assert not {f["kind"] for f in payload["leaks"]} & {"unplanned_trades", "stops_not_honoured"}
    assert _plan_links(conn) == [], "review drafts wrote plan-grading state while plan grading was off"


def test_control_with_plan_grading_on_the_same_draft_freezes_the_plan_and_grades(conn, client, monkeypatch):
    monkeypatch.setenv(PG_FLAG, "1")
    note_id = _own_plan_note(conn)
    add_trade(conn, symbol="NVDA", entry_date="2026-09-30T13:30:00+00:00",
              exit_date="2026-09-30T19:00:00+00:00", entry_price=100.0, exit_price=94.0, stop=95.0)
    payload = client.get("/api/j2/review-drafts/daily", params={"day": "2026-09-30", "accountId": ACCOUNT}).json()
    assert payload["discipline"]["plannedCount"] == 1
    assert [p["noteId"] for p in payload["links"]["plans"]] == [note_id]
    assert [r["note_id"] for r in _plan_links(conn)] == [note_id]


def test_every_caller_that_can_freeze_a_plan_is_behind_the_plan_grading_switch():
    """The rail. `plan_grading`'s matcher writes on a read, so every module that calls it must
    be gated on the plan-grading switch. A new caller is not in this list and fails by name."""
    import ast
    import pathlib
    repo = pathlib.Path(__file__).resolve().parents[1]
    writers = {"grade_payload", "match_trade", "statuses", "discipline_record", "freeze", "relink"}
    gated = {
        # every route sits behind the router-level dependency (asserted below)
        "api/routers/notebook_plan_grades.py",
        # asks `plan_grading_enabled()` before grading (the two tests above)
        "api/services/journal_two/review_drafts.py",
    }
    callers = set()
    for path in sorted((repo / "api").rglob("*.py")):
        rel = path.relative_to(repo).as_posix()
        if path.name.startswith("test_") or rel == "api/services/journal_two/plan_grading.py":
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        names = {a.asname or a.name for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)
                 and (n.module or "").endswith("plan_grading") for a in n.names}
        for n in ast.walk(tree):
            if not isinstance(n, ast.Call):
                continue
            f = n.func
            if isinstance(f, ast.Attribute) and f.attr in writers and isinstance(f.value, ast.Name)                     and f.value.id == "plan_grading":
                callers.add(rel)
            if isinstance(f, ast.Name) and f.id in writers and f.id in names:
                callers.add(rel)
    assert callers, "the scan found no caller at all; it is not looking at the code"
    assert callers <= gated, ("these call plan_grading's matcher and are not known to be gated on "
                              "NOTEBOOK_PLAN_GRADING_ENABLED: " + ", ".join(sorted(callers - gated)))
    assert gated <= callers, "listed as a gated caller but no longer calls it: " + ", ".join(sorted(gated - callers))
    router = (repo / "api/routers/notebook_plan_grades.py").read_text(encoding="utf-8")
    assert "dependencies=[Depends(_require_enabled)]" in router
    drafts = (repo / "api/services/journal_two/review_drafts.py").read_text(encoding="utf-8")
    assert "plan_grading_enabled()" in drafts


# ── fin-data M6: the draft carries how many trades the leak finder could not read ────────────

def test_the_payload_says_how_many_trades_have_no_R(conn, client):
    add_trade(conn, symbol="NVDA", entry_date="2026-09-30T13:30:00+00:00",
              exit_date="2026-09-30T19:00:00+00:00", entry_price=100.0, exit_price=101.0)
    tid = add_trade(conn, symbol="AAPL", entry_date="2026-09-30T14:00:00+00:00",
                    exit_date="2026-09-30T19:30:00+00:00", entry_price=200.0, exit_price=195.0)
    conn.execute("UPDATE j2_trades SET r_multiple = NULL WHERE id = ?", (tid,))
    conn.commit()
    payload = client.get("/api/j2/review-drafts/daily", params={"day": "2026-09-30", "accountId": ACCOUNT}).json()
    assert payload["leakCoverage"] == {"trades": 2, "withR": 1, "withoutR": 1}


# ── fin-security I-2: a draft reads a ticker's notes once, and grading is capped and said ────

def _draft_statements(conn, monkeypatch, n_trades, symbol):
    """Body reads issued while enriching `n_trades` unplanned trades on one ticker."""
    from api.services.journal_two import notes, review_drafts
    monkeypatch.setenv(PG_FLAG, "1")
    notes.import_confirm(U, {"source": "file", "notes": [{
        "importKey": f"journal:{symbol}:{i}", "title": f"{symbol} journal {i}", "tags": [], "folderPath": [],
        "ticker": symbol, "createdAt": "2026-09-20T12:00:00+00:00", "updatedAt": "2026-09-20T12:00:00+00:00",
        "bodyJson": {"type": "doc", "content": [{"type": "paragraph", "content": [
            {"type": "text", "text": "Watching. No levels."}]}]}} for i in range(3)]}, conn=conn)
    for i in range(n_trades):
        add_trade(conn, symbol=symbol, entry_date=f"2026-09-{22 + (i % 5):02d}T13:30:00+00:00",
                  exit_date=f"2026-09-{22 + (i % 5):02d}T19:00:00+00:00", entry_price=100.0, exit_price=99.0)
    rows = conn.execute("SELECT * FROM j2_trades WHERE user_id = ? AND symbol = ?", (U, symbol)).fetchall()
    seen = []
    conn.set_trace_callback(seen.append)
    try:
        out = review_drafts._enrich_trades(conn, U, rows)
    finally:
        conn.set_trace_callback(None)
    assert {t["status"] for t in out} == {"unplanned"}
    return [s for s in seen if "body_json" in s and ("FROM j2_notes" in s or "FROM j2_note_versions" in s)]


def test_a_draft_reads_a_tickers_note_bodies_once_however_many_trades_it_has(conn, db_path, monkeypatch):
    few = _draft_statements(conn, monkeypatch, 2, "NVDA")
    many = _draft_statements(conn, monkeypatch, 15, "AMD")
    assert len(few) > 0, "nothing was read; the comparison proves nothing"
    assert len(many) == len(few)


def test_grading_in_a_draft_is_capped_and_the_payload_says_how_many_were_left_out(conn, client, monkeypatch):
    from api.services.journal_two import review_drafts
    monkeypatch.setenv(PG_FLAG, "1")
    monkeypatch.setattr(review_drafts, "MAX_GRADED_TRADES", 2)
    for hour in (13, 14, 15):
        add_trade(conn, symbol="NVDA", entry_date=f"2026-09-30T{hour}:00:00+00:00",
                  exit_date=f"2026-09-30T{hour}:30:00+00:00", entry_price=100.0, exit_price=99.0)
    payload = client.get("/api/j2/review-drafts/daily", params={"day": "2026-09-30", "accountId": ACCOUNT}).json()
    assert payload["tradeCount"] == 3 and payload["aggregates"]["trade_count"] == 3   # all still counted
    assert payload["gradingCap"] == {"limit": 2, "graded": 2, "ungraded": 1}
    assert payload["discipline"]["unplannedCount"] == 2                                # the newest two


def test_with_plan_grading_off_there_is_no_grading_cap_to_report(conn, client, monkeypatch):
    monkeypatch.delenv(PG_FLAG, raising=False)
    add_trade(conn, symbol="NVDA", entry_date="2026-09-30T13:30:00+00:00",
              exit_date="2026-09-30T19:00:00+00:00", entry_price=100.0, exit_price=101.0)
    payload = client.get("/api/j2/review-drafts/daily", params={"day": "2026-09-30", "accountId": ACCOUNT}).json()
    assert payload["gradingCap"] is None
    assert conn.execute("SELECT COUNT(*) FROM j2_trade_plan_misses").fetchone()[0] == 0


# ── round 2: weekly and monthly drafts use Eastern trading weeks and months ──────────────────
#
# They windowed `exit_date` between UTC midnights (to match the Compass weekly review). A
# trade closed Friday evening Eastern is already Saturday in UTC, so it fell out of its week;
# one closed on the last evening of a month fell into the next month. They now select on the
# same trading-day spine as the daily draft (`filters._DAY`).

def _evening(conn, day, next_utc_day, **kw):
    """Closed at 8:30 PM Eastern on `day`: already `next_utc_day` in UTC."""
    return add_trade(conn, entry_date=f"{day}T19:00:00+00:00", exit_date=f"{next_utc_day}T00:30:00+00:00",
                     trading_day_et=day, **kw)


def test_a_trade_closed_friday_evening_eastern_is_in_that_week(conn, client):
    add_trade(conn, symbol="NVDA", entry_date="2026-09-29T13:30:00+00:00",
              exit_date="2026-09-29T19:00:00+00:00", entry_price=100.0, exit_price=101.0, tid="midweek")
    _evening(conn, "2026-10-02", "2026-10-03", symbol="AAPL", entry_price=200.0, exit_price=195.0, tid="fri-eve")
    this_week = client.get("/api/j2/review-drafts/weekly", params={"weekStart": "2026-09-28", "accountId": ACCOUNT}).json()
    next_week = client.get("/api/j2/review-drafts/weekly", params={"weekStart": "2026-10-05", "accountId": ACCOUNT}).json()
    assert this_week["tradeCount"] == 2 and this_week["aggregates"]["trade_count"] == 2
    assert this_week["worstTrade"]["id"] == "fri-eve"
    assert this_week["aggregates"]["net_pnl_dollar"] == pytest.approx(100.0 - 500.0)
    assert next_week["tradeCount"] == 0
    assert this_week["range"] == {"start": "2026-09-28", "end": "2026-10-02"}


def test_a_trade_closed_sunday_evening_utc_monday_is_not_pulled_into_the_new_week(conn, client):
    """The other edge of the UTC window: Monday 00:30 UTC is Sunday evening Eastern."""
    _evening(conn, "2026-09-27", "2026-09-28", symbol="NVDA", entry_price=100.0, exit_price=101.0)
    week = client.get("/api/j2/review-drafts/weekly", params={"weekStart": "2026-09-28", "accountId": ACCOUNT}).json()
    assert week["tradeCount"] == 0


def test_a_trade_closed_on_the_last_evening_of_a_month_is_in_that_month(conn, client):
    _evening(conn, "2026-09-30", "2026-10-01", symbol="NVDA", entry_price=100.0, exit_price=103.0, tid="sep-eve")
    _date_only_trade(conn, "2026-09-01", symbol="AAPL", entry_price=50.0, exit_price=51.0)   # the first, date-only
    _date_only_trade(conn, "2026-10-01", symbol="MSFT", entry_price=50.0, exit_price=49.0)   # next month's first
    sep = client.get("/api/j2/review-drafts/monthly", params={"month": "2026-09", "accountId": ACCOUNT}).json()
    octo = client.get("/api/j2/review-drafts/monthly", params={"month": "2026-10", "accountId": ACCOUNT}).json()
    assert sep["tradeCount"] == 2 and sep["aggregates"]["trade_count"] == 2 and sep["bestTrade"]["id"] == "sep-eve"
    assert octo["tradeCount"] == 1 and octo["aggregates"]["trade_count"] == 1
    assert sep["range"] == {"start": "2026-09-01", "end": "2026-09-30"}


def test_every_half_of_a_weekly_and_a_monthly_draft_counts_the_same_trades(conn, client):
    from api.services.journal_two import verdict_scorecard
    from api.services.journal_two.filters import FilterSpec
    _evening(conn, "2026-10-02", "2026-10-03", symbol="AAPL", entry_price=200.0, exit_price=195.0)
    _date_only_trade(conn, "2026-09-28", symbol="NVDA", entry_price=100.0, exit_price=103.0)
    for path, params in (("weekly", {"weekStart": "2026-09-28"}), ("monthly", {"month": "2026-09"})):
        payload = client.get(f"/api/j2/review-drafts/{path}", params={**params, "accountId": ACCOUNT}).json()
        card = verdict_scorecard.get_verdict_scorecard(
            U, ACCOUNT, spec=FilterSpec(date_from=payload["range"]["start"], date_to=payload["range"]["end"]), conn=conn)
        assert payload["aggregates"]["trade_count"] == payload["tradeCount"] == payload["baseline"]["n"]
        assert card["coverage"]["tradesTotal"] == payload["tradeCount"], path


# ── the Compass quote is only shown when it is about the same trades ─────────────────────────
#
# Compass's weekly review (not changed in this lane) counts trades whose exit_date is in
# [Monday 00:00 UTC, Saturday 00:00 UTC): coach_data_assembler.assemble_week. Its daily recap
# uses Eastern midnights on exit_date: assemble_day. Both differ from the draft's trading-day
# spine for an evening trade or a date-only one. A quote about a different set of trades must
# not sit beside the draft's numbers as if it were the same period.

def _compass(monkeypatch, *, week=None, day=None):
    from api.services.journal_two import coach
    monkeypatch.setattr(coach, "list_weekly_reviews", lambda *a, **k: (
        [{"metadata": {"week_start": week}, "body": "A steady week. You kept your stops.", "created_at": "x"}] if week else []))
    monkeypatch.setattr(coach, "list_eod_recaps", lambda *a, **k: (
        [{"metadata": {"day": day}, "body": "A quiet day. One clean entry.", "created_at": "x"}] if day else []))


def test_the_weekly_compass_quote_is_shown_when_both_cover_the_same_trades(conn, client, monkeypatch):
    _compass(monkeypatch, week="2026-09-28")
    add_trade(conn, symbol="NVDA", entry_date="2026-09-29T13:30:00+00:00",
              exit_date="2026-09-29T19:00:00+00:00", entry_price=100.0, exit_price=101.0)
    payload = client.get("/api/j2/review-drafts/weekly", params={"weekStart": "2026-09-28", "accountId": ACCOUNT}).json()
    assert payload["compassText"]["text"].startswith("A steady week")
    assert payload["compassOmitted"] is None


def test_the_weekly_compass_quote_is_left_out_when_an_evening_trade_makes_the_periods_differ(conn, client, monkeypatch):
    _compass(monkeypatch, week="2026-09-28")
    add_trade(conn, symbol="NVDA", entry_date="2026-09-29T13:30:00+00:00",
              exit_date="2026-09-29T19:00:00+00:00", entry_price=100.0, exit_price=101.0)
    _evening(conn, "2026-10-02", "2026-10-03", symbol="AAPL", entry_price=200.0, exit_price=195.0)
    payload = client.get("/api/j2/review-drafts/weekly", params={"weekStart": "2026-09-28", "accountId": ACCOUNT}).json()
    assert payload["compassText"] is None, "a quote about a different set of trades was shown as the same week"
    om = payload["compassOmitted"]
    assert om["draftOnly"] == 1 and om["compassOnly"] == 0
    assert "Eastern" in om["sentence"] and "UTC" in om["sentence"] and "1 trade" in om["sentence"]


def test_the_daily_compass_quote_is_left_out_when_a_date_only_trade_makes_the_days_differ(conn, client, monkeypatch):
    _compass(monkeypatch, day="2026-10-01")
    _date_only_trade(conn, "2026-10-01", symbol="NVDA", entry_price=100.0, exit_price=103.0)
    payload = client.get("/api/j2/review-drafts/daily", params={"day": "2026-10-01", "accountId": ACCOUNT}).json()
    assert payload["compassText"] is None and payload["compassOmitted"]["draftOnly"] == 1
    # Control: a timed trade is the same day for both, and the quote is shown.
    conn.execute("DELETE FROM j2_trades")
    conn.commit()
    add_trade(conn, symbol="NVDA", entry_date="2026-10-01T13:30:00+00:00",
              exit_date="2026-10-01T19:00:00+00:00", entry_price=100.0, exit_price=101.0)
    payload = client.get("/api/j2/review-drafts/daily", params={"day": "2026-10-01", "accountId": ACCOUNT}).json()
    assert payload["compassText"]["text"].startswith("A quiet day") and payload["compassOmitted"] is None


def test_with_no_compass_review_there_is_nothing_to_omit(conn, client, monkeypatch):
    _compass(monkeypatch)
    _evening(conn, "2026-10-02", "2026-10-03", symbol="AAPL", entry_price=200.0, exit_price=195.0)
    payload = client.get("/api/j2/review-drafts/weekly", params={"weekStart": "2026-09-28", "accountId": ACCOUNT}).json()
    assert payload["compassText"] is None and payload["compassOmitted"] is None


# ── fin walk P7: a draft SAYS the discipline part is unavailable, and why ───────────────────

def test_with_plan_grading_off_the_draft_says_the_discipline_part_is_unavailable_and_why(conn, client, monkeypatch):
    """Leaving the section out silently while the box still promises "the discipline record" is
    a promise nobody keeps. The payload names the reason, so the client can say it."""
    monkeypatch.delenv(PG_FLAG, raising=False)
    add_trade(conn, symbol="NVDA", entry_date="2026-09-30T13:30:00+00:00",
              exit_date="2026-09-30T19:00:00+00:00", entry_price=100.0, exit_price=94.0, stop=95.0)
    for payload in _three_drafts(client):
        assert payload["discipline"] is None
        assert payload["disciplineOmitted"] == {
            "reason": "plan_grading_off",
            "sentence": "Plan grading is switched off, so this draft has no discipline record.",
        }


def test_with_plan_grading_on_nothing_is_said_to_be_left_out(conn, client, monkeypatch):
    monkeypatch.setenv(PG_FLAG, "1")
    add_trade(conn, symbol="NVDA", entry_date="2026-09-30T13:30:00+00:00",
              exit_date="2026-09-30T19:00:00+00:00", entry_price=100.0, exit_price=94.0, stop=95.0)
    for payload in _three_drafts(client):
        assert payload["discipline"] is not None
        assert payload["disciplineOmitted"] is None
