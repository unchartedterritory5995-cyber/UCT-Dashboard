"""Bank v2 (scripts/study/bank_v2): the drafting rules added on top of the last pass, and the Yahoo window check."""
from __future__ import annotations

import json
import sqlite3
import types

import pytest

from scripts.study.bank_v2 import draft_pass, second_source


# ---------------------------------------------------------------- second_source


def _bars_db(tmp_path, sym="ABC", n=150, start=20200101, price=10.0):
    db = tmp_path / "bars.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE ohlcv (ticker TEXT, tf TEXT, ts INTEGER, o REAL, h REAL, l REAL, c REAL, v INTEGER, "
                "PRIMARY KEY (ticker, tf, ts))")
    import datetime as dt
    d = dt.date(int(str(start)[:4]), int(str(start)[4:6]), int(str(start)[6:]))
    days = []
    while len(days) < n:
        if d.weekday() < 5:
            days.append(d)
        d += dt.timedelta(days=1)
    for i, day in enumerate(days):
        c = price + i * 0.1
        con.execute("INSERT INTO ohlcv VALUES (?,?,?,?,?,?,?,?)", (sym, "D", int(day.strftime("%Y%m%d")), c, c, c, c, 1000))
    con.commit(); con.close()
    return str(db), [x.isoformat() for x in days]


def test_window_passes_when_yahoo_agrees(tmp_path, monkeypatch):
    db, days = _bars_db(tmp_path)
    asof = days[125]
    ours = second_source.window_closes(db, "ABC", asof)
    assert len(ours) == 140 and max(ours) > asof  # 120 back including the last bar, 20 forward
    monkeypatch.setattr(second_source, "yahoo_closes", lambda s, a, b: dict(ours))
    monkeypatch.setattr(second_source.time, "sleep", lambda s: None)
    res = second_source.check("ABC", asof, db, {})
    assert res["ok"] and res["median_close_diff_pct"] == 0.0 and res["cover_pct"] == 100.0


def test_window_refused_when_closes_disagree_or_yahoo_is_empty(tmp_path, monkeypatch):
    db, days = _bars_db(tmp_path)
    asof = days[125]
    ours = second_source.window_closes(db, "ABC", asof)
    monkeypatch.setattr(second_source.time, "sleep", lambda s: None)
    monkeypatch.setattr(second_source, "yahoo_closes", lambda s, a, b: {d: c * 1.05 for d, c in ours.items()})
    res = second_source.check("ABC", asof, db, {})
    assert not res["ok"] and "differ" in res["why"]
    monkeypatch.setattr(second_source, "yahoo_closes", lambda s, a, b: {})
    res = second_source.check("ABC", asof, db, {})
    assert not res["ok"] and res["why"] == "Yahoo has no history for this ticker then"


def test_window_check_reads_the_cache_first(tmp_path, monkeypatch):
    def boom(*a):
        raise AssertionError("asked Yahoo for a cached window")
    monkeypatch.setattr(second_source, "yahoo_closes", boom)
    cache = {"ABC|2020-06-01": {"ok": True}}
    assert second_source.check("ABC", "2020-06-01", "unused.db", cache) == {"ok": True}


# ---------------------------------------------------------------- draft_pass


def _pick(sym, t, **facts):
    return {"sym": sym, "t": t, "close": 10.0, "score": 12, "facts": dict(facts), "fwd": {}, "ctx": {"market": "uptrend"},
            "out": {"culm_pct": 10.0}, "dv": 5e8, "sector": facts.pop("_sector", "Technology"), "liq_rank": 50,
            "liq_universe": 1500}


@pytest.fixture
def run(tmp_path, monkeypatch):
    examples = tmp_path / "setup_examples.json"
    examples.write_text(json.dumps({"examples": []}), encoding="utf-8")
    monkeypatch.setattr(draft_pass, "EXAMPLES", examples)
    stub = types.SimpleNamespace(earnings_dates=lambda sym, cache: ["2001-01-01"], near_earnings=lambda dates, asof: [])
    monkeypatch.setattr(draft_pass, "_last_pass", lambda: stub)

    def go(picks: dict, *extra):
        p = tmp_path / "picks.json"
        p.write_text(json.dumps(picks), encoding="utf-8")
        assert draft_pass.main(["--picks", str(p), "--cache", str(tmp_path / "earn.json"), "--write", *extra]) == 0
        return json.loads(examples.read_text(encoding="utf-8"))["examples"]
    return go


