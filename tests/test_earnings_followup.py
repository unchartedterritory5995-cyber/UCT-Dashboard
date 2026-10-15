"""Tier 2 part B, item 11 (R-T2B-1..6): the earnings follow-up notice. Who, which reports, when, once,
at most three a day. The seams (reporters, member sets, the paid check, the reaction) are module
functions the run looks up at CALL time, so a monkeypatch reaches them.

Pre-flight amendments carried here: F5 (a measured 0.0 against an unmeasured name), F6 (the cap is mutated
through its constant), F9 (`reaction_session <= day`, the claim table dedupes), F10 (the real seams have
their own tests and every private name another module owns is railed by name), F21 (the warm budget), V4
(no provider configured is INCONCLUSIVE), V18 (a free member needs a created_at older than the trial)."""
from __future__ import annotations

import ast
import importlib
import inspect
import json
import os
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest

# Imported at COLLECTION, while AUTH_DB_PATH is still the conftest sandbox: this module captures its path at
# import, and a first import inside a test would pin it to that test's temp file for the rest of the session.
from api.services import alert_durability  # noqa: F401
from api.services import session_calendar
from api.services.journal_two import earnings_followup as ef
from api.services.journal_two.reminder_block import add_trading_days
from api.services.journal_two.timeutil import ET

FRI, MON = date(2026, 10, 16), date(2026, 10, 19)
_REAL_CONFIGURED = ef._reporters_configured      # captured before the world fixture replaces it


def at(d: date, h=17, m=0):
    return datetime(d.year, d.month, d.day, h, m, tzinfo=ET)


def _weekday_holiday(year=2026, month=11) -> date:
    d = date(year, month, 1)
    while d.month == month:
        if d.weekday() < 5 and not session_calendar.is_trading_day(d):
            return d
        d += timedelta(days=1)
    raise AssertionError("no weekday holiday")          # non-vacuity


@pytest.fixture
def db(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    monkeypatch.setenv("NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED", "1")
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    conn = auth_db.get_connection()
    yield conn
    conn.close()
    for s in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + s)
        except OSError:
            pass


@pytest.fixture
def world(monkeypatch):
    """reports[day_iso] = {SYM: timing}; sets[uid] = {SYM: [sources]}; reactions[SYM] = pct or None."""
    w = {"reports": {}, "sets": {}, "reactions": {}, "paid": set(), "ok": True, "warmed": [], "lookups": []}

    def reporters(d):
        w["lookups"].append(d.isoformat())
        return dict(w["reports"].get(d.isoformat(), {})), w["ok"]
    monkeypatch.setattr(ef, "reporters_on", reporters)
    monkeypatch.setattr(ef, "_reporters_configured", lambda: True)
    monkeypatch.setattr(ef, "_member_ids", lambda conn: sorted(w["sets"]))
    monkeypatch.setattr(ef, "_member_sets", lambda uid: dict(w["sets"].get(uid, {})))
    monkeypatch.setattr(ef, "_paid", lambda uid, conn: uid in w["paid"])

    def reaction(sym, rd):
        w["warmed"].append(sym)
        return w["reactions"].get(sym)
    monkeypatch.setattr(ef, "_reaction_pct", reaction)
    return w


def ring(db, now, **kw):
    sent = []
    result = ef.run_followups(now=now, conn=db, deliver=lambda uid, t, m, data: sent.append((uid, t, m, data)), **kw)
    return result, sent


def _symbols(sent):
    return [d["symbol"] for _, _, _, d in sent]


@pytest.mark.parametrize("rd, timing, session", [
    (date(2026, 10, 14), "bmo", date(2026, 10, 14)),
    (date(2026, 10, 14), "dmh", date(2026, 10, 14)),
    (date(2026, 10, 14), "amc", date(2026, 10, 15)),
    (date(2026, 10, 14), None, date(2026, 10, 15)),           # R-T2B-3: unknown is after the close
    (FRI, "amc", MON),
    (date(2026, 10, 17), "bmo", MON),                         # dated a Saturday
])
def test_reaction_session(rd, timing, session):
    assert ef.reaction_session(rd, timing) == session


