"""Synthetic bar series for the "no detector may RAISE" rails. ONE authority.

⛔ WHY THIS IS A MODULE AND NOT A COPY-PASTE. Three rails now drive detector
families over these series (`test_no_detector_raises` for the screener's
base-catalog structures + `bar_character` cascade, `test_no_pattern_detector_
raises` for the pattern engine's 85). The brief for the third said "copy the
`_walk` generator" — copying it would have put a SECOND AUTHORITY over the
fixture, and the first time either copy learned something (the real-calendar-
dates fix below, the opening-gap fix) the other would have kept driving the
detectors through the shallower path while still reading as equivalent. That is
`lesson_a_second_authority_over_one_value` applied to a test fixture.

`walk()` is moved here BYTE-IDENTICAL from `test_no_detector_raises._walk`, so
every seed produces exactly the series it produced before.
"""
import datetime
import random

_DAY0 = datetime.date(2023, 1, 2)

BARS = 620           # comfortably past the deepest `min_bars` (210) + 200-dma


# ─────────────────────────────────────────────────────────────────────────────
#  the `t` coordinate — and why it has two spellings
# ─────────────────────────────────────────────────────────────────────────────
#
# ⛔⛔ `pattern_engine.types.Bar` documents `t: int  # unix seconds`, but the
# only thing that ever builds those bars in production is
# `bars_sqlite.get_bars(sym, "D", 200)`, and that store's own docstring says
# "ts is YYYYMMDD for D/W/M, unix seconds for intraday". So on the DAILY path —
# which is every scheduled pattern scan — the engine is fed YYYYMMDD ints, not
# the seconds its type says. Both spellings are swept: the documented contract
# AND the one production actually delivers. A rail that only drove the
# documented one would leave the shipped path unmeasured.

def ymd_t(i: int) -> int:
    """Bar `t` as the screener + daily-bars store spell it: a YYYYMMDD int."""
    return int((_DAY0 + datetime.timedelta(days=i)).strftime("%Y%m%d"))


def epoch_t(i: int, minutes: int = 0) -> int:
    """Bar `t` as `pattern_engine.types.Bar` documents it: unix seconds."""
    if minutes:
        base = datetime.datetime(2023, 1, 3, 14, 30, tzinfo=datetime.timezone.utc)
        return int((base + datetime.timedelta(minutes=minutes * i)).timestamp())
    d = _DAY0 + datetime.timedelta(days=i)
    return int(datetime.datetime(d.year, d.month, d.day,
                                 tzinfo=datetime.timezone.utc).timestamp())


def walk(seed: int, bars: int = BARS, t=ymd_t) -> list:
    """A price series with trends, gaps, reversals and volume swings.

    ⛔ NOT a smooth line. A flat or monotonic series is rejected by nearly every
    detector's early gates, so it would exercise none of the later arithmetic
    where this bug class lives — a fixture that cannot reach the defect is not
    a rail.
    """
    rng = random.Random(seed)
    out, price = [], 20.0 + rng.random() * 180.0
    drift = rng.uniform(-0.0015, 0.0025)
    for i in range(bars):
        if rng.random() < 0.03:                 # regime flip
            drift = rng.uniform(-0.003, 0.004)
        shock = rng.gauss(0, 0.022) + drift
        if rng.random() < 0.02:                 # gap
            shock += rng.choice([-1, 1]) * rng.uniform(0.03, 0.12)
        o = price
        price = max(0.5, price * (1.0 + shock))
        c = price
        spread = abs(c - o) + o * rng.uniform(0.002, 0.03)
        h = max(o, c) + spread * rng.random()
        l = max(0.01, min(o, c) - spread * rng.random())
        v = int(abs(rng.gauss(1_000_000, 400_000))) + rng.randint(1, 50_000)
        if rng.random() < 0.05:                 # volume spike
            v *= rng.randint(3, 12)
        # ⛔ REAL calendar dates. The first draft used `20240101 + i`, which
        # produces 20240132 — and the Weinstein stage detectors parse `t` as a
        # date, so they raised on every series. That was the FIXTURE lying, not
        # the product, and it is worth recording: this rail is sensitive enough
        # to catch a malformed timestamp, so a failure here is read carefully
        # before anything in `api/` is touched.
        out.append({"t": t(i), "o": o, "h": h, "l": l, "c": c, "v": v})
    return out


