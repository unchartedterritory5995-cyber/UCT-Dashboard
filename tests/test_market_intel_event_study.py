"""Slice 2 event studies — synthetic, deterministic tests (no network, no model, no real data).

Covers: threshold levels and crossings, consecutive qualifying sessions (first vs all), runs broken by
missing breadth, overlapping windows (disclosed vs non-overlapping), trading-session vs calendar-month
horizons on the real NYSE calendar, missing prices, incomplete forward windows, coverage clipping,
baseline, entry conventions, refusals, determinism, and the local-result rails.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from api.services.market_intel import event_study as es
from api.services.market_intel import event_study_answer as esa
from tests import market_intel_event_fixtures as fx
from tests.market_intel_event_fixtures import S, close

BREADTH = {"kind": "breadth", "universe": "nasdaq", "metric": "pct_above_50sma"}
HORIZONS = [{"sessions": 5}, {"sessions": 21}, {"months": 3}]


def req(op="below", threshold=10, series=None, transform=None, **kw):
    cond = {"series": series or BREADTH, "op": op, "threshold": threshold}
    if transform is not None:
        cond["transform"] = transform
    out = {"condition": cond, "symbol": "QQQ", "horizons": HORIZONS}
    out.update(kw)
    return out


@pytest.fixture
def world(monkeypatch):
    return fx.install(monkeypatch)


def fwd(i: int, n: int) -> float:
    return close(i + n) / close(i) - 1.0


def hz(res, k):
    return res["horizons"][k]


# ── events: levels, runs, gaps ───────────────────────────────────────────────

def test_first_of_run_events_and_counts(world):
    r = es.run(req())
    assert r["status"] == "ok"
    dates = [e["event_date"] for e in r["events"]]
    # run A starts S[10]; run B S[50]; S[51] == threshold is not below; S[99] and S[101] are separate
    # runs because S[100] has no breadth; run D starts S[240]
    assert dates == [S[10], S[50], S[99], S[101], S[240]]
    c = r["counts"]
    assert c["qualifying_sessions"] == 3 + 1 + 2 + 3 and c["episodes_or_crossings"] == 5
    assert c["condition_gaps"] == 1 and c["events_detected"] == 5 and c["events_used"] == 5


def test_all_qualifying_sessions(world):
    r = es.run(req(episodes="all"))
    assert [e["event_date"] for e in r["events"]] == [S[i] for i in (10, 11, 12, 50, 99, 101, 240, 241, 242)]


def test_above_condition(world, monkeypatch):
    fx.install(monkeypatch, rows=[(d, 95.0 if i in (30, 31) else 50.0) for i, d in enumerate(S)])
    r = es.run(req(op="above", threshold=90))
    assert [e["event_date"] for e in r["events"]] == [S[30]]


def test_crossings_need_both_sessions_present(world, monkeypatch):
    vals = {5: 12.0, 6: 9.0, 7: 9.0, 8: 11.0, 9: 9.0, 20: 12.0, 22: 9.0}   # S[21] missing → no cross at S[22]
    rows = [(d, vals.get(i, 50.0)) for i, d in enumerate(S) if i != 21]
    fx.install(monkeypatch, rows=rows)
    below = es.run(req(op="cross_below"))
    assert [e["event_date"] for e in below["events"]] == [S[6], S[9]]
    above = es.run(req(op="cross_above"))
    # S[8] (9→11), S[10] (9→50), S[23] (9→50); S[5] is 50→12 (no cross); S[22] has no previous session
    assert [e["event_date"] for e in above["events"]] == [S[8], S[10], S[23]]


def test_cross_from_exactly_the_threshold_counts(world, monkeypatch):
    fx.install(monkeypatch, rows=[(d, {3: 10.0, 4: 9.0}.get(i, 50.0)) for i, d in enumerate(S)])
    r = es.run(req(op="cross_below"))
    assert S[4] in [e["event_date"] for e in r["events"]]                    # 10 (≥10) → 9 (<10)


# ── forward returns: sessions, months, missing, incomplete ──────────────────

def test_session_horizons_are_exact(world):
    r = es.run(req())
    e0 = r["events"][0]                                          # S[10]
    assert e0["entry_date"] == S[10] and e0["entry_close"] == close(10)
    ret5 = next(x for x in e0["returns"] if x["horizon"] == {"sessions": 5})
    assert ret5["exit_date"] == S[15] and ret5["return"] == pytest.approx(fwd(10, 5))


def test_month_horizon_uses_the_calendar_not_a_session_count(world):
    r = es.run(req())
    e0 = r["events"][0]                                          # S[10] = 2024-01-17
    assert S[10] == "2024-01-17"
    m3 = next(x for x in e0["returns"] if x["horizon"] == {"months": 3})
    assert m3["exit_date"] == "2024-04-17"                        # a Wednesday trading day
    j = S.index("2024-04-17")
    assert m3["return"] == pytest.approx(close(j) / close(10) - 1)

    # the two units are computed by their own definitions, never converted into each other
    r1 = es.run(req(horizons=[{"sessions": 21}, {"months": 1}]))
    e = r1["events"][0]["returns"]
    assert e[0]["exit_date"] == S[10 + 21]                                    # 21st session after entry
    assert e[1]["exit_date"] == "2024-02-20"                                  # 02-17 is Sat, 02-19 Presidents Day


def test_month_target_on_a_holiday_rolls_to_the_next_session(world, monkeypatch):
    # entry 2024-03-29 is Good Friday (closed), so use 2024-02-29 + 1 month → 2024-03-29 → next session 04-01
    i = S.index("2024-02-29")
    fx.install(monkeypatch, rows=[(d, 5.0 if k == i else 50.0) for k, d in enumerate(S)])
    r = es.run(req(horizons=[{"months": 1}]))
    out = r["events"][0]["returns"][0]
    assert out["exit_date"] == "2024-04-01"


def test_missing_exit_price_is_excluded_and_counted(world):
    r = es.run(req(horizons=[{"sessions": 10}]))                  # S[50] + 10 = S[60] has no stored close
    ev = next(e for e in r["events"] if e["event_date"] == S[50])
    assert ev["returns"][0]["outcome"] == "missing" and ev["returns"][0]["return"] is None
    assert hz(r, 0)["missing_price"] == 1


def test_incomplete_windows_are_excluded_and_counted(world):
    r = es.run(req())
    last = r["events"][-1]                                        # S[240]: only 11 sessions remain
    outs = {repr(x["horizon"]): x["outcome"] for x in last["returns"]}
    assert outs == {repr({"sessions": 5}): "ok", repr({"sessions": 21}): "incomplete", repr({"months": 3}): "incomplete"}
    assert hz(r, 1)["incomplete"] == 1 and hz(r, 2)["incomplete"] == 1


def test_stats_are_exact(world):
    r = es.run(req(horizons=[{"sessions": 5}]))
    rets = [fwd(i, 5) for i in (10, 50, 99, 101, 240)]
    h = hz(r, 0)
    assert h["n"] == 5 and h["positive"] == 5 and h["positive_rate"] == 1.0
    assert h["mean"] == pytest.approx(sum(rets) / 5)
    assert h["median"] == pytest.approx(sorted(rets)[2])
    assert h["best"]["event_date"] == S[10] and h["worst"]["event_date"] == S[240]


def test_negative_returns_and_positive_rate(world, monkeypatch):
    bars = [{"t": d, "c": 200.0 - i} for i, d in enumerate(S)]   # a falling market
    fx.install(monkeypatch, bars=bars)
    h = hz(es.run(req(horizons=[{"sessions": 5}])), 0)
    assert h["positive"] == 0 and h["positive_rate"] == 0.0 and h["mean"] < 0


# ── overlap, entry, baseline, coverage ───────────────────────────────────────

def test_overlap_is_disclosed_or_removed(world):
    r = es.run(req(episodes="all", horizons=[{"sessions": 21}]))
    assert r["counts"]["overlapping_events"] > 0
    assert any("not independent" in n for n in r["notes"])
    nr = es.run(req(episodes="all", horizons=[{"sessions": 21}], non_overlapping=True))
    used = [e["entry_date"] for e in nr["events"]]
    for a, b in zip(used, used[1:]):
        assert S.index(b) > S.index(a) + 21 - 0                   # next entry after the previous window closed
    assert nr["counts"]["skipped_overlapping"] > 0 and nr["counts"]["overlapping_events"] == 0


def test_next_close_entry_avoids_look_ahead(world):
    r = es.run(req(entry="next_close", horizons=[{"sessions": 5}]))
    e0 = r["events"][0]
    assert e0["event_date"] == S[10] and e0["entry_date"] == S[11]
    assert e0["returns"][0]["return"] == pytest.approx(fwd(11, 5))


def test_entry_without_a_stored_close_is_excluded(world, monkeypatch):
    fx.install(monkeypatch, bars=fx.price_bars(gaps={10, 60}))
    r = es.run(req())
    assert r["counts"]["no_entry_price"] == 1 and S[10] not in [e["event_date"] for e in r["events"]]


def test_baseline_covers_every_session_in_the_span(world):
    r = es.run(req(horizons=[{"sessions": 5}]))
    b = r["baseline"][0]
    # every session in the span with an entry close and a completed exit with a stored close
    exp = [fwd(i, 5) for i in range(len(S) - 5) if i not in fx.PRICE_GAP and (i + 5) not in fx.PRICE_GAP]
    assert b["n"] == len(exp) and b["mean"] == pytest.approx(sum(exp) / len(exp))


def test_price_history_starting_later_clips_the_study_and_says_so(world, monkeypatch):
    fx.install(monkeypatch, bars=fx.price_bars(first_index=30))
    r = es.run(req())
    assert r["coverage"]["study_start"] == S[30]
    assert S[10] not in [e["event_date"] for e in r["events"]]
    assert any("price history starts" in n for n in r["notes"])


def test_study_window_restriction(world):
    r = es.run(req(start="2024-03-01", end="2024-06-30"))
    assert all("2024-03-01" <= e["event_date"] <= "2024-06-30" for e in r["events"])


def test_no_overlap_between_histories_is_unavailable(world, monkeypatch):
    fx.install(monkeypatch, bars=[{"t": "2030-01-02", "c": 1.0}])
    r = es.run(req())
    assert r["status"] == "unavailable" and r["reason"] == "no_overlap"


def test_small_sample_is_flagged(world):
    assert any("Small sample" in n for n in es.run(req())["notes"])


# ── refusals (validation reads nothing) ──────────────────────────────────────

@pytest.mark.parametrize("bad,reason", [
    ({"series": {**BREADTH, "universe": "uct"}}, "unsupported_universe"),
    ({"series": {**BREADTH, "metric": "breadth_score"}}, "unknown_metric"),
    ({"series": {"kind": "fred", "id": "CPIAUCSL"}}, "unknown_series"),
    ({"series": {"kind": "technical", "symbol": "QQQ", "indicator": "macd", "period": 14}}, "unknown_indicator"),
    ({"series": {"kind": "technical", "symbol": "QQQ", "indicator": "rsi", "period": 1}}, "bad_period"),
    ({"op": "between"}, "bad_condition"),
    ({"threshold": 140}, "bad_threshold"),                                        # % outside 0–100
    ({"threshold": "ten"}, "bad_threshold"),
    ({"symbol": "QQQ; DROP"}, "bad_symbol"),
    ({"symbol": "^GSPC"}, "bad_symbol"),
    ({"horizons": []}, "bad_horizons"),
    ({"horizons": [{"sessions": 0}]}, "bad_horizons"),
    ({"horizons": [{"sessions": 600}]}, "bad_horizons"),
    ({"horizons": [{"months": 25}]}, "bad_horizons"),
    ({"horizons": [{"days": 30}]}, "bad_horizons"),                              # no ambiguous "days"
    ({"horizons": [{"sessions": 5, "months": 1}]}, "bad_horizons"),               # never mixed in one window
    ({"horizons": [{"sessions": True}]}, "bad_horizons"),
    ({"horizons": [{"sessions": k} for k in range(1, 8)]}, "bad_horizons"),
    ({"episodes": "some"}, "bad_request"),
    ({"entry": "open"}, "bad_request"),
    ({"start": "2024-02-30"}, "bad_date"),
    ({"start": "2024-06-01", "end": "2024-01-01"}, "bad_date"),
])
def test_refusals_read_nothing(world, bad, reason):
    r = es.run(req(**bad))
    assert r["status"] == "refused" and r["reason"] == reason, r
    assert world["breadth_calls"] == 0 and world["price_calls"] == 0


def test_missing_breadth_or_price_is_reported_not_invented(world, monkeypatch):
    fx.install(monkeypatch, rows=[])
    assert es.run(req())["status"] == "unavailable"
    fx.install(monkeypatch, bars=[])
    r = es.run(req())
    assert r["status"] == "unavailable" and r["reason"] == "no_price_history"


# ── determinism, answers, rails ──────────────────────────────────────────────

def test_deterministic(world):
    assert es.run(req(episodes="all")) == es.run(req(episodes="all"))


def test_answer_text_states_method_coverage_and_exact_figures(world):
    r = es.run(req())
    a = esa.answer(r)
    assert a["status"] == "ok" and a["table"]["rows"][0]["window"] == "5 trading sessions"
    t = a["text"]
    assert "NASDAQ · % of Stocks Above 50-Day MA" in t
    assert "below 10.0%" in t and "first session of each run" in t and "event-day close" in t
    assert "3 calendar months" in t and "21 trading sessions" in t
    h = hz(r, 0)
    assert f"{h['mean'] * 100:+.2f}%" in t and f"up {h['positive']} of {h['n']}" in t
    assert "not dividend-adjusted" in t and "Past results do not predict" in t


def test_refusal_answer_has_no_figures(world):
    a = esa.answer(es.run(req(series={**BREADTH, "universe": "uct"})))
    assert a["table"] is None and not re.search(r"\d+\.\d+%", a["text"])


def test_breadth_path_reuses_slice1_sealed_series(monkeypatch):
    """Integration through the REAL breadth_reads.sealed_series (Slice 1 synthetic world)."""
    from tests.market_intel_breadth_fixtures import LAST_SEALED, synthetic_breadth_world
    synthetic_breadth_world(monkeypatch)
    monkeypatch.setattr(fx.pr, "_load_bars", lambda sym: [{"t": d, "c": 100.0 + i}
                                                           for i, d in enumerate(fx.trading_days("2026-06-01", LAST_SEALED))])
    r = es.run(req(threshold=79, horizons=[{"sessions": 1}]))
    assert r["status"] == "ok" and r["coverage"]["series_last"] == LAST_SEALED
    assert all(e["event_date"] <= LAST_SEALED for e in r["events"])          # provisional sessions never used


def test_modules_import_no_model_or_network_client():
    root = Path(es.__file__).parent
    forbidden = re.compile(r"^\s*(?:from|import)\s+(anthropic|openai|requests|httpx|urllib|aiohttp)\b"
                           r"|perplexity|voice_tools|_get_anthropic_client", re.M)
    for f in ("event_study.py", "event_study_answer.py", "price_reads.py", "series_adapters.py"):
        assert not forbidden.search((root / f).read_text(encoding="utf-8")), f


def test_price_reads_uses_the_read_only_history_path(monkeypatch):
    """The real `_load_bars`: a pure bars_sqlite read + _fmt_sqlite_bars under suppress_meta_warm."""
    from api.services import bars_fetch, bars_sanitize, bars_sqlite
    seen = {}
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda t, tf, n: seen.setdefault("get", (t, tf, n)) and
                        [(20240102, 1, 1, 1, 10.0, 5)])
    real_fmt = bars_fetch._fmt_sqlite_bars

    def spy_fmt(rows, tf, ticker=None):
        seen["suppressed"] = bars_sanitize._suppress_warm.get()
        return real_fmt(rows, tf, None)
    monkeypatch.setattr(bars_fetch, "_fmt_sqlite_bars", spy_fmt)
    out = fx.pr.daily_closes("qqq")
    assert seen["get"] == ("QQQ", "D", fx.pr.MAX_BARS) and seen["suppressed"] is True
    assert out["status"] == "ok" and out["closes"] == [("2024-01-02", 10.0)]


# ── category independence: a second, non-breadth adapter + point-in-time alignment ──

def test_technical_adapter_uses_existing_indicator_calculations(world, monkeypatch):
    """RSI(14) of QQQ itself, computed by indicator_compute over the same stored closes."""
    from api.services import indicator_compute as ic
    bars = [{"t": d, "c": 100.0 + (i % 20 if i < 120 else 20 - (i % 20)) - (0.5 * i if 60 <= i < 70 else 0)}
            for i, d in enumerate(S)]
    fx.install(monkeypatch, bars=bars)
    tech = {"kind": "technical", "symbol": "QQQ", "indicator": "rsi", "period": 14}
    r = es.run(req(series=tech, threshold=30, horizons=[{"sessions": 5}]))
    assert r["status"] == "ok" and r["series_category"] == "technical" and r["series_label"] == "QQQ RSI(14)"
    rsi = ic.compute_rsi_raw([b["c"] for b in bars], 14)
    expect, prev_q = [], False
    for i, v in enumerate(rsi):
        q = v is not None and v < 30
        if q and not prev_q:
            expect.append(S[i])
        prev_q = q if v is not None else False
    assert [e["event_date"] for e in r["events"]] == expect and expect, "the fixture must produce RSI<30 runs"
    assert world["breadth_calls"] == 0                                    # breadth was never read


def test_pct_from_sma_adapter(world, monkeypatch):
    bars = [{"t": d, "c": 100.0 if i != 30 else 80.0} for i, d in enumerate(S)]
    fx.install(monkeypatch, bars=bars)
    tech = {"kind": "technical", "symbol": "QQQ", "indicator": "pct_from_sma", "period": 10}
    r = es.run(req(series=tech, threshold=-10, horizons=[{"sessions": 1}]))
    assert [e["event_date"] for e in r["events"]] == [S[30]]                # 80 vs SMA10 = 98 → −18.4%
    assert r["events"][0]["condition_value"] == pytest.approx((80 / 98 - 1) * 100)


def test_point_in_time_series_uses_only_published_values(world, monkeypatch):
    """An `as_of` adapter (weekly, dated by PUBLICATION day): a session sees only what was public."""
    from api.services.market_intel import series_adapters as sa
    published = [("2024-01-05", 50.0), ("2024-01-12", 5.0), ("2024-01-19", 50.0), ("2024-02-23", 5.0)]

    def describe(spec):
        return {"kind": "pit_fake", "label": "Fake weekly", "unit": "count", "domain": "signed",
                "category": "test point-in-time"}, None

    def load(spec):
        return {"status": "ok", "alignment": "as_of", "rows": published, "max_staleness_days": 10,
                "coverage": {"first": published[0][0], "last": published[-1][0]}, "source": {"interface": "fake"}}
    monkeypatch.setitem(sa.ADAPTERS, "pit_fake", (describe, load))
    r = es.run(req(series={"kind": "pit_fake"}, threshold=10, horizons=[{"sessions": 1}], episodes="all"))
    dates = [e["event_date"] for e in r["events"]]
    # the 5.0 published Fri 2024-01-12 is known until the next publication (01-19), but it is ONE
    # observation: with episodes=all it is one event on its publication session, not one per session
    assert dates[0] == "2024-01-12" and "2024-01-18" not in dates and "2024-01-19" not in dates
    assert "2024-01-11" not in dates                                       # never before it was public
    # 01-19's 50.0 goes STALE after 10 days (no publication until 02-23): sessions after 01-29 are gaps
    assert r["counts"]["condition_gaps"] > 0
    assert "2024-02-23" in dates
    assert any("point-in-time" in n for n in r["notes"])


def test_cot_adapter_is_point_in_time_through_the_registry(world, monkeypatch):
    """COT large-spec net (CFTC, licence A) via the chart's own registry + cot_observations, dated by
    PUBLIC day. The study never sees a report before its Friday release."""
    from api.services.market_indicators import series as ser
    obs = [  # as-of Tuesdays → public Fridays (the real helper's job; faked here with fixed public days)
        {"t": "2024-01-05", "v": 150000.0, "asof": "2024-01-02"},
        {"t": "2024-01-12", "v": 90000.0, "asof": "2024-01-09"},
        {"t": "2024-01-19", "v": 160000.0, "asof": "2024-01-16"},
        {"t": "2024-01-26", "v": 85000.0, "asof": "2024-01-23"},
    ]
    seen = {}
    monkeypatch.setattr(ser, "cot_observations", lambda row: (seen.setdefault("id", row.id), obs)[1])
    cot = {"kind": "cot", "market": "GC", "group": "large_spec"}
    r = es.run(req(series=cot, threshold=100000, horizons=[{"sessions": 1}], symbol="GLD"))
    assert r["status"] == "ok" and seen["id"] == "COT:GC:LARGE" and r["alignment"] == "as_of"
    assert [e["event_date"] for e in r["events"]] == ["2024-01-12", "2024-01-26"]   # public days, not Tuesdays
    assert "point-in-time" in r["series_category"] or "COT" in r["series_category"]
    assert any("point-in-time" in n for n in r["notes"])


def test_cot_unknown_market_or_group_is_refused_without_reading(world):
    for bad in ({"kind": "cot", "market": "ZZZ", "group": "large_spec"},
                {"kind": "cot", "market": "GC", "group": "swap_dealers"}):
        r = es.run(req(series=bad))
        assert r["status"] == "refused" and r["reason"] == "unknown_series"


def test_cot_public_day_comes_from_the_real_release_calendar(world, monkeypatch):
    """Only the cot.db read is faked; `cot_observations` and `cot_release.available_day` are real."""
    from api.services import cot_service
    raw = [{"date": "2024-01-02", "large_spec_net": 150000, "commercial_net": 0, "small_spec_net": 0, "open_interest": 1},
           {"date": "2024-01-09", "large_spec_net": 90000, "commercial_net": 0, "small_spec_net": 0, "open_interest": 1}]
    monkeypatch.setattr(cot_service, "get_cot_data", lambda sym, weeks=52: raw)
    monkeypatch.setattr("os.path.exists", lambda p: True if p == cot_service.DB_PATH else __import__("os").path.isfile(p))
    cot = {"kind": "cot", "market": "GC", "group": "large_spec"}
    r = es.run(req(series=cot, threshold=100000, horizons=[{"sessions": 1}], symbol="GLD"))
    assert r["status"] == "ok"
    # the as-of Tuesday 2024-01-09 report is public Friday 2024-01-12 (15:30 ET) — never the Tuesday
    assert [e["event_date"] for e in r["events"]] == ["2024-01-12"]


def test_crossing_answer_says_each_crossing(world):
    t = esa.answer(es.run(req(op="cross_below")))["text"]
    assert "each crossing" in t and "first session of each run" not in t


def test_as_of_series_events_only_on_publication_sessions(world, monkeypatch):
    """Adversarial (found by real-data validation): a monthly value carried across the sessions between
    releases is ONE observation. episodes=all must count releases, not every session in between."""
    from api.services.market_intel import series_adapters as sa
    published = [("2024-01-11", -0.1), ("2024-02-13", -0.2), ("2024-03-12", 0.3), ("2024-04-10", -0.1)]

    def describe(spec):
        return {"kind": "m", "label": "Fake monthly", "unit": "econ", "domain": "any", "category": "test"}, None

    def load(spec):
        return {"status": "ok", "alignment": "as_of", "rows": published, "max_staleness_days": 45,
                "coverage": {"first": published[0][0], "last": published[-1][0]}, "source": {"interface": "fake"}}
    monkeypatch.setitem(sa.ADAPTERS, "m", (describe, load))
    every = es.run(req(series={"kind": "m"}, threshold=0, horizons=[{"sessions": 1}], episodes="all"))
    assert [e["event_date"] for e in every["events"]] == ["2024-01-11", "2024-02-13", "2024-04-10"]
    first = es.run(req(series={"kind": "m"}, threshold=0, horizons=[{"sessions": 1}], episodes="first"))
    # Jan and Feb releases are one run of consecutive qualifying RELEASES; March breaks it
    assert [e["event_date"] for e in first["events"]] == ["2024-01-11", "2024-04-10"]
    cross = es.run(req(series={"kind": "m"}, op="cross_above", threshold=0, horizons=[{"sessions": 1}]))
    assert [e["event_date"] for e in cross["events"]] == ["2024-03-12"]


def test_publication_on_a_non_session_day_lands_on_the_next_session(world, monkeypatch):
    from api.services.market_intel import series_adapters as sa
    published = [("2024-03-29", -1.0)]                       # Good Friday: market closed

    def describe(spec):
        return {"kind": "h", "label": "Fake", "unit": "econ", "domain": "any", "category": "test"}, None

    def load(spec):
        return {"status": "ok", "alignment": "as_of", "rows": published, "max_staleness_days": 45,
                "coverage": {"first": published[0][0], "last": published[-1][0]}, "source": {"interface": "fake"}}
    monkeypatch.setitem(sa.ADAPTERS, "h", (describe, load))
    r = es.run(req(series={"kind": "h"}, threshold=0, horizons=[{"sessions": 1}]))
    assert [e["event_date"] for e in r["events"]] == ["2024-04-01"]


# ── economic adapter (fixtures; the econ service's own vintages) ─────────────

def _et_unix(day: str, hhmm: str) -> int:
    from datetime import datetime
    from api.services import session_calendar as sc
    h, m = map(int, hhmm.split(":"))
    return int(datetime.fromisoformat(day).replace(hour=h, minute=m, tzinfo=sc.ET).timestamp())


@pytest.mark.parametrize("day,hhmm,expect", [
    ("2024-01-11", "08:30", "2024-01-11"),     # pre-open release → that session's close knows it
    ("2024-01-11", "16:00", "2024-01-11"),     # at the close: still that session
    ("2024-01-11", "16:30", "2024-01-12"),     # after the close → next session
    ("2024-11-29", "13:30", "2024-12-02"),     # after a 13:00 half-day close → next session
    ("2024-03-29", "08:30", "2024-04-01"),     # Good Friday release → next session
    ("2024-01-13", "10:00", "2024-01-16"),     # Saturday → Tuesday (MLK day Monday)
])
def test_release_time_maps_to_the_first_session_whose_close_knows_it(day, hhmm, expect):
    from api.services.market_intel import series_adapters as sa
    assert sa.session_of(_et_unix(day, hhmm)) == expect


def test_pre_1970_release_times_do_not_crash():
    """Real-data validation found Windows rejecting negative timestamps (CPI history starts 1913)."""
    from api.services.market_intel import series_adapters as sa
    assert sa.session_of(-1_765_000_000) < "1915-01-01"


def test_econ_pit_rows_use_only_what_was_known_and_handle_revisions():
    from api.services.market_intel import series_adapters as sa
    t = lambda d: _et_unix(d, "08:30")  # noqa: E731
    v = [  # [ps, pe, t, v, pit, release_id]
        ["2024-01-01", "2024-01-31", t("2024-02-13"), 3.1, "V", 1],
        ["2024-02-01", "2024-02-29", t("2024-03-12"), 3.2, "V", 2],
        ["2024-01-01", "2024-01-31", t("2024-03-12"), 3.0, "V", 2],   # a revision of an OLDER period
        ["2024-02-01", "2024-02-29", t("2024-03-20"), 3.3, "V", 3],   # a revision of the LATEST period
        ["2024-03-01", "2024-03-31", t("2024-04-10"), 3.5, "L", 4],
    ]
    rows, prof = sa.econ_pit_rows(v)
    assert rows == [("2024-02-13", 3.1), ("2024-03-12", 3.2), ("2024-03-20", 3.3), ("2024-04-10", 3.5)]
    assert prof == {"V": 3, "L": 1}
    safe, prof2 = sa.econ_pit_rows(v, pit_safe_only=True)
    assert safe[-1] == ("2024-03-20", 3.3) and "L" not in prof2


def _econ_world(monkeypatch, vrows, mode="db"):
    from api.services.econ import serving as S, publish as P
    from api.services.market_intel import series_adapters as sa
    monkeypatch.setattr(S, "mode", lambda: mode)
    calls = {"open": 0}

    class _St:
        def close(self): pass

    def fake_open():
        calls["open"] += 1
        return _St()
    monkeypatch.setattr(S, "_open_db", fake_open)
    monkeypatch.setattr(P, "build_vintages_payload", lambda st, sym: {"rows": vrows})
    return calls


def test_econ_study_end_to_end_with_change_transform(world, monkeypatch):
    t = lambda d: _et_unix(d, "08:30")  # noqa: E731
    vrows = [[f"2024-{m:02d}-01", f"2024-{m:02d}-28", t(d), val, "L", m]
             for m, d, val in [(1, "2024-02-13", 3.1), (2, "2024-03-12", 3.2), (3, "2024-04-10", 3.5),
                               (4, "2024-05-15", 3.4), (5, "2024-06-12", 3.3), (6, "2024-07-11", 3.0)]]
    calls = _econ_world(monkeypatch, vrows)
    r = es.run(req(series={"kind": "econ", "symbol": "USCPIYOY"}, op="below", threshold=0, transform="change",
                   horizons=[{"sessions": 1}], episodes="all"))
    assert r["status"] == "ok" and calls["open"] == 1
    assert [e["event_date"] for e in r["events"]] == ["2024-05-15", "2024-06-12", "2024-07-11"]   # each lower release
    assert r["coverage"]["pit_profile"] == {"L": 6}
    assert any("backfilled history" in n for n in r["notes"])
    assert r["series_label"].startswith("Change in ")


def test_econ_production_source_is_refused_without_any_read(world, monkeypatch):
    calls = _econ_world(monkeypatch, [], mode="r2")
    r = es.run(req(series={"kind": "econ", "symbol": "USCPIYOY"}, threshold=3))
    assert r["status"] == "unavailable" and r["reason"] == "econ_source_not_local" and calls["open"] == 0


def test_econ_unservable_series_is_refused(world):
    r = es.run(req(series={"kind": "econ", "symbol": "USRETAIL"}, threshold=0))       # failed-closed in the registry
    assert r["status"] == "refused" and r["reason"] == "unknown_series"


# ── fundamentals adapter: honours the catalog gate; mechanics via the REAL pipeline fixture ──

def test_fundamentals_are_refused_while_the_catalog_says_chart_only(world):
    r = es.run(req(series={"kind": "fundamental", "symbol": "TST", "metric": "revenue_q"}, threshold=0))
    assert r["status"] == "refused" and r["reason"] == "not_condition_eligible"
    assert world["breadth_calls"] == 0 and world["price_calls"] == 0


def test_fundamentals_point_in_time_through_the_real_pipeline(world, monkeypatch, tmp_path):
    """The fundamentals team's own offline fixture: a synthetic company (TST) ingested and derived by
    the REAL bulk pipeline into a local pit.db, served by the REAL serving.series_response (db mode).
    Only the catalog's eligibility flag is lifted, inside this test."""
    import dataclasses
    from api.services.fundamentals_pit import catalog as C, serving as F
    from tests.fundamentals_pit.test_pipeline import _run
    _run(tmp_path)
    monkeypatch.setenv("FUNDAMENTALS_PIT_SOURCE", "db")
    monkeypatch.setenv("FUNDAMENTALS_PIT_DB_PATH", str(tmp_path / "pit.db"))
    F.clear_cache()
    real = C.by_id()
    patched = {**real, "revenue_q": dataclasses.replace(real["revenue_q"], formula_eligible=True)}
    monkeypatch.setattr(C, "by_id", lambda: patched)
    r = es.run(req(series={"kind": "fundamental", "symbol": "TST", "metric": "revenue_q"},
                   threshold=0, op="above", episodes="all", horizons=[{"sessions": 1}]))
    assert r["status"] == "ok", r
    # the FY10-K accepted 2024-02-15 16:00 ET is first known at that session's close — never earlier
    assert [e["event_date"] for e in r["events"]] == ["2024-02-15"]
    assert r["events"][0]["condition_value"] == 130.0                      # Q4 = FY − 9M, as the pipeline derives
    assert r["alignment"] == "as_of" and any("filing became public" in n for n in r["notes"])