def test_bmo_today_and_amc_yesterday_ring_today(db, world):
    """F9: Oct 14's own pass rings AMD (a before-the-open report). Oct 15 rings NVDA (reported after the close
    yesterday) and ORCL (before the open today), and sees AMD again: already sent, never twice. AAPL (after the
    close today) belongs to Oct 16."""
    world["reports"] = {"2026-10-15": {"ORCL": "bmo", "AAPL": "amc"}, "2026-10-14": {"NVDA": "amc", "AMD": "bmo"}}
    world["sets"] = {"u1": {"ORCL": ["watchlist"], "AAPL": ["watchlist"], "NVDA": ["positions"], "AMD": ["flagged"]}}
    world["paid"] = {"u1"}
    _, first = ring(db, at(date(2026, 10, 14)))
    assert _symbols(first) == ["AMD"]
    result, sent = ring(db, at(date(2026, 10, 15)))
    assert sorted(_symbols(sent)) == ["NVDA", "ORCL"]
    assert result["delivered"] == 2 and result["already_sent"] == 1 and result["candidates"] == 3


def test_a_report_whose_time_becomes_known_the_next_day_is_still_offered(db, world):
    """F9: unknown on day d reads as after the close (session d+1: nothing on d). Known as before-the-open on d+1
    puts the session on d, which `<=` still offers (`==` would offer it on neither day)."""
    world["sets"], world["paid"] = {"u1": {"ORCL": ["watchlist"]}}, {"u1"}
    d14, d15 = date(2026, 10, 14), date(2026, 10, 15)
    world["reports"] = {d14.isoformat(): {"ORCL": None}}
    assert ring(db, at(d14))[1] == []
    world["reports"] = {d14.isoformat(): {"ORCL": "bmo"}}
    result, sent = ring(db, at(d15))
    assert _symbols(sent) == ["ORCL"] and result["delivered"] == 1
    assert ring(db, at(d15, 18))[1] == []                               # and only once


def test_a_report_whose_time_becomes_unknown_the_next_day_is_not_offered_twice(db, world):
    """F9, the other direction: offered on d as before-the-open, then the source forgets the time. The claim
    table's primary key, (member, symbol, report date), is the only dedupe the job needs."""
    world["sets"], world["paid"] = {"u1": {"ORCL": ["watchlist"]}}, {"u1"}
    d14, d15 = date(2026, 10, 14), date(2026, 10, 15)
    world["reports"] = {d14.isoformat(): {"ORCL": "bmo"}}
    assert _symbols(ring(db, at(d14))[1]) == ["ORCL"]
    world["reports"] = {d14.isoformat(): {"ORCL": None}}
    result, sent = ring(db, at(d15))
    assert sent == [] and result["already_sent"] == 1
    assert db.execute("SELECT COUNT(*) FROM j2_earnings_followup_log").fetchone()[0] == 1


def test_an_amc_report_on_friday_is_offered_on_monday(db, world):
    world["reports"] = {FRI.isoformat(): {"ORCL": "amc"}}
    world["sets"], world["paid"] = {"u1": {"ORCL": ["positions"]}}, {"u1"}
    assert ring(db, at(FRI))[1] == []
    _, sent = ring(db, at(MON))
    assert _symbols(sent) == ["ORCL"]
    assert sent[0][3]["reportDate"] == FRI.isoformat() and sent[0][3]["sessionDay"] == MON.isoformat()


def test_a_holiday_rings_nothing_and_the_next_session_carries_it(db, world):
    h = _weekday_holiday()
    before = ef.prev_trading_day(h)
    after = add_trading_days(h, 1)
    world["reports"] = {before.isoformat(): {"ORCL": "amc"}, h.isoformat(): {"AMD": "bmo"}}
    world["sets"], world["paid"] = {"u1": {"ORCL": ["watchlist"], "AMD": ["watchlist"]}}, {"u1"}
    result, sent = ring(db, at(h))
    assert sent == [] and result["skipped"] == "not-a-trading-day"
    _, sent = ring(db, at(after))
    assert sorted(_symbols(sent)) == ["AMD", "ORCL"]


def test_one_notice_when_held_and_watched(db, world):
    world["reports"] = {"2026-10-15": {"ORCL": "bmo"}}
    world["sets"], world["paid"] = {"u1": {"ORCL": ["positions", "watchlist"]}}, {"u1"}
    _, sent = ring(db, at(date(2026, 10, 15)))
    assert len(sent) == 1 and "You hold it." in sent[0][2]