def test_one_chart_per_date_for_every_setup(run):
    k = dict(setup_score=9, gap_pct=2.0, day_pct=5.0)
    out = run({"setup.family3.kicker": {"textbook": [_pick("AAA", 20210128, **k), _pick("BBB", 20210128, **k),
                                                      _pick("CCC", 20210301, **k)]}})
    assert [(e["sym"], e["asof"]) for e in out] == [("AAA", "2021-01-28"), ("CCC", "2021-03-01")]


def test_an_etf_is_never_drafted(run):
    etf = _pick("XLK", 20150302, setup_score=12, day_pct=6.0, _sector="ETF")
    out = run({"setup.family4.oops": {"textbook": [etf, _pick("MSFT", 20150303, setup_score=12)]}})
    assert [e["sym"] for e in out] == ["MSFT"]
    assert out[0]["facts"]["known_name"] is True  # MSFT is on the finders' candidate list


def test_the_lesson_lines_find_their_facts(run):
    oops = _pick("OOO", 20100105, setup_score=12, pullback_from_20d_high_pct=-7.4, above_200=False,
                 open_vs_prior_low_pct=-0.6, day_pct=3.1, variant="scanner")
    lp = _pick("LLL", 20100106, correction_pct=-26.9)
    out = run({"setup.family4.oops": {"textbook": [oops]}, "setup.family1.launchpad": {"textbook": [lp]}})
    by = {e["setup"]: e["facts"] for e in out}
    assert by["Oops Reversal"]["pullback_pct"] == 7.4
    assert by["Launchpad"]["correction_abs_pct"] == 26.9
    assert by["Oops Reversal"]["context"]["era"] == "2010-14"
    # facts.outcome is the Study word for a resolved trade, printed as text on the review screen: never a dict here
    assert "outcome" not in by["Oops Reversal"] and by["Oops Reversal"]["culmination"]["culm_pct"] == 10.0
    # the finders' own known-name test, not a blanket False
    assert by["Oops Reversal"]["known_name"] is False

    from scripts.study.gen_setup_examples import fact_line
    line = fact_line("Oops Reversal", {"facts": dict(by["Oops Reversal"], close_pos_pct=90)})
    assert "under its 200-day" in line and "None" not in line


def test_a_takeover_pin_is_named(tmp_path):
    db, days = _bars_db(tmp_path, n=150)
    # the fixture's closes climb 0.1 a day from 10: a 1% daily move, nothing like a pin
    res = second_source.after_signal(db, "ABC", days[100])
    assert res["sessions"] == 20 and not res["pinned"]
    con = sqlite3.connect(db)
    for d in days[102:122]:  # the 20 sessions after the signal day, days[101]
        con.execute("UPDATE ohlcv SET o=20, h=20.05, l=19.95, c=20 WHERE ticker='ABC' AND ts=?", (int(d.replace("-", "")),))
    con.commit(); con.close()
    res = second_source.after_signal(db, "ABC", days[101])
    assert res["pinned"] and res["range_pct"] < 1


# ---------------------------------------------------------------- gen_chartiq

from scripts.study.bank_v2 import gen_chartiq as G  # noqa: E402


def test_pick_spreads_stocks_dates_and_eras():
    pool = [{"sym": s, "t": t, "name": "Wedge pop"} for s in ("AAA", "BBB") for t in
            (19970102, 19980102, 20010102, 20060102, 20110102, 20160102, 20210102)]
    pool += [{"sym": "CCC", "t": 20210102, "name": "Wedge pop"}]      # same date as a BBB/AAA pick
    got = G.pick(pool, 50, {})
    per_sym = {s: sum(1 for r in got if r["sym"] == s) for s in ("AAA", "BBB", "CCC")}
    assert max(per_sym.values()) <= 2
    assert len({r["t"] for r in got}) == len(got)                      # one per date
    assert len({G.era_of(r["t"]) for r in got}) == len(got)            # never two in one era here


def test_choices_hold_the_answer_and_never_a_fired_event():
    ev, fired = "UnR", {"UnR", "Hammer at support"}
    others = [x for x in G.CONFUSE[ev] + [e for e in G.EVENT_DEF if e not in G.CONFUSE[ev]] if x != ev and x not in fired]
    ch = G.order_choices(ev, others, ("AAA", 20200102, ev))
    assert ev in ch and len(ch) == 4 and "Hammer at support" not in ch
    assert "Kicker" not in G.EVENT_DEF and "Oops reversal" not in G.EVENT_DEF   # the owner's own rulings own these


