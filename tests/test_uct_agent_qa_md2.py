"""UCT Agent program, agent-qa: MD-2 ACCEPTANCE HARNESS for `stock.quote` (MD-1 v1.5 §4.5), server half.

Sprint 2 task 2. Independent of agent-md's own tests, and stricter about one thing: the CALENDAR. agent-md's tests
hand-pick `trading=True/False` per row; here the trading day is DERIVED from the product's real NYSE calendar
(`bars_fetch._is_nyse_holiday` + weekday) for the frozen clock's OWN ET date, so a clock and its calendar can never
disagree inside a test.

  1. the session-state clock matrix: regular, premarket, after-hours, overnight (evening and pre-dawn), weekend,
     holiday, early close, DST Mondays, unreadable calendar;
  2. F-19 (strict pin): `_session_detail(now)` honours `now` for the minutes but asks the WALL clock whether it is
     a trading day;
  3. a GENERATOR of real adapter envelopes, one per §4.5 answer row, frozen at one instant (session clock,
     staleness clock and fetched_at all agree), written to app/src/agent/__fixtures__/program/md2/scenarios.json,
     which the browser half (app/src/agent/qa/md2Quote.test.js) feeds to the capability.

Regenerate:  C:\\UCT\\agent\\.venv\\Scripts\\python.exe -m tests.test_uct_agent_qa_md2 --write
"""
from __future__ import annotations

import json
import sys
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from api.services import bars_fetch, massive
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw
from api.services.uct_agent.marketdata import quotes as q

ET = ZoneInfo("America/New_York")
REPO = Path(__file__).resolve().parents[1]
REAL_SESSION_DETAIL = q._session_detail      # captured before any patch
REAL_UTC_ISO = env.utc_iso
OUT = REPO / "app" / "src" / "agent" / "__fixtures__" / "program" / "md2" / "scenarios.json"


def et(y, m, d, hh, mm, ss=0) -> datetime:
    return datetime(y, m, d, hh, mm, ss, tzinfo=ET)


def is_trading(now: datetime) -> bool:
    """The product's real calendar, asked about `now`'s OWN ET date (not the wall clock's)."""
    d = now.astimezone(ET)
    return d.weekday() < 5 and not bars_fetch._is_nyse_holiday(int(d.strftime("%Y%m%d")))


def session_at(monkeypatch, now: datetime) -> str:
    monkeypatch.setattr(massive, "_today_et_is_a_trading_day", lambda: is_trading(now))
    return q._session_detail(now)


# ── 1. the clock matrix ─────────────────────────────────────────────────────────────────────────────────────
CLOCKS = [
    ("regular, Tue", et(2026, 11, 10, 10, 31), "regular"),
    ("open bell", et(2026, 11, 10, 9, 30), "regular"),
    ("one minute before the open", et(2026, 11, 10, 9, 29), "premarket"),
    ("premarket start", et(2026, 11, 10, 4, 0), "premarket"),
    ("pre-dawn overnight", et(2026, 11, 10, 3, 59), "overnight"),
    ("close bell", et(2026, 11, 10, 16, 0), "after-hours"),
    ("late after-hours", et(2026, 11, 10, 19, 59), "after-hours"),
    ("evening overnight", et(2026, 11, 10, 20, 0), "overnight"),
    ("Monday 03:59 after a weekend", et(2026, 11, 9, 3, 59), "overnight"),
    ("Saturday noon", et(2026, 11, 14, 12, 0), "closed"),
    ("Sunday 21:00", et(2026, 11, 15, 21, 0), "closed"),
    ("Thanksgiving noon (holiday)", et(2026, 11, 26, 12, 0), "closed"),
    ("Thanksgiving eve 21:00", et(2026, 11, 25, 21, 0), "overnight"),
    ("observed Independence Day 2026-07-03", et(2026, 7, 3, 11, 0), "closed"),
    ("early close 12:59 (2026-11-27)", et(2026, 11, 27, 12, 59), "regular"),
    ("early close 13:00", et(2026, 11, 27, 13, 0), "after-hours"),
    ("early close 19:59", et(2026, 11, 27, 19, 59), "after-hours"),
    ("DST end Monday 09:30 (2026-11-02)", et(2026, 11, 2, 9, 30), "regular"),
    ("DST start Monday 09:30 (2026-03-09)", et(2026, 3, 9, 9, 30), "regular"),
]


@pytest.mark.parametrize("label,now,want", CLOCKS, ids=[c[0] for c in CLOCKS])
def test_session_detail_from_a_frozen_clock_and_its_own_calendar(monkeypatch, label, now, want):
    got = session_at(monkeypatch, now)
    assert got == want, (label, got)
    assert q._session_from_detail(got) == {"regular": "regular", "premarket": "extended",
                                          "after-hours": "extended"}.get(got, "closed")