def test_a_member_who_sold_gets_nothing_unless_still_watching(db, world):
    world["reports"] = {"2026-10-15": {"ORCL": "bmo"}}
    world["sets"], world["paid"] = {"u1": {}, "u2": {"ORCL": ["watchlist"]}}, {"u1", "u2"}
    _, sent = ring(db, at(date(2026, 10, 15)))
    assert [uid for uid, *_ in sent] == ["u2"]
    assert "It is on your watchlist." in sent[0][2] and "You hold it." not in sent[0][2]


def test_running_twice_rings_once(db, world):
    world["reports"] = {"2026-10-15": {"ORCL": "bmo"}}
    world["sets"], world["paid"] = {"u1": {"ORCL": ["watchlist"]}}, {"u1"}
    _, first = ring(db, at(date(2026, 10, 15), 16, 45), pass_label="16:45")
    second, again = ring(db, at(date(2026, 10, 15), 18, 0), pass_label="18:00")
    assert len(first) == 1 and again == [] and second["already_sent"] == 1


def test_the_cap_keeps_the_biggest_moves_and_breaks_ties_by_symbol(db, world):
    world["reports"] = {"2026-10-15": {s: "bmo" for s in ("AAA", "BBB", "CCC", "DDD", "EEE")}}
    world["sets"], world["paid"] = {"u1": {s: ["watchlist"] for s in ("AAA", "BBB", "CCC", "DDD", "EEE")}}, {"u1"}
    world["reactions"] = {"AAA": None, "BBB": 3.0, "CCC": -3.0, "DDD": 1.0, "EEE": None}
    result, sent = ring(db, at(date(2026, 10, 15)))
    assert _symbols(sent) == ["BBB", "CCC", "DDD"]
    assert result["capped"] == 2
    rows = db.execute("SELECT symbol FROM j2_earnings_followup_log ORDER BY symbol").fetchall()
    assert [r[0] for r in rows] == ["BBB", "CCC", "DDD"]          # capped names are never written


def test_the_cap_is_the_constant_and_is_per_member(db, world, monkeypatch):
    """F6: the cap test above has the constant's own value in it; this one moves the constant."""
    monkeypatch.setattr(ef, "DAILY_CAP", 1)
    names = ("AAA", "BBB")
    world["reports"] = {"2026-10-15": {s: "bmo" for s in names}}
    world["sets"] = {"u1": {s: ["watchlist"] for s in names}, "u2": {s: ["watchlist"] for s in names}}
    world["paid"] = {"u1", "u2"}
    result, sent = ring(db, at(date(2026, 10, 15)))
    assert sorted((uid, d["symbol"]) for uid, _, _, d in sent) == [("u1", "AAA"), ("u2", "AAA")]
    assert result["capped"] == 2


def test_unmeasured_reactions_rank_last_even_under_the_cap(db, world):
    world["reports"] = {"2026-10-15": {s: "bmo" for s in ("AAA", "ZZZ", "MMM", "BBB")}}
    world["sets"], world["paid"] = {"u1": {s: ["watchlist"] for s in ("AAA", "ZZZ", "MMM", "BBB")}}, {"u1"}
    world["reactions"] = {"AAA": None, "BBB": None, "MMM": None, "ZZZ": 0.1}
    _, sent = ring(db, at(date(2026, 10, 15)))
    assert _symbols(sent) == ["ZZZ", "AAA", "BBB"]


def test_a_measured_flat_zero_outranks_an_unmeasured_name(db, world, monkeypatch):
    """F5: ZZZ measured 0.0 against AAA unmeasured, one slot. Without `reactions[s] is None` in the sort key
    both read as 0 and AAA wins on the symbol tiebreak."""
    monkeypatch.setattr(ef, "DAILY_CAP", 1)
    world["reports"] = {"2026-10-15": {"AAA": "bmo", "ZZZ": "bmo"}}
    world["sets"], world["paid"] = {"u1": {"AAA": ["watchlist"], "ZZZ": ["watchlist"]}}, {"u1"}
    world["reactions"] = {"AAA": None, "ZZZ": 0.0}
    _, sent = ring(db, at(date(2026, 10, 15)))
    assert _symbols(sent) == ["ZZZ"]


def test_a_failed_delivery_releases_its_claim_and_a_later_pass_retries(db, world):
    world["reports"] = {"2026-10-15": {"ORCL": "bmo"}}
    world["sets"], world["paid"] = {"u1": {"ORCL": ["watchlist"]}}, {"u1"}

    def boom(*a):
        raise RuntimeError("bell down")
    result = ef.run_followups(now=at(date(2026, 10, 15)), conn=db, deliver=boom)
    assert result["failed"] == 1
    assert db.execute("SELECT COUNT(*) FROM j2_earnings_followup_log").fetchone()[0] == 0
    _, sent = ring(db, at(date(2026, 10, 15), 18))
    assert len(sent) == 1


