"""Shape drawing round 3 (saucer, IPO base) and the rounds it must not move. Synthetic bars only (public repo).

What is railed here:
  * GOLDEN: the double bottom (released to members at round 2) and the ascending base draw byte-identically to
    origin/master before round 3 on a fixed family of perturbed synthetic series, and so do the saucer at round 2
    and the IPO base at round 1 (still callable with `rnd=` for the lab) -- each family with a non-vacuity floor
    (enough of its series actually draw, so an all-None golden cannot pass);
  * the saucer's round-3 gate withholds, each for its own reason, a base that round 2 draws: too deep, low off
    centre, a high above the lip before the breakout bars (stale), a single crash bar, a W (poor fit, or a fitting bowl with
    too many big swings), a drop onto a long shelf --
    and still draws the clean saucer;
  * the IPO base's round-3 gate withholds a backfilled listing (and an unknown one: fails closed), a flat
    near-issue-price line, a gappy / flat-bar / illiquid series, a one-bar spike top, and a later base -- and
    still draws the clean first base;
  * the member literals for the saucer and the IPO base stay None.
"""
import json
import random

import pytest

from api.services import auto_structures as AS
from api.services.pattern_engine import shape_draw as SD
from api.services.screener import base_catalog as bc
from tests.test_shape_draw import ASC_PTS, IPO_PTS, SAU_PTS, W_PTS, series


# ------------------------------------------------------------------------------------------- golden
def _noisy(points, seed):
    r = random.Random("shape_draw_golden|%s" % seed)
    pts = []
    for j, (i, p) in enumerate(points):
        if 0 < j < len(points) - 1 and points[j][0] - points[j - 1][0] > 7 and points[j + 1][0] - points[j][0] > 7:
            i += r.randint(-3, 3)
        pts.append((i, p * (1 + r.uniform(-0.04, 0.04))))
    b = series(pts)
    for x in b:
        f = 1 + r.gauss(0, 0.003)
        for key in ("o", "h", "l", "c"):
            x[key] = round(x[key] * f, 4)
    return b


_BASE = {"double-bottom": W_PTS, "ascending-base": ASC_PTS, "saucer-r2": SAU_PTS, "ipo-r1": IPO_PTS}
N_SEEDS = 40
OFFSETS = (0, 3, 8)


def family(fam):
    """(bars, i) for every series of a golden family: N_SEEDS perturbations x OFFSETS as-of bars."""
    for s in range(N_SEEDS):
        b = _noisy(_BASE[fam], "%s|%d" % (fam, s))
        for off in OFFSETS:
            yield b, len(b) - 1 - off


#: (family, function name, kwargs(bars) common to the old and the current module)
GOLDEN_FAMILIES = (
    ("double-bottom", "double_bottom_drawing", lambda b: {}),
    ("ascending-base", "ascending_base_drawing", lambda b: {}),
    ("saucer-r2", "saucer_drawing", lambda b: {}),
    ("ipo-r1", "ipo_base_drawing", lambda b: {"first_t": b[0]["t"]}),
)
#: The extra kwargs the CURRENT module needs to draw the round the golden was taken at.
CURRENT_ROUND_KW = {"saucer-r2": {"rnd": 2}, "ipo-r1": {"rnd": 1}}
#: Non-vacuity: at least this many drawings per family must exist (not None) in the golden.
MIN_FIRES = 20


def draw_json(fn, b, i, **kw):
    return json.dumps(fn(b, i, **kw), sort_keys=True)


def _golden():
    import pathlib
    return json.loads((pathlib.Path(__file__).parent / "fixtures" / "shape_draw_golden.json").read_text("utf-8"))


@pytest.mark.parametrize("fam,fn_name,kw", GOLDEN_FAMILIES, ids=[f[0] for f in GOLDEN_FAMILIES])
def test_the_released_and_judged_rounds_draw_byte_identically_to_before_round_3(fam, fn_name, kw):
    g = _golden()[fam]
    assert sum(1 for x in g if x != "null") >= MIN_FIRES, "golden is vacuous for %s" % fam
    fn = getattr(SD, fn_name)
    now = [draw_json(fn, b, i, **kw(b), **CURRENT_ROUND_KW.get(fam, {})) for b, i in family(fam)]
    assert len(now) == len(g)
    diff = [j for j, (a, e) in enumerate(zip(now, g)) if a != e]
    assert not diff, "%s moved on %d of %d series, first at %d" % (fam, len(diff), len(g), diff[0])


