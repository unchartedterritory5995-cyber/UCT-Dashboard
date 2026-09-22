"""The corrected Breadth V2 methodology: Candidate B close, Candidate E levels,
metric-specific eligibility, and the amended R-B path-quality rule.

Every test here pins a behaviour that a previous phase proved WRONG in the shipped V2
artifact, so a regression on any of them reintroduces a defect we have already paid to
find. The negative controls at the bottom exist because a harness that cannot fail is
not evidence.
"""
import importlib
import json
import os

import numpy as np
import pytest

from api.services import breadth_grouped_history as gh
from api.services import breadth_live as bl
from api.services import breadth_wick_recon as wr
from api.services import massive


# ── fixture: a synthetic grouped cache ───────────────────────────────────────
N_SESSIONS = 420
LIVE = ["AAA", "BBB", "CCC", "DDD"]
DELISTED = "OLDCO"          # trades for the first half of history, then disappears
IPO = "NEWCO"               # appears only in the last 30 sessions
GAPPY = "GAPPY"             # trades most days but skips a few -> 52w ineligible
DELIST_AT = 300             # OLDCO stops trading here (past the 221-session floor)


def _sessions(n=N_SESSIONS):
    import datetime as dt
    out, d = [], dt.date(2020, 1, 1)
    while len(out) < n:
        d += dt.timedelta(days=1)
        if d.weekday() < 5:
            out.append(d.isoformat())
    return out


@pytest.fixture()
def cache(tmp_path, monkeypatch):
    days = _sessions()
    monkeypatch.setattr(massive, "_GROUPED_DIR", str(tmp_path), raising=False)
    for i, iso in enumerate(days):
        m = {}
        for k, t in enumerate(LIVE):
            m[t] = round(10.0 + k + i * 0.01, 4)
        if i < DELIST_AT:
            m[DELISTED] = round(50.0 - i * 0.02, 4)
        if i >= N_SESSIONS - 30:
            m[IPO] = round(100.0 + i * 0.05, 4)
        if i % 37 != 0:                       # GAPPY misses ~1 session in 37
            m[GAPPY] = round(20.0 + i * 0.01, 4)
        (tmp_path / ("%s_1.json" % iso)).write_text(json.dumps(m))
    # reset the module's process-wide caches between tests
    gh._CALENDAR = None
    gh._SESSION.clear()
    gh._ORDER.clear()
    gh._MASTER.clear()
    gh._MASTER_IX.clear()
    gh._STATS.update({"parsed": 0, "hit": 0, "miss": 0})
    return days


# ── Candidate E: levels from grouped history ────────────────────────────────
def test_calendar_is_the_cache_and_is_deterministic(cache):
    cal = gh.session_calendar()
    assert cal == sorted(cache)
    gh._CALENDAR = None
    assert gh.session_calendar() == cal


def test_frame_dates_are_strictly_before_the_session(cache):
    d = cache[-1]
    fr = gh.frame_dates(d, 10)
    assert len(fr) == 10
    assert all(x < d for x in fr)
    assert fr == cache[-11:-1]


def test_levels_prev_close_and_moving_averages_match_the_canonical_builder(cache):
    d = cache[-1]
    lv = gh.levels_for_day(LIVE, d)
    assert lv is not None and lv["_source"] == "grouped_adjusted_daily"
    prior = gh.closes_for(cache[-2])
    for i, t in enumerate(LIVE):
        assert lv["prev_close"][i] == pytest.approx(prior[t])
    # SMA50 reconstructed from the canonical parts: prior 49 closes + today
    px = np.array([prior[t] for t in LIVE])
    sma50 = (lv["sma_prev_sum"][50] + px) / 50.0
    assert np.all(np.isfinite(sma50))
    assert np.all(lv["sma_ok"][50])


def test_optimised_frame_is_identical_to_the_naive_reference(cache):
    """The index-array cache is a REPRESENTATION change, not a numeric one."""
    d = cache[-1]
    rows = LIVE + [DELISTED, IPO, GAPPY]
    fast = gh.levels_for_day(rows, d)
    slow = gh.naive_levels_for_day(rows, d)
    assert fast is not None and slow is not None
    for key in ("prev_close", "max52", "min52", "ema20_prev", "sma200_back21"):
        a, b = np.asarray(fast[key], float), np.asarray(slow[key], float)
        assert np.array_equal(np.isnan(a), np.isnan(b)), key
        assert np.allclose(a[~np.isnan(a)], b[~np.isnan(b)], rtol=0, atol=0), key
    for key in ("max52_ok", "min52_ok"):
        assert np.array_equal(fast[key], slow[key]), key
    for w in (5, 10, 50, 200):
        assert np.array_equal(fast["sma_ok"][w], slow["sma_ok"][w])
        assert np.allclose(fast["sma_prev_sum"][w], slow["sma_prev_sum"][w],
                           rtol=0, atol=0, equal_nan=True)