def test_one_members_unreadable_sets_do_not_stop_the_rest(db, world, monkeypatch):
    world["reports"] = {"2026-10-15": {"ORCL": "bmo"}}
    world["sets"], world["paid"] = {"u1": {"ORCL": ["watchlist"]}, "u2": {"ORCL": ["watchlist"]}}, {"u1", "u2"}

    def sets(uid):
        if uid == "u1":
            raise RuntimeError("watchlist read failed")
        return {"ORCL": ["watchlist"]}
    monkeypatch.setattr(ef, "_member_sets", sets)
    result, sent = ring(db, at(date(2026, 10, 15)))
    assert [uid for uid, *_ in sent] == ["u2"] and result["failed"] == 1
    assert db.execute("SELECT complete FROM j2_earnings_followup_runs").fetchone()[0] == 0   # the next pass retries


def test_a_symbol_the_server_would_refuse_is_never_offered(db, world):
    world["reports"] = {"2026-10-15": {"ORCL": "bmo", "BAD SYM": "bmo"}}
    world["sets"], world["paid"] = {"u1": {"ORCL": ["watchlist"], "BAD SYM": ["watchlist"]}}, {"u1"}
    result, sent = ring(db, at(date(2026, 10, 15)))
    assert _symbols(sent) == ["ORCL"] and result["candidates"] == 1


def test_an_unpaid_member_rings_nothing_and_warms_nothing(db, world):
    world["reports"] = {"2026-10-15": {"ORCL": "bmo"}}
    world["sets"] = {"u1": {"ORCL": ["watchlist"]}}
    result, sent = ring(db, at(date(2026, 10, 15)))
    assert sent == [] and world["warmed"] == [] and result["members"] == 0


def test_the_followup_switch_off_rings_nothing_and_reads_nothing(db, world, monkeypatch):
    world["reports"] = {"2026-10-15": {"ORCL": "bmo"}}
    world["sets"], world["paid"] = {"u1": {"ORCL": ["watchlist"]}}, {"u1"}
    monkeypatch.delenv("NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED")
    result, sent = ring(db, at(date(2026, 10, 15)))
    assert sent == [] and result["skipped"] == "switched-off" and world["warmed"] == [] and world["lookups"] == []


def test_the_journal_styles_switch_is_a_prerequisite(db, world, monkeypatch):
    """The card's create goes through the styled-create door, which refuses without NOTEBOOK_JOURNAL_STYLES_ENABLED:
    a notice that opens a card that cannot make its note is worse than no notice."""
    world["reports"] = {"2026-10-15": {"ORCL": "bmo"}}
    world["sets"], world["paid"] = {"u1": {"ORCL": ["watchlist"]}}, {"u1"}
    monkeypatch.delenv("NOTEBOOK_JOURNAL_STYLES_ENABLED")
    result, sent = ring(db, at(date(2026, 10, 15)))
    assert sent == [] and result["skipped"] == "switched-off" and world["warmed"] == [] and world["lookups"] == []
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    assert len(ring(db, at(date(2026, 10, 15)))[1]) == 1            # non-vacuity: both on, it rings


def test_the_notice_names_the_card_link_and_the_source(db, world):
    world["reports"] = {"2026-10-15": {"BRK.B": "bmo"}}
    world["sets"], world["paid"] = {"u1": {"BRK.B": ["flagged"]}}, {"u1"}
    _, sent = ring(db, at(date(2026, 10, 15)))
    uid, title, message, data = sent[0]
    assert title == "BRK.B reported: write your follow-up"
    assert message == "BRK.B reported earnings on Oct 15, 2026. You flagged it. Compare what you expected with what happened."
    assert data["source"] == ef.FOLLOWUP_SOURCE
    assert data["research_url"] == "/journal/notebook?followup=BRK.B&reportDate=2026-10-15"


# ── V4: no provider configured is INCONCLUSIVE, never "nobody reported" ─────────────────────────────

def _no_provider(monkeypatch):
    from api.services.journal_two import earnings_prep as ep
    monkeypatch.setattr(ef, "_reporters_configured", _REAL_CONFIGURED)
    monkeypatch.setattr(ep, "sandbox_calendar_active", lambda: False)
    monkeypatch.delenv("FINNHUB_API_KEY", raising=False)
    monkeypatch.delenv("FMP_API_KEY", raising=False)


