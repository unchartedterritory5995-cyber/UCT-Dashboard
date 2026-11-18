"""The Terminal list alerts: tell a member when a stock they follow comes onto the New
52-week highs list, the confluence board or the repeat-hit option contracts list.

Module: ``api/services/list_alerts.py``. Routes: ``api/routers/list_alerts.py``.

THESE ALERTS SEND EMAIL TO REAL MEMBERS, so this file is mostly about what must NOT happen:
  * nothing with the server setting off (no list read, no database opened, routes 404);
  * nothing without the member's own switch;
  * never twice for one event: not on a second pass, not after a restart, not when a
    later pass sees more names;
  * nothing, and nothing recorded, when a list fails to load, is not tonight's, or the
    members' names cannot be read;
  * one member's failed delivery never costs another member theirs;
  * at most one message per member per list per session (the daily cap);
  * a stock that stays on a list is said once, and again only after it has been off the
    list for `REARM_SESSIONS` checked sessions.
Then: the exact words (table-driven, never advice), the three list readers, the routes,
the account purge, the email's last line and the wiring in ``api/main.py``.

⛔ NO REAL DELIVERY AND NO REAL LIST. Every run is handed a recording ``deliver`` and
scripted lists; an autouse fixture makes the real `deliver_alert_payload` and `send_email`
fail the test if anything reaches them, and the flow-worker read is refused outright.
"""
from __future__ import annotations

import ast
import datetime
import logging
import pathlib
import re
import sqlite3
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.services import list_alerts as A
from api.services import watchlist_alert_service as _was
from api.services.screener import snapshot_db as db

#: The real functions, kept before the autouse fixture below replaces them with a refusal.
REAL_DELIVER, REAL_WORKER_JSON, REAL_MEMBER = _was.deliver_alert_payload, A._worker_json, A._member

ET = ZoneInfo("America/New_York")
REPO = pathlib.Path(__file__).resolve().parents[1]
H, C, R = A.HIGHS52, A.CONFLUENCE, A.REPEAT
# Trading days. Thursday 2026-11-26 is Thanksgiving; the 14th and 15th are a weekend.
MON, TUE, WED, THU, FRI = "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"
MON2, TUE2, WED2 = "2026-11-23", "2026-11-24", "2026-11-25"
WEEK = (MON, TUE, WED, THU, FRI, MON2, TUE2, WED2)
PAID = {"id": "u1", "role": "member", "plan": "pro"}
ADMIN = {"id": "boss", "role": "admin", "plan": "free"}
FREE = {"id": "free1", "role": "member", "plan": "free"}
#: Words that would turn a fact into advice.
ADVICE = re.compile(r"\b(buy|buys|buying|sell|sells|selling|should|recommend\w*|target|entry|"
                    r"opportunit\w+|breakout)\b", re.I)


def at(day, hour=18, minute=10):
    y, m, d = (int(x) for x in day.split("-"))
    return datetime.datetime(y, m, d, hour, minute, tzinfo=ET)


def high(sym, close=None, pct=None):
    return {"key": sym, "sym": sym, "close": close, "pct": pct}


def conf(sym, lean="BULL", status="BUILDING", dark_pool=None, net=None):
    return {"key": sym, "sym": sym, "dir": lean, "status": status, "dark_pool": dark_pool, "net": net}


def contract(sym, cp="C", strike=150.0, expiry="2026-12-18", hits=5, premium=2_400_000, direction="Bull"):
    return {"key": f"{sym}|{cp}|{strike:g}|{expiry}", "sym": sym, "cp": cp, "strike": strike,
            "expiry": expiry, "hits": hits, "premium": premium, "direction": direction}


# ───────────────────────── fixtures ─────────────────────────

@pytest.fixture(autouse=True)
def no_real_delivery(monkeypatch):
    """Nothing in this file may reach a member, a mailbox, a webhook or the flow-worker."""
    from api.services import email_service, watchlist_alert_service as was

    def refuse(*a, **k):
        raise AssertionError("a test reached the real delivery or a real list")
    monkeypatch.setattr(was, "deliver_alert_payload", refuse)
    monkeypatch.setattr(was, "send_email", refuse)
    monkeypatch.setattr(email_service, "send_email", refuse, raising=False)
    monkeypatch.setattr(A, "_worker_json", refuse)


class Lists:
    """Tonight's three lists, scripted. A kind set to a string is a list that did not
    load (that string is its state); a kind set to an exception raises it."""

    def __init__(self):
        self.rows = {H: [], C: [], R: []}
        self.calls = []

    def set(self, **by_kind):
        self.rows.update(by_kind)
        return self

    def loaders(self):
        def one(kind):
            def load(session):
                self.calls.append((kind, session))
                got = self.rows[kind]
                if isinstance(got, Exception):
                    raise got
                if isinstance(got, str):
                    return {"state": got}
                return {"state": "ok", "rows": [dict(r) for r in got],
                        "context": {"days": 30, "min_hits": 3}}
            return load
        return {k: one(k) for k in A.KINDS}


class Sent(list):
    """A recording `deliver`: every call's keyword arguments, in order."""

    def __call__(self, **kw):
        self.append(kw)
        return {"claimed": True, "channels": {"in_app": "ok"}, "channels_ok": 1,
                "channels_failed": 0, "errors": {}}


@pytest.fixture
def armed(tmp_path, monkeypatch):
    """The setting on for everyone, every member paid, an empty screener.db, scripted lists.
    `night(day, ...)` is one evening's run; it returns the receipt."""
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    monkeypatch.setenv(A.FLAG, "1")
    monkeypatch.setattr(A, "_member", lambda uid: {"id": uid, "role": "member", "plan": "pro"})
    A._done.clear()

    class Night:
        lists = Lists()
        sent = Sent()
        follows = {"u1": {"AAA", "BBB", "CCC"}, "u2": {"AAA"}}

        def __call__(self, day, hour=18, minute=10, **kw):
            kw.setdefault("deliver", self.sent)
            kw.setdefault("routing", lambda uid: None)
            kw.setdefault("loaders", self.lists.loaders())
            kw.setdefault("follows", lambda ids: {u: set(s) for u, s in self.follows.items() if u in ids})
            return A.run_evening(at(day, hour, minute), **kw)

    return Night()


def table(name, cols="*", order="1"):
    with sqlite3.connect(db.get_db_path()) as conn:
        try:
            return [tuple(r) for r in conn.execute(f"SELECT {cols} FROM {name} ORDER BY {order}")]
        except sqlite3.OperationalError:
            return None                                         # the table does not exist


def told():
    return table("list_alerts_told", "user_id, kind, key, streak_start", "user_id, kind, key, streak_start")


def messages():
    return table("list_alert_messages", "user_id, kind, session, outcome, n_keys", "user_id, kind, session")


# ───────────────────────── the server setting ─────────────────────────

@pytest.mark.parametrize("value, expected", [
    (None, "off"), ("", "off"), ("0", "off"), ("true", "off"), ("yes", "off"), ("on", "off"),
    ("2", "off"), ("1", "on"), (" 1 ", "on"), ("admin", "admin"), ("ADMIN", "admin")])
def test_only_1_and_admin_arm_the_setting(monkeypatch, value, expected):
    if value is None:
        monkeypatch.delenv(A.FLAG, raising=False)
    else:
        monkeypatch.setenv(A.FLAG, value)
    assert A.mode() == expected
    assert A.enabled() is (expected != "off")


def test_the_setting_off_nothing_is_read_stored_or_sent(armed, monkeypatch, tmp_path):
    """⛔ The whole feature ships dark. Off: no list is read, no database is opened."""
    A.set_switch("u1", H, True)                                 # even with a switch already on
    armed(MON)
    armed.lists.set(**{H: [high("AAA")]})
    path = tmp_path / "never.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    A._done.clear()
    monkeypatch.delenv(A.FLAG)
    before = len(armed.lists.calls)
    out = armed(TUE)
    assert out["reason"] == "disabled" and out["mode"] == "off" and out["sent"] == 0
    assert armed.sent == [] and len(armed.lists.calls) == before
    assert not path.exists(), "the run opened a database with the setting off"


