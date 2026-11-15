"""RS screens unit U9, part 4: the Leader score test harness on markets whose answer
is known (``tests/rs_leader_test_fixture.py``: closed-form prices, so every number
below can be recomputed from the fixture's own formulas).

Three markets:
  * ``ordered``: the stored rating score rises with each stock's drift, so the score
    orders forward returns. The test must PASS, and its spread must be the eight
    fastest risers' return minus the eight slowest's, to the last decimal;
  * ``noise``: the score is reshuffled every session. The test must FAIL;
  * ``holdout_only``: noise on development sessions, ordered on the holdout. Without
    ``--unlock-holdout`` the harness must not read the holdout and must FAIL.

And the two properties the harness exists for:
  * POINT IN TIME: nothing after a formation date's own window can change that date,
    and nothing in the holdout can change a development result;
  * READ-ONLY: it opens both databases ``mode=ro`` and writes one file, ``--out``.
"""
from __future__ import annotations

import builtins
import hashlib
import json
import shutil
import sqlite3
from statistics import median

import pytest

from api.services.rs_leader_test import __main__ as cli
from api.services.rs_leader_test import data, run, spec
from tests import rs_leader_test_fixture as fx

DEV, HOLD = fx.DEVELOPMENT, fx.HOLDOUT
#: Development formation dates: every 5th rated session before the holdout.
DEV_K = list(range(0, DEV, 5))
#: ... and the ones whose 21-session window ends inside the development sessions.
DEV_K_21 = [k for k in DEV_K if k + 21 <= DEV - 1]
HOLD_K = list(range(DEV + (-DEV) % 5, fx.RATED, 5))
HOLD_K_21 = [k for k in HOLD_K if k + 21 <= fx.RATED - 1]


def _stored(*args, **kw):
    """The test with the ratings READ FROM THE STORE: this file's markets are told apart
    by the stored rating score alone. The computed-ratings mode (the default) has its
    own file, ``test_rs_screens_u9_harness_computed.py``."""
    return run.run_test(*args, ratings="stored", **kw)


def _strip(result):
    """A result without the one field that is a clock."""
    return {k: v for k, v in result.items() if k != "generated_at"}


def _sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture(scope="module")
def ordered(tmp_path_factory):
    return fx.build(tmp_path_factory.mktemp("ordered"), "ordered")


@pytest.fixture(scope="module")
def ordered_run(ordered):
    return _stored(*ordered)


@pytest.fixture(scope="module")
def ordered_unlocked(ordered):
    return _stored(*ordered, unlock_holdout=True)


@pytest.fixture(scope="module")
def noise(tmp_path_factory):
    return fx.build(tmp_path_factory.mktemp("noise"), "noise")


@pytest.fixture(scope="module")
def holdout_only(tmp_path_factory):
    return fx.build(tmp_path_factory.mktemp("holdout_only"), "holdout_only")


def _ret(drift, k, h=21):
    """A symbol's gross return in percent from the open after rated session ``k`` (the
    close of ``k``) to the close ``h`` sessions on."""
    return (fx.growth(drift, fx.WARMUP + k, h) - 1.0) * 100.0


def _mean(vals):
    vals = list(vals)
    return sum(vals) / len(vals)


# ───────────────────────── the ordered market: PASS, and the exact numbers ──────

def test_the_ordered_market_passes_on_development_data(ordered_run):
    r = ordered_run
    assert r["verdict"] == "PASS" and r["judgement"]["passed"] is True
    c = r["judgement"]["criteria"]
    assert c["1_spread_positive_interval_off_zero"]["met"]
    assert c["2_positive_in_3_of_4_years"]["met"] and c["2_positive_in_3_of_4_years"]["positive"] == 4
    assert list(c["2_positive_in_3_of_4_years"]["years"]) == ["2021", "2022", "2023", "2024"]
    assert c["3_quintiles_in_order"]["met"] and c["3_quintiles_in_order"]["spearman"] == pytest.approx(1.0)
    assert c["4_same_sign_in_holdout"] == {"asked": False, "met": None, "holdout_spread_pct": None,
                                           "holdout_dates": 0}
    assert r["holdout"] is None and r["holdout_unlocked"] is False and r["quick_run"] is False