def test_no_provider_key_skips_the_run_and_ledgers_it_as_unconfigured(db, world, monkeypatch):
    _no_provider(monkeypatch)
    world["reports"] = {"2026-10-15": {"ORCL": "bmo"}}
    world["sets"], world["paid"] = {"u1": {"ORCL": ["watchlist"]}}, {"u1"}
    result, sent = ring(db, at(date(2026, 10, 15)))
    assert sent == [] and result["skipped"] == "unconfigured"
    assert world["lookups"] == [] and world["warmed"] == []          # nothing was asked, so nothing was "quiet"
    row = db.execute("SELECT complete, result FROM j2_earnings_followup_runs").fetchone()
    assert row[0] == 0 and json.loads(row[1])["skipped"] == "unconfigured"
    # an unconfigured run never counts as the day's completed pass, so the boot catch-up looks again
    out = ef.catch_up_followups(now=at(date(2026, 10, 15), 19), conn=db, deliver=lambda *a: None)
    assert out["ran"] is True and out["skipped"] == "unconfigured"


@pytest.mark.parametrize("key", ["FINNHUB_API_KEY", "FMP_API_KEY"])
def test_a_provider_key_makes_the_run_real(db, world, monkeypatch, key):
    _no_provider(monkeypatch)
    monkeypatch.setenv(key, "k")
    world["reports"] = {"2026-10-15": {"ORCL": "bmo"}}
    world["sets"], world["paid"] = {"u1": {"ORCL": ["watchlist"]}}, {"u1"}
    result, sent = ring(db, at(date(2026, 10, 15)))
    assert result["skipped"] is None and _symbols(sent) == ["ORCL"]


def test_the_walks_sandbox_calendar_needs_no_key(monkeypatch):
    from api.services.journal_two import earnings_prep as ep
    monkeypatch.setattr(ef, "_reporters_configured", _REAL_CONFIGURED)
    monkeypatch.delenv("FINNHUB_API_KEY", raising=False)
    monkeypatch.delenv("FMP_API_KEY", raising=False)
    monkeypatch.setattr(ep, "sandbox_calendar_active", lambda: True)
    assert ef._reporters_configured() is True
    monkeypatch.setattr(ep, "sandbox_calendar_active", lambda: False)
    assert ef._reporters_configured() is False


# ── F21: the warm has a wall-clock budget ──────────────────────────────────────────────────────────

def test_the_warm_stops_at_its_budget_and_the_ledger_counts_the_skipped(db, world, monkeypatch):
    clock = {"t": 1000.0}
    monkeypatch.setattr(ef, "_mono", lambda: clock["t"])

    def slow(sym, rd):
        world["warmed"].append(sym)
        clock["t"] += 70.0
        return {"AAA": 1.0, "BBB": 5.0, "CCC": 9.0}.get(sym)
    monkeypatch.setattr(ef, "_reaction_pct", slow)
    names = ("AAA", "BBB", "CCC")
    world["reports"] = {"2026-10-15": {s: "bmo" for s in names}}
    world["sets"], world["paid"] = {"u1": {s: ["watchlist"] for s in names}}, {"u1"}
    result, sent = ring(db, at(date(2026, 10, 15)))
    assert world["warmed"] == ["AAA", "BBB"]                          # CCC arrived at 140 s into a 120 s budget
    assert result["warmed"] == 2 and result["warm_skipped"] == 1
    assert _symbols(sent) == ["BBB", "AAA", "CCC"]                    # the unwarmed name ranks as unmeasured, last
    ledger = json.loads(db.execute("SELECT result FROM j2_earnings_followup_runs").fetchone()[0])
    assert ledger["warm_skipped"] == 1 and ledger["warmed"] == 2


def test_a_quick_warm_skips_nothing(db, world, monkeypatch):
    monkeypatch.setattr(ef, "_mono", lambda: 5.0)                     # the clock never moves
    names = ("AAA", "BBB", "CCC")
    world["reports"] = {"2026-10-15": {s: "bmo" for s in names}}
    world["sets"], world["paid"] = {"u1": {s: ["watchlist"] for s in names}}, {"u1"}
    result, _ = ring(db, at(date(2026, 10, 15)))
    assert result["warmed"] == 3 and result["warm_skipped"] == 0 and world["warmed"] == ["AAA", "BBB", "CCC"]