def test_the_same_instant_in_UTC_gives_the_same_session(monkeypatch):
    """The function converts to ET itself: a UTC `now` is the same instant, the same answer."""
    for _, now, want in CLOCKS:
        assert session_at(monkeypatch, now.astimezone(timezone.utc)) == want


def test_an_unreadable_calendar_is_closed_never_open(monkeypatch):
    monkeypatch.setattr(massive, "_today_et_is_a_trading_day", lambda: (_ for _ in ()).throw(RuntimeError("x")))
    assert q._session_detail(et(2026, 11, 10, 10, 31)) == "closed"


def test_an_unreadable_EARLY_CLOSE_falls_back_to_16_00(monkeypatch):
    monkeypatch.setattr(massive, "_today_et_is_a_trading_day", lambda: True)
    monkeypatch.setattr(bars_fetch, "_session_close_minutes", lambda ymd: (_ for _ in ()).throw(RuntimeError("x")))
    assert q._session_detail(et(2026, 11, 27, 13, 30)) == "regular"     # the fallback assumes a full day


# ── 2. F-19: `now` is half-honoured ─────────────────────────────────────────────────────────────────────────
def test_F19_OPEN_PIN_session_detail_asks_the_WALL_clock_whether_it_is_a_trading_day():
    """With the REAL calendar helper (nothing patched), `_session_detail(now)` uses `now` for the minutes but
    `massive._today_et_is_a_trading_day()`, which reads the wall clock, for the day. So a `now` whose day type
    differs from today's gets the wrong answer. Production passes no `now` (consistent), but every caller that
    freezes a clock (agent-md's tests, QA's freshness and MD-2 harnesses) gets a mixed answer unless it patches the
    helper. Owner: agent-md (quotes.py) / massive helper. STRICT pin: fails when the day is taken from `now`."""
    wall_trading = massive._today_et_is_a_trading_day()
    # a mid-session minute on a day of the OPPOSITE type to today's
    now = et(2026, 11, 14, 12, 0) if wall_trading else et(2026, 11, 10, 12, 0)    # Saturday, or a plain Tuesday
    truth = "closed" if wall_trading else "regular"
    got = q._session_detail(now)
    assert got != truth, f"F-19 is fixed ({got} == {truth}): flip this pin into a proof"


# ── 3. real adapter envelopes, one per §4.5 row ─────────────────────────────────────────────────────────────
def snap(trade=None, trade_at=None, minute=None, day_close=None, prev_close=141.0, change=1.23, change_pct=0.87):
    t = {"todaysChange": change, "todaysChangePerc": change_pct, "prevDay": {"c": prev_close},
         "day": {"o": 140.0, "h": 143.0, "l": 139.5, "c": day_close, "v": 1_000_000}}
    if trade is not None:
        t["lastTrade"] = {"p": trade}
    if minute is not None:
        t["min"] = {"c": minute}
    if trade_at is not None:
        t["_observed_at"] = trade_at.timestamp()
    return t


def frozen_read(monkeypatch, now: datetime, kind: str, params: dict, snapshots: dict | None, fail: bool = False) -> dict:
    """One REAL adapter read with every clock frozen at `now` and the provider faked."""
    monkeypatch.setattr(massive, "_today_et_is_a_trading_day", lambda: is_trading(now))
    monkeypatch.setattr(q, "_session_detail", lambda now_=None: REAL_SESSION_DETAIL(now))
    monkeypatch.setattr(q, "time", types.SimpleNamespace(time=lambda: now.timestamp()))
    monkeypatch.setattr(env, "utc_iso", lambda dt=None: REAL_UTC_ISO(dt or now))

    class Client:
        def get_batch_quotes(self, symbols):
            if fail:
                raise RuntimeError("provider down 503 at 10:31")
            return types.SimpleNamespace(value={s: snapshots[s] for s in symbols if s in (snapshots or {})}, degraded=False)
    monkeypatch.setattr(massive, "_get_client", lambda: Client())
    fn = q.read_quote if kind == "quote" else q.read_quotes
    out = fn(params, {})
    assert env.validate_envelope(out) == [], (kind, env.validate_envelope(out))
    return out


