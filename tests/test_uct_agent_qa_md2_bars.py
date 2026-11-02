"""UCT Agent program, agent-qa: MD-2 harness for `stock.dailyBars` (MD-1 v1.5 §4.6), server half.

1. "Last COMPLETED session" from a frozen clock (the adapter's `expected`), including F-23 (strict pin): on an NYSE
   half day the product helper `bars_fetch._last_closed_session_yyyymmdd` still waits for 16:00, so between the
   13:00 close and 16:00 the day's completed session is treated as not yet completed.
2. A GENERATOR of REAL `bars.daily` envelopes (the real adapter, the real normaliser), one per §4.6 row: the store
   read (`bars_sqlite.get_bars_before`) is the only thing faked, and it honours `to_key` and the window as the
   store does; the clock and fetched_at are frozen at one instant. Written to
   app/src/agent/__fixtures__/program/md2/bars-scenarios.json for app/src/agent/qa/md2Bars.test.jsx.

Regenerate:  C:\\UCT\\agent\\.venv\\Scripts\\python.exe -m tests.test_uct_agent_qa_md2_bars --write
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from api.services import bars_fetch, bars_sqlite
from api.services.uct_agent.marketdata import bars_daily as bd
from api.services.uct_agent.marketdata import envelope as env

ET = ZoneInfo("America/New_York")
REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "app" / "src" / "agent" / "__fixtures__" / "program" / "md2" / "bars-scenarios.json"
REAL_LAST_CLOSED = bars_fetch._last_closed_session_yyyymmdd
REAL_UTC_ISO = env.utc_iso


def et(y, m, d, hh=12, mm=0) -> datetime:
    return datetime(y, m, d, hh, mm, tzinfo=ET)


# ── 1. the last completed session ───────────────────────────────────────────────────────────────────────────
LAST = [
    ("Fri 15:59: Friday not complete yet", et(2026, 10, 30, 15, 59), 20261029),
    ("Fri 16:00: Friday complete", et(2026, 10, 30, 16, 0), 20261030),
    ("Saturday", et(2026, 10, 31), 20261030),
    ("Monday 10:00", et(2026, 11, 2, 10, 0), 20261030),
    ("Thanksgiving noon (holiday)", et(2026, 11, 26), 20261125),
    ("half day 12:59 (before its 13:00 close)", et(2026, 11, 27, 12, 59), 20261125),
    ("half day 16:00", et(2026, 11, 27, 16, 0), 20261127),
]


@pytest.mark.parametrize("label,now,want", LAST, ids=[x[0] for x in LAST])
def test_last_completed_session_from_a_frozen_clock(label, now, want):
    assert REAL_LAST_CLOSED(now=now) == want, label


def test_F23_OPEN_PIN_on_a_half_day_the_session_completed_at_13_00_is_not_completed_until_16_00():
    """F-23: `_last_closed_session_yyyymmdd` (bars_fetch, shared product code; the client mirrors it) uses a fixed
    16:00 threshold. On 2026-11-27 the session closes at 13:00 (`_session_close_minutes` = 780), so from 13:00 to
    16:00 stock.dailyBars calls Wed Nov 25 "its last completed session" and drops the completed Nov 27 bar.
    Owner: agent-md for the adapter (`bars_daily._last_completed_at_or_before` can apply the close minutes); the
    helper itself is product-wide, so route via agent-lead. STRICT pin: fails when 14:00 answers 20261127."""
    assert bars_fetch._session_close_minutes(20261127) == 13 * 60, "non-vacuity: 2026-11-27 is a half day"
    assert REAL_LAST_CLOSED(now=et(2026, 11, 27, 14, 0)) == 20261125


# ── 2. real adapter envelopes ───────────────────────────────────────────────────────────────────────────────
def sessions_ending(last_ymd: int, n: int) -> list[int]:
    """n real NYSE sessions ending at last_ymd (the product's own calendar)."""
    d = datetime.strptime(str(last_ymd), "%Y%m%d")
    out = []
    while len(out) < n:
        ymd = int(d.strftime("%Y%m%d"))
        if d.weekday() < 5 and not bars_fetch._is_nyse_holiday(ymd):
            out.append(ymd)
        d -= timedelta(days=1)
    return out[::-1]


def store_rows(days: list[int], closes: list[float], spread: float = 3.0) -> list[tuple]:
    """(ts, o, h, l, c, v): highs and lows deliberately NOT equal to closes (the range must use them)."""
    return [(d, c - 0.5, c + spread, c - spread, c, 1_000_000 + i) for i, (d, c) in enumerate(zip(days, closes))]


def frozen_read(monkeypatch, now: datetime, rows: list[tuple], params: dict) -> dict:
    monkeypatch.setattr(bars_fetch, "_last_closed_session_yyyymmdd", lambda now_=None, **kw: REAL_LAST_CLOSED(now=kw.get("now") or now_ or now))
    monkeypatch.setattr(env, "utc_iso", lambda dt=None: REAL_UTC_ISO(dt or now))

    def get_bars_before(ticker, tf, n, to_key):
        held = [r for r in rows if r[0] <= to_key]
        return held[-n:]
    monkeypatch.setattr(bars_sqlite, "get_bars_before", get_bars_before)
    out = bd.read_bars_daily(params, {})
    assert env.validate_envelope(out) == [], env.validate_envelope(out)
    return out


def scenarios(monkeypatch) -> dict:
    MON = et(2026, 11, 2, 10, 0)               # last completed session: Fri 2026-10-30
    S = {}

    def add(name, row, now, rows, params, args):
        S[name] = {"row": row, "now_et": now.isoformat(), "args": args,
                   "envelope": frozen_read(monkeypatch, now, rows, params)}
        monkeypatch.undo()
    d2 = sessions_ending(20261030, 2) + [20261102]                           # + TODAY's developing bar in the store
    add("last_close", "lastClose", MON, store_rows(d2, [140.0, 142.10, 999.0]), {"symbol": "AAPL", "bars": 2},
        {"symbol": "AAPL", "measure": "lastClose"})
    d6 = sessions_ending(20261030, 6)
    add("change_5", "change, 5 sessions", MON, store_rows(d6, [100, 102, 104, 106, 108, 110]), {"symbol": "NVDA", "bars": 6},
        {"symbol": "NVDA", "measure": "change", "sessions": 5})
    d252 = sessions_ending(20261030, 252)
    closes = [100 + (i % 37) for i in range(252)]
    rows252 = store_rows(d252, closes)
    rows252[100] = (rows252[100][0], 130.0, 175.25, 129.0, 131.0, 5)         # the 52w HIGH is a bar's high, not a close
    rows252[200] = (rows252[200][0], 99.0, 101.0, 90.5, 98.0, 5)             # the 52w LOW is a bar's low (an 8% dip: the
    #   real normaliser drops a 37% spike as a garbage bar, which is the store doing its job)
    add("range_52w", "range52w", MON, rows252, {"symbol": "NVDA", "bars": 252}, {"symbol": "NVDA", "measure": "range52w"})
    stale_days = sessions_ending(20261028, 2)
    add("stale_last_close", "stale store", MON, store_rows(stale_days, [140.0, 141.0]), {"symbol": "NVDA", "bars": 2},
        {"symbol": "NVDA", "measure": "lastClose"})
    d3 = sessions_ending(20261030, 3)
    add("partial_change", "partial: 2 of 10 sessions", MON, store_rows(d3, [100, 101, 103]), {"symbol": "NVDA", "bars": 11},
        {"symbol": "NVDA", "measure": "change", "sessions": 10})
    d40 = sessions_ending(20261030, 40)
    add("partial_range", "partial: 40 sessions for 52 weeks", MON, store_rows(d40, [100 + i for i in range(40)]),
        {"symbol": "NVDA", "bars": 252}, {"symbol": "NVDA", "measure": "range52w"})
    add("single_bar_change", "a single bar gives no change", MON, store_rows(sessions_ending(20261030, 1), [100.0]),
        {"symbol": "NVDA", "bars": 6}, {"symbol": "NVDA", "measure": "change", "sessions": 5})
    add("unavailable", "no bars held", MON, [], {"symbol": "NVDA", "bars": 2}, {"symbol": "NVDA", "measure": "lastClose"})
    monkeypatch.setattr(env, "utc_iso", lambda dt=None: REAL_UTC_ISO(dt or MON))        # the same frozen instant
    S["refused"] = {"row": "refused (a gateway note carrying a number)", "now_et": MON.isoformat(),
                    "args": {"symbol": "NVDA", "measure": "lastClose"},
                    "envelope": env.refused("bars.daily", {"symbol": "NVDA", "bars": 2}, "this turn already made 8 data reads")}
    monkeypatch.undo()
    return S


def scenarios_text(monkeypatch) -> str:
    return json.dumps({"about": "generated by tests/test_uct_agent_qa_md2_bars.py from the REAL bars.daily adapter",
                       "contract": "MD-1 v1.5 §4.6", "scenarios": scenarios(monkeypatch)}, indent=1, sort_keys=True) + "\n"


def test_every_scenario_is_in_the_state_it_claims(monkeypatch):
    S = scenarios(monkeypatch)
    lc = S["last_close"]["envelope"]
    assert [b["date"] for b in lc["data"]["bars"]] == ["2026-10-29", "2026-10-30"], "TODAY's developing bar is excluded"
    assert lc["status"] == "ok" and not lc["stale"] and lc["data"]["latest_completed_session"] == "2026-10-30"
    assert S["stale_last_close"]["envelope"]["stale"] is True
    assert S["partial_change"]["envelope"]["status"] == "partial" and S["partial_range"]["envelope"]["status"] == "partial"
    assert S["unavailable"]["envelope"]["status"] == "unavailable"
    r = S["range_52w"]["envelope"]["data"]["bars"]
    assert max(b["high"] for b in r) == 175.25 and min(b["low"] for b in r) == 90.5
    assert max(b["close"] for b in r) < 175.25 and min(b["close"] for b in r) > 90.5, "high/low differ from closes"
    for name, s in S.items():
        assert s["envelope"]["fetched_at"] == REAL_UTC_ISO(datetime.fromisoformat(s["now_et"])), name


def test_the_bars_scenario_fixtures_are_current(monkeypatch):
    want = scenarios_text(monkeypatch)
    assert OUT.exists(), "generate: python -m tests.test_uct_agent_qa_md2_bars --write"
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
