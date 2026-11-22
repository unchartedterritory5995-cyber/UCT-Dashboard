"""Study -- intraday course charts (courses_lib intraday spec, check_course_charts intraday, fill_course_intraday).

An intraday chart names `tf` 5/15/30/60 and `asof` 'YYYY-MM-DD HH:MM' New York (the START of its last visible bar on the
regular session's grid). The bank passes the server that bar's unix time; the pod's fill fetches what bars.db lacks,
keeps the regular session, runs the same checks as every daily chart and stores only a chart that passes.
"""
from __future__ import annotations

import datetime as dt
import json
import sqlite3

import pytest

from scripts.study import check_course_charts as ccc
from scripts.study import courses_lib as cl
from scripts.study import fill_course_intraday as fci


def test_an_intraday_asof_is_a_regular_session_bar_start():
    assert cl.intraday_asof_problem("2026-09-15 10:00", "5") is None
    assert cl.intraday_asof_problem("2026-09-15 10:30", "60") is None
    assert "regular session" in cl.intraday_asof_problem("2026-09-15 09:00", "5")
    assert "regular session" in cl.intraday_asof_problem("2026-09-15 16:00", "5")
    assert "start a 30-minute bar" in cl.intraday_asof_problem("2026-09-15 10:05", "30")
    assert "HH:MM" in cl.intraday_asof_problem("2026-09-15", "5")
    # New York time, daylight saving honoured: 09:30 EDT is 13:30 UTC, 09:30 EST is 14:30 UTC
    assert cl.intraday_key("2026-09-15 09:30") == int(dt.datetime(2026, 9, 15, 13, 30, tzinfo=dt.timezone.utc).timestamp())
    assert cl.intraday_key("2026-12-15 09:30") == int(dt.datetime(2026, 12, 15, 14, 30, tzinfo=dt.timezone.utc).timestamp())


def _q(chart):
    return {"key": "q01", "format": "mcq", "skill": "setup.orb", "rung": 1, "q": "Buy the break at 50.20 with the stop at 49.80?", "choices": ["Yes", "No", "Wait", "Skip"],
            "answer": "Yes", "why": "x", "lesson_line": "y", "chart": chart}


def test_the_bank_carries_the_bar_s_exact_time_and_the_validator_names_a_bad_one():
    chart = {"sym": "ABC", "tf": "5", "asof": "2026-09-15 10:00", "window": 78, "forward": 40,
             "trade": {"entry": 50.2, "stop": 49.8}}
    q = _q(chart)
    assert not [p for p in cl.question_problems(q, unit={}, facts={}, sources={}, skills={"setup.orb"}) if "chart" in p]
    bad = _q(dict(chart, asof="2026-09-15 10:02"))
    assert any("start a 5-minute bar" in p for p in cl.question_problems(bad, unit={}, facts={}, sources={}, skills={"setup.orb"}))
    doc = {"unit": "SET.32", "track": "SET", "questions": [q], "verify": {"q01": {"status": "pass"}}}
    it = next(x for x in cl.build_items(doc) if x["_key"] == "q01")
    key = cl.intraday_key("2026-09-15 10:00")
    assert it["bars"] == {"sym": "ABC", "tf": "5", "asof": "2026-09-15", "asof_key": key, "forward_to_key": key + 7 * 86400, "rth": True,
                          "window": 78 + cl.INTRADAY_WARMUP, "forward": 40}
    assert it["prompt_json"]["chart"] == {"window_bars": 78 + cl.INTRADAY_WARMUP, "visible_bars": 78, "tf": "5",
                                          "forward_bars": 40, "hide_ticker": True}
    tr = it["reveal_json"]["trade"]
    assert tr["entry_note"] == "the fill on the chart's last bar"
    # the review counts bars from the one after the fill (a fill at the bar's close comes after its high)
    assert tr["enters_intraday"] is False and tr["unit"] == "bar"
    assert it["asof"] == "2026-09-15"


def _bars_db(tmp_path, rows):
    p = tmp_path / "bars.db"
    c = sqlite3.connect(p)
    c.execute("CREATE TABLE ohlcv (ticker TEXT, tf TEXT, ts INTEGER, o REAL, h REAL, l REAL, c REAL, v REAL)")
    c.executemany("INSERT INTO ohlcv VALUES ('ABC','5',?,?,?,?,?,?)", rows)
    c.commit()
    return p


def _day_rows(day: str, base: float = 50.0):
    """A full 5-minute regular session plus two pre-market bars (the provider returns those too)."""
    t0 = cl.intraday_key(f"{day} 09:30")
    rows = [(t0 - 600, base, base, base, base, 10), (t0 - 300, base, base, base, base, 10)]
    for i in range(78):
        p = base + i * 0.01
        rows.append((t0 + i * 300, p, p + 0.05, p - 0.05, p + 0.01, 1000))
    return rows