def test_who_is_allowed_under_each_value(monkeypatch):
    monkeypatch.setenv(A.FLAG, "1")
    assert A.allowed(PAID) and A.allowed(ADMIN)
    assert not A.allowed(FREE) and not A.allowed(None) and not A.allowed("u1")
    monkeypatch.setenv(A.FLAG, "admin")
    assert A.allowed(ADMIN) and not A.allowed(PAID) and not A.allowed(FREE)
    monkeypatch.delenv(A.FLAG)
    assert not A.allowed(ADMIN) and not A.allowed(PAID)


# ───────────────────────── the member's switch ─────────────────────────

def test_no_switch_no_alert(armed):
    """⛔ A member who follows the stock, on a night it is new on every list, with the
    setting armed, is sent NOTHING unless they turned that list's switch on."""
    armed(MON)
    armed.lists.set(**{H: [high("AAA")], C: [conf("AAA")], R: [contract("AAA")]})
    out = armed(TUE)
    assert armed.sent == [] and out["members"] == 0
    assert [out["kinds"][k]["new"] for k in A.KINDS] == [1, 1, 1], "non-vacuity: the names were new"
    assert told() == [] and messages() == []


def test_a_member_without_the_switch_is_not_sent_what_a_member_with_it_is(armed):
    """⛔ Both follow AAA; only u2 asked. The names are handed over for BOTH members here
    (more than the run asks for), so only the switch can be what keeps u1 quiet."""
    A.set_switch("u2", H, True)
    everyone = lambda ids: {"u1": {"AAA"}, "u2": {"AAA"}}        # noqa: E731
    armed(MON, follows=everyone)
    armed.lists.set(**{H: [high("AAA")]})
    armed(TUE, follows=everyone)
    assert [s["user_id"] for s in armed.sent] == ["u2"]
    assert told() == [("u2", H, "AAA", TUE)]


def test_switching_off_stops_the_alerts(armed):
    A.set_switch("u1", H, True)
    armed(MON)
    A.set_switch("u1", H, False)
    armed.lists.set(**{H: [high("AAA")]})
    out = armed(TUE)
    assert armed.sent == [] and out["members"] == 0 and told() == []


def test_the_run_asks_for_the_names_of_subscribed_members_only(armed):
    A.set_switch("u2", C, True)
    asked = []

    def follows(ids):
        asked.append(list(ids))
        return {}
    armed(MON, follows=follows)
    assert asked == [["u2"]]


def test_a_switch_is_for_one_list_only(armed):
    A.set_switch("u1", C, True)
    armed(MON)
    armed.lists.set(**{H: [high("AAA")], C: [conf("AAA")], R: [contract("AAA")]})
    armed(TUE)
    assert [s["extra_data"]["kind"] for s in armed.sent] == [C]


def test_switches_are_per_member_idempotent_and_only_the_three(armed):
    assert A.switches("u1") == set()
    assert A.set_switch("u1", H, True) == {"kind": H, "on": True}
    A.set_switch("u1", H, True)
    A.set_switch("u2", R, True)
    assert A.switches("u1") == {H} and A.switches("u2") == {R}
    assert table("list_alert_subs", "user_id, kind", "user_id") == [("u1", H), ("u2", R)]
    assert A.set_switch("u1", H, False) == {"kind": H, "on": False}
    A.set_switch("u1", H, False)
    assert A.switches("u1") == set()
    for bad in ("lows52", "", None, "H52"):
        with pytest.raises(A.UnknownKind):
            A.set_switch("u1", bad, True)
    with pytest.raises(ValueError):
        A.set_switch("", H, True)


# ───────────────────────── newly on a list ─────────────────────────

def test_the_first_check_is_a_baseline_and_says_nothing(armed):
    """With nothing earlier to compare with, "it was not there before" cannot be known."""
    A.set_switch("u1", H, True)
    armed.lists.set(**{H: [high("AAA"), high("BBB")]})
    out = armed(MON)
    assert armed.sent == [] and out["kinds"][H]["state"] == "baseline"
    assert table("list_alert_presence", "kind, key, first_session, last_session", "key") == [
        (H, "AAA", MON, MON), (H, "BBB", MON, MON)]
    # and the names that were there on the baseline are not new the next night either
    out = armed(TUE)
    assert armed.sent == [] and out["kinds"][H]["state"] == "ok" and out["kinds"][H]["new"] == 0


def test_a_followed_stock_that_comes_onto_the_list_is_said_once(armed):
    A.set_switch("u1", H, True)
    A.set_switch("u2", H, True)
    armed.lists.set(**{H: [high("ZZZ")]})
    armed(MON)
    armed.lists.set(**{H: [high("ZZZ"), high("AAA", 142.5, 3.21), high("QQQQ", 10, 1)]})
    out = armed(TUE)
    assert [(s["user_id"], s["sym"], s["title"]) for s in armed.sent] == [
        ("u1", "AAA", "AAA made a new 52-week high"), ("u2", "AAA", "AAA made a new 52-week high")]
    assert out["kinds"][H] == {"state": "ok", "on_list": 3, "new": 2, "subscribers": 2, "sent": 2,
                              "quiet": 0, "skipped_dedup": 0, "suspended": 0, "not_allowed": 0, "errors": 0}
    assert out["sent"] == 2 and out["session"] == TUE
    assert told() == [("u1", H, "AAA", TUE), ("u2", H, "AAA", TUE)]
    assert messages() == [("u1", H, TUE, "sent", 1), ("u2", H, TUE, "sent", 1)]
    # ⛔ a stock that STAYS on the list does not alert every day
    for day in (WED, THU, FRI):
        armed(day)
    assert len(armed.sent) == 2


def test_a_stock_nobody_follows_and_a_member_with_no_names_are_quiet(armed):
    A.set_switch("u1", H, True)
    A.set_switch("u3", H, True)                                 # u3 follows nothing
    armed(MON)
    armed.lists.set(**{H: [high("XXXX")]})
    out = armed(TUE)
    assert armed.sent == [] and out["kinds"][H]["quiet"] == 2 and told() == []


def test_turning_a_switch_on_never_sends_a_burst_about_names_already_there(armed):
    """The list was checked for everyone before this member asked: AAA has been on the
    board all week, so switching on tonight says nothing about it."""
    armed.lists.set(**{C: [conf("AAA"), conf("BBB")]})
    for day in (MON, TUE, WED):
        armed(day)
    A.set_switch("u1", C, True)
    out = armed(THU)
    assert armed.sent == [] and out["kinds"][C]["new"] == 0
    armed.follows["u1"].add("NEWW")
    armed.lists.set(**{C: [conf("AAA"), conf("BBB"), conf("NEWW")]})
    armed(FRI)
    assert [s["sym"] for s in armed.sent] == ["NEWW"]


# ───────────────────────── the re-arm rule ─────────────────────────

def _on_then_off_then_back(armed, off_days):
    """AAA comes on (said), leaves for `off_days` checked sessions, comes back."""
    A.set_switch("u1", H, True)
    days = list(WEEK)
    armed(days.pop(0))                                          # baseline, list empty
    armed.lists.set(**{H: [high("AAA")]})
    armed(days.pop(0))
    assert len(armed.sent) == 1
    armed.lists.set(**{H: []})
    for _ in range(off_days):
        armed(days.pop(0))
    armed.lists.set(**{H: [high("AAA")]})
    armed(days.pop(0))
    return days