def scenarios(monkeypatch) -> dict:
    T = et(2026, 11, 10, 10, 31)
    S = {}

    def add(name, row, now, kind, params, snaps, symbols, fail=False):
        S[name] = {"row": row, "now_et": now.isoformat(), "symbols": symbols,
                   "envelope": frozen_read(monkeypatch, now, kind, params, snaps, fail)}
    add("live_regular", "live, not stale, regular", T, "quote", {"symbol": "NVDA"},
        {"NVDA": snap(trade=142.10, trade_at=T - timedelta(seconds=20))}, ["NVDA"])
    add("stale_regular", "live, stale, regular", T, "quote", {"symbol": "NVDA"},
        {"NVDA": snap(trade=142.10, trade_at=T - timedelta(minutes=11))}, ["NVDA"])
    P = et(2026, 11, 10, 7, 45)
    add("live_premarket", "live, premarket", P, "quote", {"symbol": "NVDA"},
        {"NVDA": snap(trade=142.10, trade_at=P - timedelta(minutes=2))}, ["NVDA"])
    A = et(2026, 11, 10, 16, 50)
    add("historical_afterhours", "historical, after-hours (no trade in 15 min)", A, "quote", {"symbol": "NVDA"},
        {"NVDA": snap(trade=142.10, trade_at=et(2026, 11, 10, 16, 30))}, ["NVDA"])
    O = et(2026, 11, 10, 21, 0)
    add("overnight_ah_print", "overnight, an after-hours print", O, "quote", {"symbol": "NVDA"},
        {"NVDA": snap(trade=142.10, trade_at=et(2026, 11, 10, 19, 59))}, ["NVDA"])
    W = et(2026, 11, 14, 12, 0)
    add("weekend_close", "closed weekend, priced from the day close", W, "quote", {"symbol": "NVDA"},
        {"NVDA": snap(day_close=142.10, trade_at=et(2026, 11, 13, 16, 0))}, ["NVDA"])
    H = et(2026, 11, 26, 12, 0)
    add("holiday_close", "closed holiday", H, "quote", {"symbol": "NVDA"},
        {"NVDA": snap(day_close=142.10, trade_at=et(2026, 11, 25, 16, 0))}, ["NVDA"])
    E = et(2026, 11, 27, 13, 30)
    add("early_close_afterhours_live", "early close: after-hours, live print", E, "quote", {"symbol": "NVDA"},
        {"NVDA": snap(trade=142.10, trade_at=E - timedelta(minutes=5))}, ["NVDA"])
    add("regular_from_close", "regular, row priced from a close", T, "quote", {"symbol": "NVDA"},
        {"NVDA": snap(day_close=142.10, trade_at=T - timedelta(minutes=1))}, ["NVDA"])
    add("partial_quotes", "partial (quotes)", T, "quotes", {"symbols": ["NVDA", "NOPE"]},
        {"NVDA": snap(trade=142.10, trade_at=T - timedelta(seconds=20))}, ["NVDA", "NOPE"])
    add("unavailable", "unavailable (the provider failed)", T, "quote", {"symbol": "NVDA"}, None, ["NVDA"], fail=True)
    S["refused_budget"] = {"row": "refused (the turn's read budget, a note carrying a number)", "now_et": T.isoformat(),
                           "symbols": ["NVDA"],
                           "envelope": env.refused("quote", {"symbol": "NVDA"},
                                                   f"this turn already made {gw.MAX_READS_PER_TURN} data reads")}
    return S


def scenarios_text(monkeypatch) -> str:
    body = {"about": "generated by tests/test_uct_agent_qa_md2.py from the REAL quotes adapter — do not edit",
            "contract": "MD-1 v1.5 §4.5", "scenarios": scenarios(monkeypatch)}
    return json.dumps(body, indent=1, sort_keys=True) + "\n"


def test_every_scenario_is_a_valid_envelope_in_the_state_it_claims(monkeypatch):
    S = scenarios(monkeypatch)
    want = {"live_regular": ("live", False, "regular"), "stale_regular": ("live", True, "regular"),
            "live_premarket": ("live", False, "premarket"), "historical_afterhours": ("historical", False, "after-hours"),
            "overnight_ah_print": ("historical", False, "overnight"), "weekend_close": ("historical", False, "closed"),
            "holiday_close": ("historical", False, "closed"),
            "early_close_afterhours_live": ("live", False, "after-hours"),
            "regular_from_close": ("historical", False, "regular")}
    for name, (fresh, stale, detail) in want.items():
        e = S[name]["envelope"]
        assert (e["freshness"], e["stale"], e["data"]["session_detail"]) == (fresh, stale, detail), (name, e["freshness"], e["stale"], e["data"].get("session_detail"))
    assert S["partial_quotes"]["envelope"]["status"] == "partial"
    assert S["unavailable"]["envelope"]["status"] == "unavailable"
    for name, s in S.items():                                       # one instant per scenario: fetched_at IS the clock
        assert s["envelope"]["fetched_at"] == REAL_UTC_ISO(datetime.fromisoformat(s["now_et"])), name


def test_the_scenario_fixtures_are_current(monkeypatch):
    want = scenarios_text(monkeypatch)
    assert OUT.exists(), "generate: python -m tests.test_uct_agent_qa_md2 --write"
    assert OUT.read_text(encoding="utf-8").replace("\r\n", "\n") == want, "regenerate with --write"


if __name__ == "__main__":
    if "--write" in sys.argv:
        mp = pytest.MonkeyPatch()
        try:
            text = scenarios_text(mp)
        finally:
            mp.undo()
        OUT.parent.mkdir(parents=True, exist_ok=True)
        with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        print(OUT)