def test_fundamentals_production_source_is_refused(world, monkeypatch):
    import dataclasses
    from api.services.fundamentals_pit import catalog as C
    real = C.by_id()
    monkeypatch.setattr(C, "by_id", lambda: {**real, "revenue_q": dataclasses.replace(real["revenue_q"], formula_eligible=True)})
    monkeypatch.setenv("FUNDAMENTALS_PIT_SOURCE", "r2")
    r = es.run(req(series={"kind": "fundamental", "symbol": "TST", "metric": "revenue_q"}, threshold=0))
    assert r["status"] == "unavailable" and r["reason"] == "fundamentals_source_not_local"


# ── market cap adapter: the Market Cap team's own local publish → verify → serve fixture ──

def test_market_cap_through_a_verified_local_publication(world, monkeypatch, tmp_path):
    from api.services.marketcap import publication as P, pit_serving as M
    from tests.marketcap.lifecycle_fixtures import make_build, make_prices, manifest_fields, passing_validation
    bid = "MCAP_V1-20261002T050000Z"
    root = str(tmp_path / "bucket")
    t = P.LocalTarget(root)
    db = make_build(str(tmp_path / "b.db"), bid, last_day=20261001)
    r = P.publish_build(t, build_db=db, prices_db=make_prices(str(tmp_path / "prices.db")),
                        manifest_fields=manifest_fields(bid, P.file_sha(db)[0]), validation=passing_validation())
    P.advance(t, bid, r["manifest_sha256"], expect_current=None, by="test", reason="mi test", acceptance="HUMAN_CUTOVER")
    monkeypatch.setenv("MCAP_PIT_SOURCE", "local")
    monkeypatch.setenv("MCAP_PIT_LOCAL_ROOT", root)
    monkeypatch.delenv("MCAP_PIT_PIN", raising=False)
    M.clear_cache()
    days = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]
    fx.install(monkeypatch, bars=[{"t": d, "c": 10.0 + i} for i, d in enumerate(days)])
    out = es.run(req(series={"kind": "market_cap", "symbol": "AAA"}, op="above", threshold=1.015e9,
                     horizons=[{"sessions": 1}], episodes="first"))
    M.clear_cache()
    assert out["status"] == "ok", out
    assert out["coverage"]["series_authority"] == bid
    # AAA cap = 1e9 × (1 + i/100) on 09-28..10-01 → first above 1.015e9 is 09-30 (1.02e9)
    assert [e["event_date"] for e in out["events"]] == ["2026-09-30"]