def test_back_after_fewer_off_sessions_than_the_rule_is_not_said_again(armed):
    _on_then_off_then_back(armed, A.REARM_SESSIONS - 1)
    assert len(armed.sent) == 1
    assert table("list_alert_presence", "first_session", "key") == [(TUE,)], "the same appearance"


def test_back_after_the_rule_s_off_sessions_is_a_new_appearance_and_is_said(armed):
    _on_then_off_then_back(armed, A.REARM_SESSIONS)
    assert len(armed.sent) == 2
    assert [t[3] for t in told()] == [TUE, WED2], "two appearances, two records"


def test_the_rule_is_five_sessions():
    """The number the owner is told. Changing it changes what members receive."""
    assert A.REARM_SESSIONS == 5 and A.BASELINE_MAX_AGE_DAYS == 5 and A.MAX_NAMED == 12


def test_a_night_the_list_could_not_be_read_is_not_counted_as_off(armed):
    """Unknown is never "off the list": four real off sessions and a failed read in the
    middle is still fewer than five."""
    A.set_switch("u1", H, True)
    armed(MON)
    armed.lists.set(**{H: [high("AAA")]})
    armed(TUE)
    armed.lists.set(**{H: []})
    armed(WED), armed(THU)
    armed.lists.set(**{H: "not_stored"})
    armed(FRI)
    armed.lists.set(**{H: []})
    armed(MON2), armed(TUE2)
    armed.lists.set(**{H: [high("AAA")]})
    armed(WED2)
    assert len(armed.sent) == 1


def test_after_a_long_gap_the_next_check_is_a_baseline_again(armed):
    """The job was dark for weeks: a name on the list tonight may have been there for days,
    so nothing is said until there is a recent check to compare with."""
    A.set_switch("u1", H, True)
    armed(MON)
    armed.lists.set(**{H: [high("AAA")]})
    out = armed("2026-12-07")
    assert armed.sent == [] and out["kinds"][H]["state"] == "baseline"
    armed.lists.set(**{H: [high("AAA"), high("BBB")]})
    armed("2026-12-08")
    assert [s["sym"] for s in armed.sent] == ["BBB"]


def test_a_long_weekend_is_not_a_long_gap(armed):
    A.set_switch("u1", H, True)
    armed(WED2)                                                 # Wednesday before Thanksgiving
    armed.lists.set(**{H: [high("AAA")]})
    assert armed("2026-11-26")["reason"] == "not_a_trading_day"
    armed("2026-11-30")                                         # the Monday after, 5 days on
    assert [s["sym"] for s in armed.sent] == ["AAA"]


# ───────────────────────── never twice ─────────────────────────

def _one_alert(armed, kind=H, row=None):
    A.set_switch("u1", kind, True)
    armed(MON)
    armed.lists.set(**{kind: [row or high("AAA")]})
    out = armed(TUE)
    assert len(armed.sent) == 1, out
    return out


def test_a_second_pass_the_same_session_sends_nothing_more(armed):
    _one_alert(armed)
    out = armed(TUE, 21, 50)
    assert len(armed.sent) == 1 and out["kinds"][H]["skipped_dedup"] == 1 and out["sent"] == 0


def test_a_restart_never_re_sends(armed):
    """⛔ Everything that stops a repeat is on disk. A new process (nothing remembered in
    memory) running the same evening again, and the next evening, sends nothing more."""
    _one_alert(armed)
    A._done.clear()                                             # all the module remembers
    fresh = Sent()
    armed(TUE, 21, 50, deliver=fresh)
    armed(WED, deliver=fresh)
    assert fresh == [] and len(armed.sent) == 1


def test_a_later_pass_that_sees_more_names_still_sends_no_second_message(armed):
    """The daily cap: one message per member per list per session."""
    _one_alert(armed)
    armed.lists.set(**{H: [high("AAA"), high("BBB"), high("CCC")]})
    armed(TUE, 21, 50)
    assert len(armed.sent) == 1
    assert messages() == [("u1", H, TUE, "sent", 1)]


def test_a_second_pass_never_announces_a_stock_that_was_already_on_the_list(armed):
    """The retry pass reads the list again. A stock that has been on it since before
    tonight was not new on the first pass, and is not new on the second either (a member
    the first pass had nothing for holds no claim that would stop it)."""
    A.set_switch("u1", H, True)
    armed.lists.set(**{H: [high("AAA")]})
    armed(MON)
    armed(TUE)
    out = armed(TUE, 21, 50)
    assert armed.sent == [] and out["kinds"][H]["new"] == 0
    # ...while a stock that comes on between the two passes IS new, and is said once
    armed.lists.set(**{H: [high("AAA"), high("BBB")]})
    armed(TUE, 22, 30)
    armed(TUE, 23, 0)
    assert [s["sym"] for s in armed.sent] == ["BBB"]


def test_at_most_one_message_per_list_per_session_whatever_is_on_the_lists(armed):
    """⛔ THE DAILY CAP. Forty new names on each list, three passes: three messages."""
    for kind in A.KINDS:
        A.set_switch("u1", kind, True)
    armed(MON)
    syms = [f"S{i:02d}" for i in range(40)]
    armed.follows["u1"] = set(syms)
    armed.lists.set(**{H: [high(s) for s in syms], C: [conf(s) for s in syms],
                       R: [contract(s) for s in syms]})
    for hour, minute in ((18, 10), (21, 50), (23, 0)):
        armed(TUE, hour, minute)
    assert sorted(s["extra_data"]["kind"] for s in armed.sent) == sorted(A.KINDS)
    assert len(messages()) == 3 and len(told()) == 120, "every name is recorded as said"


def test_the_claim_is_taken_before_anything_is_sent(armed):
    A.set_switch("u1", H, True)
    armed(MON)
    armed.lists.set(**{H: [high("AAA")]})
    seen = []

    def deliver(**kw):
        seen.append((messages(), told()))
        return Sent()(**kw)
    armed(TUE, deliver=deliver)
    assert seen == [([("u1", H, TUE, "sent", 1)], [("u1", H, "AAA", TUE)])]


def test_the_claim_is_taken_by_exactly_one_caller(armed):
    A.set_switch("u1", H, True)                                 # creates the tables
    assert A._claim("u1", H, TUE, ["AAA", "BBB"], "sent") == ["AAA", "BBB"]
    assert A._claim("u1", H, TUE, ["AAA", "BBB"], "sent") is None, "the session is taken"
    assert A._claim("u1", H, WED, ["AAA"], "sent") == ["AAA"], "another session, a new appearance key"
    assert A._claim("u2", H, TUE, ["AAA"], "sent") == ["AAA"], "another member"
    # every key already told for this appearance: nothing to say, and the session row is not kept
    A._release("u2", H, TUE)
    with A._db() as conn:
        conn.execute("INSERT INTO list_alerts_told VALUES ('u2', ?, 'AAA', ?, ?, 1)", (H, TUE, MON))
    assert A._claim("u2", H, TUE, ["AAA"], "sent") == []
    assert ("u2", H, TUE, "sent", 0) not in messages() and ("u2", H, TUE, "sent", 1) not in messages()


def test_off_and_on_again_the_same_evening_does_not_repeat_the_message(armed):
    _one_alert(armed)
    A.set_switch("u1", H, False)
    A.set_switch("u1", H, True)
    armed(TUE, 21, 50)
    assert len(armed.sent) == 1


# ───────────────────────── a list that fails ─────────────────────────

@pytest.mark.parametrize("failure", ["not_stored", "degraded", "stale", "other_day", "unreadable",
                                     RuntimeError("flow-worker down"), None, {"state": "ok"}])