def test_a_name_is_warmed_once_across_members(db, world):
    world["reports"] = {"2026-10-15": {"ORCL": "bmo"}}
    world["sets"] = {"u1": {"ORCL": ["watchlist"]}, "u2": {"ORCL": ["positions"]}}
    world["paid"] = {"u1", "u2"}
    result, sent = ring(db, at(date(2026, 10, 15)))
    assert len(sent) == 2 and world["warmed"] == ["ORCL"] and result["warmed"] == 1


# ── catch-up, registrar, wiring ────────────────────────────────────────────────────────────────────

def test_catch_up_targets_the_latest_session_whose_first_pass_has_passed():
    assert ef.catch_up_target(at(date(2026, 10, 15), 16, 50)) == date(2026, 10, 15)
    assert ef.catch_up_target(at(date(2026, 10, 15), 10, 0)) == date(2026, 10, 14)
    assert ef.catch_up_target(at(date(2026, 10, 18), 12, 0)) == FRI           # a Sunday


def test_catch_up_skips_a_day_whose_run_completed(db, world):
    world["reports"] = {"2026-10-15": {"ORCL": "bmo"}}
    world["sets"], world["paid"] = {"u1": {"ORCL": ["watchlist"]}}, {"u1"}
    ring(db, at(date(2026, 10, 15), 16, 45), pass_label="16:45")
    out = ef.catch_up_followups(now=at(date(2026, 10, 15), 19), conn=db, deliver=lambda *a: None)
    assert out == {"ran": False, "reason": "already-complete", "day": "2026-10-15"}


def test_the_registrar_reads_no_switch_and_wires_three_jobs(monkeypatch):
    from api.services.journal_two import journal_styles

    def boom():
        raise AssertionError("read at registration")
    monkeypatch.setattr(ef, "enabled", boom)
    monkeypatch.setattr(journal_styles, "enabled", boom)
    jobs = []

    class FakeScheduler:
        def add_job(self, fn, trigger, **kw):
            jobs.append((kw["id"], str(trigger)))
    assert ef.register_followup_jobs(FakeScheduler()) is True
    ids = [j for j, _ in jobs]
    assert ids == ["notebook_earnings_followup", "notebook_earnings_followup_second", "notebook_earnings_followup_catch_up"]
    assert "hour='16'" in jobs[0][1] and "minute='45'" in jobs[0][1] and "mon-fri" in jobs[0][1]


def test_main_calls_the_registrar():
    tree = ast.parse(Path("api/main.py").read_text(encoding="utf-8"))
    called = {n.func.attr for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)}
    assert "register_task_reminder_job" in called                   # non-vacuity: the sibling is seen
    assert "register_followup_jobs" in called


# ── the time fill ──────────────────────────────────────────────────────────────────────────────────

def test_the_time_fill_reads_finnhubs_hour_and_never_raises(monkeypatch):
    from api.services import finnhub_client
    calls = []

    def answer(path, params, timeout=None, **kw):
        calls.append((path, params))
        return {"earningsCalendar": [{"symbol": "ORCL", "hour": "amc"}, {"symbol": "AMD", "hour": ""}, "junk"]}
    monkeypatch.setattr(finnhub_client, "fh_get", answer)
    found = {"ORCL": None, "AMD": None, "NVDA": "bmo"}
    ef._fill_timing("2026-10-14", found)
    assert found == {"ORCL": "amc", "AMD": None, "NVDA": "bmo"}
    assert calls == [("/calendar/earnings", {"from": "2026-10-14", "to": "2026-10-14"})]

    def down(*a, **k):
        raise RuntimeError("finnhub down")
    monkeypatch.setattr(finnhub_client, "fh_get", down)
    found = {"ORCL": None, "NVDA": "bmo"}
    ef._fill_timing("2026-10-14", found)
    assert found == {"ORCL": None, "NVDA": "bmo"}

    def never(*a, **k):
        raise AssertionError("every symbol already has a time")
    monkeypatch.setattr(finnhub_client, "fh_get", never)
    full = {"ORCL": "amc", "NVDA": "bmo"}
    ef._fill_timing("2026-10-14", full)
    assert full == {"ORCL": "amc", "NVDA": "bmo"}


# ── F10: the real seams ────────────────────────────────────────────────────────────────────────────