def test_market_cap_production_source_is_refused(world, monkeypatch):
    monkeypatch.setenv("MCAP_PIT_SOURCE", "r2")
    r = es.run(req(series={"kind": "market_cap", "symbol": "AAA"}, op="above", threshold=1e9))
    assert r["status"] == "unavailable" and r["reason"] == "marketcap_source_not_local"


# ── compound conditions (AND across datasets) ────────────────────────────────

def _pit_adapter(monkeypatch, kind, published, stale=60):
    from api.services.market_intel import series_adapters as sa

    def describe(spec):
        return {"kind": kind, "label": f"Fake {kind}", "unit": "econ", "domain": "any", "category": f"test {kind}"}, None

    def load(spec):
        return {"status": "ok", "alignment": "as_of", "rows": published, "max_staleness_days": stale,
                "coverage": {"first": published[0][0], "last": published[-1][0]}, "source": {"interface": "fake"}}
    monkeypatch.setitem(sa.ADAPTERS, kind, (describe, load))


def comp(*conds, **kw):
    out = {"condition": {"all": list(conds)}, "symbol": "QQQ", "horizons": [{"sessions": 1}]}
    out.update(kw)
    return out


def c(series=None, op="below", threshold=10):
    return {"series": series or BREADTH, "op": op, "threshold": threshold}