def test_a_list_that_fails_to_load_sends_nothing_and_records_nothing(armed, failure):
    """⛔ Whatever the failure, and the other two lists still run."""
    for kind in A.KINDS:
        A.set_switch("u1", kind, True)
    armed(MON)
    before = (table("list_alert_presence"), table("list_alert_sessions", "kind, session", "kind, session"))
    armed.lists.set(**{H: [high("AAA")], C: [conf("AAA")], R: [contract("AAA")]})
    loaders = armed.lists.loaders()
    if failure is None or isinstance(failure, dict):
        loaders[H] = lambda session: None if failure is None else {"state": "ok", "rows": None}
        if isinstance(failure, dict):
            # a healthy answer with no rows IS a list: it is recorded, and nothing is new
            out = armed(TUE, loaders=loaders)
            assert out["kinds"][H]["state"] == "ok" and out["kinds"][H]["on_list"] == 0
            return
    else:
        armed.lists.set(**{H: failure})
        loaders = armed.lists.loaders()
    out = armed(TUE, loaders=loaders)
    assert sorted(s["extra_data"]["kind"] for s in armed.sent) == [C, R], "the other lists still ran"
    assert out["kinds"][H]["sent"] == 0 and out["kinds"][H]["state"] not in ("ok", "baseline")
    assert [r for r in table("list_alert_presence") if r[0] == H] == [r for r in before[0] if r[0] == H]
    assert (H, TUE) not in table("list_alert_sessions", "kind, session", "kind, session")
    assert [t for t in told() if t[1] == H] == [] and [m for m in messages() if m[1] == H] == []
    # the night it loads again, the name is still new and is said then, once
    armed.lists.set(**{H: [high("AAA")]})
    armed(WED)
    assert [s["extra_data"]["kind"] for s in armed.sent].count(H) == 1


def test_when_the_members_names_cannot_be_read_nothing_is_read_sent_or_recorded(armed):
    A.set_switch("u1", H, True)
    armed(MON)
    armed.lists.set(**{H: [high("AAA")]})
    calls = len(armed.lists.calls)

    def boom(ids):
        raise sqlite3.OperationalError("auth.db is locked")
    out = armed(TUE, follows=boom)
    assert armed.sent == [] and out["reason"].startswith("follows_unreadable") and out["errors"] == 1
    assert len(armed.lists.calls) == calls, "a list was read with nobody to tell"
    assert (H, TUE) not in table("list_alert_sessions", "kind, session", "kind, session")
    armed(TUE, 21, 50)                                          # the retry pass tells them
    assert [s["sym"] for s in armed.sent] == ["AAA"]


@pytest.mark.parametrize("day, hour, minute, reason", [
    (TUE, 9, 45, "before_the_close"), (TUE, 15, 59, "before_the_close"),
    (TUE, 16, 30, "before_the_close"), ("2026-11-21", 18, 10, "not_a_trading_day"),
    ("2026-11-26", 18, 10, "not_a_trading_day"),
    ("2026-11-27", 13, 30, "before_the_close")])                # a half day closes at 13:00
def test_no_list_is_read_before_the_close_or_on_a_day_without_a_session(armed, day, hour, minute, reason):
    """⛔ The by-contract read is on the flow-worker: never in market hours."""
    A.set_switch("u1", H, True)
    out = armed(day, hour, minute)
    assert out["reason"] == reason and armed.lists.calls == [] and armed.sent == []
    assert table("list_alert_sessions") in (None, [])


def test_a_half_day_is_checked_an_hour_after_its_early_close(armed):
    assert armed("2026-11-27", 14, 0)["session"] == "2026-11-27"


def test_each_list_is_read_once_per_run_however_many_members(armed):
    for uid in ("u1", "u2", "u3", "u4"):
        for kind in A.KINDS:
            A.set_switch(uid, kind, True)
    armed(MON)
    assert sorted(armed.lists.calls) == sorted((k, MON) for k in A.KINDS)


def test_the_lists_are_recorded_for_everyone_even_with_no_subscriber(armed):
    """So the night a first member switches on, "new" already means new."""
    armed.lists.set(**{H: [high("AAA")]})
    out = armed(MON)
    assert out["members"] == 0 and table("list_alert_sessions", "kind, session, n_keys", "kind") == [
        (C, MON, 0), (H, MON, 1), (R, MON, 0)]


# ───────────────────────── one member never costs another ─────────────────────────

def test_one_member_s_failed_delivery_never_costs_another_theirs(armed):
    A.set_switch("u1", H, True)
    A.set_switch("u2", H, True)
    armed(MON)
    armed.lists.set(**{H: [high("AAA")]})
    good = Sent()

    def deliver(**kw):
        if kw["user_id"] == "u1":
            raise RuntimeError("mail provider down")
        return good(**kw)
    out = armed(TUE, deliver=deliver)
    assert [s["user_id"] for s in good] == ["u2"]
    assert out["kinds"][H]["errors"] == 1 and out["kinds"][H]["sent"] == 1 and out["errors"] == 1
    # u1's claim was given back, so the retry pass tells u1, and u2 is not told again
    assert told() == [("u2", H, "AAA", TUE)]
    armed(TUE, 21, 50, deliver=good)
    assert [s["user_id"] for s in good] == ["u2", "u1"]


def test_a_delivery_that_reached_nobody_gives_the_claim_back(armed):
    A.set_switch("u1", H, True)
    armed(MON)
    armed.lists.set(**{H: [high("AAA")]})

    def nobody(**kw):
        return {"claimed": True, "channels": {"in_app": "failed", "email": "failed"},
                "channels_ok": 0, "channels_failed": 2, "errors": {}}
    out = armed(TUE, deliver=nobody)
    assert out["kinds"][H]["errors"] == 1 and told() == [] and messages() == []
    armed(TUE, 21, 50)
    armed(TUE, 23, 0)
    assert len(armed.sent) == 1, "told once, on the retry"


def test_a_partly_delivered_message_is_delivered(armed):
    """In-app landed, email failed: the member was told. It is not sent again."""
    A.set_switch("u1", H, True)
    armed(MON)
    armed.lists.set(**{H: [high("AAA")]})
    calls = []

    def partly(**kw):
        calls.append(kw)
        return {"claimed": True, "channels": {"in_app": "ok", "email": "failed"},
                "channels_ok": 1, "channels_failed": 1, "errors": {}}
    armed(TUE, deliver=partly)
    armed(TUE, 21, 50, deliver=partly)
    assert len(calls) == 1 and messages() == [("u1", H, TUE, "sent", 1)]


def test_a_member_who_cannot_be_served_is_sent_nothing_and_nothing_is_recorded(armed, monkeypatch):
    """No longer paid, or an account that cannot be read: unknown is never sent to."""
    for uid in ("u1", "u2"):
        A.set_switch(uid, H, True)
    armed(MON)
    armed.lists.set(**{H: [high("AAA")]})
    monkeypatch.setattr(A, "_member", lambda uid: None if uid == "u1" else {"id": uid, "role": "member", "plan": "free"})
    out = armed(TUE)
    assert armed.sent == [] and out["kinds"][H]["not_allowed"] == 2 and told() == [] and messages() == []


def test_under_the_owner_s_preview_only_an_admin_is_sent_a_message(armed, monkeypatch):
    monkeypatch.setenv(A.FLAG, "admin")
    monkeypatch.setattr(A, "_member", lambda uid: dict(ADMIN, id=uid) if uid == "boss" else dict(PAID, id=uid))
    for uid in ("u1", "boss"):
        A.set_switch(uid, H, True)
    armed.follows["boss"] = {"AAA"}
    armed(MON)
    armed.lists.set(**{H: [high("AAA")]})
    assert armed(TUE)["mode"] == "admin"
    assert [s["user_id"] for s in armed.sent] == ["boss"]