def test_reporters_on_merges_the_calendar_names_with_their_times(monkeypatch):
    from api.services import calendar_alerts, finnhub_client
    from api.services.journal_two import earnings_prep as ep
    monkeypatch.setattr(ep, "sandbox_calendar_active", lambda: False)
    asked = []

    def lookup(iso):
        asked.append(iso)
        return {"ORCL", "AMD", "NVDA"}, True
    monkeypatch.setattr(calendar_alerts, "_get_reporters_for_date_with_status", lookup)
    monkeypatch.setattr(ep, "_timing_from_calendar_cache", lambda sym, day: {"ORCL": "amc"}.get(sym))
    fills = []

    def fh(path, params, timeout=None, **kw):
        fills.append(params)
        return {"earningsCalendar": [{"symbol": "AMD", "hour": "bmo"}, {"symbol": "NVDA", "hour": ""}]}
    monkeypatch.setattr(finnhub_client, "fh_get", fh)
    found, clean = ef.reporters_on(date(2026, 10, 14))
    assert found == {"ORCL": "amc", "AMD": "bmo", "NVDA": None} and clean is True
    assert asked == ["2026-10-14"] and fills == [{"from": "2026-10-14", "to": "2026-10-14"}]


def test_reporters_on_passes_the_providers_unclean_flag_through_and_skips_the_fill_when_timed(monkeypatch):
    from api.services import calendar_alerts, finnhub_client
    from api.services.journal_two import earnings_prep as ep
    monkeypatch.setattr(ep, "sandbox_calendar_active", lambda: False)
    monkeypatch.setattr(calendar_alerts, "_get_reporters_for_date_with_status", lambda iso: ({"ORCL"}, False))
    monkeypatch.setattr(ep, "_timing_from_calendar_cache", lambda sym, day: "bmo")

    def never(*a, **k):
        raise AssertionError("the cache named every time")
    monkeypatch.setattr(finnhub_client, "fh_get", never)
    assert ef.reporters_on(date(2026, 10, 14)) == ({"ORCL": "bmo"}, False)


def test_reporters_on_in_the_walks_sandbox_reads_only_the_calendar_file(monkeypatch):
    from api.services import calendar_alerts
    from api.services.journal_two import earnings_prep as ep
    monkeypatch.setattr(ep, "sandbox_calendar_active", lambda: True)
    monkeypatch.setattr(ep, "_sandbox_window",
                        lambda: ({"ORCL": "2026-10-14", "AMD": "2026-10-15"}, {"ORCL": "amc"}, True, "asof"))

    def never(iso):
        raise AssertionError("the sandbox never asks the live calendar")
    monkeypatch.setattr(calendar_alerts, "_get_reporters_for_date_with_status", never)
    assert ef.reporters_on(date(2026, 10, 14)) == ({"ORCL": "amc"}, False)      # a partial file is unclean
    assert ef.reporters_on(date(2026, 10, 15)) == ({"AMD": None}, False)


def _make_users():
    """A real users table: a pro member (comped), an old free member (older than the 7-day trial, V18), an admin."""
    import sqlite3
    from api.services import auth_db, auth_service
    ids = {}
    for key, email in (("pro", "pro@example.com"), ("free", "free@example.com"), ("admin", "adm@example.com")):
        ids[key] = auth_service.create_user(email, "Passw0rd!x1", key)["id"]
    auth_service.comp_user_access("pro@example.com", True)
    raw = sqlite3.connect(auth_db._DB_PATH)
    try:
        raw.execute("UPDATE users SET role = 'admin' WHERE id = ?", (ids["admin"],))
        raw.execute("UPDATE users SET created_at = '2025-01-01 00:00:00.000000' WHERE id = ?", (ids["free"],))
        raw.commit()
    finally:
        raw.close()
    return ids


def test_paid_over_real_users(db):
    ids = _make_users()
    assert ef._paid(ids["pro"], db) is True
    assert ef._paid(ids["admin"], db) is True
    assert ef._paid(ids["free"], db) is False                         # V18: old enough that the trial cannot hide it
    assert ef._paid("no-such-member", db) is False


def test_paid_reads_a_plan_it_cannot_resolve_as_not_paid(db, monkeypatch):
    from api.middleware import auth_middleware as authmw
    ids = _make_users()

    def boom(uid):
        raise RuntimeError("subscriptions unreadable")
    monkeypatch.setattr(authmw, "get_user_plan", boom)
    assert ef._paid(ids["pro"], db) is False


