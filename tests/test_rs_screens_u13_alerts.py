"""RS screens unit U13: the daily "what joined and what left" message for the five RS screens.

A member turns the message on for a screen; after the nightly rating run they get ONE
message per screen for that session, in-app and on the channels their alert settings
allow. Module: ``api/services/screener/rs_screen_alerts.py``.

What this file holds:
  * the subscription routes (dark by default, paid, only the five ids, idempotent) and
    the ``rs_alerts`` key of the saved-screens payload;
  * the change read from `membership`'s own record (joined, left, both, none, no earlier
    session, a record that is not of the rated session, the 60% rule, the 12-name cap);
  * exactly one message per member per screen per session across a re-run, the catch-up
    and a weekend's second build;
  * nothing sent with the flag off, or with the screens off for that member;
  * the words, table-driven, and that none of them is advice;
  * the chain in ``api/main.py``.

⛔ NO REAL DELIVERY. Every run here is handed a recording ``deliver``; an autouse fixture
makes the real `deliver_alert_payload` and `send_email` fail the test if anything
reaches them. The one test of the default wiring replaces `deliver_alert_payload` itself.

A "night" is the real ``membership.record_all`` over the real starters, with the scan
(``_tickers_now``) and the build's identity scripted: so the spec the alert reads is
proved to be the spec the nightly records, never assumed.
"""
from __future__ import annotations

import base64
import json
import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.services.screener import membership as M
from api.services.screener import rs_market_state, rs_post_pass, rs_screens
from api.services.screener import rs_screen_alerts as A
from api.services.screener import snapshot_db as db

TOP, HIGHS, BEFORE, LEADERS, EXITS = (
    "starter_rs_top_rating", "starter_rs_new_high", "starter_rs_nh_before_price",
    "starter_rs_leaders", "starter_rs_exit_warning_5")
FIVE = (TOP, HIGHS, BEFORE, LEADERS, EXITS)
THU, FRI, MON = "2026-11-12", "2026-11-13", "2026-11-16"
PAID = {"id": "u1", "role": "member", "plan": "pro"}
CAUTION_TEXT = "Leadership reverses hardest in rebounds after bear markets. Treat these lists as watchlists."
#: Words the contract bans from member-facing copy (CONTRACT-SCREENS.md section 3).
BANNED = re.compile(r"\b(buy|buys|buying|buyable|sell|sells|selling|lens|gate|red day|ADR|RSI)\b", re.I)


# ───────────────────────── fixtures ─────────────────────────

@pytest.fixture(autouse=True)
def no_real_delivery(monkeypatch):
    """Nothing in this file may reach a member, a mailbox or a webhook."""
    from api.services import email_service, watchlist_alert_service as was

    def refuse(*a, **k):
        raise AssertionError("a test reached the real delivery")
    monkeypatch.setattr(was, "deliver_alert_payload", refuse)
    monkeypatch.setattr(was, "send_email", refuse)
    monkeypatch.setattr(email_service, "send_email", refuse, raising=False)


class Market:
    """What each screen's scan answers tonight (anything not named is empty)."""

    def __init__(self):
        self.lists = {}

    def tickers_now(self, spec, limit):
        t = self.lists.get(M.spec_hash(spec), [])
        return list(t)[:limit], len(t)


@pytest.fixture
def armed(tmp_path, monkeypatch):
    """Both flags on, the RS starters served, the nightly record on, an empty screener.db."""
    from api.services.signature import registry_defs
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")
    monkeypatch.setenv(A.FLAG, "1")
    monkeypatch.setenv(M.FLAG, "1")
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", True)
    monkeypatch.setattr(A, "_member", lambda uid: {"id": uid, "role": "member"})
    monkeypatch.setattr(rs_market_state, "served", lambda: None)
    A._done.clear()
    M._CURRENT.clear()
    db.init_db()
    market = Market()
    monkeypatch.setattr(M, "_tickers_now", market.tickers_now)

    def night(build, session, **lists):
        """One nightly record: `build` is the build's date, `session` the session it
        describes, `lists` the tickers of each named screen (LEADERS=[...])."""
        for sid, tickers in lists.items():
            market.lists[M.spec_hash(A.screens()[sid]["spec"])] = list(tickers)
        monkeypatch.setattr(M, "_build_identity", lambda: (build, session))
        out = M.record_all()
        assert out["errors"] == 0, out
        return out
    return night


class Sent(list):
    """A recording `deliver`: every call's keyword arguments, in order."""

    def __call__(self, **kw):
        self.append(kw)
        return {"claimed": True, "channels": {"in_app": "ok"}, "channels_ok": 1,
                "channels_failed": 0, "errors": {}}


def run(sent, session=FRI, **kw):
    kw.setdefault("routing", lambda uid: None)
    return A.run_nightly(session=session, deliver=sent, **kw)


def fired():
    with db.connect() as conn:
        return [tuple(r) for r in conn.execute(
            "SELECT user_id, starter_id, session, kind, n_joined, n_left "
            "FROM rs_screen_alerts_fired ORDER BY user_id, starter_id, session")]


def names(n, prefix="T"):
    return [f"{prefix}{i:03d}" for i in range(n)]


# ───────────────────────── the five, and the record they are read from ─────────────────────────

def test_the_five_are_the_served_rs_screens_in_the_pickers_order(armed):
    assert tuple(A.screens()) == FIVE == tuple(s["id"] for s in rs_screens.screens())
    assert [s["name"] for s in A.screens().values()] == [
        "Top RS Rating", "RS New Highs", "RS New High Before Price", "UCT RS Leaders",
        "RS exit warnings"]
    assert not any(s.get("hidden") for s in A.screens().values())


def test_the_spec_the_alert_reads_is_the_spec_the_nightly_records(armed):
    """No hand-built record anywhere in this file: `membership.record_all` files each
    starter under its own spec, and the alert finds every one of the five there."""
    armed("2026-11-13", THU, **{LEADERS: ["AAA"]})
    for sid, starter in A.screens().items():
        got = M.recorded_change(starter["spec"])
        assert got["state"] == "no_history" and got["session"] == THU, (sid, got)
    assert M.recorded_change({"filters": [{"key": "price", "op": "gte", "min": 987}]}) == {"state": "unsaved"}


