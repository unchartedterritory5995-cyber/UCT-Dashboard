"""Rails for unit VA3 (UCT Relative Strength, 2026-11-07): the evidence sentence
made fully honest.

1. UNCHECKED SPLITS ARE DISCLOSED. The job's receipt always counted the names
   whose declared split list was unknown (`split_unchecked`: the split guard
   could not judge them, so they are measured as held); the artifact now carries
   it (`split_guard.unchecked`, and per signal `split_guard.unchecked_by_signal`)
   and the measured sentence says so in plain words when it is not zero. An
   artifact from before the field prints no clause.
2. UNCERTAINTY AND SPAN. A measured hit rate carries its likely range (a 95 %
   Wilson interval over the EFFECTIVE n, each session counted once), and a
   number prints only when the events with a complete window at the printed
   horizon fell on at least `MIN_EVENT_DATES` different sessions as well as
   clearing the display floor on n. The methodology page reads both constants
   from `rs_evidence_pull` at call time.

Plan: docs/superpowers/specs/2026-11-05-uct-relative-strength-indicator-design.md
§9; research base docs/research/relative-strength/03-evidence.md §(c) ("report
distinct event dates"; "suppress display when effective N < 100") and §(d).
"""
from __future__ import annotations

import math

import pytest

from api.services import rs_evidence as E
from api.services import rs_evidence_pull as ep
from api.services.rs_evidence import job as J
from api.services.rs_evidence import store as S
from api.services.screener import methodology
from tests.test_rs_evidence_job import _universe_500, make_reader, provider  # noqa: F401 - the fixture
from tests.test_rs_evidence_pull import BEFORE_PRICE_SENTENCE, fixture_artifact

BP = "rs_new_high_before_price"


# ── 1. unchecked splits ──────────────────────────────────────────────────────

def test_the_artifact_carries_the_unchecked_count_per_run_and_per_signal():
    art = fixture_artifact()
    assert art["split_guard"]["unchecked"] is None and art["split_guard"]["unchecked_by_signal"] is None, \
        "a builder call that passes no count says null, never a false zero"
    summary = {"rows": 0, "per_signal": {}, "baseline": {}}
    art = E.build_artifact(summary, asof_ymd=20261104, benchmark="SPY", window_from=None, window_to=None,
                           sessions=0, sessions_open=0, universe=0, universe_requested=0,
                           split_unchecked=37, split_unchecked_by_signal={BP: 4, E.BASELINE_KEY: 37})
    guard = art["split_guard"]
    assert guard["unchecked"] == 37
    assert guard["unchecked_by_signal"] == {**{name: 0 for name in E.SIGNALS}, BP: 4, E.BASELINE_KEY: 37}
    assert "split list was unknown" in guard["unchecked_rule"]


def test_the_run_puts_its_unknown_split_lists_into_the_artifact(tmp_path, provider):  # noqa: F811
    """A's list is known (no splits), B's provider call fails: one unchecked name,
    and per signal the count is the names among that signal's counted rows."""
    ts, series = _universe_500()
    provider["answers"]["A"] = []
    db = tmp_path / "ev.db"
    r = E.run(db=str(db), sessions=300, bars_reader=make_reader(series, ts), universe=["A", "B"],
              delisted_fn=lambda a, b: None)
    assert r["ok"] and r["split_unchecked"] == 1 and r["artifact"]["split_unchecked"] == 1
    by_signal = r["split_unchecked_by_signal"]
    assert by_signal[E.BASELINE_KEY] == 1, "B has baseline rows"
    conn = S.open_store(str(db))
    try:
        for name in E.SIGNALS:
            has_b = conn.execute(f"SELECT COUNT(*) FROM {S.ROWS_TABLE} WHERE signal = ? AND ticker = 'B' "
                                 f"AND skip = 0", (name,)).fetchone()[0]
            assert by_signal.get(name, 0) == (1 if has_b else 0), name
    finally:
        conn.close()


def test_a_dry_run_counts_the_same_names_from_the_rows_it_holds(tmp_path, provider):  # noqa: F811
    ts, series = _universe_500()
    r = E.run(db=str(tmp_path / "none.db"), dry_run=True, sessions=50, bars_reader=make_reader(series, ts),
              universe=["A", "B"], delisted_fn=lambda a, b: None)
    assert r["ok"] and r["split_unchecked"] == 2 and r["artifact"]["split_unchecked"] == 2
    assert r["split_unchecked_by_signal"][E.BASELINE_KEY] == 2