def test_member_ids_lists_every_user(db):
    assert ef._member_ids(db) == []
    ids = _make_users()
    got = ef._member_ids(db)
    assert sorted(got) == sorted(ids.values()) and all(isinstance(i, str) for i in got)


def test_every_private_name_the_job_calls_in_another_module_exists_with_the_shape_it_is_called_with():
    """F10: the job leans on underscore names in three other modules. A rename breaks it silently (every call is
    inside a try or a lazy import), so each is railed by name AND by arity."""
    from api.services import calendar_alerts
    from api.services.journal_two import earnings_prep, followup_prefill, note_tasks, reminder_block
    calls = [
        (calendar_alerts, "_get_reporters_for_date_with_status", ("2026-10-14",)),
        (earnings_prep, "_timing_from_calendar_cache", ("ORCL", "2026-10-14")),
        (earnings_prep, "_sandbox_window", ()),
        (earnings_prep, "_member_sets", ("u1",)),
        (earnings_prep, "sandbox_calendar_active", ()),
        (followup_prefill, "_day_words", (date(2026, 10, 14),)),
        (followup_prefill, "valid_symbol", ("ORCL",)),
        (followup_prefill, "event_for", ({}, "2026-10-14")),
        (followup_prefill, "as_number", (1.0,)),
        (reminder_block, "add_trading_days", (date(2026, 10, 14), 1)),
        (note_tasks, "deliver_in_app", ("src", "u1", "title", "message", {})),
    ]
    for module, name, args in calls:
        fn = getattr(module, name, None)
        assert callable(fn), f"{module.__name__}.{name} is gone: the follow-up job calls it"
        inspect.signature(fn).bind(*args)                            # raises TypeError when the arity moved
    assert not hasattr(ef, "next_trading_day")                       # one trading-day walk: reminder_block's


# ── the bell ───────────────────────────────────────────────────────────────────────────────────────

def test_the_default_delivery_is_note_tasks_one_helper_bound_to_this_jobs_source(monkeypatch):
    from api.services import alerts
    from api.services.journal_two import note_tasks as nt
    seen = []
    monkeypatch.setattr(alerts, "add_alert", lambda *a, **k: seen.append((a, k)))
    ef._deliver_in_app("u1", "T", "M", {"k": 1})
    nt._deliver_in_app("u2", "T2", "M2", {"k": 2})
    assert seen == [((ef.FOLLOWUP_SOURCE, "T", "M"), {"severity": "info", "data": {"k": 1}, "user_id": "u1"}),
                    ((nt.REMINDER_SOURCE, "T2", "M2"), {"severity": "info", "data": {"k": 2}, "user_id": "u2"})]


def test_the_bell_reaches_the_members_notices_with_only_a_link(db, world, monkeypatch):
    """End to end through the real helper: the alert is the member's own, carries the card link and writes no note."""
    from api.services import alerts, email_service
    from api.services import watchlist_alert_service as was
    from api.services.journal_two import notes as notes_service

    def _no_email(*a, **k):
        raise AssertionError("a follow-up notice must never send email")
    monkeypatch.setattr(email_service, "send_email", _no_email)
    monkeypatch.setattr(was, "send_email", _no_email, raising=False)
    monkeypatch.setattr(was, "deliver_alert_payload", _no_email)
    monkeypatch.setattr(alert_durability, "record_alert", lambda alert: None)
    monkeypatch.setattr(alert_durability, "list_durable_alerts", lambda uid, limit: [])
    monkeypatch.setattr(alerts, "_s7_durable_alerts", lambda uid, limit: [])

    def _no_note(*a, **k):
        raise AssertionError("the job never writes a note")
    monkeypatch.setattr(notes_service, "create_note", _no_note)
    world["reports"] = {"2026-10-15": {"ORCL": "bmo"}}
    world["sets"], world["paid"] = {"u8": {"ORCL": ["positions"]}}, {"u8"}
    try:
        result = ef.run_followups(now=at(date(2026, 10, 15)), conn=db)         # the default deliver
        assert result["delivered"] == 1
        mine = [a for a in alerts.get_alerts(user_id="u8") if a["type"] == ef.FOLLOWUP_SOURCE]
        assert len(mine) == 1 and mine[0]["title"] == "ORCL reported: write your follow-up"
        assert mine[0]["data"]["research_url"] == "/journal/notebook?followup=ORCL&reportDate=2026-10-15"
    finally:
        alerts.clear_alerts(user_id="u8")