def test_with_the_screens_off_there_are_no_five(armed, monkeypatch):
    """Off, three of the five ids belong to the earlier single-rule starters."""
    monkeypatch.delenv("RS_SCREENS_ENABLED")
    assert A.screens() == {}
    assert A.available(PAID) is False


# ───────────────────────── membership.recorded_change ─────────────────────────

SPEC = {"filters": [{"key": "price", "op": "gte", "min": 10}]}


def _record(monkeypatch, build, session, tickers):
    monkeypatch.setattr(M, "_tickers_now", lambda spec, limit: (list(tickers)[:limit], len(tickers)))
    return M.record(SPEC, snapshot_date=build, session_date=session)


def test_recorded_change_reads_the_two_newest_sessions_of_the_stored_record(armed, monkeypatch):
    _record(monkeypatch, "2026-11-13", THU, ["AAA", "BBB", "CCC"])
    assert M.recorded_change(SPEC)["state"] == "no_history"
    _record(monkeypatch, "2026-11-14", FRI, ["BBB", "CCC", "DDD", "EEE"])
    # the scan answers something else NOW: the stored record is what is read
    monkeypatch.setattr(M, "_tickers_now", lambda spec, limit: (["ZZZ"], 1))
    got = M.recorded_change(SPEC)
    assert got["state"] == "ok"
    assert (got["session"], got["prev_session"], got["as_of"]) == (FRI, THU, "2026-11-14")
    assert got["entered"] == ["DDD", "EEE"] and got["exited"] == ["AAA"]
    assert (got["n"], got["prev_n"]) == (4, 3)
    assert got["recorded_at"] > 0


def test_recorded_change_compares_sessions_never_two_builds_of_one_session(armed, monkeypatch):
    """A weekend makes a second build over Friday's session. Compared build to build it
    would report the two as a change (`membership.py`, 2026-10-18)."""
    _record(monkeypatch, "2026-11-13", THU, ["AAA", "BBB"])
    _record(monkeypatch, "2026-11-14", FRI, ["BBB", "CCC"])
    _record(monkeypatch, "2026-11-15", FRI, ["BBB", "CCC"])       # Sunday's build, Friday's session
    got = M.recorded_change(SPEC)
    assert (got["as_of"], got["session"], got["prev_session"]) == ("2026-11-15", FRI, THU)
    assert got["entered"] == ["CCC"] and got["exited"] == ["AAA"]


def test_recorded_change_says_why_it_cannot_compare(armed, monkeypatch):
    assert M.recorded_change({"filters": [{"key": "rvol_live", "op": "gte", "min": 2}]}) == {"state": "live_screen"}
    assert M.recorded_change({"filters": [{"key": "list", "op": "eq", "value": "w1"}]}) == {"state": "unsaved"}
    monkeypatch.setattr(M, "TOO_WIDE", 1)
    _record(monkeypatch, "2026-11-13", THU, ["AAA", "BBB"])
    _record(monkeypatch, "2026-11-14", FRI, ["AAA", "BBB"])
    assert M.recorded_change(SPEC)["state"] == "too_wide"


def test_recorded_change_creates_no_table(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "fresh.db"))
    db.init_db()
    assert M.recorded_change(SPEC) == {"state": "unsaved"}
    with db.connect() as conn:
        assert conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'screen_membership'").fetchone() is None


# ───────────────────────── the change, sent ─────────────────────────

