"""Checklist from my winners (P2 Tier 3, Task 6): `checklist_suggestions.suggest` and its route.

R-T3-4: habits are `emotion_tags`; `mistake_tags` is never a checklist item.
R-T3-5: the best trades are the top BEST_N winners by effective R (ties: later exit day, then trade
id); at least MIN_WINNERS winners; a tag qualifies on BOTH a share of the best (MIN_SHARE) and a
lift over the rest (MIN_LIFT, infinite when the tag never appears outside the best); at most
MAX_SUGGESTIONS, ordered by share. A trade with no effective R cannot be ranked and is left out.
Inclusion is analytics' own ANALYTICS_INCLUDED_SQL, so an `analytics_excluded` trade counts nowhere.

The route: GET /api/j2/insights/checklist-suggestions, 404 with JOURNAL_TIER3_ENABLED off (before the
session or the plan), 401 signed out, 402 for an unpaid member (the router's require_paid).
"""
from __future__ import annotations

import importlib
import json
import os
import sqlite3
import tempfile
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services.journal_two import checklist_suggestions as cs

URL = "/api/j2/insights/checklist-suggestions"


# ── fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    c = sqlite3.connect(tmp.name)
    for uid in ("u1", "u2"):
        c.execute("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'pw')", (uid, f"{uid}@x.com"))
    c.commit()
    c.close()
    yield tmp.name
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


@pytest.fixture
def conn(db_path):
    c = sqlite3.connect(db_path)
    c.row_factory = sqlite3.Row
    yield c
    c.close()


# ── helpers ──────────────────────────────────────────────────────────────────