def gap_walk(seed: int, bars: int = BARS, t=ymd_t, degenerate: bool = True) -> list:
    """`walk()` plus the two things `walk()` structurally cannot produce.

    ⛔⛔ THE BLIND SPOT THIS EXISTS FOR, MEASURED 2026-08-31. `walk()` sets
    `o = price` — the PRIOR CLOSE — on every single bar, so `open == prev_close`
    identically and **no bar in it ever gaps**. Its own comment calls the ±3-12%
    shock a "gap", but that shock moves the CLOSE; the open follows it. Every
    gap-conditioned predicate was therefore unreachable: measured over 20 seeds,
    0 of `bar_character`'s 12 gap heads matched and the engine's
    `power_earnings_gap` / `episodic_pivot` never fired. Opening the bar away
    from the prior close took `bar_character` from 28 of 55 heads matched to 42,
    and the pattern engine from 43 of 85 detectors firing to 54 — i.e. it moved
    26 detector bodies from "never executed" to "executed and clean".

    ⛔ AND DEGENERATE SESSIONS ARE NOT HYPOTHETICAL. `bar_character` carries a
    `no-trade` head (`not f["v"]`) and a `flat-bar` head (`rng <= 0`) precisely
    because the universe delivers zero-volume and zero-range bars; the Book was
    once frozen at 0 trades by 118 zero-price bars. A fixture with none of them
    leaves every `x / rng` and `max(...)` on that path unmeasured.
    """
    rng = random.Random(100_000 + seed)
    out, price = [], 20.0 + rng.random() * 180.0
    drift = rng.uniform(-0.0015, 0.0025)
    for i in range(bars):
        if rng.random() < 0.03:
            drift = rng.uniform(-0.003, 0.004)
        pc = price
        # THE OPENING GAP — ~18% of sessions open away from the prior close.
        g, r = 0.0, rng.random()
        if r < 0.09:
            g = rng.uniform(0.005, 0.09)
        elif r < 0.18:
            g = -rng.uniform(0.005, 0.09)
        o = max(0.02, pc * (1.0 + g))
        c = max(0.02, o * (1.0 + rng.gauss(0, 0.022) + drift))
        spread = abs(c - o) + o * rng.uniform(0.002, 0.03)
        h = max(o, c) + spread * rng.random()
        l = max(0.01, min(o, c) - spread * rng.random())
        v = int(abs(rng.gauss(1_000_000, 400_000))) + rng.randint(1, 50_000)
        if rng.random() < 0.06:
            v *= rng.randint(3, 14)
        if rng.random() < 0.05:
            v = int(v * rng.uniform(0.05, 0.3))          # dried-up volume
        if degenerate:
            if rng.random() < 0.02:                      # no-trade session
                o = h = l = c = pc
                v = 0
            elif rng.random() < 0.02:                    # flat / zero-range bar
                o = h = l = c = pc
        price = c
        out.append({"t": t(i), "o": o, "h": h, "l": l, "c": c, "v": v})
    return out


def edge_series(t=ymd_t):
    """Named degenerate series, each one a shape the universe really delivers.

    Yields `(name, bars)`. The name is what a failing rail prints, so it has to
    say which shape broke the detector, not just that one did.
    """
    yield "constant-price-no-volume", [
        {"t": t(i), "o": 10.0, "h": 10.0, "l": 10.0, "c": 10.0, "v": 0}
        for i in range(300)]
    yield "sub-penny", [
        {"t": t(i), "o": 0.011, "h": 0.013, "l": 0.009, "c": 0.012, "v": 100}
        for i in range(300)]
    yield "zero-volume-trending", [
        {"t": t(i), "o": 10 + i * 0.01, "h": 10 + i * 0.01 + 0.02,
         "l": 10 + i * 0.01 - 0.02, "c": 10 + i * 0.01, "v": 0}
        for i in range(300)]
    yield "single-bar", [
        {"t": t(0), "o": 5.0, "h": 6.0, "l": 4.0, "c": 5.5, "v": 10}]
    yield "two-bars", [
        {"t": t(i), "o": 5.0, "h": 6.0, "l": 4.0, "c": 5.5, "v": 10}
        for i in range(2)]
    yield "five-figure-price", [
        {"t": t(i), "o": 5e5, "h": 6e5, "l": 4e5, "c": 5.5e5, "v": 3}
        for i in range(300)]