def test_joined_and_left_are_sent_as_one_message_for_the_screen(armed):
    A.subscribe("u1", LEADERS)
    armed("2026-11-13", THU, **{LEADERS: ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"]})
    armed("2026-11-14", FRI, **{LEADERS: ["BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH"]})
    sent = Sent()
    r = run(sent)
    assert (r["sent"], r["subscriptions"], r["members"], r["session"]) == (1, 1, 1, FRI)
    assert len(sent) == 1
    msg = sent[0]
    assert msg["user_id"] == "u1" and msg["source"] == "rs_screen_alert" and msg["severity"] == "info"
    assert msg["title"] == "UCT RS Leaders: 2 joined, 1 left"
    assert msg["message"] == ("UCT RS Leaders, at its standard settings: 2 joined (GGG, HHH), "
                              "1 left (AAA). Ratings as of Nov 13, compared with Nov 12.")
    assert msg["extra_data"]["joined"] == ["GGG", "HHH"] and msg["extra_data"]["left"] == ["AAA"]
    assert msg["extra_data"]["starter_id"] == LEADERS and msg["extra_data"]["session"] == FRI
    assert "channels_allowed" not in msg, "no routing rule: every channel the delivery already uses"
    assert fired() == [("u1", LEADERS, FRI, "message", 2, 1)]


@pytest.mark.parametrize("before,after,title", [
    (["AAA", "BBB", "CCC"], ["AAA", "BBB", "CCC", "DDD"], "UCT RS Leaders: 1 joined"),
    (["AAA", "BBB", "CCC"], ["AAA", "BBB"], "UCT RS Leaders: 1 left"),
])
def test_one_sided_changes_say_only_their_side(armed, before, after, title):
    A.subscribe("u1", LEADERS)
    armed("2026-11-13", THU, **{LEADERS: before})
    armed("2026-11-14", FRI, **{LEADERS: after})
    sent = Sent()
    run(sent)
    assert [m["title"] for m in sent] == [title]


def test_nothing_changed_is_silence_and_records_nothing(armed):
    A.subscribe("u1", LEADERS)
    armed("2026-11-13", THU, **{LEADERS: ["AAA", "BBB"]})
    armed("2026-11-14", FRI, **{LEADERS: ["BBB", "AAA"]})
    sent = Sent()
    r = run(sent)
    assert sent == [] and r["quiet"] == 1 and r["sent"] == 0 and fired() == []


def test_the_first_recorded_session_says_nothing(armed):
    """With no earlier session there is nothing to compare: not fifty "joined"."""
    A.subscribe("u1", LEADERS)
    armed("2026-11-14", FRI, **{LEADERS: names(50)})
    sent = Sent()
    r = run(sent)
    assert sent == [] and r["no_previous"] == 1 and fired() == []


def test_a_record_that_is_not_of_the_rated_session_is_not_described(armed):
    """The nightly refused to record tonight's short build: the newest record is still
    Thursday's, and Friday's ratings are not described from it."""
    A.subscribe("u1", LEADERS)
    armed("2026-11-12", "2026-11-11", **{LEADERS: ["AAA"]})
    armed("2026-11-13", THU, **{LEADERS: ["AAA", "BBB"]})
    sent = Sent()
    r = run(sent, session=FRI)
    assert sent == [] and r["not_recorded"] == 1 and fired() == []
    # and the same record IS described when its own session is the one asked about
    assert run(sent, session=THU)["sent"] == 1


def test_a_record_taken_before_the_pass_moved_the_ratings_is_not_described(armed):
    """The 03:00 record was taken on the previous session's ratings. Until membership
    is recorded again after the pass, it is not the list the ratings describe."""
    A.subscribe("u1", LEADERS)
    armed("2026-11-13", THU, **{LEADERS: ["AAA"]})
    armed("2026-11-14", FRI, **{LEADERS: ["AAA", "BBB"]})
    with db.connect() as conn:
        at = conn.execute("SELECT MAX(recorded_at) FROM screen_membership").fetchone()[0]
    sent = Sent()
    r = run(sent, recorded_after=at + 60)
    assert sent == [] and r["not_recorded"] == 1 and fired() == []
    assert run(sent, recorded_after=at - 60)["sent"] == 1


def test_a_list_too_wide_to_store_is_not_described(armed, monkeypatch):
    monkeypatch.setattr(M, "TOO_WIDE", 3)
    A.subscribe("u1", TOP)
    armed("2026-11-13", THU, **{TOP: names(5)})
    armed("2026-11-14", FRI, **{TOP: names(6)})
    sent = Sent()
    r = run(sent)
    assert sent == [] and r["too_wide"] == 1


def test_each_screen_is_its_own_message_in_the_pickers_order(armed):
    for sid in (EXITS, LEADERS, HIGHS):
        A.subscribe("u1", sid)
    armed("2026-11-13", THU, **{LEADERS: names(10), HIGHS: names(10), EXITS: names(10)})
    armed("2026-11-14", FRI, **{LEADERS: names(10) + ["NEW"], HIGHS: names(10), EXITS: names(9)})
    sent = Sent()
    r = run(sent)
    assert [m["title"] for m in sent] == ["UCT RS Leaders: 1 joined", "RS exit warnings: 1 left"]
    assert (r["sent"], r["quiet"]) == (2, 1)


def test_the_twelve_name_cap_says_how_many_more(armed):
    A.subscribe("u1", LEADERS)
    stay = names(40, "S")
    armed("2026-11-13", THU, **{LEADERS: stay + names(13, "L")})
    armed("2026-11-14", FRI, **{LEADERS: stay + names(14, "J")})
    sent = Sent()
    run(sent)
    msg = sent[0]["message"]
    assert "14 joined (" + ", ".join(names(12, "J")) + ", +2 more)" in msg
    assert "13 left (" + ", ".join(names(12, "L")) + ", +1 more)" in msg
    assert "J012" not in msg and "L012" not in msg
    assert sent[0]["extra_data"]["joined"] == names(14, "J"), "the full list rides the alert's data"
    assert A.MAX_NAMED == 12


# ───────────────────────── the 60% rule ─────────────────────────

@pytest.mark.parametrize("joined,left,now,before,expected", [
    (30, 30, 50, 50, False),     # exactly 60% of each list: not MORE than 60%
    (31, 31, 50, 50, True),
    (31, 0, 50, 19, True),       # most of today's list is new
    (0, 31, 19, 50, True),       # most of the previous list is gone
    (3, 2, 50, 49, False),
    (0, 0, 50, 50, False),
    (12, 0, 12, 0, True),        # a list that was empty and is not
    (0, 14, 0, 14, True),        # a list that emptied
    (0, 0, 0, 0, False),
    (2, 0, 3, 1, False),         # a short list is always itemised, however much of it changed
    (2, 0, 2, 0, False),
    (0, 4, 0, 4, False),
    (7, 7, 9, 9, False),         # nine names on both days: still short
    (7, 0, 10, 3, True),         # ten today: the share rule applies
])
def test_too_much_is_more_than_sixty_percent_of_either_list(joined, left, now, before, expected):
    assert A.too_much(joined, left, now, before) is expected
    assert A.TOO_MUCH_SHARE == 0.60 and A.TOO_MUCH_MIN_NAMES == 10


def test_a_list_that_changed_too_much_gets_one_in_app_note_and_no_names(armed):
    A.subscribe("u1", LEADERS)
    armed("2026-11-13", THU, **{LEADERS: names(50, "OLD")})
    armed("2026-11-14", FRI, **{LEADERS: names(19, "OLD") + names(31, "NEW")})
    sent = Sent()
    r = run(sent)
    assert (r["noted"], r["sent"]) == (1, 0) and len(sent) == 1
    note = sent[0]
    assert note["title"] == "UCT RS Leaders: the list changed too much to itemise today"
    assert note["message"] == ("UCT RS Leaders, at its standard settings: the list changed too much "
                               "to itemise today. Open the screen to see it as it stands. "
                               "Ratings as of Nov 13.")
    assert "NEW" not in note["message"] and "OLD" not in note["message"]
    assert note["channels_allowed"] == frozenset(), "in-app only: no email, no push"
    assert "joined" not in note["extra_data"] and note["extra_data"]["too_much"] is True
    assert fired() == [("u1", LEADERS, FRI, "note", 0, 0)]
    # and it is said once
    assert run(sent)["skipped_dedup"] == 1 and len(sent) == 1


def test_several_lists_that_changed_too_much_are_one_note_not_one_each(armed):
    for sid in (LEADERS, HIGHS, EXITS):
        A.subscribe("u1", sid)
    armed("2026-11-13", THU, **{LEADERS: names(10, "A"), HIGHS: names(10, "B"), EXITS: names(10, "C")})
    armed("2026-11-14", FRI, **{LEADERS: names(10, "X"), HIGHS: names(10, "Y"),
                                EXITS: names(10, "C") + ["NEW"]})
    sent = Sent()
    r = run(sent)
    assert (r["noted"], r["sent"]) == (1, 1)
    notes = [m for m in sent if m["extra_data"].get("too_much")]
    assert len(notes) == 1
    assert notes[0]["title"] == "RS screens: lists changed too much to itemise today"
    assert notes[0]["message"] == ("RS New Highs and UCT RS Leaders, at their standard settings: the "
                                   "lists changed too much to itemise today. Open the screens to see "
                                   "them as they stand. Ratings as of Nov 13.")
    assert notes[0]["extra_data"]["starter_ids"] == [HIGHS, LEADERS]
    assert [k for _u, _s, _d, k, *_n in fired()] == ["message", "note", "note"]


# ───────────────────────── exactly once ─────────────────────────

def test_a_re_run_for_the_same_session_sends_nothing_more(armed):
    A.subscribe("u1", LEADERS)
    armed("2026-11-13", THU, **{LEADERS: ["AAA", "BBB"]})
    armed("2026-11-14", FRI, **{LEADERS: ["AAA", "CCC"]})
    sent = Sent()
    assert run(sent)["sent"] == 1
    for _ in range(3):
        r = run(sent)
        assert (r["sent"], r["skipped_dedup"]) == (0, 1)
    assert len(sent) == 1 and len(fired()) == 1


def test_the_catch_up_and_a_weekends_second_build_never_send_twice(armed):
    """The 04:40 lists job and every rating catch-up re-record and come through again;
    Sunday's build is a new record over Friday's session. One session, one message,
    even when the later record is not the same list."""
    A.subscribe("u1", LEADERS)
    stay = names(8, "S")
    armed("2026-11-13", THU, **{LEADERS: stay + ["BBB"]})
    armed("2026-11-14", FRI, **{LEADERS: stay + ["CCC"]})
    sent = Sent()
    assert run(sent)["sent"] == 1
    armed("2026-11-14", FRI, **{LEADERS: stay + ["CCC"]})          # the catch-up re-records
    assert run(sent)["skipped_dedup"] == 1
    armed("2026-11-15", FRI, **{LEADERS: stay + ["CCC", "DDD"]})   # Sunday's build, same session
    assert run(sent)["skipped_dedup"] == 1
    assert len(sent) == 1
    # the next session is a new message, against the newest record of the session before
    armed("2026-11-17", MON, **{LEADERS: stay + ["CCC", "EEE"]})
    assert run(sent, session=MON)["sent"] == 1
    assert [m["title"] for m in sent] == ["UCT RS Leaders: 1 joined, 1 left"] * 2
    assert sent[1]["message"] == ("UCT RS Leaders, at its standard settings: 1 joined (EEE), "
                                  "1 left (DDD). Ratings as of Nov 16, compared with Nov 13.")
    assert [(s, k) for _u, _sid, s, k, *_n in fired()] == [(FRI, "message"), (MON, "message")]


def test_the_claim_is_taken_by_exactly_one_caller(armed):
    """Two runs at once (the 04:15 chain finishing as the 04:40 job starts) both reach
    the claim; the row's primary key lets one through."""
    A._ensure()
    assert A._claim("u1", LEADERS, FRI, "message", 1, 0) is True
    assert A._claim("u1", LEADERS, FRI, "message", 1, 0) is False
    assert A._claim("u1", LEADERS, MON, "message") is True, "another session is another row"
    assert A._claim("u2", LEADERS, FRI, "message") is True, "another member is another row"
    assert A._claim("u1", HIGHS, FRI, "message") is True, "another screen is another row"


def test_the_claim_is_taken_before_anything_is_sent(armed):
    A.subscribe("u1", LEADERS)
    armed("2026-11-13", THU, **{LEADERS: ["AAA", "BBB"]})
    armed("2026-11-14", FRI, **{LEADERS: ["AAA", "CCC"]})
    seen = []

    def deliver(**kw):
        seen.append(fired())
        return None
    run(deliver)
    assert seen == [[("u1", LEADERS, FRI, "message", 1, 1)]]


def test_turning_it_off_and_on_again_the_same_day_does_not_repeat_the_message(armed):
    A.subscribe("u1", LEADERS)
    armed("2026-11-13", THU, **{LEADERS: ["AAA", "BBB"]})
    armed("2026-11-14", FRI, **{LEADERS: ["AAA", "CCC"]})
    sent = Sent()
    run(sent)
    A.unsubscribe("u1", LEADERS)
    assert run(sent)["subscriptions"] == 0
    A.subscribe("u1", LEADERS)
    assert run(sent)["skipped_dedup"] == 1 and len(sent) == 1


def test_a_delivery_that_reached_nobody_gives_the_claim_back(armed):
    A.subscribe("u1", LEADERS)
    armed("2026-11-13", THU, **{LEADERS: ["AAA", "BBB"]})
    armed("2026-11-14", FRI, **{LEADERS: ["AAA", "CCC"]})
    dead = {"claimed": True, "channels": {"in_app": "failed", "email": "failed"},
            "channels_ok": 0, "channels_failed": 2, "errors": {}}
    r = run(lambda **kw: dict(dead))
    assert (r["sent"], r["errors"]) == (0, 1) and fired() == []
    sent = Sent()
    assert run(sent)["sent"] == 1 and len(sent) == 1, "the catch-up run sends what the first could not"


def test_one_member_s_failed_delivery_never_costs_another_theirs(armed):
    for uid in ("u1", "u2", "u3"):
        A.subscribe(uid, LEADERS)
    armed("2026-11-13", THU, **{LEADERS: ["AAA", "BBB"]})
    armed("2026-11-14", FRI, **{LEADERS: ["AAA", "CCC"]})
    got = []

    def deliver(**kw):
        if kw["user_id"] == "u2":
            raise OSError("mailbox")
        got.append(kw["user_id"])
    r = run(deliver)
    assert got == ["u1", "u3"] and (r["sent"], r["errors"]) == (2, 1)
    assert [u for u, *_ in fired()] == ["u1", "u3"], "u2's claim was given back"


# ───────────────────────── dark, and off for one member ─────────────────────────

def test_flag_off_nothing_is_read_stored_or_sent(armed, monkeypatch, tmp_path):
    A.subscribe("u1", LEADERS)
    armed("2026-11-13", THU, **{LEADERS: ["AAA", "BBB"]})
    armed("2026-11-14", FRI, **{LEADERS: ["AAA", "CCC"]})
    monkeypatch.delenv(A.FLAG)

    def boom(*a, **k):
        raise AssertionError("a dark run did something")
    monkeypatch.setattr(M, "recorded_change", boom)
    monkeypatch.setattr(A, "_claim", boom)
    r = A.run_nightly(session=FRI, deliver=boom, routing=boom)
    assert r["enabled"] is False and r["reason"] == "disabled" and r["sent"] == 0
    assert fired() == []
    # and a dark run on a pod that never had the tables creates none
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "never.db"))
    A._done.clear()
    A.run_nightly(session=FRI, deliver=boom, routing=boom)
    assert not (tmp_path / "never.db").exists()
    assert A.payload(PAID) is None and A.available(PAID) is False


