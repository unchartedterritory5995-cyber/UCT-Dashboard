"""R-P2b-3: windows by version, sample sizes always, never a bare rate under 10 trades.

Shared with lane A's Task 9 (R-PF-N19): lane S writes the service cases here; Task 9 appends its
client-parity case. Pre-flight corrections railed here: B4 (the adherence store answers a dict),
N6 (a version's change day is its ET date), N7 (one adherence join: the trade's own record, else
its position's pre-entry record), N20 (a dismissed rule answers 404).
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

@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)

def _trade(day, result, r=None, account="a1", user="u1", excluded=0, position="p"):
    from api.services.auth_db import get_connection
    c = get_connection()
    tid = uuid.uuid4().hex
    c.execute("INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price, entry_date, exit_price,"
              " exit_date, original_stop, pnl_dollar, pnl_percent, r_multiple, hold_days, result, context_at_entry,"
              " created_at, account_id, analytics_excluded) VALUES (?, ?, ?, 'NVDA', 'Long', 1, 100, ?, 101, ?, 95,"
              " 1, 0.01, ?, 1, ?, '{}', 'now', ?, ?)", (tid, user, position, day, day, r, result, account, excluded))
    c.commit(); c.close()
    return tid

def _rule_with_v2(changed_day, changed_at=None):
    from api.services.auth_db import get_connection
    from api.services.journal_two import journal_rules, rule_versions as rv
    r = journal_rules.create_rule("u1", "a1", "Wait 5 minutes")
    c = get_connection()
    c.execute("UPDATE j2_journal_rules SET created_at = '2026-01-01T00:00:00+00:00' WHERE id = ?", (r["id"],))
    c.execute("UPDATE j2_journal_rule_versions SET changed_at = '2026-01-01T00:00:00+00:00' WHERE rule_id = ?", (r["id"],))
    c.commit(); c.close()
    rv.edit_rule("u1", r["id"], {"label": "Wait 15 minutes"})
    c = get_connection()
    c.execute("UPDATE j2_journal_rule_versions SET changed_at = ? WHERE rule_id = ? AND version = 2",
              (changed_at or f"{changed_day}T14:00:00+00:00", r["id"]))
    c.commit(); c.close()
    return r

def test_windows_split_on_the_change_day(db_path):
    from api.services.journal_two import rule_versions as rv
    r = _rule_with_v2("2026-03-01")
    for d in ("2026-02-10", "2026-02-11"):
        _trade(d, "Loss", -1.0)
    for d in ("2026-03-01", "2026-03-05", "2026-03-06"):
        _trade(d, "Win", 2.0)
    _trade("2026-03-07", "Win", 9.0, excluded=1)                          # excluded from analytics
    _trade("2026-03-08", "Win", 9.0, account="other")                    # another account
    v2 = rv.before_after("u1", r["id"])["versions"][0]
    assert v2["version"] == 2
    assert (v2["before"]["trades"], v2["before"]["wins"], v2["before"]["avgR"]) == (2, 0, -1.0)
    assert (v2["after"]["trades"], v2["after"]["wins"], v2["after"]["avgR"]) == (3, 3, 2.0)
    assert v2["after"]["small"] is True and v2["after"]["winRate"] == 1.0

def test_the_change_day_is_the_et_date_not_the_utc_date(db_path):
    """R-PF-N6: a change made at 21:00 ET on March 1 is stamped 02:00Z on March 2. Its day is March 1,
    so a trade entered on March 1 counts AFTER the change, and one on Feb 28 before it."""
    from api.services.journal_two import rule_versions as rv
    r = _rule_with_v2("2026-03-02", changed_at="2026-03-02T02:00:00+00:00")
    _trade("2026-02-28", "Loss", -1.0)
    _trade("2026-03-01", "Win", 2.0)
    v2 = rv.before_after("u1", r["id"])["versions"][0]
    assert (v2["before"]["trades"], v2["before"]["wins"]) == (1, 0)
    assert (v2["after"]["trades"], v2["after"]["wins"]) == (1, 1)

def test_a_trade_entered_in_the_evening_et_is_that_days_trade(db_path):
    """The trade's day is its ET date too: 01:30Z on March 1 is 20:30 ET on Feb 28, before a change
    made during March 1's session."""
    from api.services.journal_two import rule_versions as rv
    r = _rule_with_v2("2026-03-01")
    _trade("2026-03-01T01:30:00+00:00", "Loss", -1.0)
    v2 = rv.before_after("u1", r["id"])["versions"][0]
    assert (v2["before"]["trades"], v2["after"]["trades"]) == (1, 0)