def test_the_member_record_carries_the_plan_the_paid_check_reads(armed, monkeypatch):
    from api.services import auth_service
    monkeypatch.setattr(auth_service, "get_user_by_id", lambda uid: {"id": uid, "role": "member"} if uid == "u1" else None)
    monkeypatch.setattr(auth_service, "get_user_plan", lambda uid: "pro")
    assert REAL_MEMBER("u1") == {"id": "u1", "role": "member", "plan": "pro"} and A.allowed(REAL_MEMBER("u1"))
    assert REAL_MEMBER("ghost") is None

    def boom(uid):
        raise OSError("disk")
    monkeypatch.setattr(auth_service, "get_user_by_id", boom)
    assert REAL_MEMBER("u1") is None


# ───────────────────────── the member's own alert settings ─────────────────────────

class Rule:
    def __init__(self, channels=frozenset(), suspended=False):
        self._channels, self.suspended = frozenset(channels), suspended

    def channels_allowed(self):
        return self._channels


def test_the_members_routing_rule_decides_the_channels(armed):
    _one_alert(armed)
    assert "channels_allowed" not in armed.sent[0], "no rule: every channel, as before"
    A.set_switch("u2", H, True)
    armed.lists.set(**{H: [high("AAA")]})
    armed.lists.set(**{C: []})
    sent = Sent()
    A.set_switch("u2", C, True)
    armed.lists.set(**{C: [conf("AAA")]})
    armed(WED, deliver=sent, routing=lambda uid: Rule({"push"}))
    assert [s["channels_allowed"] for s in sent] == [frozenset({"push"})] * len(sent) and sent


def test_a_member_who_paused_every_alert_is_sent_nothing_and_it_is_recorded(armed):
    A.set_switch("u1", H, True)
    armed(MON)
    armed.lists.set(**{H: [high("AAA")]})
    out = armed(TUE, routing=lambda uid: Rule(suspended=True))
    assert armed.sent == [] and out["kinds"][H]["suspended"] == 1
    assert messages() == [("u1", H, TUE, "suspended", 1)]
    # resuming later the same evening does not send what was held back
    armed(TUE, 21, 50)
    assert armed.sent == []


def test_the_default_wiring_is_the_existing_delivery_and_the_existing_routing_rule(armed, monkeypatch):
    from api.services import watchlist_alert_service as was
    from api.services.alert_taxonomy import routing_rule
    sent = Sent()
    monkeypatch.setattr(was, "deliver_alert_payload", sent)
    monkeypatch.setattr(routing_rule, "effective", lambda uid: Rule({"email"}))
    A.set_switch("u1", H, True)
    A.run_evening(at(MON), loaders=armed.lists.loaders(), follows=lambda ids: {"u1": {"AAA"}})
    armed.lists.set(**{H: [high("AAA", 142.5, 3.21)]})
    A.run_evening(at(TUE), loaders=armed.lists.loaders(), follows=lambda ids: {"u1": {"AAA"}})
    assert sent == [{
        "user_id": "u1", "sym": "AAA", "title": "AAA made a new 52-week high",
        "message": ("AAA, a stock you follow, made a new 52-week high on Nov 17 (close $142.50, "
                    "+3.21% on the day). From the Breadth Monitor's new 52-week highs list."),
        "source": "list_alert", "severity": "info", "channels_allowed": frozenset({"email"}),
        "extra_data": {"kind": H, "session": TUE, "symbols": ["AAA"], "keys": ["AAA"],
                       "research_url": "/terminal?cmd=H52%20HIGHS"}}]


def test_the_default_names_are_the_members_own_watchlists_and_flagged_list(armed, monkeypatch, tmp_path):
    """The run's default `follows` is `member_interest.own_list_symbols_by_user`, read
    against a real seeded auth.db: own lists and the Flagged list count; a prebuilt index
    list never does; an open position alone never does."""
    from api.services import auth_db
    conn = sqlite3.connect(tmp_path / "auth.db")
    conn.executescript(auth_db._SCHEMA)

    def wl(wid, uid, syms, prebuilt=0, flagged=0):
        conn.execute("INSERT INTO watchlists (id, user_id, name, is_public, is_flagged_list, is_prebuilt) "
                     "VALUES (?,?,?,?,?,?)", (wid, uid, wid, 0, flagged, prebuilt))
        for i, s in enumerate(syms):
            conn.execute("INSERT INTO watchlist_items (id, watchlist_id, sym, sort_order) VALUES (?,?,?,?)",
                         (f"{wid}-{i}", wid, s, i))
    wl("own", "u1", ["aaa"])
    wl("flag", "u1", ["FLG"], flagged=1)
    wl("index", "u1", ["IDX"], prebuilt=1)
    wl("other", "u2", ["OTH"])
    conn.commit()
    conn.close()
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from api.services import member_interest as mi
    assert mi.own_list_symbols_by_user(["u1", "u2", "nobody"]) == {"u1": {"AAA", "FLG"}, "u2": {"OTH"}}
    assert mi.own_list_symbols_by_user([]) == {}
    assert mi.own_list_symbols_by_user(["u1"])["u1"] == mi._watchlist_syms("u1"), "one definition"
    A.set_switch("u1", H, True)
    A.run_evening(at(MON), deliver=armed.sent, routing=lambda u: None, loaders=armed.lists.loaders())
    armed.lists.set(**{H: [high("AAA"), high("FLG"), high("IDX"), high("OTH")]})
    A.run_evening(at(TUE), deliver=armed.sent, routing=lambda u: None, loaders=armed.lists.loaders())
    assert armed.sent[0]["extra_data"]["symbols"] == ["AAA", "FLG"]
    # ⛔ unreadable is not "follows nothing": it raises, so the run can send nothing
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "missing"))
    with pytest.raises(sqlite3.Error):
        mi.own_list_symbols_by_user(["u1"])


# ───────────────────────── the words ─────────────────────────

RULE = " A contract is listed when trades over a size floor hit it 3 or more times in one session."
BOARD = (" The board lists stocks where dark pool size and long-dated options flow line up over "
         "the last 30 trading days.")
SOURCE = " From the Breadth Monitor's new 52-week highs list."
WORDS = [
    (H, [high("AAA", 142.5, 3.21)], "AAA made a new 52-week high",
     "AAA, a stock you follow, made a new 52-week high on Nov 17 (close $142.50, +3.21% on the day)." + SOURCE),
    (H, [high("AAA", 1042.5, -0.4)], "AAA made a new 52-week high",
     "AAA, a stock you follow, made a new 52-week high on Nov 17 (close $1,042.50, -0.40% on the day)." + SOURCE),
    # a number the row does not carry is left out, never drawn as 0
    (H, [high("AAA")], "AAA made a new 52-week high",
     "AAA, a stock you follow, made a new 52-week high on Nov 17." + SOURCE),
    (H, [high("AAA", 142.5, 3.21), high("BBB", 20.25), high("CCC")],
     "3 stocks you follow made a new 52-week high",
     "New 52-week highs on Nov 17 among the stocks you follow: AAA (close $142.50, +3.21% on the day), "
     "BBB (close $20.25), CCC." + SOURCE),
    (C, [conf("AAA", "BULL", "BUILDING", 182_000_000, 12_400_000)], "AAA is now on the confluence board",
     "AAA, a stock you follow, came onto the confluence board (checked Nov 17, after the close): bullish, "
     "building; $182.0M traded in the dark pool and $12.4M net bullish option premium." + BOARD),
    (C, [conf("AAA", "BEAR", "ESTABLISHED", 2_100_000_000, -5_300_000)], "AAA is now on the confluence board",
     "AAA, a stock you follow, came onto the confluence board (checked Nov 17, after the close): bearish, "
     "established; $2.1B traded in the dark pool and $5.3M net bearish option premium." + BOARD),
    (C, [conf("AAA", "", "")], "AAA is now on the confluence board",
     "AAA, a stock you follow, came onto the confluence board (checked Nov 17, after the close)." + BOARD),
    (C, [conf("AAA"), conf("BBB", "BEAR", "STEADY")], "2 stocks you follow are now on the confluence board",
     "Came onto the confluence board among the stocks you follow (checked Nov 17, after the close): "
     "AAA (bullish, building), BBB (bearish, steady)." + BOARD),
    (R, [contract("AAA")], "AAA has a new repeat-hit option contract",
     "AAA, a stock you follow, has a new repeat-hit option contract on Nov 17: the $150 call expiring "
     "2026-12-18, hit 5 times for $2.4M in premium (bullish)." + RULE),
    (R, [contract("AAA", "P", 152.5, "2026-11-20", None, None, "Unclear")], "AAA has a new repeat-hit option contract",
     "AAA, a stock you follow, has a new repeat-hit option contract on Nov 17: the $152.50 put expiring "
     "2026-11-20 (side not clear)." + RULE),
    (R, [contract("AAA"), contract("AAA", "P", 140, "2026-11-20", 3, 950_000, "Bear")],
     "AAA has 2 new repeat-hit option contracts",
     "AAA, a stock you follow, has 2 new repeat-hit option contracts on Nov 17: AAA $150 call expiring "
     "2026-12-18 (5 hits, $2.4M premium, bullish); AAA $140 put expiring 2026-11-20 (3 hits, $950K premium, "
     "bearish)." + RULE),
    (R, [contract("AAA"), contract("BBB", "C", 20, "2027-01-15", 1, 500, "Mixed")],
     "New repeat-hit option contracts on 2 stocks you follow",
     "New repeat-hit option contracts on Nov 17 among the stocks you follow: AAA $150 call expiring "
     "2026-12-18 (5 hits, $2.4M premium, bullish); BBB $20 call expiring 2027-01-15 (1 hit, $500 premium, "
     "mixed)." + RULE),
]