def test_the_sessions_and_the_formation_dates_are_the_specifications(ordered_run):
    s = ordered_run["sessions"]
    assert s["stored"] == {"count": 1260, "first": fx.SESSIONS[0], "last": fx.SESSIONS[-1]}
    assert s["development"] == {"count": 1008, "first": fx.SESSIONS[0], "last": fx.SESSIONS[DEV - 1]}
    assert s["holdout"] == {"count": 252, "first": fx.SESSIONS[DEV], "last": fx.SESSIONS[-1], "read": False}
    assert s["last_date_read"] == fx.SESSIONS[DEV - 1]
    dev = ordered_run["development"]
    assert [d["date"] for d in dev["dates"]] == [fx.SESSIONS[k] for k in DEV_K]
    assert (dev["formation_dates"], dev["dates_used"], dev["dates_skipped"]) == (len(DEV_K), 202, {})
    assert dev["primary"]["dates"] == len(DEV_K_21) == 198
    assert dev["primary"]["independent_blocks"] == 40      # sessions 0, 25, ... 975
    assert ordered_run["seed"] == spec.BOOTSTRAP_SEED and ordered_run["constants"] == spec.as_dict()


def test_who_is_in_the_universe_and_who_qualifies(ordered_run):
    """52 liquid stocks on every date (40 leaders, 12 quiet); the 40 leaders qualify and
    are scored. The fund, the symbol of unknown type, the $0.20 stock, the thinly traded
    one, the symbol with no row today and the row with no bars are never in it."""
    dev = ordered_run["development"]
    assert all((d["floor"], d["qualifiers"], d["scored"]) == (52, 40, 40) for d in dev["dates"])
    assert (dev["mean_floor"], dev["mean_qualifiers"], dev["mean_scored_qualifiers"]) == (52.0, 40.0, 40.0)
    counts = ordered_run["counts"]
    assert counts["symbols_classified"] == 58                 # 40 + 12 + SPY, ETFX, UNKN, CHEAP, THIN, NOBARS
    assert counts["symbols_not_a_stock_or_unknown"] == 3      # SPY, ETFX and UNKN
    assert counts["symbols_no_bars"] == 1                     # NOBARS
    assert counts["symbols_liquid_on_a_date"] == 52           # CHEAP and THIN never are
    assert "as held today" in ordered_run["universe"]["classification"]
    assert ordered_run["universe"]["gate_omissions"] == list(spec.GATE_OMISSIONS)
    assert "NO declared split lists" in ordered_run["universe"]["split_lists"]


def test_the_primary_spread_is_the_fixtures_closed_form_on_every_date(ordered_run):
    """Top quintile = the eight fastest leaders, bottom = the eight slowest (the score
    follows the rating score, which follows the drift). The cost is on both sides."""
    by_date = ordered_run["development"]["primary"]["by_date"]
    assert [p["date"] for p in by_date] == [fx.SESSIONS[k] for k in DEV_K_21]
    for p, k in zip(by_date, DEV_K_21):
        assert p["spread_pct"] == pytest.approx(fx.expected_spread(k), abs=1e-9), k
    want = _mean(fx.expected_spread(k) for k in DEV_K_21)
    got = ordered_run["development"]["primary"]["top_minus_bottom_pct"]
    assert got == pytest.approx(want, abs=1e-9) and 2.7 < got < 2.8
    c1 = ordered_run["judgement"]["criteria"]["1_spread_positive_interval_off_zero"]
    assert c1["spread_pct"] == got and 0 < c1["interval"]["low"] <= got <= c1["interval"]["high"]


@pytest.mark.parametrize("h", spec.HORIZONS)
def test_every_horizon_enters_at_the_next_open_and_exits_h_sessions_on(ordered_run, h):
    ks = [k for k in DEV_K if k + h <= DEV - 1]
    block = ordered_run["development"]["horizons"][str(h)]
    assert block["top_minus_bottom_pct"] == pytest.approx(
        _mean(fx.expected_spread(k, h) for k in ks), abs=1e-9)
    # 40 positions a date, each with a complete window
    assert block["events"] == 40 * len(ks)
    assert block["benchmark_mean_return_pct"] == pytest.approx(
        _mean(_ret(fx.BENCH_DRIFT, k, h) for k in ks), abs=1e-9)