def test_compound_session_and_session(world, monkeypatch):
    bars = [{"t": d, "c": 100.0 - (5.0 if i in (11, 12) else 0.0) + i * 0.01} for i, d in enumerate(S)]
    fx.install(monkeypatch, bars=bars)
    tech = {"kind": "technical", "symbol": "QQQ", "indicator": "pct_from_sma", "period": 5}
    r = es.run(comp(c(), c(tech, threshold=-2), episodes="all"))
    assert r["status"] == "ok"
    # breadth < 10 on S[10..12]; QQQ ≥2% under its 5-day SMA only on S[11], S[12]
    assert [e["event_date"] for e in r["events"]] == [S[11], S[12]]
    assert "AND" in r["series_label"] and len(r["events"][0]["condition_values"]) == 2


def test_compound_daily_and_point_in_time_uses_the_carried_value_every_session(world, monkeypatch):
    _pit_adapter(monkeypatch, "pa", [("2024-01-02", -1.0), ("2024-03-01", 1.0)])
    r = es.run(comp(c(), c({"kind": "pa"}, threshold=0), episodes="all"))
    # breadth runs: S[10..12] (Jan) qualify while the Jan-published value (−1 < 0) holds; S[50] (Mar 15) does not
    dates = [e["event_date"] for e in r["events"]]
    assert dates == [S[10], S[11], S[12]] and S[50] not in dates