@pytest.mark.parametrize("kind, rows, title, message", WORDS)
def test_the_message_words(kind, rows, title, message):
    assert A.compose(kind, rows, TUE, {"days": 30, "min_hits": 3}) == (title, message)


def test_no_word_is_advice_and_the_copy_rules_hold():
    for kind, rows, _t, _m in WORDS:
        for text in A.compose(kind, rows, TUE, {"days": 30, "min_hits": 3}):
            assert not ADVICE.search(text), text
            assert "—" not in text and "  " not in text and not re.search(r"[^\x00-\x7F]", text), text
            assert "None" not in text and "nan" not in text.lower(), text


def test_the_twelve_name_cap_says_how_many_more(armed):
    A.set_switch("u1", H, True)
    armed(MON)
    syms = [f"S{i:02d}" for i in range(15)]
    armed.follows["u1"] = set(syms)
    armed.lists.set(**{H: [high(s) for s in syms]})
    armed(TUE)
    (one,) = armed.sent
    assert one["sym"] == "MARKET" and one["title"] == "15 stocks you follow made a new 52-week high"
    assert one["message"] == ("New 52-week highs on Nov 17 among the stocks you follow: "
                              + ", ".join(syms[:12]) + ", +3 more." + SOURCE)
    assert one["extra_data"]["symbols"] == syms and len(told()) == 15, "the three not named are recorded too"


def test_the_names_keep_the_list_s_own_order(armed):
    A.set_switch("u1", H, True)
    armed(MON)
    armed.lists.set(**{H: [high("CCC"), high("AAA"), high("BBB")]})
    armed(TUE)
    assert armed.sent[0]["extra_data"]["symbols"] == ["CCC", "AAA", "BBB"]


@pytest.mark.parametrize("kind, link", [(H, "/terminal?cmd=H52%20HIGHS"), (C, "/terminal?cmd=CONFL"),
                                        (R, "/terminal?cmd=ACCUM")])
def test_the_bell_opens_the_list_itself(kind, link):
    """ONE FACT IN TWO FILES: the code must be a Terminal code, read from the registry."""
    assert A.list_link(kind) == link
    registry = (REPO / "app" / "src" / "pages" / "terminal" / "functions.js").read_text(encoding="utf-8")
    assert f"code: '{A.KIND_INFO[kind]['code']}'" in registry


def test_a_contract_alert_for_one_stock_carries_that_stock(armed):
    _one_alert(armed, R, contract("AAA"))
    one = armed.sent[0]
    assert one["sym"] == "AAA" and one["extra_data"]["keys"] == ["AAA|C|150|2026-12-18"]
    assert one["extra_data"]["research_url"] == "/terminal?cmd=ACCUM"


def test_a_contract_is_remembered_by_contract_not_by_stock(armed):
    """A second contract on the same stock the next day is a new event; the first is not."""
    _one_alert(armed, R, contract("AAA"))
    armed.lists.set(**{R: [contract("AAA"), contract("AAA", "P", 140, "2026-11-20")]})
    armed(WED)
    assert [s["extra_data"]["keys"] for s in armed.sent] == [["AAA|C|150|2026-12-18"], ["AAA|P|140|2026-11-20"]]


# ───────────────────────── what a member actually receives ─────────────────────────

def test_the_bell_entry_and_the_email_a_member_receives(armed, monkeypatch):
    """The real `deliver_alert_payload`, with only the mailbox and the address stubbed."""
    from api.services import alerts as alerts_svc, watchlist_alert_service as was
    from api.services.cache import cache
    monkeypatch.setenv("DISCORD_ALERT_WEBHOOK", "")
    mail = []
    monkeypatch.setattr(was, "send_email", lambda to, subject, html: mail.append((to, subject, html)) or True)
    monkeypatch.setattr(was, "_get_user_email", lambda uid: "member@example.test")
    monkeypatch.setattr(was, "_push_channel", lambda *a, **k: None)
    cache.delete_prefix("alerts:")
    A.set_switch("u1", H, True)
    kw = {"deliver": REAL_DELIVER, "routing": lambda u: None, "follows": lambda ids: {"u1": {"AAA"}}}
    A.run_evening(at(MON), loaders=armed.lists.loaders(), **kw)
    armed.lists.set(**{H: [high("AAA", 142.5, 3.21)]})
    out = A.run_evening(at(TUE), loaders=armed.lists.loaders(), **kw)
    assert out["sent"] == 1
    try:
        (bell,) = [a for a in alerts_svc.get_alerts(user_id="u1") if a["type"] == "list_alert"]
    finally:
        cache.delete_prefix("alerts:")
    assert (bell["title"], bell["severity"]) == ("AAA made a new 52-week high", "info")
    assert bell["message"].startswith("AAA, a stock you follow, made a new 52-week high on Nov 17 (close $142.50")
    assert bell["data"]["research_url"] == "/terminal?cmd=H52%20HIGHS" and bell["data"]["symbol"] == "AAA"
    ((to, subject, html),) = mail
    assert to == "member@example.test" and subject == "UCT Alert: AAA made a new 52-week high"
    assert "AAA, a stock you follow, made a new 52-week high on Nov 17 (close $142.50, +3.21% on the day)." in html
    assert "Alert me when a stock I follow appears here" in html and "chart toolbar" not in html


def test_the_email_s_last_line_says_where_this_switch_is():
    """ONE FACT IN THREE FILES, each read rather than retyped: the alert's source, the
    switch's label as the page draws it, and the three Terminal codes."""
    from api.services import watchlist_alert_service as was
    footer = was.email_footer(A.SOURCE)
    assert footer != was.EMAIL_FOOTER_DEFAULT and "chart toolbar" not in footer
    model = (REPO / "app" / "src" / "pages" / "terminal" / "panels" / "listAlertModel.js").read_text(encoding="utf-8")
    m = re.search(r"export const LIST_ALERT_LABEL = '([^']+)'", model)
    assert m, "LIST_ALERT_LABEL is no longer a plain string in listAlertModel.js"
    assert m.group(1) in footer
    for kind in A.KINDS:
        assert A.KIND_INFO[kind]["code"] in footer
    panel = (REPO / "app" / "src" / "components" / "settings" / "ListAlertsPanel.jsx").read_text(encoding="utf-8")
    assert "List alerts" in panel and "List alerts" in footer