@pytest.mark.parametrize("value", ["0", "", "true", "yes", "admin", " 1", "on"])
def test_only_the_literal_1_arms_the_flag(monkeypatch, value):
    monkeypatch.setenv(A.FLAG, value)
    assert A.enabled() is False
    monkeypatch.setenv(A.FLAG, "1")
    assert A.enabled() is True
    monkeypatch.delenv(A.FLAG)
    assert A.enabled() is False


def test_the_screens_flag_off_nothing_is_sent_even_with_the_alert_flag_on(armed, monkeypatch):
    A.subscribe("u1", LEADERS)
    armed("2026-11-13", THU, **{LEADERS: ["AAA", "BBB"]})
    armed("2026-11-14", FRI, **{LEADERS: ["AAA", "CCC"]})
    monkeypatch.delenv("RS_SCREENS_ENABLED")
    sent = Sent()
    r = run(sent)
    assert sent == [] and r["reason"] == "screens_off" and fired() == []


def test_a_member_the_screens_are_off_for_is_sent_nothing(armed, monkeypatch):
    """`screens_on` is the one place that decides it (unit U10 swaps its one line)."""
    for uid in ("u1", "u2"):
        A.subscribe(uid, LEADERS)
    armed("2026-11-13", THU, **{LEADERS: ["AAA", "BBB"]})
    armed("2026-11-14", FRI, **{LEADERS: ["AAA", "CCC"]})
    monkeypatch.setattr(A, "screens_on", lambda user: bool(user) and user["id"] == "u2")
    sent = Sent()
    r = run(sent)
    assert [m["user_id"] for m in sent] == ["u2"]
    assert (r["sent"], r["screens_off"]) == (1, 1)
    assert fired() == [("u2", LEADERS, FRI, "message", 1, 1)], "nothing is recorded as said to u1"