def test_compound_of_two_point_in_time_series_evaluates_only_publications(world, monkeypatch):
    _pit_adapter(monkeypatch, "pa", [("2024-01-10", -1.0), ("2024-02-09", -2.0), ("2024-03-08", 1.0)])
    _pit_adapter(monkeypatch, "pb", [("2024-01-05", 5.0), ("2024-02-02", 6.0), ("2024-03-01", 7.0)])
    r = es.run(comp(c({"kind": "pa"}, threshold=0), c({"kind": "pb"}, op="above", threshold=4), episodes="all"))
    # true on every session 01-10..03-07 (pa flips positive on 03-08), but events only on sessions where
    # SOME series published: 01-10 (pa), 02-02 (pb), 02-09 (pa), 03-01 (pb) — never the days in between
    assert [e["event_date"] for e in r["events"]] == ["2024-01-10", "2024-02-02", "2024-02-09", "2024-03-01"]


def test_compound_with_an_unknown_part_is_a_gap(world, monkeypatch):
    rows = [(d, (8.0 if 10 <= i <= 14 else 50.0)) for i, d in enumerate(S) if i != 12]
    fx.install(monkeypatch, rows=rows)
    tech = {"kind": "technical", "symbol": "QQQ", "indicator": "rsi", "period": 2}
    r = es.run(comp(c(), c(tech, op="above", threshold=0), episodes="first"))
    # S[12] has no breadth value → the run breaks: S[10] and S[13] start separate runs
    assert [e["event_date"] for e in r["events"]][:2] == [S[10], S[13]]
    assert r["counts"]["condition_gaps"] >= 1