def test_returns_are_net_of_the_cost_and_baselines_are_not_charged(ordered_run):
    g = ordered_run["development"]["horizons"]["21"]["groups"]
    leaders = [fx.leader_drift(i) for i in range(fx.LEADERS)]
    top8 = _mean(_mean(_ret(d, k) for d in leaders[32:]) for k in DEV_K_21)
    assert g["q5"]["mean_return_pct"] == pytest.approx(top8 - 0.2, abs=1e-9)
    assert g["q1"]["mean_return_pct"] == pytest.approx(
        _mean(_mean(_ret(d, k) for d in leaders[:8]) for k in DEV_K_21) - 0.2, abs=1e-9)
    # the range baseline is the 40 leaders (4% daily range), uncharged
    all40 = _mean(_mean(_ret(d, k) for d in leaders) for k in DEV_K_21)
    assert g["baseline_liquid_range"]["mean_return_pct"] == pytest.approx(all40, abs=1e-9)
    # the plain baseline adds the 12 quiet stocks (1% daily range)
    all52 = _mean((40 * _mean(_ret(d, k) for d in leaders) + 12 * _ret(fx.QUIET_DRIFT, k)) / 52
                  for k in DEV_K_21)
    assert g["baseline_liquid"]["mean_return_pct"] == pytest.approx(all52, abs=1e-9)
    assert g["q5"]["mean_excess_vs_liquid_range_pct"] == pytest.approx(top8 - 0.2 - all40, abs=1e-9)
    # with 40 qualifiers both "top 50" lists are all 40: the baseline less the cost
    for name in ("top_score", "top_rating"):
        assert g[name]["positions"] == 40 * len(DEV_K_21)
        assert g[name]["mean_excess_vs_liquid_range_pct"] == pytest.approx(-0.2, abs=1e-9)
        assert g[name]["hit_rate_positive"] == 1.0 and g[name]["hit_rate_vs_benchmark"] == 1.0
    assert [g[f"q{q}"]["positions"] for q in range(1, 6)] == [8 * len(DEV_K_21)] * 5
    # the quiet stocks drift faster than SPY, so every baseline member beats it too
    assert g["baseline_liquid"]["hit_rate_vs_benchmark"] == 1.0
    # at 5 sessions the slowest leaders earn under the 0.2% cost: a hit rate below 1
    assert ordered_run["development"]["horizons"]["5"]["groups"]["q1"]["hit_rate_positive"] < 1.0


def test_excursions_are_in_daily_range_units(ordered_run):
    """Every leader rises every session with a high 2% over its close and a low 2% under
    (a 4% daily range). From the entry (the formation close), the best high of the next
    10 sessions is the 10th close x 1.02 and the worst low is the 1st close x 0.98."""
    fav, adv = [], []
    for k in [k for k in DEV_K if k + 10 <= DEV - 1]:
        for i in range(fx.LEADERS):
            d = fx.leader_drift(i)
            fav.append((fx.growth(d, fx.WARMUP + k, 10) * 1.02 - 1) * 100 / 4.0)
            adv.append((fx.growth(d, fx.WARMUP + k, 1) * 0.98 - 1) * 100 / 4.0)
    got = ordered_run["development"]["excursions_in_daily_ranges"]["top_score"]["10"]
    assert got["positions"] == len(fav)
    assert got["median_favourable"] == pytest.approx(median(fav), abs=1e-9)
    assert got["median_adverse"] == pytest.approx(median(adv), abs=1e-9)
    assert got["median_adverse"] < 0 < got["median_favourable"]


def test_turnover_extended_share_and_the_market_split(ordered_run):
    dev = ordered_run["development"]
    for name in ("top_score", "top_rating"):
        assert dev["top_lists"][name]["turnover"] == 0.0, "the same 40 names on every date"
        # a steady riser sits about one true range over its 50-day average, never four
        assert dev["top_lists"][name]["share_extended"] == 0.0
        assert dev["top_lists"][name]["extended_known"] == 40 * 202
    split = dev["market_split"]
    assert split["benchmark_above_its_200_day"]["dates"] == 202
    assert split["benchmark_above_its_200_day"]["primary_spread_pct"] == pytest.approx(
        dev["primary"]["top_minus_bottom_pct"])
    assert split["benchmark_below_its_200_day"] == {
        "dates": 0, "primary_spread_pct": None, "top_score_excess_vs_liquid_range_pct": None,
        "top_rating_excess_vs_liquid_range_pct": None}