def test_a_member_whose_account_cannot_be_read_is_sent_nothing(armed, monkeypatch):
    A.subscribe("gone", LEADERS)
    armed("2026-11-13", THU, **{LEADERS: ["AAA", "BBB"]})
    armed("2026-11-14", FRI, **{LEADERS: ["AAA", "CCC"]})
    monkeypatch.setattr(A, "_member", lambda uid: None)
    sent = Sent()
    assert run(sent)["screens_off"] == 1 and sent == []
    assert A.screens_on(None) is False and A.screens_on({}) is False
    assert A.screens_on({"id": "u1"}) is True


def test_a_subscription_to_a_screen_that_is_no_longer_one_of_the_five_is_never_sent(armed):
    A._ensure()
    with db.connect() as conn:
        conn.execute("INSERT INTO rs_screen_alert_subs VALUES ('u1', 'starter_rs_quicksand_5', 1)")
    sent = Sent()
    r = run(sent)
    assert r["subscriptions"] == 0 and sent == []
    assert A.subscribed("u1") == []


# ───────────────────────── the member's alert settings ─────────────────────────

class Rule:
    def __init__(self, suspended=False, channels=("email",)):
        self.suspended = suspended
        self._channels = frozenset(channels)

    def channels_allowed(self):
        return self._channels


def test_the_members_routing_rule_decides_the_channels(armed):
    A.subscribe("u1", LEADERS)
    armed("2026-11-13", THU, **{LEADERS: ["AAA", "BBB"]})
    armed("2026-11-14", FRI, **{LEADERS: ["AAA", "CCC"]})
    sent = Sent()
    run(sent, routing=lambda uid: Rule(channels=("push",)))
    assert sent[0]["channels_allowed"] == frozenset({"push"})


def test_a_member_who_paused_every_alert_is_sent_nothing_and_it_is_recorded(armed):
    for sid in (LEADERS, HIGHS):
        A.subscribe("u1", sid)
    armed("2026-11-13", THU, **{LEADERS: names(10), HIGHS: names(10, "A")})
    armed("2026-11-14", FRI, **{LEADERS: names(10) + ["NEW"], HIGHS: names(10, "Z")})
    sent = Sent()
    r = run(sent, routing=lambda uid: Rule(suspended=True))
    assert sent == [] and r["suspended_routing"] == 2
    assert [(s, k) for _u, s, _d, k, *_n in fired()] == [(LEADERS, "suspended"), (HIGHS, "suspended")]
    # resuming later the same day does not send the morning's message
    assert run(sent)["skipped_dedup"] == 2 and sent == []


def test_the_default_wiring_is_the_existing_delivery_and_the_existing_routing_rule(armed, monkeypatch):
    """Nothing injected: the run reaches `deliver_alert_payload` and `routing_rule.effective`
    (both replaced here, so still no real delivery)."""
    from api.services import watchlist_alert_service as was
    from api.services.alert_taxonomy import routing_rule
    A.subscribe("u1", LEADERS)
    armed("2026-11-13", THU, **{LEADERS: ["AAA", "BBB"]})
    armed("2026-11-14", FRI, **{LEADERS: ["AAA", "CCC"]})
    sent = Sent()
    asked = []
    monkeypatch.setattr(was, "deliver_alert_payload", sent)
    monkeypatch.setattr(routing_rule, "effective", lambda uid: asked.append(uid) or Rule())
    monkeypatch.setattr(rs_post_pass, "last_run", lambda: {"rewritten": True, "rating_session": FRI})
    r = A.run_nightly()
    assert r["sent"] == 1 and r["session"] == FRI and asked == ["u1"]
    assert sent[0]["channels_allowed"] == frozenset({"email"})
    # a pass that did not move the ratings names no session to describe
    monkeypatch.setattr(rs_post_pass, "last_run", lambda: {"rewritten": False, "rating_session": THU})
    assert A.run_nightly()["reason"] == "no_rated_session"


# ───────────────────────── the words ─────────────────────────