def test_delisted_name_has_levels_while_it_traded_and_not_after(cache):
    mid = cache[DELIST_AT]
    late = cache[-1]
    rows = LIVE + [DELISTED]
    i = rows.index(DELISTED)
    lv_mid = gh.levels_for_day(rows, mid)
    assert np.isfinite(lv_mid["prev_close"][i]), "a delisted name must be present " \
                                                 "for the sessions it actually traded"
    lv_late = gh.levels_for_day(rows, late)
    assert not np.isfinite(lv_late["prev_close"][i])


def test_ipo_phases_into_metrics_as_history_accrues(cache):
    """Insufficient history is METRIC SEMANTICS, not data loss."""
    rows = LIVE + [IPO]
    i = rows.index(IPO)
    lv = gh.levels_for_day(rows, cache[-1])
    assert np.isfinite(lv["prev_close"][i]), "an IPO is A/D-eligible from day two"
    assert not lv["max52_ok"][i], "...and NOT 52-week eligible until 252 sessions"
    assert not lv["sma_ok"][200][i], "...nor SMA200 eligible"
    assert lv["sma_ok"][5][i], "...but short windows qualify immediately"


def test_a_gap_in_history_disqualifies_only_the_long_windows(cache):
    rows = LIVE + [GAPPY]
    i = rows.index(GAPPY)
    lv = gh.levels_for_day(rows, cache[-1])
    assert np.isfinite(lv["prev_close"][i])
    assert not lv["max52_ok"][i], "min_periods semantics: one gap voids the 52w window"


def test_short_history_refuses_rather_than_guessing(cache):
    assert gh.levels_for_day(LIVE, cache[5]) is None


def test_never_touches_bars_db(cache, monkeypatch):
    """⛔ No silent fallback. If grouped history is the source, it is the ONLY source."""
    def boom(*a, **k):
        raise AssertionError("the corrected historical path opened bars.db")
    monkeypatch.setattr(bl, "_bars_conn", boom)
    monkeypatch.setattr(bl, "_load_frame", boom)
    assert gh.levels_for_day(LIVE, cache[-1]) is not None
    assert gh.official_closes(cache[-1], set(LIVE))


# ── Candidate B: the official close over the path population ────────────────
def test_official_close_is_the_provider_close_for_exactly_the_members(cache):
    d = cache[-1]
    members = set(LIVE[:2])
    got = gh.official_closes(d, members)
    assert set(got) == members
    full = gh.closes_for(d)
    for t in members:
        assert got[t] == full[t]


def test_official_close_covers_the_whole_path_population(cache):
    """The P0-POP fix: close population == path population, by MEMBERSHIP not count."""
    d = cache[-1]
    path = set(LIVE) | {IPO, GAPPY}
    got = gh.official_closes(d, path)
    assert set(got) == path


def test_missing_session_yields_no_close_rather_than_a_substitute(cache):
    assert gh.official_closes("1999-01-04", set(LIVE)) == {}


# ── P1: the amended R-B path-quality rule ───────────────────────────────────
def _shape(rng, mj, t3=None, pop=0.0):
    return {"range": rng, "max_jump": mj,
            "top3_jump": t3 if t3 is not None else mj, "pop_jump_frac": pop}


def test_a_legitimate_53_point_collapse_is_accepted(cache):
    """2008-12-01 uct pct_above_5sma: 64.2 -> 11.6, largest minute 7.3 (14%)."""
    ok, why = wr.path_quality("pct_above_5sma", _shape(53.3, 7.3, 14.5))
    assert ok, why


def test_a_tiny_range_path_is_accepted(cache):
    """2020-03-16 pct_above_20ema: 1.2 points all day, one 0.7 minute. The ORIGINAL
    R-B rejected this; the absolute guard is why the amended rule does not."""
    ok, why = wr.path_quality("pct_above_20ema", _shape(1.2, 0.7, 1.2))
    assert ok, why


def test_an_isolated_spike_is_rejected(cache):
    ok, why = wr.path_quality("pct_above_5sma", _shape(42.7, 39.7, 85.7))
    assert not ok and "single bucket dominates" in why


def test_a_population_discontinuity_is_rejected(cache):
    ok, why = wr.path_quality("pct_above_5sma", _shape(53.3, 7.3, 14.5, pop=0.50))
    assert not ok and "population discontinuity" in why


def test_the_old_absolute_cap_is_retired_only_where_a_path_rule_takes_over(cache):
    assert wr.sane_wick("pct_above_5sma", 64.2, 64.2, 10.9, 11.6)[0] is False
    assert wr.sane_wick("pct_above_5sma", 64.2, 64.2, 10.9, 11.6,
                        skip_range_cap=True)[0] is True