def test_leave_one_out_reports_and_changes_nothing(ordered_run):
    """Without Strength the order is the Group part's alone, which runs the other way
    (a strong stock's group is weaker without it): the spread falls. Steady and High are
    the same for every leader and Group only re-sorts inside the same order: no gain."""
    loo = ordered_run["judgement"]["leave_one_out"]
    assert set(loo) == {"strength", "steady", "high", "group"}
    assert all(v["decision"] == "KEEP" and v["removal_helps"] is False for v in loo.values())
    assert all(g < -5 for g in loo["strength"]["gain_by_year"].values())
    for part in ("steady", "high", "group"):
        assert all(abs(g) < 1e-9 for g in loo[part]["gain_by_year"].values()), part
        assert loo[part]["years_compared"] == 4
    assert ordered_run["score"]["weights"] == {"strength": 0.40, "steady": 0.25, "high": 0.20, "group": 0.15}


def test_a_date_with_fewer_than_25_qualifiers_is_skipped_and_said(tmp_path):
    """For 50 sessions half the leaders are rated 70: 20 qualifiers, under the floor."""
    dbs = fx.build(tmp_path, "ordered", extras=False, weak_sessions=range(100, 150))
    dev = _stored(*dbs)["development"]
    weak = [d for d in dev["dates"] if d["date"] in {fx.SESSIONS[k] for k in range(100, 150, 5)}]
    assert len(weak) == 10
    assert all(d["qualifiers"] == 20 and d["scored"] == 20 and d["spread_pct"] is None
               and d["skipped"] == "fewer than 25 scored qualifiers" for d in weak)
    assert dev["dates_skipped"] == {"fewer than 25 scored qualifiers": 10}
    assert dev["dates_used"] == 192 and dev["primary"]["dates"] == 188


# ───────────────────────── the holdout ──────────────────────────────────────

def test_unlocked_the_holdout_is_read_and_agrees(ordered_unlocked):
    r = ordered_unlocked
    assert r["holdout_unlocked"] is True and r["sessions"]["holdout"]["read"] is True
    assert r["sessions"]["last_date_read"] == fx.SESSIONS[-1]
    hold = r["holdout"]
    assert [d["date"] for d in hold["dates"]] == [fx.SESSIONS[k] for k in HOLD_K]
    assert hold["primary"]["dates"] == len(HOLD_K_21)
    assert hold["primary"]["top_minus_bottom_pct"] == pytest.approx(
        _mean(fx.expected_spread(k) for k in HOLD_K_21), abs=1e-9)
    c4 = r["judgement"]["criteria"]["4_same_sign_in_holdout"]
    assert c4["asked"] and c4["met"] and c4["holdout_dates"] == len(HOLD_K_21)
    assert r["verdict"] == "PASS"


def test_a_development_result_does_not_depend_on_reading_the_holdout(ordered_run, ordered_unlocked):
    """The embargo: a development window never reads a holdout bar, so the development
    numbers and the three development criteria are the same in both runs."""
    assert ordered_unlocked["development"] == ordered_run["development"]
    a, b = ordered_unlocked["judgement"]["criteria"], ordered_run["judgement"]["criteria"]
    for key in ("1_spread_positive_interval_off_zero", "2_positive_in_3_of_4_years", "3_quintiles_in_order"):
        assert a[key] == b[key], key
    assert ordered_unlocked["judgement"]["leave_one_out"] == ordered_run["judgement"]["leave_one_out"]


def test_locked_the_holdout_is_not_read(ordered, ordered_run, tmp_path):
    """Ruin everything after the last development session (every rating of the holdout
    sessions, every bar after the cutoff) and the locked run does not change by a digit.
    The session DATES stay: they are what says where the holdout begins."""
    bars_db, screener_db = (shutil.copy(p, tmp_path / p.name) for p in ordered)
    cutoff = fx.SESSIONS[DEV - 1]
    with sqlite3.connect(str(screener_db)) as conn:
        n = conn.execute("UPDATE rs_rating_history SET ibd = 1, score = -score * 7 "
                         "WHERE session > ?", (cutoff,)).rowcount
        conn.commit()
    with sqlite3.connect(str(bars_db)) as conn:
        m = conn.execute("UPDATE ohlcv SET o = o * 9, h = h * 9, l = l / 9, c = c * 0.01, v = 1 "
                         "WHERE ts > ?", (data.ymd(cutoff),)).rowcount
        conn.commit()
    assert n > 10_000 and m > 10_000, "the holdout was really ruined"
    assert _strip(_stored(bars_db, screener_db)) == _strip(ordered_run)
    # ... and unlocked, the ruin shows: the control for the line above
    ruined = _stored(bars_db, screener_db, unlock_holdout=True)
    assert ruined["holdout"] != _stored(*ordered, unlock_holdout=True)["holdout"]
    assert ruined["development"] == ordered_run["development"], "and still not in development"


