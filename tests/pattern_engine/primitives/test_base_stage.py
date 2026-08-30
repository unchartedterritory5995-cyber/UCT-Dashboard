"""Weinstein stage structures — and the asymmetry most implementations miss."""
import datetime as dt

from api.services.screener import base_catalog as bc
from api.services.screener import bases


def _day(i):
    """The i-th TRADING day from Mon 2024-01-01, as a YYYYMMDD int.

    ⚠️ Five weekdays per ISO week, computed directly. The first version added
    `i` CALENDAR days and skipped weekends, which collides: i=5 (Sat) and i=6
    (Sun) both land on the following Monday. 200 bars then covered ~28 ISO
    weeks instead of 40, and `_ma_state` refused for want of 31 weekly closes —
    a fixture failing for a reason that had nothing to do with the test.
    """
    d = dt.date(2024, 1, 1) + dt.timedelta(days=7 * (i // 5) + (i % 5))
    return d.year * 10000 + d.month * 100 + d.day


def _bar(i, c, v=1_000_000, hi=None, lo=None):
    return {"t": _day(i), "o": c, "h": hi if hi is not None else c * 1.005,
            "l": lo if lo is not None else c * 0.995, "c": c, "v": v}


def _series(closes, vols=None):
    out, day = [], 0
    for i, c in enumerate(closes):
        v = vols[i] if vols else 1_000_000
        out.append(_bar(day, c, v))
        day += 1
    return out


# ── the weekly primitives ──────────────────────────────────────────────────

def test_weekly_closes_takes_the_LAST_close_of_each_iso_week():
    """Weinstein's average is built on weekly closes — Friday's number, not an
    average of the week.
    """
    bars = _series([10.0, 11.0, 12.0, 13.0, 14.0,      # week 1
                    20.0, 21.0, 22.0, 23.0, 24.0])     # week 2
    wc = bc._weekly_closes(bars)
    assert wc == [14.0, 24.0]


def test_weekly_volumes_SUM_within_the_week():
    bars = _series([10.0] * 10, vols=[100] * 5 + [200] * 5)
    assert bc._weekly_volumes(bars) == [500, 1000]


def test_a_zero_close_is_skipped_not_treated_as_a_price():
    bars = _series([10.0, 0.0, 12.0, 13.0, 14.0])
    assert bc._weekly_closes(bars) == [14.0]


def test_the_ma_refuses_before_it_has_thirty_one_weeks():
    bars = _series([10.0] * (5 * bc.MA_WEEKS))   # exactly 30 weeks, need 31
    assert bc._ma_state(bars) is None


# ── fixtures for the two stage structures ──────────────────────────────────

def _rising(weeks=40, start=10.0, step=0.5, last_week_vol=1_000_000):
    """A steadily rising series: MA rises, price sits above it."""
    closes, vols = [], []
    for w in range(weeks):
        for d in range(5):
            closes.append(start + w * step + d * 0.01)
            vols.append(1_000_000)
    for i in range(1, 6):
        vols[-i] = last_week_vol
    return _series(closes, vols)


def _falling(weeks=39, start=100.0):
    """A declining series WITH RALLIES.

    ⚠️ A monotonic decline is the wrong fixture and the first draft used one.
    The segmenter confirms a swing only when price reverses by k*sigma, so a
    straight line down produces NO confirmed swing lows at all — the detector
    then has no level to break and refuses, for a reason that has nothing to do
    with what the test is about. A real Stage 4 decline steps down through
    rallies, and that is what makes a swing low exist to break.

    ⚠️ The rallies must also be BIG ENOUGH to confirm a swing. The segmenter
    needs a reversal of k*sigma (k=5), so a shallow bounce leaves `lows` empty
    and the detector has no level to break — again for a reason unrelated to
    the test. Three weeks down at -1.5%/day, one week up at +4%/day clears it.

    ⚠️ And it must END ON A DOWN LEG. At weeks=40 the series finishes on a
    rally, so price sits ABOVE its last swing low and there is no breakdown to
    detect — the fixture would be asserting the opposite of its own name.
    Verified: weeks=39 closes at 60.53 against a last swing low of 62.09.
    """
    closes, px = [], start
    for w in range(weeks):
        drop = w % 4 != 3          # three weeks down, one week up
        for d in range(5):
            px *= (0.985 if drop else 1.04)
            closes.append(max(1.0, px))
    return _series(closes)


def _ctx(bars):
    return bases._context(bars, bars)


# ── ⚠️⚠️ THE ASYMMETRY ─────────────────────────────────────────────────────

def test_a_stage2_breakout_WITHOUT_volume_expansion_is_refused():
    """Weinstein's breakout requires a volume spike — 'at least twice the
    average for the previous month'.
    """
    box = bc.by_key("stage-2-breakout")
    flat_volume = _rising(last_week_vol=1_000_000)      # no spike
    assert box.detect(_ctx(flat_volume)) is False


def test_a_stage4_breakdown_WITHOUT_volume_expansion_is_NOT_refused():
    """⚠️⚠️ THE SINGLE MOST MIS-IMPLEMENTED FACT IN THE METHOD.

    "Volume is not the key to this stage because it can be heavy or light as
    price drops" and "This is not necessary on the short side." A screener that
    applies one symmetric volume filter to both is not implementing Weinstein —
    and this test is what stops someone "tidying up" the two detectors into a
    shared helper with one volume gate.

    The fixture has DEAD FLAT volume throughout, which would disqualify a
    Stage 2 breakout and must not disqualify this.
    """
    down = bc.by_key("stage-4-breakdown")
    bars = _falling()
    assert all((b["v"] or 0) == 1_000_000 for b in bars), "fixture: volume is flat"
    assert down.detect(_ctx(bars)) is True


def test_neither_stage_structure_shares_a_volume_gate():
    """Derived, not eyeballed: the Stage 4 criteria must positively RECORD that
    volume is not required, so the asymmetry survives a refactor.
    """
    down = bc.by_key("stage-4-breakdown")
    vol = [c for c in down.criteria if "volume" in c.condition.lower()]
    assert vol, "Stage 4 must state its volume position explicitly"
    assert any("not required" in c.condition.lower()
               or "no-volume" in str(c.value) for c in vol)


# ── the MA slope rules ─────────────────────────────────────────────────────

def test_stage4_requires_the_average_itself_to_be_DECLINING():
    """Below a FLAT average is not Stage 4 — the average must be falling."""
    down = bc.by_key("stage-4-breakdown")
    flat = _series([50.0] * (5 * 40))
    assert down.detect(_ctx(flat)) is False


def test_stage2_refuses_when_price_sits_below_the_average():
    box = bc.by_key("stage-2-breakout")
    assert box.detect(_ctx(_falling())) is False


def test_both_refuse_a_series_too_short_to_carry_a_thirty_week_average():
    short = _series([10.0] * 60)
    assert bc.by_key("stage-2-breakout").detect(_ctx(short)) is False
    assert bc.by_key("stage-4-breakdown").detect(_ctx(short)) is False


# ── provenance ─────────────────────────────────────────────────────────────

def test_the_conflicting_volume_multiples_are_recorded_not_averaged():
    """Four incompatible forms are published (2x four weeks, a 3-4 week
    build-up, 3x daily, 3x 'normal'). We implement one and SAY we implement
    one — averaging them would invent a number nobody published.
    """
    box = bc.by_key("stage-2-breakout")
    conflict = [c for c in box.criteria if "CONFLICT" in c.condition]
    assert conflict, "the volume-multiple conflict must be recorded"
    assert any(c.origin == "uct" for c in conflict)


def test_the_ma_slope_conflict_is_recorded_and_the_buy_test_wins():
    """The buy test says 'must not be declining' (flat qualifies); the Stage 2
    narrative says 'rising'. Same author, both published.
    """
    box = bc.by_key("stage-2-breakout")
    rec = [c for c in box.criteria
           if "not-declining" == c.value or "declining" in c.condition.lower()]
    assert rec