WORDS = [
    # name, joined, left, session, prev, caution -> title, message
    ("UCT RS Leaders", ["AAA", "BBB", "CCC"], ["DDD", "EEE"], FRI, THU, False,
     "UCT RS Leaders: 3 joined, 2 left",
     "UCT RS Leaders, at its standard settings: 3 joined (AAA, BBB, CCC), 2 left (DDD, EEE). "
     "Ratings as of Nov 13, compared with Nov 12."),
    ("RS New Highs", ["AAA"], [], FRI, THU, False,
     "RS New Highs: 1 joined",
     "RS New Highs, at its standard settings: 1 joined (AAA). Ratings as of Nov 13, compared with Nov 12."),
    ("RS exit warnings", [], ["AAA", "BBB"], MON, FRI, False,
     "RS exit warnings: 2 left",
     "RS exit warnings, at its standard settings: 2 left (AAA, BBB). Ratings as of Nov 16, compared with Nov 13."),
    ("Top RS Rating", ["AAA"], ["BBB"], "2026-12-01", None, False,
     "Top RS Rating: 1 joined, 1 left",
     "Top RS Rating, at its standard settings: 1 joined (AAA), 1 left (BBB). Ratings as of Dec 1."),
    ("UCT RS Leaders", ["AAA"], ["BBB"], FRI, THU, True,
     "UCT RS Leaders: 1 joined, 1 left",
     "UCT RS Leaders, at its standard settings: 1 joined (AAA), 1 left (BBB). "
     "Ratings as of Nov 13, compared with Nov 12. " + CAUTION_TEXT),
    ("RS New High Before Price", [], ["AAA"], FRI, THU, True,
     "RS New High Before Price: 1 left",
     "RS New High Before Price, at its standard settings: 1 left (AAA). "
     "Ratings as of Nov 13, compared with Nov 12. " + CAUTION_TEXT),
]


@pytest.mark.parametrize("name,joined,left,session,prev,caution,title,message", WORDS)
def test_the_message_words(name, joined, left, session, prev, caution, title, message):
    assert A.compose(name, joined, left, session, prev, caution=caution) == (title, message)


NOTES = [
    (["UCT RS Leaders"], "UCT RS Leaders: the list changed too much to itemise today",
     "UCT RS Leaders, at its standard settings: the list changed too much to itemise today. "
     "Open the screen to see it as it stands. Ratings as of Nov 13."),
    (["Top RS Rating", "RS New Highs", "UCT RS Leaders"],
     "RS screens: lists changed too much to itemise today",
     "Top RS Rating, RS New Highs and UCT RS Leaders, at their standard settings: the lists "
     "changed too much to itemise today. Open the screens to see them as they stand. "
     "Ratings as of Nov 13."),
]


@pytest.mark.parametrize("screen_names,title,message", NOTES)
def test_the_note_words(screen_names, title, message):
    assert A.compose_note(screen_names, FRI) == (title, message)


def test_no_word_is_advice_and_the_copy_rules_hold(armed):
    """Every sentence this module can say, for every one of the five screens: "joined"
    and "left" only, the standard-settings clause, the ratings date, no banned word, no
    dash standing in for punctuation."""
    itemised, said = [], []
    for starter in A.screens().values():
        for caution in (False, True):
            title, message = A.compose(starter["name"], ["AAA", "BBB"], ["CCC"], FRI, THU, caution=caution)
            itemised.append(message)
            said += [title, message]
        said += A.compose_note([starter["name"]], FRI)
    said += A.compose_note([s["name"] for s in A.screens().values()], FRI)
    assert len(said) == 32 and len(itemised) == 10
    for text in said:
        assert not BANNED.search(text), text
        assert "—" not in text and "–" not in text and " -- " not in text, text
        assert text == text.strip() and "  " not in text
    for text in itemised:
        assert "at its standard settings" in text and "Ratings as of Nov 13" in text
        assert "2 joined (AAA, BBB)" in text and "1 left (CCC)" in text


def test_in_a_caution_market_joins_are_still_listed_and_the_message_ends_with_the_caution_sentence(
        armed, monkeypatch):
    monkeypatch.setattr(rs_market_state, "served",
                        lambda: {"state": "caution", "text": "x", "asof": FRI})
    A.subscribe("u1", LEADERS)
    armed("2026-11-13", THU, **{LEADERS: ["AAA", "BBB"]})
    armed("2026-11-14", FRI, **{LEADERS: ["AAA", "BBB", "CCC"]})
    sent = Sent()
    run(sent)
    assert "1 joined (CCC)" in sent[0]["message"]
    assert sent[0]["message"].endswith(rs_market_state.TEXT["caution"])
    assert rs_market_state.TEXT["caution"] == CAUTION_TEXT


@pytest.mark.parametrize("market", [None, {"state": "pressure", "text": "x", "asof": FRI},
                                    {"state": "normal", "text": "", "asof": FRI}])
def test_any_other_market_state_adds_nothing(armed, monkeypatch, market):
    monkeypatch.setattr(rs_market_state, "served", lambda: market)
    A.subscribe("u1", LEADERS)
    armed("2026-11-13", THU, **{LEADERS: ["AAA", "BBB"]})
    armed("2026-11-14", FRI, **{LEADERS: ["AAA", "BBB", "CCC"]})
    sent = Sent()
    run(sent)
    assert sent[0]["message"].endswith("Ratings as of Nov 13, compared with Nov 12.")


# ───────────────────────── the link to the screen ─────────────────────────

def _decode(link):
    """What the page's `decodeSpec` reads from `?s=` (shell/specUrl.js)."""
    assert link.startswith("/screener?s=")
    raw = link.split("=", 1)[1]
    assert "=" not in raw and "+" not in raw and "/" not in raw, "base64url, unpadded"
    return json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))