def test_the_measured_sentence_names_unchecked_splits_only_when_there_are_some():
    art = fixture_artifact()
    assert ep.summary_line(BP, 63, art) == BEFORE_PRICE_SENTENCE, "null: nothing extra"
    art["split_guard"]["unchecked"] = 0
    assert ep.summary_line(BP, 63, art) == BEFORE_PRICE_SENTENCE, "zero: nothing extra"
    art["split_guard"]["unchecked"] = 37
    line = ep.summary_line(BP, 63, art)
    assert line == BEFORE_PRICE_SENTENCE.replace(
        "for all bars. Universe", "for all bars. Stock splits not yet checked for 37 names. Universe")
    # the per-signal count wins over the run-level one, and its zero is honoured
    art["split_guard"]["unchecked_by_signal"] = {BP: 1}
    assert "Stock splits not yet checked for 1 name. Universe" in ep.summary_line(BP, 63, art)
    art["split_guard"]["unchecked_by_signal"] = {BP: 0}
    assert ep.summary_line(BP, 63, art) == BEFORE_PRICE_SENTENCE
    # the withheld sentence prints no number, so it carries no split clause
    art["split_guard"]["unchecked_by_signal"] = None
    assert "Stock splits" not in ep.summary_line("rs_new_high_red_day", 63, art)


def test_an_artifact_from_before_the_field_prints_todays_sentence():
    art = fixture_artifact()
    del art["split_guard"]["unchecked"], art["split_guard"]["unchecked_by_signal"]
    assert ep.evidence_for(BP, 63, art)["split_unchecked"] is None
    assert ep.summary_line(BP, 63, art) == BEFORE_PRICE_SENTENCE
    del art["split_guard"]
    assert ep.summary_line(BP, 63, art) == BEFORE_PRICE_SENTENCE


# ── 2. the likely range ──────────────────────────────────────────────────────

def _wilson_by_hand(k, n, z=1.959963984540054):
    """Wilson (1927) from its textbook form, written out separately here."""
    p = k / n
    a = p + z * z / (2 * n)
    b = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    c = 1 + z * z / n
    return (a - b) / c, (a + b) / c


def test_the_wilson_interval_matches_known_values():
    lo, hi = ep.wilson_interval(0.5, 100)
    assert (round(lo, 4), round(hi, 4)) == (0.4038, 0.5962), "the standard 50 of 100 example"
    for k, n in ((0, 10), (10, 10), (583, 1000), (7, 240)):
        got = ep.wilson_interval(k / n, n)
        want = _wilson_by_hand(k, n)
        assert got[0] == pytest.approx(max(0.0, want[0]), abs=1e-12)
        assert got[1] == pytest.approx(min(1.0, want[1]), abs=1e-12)
    assert ep.wilson_interval(0.0, 10)[0] == 0.0 and ep.wilson_interval(1.0, 10)[1] == 1.0
    assert ep.wilson_interval(0.5, 0) is None and ep.wilson_interval(1.5, 10) is None
    assert ep.wilson_interval(None, 10) is None
    assert ep.INTERVAL_CONFIDENCE_PCT == 95 and ep.INTERVAL_Z == pytest.approx(1.959963984540054)


def test_the_range_is_over_the_effective_n_so_clustered_events_read_wide():
    art = fixture_artifact()
    ev = ep.evidence_for(BP, 63, art)
    assert ev["effective_n"] == 240 and ev["n"] == 1284
    lo, hi = ep.wilson_interval(0.583, 240)
    assert (ev["hit_rate_low_pct"], ev["hit_rate_high_pct"]) == (round(lo * 100, 2), round(hi * 100, 2))
    narrow = ep.wilson_interval(0.583, 1284)
    assert hi - lo > narrow[1] - narrow[0], "counting each session once is the cautious side"
    assert "58.3% (likely between 52.0% and 64.4%) beat SPY" in ep.sentence_for(ev)


# ── 2. the span rule ─────────────────────────────────────────────────────────