def test_the_store_refuses_a_holdout_read_at_the_reader(ordered):
    with data.Store(*ordered) as store:
        assert store.cutoff == fx.SESSIONS[DEV - 1] and len(store.holdout) == spec.HOLDOUT_SESSIONS
        assert store.ratings(fx.SESSIONS[DEV - 1])["L39"] == (90, pytest.approx(1.39))
        for s in (fx.SESSIONS[DEV], fx.SESSIONS[-1]):
            with pytest.raises(data.HoldoutLocked):
                store.ratings(s)
        bars = store.daily_bars("L00", 0)
        assert bars[-1]["t"] == data.ymd(store.cutoff) and len(bars) == fx.WARMUP + DEV
    with data.Store(*ordered, unlock_holdout=True) as store:
        assert store.cutoff == fx.SESSIONS[-1]
        assert store.ratings(fx.SESSIONS[-1])["L00"] == (90, pytest.approx(1.0))
        assert len(store.daily_bars("L00", 0)) == fx.N


def test_with_no_development_sessions_nothing_is_read_and_the_test_fails(tmp_path):
    """Today's store holds about one year of rating sessions: all of it is holdout."""
    bars_db, screener_db = fx.build(tmp_path, "ordered", extras=False)
    with sqlite3.connect(str(screener_db)) as conn:
        conn.execute("DELETE FROM rs_rating_history WHERE session < ?", (fx.SESSIONS[-252],))
        conn.commit()
    r = _stored(bars_db, screener_db)
    assert r["sessions"]["development"] == {"count": 0, "first": None, "last": None}
    assert r["sessions"]["holdout"]["count"] == 252 and r["sessions"]["last_date_read"] is None
    assert r["development"]["formation_dates"] == 0 and r["counts"] == {}
    assert r["verdict"] == "FAIL"
    c = r["judgement"]["criteria"]
    assert "no interval" in c["1_spread_positive_interval_off_zero"]["reason"]
    assert "found 0" in c["2_positive_in_3_of_4_years"]["reason"]
    json.dumps(r, allow_nan=False)


# ───────────────────────── noise, and holdout-only ──────────────────────────

def test_the_noise_market_fails(noise):
    r = _stored(*noise)
    assert r["verdict"] == "FAIL" and r["judgement"]["passed"] is False
    c1 = r["judgement"]["criteria"]["1_spread_positive_interval_off_zero"]
    assert not c1["met"] and c1["interval"]["low"] < 0, "the interval does not exclude zero"
    assert abs(c1["spread_pct"]) < 0.3, "a shuffled score orders nothing"
    # the same universe as the ordered market: only the order of the scores differs
    assert all((d["floor"], d["qualifiers"], d["scored"]) == (52, 40, 40) for d in r["development"]["dates"])
    assert r["development"]["primary"]["dates"] == 198


def test_a_score_that_works_only_in_the_holdout_fails_and_the_holdout_stays_unread(holdout_only):
    locked = _stored(*holdout_only)
    assert locked["verdict"] == "FAIL" and locked["holdout"] is None
    assert not locked["judgement"]["criteria"]["1_spread_positive_interval_off_zero"]["met"]
    assert locked["judgement"]["criteria"]["4_same_sign_in_holdout"]["asked"] is False
    assert abs(locked["development"]["primary"]["top_minus_bottom_pct"]) < 0.3
    unlocked = _stored(*holdout_only, unlock_holdout=True)
    # in the holdout the score does order returns ...
    assert unlocked["holdout"]["primary"]["top_minus_bottom_pct"] == pytest.approx(
        _mean(fx.expected_spread(k) for k in HOLD_K_21), abs=1e-9)
    # ... and the verdict is still FAIL: the development criteria are not the holdout's to rescue
    assert unlocked["verdict"] == "FAIL"
    assert unlocked["development"] == locked["development"]