#: The link of UCT RS Leaders, as the server builds it. The client's own decoder reads this
#: same string back in app/src/pages/screener/focus/__tests__/rsU13Alerts.test.jsx, so the
#: two halves are held to one form. It moves only when the Leaders starter's spec moves.
LEADERS_LINK = (
    "/screener?s=eyJmIjp7InByaWNlIjp7Im9wIjoiZ3RlIiwibWluIjoxMH0sImRvbGxhcl92b2xfMzBkIjp7Im9wIjoiZ3RlIiwi"
    "bWluIjoyMDAwMDAwMH0sImFkcl9wY3QiOnsib3AiOiJndGUiLCJtaW4iOjN9LCJtYXJrZXRfY2FwIjp7Im9wIjoiZ3RlIiwibWlu"
    "IjozMDAwMDAwMDB9LCJyc19yYW5rIjp7Im9wIjoiZ3RlIiwibWluIjo4MH0sInBjdF92c19zbWEyMDAiOnsib3AiOiJndCIsIm1p"
    "biI6MH0sInNtYTIwMF9yaXNpbmciOnsib3AiOiJlcSIsInZhbHVlIjoxfSwiZGlzdF81MndfaGlnaF9wY3QiOnsib3AiOiJndGUi"
    "LCJtaW4iOi0yNX0sInJzX2xpbmVfYWJvdmVfbWEiOnsib3AiOiJlcSIsInZhbHVlIjoxfSwicnNfZmxhZyI6eyJvcCI6Im5vdF9p"
    "biIsInZhbHVlcyI6WyJidXlvdXRfcGVuZGluZyJdfSwicnNfbGVhZGVyc19tZW1iZXIiOnsib3AiOiJlcSIsInZhbHVlIjoxfSwi"
    "c2VjdXJpdHlfdHlwZSI6eyJvcCI6Im5vdF9pbiIsInZhbHVlcyI6WyJFVEYiXX19LCJzb3J0Ijp7ImtleSI6InJzX3JhdGluZ19z"
    "Y29yZSIsImRpciI6ImRlc2MifSwidmlldyI6InJzX2xlYWRlcnMifQ")


def test_the_leaders_link_is_the_string_the_client_s_test_reads_back(armed):
    from pathlib import Path
    assert A.screen_link(A.screens()[LEADERS]) == LEADERS_LINK
    client_test = (Path(__file__).resolve().parents[1] / "app" / "src" / "pages" / "screener" / "focus"
                   / "__tests__" / "rsU13Alerts.test.jsx").read_text(encoding="utf-8")
    assert f"'{LEADERS_LINK.split('=', 1)[1]}'" in client_test, "the two tests no longer hold one string"


def test_the_message_links_to_the_screen_at_its_standard_settings(armed):
    """The bell opens `data.research_url`. The link carries the screen's own spec in the
    page's URL form, and the page names a spec that equals a starter's as that starter."""
    for sid, starter in A.screens().items():
        got = _decode(A.screen_link(starter))
        spec = starter["spec"]
        assert [{"key": k, **v} for k, v in got["f"].items()] == spec["filters"], sid
        assert got.get("sort") == spec.get("sort") and got.get("rank") == spec.get("rank"), sid
        assert got["view"] == spec["view"]
    A.subscribe("u1", LEADERS)
    armed("2026-11-13", THU, **{LEADERS: ["AAA", "BBB"]})
    armed("2026-11-14", FRI, **{LEADERS: ["AAA", "CCC"]})
    sent = Sent()
    run(sent)
    assert sent[0]["extra_data"]["research_url"] == A.screen_link(A.screens()[LEADERS])
    assert sent[0]["sym"] == "MARKET", "no single stock: the delivery adds no /research link of its own"


def test_a_spec_the_url_form_cannot_carry_gets_the_bare_page_never_another_screen():
    two = {"spec": {"filters": [{"key": "price", "op": "gte", "min": 10},
                                {"key": "price", "op": "lt", "max": 50}]}}
    assert A.screen_link(two) == "/screener"
    assert A.screen_link({}) == "/screener" and A.screen_link({"spec": {"filters": []}}) == "/screener"


# ───────────────────────── subscriptions ─────────────────────────

def test_subscribing_twice_is_one_subscription_and_members_are_separate(armed):
    assert A.subscribe("u1", LEADERS) == {"starter_id": LEADERS, "subscribed": True}
    assert A.subscribe("u1", LEADERS) == {"starter_id": LEADERS, "subscribed": True}
    A.subscribe("u1", TOP)
    A.subscribe("u2", EXITS)
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM rs_screen_alert_subs").fetchone()[0] == 3
    assert A.subscribed("u1") == [TOP, LEADERS], "the picker's order"
    assert A.subscribed("u2") == [EXITS] and A.subscribed("u3") == []
    assert A.unsubscribe("u1", LEADERS) == {"starter_id": LEADERS, "subscribed": False}
    assert A.unsubscribe("u1", LEADERS) == {"starter_id": LEADERS, "subscribed": False}
    assert A.subscribed("u1") == [TOP] and A.subscribed("u2") == [EXITS]


@pytest.mark.parametrize("bad", ["starter_rs_quicksand_5", "starter_momentum_leaders",
                                 "starter_earnings_momentum", "nope", "", None])
def test_only_the_five_can_be_subscribed(armed, bad):
    """A retired (hidden) RS list, another group's starter, an unknown id: none."""
    with pytest.raises(A.UnknownScreen):
        A.subscribe("u1", bad)
    with pytest.raises(A.UnknownScreen):
        A.unsubscribe("u1", bad)


def test_a_subscription_needs_a_member(armed):
    for nobody in ("", None, "  "):
        with pytest.raises(ValueError):
            A.subscribe(nobody, LEADERS)


# ───────────────────────── the routes ─────────────────────────

def _client(user=PAID):
    from api.routers import screen_promote as rp
    app = FastAPI()
    app.include_router(rp.router)
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: dict(user)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app)


ROUTES = [("get", "/api/screener/rs-alerts"), ("post", f"/api/screener/rs-alerts/{LEADERS}"),
          ("delete", f"/api/screener/rs-alerts/{LEADERS}")]


def _all(client):
    return [getattr(client, m)(p).status_code for m, p in ROUTES]


def test_the_routes_are_dark_by_default(armed, monkeypatch):
    monkeypatch.delenv(A.FLAG)
    assert _all(_client()) == [404, 404, 404]
    # dark to everyone: a caller who is not signed in, or not paid, is not told the routes
    # exist (the flag is asked before the paywall, the way the spec-alert routes do it)
    assert _all(_client(None)) == [404, 404, 404]
    assert _all(_client({"id": "free1", "role": "member", "plan": "free"})) == [404, 404, 404]
    with db.connect() as conn:
        assert conn.execute("SELECT 1 FROM sqlite_master WHERE name LIKE 'rs_screen_alert%'").fetchone() is None