def test_every_cycle_stage_has_a_rule_and_a_next_line():
    assert set(G.CYCLE_DEF) == set(G.CYCLE_ORDER) and len(G.CYCLE_ORDER) == 6
    for st in G.CYCLE_ORDER:
        assert G.next_line(st)[0].isupper()




def test_every_brain_quote_is_word_for_word_in_the_brain():
    q = G.brain_quotes()
    assert set(q) == set(G.BRAIN)          # a quote that drifts from its passage stops the build
    assert all(set(G.CYCLE_DEF) - {'x'} >= {n} or n in G.EVENT_DEF for n in q)
    assert not any('framework' in v['quote'].lower() for v in q.values())   # the voice rules ban the word


# ---------------------------------------------------------------- pod_coverage

from scripts.study.bank_v2.pod_coverage import PodCoverage  # noqa: E402


def test_pod_coverage_refuses_what_the_pod_cannot_draw(tmp_path):
    db, days = _bars_db(tmp_path, n=200)
    k = lambda d: int(d.replace("-", ""))
    span = tmp_path / "span.json"

    def cov(first, last, rows):
        span.write_text(json.dumps({"span": {"ABC": [first, last, rows]}}), encoding="utf-8")
        return PodCoverage(db, span)
    asof = days[150]
    assert cov(k(days[0]), k(days[-1]), 200).covered("ABC", asof) == (True, "")
    ok, why = cov(k(days[100]), k(days[-1]), 100).covered("ABC", asof)          # history starts inside the window
    assert not ok and "starts" in why
    ok, why = cov(k(days[0]), k(days[160]), 161).covered("ABC", asof)           # ends inside the forward strip
    assert not ok and "ends" in why
    ok, why = cov(k(days[0]), k(days[-1]), 150).covered("ABC", asof)            # a quarter of the rows missing
    assert not ok and "gaps" in why
    assert not cov(k(days[0]), k(days[-1]), 200).covered("XYZ", asof)[0]       # a ticker the pod does not hold
    refused = tmp_path / "refused.json"
    refused.write_text(json.dumps([["chart.events", "si_x", "ABC", asof, 120, 20]]), encoding="utf-8")
    span.write_text(json.dumps({"span": {"ABC": [k(days[0]), k(days[-1]), 200]}}), encoding="utf-8")
    ok, why = PodCoverage(db, span, refused_files=(refused,)).covered("ABC", asof)   # measured wrong on the pod: never
    assert not ok and "measured" in why


# ---------------------------------------------------------------- gen_lines

from scripts.study.bank_v2 import gen_lines as GL  # noqa: E402


def test_line_support_words_and_swing_points():
    assert GL.describe("Recent hold (3x)") == "a recent hold, a level price held 3 times"
    assert GL.describe("Base breakout (support)").startswith("the top of the base")
    bars = [{"l": l, "h": l + 1} for l in (10, 9, 8, 7, 8, 9, 10, 11, 12)]
    assert 7 in GL.swings(bars)                                   # the V's low is a turn


def test_pick_lines_finds_the_support_and_two_decoys_where_price_never_turned():
    # 120 bars rising from 50 to 60 with one dip to 54 at bar 60: the dip low is the only swing low
    bars = []
    for k in range(120):
        c = 50 + k / 12 if k != 60 else 54.0
        bars.append({"t": f"d{k}", "o": c, "h": c + 0.3, "l": c - 0.3 if k != 60 else 53.7, "c": c})
    res = {"bars": bars, "clean": [{"kind": "hline", "ptype": "Recent hold (2x) · note", "price": 57.0}]}
    s, decoys, close, crossed = GL.pick_lines(res)
    assert s[0] == "Recent hold (2x)" and s[1] == 57.0
    assert len(decoys) == 2 and abs(decoys[0] / decoys[1] - 1) >= GL.SPREAD
    turns = GL.swings(bars)
    assert all(all(abs(t / d - 1) > GL.TURN_GAP for t in turns) for d in decoys)
    assert all(abs(d / 57.0 - 1) >= GL.SPREAD for d in decoys)