def test_the_span_rule_reads_the_sessions_with_a_complete_window_at_the_horizon():
    art = fixture_artifact()
    h = art["per_signal"][BP]["horizons"]["63"]
    # an artifact from before VA3 has no horizon dates: the per-signal count (240) stands
    assert "dates" not in h and ep.evidence_for(BP, 63, art)["sessions"] == 240
    # the horizon's own count wins: 1,284 events but only 99 sessions with a complete window
    h["dates"] = ep.MIN_EVENT_DATES - 1
    ev = ep.evidence_for(BP, 63, art)
    assert ev["sessions"] == 99 and ev["n"] == 1284 and ev["displayable"] is False
    assert ep.sentence_for(ev) == ("UCT measured 1,284 events on 99 sessions, too few to print a hit rate: "
                                   "it needs at least 100 events on at least 100 different sessions.")
    h["dates"] = ep.MIN_EVENT_DATES
    assert ep.evidence_for(BP, 63, art)["displayable"] is True
    assert ep.summary_line(BP, 63, art).startswith("1,284 RS new highs before price on 100 sessions, ")
    # n under the floor on many sessions is still withheld
    h["n"], h["dates"] = 99, 99
    assert ep.evidence_for(BP, 63, art)["displayable"] is False


def test_the_builder_and_the_store_count_complete_window_sessions_per_horizon(tmp_path):
    rows = [
        (20200102, "x", "A", (1.0, 2.0, None)),
        (20200102, "x", "B", (1.0, None, None)),
        (20200103, "x", "A", (0.5, None, None)),
        (20200103, E.BASELINE_KEY, "A", (0.5, None, None)),
    ]
    mem = E.summarise(rows)
    assert mem["per_signal"]["x"]["dates"] == 2
    assert {h: b["dates"] for h, b in mem["per_signal"]["x"]["horizons"].items()} == {"21": 2, "63": 1, "126": 0}
    conn = S.open_store(str(tmp_path / "ev.db"))
    S.write_rows(conn, rows)
    conn.commit()
    assert S.summary(conn)["per_signal"] == mem["per_signal"]
    conn.close()
    empty = E.build_artifact({"rows": 0, "per_signal": {}, "baseline": {}}, asof_ymd=None, benchmark="SPY",
                             window_from=None, window_to=None, sessions=0, sessions_open=0, universe=0,
                             universe_requested=0)
    assert all(b["dates"] == 0 for s in empty["per_signal"].values() for b in s["horizons"].values())


def test_the_minimum_is_the_research_bases_effective_n_and_not_a_lower_one():
    """03-evidence.md §(c): suppress display when effective N < 100. Review #6
    read effective N as min(n, sessions); VA3 states the sessions half as its own
    number, so it must not fall below the floor it restates."""
    assert ep.MIN_EVENT_DATES == E.DISPLAY_FLOOR_N == 100


# ── the methodology page reads the constants at call time ────────────────────

def test_the_methodology_page_reads_the_span_rule_and_the_range_from_the_pull_module(monkeypatch):
    m = methodology.rs_evidence_section()["measured"]
    assert m["min_event_dates"] == ep.MIN_EVENT_DATES and m["interval_confidence_pct"] == ep.INTERVAL_CONFIDENCE_PCT
    assert "at least 100 different sessions" in m["rule"] and "95% confidence" in m["rule"]
    assert "(likely between <low>% and <high>%)" in m["form"]
    assert ep.split_unchecked_phrase(37) in m["rule"] and "[Stock splits not yet checked for <N> names.]" in m["form"]
    assert m["form_withheld"].endswith(ep.requirement_phrase(ep.DISPLAY_FLOOR_N) + ".")
    monkeypatch.setattr(ep, "MIN_EVENT_DATES", 150)
    monkeypatch.setattr(ep, "INTERVAL_CONFIDENCE_PCT", 90)
    monkeypatch.setattr(ep, "INTERVAL_WORDS", "probably between")
    m = methodology.rs_evidence_section()["measured"]
    assert m["min_event_dates"] == 150 and "at least 150 different sessions" in m["rule"]
    assert "90% confidence" in m["rule"] and "(probably between <low>% and <high>%)" in m["form"]
    assert "at least 150 different sessions" in m["form_withheld"]


def test_the_split_phrase_is_plain_and_silent_at_zero():
    assert ep.split_unchecked_phrase(0) == "" and ep.split_unchecked_phrase(None) == ""
    assert ep.split_unchecked_phrase(1) == "Stock splits not yet checked for 1 name."
    assert ep.split_unchecked_phrase(1200) == "Stock splits not yet checked for 1,200 names."


def test_the_honesty_sentence_is_unchanged():
    assert ep.HONESTY_SENTENCE == "No published hit rate exists for this signal and UCT has not measured one yet."
    assert ep.sentence_for(None) == ep.HONESTY_SENTENCE
    assert J.DISPLAY_FLOOR_N == 100