def test_the_routes_do_not_exist_for_a_member_the_screens_are_off_for(armed, monkeypatch):
    monkeypatch.setattr(A, "screens_on", lambda user: user["id"] == "u2")
    assert _all(_client()) == [404, 404, 404]
    assert _all(_client({**PAID, "id": "u2"})) == [200, 200, 200]


def test_the_routes_are_not_offered_while_the_nightly_record_is_off(armed, monkeypatch):
    """Without `membership`'s record a subscription could never say anything."""
    monkeypatch.delenv(M.FLAG)
    assert _all(_client()) == [404, 404, 404]


def test_the_routes_are_paid(armed):
    assert _all(_client(None)) == [401, 401, 401]
    assert _all(_client({"id": "free1", "role": "member", "plan": "free"})) == [402, 402, 402]


def test_subscribe_list_and_unsubscribe_through_the_routes(armed):
    c = _client()
    assert c.get("/api/screener/rs-alerts").json() == {
        "available": True, "subscribed": [], "screens": list(FIVE), "cadence": "daily"}
    assert c.post(f"/api/screener/rs-alerts/{LEADERS}").json() == {"starter_id": LEADERS, "subscribed": True}
    assert c.post(f"/api/screener/rs-alerts/{LEADERS}").status_code == 200, "asking twice is fine"
    assert c.post(f"/api/screener/rs-alerts/{HIGHS}").status_code == 200
    assert c.get("/api/screener/rs-alerts").json()["subscribed"] == [HIGHS, LEADERS]
    # another member sees only their own
    assert _client({**PAID, "id": "u2"}).get("/api/screener/rs-alerts").json()["subscribed"] == []
    assert c.delete(f"/api/screener/rs-alerts/{LEADERS}").json() == {"starter_id": LEADERS, "subscribed": False}
    assert c.delete(f"/api/screener/rs-alerts/{LEADERS}").status_code == 200, "off twice is off"
    assert c.get("/api/screener/rs-alerts").json()["subscribed"] == [HIGHS]


@pytest.mark.parametrize("bad", ["starter_rs_quicksand_5", "starter_momentum_leaders", "nope"])
def test_an_unknown_or_hidden_id_is_a_404(armed, bad):
    c = _client()
    for method in ("post", "delete"):
        r = getattr(c, method)(f"/api/screener/rs-alerts/{bad}")
        assert r.status_code == 404 and r.json()["detail"] == "No such RS screen"
    assert A.subscribed("u1") == []


# ───────────────────────── the saved-screens payload ─────────────────────────

def _screens_client(monkeypatch, user=PAID):
    from api.routers import screener as screener_mod
    monkeypatch.setattr(screener_mod.scr_saved, "list_for", lambda uid: [])
    app = FastAPI()
    app.include_router(screener_mod.router)
    app.dependency_overrides[get_current_user] = lambda: dict(user)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app)


def test_the_saved_screens_payload_says_what_is_available_and_subscribed(armed, monkeypatch):
    A.subscribe("u1", LEADERS)
    A.subscribe("u2", TOP)
    body = _screens_client(monkeypatch).get("/api/screener/saved-screens").json()
    assert body["rs_alerts"] == {"available": True, "subscribed": [LEADERS]}
    assert set(body) == {"saved", "starters", "rs_market", "rs_alerts"}


def test_the_payload_has_no_such_key_with_the_flag_off_or_the_screens_off(armed, monkeypatch):
    monkeypatch.delenv(A.FLAG)
    body = _screens_client(monkeypatch).get("/api/screener/saved-screens").json()
    assert set(body) == {"saved", "starters", "rs_market"}
    monkeypatch.setenv(A.FLAG, "1")
    monkeypatch.delenv("RS_SCREENS_ENABLED")
    assert set(_screens_client(monkeypatch).get("/api/screener/saved-screens").json()) == {"saved", "starters"}
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")
    monkeypatch.setattr(A, "screens_on", lambda user: False)
    assert "rs_alerts" not in _screens_client(monkeypatch).get("/api/screener/saved-screens").json()


def test_the_payload_says_not_available_while_the_nightly_record_is_off(armed, monkeypatch):
    A.subscribe("u1", LEADERS)
    monkeypatch.delenv(M.FLAG)
    assert A.payload(PAID) == {"available": False, "subscribed": []}


def test_a_payload_read_that_fails_never_costs_the_screens_menu(armed, monkeypatch):
    def boom(uid):
        raise OSError("disk")
    monkeypatch.setattr(A, "subscribed", boom)
    body = _screens_client(monkeypatch).get("/api/screener/saved-screens")
    assert body.status_code == 200 and body.json()["rs_alerts"] == {"available": False, "subscribed": []}


# ───────────────────────── account deletion ─────────────────────────

def test_both_tables_are_in_the_account_purge():
    from api.services import alert_erasure
    assert {"rs_screen_alert_subs", "rs_screen_alerts_fired"} <= set(alert_erasure.SCREENER_TABLES)


# ───────────────────────── the owner-only value (unit U10) ─────────────────────────

def test_under_the_owner_only_value_only_an_admin_is_offered_or_sent_a_message(armed, monkeypatch):
    """`RS_SCREENS_ENABLED=admin`: the five are recorded nightly for everyone, but a member is
    not shown the screens, so a member is not offered the switch and is sent nothing; the
    owner is. A subscription a member made while the screens were on stays stored and silent."""
    A.subscribe("u1", LEADERS)
    A.subscribe("boss", LEADERS)
    armed("2026-11-13", THU, **{LEADERS: names(20, "OLD")})
    armed("2026-11-14", FRI, **{LEADERS: names(20, "OLD") + ["NEW1"]})
    monkeypatch.setenv("RS_SCREENS_ENABLED", "admin")
    monkeypatch.setattr(A, "_member", lambda uid: {"id": uid, "role": "admin" if uid == "boss" else "member"})
    assert A.payload({"id": "u1", "role": "member", "plan": "pro"}) is None
    assert A.payload({"id": "boss", "role": "admin", "plan": "pro"})["available"] is True
    sent = Sent()
    r = run(sent)
    assert r["sent"] == 1 and len(sent) == 1, r
    assert [row[0] for row in fired()] == ["boss"]
    assert A.screens(), "the five are still the five under the owner-only value"