# ───────────────────────── point in time ────────────────────────────────────

def test_nothing_after_a_dates_own_window_can_change_it(ordered, ordered_run, tmp_path):
    """Ruin every bar and every rating after rated session 500. Every formation date
    whose 21-session window ended by then reads exactly as before, and so does what each
    date up to then held; the dates after it do change (the control)."""
    bars_db, screener_db = (shutil.copy(p, tmp_path / p.name) for p in ordered)
    line = 500
    with sqlite3.connect(str(screener_db)) as conn:
        conn.execute("UPDATE rs_rating_history SET score = -score WHERE session > ?", (fx.SESSIONS[line],))
        conn.commit()
    with sqlite3.connect(str(bars_db)) as conn:
        conn.execute("UPDATE ohlcv SET c = c * 0.7, h = h * 0.7, l = l * 0.7, o = o * 0.7 "
                     "WHERE ts > ? AND ticker LIKE 'L3%'", (data.ymd(fx.SESSIONS[line]),))
        conn.commit()
    ruined = _stored(bars_db, screener_db)["development"]
    clean = ordered_run["development"]
    by_r = {p["date"]: p["spread_pct"] for p in ruined["primary"]["by_date"]}
    by_c = {p["date"]: p["spread_pct"] for p in clean["primary"]["by_date"]}
    settled = [fx.SESSIONS[k] for k in DEV_K if k + 21 <= line]
    assert len(settled) == 96 and all(by_r[d] == by_c[d] for d in settled)
    held = {d["date"]: d for d in ruined["dates"]}
    for d in clean["dates"]:
        if d["date"] <= fx.SESSIONS[line]:
            assert {k: held[d["date"]][k] for k in ("floor", "qualifiers", "scored", "skipped")} == \
                   {k: d[k] for k in ("floor", "qualifiers", "scored", "skipped")}
    later = [fx.SESSIONS[k] for k in DEV_K_21 if k > line]
    assert sum(1 for d in later if by_r.get(d) != by_c[d]) > 50, "the ruin is real"


def test_todays_screener_rows_give_three_facts_and_no_number(ordered, ordered_run, tmp_path):
    """The fixture's `screener_rows` holds only ticker, is_etf, industry and sector, so a
    harness that read today's price, rating or 1-month change would have crashed. And the
    facts it does read are today's: move a leader to another industry and the result moves."""
    with sqlite3.connect(str(ordered[1])) as conn:
        assert [r[1] for r in conn.execute("PRAGMA table_info(screener_rows)")] == [
            "ticker", "is_etf", "industry", "sector"]
    bars_db, screener_db = (shutil.copy(p, tmp_path / p.name) for p in ordered)
    with sqlite3.connect(str(screener_db)) as conn:
        conn.execute("UPDATE screener_rows SET is_etf = 1 WHERE ticker = 'L39'")
        conn.commit()
    r = _stored(bars_db, screener_db)
    assert all((d["floor"], d["qualifiers"]) == (51, 39) for d in r["development"]["dates"])
    assert r["counts"]["symbols_not_a_stock_or_unknown"] == 4


# ───────────────────────── read-only, and the command line ──────────────────

def test_a_harness_connection_cannot_write(ordered):
    conn = data.connect_ro(ordered[0])
    try:
        for sql in ("CREATE TABLE x (a)", "DELETE FROM ohlcv", "UPDATE ohlcv SET c = 0",
                    "INSERT INTO ohlcv VALUES ('Z', 'D', 1, 1, 1, 1, 1, 1)"):
            with pytest.raises(sqlite3.OperationalError, match="readonly"):
                conn.execute(sql)
    finally:
        conn.close()
    with pytest.raises(sqlite3.OperationalError):
        data.connect_ro(ordered[0].parent / "not_there.db")
    assert not (ordered[0].parent / "not_there.db").exists(), "mode=ro never creates a file"