@pytest.mark.parametrize("bad", [{"all": [c()]}, {"all": [c(), c(), c(), c()]}, {"all": "x"},
                                 {"all": [c(), {"series": {"kind": "nope"}, "op": "below", "threshold": 1}]},
                                 {"all": [c(), c()], "op": "below"}])
def test_compound_validation(world, bad):
    r = es.run({"condition": bad, "symbol": "QQQ", "horizons": [{"sessions": 1}]})
    assert r["status"] == "refused" and world["breadth_calls"] == 0


def test_compound_answer_names_every_condition(world, monkeypatch):
    tech = {"kind": "technical", "symbol": "QQQ", "indicator": "rsi", "period": 14}
    a = esa.answer(es.run(comp(c(), c(tech, op="above", threshold=1))))
    assert a["status"] == "ok" and " AND QQQ RSI(14) above 1" in a["text"]


# ── integrity: corporate actions, diagnostics, performance ──────────────────

def test_an_unadjusted_split_is_flagged_not_silently_used(world, monkeypatch):
    """Adversarial: a 2:1 split the store failed to adjust looks like a −50% day. It is flagged, and
    every event window that spans it is counted — returns are not 'fixed' by guessing."""
    bars = [{"t": d, "c": (100.0 + i) if i < 13 else (100.0 + i) / 2} for i, d in enumerate(S)]
    fx.install(monkeypatch, bars=bars)
    r = es.run(req(horizons=[{"sessions": 5}]))
    assert r["diagnostics"]["suspect_price_jumps"] == [S[13]]
    assert r["counts"]["windows_spanning_suspect_jumps"] == 1                 # the S[10] event's window
    assert any("unadjusted corporate action" in n for n in r["notes"])