def _account(conn, user_id="u1"):
    aid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT INTO j2_accounts (id, user_id, name, color, broker, starting_balance,
               account_size, default_stop, position_closing, breakeven_range, setups,
               share_journal_data, created_at, updated_at)
           VALUES (?, ?, ?, 'blue', NULL, 100000, 100000, '{"mode":"custom"}', 'FIFO',
                   '{"enabled":false,"unit":"$","value":0}', '[]', 0, ?, ?)""",
        (aid, user_id, f"Account {aid[:8]}", now, now))
    conn.commit()
    return aid


_DAY0 = datetime(2026, 3, 2, tzinfo=timezone.utc)


def _trade(conn, aid, *, r, day_index, symbol="NVDA", emotion=None, mistake=None, excluded=False,
           user_id="u1", tid=None):
    """A closed equity trade. `r` is its stop R (None: no effective R); day_index sets the exit day."""
    tid = tid or str(uuid.uuid4())
    day = (_DAY0 + timedelta(days=day_index)).date().isoformat()
    exit_iso = f"{day}T18:00:00Z"
    pnl = 100.0 if (r or 0) > 0 else -100.0
    result = "Win" if (r or 0) > 0 else "Loss"
    conn.execute(
        """INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price,
               entry_date, exit_price, exit_date, original_stop, setup, notes, pnl_dollar,
               pnl_percent, r_multiple, hold_days, result, context_at_entry, account_id,
               created_at, trading_day_et, emotion_tags, mistake_tags, analytics_excluded)
           VALUES (?, ?, 'manual', ?, 'Long', 100, 500, ?, 510, ?, 490, 'VCP', NULL, ?, 0.02, ?, 1,
                   ?, '{}', ?, ?, ?, ?, ?, ?)""",
        (tid, user_id, symbol, exit_iso, exit_iso, pnl, r, result, aid, exit_iso, day,
         json.dumps(emotion) if emotion else None, json.dumps(mistake) if mistake else None,
         1 if excluded else 0))
    conn.commit()
    return tid


def _book(conn, aid, *, winners, losers, best_tags=None, rest_tags=None, best_mistakes=None,
          user_id="u1"):
    """`winners` winners with R winners+1 .. 2 (strictly falling, so the best 20 are the first 20),
    then `losers` losers. best_tags[i] / rest_tags[j] are the emotion tags of the i-th best trade /
    the j-th trade outside the best (lower winners first, then losers)."""
    best_tags = best_tags or {}
    rest_tags = rest_tags or {}
    best_mistakes = best_mistakes or {}
    ids = []
    for i in range(winners):
        tags = best_tags.get(i) if i < cs.BEST_N else rest_tags.get(i - cs.BEST_N)
        ids.append(_trade(conn, aid, r=float(winners + 1 - i), day_index=i, symbol=f"W{i}",
                          emotion=tags, mistake=best_mistakes.get(i) if i < cs.BEST_N else None,
                          user_id=user_id))
    for j in range(losers):
        k = max(winners - cs.BEST_N, 0) + j
        ids.append(_trade(conn, aid, r=-1.0, day_index=100 + j, symbol=f"L{j}", emotion=rest_tags.get(k),
                          user_id=user_id))
    return ids


def _tag(result, tag):
    found = [s for s in result["suggestions"] if s["tag"] == tag]
    return found[0] if found else None


def _rule(conn, aid, label, *, before_entry=True, status="active", user_id="u1"):
    from api.services.journal_two import journal_rules
    rec = journal_rules.create_rule(user_id, aid, label, conn=conn)
    conn.execute("UPDATE j2_journal_rules SET before_entry = ?, status = ? WHERE id = ?",
                 (1 if before_entry else 0, status, rec["id"]))
    conn.commit()
    return rec["id"]


# ── 1. fewer than ten winners suggests nothing ─────────────────────────────────

def test_fewer_than_ten_winners_is_too_few_and_suggests_nothing(conn):
    aid = _account(conn)
    _book(conn, aid, winners=9, losers=5, best_tags={i: ["patient"] for i in range(9)})
    out = cs.suggest(conn, "u1", aid)
    assert out == {"status": "too_few", "winnerCount": 9, "bestCount": 0, "suggestions": []}
    assert cs.MIN_WINNERS == 10


def test_exactly_ten_winners_is_enough(conn):
    aid = _account(conn)
    _book(conn, aid, winners=10, losers=5, best_tags={i: ["patient"] for i in range(10)})
    out = cs.suggest(conn, "u1", aid)
    assert (out["status"], out["winnerCount"], out["bestCount"]) == ("ok", 10, 10)
    assert _tag(out, "patient") is not None


# ── 2. a tag on every trade is not a winners' habit ────────────────────────────

def test_a_tag_on_every_trade_is_not_suggested(conn):
    aid = _account(conn)
    # 25 winners + 15 losers = 40 trades, "steady" on all 40: ratio 1.0. "patient" is on 10 of the
    # best only (the control: the same book DOES suggest something, so an empty list is not why).
    tags_best = {i: ["steady", "patient"] if i < 10 else ["steady"] for i in range(cs.BEST_N)}
    tags_rest = {j: ["steady"] for j in range(20)}
    _book(conn, aid, winners=25, losers=15, best_tags=tags_best, rest_tags=tags_rest)
    out = cs.suggest(conn, "u1", aid)
    assert out["status"] == "ok" and out["winnerCount"] == 25 and out["bestCount"] == 20
    assert _tag(out, "steady") is None
    assert _tag(out, "patient") is not None


# ── 3. a tag on half the best and rare elsewhere is suggested, with its evidence ─

def test_a_tag_on_10_of_the_best_and_1_of_30_others_is_suggested_with_ten_trades_of_evidence(conn):
    aid = _account(conn)
    # 30 winners + 20 losers: the best 20, and 30 others (10 lower winners, 20 losers).
    best_with = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18]
    ids = _book(conn, aid, winners=30, losers=20,
                best_tags={i: ["patient"] for i in best_with}, rest_tags={25: ["patient"]})
    out = cs.suggest(conn, "u1", aid)
    s = _tag(out, "patient")
    assert s is not None
    assert s["label"] == "Before entry: am I patient?"
    assert s["shareBest"] == 0.5
    assert s["shareOthers"] == round(1 / 30, 4)
    assert len(s["evidence"]) == 10
    # Evidence is in R order, descending, and names each trade.
    rs = [e["r"] for e in s["evidence"]]
    assert rs == sorted(rs, reverse=True) and rs[0] == 31.0
    assert [e["tradeId"] for e in s["evidence"]] == [ids[i] for i in best_with]
    first = s["evidence"][0]
    assert first == {"tradeRef": f"id:{ids[0]}", "tradeId": ids[0], "symbol": "W0",
                     "exitDate": "2026-03-02", "r": 31.0}


# ── 4. a mistake tag is never suggested ────────────────────────────────────────

def test_a_mistake_tag_on_18_of_the_best_is_never_suggested(conn):
    aid = _account(conn)
    # "chasing" is a MISTAKE tag on 18 of the best; "focused" is an EMOTION tag with the same
    # distribution, and it IS suggested -- so the field, not the numbers, is what excludes "chasing".
    _book(conn, aid, winners=20, losers=20,
          best_tags={i: ["focused"] for i in range(18)},
          best_mistakes={i: ["chasing"] for i in range(18)})
    out = cs.suggest(conn, "u1", aid)
    assert _tag(out, "chasing") is None
    assert _tag(out, "focused") is not None and _tag(out, "focused")["shareBest"] == 0.9


# ── 5. a tag already on the checklist is dropped ───────────────────────────────

def _patient_book(conn):
    aid = _account(conn)
    _book(conn, aid, winners=20, losers=20, best_tags={i: ["patient"] for i in range(12)})
    return aid


def test_a_tag_already_present_as_a_before_entry_rule_is_not_suggested(conn):
    aid = _patient_book(conn)
    assert _tag(cs.suggest(conn, "u1", aid), "patient") is not None             # control
    _rule(conn, aid, "Before entry: am I PATIENT?")                              # case-insensitive
    assert _tag(cs.suggest(conn, "u1", aid), "patient") is None


def test_only_an_active_before_entry_rule_drops_the_tag_and_it_matches_the_whole_word(conn):
    aid = _patient_book(conn)
    _rule(conn, aid, "Before entry: am I patient?", before_entry=False)          # not on the checklist
    _rule(conn, aid, "Before entry: am I patient?", status="dismissed")          # gone from it
    _rule(conn, aid, "Before entry: am I impatient?")                            # another word
    other = _account(conn)
    _rule(conn, other, "Before entry: am I patient?")                            # another account
    assert _tag(cs.suggest(conn, "u1", aid), "patient") is not None
    # All Accounts reads every rule the member has, so the other account's rule now counts.
    assert _tag(cs.suggest(conn, "u1", None), "patient") is None


# ── 6. analytics_excluded trades are ignored ───────────────────────────────────

def test_analytics_excluded_trades_count_nowhere(conn):
    aid = _account(conn)
    _book(conn, aid, winners=30, losers=20, best_tags={i: ["patient"] for i in range(10)},
          rest_tags={25: ["patient"]})
    # Excluded winners with a higher R than any best trade would take the best slots, and excluded
    # trades carrying the tag would sink its lift (21 of 50 > half of 50%), if either were counted.
    for k in range(20):
        _trade(conn, aid, r=99.0, day_index=200 + k, symbol=f"X{k}", emotion=["patient"], excluded=True)
    out = cs.suggest(conn, "u1", aid)
    assert out["winnerCount"] == 30
    s = _tag(out, "patient")
    assert s is not None and s["shareOthers"] == round(1 / 30, 4)
    assert all(not e["symbol"].startswith("X") for e in s["evidence"])


def test_excluded_winners_do_not_lift_a_book_past_the_minimum(conn):
    aid = _account(conn)
    _book(conn, aid, winners=9, losers=3)
    for k in range(5):
        _trade(conn, aid, r=2.0, day_index=300 + k, excluded=True)
    assert cs.suggest(conn, "u1", aid)["status"] == "too_few"


# ── 7. at most five, ordered by share ──────────────────────────────────────────

def test_at_most_five_suggestions_ordered_by_share_then_tag(conn):
    aid = _account(conn)
    # Seven qualifying tags, never outside the best: on 20, 18, 16, 14, 12, 12, 10 of the best.
    counts = {"alpha": 20, "bravo": 18, "charlie": 16, "delta": 14, "foxtrot": 12, "echo": 12, "golf": 10}
    best_tags = {i: [t for t, n in counts.items() if i < n] for i in range(cs.BEST_N)}
    _book(conn, aid, winners=20, losers=10, best_tags=best_tags)
    out = cs.suggest(conn, "u1", aid)
    assert [s["tag"] for s in out["suggestions"]] == ["alpha", "bravo", "charlie", "delta", "echo"]
    assert [s["shareBest"] for s in out["suggestions"]] == [1.0, 0.9, 0.8, 0.7, 0.6]
    assert cs.MAX_SUGGESTIONS == 5


# ── the cut: ties and unrankable trades ────────────────────────────────────────

def test_the_best_cut_breaks_ties_by_later_exit_day_then_trade_id(conn):
    aid = _account(conn)
    # 21 winners, all R 2.0: the oldest exit day falls out of the best 20.
    for i in range(21):
        _trade(conn, aid, r=2.0, day_index=i, symbol=f"T{i}", emotion=["oldest"] if i == 0 else ["calm"])
    out = cs.suggest(conn, "u1", aid)
    assert out["bestCount"] == 20
    assert _tag(out, "oldest") is None
    calm = _tag(out, "calm")
    assert len(calm["evidence"]) == 20
    days = [e["exitDate"] for e in calm["evidence"]]
    assert days == sorted(days, reverse=True)


def test_the_rank_is_r_then_the_later_day_then_the_trade_id():
    t = lambda tid, day, r: {"id": tid, "day": day, "r": r}
    ranked = cs._rank([t("b", "2026-03-05", 1.0), t("a", "2026-03-05", 1.0), t("c", "2026-03-09", 1.0),
                       t("d", "2026-01-01", 3.0)])
    assert [x["id"] for x in ranked] == ["d", "c", "a", "b"]
    # Order-independent: the same set in any order ranks the same.
    assert [x["id"] for x in cs._rank(list(reversed(ranked)))] == ["d", "c", "a", "b"]


def test_a_trade_with_no_effective_r_is_left_out(conn):
    aid = _account(conn)
    for i in range(9):
        _trade(conn, aid, r=2.0, day_index=i)
    for i in range(5):
        _trade(conn, aid, r=None, day_index=20 + i, emotion=["patient"])     # a winner by P&L, no R
    out = cs.suggest(conn, "u1", aid)
    assert out["status"] == "too_few" and out["winnerCount"] == 9


def test_another_members_trades_are_never_read(conn):
    aid = _account(conn)
    other = _account(conn, user_id="u2")
    _book(conn, other, winners=20, losers=10, best_tags={i: ["patient"] for i in range(20)}, user_id="u2")
    assert cs.suggest(conn, "u2", other)["winnerCount"] == 20      # control: the book is there
    assert cs.suggest(conn, "u1", None) == {"status": "too_few", "winnerCount": 0, "bestCount": 0,
                                            "suggestions": []}
    assert cs.suggest(conn, "u1", aid)["winnerCount"] == 0


# ── 8. the route ──────────────────────────────────────────────────────────────

@pytest.fixture
def client(db_path, monkeypatch):
    monkeypatch.setenv(cs.FLAG, "1")
    from api.routers import journal_two
    app = FastAPI()
    app.include_router(journal_two.router)
    c = TestClient(app)
    c.app_ref = app
    yield c
    app.dependency_overrides.clear()


def _as(client, uid="u1", plan="pro"):
    user = {"id": uid, "role": "member", "plan": plan}
    client.app_ref.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    client.app_ref.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)


def test_the_route_answers_the_dict_for_a_paid_member(client, conn):
    aid = _account(conn)
    _book(conn, aid, winners=20, losers=10, best_tags={i: ["patient"] for i in range(12)})
    _as(client)
    r = client.get(URL, params={"account_id": aid})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and [s["tag"] for s in body["suggestions"]] == ["patient"]
    assert client.get(URL).json()["winnerCount"] == 20           # All Accounts


def test_switch_off_is_the_one_404_before_the_session_or_the_plan(client, monkeypatch):
    _as(client)
    assert client.get(URL).status_code == 200                    # control: the route exists
    monkeypatch.setenv(cs.FLAG, "0")
    r = client.get(URL)
    assert (r.status_code, r.json()) == (404, {"detail": "Not found"})
    _as(client, plan="free")
    assert client.get(URL).status_code == 404                    # not a 402
    client.app_ref.dependency_overrides.clear()
    monkeypatch.delenv(cs.FLAG, raising=False)
    assert client.get(URL).status_code == 404                    # signed out, unset: not a 401


def test_signed_out_is_401_and_an_unpaid_member_is_402(client):
    assert client.get(URL).status_code == 401
    _as(client, plan="free")
    r = client.get(URL)
    assert r.status_code == 402 and r.json()["detail"] == "Notebook Ask requires a paid plan"


def test_the_switch_is_read_per_request(monkeypatch):
    monkeypatch.delenv(cs.FLAG, raising=False)
    assert cs.enabled() is False
    monkeypatch.setenv(cs.FLAG, "true")
    assert cs.enabled() is True