def test_the_run_opens_everything_read_only_and_writes_only_out(ordered, tmp_path, monkeypatch, capsys):
    before = {p: _sha(p) for p in ordered}
    listing = sorted(p.name for p in ordered[0].parent.iterdir())
    out = tmp_path / "result.json"
    opened, written = [], []
    real_connect, real_open = sqlite3.connect, builtins.open

    def _connect(database, *a, **k):
        opened.append((str(database), k.get("uri", False)))
        return real_connect(database, *a, **k)

    def _open(file, mode="r", *a, **k):
        if any(c in mode for c in "wax+"):
            written.append(str(file))
        return real_open(file, mode, *a, **k)
    monkeypatch.setattr(sqlite3, "connect", _connect)
    monkeypatch.setattr(builtins, "open", _open)
    code = cli.main(["--bars-db", str(ordered[0]), "--screener-db", str(ordered[1]),
                     "--out", str(out), "--ratings", "stored", "--max-formation-dates", "30"])
    monkeypatch.undo()
    assert code in (0, 1)
    assert len(opened) == 2, opened
    assert all(uri and name.startswith("file:") and name.endswith("?mode=ro") for name, uri in opened), opened
    assert written == [str(out)], "the harness opened something else for writing"
    assert {p: _sha(p) for p in ordered} == before, "a database changed"
    assert sorted(p.name for p in ordered[0].parent.iterdir()) == listing, "a file appeared beside the databases"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["result.json"]
    capsys.readouterr()


def test_the_command_line_writes_the_file_and_prints_the_verdict_last(ordered, tmp_path, capsys):
    out = tmp_path / "r.json"
    code = cli.main(["--bars-db", str(ordered[0]), "--screener-db", str(ordered[1]), "--out", str(out), "--ratings", "stored"])
    printed = capsys.readouterr().out.strip().splitlines()
    assert code == 0
    assert printed[-1] == spec.CAVEAT
    assert printed[-2] == "VERDICT: PASS on development data (the holdout has not been read)"
    # the plan is printed up front, before anything is read: where the ratings come from,
    # the session range, the holdout, the formation dates and the non-overlapping windows
    assert printed[:4] == [
        "Ratings: read from the stored rating history.",
        f"Development sessions: 1,008 ({fx.SESSIONS[0]} to {fx.SESSIONS[DEV - 1]}).",
        f"Holdout: the newest 252 sessions ({fx.SESSIONS[DEV]} to {fx.SESSIONS[-1]}), not read.",
        f"Formation dates: 202 in development ({fx.SESSIONS[0]} to {fx.SESSIONS[DEV_K[-1]]}), "
        "spanning 41 non-overlapping 21-session windows."]
    verdict = printed[4:]
    assert verdict[0] == "Leader score test (pre-registered 2026-11-14)"
    assert verdict[2] == "Ratings: read from the stored rating history."
    assert [l.split()[0] for l in verdict[3:7]] == ["PASS", "PASS", "PASS", "NOT"]
    assert not any("UNLOCKED" in l for l in printed)

    def _no_nan(token):
        raise AssertionError(f"{token} in the output file")
    result = json.loads(out.read_text(encoding="utf-8"), parse_constant=_no_nan)
    assert result["verdict"] == "PASS" and result["verdict_lines"] == verdict
    assert result["plan"]["formation_dates"] == {"development": 202, "holdout": 0}
    assert result["plan"]["independent_blocks"] == {"development": 41, "holdout": 0}
    assert result["ratings"] == {"mode": "stored"} and result["ratings_cross_check"] is None
    assert result["caveat"] == spec.CAVEAT and result["preregistered"] == "2026-11-14"
    for key in ("constants", "seed", "sessions", "counts", "development", "judgement", "score", "universe"):
        assert key in result, key


def test_unlocking_is_said_loudly_before_and_after(holdout_only, tmp_path, capsys):
    out = tmp_path / "r.json"
    code = cli.main(["--bars-db", str(holdout_only[0]), "--screener-db", str(holdout_only[1]),
                     "--out", str(out), "--ratings", "stored", "--unlock-holdout"])
    printed = capsys.readouterr().out
    assert code == 1, "a failed test exits 1"
    assert printed.count("HOLDOUT UNLOCKED. This run READS the newest 252 sessions") == 2
    lines = printed.strip().splitlines()
    assert lines[0].startswith("=====") and lines[1].startswith("HOLDOUT UNLOCKED")
    assert any(l.startswith("HOLDOUT UNLOCKED: the newest 252 sessions were read") for l in lines)
    assert any(l.endswith("READ in this run.") and l.startswith("Holdout: the newest 252 sessions") for l in lines)
    assert lines[-1] == spec.CAVEAT and lines[-2] == "VERDICT: FAIL"
    assert any(l.split()[0] in ("PASS", "FAIL") and "4. Same sign in the holdout" in l for l in lines)
    assert json.loads(out.read_text(encoding="utf-8"))["holdout_unlocked"] is True