def test_diagnostics_events_by_year_and_condition_coverage(world):
    r = es.run(req())
    assert r["diagnostics"]["events_by_year"] == {"2024": 5}
    cov = r["diagnostics"]["conditions"][0]
    assert cov["alignment"] == "session" and cov["first"] == S[0] and cov["observations"] == len(S) - 1


def test_performance_on_a_long_history(world, monkeypatch):
    """~26 years of sessions, 6 windows, every qualifying session, baseline on: must stay fast."""
    import time as _t
    days = fx.trading_days("2000-01-03", "2025-12-31")
    rows = [(d, 5.0 if i % 37 < 4 else 50.0) for i, d in enumerate(days)]
    bars = [{"t": d, "c": 100.0 + (i % 250) * 0.3} for i, d in enumerate(days)]
    fx.install(monkeypatch, rows=rows, bars=bars)
    t0 = _t.monotonic()
    r = es.run(req(episodes="all", horizons=[{"sessions": 1}, {"sessions": 5}, {"sessions": 21}, {"sessions": 63},
                                              {"months": 6}, {"months": 12}]), deadline_s=30)
    took = _t.monotonic() - t0
    assert r["status"] == "ok" and r["counts"]["events_used"] > 600
    assert took < 4.0, f"study took {took:.2f}s"
    assert len(r["events"]) == es.MAX_EVENTS_LISTED and r["events_listed_truncated"]


