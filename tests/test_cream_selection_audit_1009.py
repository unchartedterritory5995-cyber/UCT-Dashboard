"""The 10/09 EOD Top Flow card audit (owner-approved fixes, 2026-10-13).

Every case here is a contract shape that was ON the real 10/09 card (numbers from
production `/api/live/massive/cream?target_date=2026-10-09` and the per-tier
`/recent` alerts behind it). Each test drives `compute_cream` end to end with the
heavy scan and the flow.db meta stubbed out, so it fails on the pre-fix selector
by BEHAVIOUR, not by an import error.
"""
import pytest

from api import live_massive_router as lmr

DAY = "10/9/2026"


def _alert(tk, cp, strike, exp, *, dte, grade, tier, direction, aap, av, oi,
           spot=None, mny=None, label=None, aid=None):
    return {
        "id": aid or f"{tk}-{cp}-{strike}-{exp}-{tier}",
        "ticker": tk, "cp": cp, "strike": float(strike), "exp": exp, "dte": dte,
        "grade": grade, "_tierKey": tier, "_direction": direction,
        "aggAskPremium": float(aap), "aggAskVolume": float(av), "priorOI": oi,
        "spot": spot, "moneynessPct": mny, "moneynessLabel": label,
        "averageFillPrice": 10.0, "source": "stocks",
    }