def test_empty_and_partial_windows_say_so(db_path):
    from api.services.journal_two import rule_versions as rv
    r = _rule_with_v2("2026-03-01")
    _trade("2026-03-02", "Win", None)                                     # no R recorded
    v2 = rv.before_after("u1", r["id"])["versions"][0]
    assert v2["before"] == {**v2["before"], "trades": 0, "winRate": None, "avgR": None, "adherence": None}
    assert (v2["after"]["trades"], v2["after"]["rCount"], v2["after"]["avgR"]) == (1, 0, None)
    assert v2["after"]["adherenceCount"] == 0 and v2["after"]["adherence"] is None

def test_adherence_averages_only_trades_with_a_record(db_path):
    from api.services.journal_two import adherence_store, rule_versions as rv
    r = _rule_with_v2("2026-03-01")
    t1 = _trade("2026-03-02", "Win", 1.0)
    _trade("2026-03-03", "Loss", -1.0)
    adherence_store.upsert_adherence("u1", f"id:{t1}", "VCP", ["a", "b"], 4)
    after = rv.before_after("u1", r["id"])["versions"][0]["after"]
    assert (after["adherenceCount"], after["adherence"]) == (1, 0.5)

def test_adherence_falls_back_to_the_positions_pre_entry_record(db_path):
    """R-PF-N7: a trade ticked in Log Trade while its position was open has no record of its own;
    its adherence is the pos:<position id> record. The trade's own record still wins."""
    from api.services.journal_two import adherence_store, rule_versions as rv, trader_blocks
    r = _rule_with_v2("2026-03-01")
    _trade("2026-03-02", "Win", 1.0, position="pos-a")                    # pre-entry record only
    t2 = _trade("2026-03-03", "Win", 1.0, position="pos-b")               # both: its own wins
    adherence_store.upsert_adherence("u1", trader_blocks.pre_entry_ref("pos-a"), "VCP", ["a"], 4)
    adherence_store.upsert_adherence("u1", trader_blocks.pre_entry_ref("pos-b"), "VCP", [], 4)
    adherence_store.upsert_adherence("u1", f"id:{t2}", "VCP", ["a", "b", "c", "d"], 4)
    after = rv.before_after("u1", r["id"])["versions"][0]["after"]
    assert (after["adherenceCount"], after["adherence"]) == (2, round((0.25 + 1.0) / 2, 4))

def test_versions_and_windows_follow_an_edit(db_path):
    from api.services.journal_two import rule_versions as rv
    r = _rule_with_v2("2026-03-01")
    rv.edit_rule("u1", r["id"], {"label": "Wait 30 minutes"})
    got = rv.before_after("u1", r["id"])
    assert [v["version"] for v in got["versions"]] == [3, 2, 1]
    assert got["versions"][1]["after"]["to"] == got["versions"][0]["changedAt"]

def test_another_members_rule_is_none(db_path):
    from api.services.journal_two import journal_rules, rule_versions as rv
    assert rv.before_after("u1", journal_rules.create_rule("u2", "a1", "x")["id"]) is None

def test_a_dismissed_rule_is_none(db_path):
    """R-PF-N20: the client says "It may have been dismissed" on a 404; the server must mean it."""
    from api.services.journal_two import journal_rules, rule_versions as rv
    r = journal_rules.create_rule("u1", "a1", "Wait 5 minutes")
    assert rv.before_after("u1", r["id"]) is not None                     # control: the live rule answers
    journal_rules.dismiss_rule("u1", r["id"])
    assert rv.before_after("u1", r["id"]) is None

def test_route(db_path):
    from api.routers import notebook_journal_styles as rt
    from api.services.journal_two import journal_rules
    app = FastAPI()
    app.include_router(rt.router)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {"id": "u1", "role": "member", "plan": "pro"}
    c = TestClient(app)
    r = _rule_with_v2("2026-03-01")
    got = c.get(f"/api/j2/trader-blocks/rules/{r['id']}/before-after")
    assert got.status_code == 200 and [v["version"] for v in got.json()["versions"]] == [2, 1]
    theirs = journal_rules.create_rule("u2", "a1", "x")
    assert c.get(f"/api/j2/trader-blocks/rules/{theirs['id']}/before-after").status_code == 404
    journal_rules.dismiss_rule("u1", r["id"])
    assert c.get(f"/api/j2/trader-blocks/rules/{r['id']}/before-after").status_code == 404