# ───────────────────────── the three list readers ─────────────────────────

def test_the_highs_reader_reads_the_stored_row_the_panel_shows(monkeypatch):
    from api.services import breadth_monitor as bm
    row = {"universe_count": 2900, "stage2_count": 800, "new_52w_highs": 3,
           "new_52w_highs_list": [{"t": "aaa", "c": 50, "pct": 2.5, "vr": 1.4, "n": "Aaa Corp"},
                                  {"t": "BBB", "c": "20.25"}, {"t": "AAA", "c": 1}, {"n": "no ticker"}, "junk"],
           "new_52w_lows_list": [{"t": "LOW", "c": 4}]}
    monkeypatch.setattr(bm, "raw_row", lambda d: row if d == TUE else None)
    assert A.load_highs52(TUE) == {"state": "ok", "context": {}, "rows": [
        {"key": "AAA", "sym": "AAA", "close": 50.0, "pct": 2.5},
        {"key": "BBB", "sym": "BBB", "close": 20.25, "pct": None}]}
    assert A.load_highs52(WED) == {"state": "not_stored"}, "no row for the session yet"
    row.pop("new_52w_highs_list")
    assert A.load_highs52(TUE) == {"state": "no_list"}
    row.update(new_52w_highs_list=[], stage2_count=1, new_52w_highs=0)
    assert A.load_highs52(TUE) == {"state": "degraded"}, "a failed price pull is not a quiet day"
    row.update(stage2_count=800)
    assert A.load_highs52(TUE) == {"state": "ok", "rows": [], "context": {}}, "a quiet day is a list"


def test_the_confluence_reader_reads_the_cached_board_and_never_starts_a_build(monkeypatch):
    from api import confluence_screen as cs

    def no_build(*a, **k):
        raise AssertionError("the alert job started a confluence build")
    monkeypatch.setattr(cs, "_build_background", no_build)
    monkeypatch.setattr(cs, "_compute_and_cache", no_build)
    monkeypatch.setattr(cs, "_CACHES", {})
    assert A.load_confluence(TUE) == {"state": "not_built"}
    board = {"ok": True, "days": 30, "rows": [
        {"sym": "aaa", "dir": "BULL", "status": "BUILDING", "dpn": 182_000_000, "net": 12_400_000},
        {"sym": "BBB", "dir": "BEAR", "status": "STEADY", "dpn": 30_000_000, "net": -5_300_000},
        {"sym": "AAA"}, {"dir": "BULL"}]}
    cs._CACHES[cs.DAYS] = {"at": 1000.0, "board": board}
    assert A.load_confluence(TUE, now_ts=1000.0 + 60) == {"state": "ok", "context": {"days": 30}, "rows": [
        {"key": "AAA", "sym": "AAA", "dir": "BULL", "status": "BUILDING", "dark_pool": 182_000_000.0, "net": 12_400_000.0},
        {"key": "BBB", "sym": "BBB", "dir": "BEAR", "status": "STEADY", "dark_pool": 30_000_000.0, "net": -5_300_000.0}]}
    assert A.load_confluence(TUE, now_ts=1000.0 + A.CONFLUENCE_MAX_AGE_S + 1) == {"state": "stale"}
    cs._CACHES[cs.DAYS] = {"at": 1000.0, "board": {"ok": False, "status": "warming", "rows": []}}
    assert A.load_confluence(TUE, now_ts=1001.0) == {"state": "not_built"}


def test_the_confluence_reader_looks_where_the_board_is_really_kept(monkeypatch):
    """ONE FACT IN TWO FILES: the reader looks at `confluence_screen`'s own cache entry, so
    the real writer fills it here and the reader must find it."""
    from api import confluence_screen as cs
    monkeypatch.setattr(cs, "_CACHES", {})
    monkeypatch.setattr(cs, "compute_board", lambda days: {"ok": True, "days": days, "rows": [{"sym": "AAA"}]})
    cs._compute_and_cache(cs.DAYS)
    got = A.load_confluence(TUE)
    assert got["state"] == "ok" and [r["sym"] for r in got["rows"]] == ["AAA"]


def test_the_contracts_reader_asks_for_the_one_warmed_key_and_only_tonights_day(monkeypatch):
    asked = []
    body = {"query_date": "11/17/2026", "min_hits": 3, "contracts": [
        {"ticker": "aaa", "cp": "C", "strike": 150.0, "exp": "12/18/2026", "qualifying_hits": 5,
         "total_premium": 2_400_000, "direction": "Bull"},
        {"ticker": "AAA", "cp": "C", "strike": 150, "exp": "12/18/2026"},      # the same contract again
        {"ticker": "BBB", "cp": "put", "strike": "152.5", "exp": "2026-11-20", "direction": "Bear"},
        {"ticker": "CCC", "cp": "C", "strike": None, "exp": "12/18/2026"}, {"cp": "C"}, None]}

    def worker(path):
        asked.append(path)
        return body
    monkeypatch.setattr(A, "_worker_json", worker)
    got = A.load_repeat_contracts(TUE)
    assert asked == ["/api/live/massive/by-contract?stock_etf=all&min_hits=3&lookback_days=1"]
    model = (REPO / "app" / "src" / "pages" / "terminal" / "panels" / "repeatContractsModel.js").read_text(encoding="utf-8")
    assert "by-contract?stock_etf=all&min_hits=${REPEAT_MIN_HITS}&lookback_days=1" in model, (
        "the ACCUM panel no longer reads this key: the alert must read the key the panel shows")
    assert "REPEAT_MIN_HITS = 3" in model and A.REPEAT_MIN_HITS == 3
    assert got == {"state": "ok", "context": {"min_hits": 3}, "rows": [
        {"key": "AAA|C|150|2026-12-18", "sym": "AAA", "cp": "C", "strike": 150.0, "expiry": "2026-12-18",
         "hits": 5.0, "premium": 2_400_000.0, "direction": "Bull"},
        {"key": "BBB|P|152.5|2026-11-20", "sym": "BBB", "cp": "P", "strike": 152.5, "expiry": "2026-11-20",
         "hits": None, "premium": None, "direction": "Bear"}]}
    assert A.load_repeat_contracts(WED) == {"state": "other_day"}, "yesterday's tape is not tonight's list"
    body["contracts"] = "nope"
    assert A.load_repeat_contracts(TUE) == {"state": "unreadable"}
    monkeypatch.setattr(A, "_worker_json", lambda path: None)
    assert A.load_repeat_contracts(TUE) == {"state": "no_worker"}


def test_the_worker_read_uses_the_private_address_and_the_server_credential(monkeypatch):
    import httpx
    from api import confluence_screen as cs
    calls = []

    class Reply:
        def raise_for_status(self):
            return None

        def json(self):
            return {"ok": 1}

    def get(url, headers=None, timeout=None):
        calls.append((url, headers))
        return Reply()
    monkeypatch.setattr(httpx, "get", get)
    monkeypatch.setattr(cs, "WORKER_INTERNAL_URL", "")
    assert REAL_WORKER_JSON("/x") is None and calls == [], "no worker configured: nothing is called"
    monkeypatch.setattr(cs, "WORKER_INTERNAL_URL", "http://worker.internal:8080")
    monkeypatch.setattr(cs, "_PUSH_SECRET", "s3cret")
    assert REAL_WORKER_JSON("/api/x?y=1") == {"ok": 1}
    assert calls == [("http://worker.internal:8080/api/x?y=1", {"Authorization": "Bearer s3cret"})]