def test_a_quick_run_is_marked_and_reads_only_the_newest_dates(ordered, tmp_path, capsys):
    out = tmp_path / "q.json"
    code = cli.main(["--bars-db", str(ordered[0]), "--screener-db", str(ordered[1]),
                     "--out", str(out), "--ratings", "stored", "--max-formation-dates", "12"])
    printed = capsys.readouterr().out.strip().splitlines()
    result = json.loads(out.read_text(encoding="utf-8"))
    assert result["quick_run"] is True and result["max_formation_dates"] == 12
    assert [d["date"] for d in result["development"]["dates"]] == [fx.SESSIONS[k] for k in DEV_K[-12:]]
    quick = result["verdict_lines"][1]
    assert quick in printed and quick.startswith("QUICK RUN") and "NOT a test record" in quick
    # 12 dates are fewer than one bootstrap block: no interval, so no pass
    assert code == 1 and result["verdict"] == "FAIL"
    assert result["judgement"]["criteria"]["1_spread_positive_interval_off_zero"]["interval"] is None


def test_bad_arguments_and_unreadable_databases_exit_2_and_write_nothing(ordered, tmp_path, capsys):
    out = tmp_path / "x.json"
    assert cli.main(["--bars-db", str(tmp_path / "missing.db"), "--screener-db", str(ordered[1]),
                     "--out", str(out), "--ratings", "stored"]) == 2
    assert cli.main(["--bars-db", str(ordered[0]), "--screener-db", str(ordered[1]),
                     "--out", str(out), "--ratings", "stored", "--max-formation-dates", "0"]) == 2
    with pytest.raises(SystemExit):
        cli.main(["--bars-db", str(ordered[0])])
    assert not out.exists() and not (tmp_path / "missing.db").exists()
    capsys.readouterr()


_IMPORT_PROBE = r'''
import builtins, os, sqlite3, sys
seen = []
rc, ro, rm = sqlite3.connect, builtins.open, os.makedirs
def _connect(*a, **k):
    seen.append(("connect", str(a[:1])))
    return rc(*a, **k)
def _open(file, mode="r", *a, **k):
    if any(c in str(mode) for c in "wax+"):
        seen.append(("open", str(file), mode))
    return ro(file, mode, *a, **k)
def _makedirs(*a, **k):
    seen.append(("makedirs", str(a[:1])))
    return rm(*a, **k)
sqlite3.connect, builtins.open, os.makedirs = _connect, _open, _makedirs
import api.services.rs_leader_test.__main__
heavy = sorted(n for n in sys.modules if n in ("api.main", "api.services.auth_db", "api.services.bars_sqlite",
                                                "api.services.screener.snapshot_builder"))
print(repr((seen, heavy)))
'''


def test_importing_the_harness_opens_nothing_and_loads_no_server():
    """On the pod the command is run beside the live web process: importing it must not
    open a database, create a directory or pull in the app, the auth store or the bars
    store's own (read-write, WAL) connection."""
    import pathlib
    import subprocess
    import sys
    root = pathlib.Path(__file__).resolve().parents[1]
    r = subprocess.run([sys.executable, "-B", "-c", _IMPORT_PROBE], cwd=str(root), capture_output=True,
                       text=True, timeout=300)
    assert r.returncode == 0, r.stderr[-800:]
    assert r.stdout.strip().splitlines()[-1] == "([], [])"


def test_the_package_runs_as_a_module():
    import importlib.util
    assert importlib.util.find_spec("api.services.rs_leader_test.__main__") is not None
    assert cli._parser().prog == "python -m api.services.rs_leader_test"
    assert {a.dest for a in cli._parser()._actions} >= {
        "bars_db", "screener_db", "out", "max_formation_dates", "unlock_holdout",
        "ratings", "from_date", "industry_db"}