def test_domain_and_ordering_checks_survive_the_retirement(cache):
    assert not wr.sane_wick("pct_above_5sma", 50, 101.0, 10, 40,
                            skip_range_cap=True)[0]
    assert not wr.sane_wick("pct_above_5sma", 50, 40.0, 10, 45,
                            skip_range_cap=True)[0]
    assert not wr.sane_wick("new_52w_highs", float("nan"), 1, 0, 1,
                            skip_range_cap=True)[0]


def test_a_rejected_path_becomes_a_flagged_body_not_a_missing_row(cache):
    """⚰️ The V2 defect: the gate degraded correctly and the PASS threw it away."""
    levels = gh.levels_for_day(LIVE, cache[-1])
    # a path whose single bucket carries the whole range
    buckets = [{t: 10.0 for t in LIVE} for _ in range(5)]
    buckets[2] = {t: 900.0 for t in LIVE}
    out = wr.aggregate_day(levels, buckets, {"pct_above_5sma": 50.0},
                           path_rule=wr.PATH_RULE)
    row = out.get("pct_above_5sma")
    assert row is not None, "a rejected path must never delete the observation"
    assert row["source"] != "intraday_recon"
    assert row["flagged"]
    assert row["o"] == row["h"] == row["l"] == row["c"] == 50.0


def test_an_accepted_path_keeps_its_observed_wick(cache):
    levels = gh.levels_for_day(LIVE, cache[-1])
    buckets = [{t: 10.0 + i for t in LIVE} for i in range(40)]
    out = wr.aggregate_day(levels, buckets, {"pct_above_5sma": 50.0},
                           path_rule=wr.PATH_RULE)
    assert out["pct_above_5sma"]["source"] == "intraday_recon"


def test_legacy_callers_are_untouched_by_the_new_rule(cache):
    """The live sweep must keep its old behaviour: no `path_rule`, no change."""
    levels = gh.levels_for_day(LIVE, cache[-1])
    buckets = [{t: 10.0 + i for t in LIVE} for i in range(40)]
    out = wr.aggregate_day(levels, buckets, {"pct_above_5sma": 50.0})
    assert out["pct_above_5sma"]["source"] in ("intraday_recon", "close_recon")


# ── negative controls: a harness that cannot fail is not evidence ───────────
def test_control_1_missing_grouped_history_is_detected(cache, tmp_path):
    """Strip one name out of 10% of its sessions: its long windows MUST go ineligible."""
    import random
    before = gh.levels_for_day(LIVE, cache[-1])
    assert bool(before["max52_ok"][0]) and bool(before["sma_ok"][200][0])
    rnd = random.Random(4)
    for iso in cache:
        if rnd.random() < 0.10:
            f = tmp_path / ("%s_1.json" % iso)
            m = json.loads(f.read_text())
            m.pop(LIVE[0], None)
            f.write_text(json.dumps(m))
    gh._CALENDAR = None
    gh._SESSION.clear()
    gh._ORDER.clear()
    after = gh.levels_for_day(LIVE, cache[-1])
    assert after is not None
    assert not after["max52_ok"][0], "a 10% history hole must void the 52-week window"
    assert not after["sma_ok"][200][0], "...and SMA200"
    assert bool(after["max52_ok"][1]), "untouched names must be unaffected"


def test_control_2_a_one_session_window_shift_is_detected(cache):
    a = gh.levels_for_day(LIVE, cache[-1])
    b = gh.levels_for_day(LIVE, cache[-2])
    assert not np.allclose(a["prev_close"], b["prev_close"]), \
        "a shifted window must change prev_close"


def test_control_5_an_injected_spike_is_rejected(cache):
    good = _shape(53.3, 7.3, 14.5)
    assert wr.path_quality("pct_above_5sma", good)[0]
    spiked = _shape(53.3, 36.7, 78.9)
    assert not wr.path_quality("pct_above_5sma", spiked)[0]


def test_control_7_restoring_the_old_cap_breaks_a_known_legitimate_session(cache):
    """If someone reinstates `range > 30`, this is the test that goes red."""
    ok_new, _ = wr.sane_wick("pct_above_5sma", 64.2, 64.2, 10.9, 11.6,
                             skip_range_cap=True)
    ok_old, why_old = wr.sane_wick("pct_above_5sma", 64.2, 64.2, 10.9, 11.6)
    assert ok_new and not ok_old and "garbage-wick" in why_old


def test_frame_width_guard_fails_closed(cache, monkeypatch):
    monkeypatch.setattr(bl, "_FRAME_SESSIONS", 200, raising=False)
    with pytest.raises(RuntimeError):
        gh.assert_frame_width()