# ───────────────────────── the routes ─────────────────────────

def _client(user=PAID):
    from api.routers import list_alerts as router_mod
    app = FastAPI()
    app.include_router(router_mod.router)
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: dict(user)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app)


def _all(client):
    return [client.get("/api/alerts/lists").status_code,
            client.put(f"/api/alerts/lists/{H}", json={"on": True}).status_code]


@pytest.fixture
def no_names(monkeypatch):
    from api.services import member_interest as mi
    monkeypatch.setattr(mi, "own_list_symbols_by_user", lambda ids: {"u1": {"AAA", "BBB"}})


def test_the_routes_are_dark_by_default(armed, monkeypatch, tmp_path, no_names):
    path = tmp_path / "never.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    A._done.clear()
    monkeypatch.delenv(A.FLAG)
    assert _all(_client()) == [404, 404]
    # dark to everyone: a caller who is not signed in, or not paid, is not told the routes exist
    assert _all(_client(None)) == [404, 404]
    assert _all(_client(FREE)) == [404, 404]
    assert not path.exists(), "a dark route opened a database"


def test_the_routes_are_paid(armed, no_names):
    assert _all(_client(None)) == [401, 401]
    assert _all(_client(FREE)) == [402, 402]
    assert A.switches("free1") == set()


def test_under_the_owner_s_preview_the_routes_exist_for_admins_only(armed, monkeypatch, no_names):
    monkeypatch.setenv(A.FLAG, "admin")
    assert _all(_client()) == [404, 404]
    assert _all(_client(ADMIN)) == [200, 200]
    assert A.switches("u1") == set() and A.switches("boss") == {H}


def test_read_and_switch_through_the_routes(armed, no_names):
    c = _client()
    off = {"available": True, "follows": 2, "rearm_sessions": 5, "max_named": 12,
           "checks_et": ["18:10", "21:50"],
           "kinds": [{"kind": H, "on": False, "code": "H52", "command": "H52 HIGHS", "name": "New 52-week highs"},
                     {"kind": C, "on": False, "code": "CONFL", "command": "CONFL", "name": "Confluence board"},
                     {"kind": R, "on": False, "code": "ACCUM", "command": "ACCUM",
                      "name": "Repeat-hit option contracts"}]}
    assert c.get("/api/alerts/lists").json() == off, "every switch starts OFF"
    on = c.put(f"/api/alerts/lists/{C}", json={"on": True}).json()
    assert [k["on"] for k in on["kinds"]] == [False, True, False] and {**on, "kinds": off["kinds"]} == off
    assert c.put(f"/api/alerts/lists/{C}", json={"on": True}).status_code == 200, "on twice is on"
    assert c.get("/api/alerts/lists").json() == on, "the write's answer is what a read answers"
    # another member sees only their own
    assert [k["on"] for k in _client({**PAID, "id": "u2"}).get("/api/alerts/lists").json()["kinds"]] == [False] * 3
    back = c.put(f"/api/alerts/lists/{C}", json={"on": False}).json()
    assert [k["on"] for k in back["kinds"]] == [False] * 3
    assert c.put(f"/api/alerts/lists/{C}", json={"on": False}).status_code == 200, "off twice is off"


@pytest.mark.parametrize("bad", ["lows52", "H52", "confluence;drop", "nope"])
def test_an_unknown_list_is_a_404(armed, no_names, bad):
    r = _client().put(f"/api/alerts/lists/{bad}", json={"on": True})
    assert r.status_code == 404 and r.json()["detail"] == "No such list"
    assert A.switches("u1") == set()


@pytest.mark.parametrize("body", [{}, {"on": "maybe"}, {"on": None}, {"enabled": True}])
def test_a_write_without_a_clear_on_or_off_changes_nothing(armed, no_names, body):
    assert _client().put(f"/api/alerts/lists/{H}", json=body).status_code == 422
    assert A.switches("u1") == set()


def test_a_follow_count_that_cannot_be_read_never_costs_the_switches(armed, monkeypatch):
    from api.services import member_interest as mi

    def boom(ids):
        raise sqlite3.OperationalError("locked")
    monkeypatch.setattr(mi, "own_list_symbols_by_user", boom)
    body = _client().put(f"/api/alerts/lists/{H}", json={"on": True}).json()
    assert body["follows"] is None and body["kinds"][0]["on"] is True


def test_the_schedule_the_route_reports_is_the_schedule_main_registers():
    assert A.state.__doc__ and [f"{h:02d}:{m:02d}" for h, m in A.CHECK_TIMES_ET] == ["18:10", "21:50"]
    assert all(h >= 17 for h, _m in A.CHECK_TIMES_ET), "a check before the close would read nothing"


# ───────────────────────── account deletion ─────────────────────────

def test_every_table_with_a_member_id_is_in_the_account_purge():
    from api.services import alert_erasure
    member_tables = {m.group(1) for m in re.finditer(r"CREATE TABLE IF NOT EXISTS (\w+) \(\s+user_id", A._SCHEMA)}
    assert member_tables == {"list_alert_subs", "list_alert_messages", "list_alerts_told"}
    assert member_tables <= set(alert_erasure.SCREENER_TABLES)


# ───────────────────────── the wiring in api/main.py ─────────────────────────

def _registrar():
    """`register_list_alert_jobs`, compiled from api/main.py's own source (importing
    api.main builds the whole app)."""
    src = (REPO / "api" / "main.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    (fn,) = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "register_list_alert_jobs"]
    ns = {"logging": logging, "_ET": ET}
    exec(compile(ast.Module(body=[fn], type_ignores=[]), "api/main.py", "exec"), ns)   # noqa: S102
    return ns["register_list_alert_jobs"], src


class Scheduler:
    def __init__(self):
        self.jobs = []

    def add_job(self, fn, trigger=None, **kw):
        self.jobs.append((fn, trigger, kw))


def test_main_registers_the_two_evening_checks_and_they_are_single_instance(monkeypatch):
    register, src = _registrar()
    sched = Scheduler()
    assert register(sched) is True
    assert [kw["id"] for _f, _t, kw in sched.jobs] == ["list_alerts_1810", "list_alerts_2150"]
    for _fn, trigger, kw in sched.jobs:
        assert kw["max_instances"] == 1 and kw["coalesce"] is True and kw["replace_existing"] is True
        fields = {f.name: str(f) for f in trigger.fields}
        assert fields["day_of_week"] == "mon-fri" and str(trigger.timezone) == "America/New_York"
    assert [(str(t.fields[5]), str(t.fields[6])) for _f, t, _k in sched.jobs] == [("18", "10"), ("21", "50")]
    # the lifespan calls it, and the router is mounted
    assert src.count("register_list_alert_jobs(_scheduler)") == 1
    assert "app.include_router(list_alerts_router.router)" in src


def test_the_scheduled_job_does_nothing_with_the_setting_off_and_runs_with_it_on(monkeypatch):
    register, _src = _registrar()
    sched = Scheduler()
    register(sched)
    job = sched.jobs[0][0]
    ran = []
    monkeypatch.setattr(A, "run_evening", lambda *a, **k: ran.append(1))
    monkeypatch.delenv(A.FLAG, raising=False)
    job()
    assert ran == []
    monkeypatch.setenv(A.FLAG, "1")
    job()
    assert ran == [1]

    def boom(*a, **k):
        raise RuntimeError("anything")
    monkeypatch.setattr(A, "run_evening", boom)
    job()                                                       # never raises into the scheduler


def test_a_run_never_raises(armed, monkeypatch):
    monkeypatch.setattr(A, "_session_for", lambda now: (_ for _ in ()).throw(RuntimeError("calendar")))
    out = armed(TUE)
    assert out["errors"] == 1 and out["reason"].startswith("RuntimeError") and armed.sent == []