def test_the_checker_reads_an_intraday_chart_and_names_a_bar_that_did_not_trade(tmp_path):
    rows = _day_rows("2026-09-14") + _day_rows("2026-09-15", 51) + _day_rows("2026-09-16", 52)
    db = sqlite3.connect(_bars_db(tmp_path, rows))
    asof = "2026-09-15 10:00"
    k = cl.intraday_key(asof)
    bar = next(r for r in rows if r[0] == k)
    ok = {"sym": "ABC", "tf": "5", "asof": asof, "window": 40, "forward": 30,
          "trade": {"entry": bar[2] - 0.01, "stop": round(bar[3] - 0.02, 2)}}
    r = ccc.check_question(db, "SET.32", {"key": "q01", "chart": ok})
    assert r["problems"] == [] and any("replayed bars" in n for n in r["notes"])
    off = dict(ok, trade={"entry": bar[2] + 1, "stop": bar[3] - 0.02})
    assert any("did not trade that bar" in p for p in ccc.check_question(db, "SET.32", {"key": "q01", "chart": off})["problems"])
    # a chart this copy does not hold is left for the pod, never passed as checked
    gone = dict(ok, sym="ZZZ")
    r = ccc.check_question(db, "SET.32", {"key": "q01", "chart": gone})
    assert r.get("intraday_unchecked") and r["problems"] == []


def test_the_fill_keeps_the_regular_session_and_cuts_at_the_decision_bar():
    rows = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in _day_rows("2026-09-15") + _day_rows("2026-09-16", 51)]
    assert len(fci.regular_session(rows)) == 156                      # the four pre-market bars are dropped
    k = cl.intraday_key("2026-09-15 10:00")
    ch = {"id": "x", "sym": "ABC", "tf": "5", "asof_key": k, "window": 20, "forward": 30, "trade": None}
    vis, fwd = fci.cut(ch, rows)
    assert vis[-1]["t"] == k and len(vis) == 7                        # 09:30 .. 10:00 is all the day holds so far
    assert fwd[0]["t"] == k + 300 and len(fwd) == 30
    frm, to = fci.fetch_span(ch)
    assert frm < "2026-09-15" < to


def test_the_fill_finds_the_bank_s_intraday_charts(tmp_path):
    bank = tmp_path / "bank"
    bank.mkdir()
    k = cl.intraday_key("2026-09-15 10:00")
    items = [{"id": "si_a", "bars": {"sym": "ABC", "tf": "5", "asof": "2026-09-15", "asof_key": k, "forward_to_key": k + 1,
                                     "window": 78 + cl.INTRADAY_WARMUP, "forward": 40},
              "reveal_json": {"trade": {"entry": 50.2, "stop": 49.8, "direction": "bullish"}}},
             {"id": "si_b", "bars": {"sym": "XYZ", "tf": "D", "asof": "2026-09-15", "window": 320, "forward": 20}}]
    (bank / "course.set.json").write_text(json.dumps(items), encoding="utf-8")
    got = fci.intraday_charts(bank)
    assert got == [{"id": "si_a", "kind": "intraday", "sym": "ABC", "tf": "5", "asof_key": k, "window": 78, "forward": 40,
                    "trade": {"entry": 50.2, "stop": 49.8, "direction": "bullish"}}]


def test_the_fill_refuses_c_data_off_the_pod(monkeypatch):
    import os
    if os.name != "nt":
        pytest.skip("the refusal is the Windows box's guard")
    monkeypatch.delenv("STUDY_DB_PATH", raising=False)
    assert fci.main(["--dry-run"]) == 2


def test_the_server_resolves_an_intraday_spec_on_the_regular_session_only(monkeypatch):
    """bars.db keeps 04:00-20:00; an `rth` spec (every intraday course chart) gets 09:30-16:00 bars, cut at the decision
    bar, the same window the pod's fill stores."""
    from api.routers import study as router
    rows = _day_rows("2026-09-15") + _day_rows("2026-09-16", 51)
    k = cl.intraday_key("2026-09-15 10:00")

    def fake_before(sym, tf, n, to_key):
        got = [r for r in rows if r[0] <= to_key]
        return got[-n:]
    import api.services.bars_sqlite as bs
    monkeypatch.setattr(bs, "get_bars_before", fake_before)
    res = router.resolve_bars({"sym": "ABC", "tf": "5", "asof_key": k, "forward_to_key": k + 7 * 86400, "rth": True,
                               "window": 20, "forward": 30})
    assert res["ok"] and res["visible"][-1]["t"] == k
    assert all(router._regular_session(b["t"]) for b in res["visible"] + res["forward"])
    assert len(res["visible"]) == 7 and len(res["forward"]) == 30     # 09:30..10:00, then the rest of the day
    # without the flag the extended session leaks in (the pre-market bars ahead of 09:30)
    raw = router.resolve_bars({"sym": "ABC", "tf": "5", "asof_key": k, "forward_to_key": k + 7 * 86400, "window": 20, "forward": 30})
    assert not all(router._regular_session(b["t"]) for b in raw["visible"])