def test_the_golden_was_taken_before_round_3():
    g = _golden()
    assert len(g["rev"]) == 40 and all(c in "0123456789abcdef" for c in g["rev"])
    # the golden's saucer and IPO drawings carry the old round stamps, so they cannot be a round-3 re-bless
    rounds = {fam: {json.loads(x)["draw_round"] for x in g[fam] if x != "null"} for fam in ("saucer-r2", "ipo-r1")}
    assert rounds == {"saucer-r2": {2}, "ipo-r1": {1}}


def test_the_default_rounds_are_round_3_and_the_old_ones_stay_callable():
    assert SD.SAUCER_DRAW_ROUND == 3 and SD.IPO_BASE_DRAW_ROUND == 3
    assert SD.SAUCER_ROUNDS == (2, 3) and SD.IPO_ROUNDS == (1, 3)
    assert SD.DOUBLE_BOTTOM_DRAW_ROUND == 2 and SD.ASCENDING_BASE_DRAW_ROUND == 2
    with pytest.raises(ValueError):
        SD.saucer_drawing(series(SAU_PTS), 10, rnd=1)
    with pytest.raises(ValueError):
        SD.ipo_base_drawing(series(IPO_PTS), 10, rnd=2)


def test_member_literals_stay_unset_for_saucer_and_ipo():
    assert AS.MEMBER_SAUCER_ROUND is None and AS.MEMBER_IPO_BASE_ROUND is None
    assert AS.MEMBER_DOUBLE_BOTTOM_ROUND == 2


# ------------------------------------------------------------------------------------------- saucer r3
def sau(b, rnd=3):
    why = []
    return SD.saucer_drawing(b, len(b) - 1, _why=why, rnd=rnd), why


def _check_round2_draws_round3_withholds(b, reason):
    d2, why2 = sau(b, rnd=2)
    assert d2 is not None, why2                       # the control: round 2 draws this series
    d3, why3 = sau(b)
    assert d3 is None and why3[-1] == reason, why3


def test_saucer_r3_draws_the_clean_saucer():
    d, why = sau(series(SAU_PTS))
    assert d is not None, why
    assert d["draw_round"] == 3 and d["pivot"] == d["lip"] and d["marks"][0]["kind"] == "lip"


def test_saucer_r3_withholds_a_base_deeper_than_its_ceiling():
    _check_round2_draws_round3_withholds(series([(0, 50), (150, 80), (270, 61), (300, 61.5), (400, 76),
                                                 (401, 76)]), "r3_too_deep")


def test_saucer_r3_withholds_a_low_off_centre():
    _check_round2_draws_round3_withholds(series([(0, 50), (150, 80), (190, 69), (215, 69.5), (330, 78),
                                                 (331, 78)]), "r3_low_off_center")


def test_saucer_r3_withholds_a_right_side_that_already_traded_above_the_lip():
    b = series(SAU_PTS)
    d, why = sau(b)
    assert d is not None, why
    k = len(b) - 12
    b[k]["h"] = round(d["lip"] * 1.01, 4)             # a wick above the lip, no close above it
    _check_round2_draws_round3_withholds(b, "r3_poked_lip")


def test_saucer_r3_withholds_a_crash_bar():
    b = series(SAU_PTS)
    k = 175
    pc = b[k - 1]["c"]
    b[k].update({"o": round(pc * 0.923, 4), "c": round(pc * 0.92, 4), "h": round(pc * 0.926, 4),
                 "l": round(pc * 0.916, 4)})          # a gap-down bar mid-decline, well above the base low
    _check_round2_draws_round3_withholds(b, "r3_crash_bar")


def test_saucer_r3_withholds_a_w_whose_middle_peak_nearly_reaches_the_lip():
    _check_round2_draws_round3_withholds(series([(0, 50), (150, 80), (197, 70.5), (221, 69.1), (241, 78.4),
                                                 (291, 69.4), (309, 78.8), (310, 78.8)]), "r3_poor_fit")


def test_saucer_r3_withholds_a_w_that_still_fits_a_bowl():
    _check_round2_draws_round3_withholds(series([(0, 50), (150, 80), (200, 68), (240, 73), (280, 68.4),
                                                 (330, 78), (331, 78)]), "r3_jagged")


def test_saucer_r3_withholds_a_drop_then_a_long_shelf():
    _check_round2_draws_round3_withholds(series([(0, 50), (150, 80), (163, 71.1), (223, 68.4), (310, 76.2),
                                                 (400, 77.7), (401, 77.7)]), "r3_not_a_bowl")


def test_zigzag_counts_legs_of_at_least_the_threshold():
    assert SD._zigzag_legs([10, 9, 8, 9, 10], 1.5) == 2
    assert SD._zigzag_legs([10, 8, 10, 8, 10], 1.5) == 4
    assert SD._zigzag_legs([10, 9.5, 10, 9.5, 10], 1.5) == 0