@pytest.fixture
def run(monkeypatch):
    """run(alerts, **env) -> compute_cream output. Every alert is served under the
    tier named in its own `_tierKey`; every contract is non-weekly + sweep-backed."""
    for k in ("CREAM_MAX_DTE", "CREAM_MAX_OTM_PCT", "CREAM_FRESH_MIN_VOL",
              "CREAM_TWO_SIDED_RATIO", "CREAM_MIN_GRADE", "CREAM_TOP_N",
              "CREAM_MAX_PER_TICKER", "CREAM_MIN_DTE"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(lmr, "_cream_contract_meta", lambda today, floor=0.0: {})
    monkeypatch.setattr(lmr, "_build_day_stats", lambda today: {})
    monkeypatch.setattr(lmr, "_load_thresholds", lambda: {"direction_max_itm_pct": 20.0})

    def _run(alerts, **env):
        for k, v in env.items():
            monkeypatch.setenv(k, str(v))
        monkeypatch.setattr(
            lmr, "_compute_recent_core",
            lambda today, lim, mg, sb, tier, cur, **kw:
                ([a for a in alerts if a["_tierKey"] == tier], {}))
        return lmr.compute_cream(DAY)
    return _run


def _syms(rows):
    return [(r["sym"], r["cp"], r["strike"]) for r in rows]


# ── far-dated / far-OTM / thin fresh rows ────────────────────────────────────

SNDK_800P = _alert("SNDK", "P", 800, "1/19/2029", dte=833, grade="C", tier="leaps",
                   direction="Bear", aap=16_064_533, av=1451, oi=None,
                   spot=1580.97, mny=-97.6, label="OTM")
MU_1190C = _alert("MU", "C", 1190, "1/19/2029", dte=833, grade="D", tier="leaps",
                  direction="Bull", aap=1_569_807, av=51, oi=None,
                  spot=1031.0, mny=-13.4, label="OTM")


def test_a_far_dated_non_A_leap_cannot_top_the_bear_side(run):
    # The real 10/09 top bear row: $16.1M, 833 DTE, grade C, OI 0.
    out = run([SNDK_800P])
    assert out["bear"] == []
    assert out["dropped"].get("far_dated") == 1


def test_an_A_graded_far_leap_still_qualifies(run):
    # TSM 470P 1/2028 A+ (10/12 card) is real LEAP conviction and must survive.
    tsm = _alert("TSM", "P", 470, "1/21/2028", dte=466, grade="A+", tier="alpha_leaps",
                 direction="Bear", aap=10_381_510, av=1370, oi=518, spot=500.0)
    assert _syms(run([tsm])["bear"]) == [("TSM", "P", 470.0)]


def test_far_otm_is_measured_on_spot_and_drops_the_row(run):
    # With the DTE rule off, SNDK 800P is still 49% below spot.
    out = run([SNDK_800P], CREAM_MAX_DTE=0)
    assert out["bear"] == []
    assert out["dropped"].get("far_otm") == 1


def test_a_thin_fresh_strike_does_not_pass_on_freshness_alone(run):
    # MU $1190C: 51 contracts into an OI-0 strike. DTE/OTM rules off to isolate it.
    out = run([MU_1190C], CREAM_MAX_DTE=0, CREAM_MAX_OTM_PCT=0, CREAM_MIN_GRADE="")
    assert out["bull"] == []
    assert out["dropped"].get("thin_fresh") == 1


def test_every_knob_off_restores_the_old_admission(run):
    out = run([SNDK_800P, MU_1190C], CREAM_MAX_DTE=0, CREAM_MAX_OTM_PCT=0,
              CREAM_FRESH_MIN_VOL=0, CREAM_MIN_GRADE="")
    assert _syms(out["bear"]) == [("SNDK", "P", 800.0)]
    assert _syms(out["bull"]) == [("MU", "C", 1190.0)]


# ── deep-ITM on every row ────────────────────────────────────────────────────

def test_deep_itm_drops_a_row_with_a_CLEAN_aggregate_direction(run):
    # Pre-fix, _cream_deep_itm only ran on the size-tier side-recovery path, so a
    # clean `_direction` on a 22.6%-ITM put sailed through.
    put = _alert("SNDK", "P", 1940, "12/17/2026", dte=69, grade="A", tier="alpha",
                 direction="Bear", aap=1_805_492, av=300, oi=100,
                 spot=1500.0, mny=22.6, label="ITM")
    out = run([put])
    assert out["bear"] == []
    assert out["dropped"].get("deep_itm") == 1


def test_itm_under_the_cap_is_kept(run):
    put = _alert("MU", "P", 1060, "10/16/2026", dte=7, grade="A", tier="alpha",
                 direction="Bear", aap=6_866_142, av=1419, oi=776,
                 spot=1022.85, mny=3.5, label="ITM")
    assert _syms(run([put])["bear"]) == [("MU", "P", 1060.0)]


# ── two-sided names ──────────────────────────────────────────────────────────

def _nvda():
    return [
        _alert("NVDA", "C", 207.5, "10/16/2026", dte=7, grade="A", tier="ask_accum",
               direction="Bull", aap=7_064_175, av=3142, oi=241, spot=192.0),
        _alert("NVDA", "P", 245, "1/15/2027", dte=98, grade="A", tier="alpha",
               direction="Bear", aap=8_113_350, av=3559, oi=2731, spot=231.47,
               mny=5.5, label="ITM"),
    ]


def _mu():
    return [
        _alert("MU", "C", 1040, "12/18/2026", dte=70, grade="B", tier="ask_accum",
               direction="Bull", aap=4_546_676, av=495, oi=410, spot=1027.0),
        _alert("MU", "P", 1060, "10/16/2026", dte=7, grade="A", tier="alpha",
               direction="Bear", aap=6_866_142, av=1419, oi=776, spot=1022.85,
               mny=3.5, label="ITM"),
        _alert("MU", "P", 1010, "9/17/2027", dte=343, grade="A", tier="alpha_leaps",
               direction="Bear", aap=3_154_105, av=193, oi=186, spot=1030.6),
    ]


def test_an_offsetting_name_is_dropped_from_BOTH_sides_and_reported(run):
    # NVDA 10/09: $7.06M bull vs $8.11M bear -> 1.15x, no direction to claim.
    out = run(_nvda())
    assert out["bull"] == [] and out["bear"] == []
    assert out["two_sided"] == [{"sym": "NVDA", "bull": 7_064_175, "bear": 8_113_350}]


def test_a_name_that_wins_its_tug_of_war_2x_stays_on_the_winning_side_only(run):
    # MU 10/09: $10.0M bear vs $4.55M bull -> 2.2x, a clean bear read.
    out = run(_mu())
    assert [r["sym"] for r in out["bull"]] == []
    assert sorted(_syms(out["bear"])) == [("MU", "P", 1010.0), ("MU", "P", 1060.0)]
    assert out["two_sided"] == []


def test_no_name_ever_appears_on_both_sides(run):
    out = run(_nvda() + _mu())
    assert not ({r["sym"] for r in out["bull"]} & {r["sym"] for r in out["bear"]})


def test_ratio_zero_disables_netting(run):
    out = run(_nvda(), CREAM_TWO_SIDED_RATIO=0)
    assert [r["sym"] for r in out["bull"]] == ["NVDA"]
    assert [r["sym"] for r in out["bear"]] == ["NVDA"]


# ── grade-first ranking + grade floor ────────────────────────────────────────

def _graded():
    return [
        _alert("PLTR", "C", 215, "10/16/2026", dte=7, grade="D", tier="bullish",
               direction="Bull", aap=9_000_000, av=7480, oi=2620),
        _alert("MSTR", "C", 160, "10/16/2026", dte=7, grade="B", tier="ask_accum",
               direction="Bull", aap=8_831_527, av=24479, oi=12241),
        _alert("GOOGL", "C", 345, "2/19/2027", dte=133, grade="A", tier="alpha",
               direction="Bull", aap=1_232_902, av=2080, oi=635),
    ]


def test_rows_rank_by_grade_first_then_premium(run):
    out = run(_graded(), CREAM_MIN_GRADE="")
    assert [r["sym"] for r in out["bull"]] == ["GOOGL", "MSTR", "PLTR"]


def test_the_default_grade_floor_drops_D_rows(run):
    out = run(_graded())
    assert [r["sym"] for r in out["bull"]] == ["GOOGL", "MSTR"]


# ── JSON shape the Morning Wire reads ────────────────────────────────────────

def test_payload_carries_tickers_and_side_for_the_wire(run):
    out = run(_nvda() + _mu() + _graded())
    assert set(out) >= {"date", "bull", "bear", "two_sided", "dropped", "params"}
    for side in ("bull", "bear"):
        for r in out[side]:
            assert r["sym"] and r["_dir"] == side.capitalize()
    assert out["params"]["two_sided_ratio"] == 2.0
    assert out["params"]["min_grade"] == "C"


# ── card header counts unique names ──────────────────────────────────────────

def test_card_header_counts_unique_names_not_rows():
    from api.watchlist_card import _names_label
    rows = [{"sym": "MU"}, {"sym": "MU"}, {"sym": "T"}, {"sym": "T"}, {"sym": "SNDK"}]
    assert _names_label(rows) == "3 tickers"
    assert _names_label([{"sym": "MU"}, {"sym": "MU"}]) == "1 ticker"


def test_card_still_renders_with_two_contracts_per_name():
    from api.watchlist_card import render_watchlist_card
    rows = [{"sym": "MU", "cp": "P", "strike": 1060, "exp": "10/16/2026", "prem": 6.8e6},
            {"sym": "MU", "cp": "P", "strike": 1010, "exp": "9/17/2027", "prem": 3.1e6}]
    png = render_watchlist_card([], rows, "October 9, 2026", title="Top Flow")
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