# ── adversarial: look-ahead, calendar, duplicates, staleness, end of history, boundary ──

def test_a_release_after_the_close_is_not_acted_on_that_session(world, monkeypatch):
    """An econ release at 16:30 ET is first knowable at the NEXT session's close."""
    t = _et_unix("2024-01-17", "16:30")
    _econ_world(monkeypatch, [["2023-12-01", "2023-12-31", t, -0.5, "V", 1]])
    r = es.run(req(series={"kind": "econ", "symbol": "USCPIYOY"}, op="below", threshold=0, horizons=[{"sessions": 1}]))
    assert [e["event_date"] for e in r["events"]] == ["2024-01-18"]
    assert r["events"][0]["entry_date"] == "2024-01-18"            # never the 01-17 close


def test_fundamental_is_unknown_between_period_end_and_filing(world, monkeypatch, tmp_path):
    """Period end 2023-12-31, filed 2024-02-15: nothing may use it in January."""
    import dataclasses
    from api.services.fundamentals_pit import catalog as C, serving as F
    from tests.fundamentals_pit.test_pipeline import _run
    _run(tmp_path)
    monkeypatch.setenv("FUNDAMENTALS_PIT_SOURCE", "db")
    monkeypatch.setenv("FUNDAMENTALS_PIT_DB_PATH", str(tmp_path / "pit.db"))
    F.clear_cache()
    real = C.by_id()
    monkeypatch.setattr(C, "by_id", lambda: {**real, "revenue_q": dataclasses.replace(real["revenue_q"], formula_eligible=True)})
    r = es.run(req(series={"kind": "fundamental", "symbol": "TST", "metric": "revenue_q"}, op="above",
                   threshold=100, episodes="all", horizons=[{"sessions": 1}]))
    assert all(e["event_date"] >= "2024-02-15" for e in r["events"])


def test_calendar_month_from_month_end_clamps_then_rolls_forward(world, monkeypatch):
    i = S.index("2024-01-31")
    fx.install(monkeypatch, rows=[(d, 5.0 if k == i else 50.0) for k, d in enumerate(S)])
    r = es.run(req(horizons=[{"months": 1}, {"months": 2}]))
    outs = r["events"][0]["returns"]
    assert outs[0]["exit_date"] == "2024-02-29"           # Jan 31 + 1 month → Feb 29 (leap year), a session
    assert outs[1]["exit_date"] == "2024-04-01"           # Jan 31 + 2 → Mar 31 (Sunday) → next session Apr 1


def test_duplicate_rows_never_create_duplicate_events(world, monkeypatch):
    rows = fx.breadth_rows()
    rows = rows + [(S[10], 8.0), (S[50], 9.5)]            # the same sessions delivered twice
    fx.install(monkeypatch, rows=sorted(rows))
    r = es.run(req(episodes="all"))
    dates = [e["event_date"] for e in r["events"]]
    assert len(dates) == len(set(dates))


def test_a_stale_point_in_time_value_stops_qualifying(world, monkeypatch):
    """A weekly series that stops publishing (a lapse) must not keep 'qualifying' on old data."""
    _pit_adapter(monkeypatch, "wk", [("2024-01-05", 5.0), ("2024-01-12", 5.0), ("2024-03-01", 5.0)], stale=14)
    r = es.run(req(series={"kind": "wk"}, threshold=10, episodes="first", horizons=[{"sessions": 1}]))
    # 01-05 starts a run; the value goes stale after 01-26 (14 days past 01-12) → gap → 03-01 is a new run
    assert [e["event_date"] for e in r["events"]] == ["2024-01-05", "2024-03-01"]
    assert r["counts"]["condition_gaps"] > 0


def test_events_at_the_end_of_history_are_counted_incomplete_not_dropped(world, monkeypatch):
    fx.install(monkeypatch, rows=[(d, 5.0 if i == len(S) - 1 else 50.0) for i, d in enumerate(S)])
    r = es.run(req(horizons=[{"sessions": 1}]))
    assert [e["event_date"] for e in r["events"]] == [S[-1]]
    h = r["horizons"][0]
    assert h["n"] == 0 and h["incomplete"] == 1


def test_validated_request_echoes_nothing_but_what_was_asked(world):
    """Boundary rail for the Agent's history placeholder: validate() output carries only the member's
    own parameters and registry labels — no extra fields and no market values."""
    raw = req(note="73.4567 leaked?", extra={"v": 73.4567}, symbol="qqq", threshold=10)
    ok, err = es.validate(raw)
    assert err is None
    assert set(ok) == {"condition", "conditions", "symbol", "horizons", "episodes", "entry",
                       "non_overlapping", "baseline", "start", "end"}
    assert "73.4567" not in repr(ok) and ok["symbol"] == "QQQ"