def test_quad_fit_reads_a_bowl():
    c, vertex, r2 = SD._quad_fit([(x / 10 - 0.5) ** 2 for x in range(11)])
    assert c > 0 and vertex == pytest.approx(0.5) and r2 == pytest.approx(1.0)


# ------------------------------------------------------------------------------------------- IPO r3
def ipo(b, shared=1, rnd=3):
    why = []
    return SD.ipo_base_drawing(b, len(b) - 1, first_t=b[0]["t"], _why=why, rnd=rnd, first_t_shared=shared), why


def _ipo_r1_draws_r3_withholds(b, reason, shared=1):
    d1, why1 = ipo(b, shared=shared, rnd=1)
    assert d1 is not None, why1
    d3, why3 = ipo(b, shared=shared)
    assert d3 is None and why3[-1] == reason, why3


def test_ipo_r3_draws_the_clean_first_base():
    d, why = ipo(series(IPO_PTS))
    assert d is not None, why
    assert d["draw_round"] == 3 and d["pivot"] == pytest.approx(max(x["h"] for x in series(IPO_PTS)))


@pytest.mark.parametrize("shared", [None, 0, 5, 40, "1", 1.0])
def test_ipo_r3_withholds_a_backfilled_or_unknown_listing(shared):
    _ipo_r1_draws_r3_withholds(series(IPO_PTS), "r3_backfill_listing", shared=shared)


@pytest.mark.parametrize("shared", [1, 4])
def test_ipo_r3_takes_a_first_date_few_tickers_share_as_a_listing(shared):
    assert ipo(series(IPO_PTS), shared=shared)[0] is not None


def test_ipo_r3_withholds_a_flat_line_near_an_issue_price():
    _ipo_r1_draws_r3_withholds(series([(0, 10), (20, 10.4), (45, 10.05), (70, 10.3), (71, 10.3)]),
                               "r3_too_shallow")


def test_ipo_r3_withholds_a_gappy_series():
    import datetime
    b = series(IPO_PTS)
    for k in (20, 40, 60):                             # three missing weeks: each shifts the rest a week later
        for x in b[k:]:
            d = datetime.date(int(str(x["t"])[:4]), int(str(x["t"])[4:6]), int(str(x["t"])[6:])) + \
                datetime.timedelta(days=7)
            x["t"] = int(d.strftime("%Y%m%d"))
    _ipo_r1_draws_r3_withholds(b, "r3_gappy")


def test_ipo_r3_withholds_flat_bars():
    b = series(IPO_PTS)
    for k in range(5, 12):
        b[k]["h"] = b[k]["l"] = b[k]["o"] = b[k]["c"]
    _ipo_r1_draws_r3_withholds(b, "r3_flat_bars")


def test_ipo_r3_withholds_an_illiquid_base():
    b = series(IPO_PTS, vol=20_000)                    # ~$0.5M a day
    _ipo_r1_draws_r3_withholds(b, "r3_illiquid")


def test_ipo_r3_withholds_a_one_bar_spike_top():
    b = series(IPO_PTS)
    top = max(range(len(b)), key=lambda k: b[k]["h"])
    pc = b[top - 1]["c"]                               # one thrust bar standing alone above the whole base
    b[top].update({"o": pc, "c": round(pc * 1.04, 4), "h": round(pc * 1.041, 4), "l": round(pc * 0.999, 4)})
    _ipo_r1_draws_r3_withholds(b, "r3_spike_top")


def test_ipo_r3_withholds_a_later_base():
    pts = [(0, 20), (10, 24), (35, 21), (50, 26), (70, 33), (90, 27), (110, 31), (111, 31)]
    _ipo_r1_draws_r3_withholds(series(pts), "r3_later_base")


def test_ipo_earlier_base_reads_a_long_deep_pause_before_the_top():
    b = series([(0, 20), (10, 24), (35, 21), (50, 26), (70, 33), (71, 33)])
    top = max(range(len(b)), key=lambda k: b[k]["h"])
    got = bc.ipo_earlier_base(b, top)
    assert got is not None and got[1] - got[0] >= bc.IPO_MIN_BARS
    assert bc.ipo_earlier_base(series(IPO_PTS), 40) is None


def test_ipo_listing_is_backfill_fails_closed():
    assert bc.ipo_listing_is_backfill(None) and bc.ipo_listing_is_backfill(5) and bc.ipo_listing_is_backfill(0)
    assert not bc.ipo_listing_is_backfill(1) and not bc.ipo_listing_is_backfill(4)
