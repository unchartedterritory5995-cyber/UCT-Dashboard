"""What each candle label was actually WORTH, measured on our own tape.

⭐ WHY THIS EXISTS. The library names 121 structures. Naming them is a
description; knowing which ones carry information is a different claim, and the
only honest way to make it is to measure our own labels on our own bars. No
competitor can: Bulkowski's numbers come from his universe, and TradingView and
Thinkorswim ship a glyph with no evidence at all.

🔴 THE ONE THING THIS MODULE EXISTS TO GET RIGHT — A HIT RATE IS MEANINGLESS
WITHOUT ITS BASE RATE. Building the T+1 column, bullish patterns "confirmed"
59.9% of the time, which looked like edge until the universe's own opening-gap
rate over the same sessions turned out to be 59%. The patterns had added nothing.
So every number here is an EXCESS over what the same days did anyway:

    excess(label, date) = mean_return(label, date) - mean_return(universe, date)

⛔ AND THE BASE RATE IS DATE-MATCHED, NEVER ALL-TIME. A label that fires mostly
in March 2020 must be judged against March 2020, not against a fifty-year mean.
Comparing a crash-clustered label to the all-time average measures the crash.

⛔ ONE TAPE IS ONE OBSERVATION. 4,000 hammers on the same morning are not 4,000
independent samples — they are one market doing one thing. Every statistic here
is therefore DATE-CLUSTERED: the per-date mean excess is computed first, and the
label's score is the mean and standard error ACROSS DATES. `n_dates` is the
honest sample size and `n_instances` is reported beside it, never instead of it.

⚠️ EXPECT MOST LABELS TO SHOW NOTHING. The literature is consistent about this —
Duvinage/Mazza/Petitjean found 5 of 83 candlestick rules survive transaction
costs, and Marshall/Young/Rose found none on the Dow. Finding that most of our
labels carry no excess is a SUCCESSFUL measurement, not a failed one: it is what
tells us which of the 121 deserve a member's attention, and it is why the column
ships descriptive with no score attached.

⚠️ WHAT THIS IS NOT. It is not a backtest of a strategy: no costs, no slippage,
no position sizing, no stops, and it enters at the close of the labelled bar. It
measures whether a label was FOLLOWED BY unusual returns, which is the only
question a descriptive column can honestly raise.
"""
from __future__ import annotations

import math

#: Forward horizons in sessions. 1 is the next close, 5 a trading week, 10 a
#: fortnight — the window a swing trader actually holds.
HORIZONS = (1, 5, 10)

#: History handed to each classification. Enough for the 40-bar trend warm-up,
#: the 50-day MA that `bar_character` reads, and the 20-day structure windows,
#: with room to spare — and BOUNDED, so the walk stays O(bars) rather than
#: O(bars^2) on a fifty-year series.
WINDOW = 260

#: A label needs to have fired on at least this many DISTINCT SESSIONS before it
#: is reported. Not instances — dates. A structure that appeared 900 times on
#: eleven days has an effective sample of eleven.
MIN_DATES = 30

#: Same-day move buckets, in ATR units. The base rate is matched on (date,
#: bucket) rather than on date alone.
#:
#: 🔴 THE CONFOUND THIS EXISTS FOR, AND IT IS LARGE. Matching on date alone, the
#: first full run said `black-marubozu` (bearish) was followed by **+0.53%**
#: excess at five days and `white-marubozu` (bullish) by **-0.38%** — every
#: bearish label positive, every bullish label negative, a clean inversion across
#: the board. That is not a candle effect. It is SHORT-TERM MEAN REVERSION: a
#: black marubozu means the stock fell hard today, and stocks that fall hard tend
#: to bounce. Date-matching controls for what the MARKET did; it does nothing
#: about what the STOCK did.
#:
#: ⭐ So a label is compared against bars that moved the SAME AMOUNT on the SAME
#: DAY, and what survives is attributable to the SHAPE rather than to the move.
#: ATR units rather than raw percent because a 3% day is ordinary for one name
#: and extraordinary for another.
MOVE_BUCKETS = (-2.0, -1.0, -0.5, 0.0, 0.5, 1.0, 2.0)

#: Forward returns are clipped to +/- this many percent before averaging.
#:
#: 🔴 THE TELL THAT FOUND THIS: the first full run reported `gravestone-doji` at
#: **+6.0% excess with a t-statistic of 1.48**. An enormous mean beside a
#: negligible t is the signature of a handful of observations carrying the whole
#: average — a few sub-dollar names that went up 2,000% in a week. Those moves
#: are REAL, but a statistic they dominate describes them rather than the label.
#:
#: ⭐ Clipping, not dropping. A +2,000% week still counts as the largest possible
#: up-move; it simply stops being worth four hundred ordinary ones. The universe
#: base rate is clipped by the SAME rule in the SAME pass, so the excess is a
#: difference between two like-treated populations.
WINSOR_PCT = 50.0


def _clip(x):
    return WINSOR_PCT if x > WINSOR_PCT else (-WINSOR_PCT if x < -WINSOR_PCT else x)


def move_bucket(ret_pct, atr_pct):
    """Which same-day-move bucket a bar belongs to. ``None`` when ATR is
    unusable — an unmeasurable move cannot be matched, so the bar is dropped
    rather than pooled with moves it may not resemble."""
    if not atr_pct or atr_pct <= 0:
        return None
    z = ret_pct / atr_pct
    lo = 0
    for cut in MOVE_BUCKETS:
        if z < cut:
            return lo
        lo += 1
    return lo


def _usable(bar) -> bool:
    o, h, l, c = bar.get("o"), bar.get("h"), bar.get("l"), bar.get("c")
    if None in (o, h, l, c):
        return False
    return c > 0 and h >= l and all(isinstance(x, (int, float)) for x in (o, h, l, c))


def labels_for(bars, i, single_candle, classify_character, decode_matches):
    """Every label the bar at ``i`` carries — shapes, relations and character.

    ⭐ ALL MATCHES, NOT THE RENDERED HEAD. The column shows one name; the bar
    satisfied several, and each is a hypothesis worth measuring on its own. This
    is also where the statistical power comes from — a relation that is rarely
    the PRIMARY label may still fire often enough to measure.
    """
    window = bars[max(0, i - WINDOW):i + 1]
    out = []
    try:
        got = single_candle(window)
    except Exception:                                          # noqa: BLE001
        got = None
    if got and got.get("candle_matches"):
        out.extend(decode_matches(got["candle_matches"]))
    try:
        ch = classify_character(window)
    except Exception:                                          # noqa: BLE001
        ch = None
    if ch and ch.get("bar_character"):
        out.append("char:" + ch["bar_character"])
    return out


def scan_ticker(bars, single_candle, classify_character, decode_matches,
                entry="close"):
    """Accumulate per-(label, date) return sums for one ticker.

    Returns ``(labelled, universe)`` where each maps a key to
    ``[n, sum_h1, sum_h5, sum_h10, wins_h5]``. The UNIVERSE side is every usable
    bar regardless of label — it is what the base rate is built from, and it is
    accumulated in the SAME pass over the SAME bars so the two can never be
    drawn from different populations.

    ⛔ NO LOOKAHEAD. Classification sees `bars[:i+1]` and nothing after it; the
    returns are measured from `i` forward. The two never touch.
    """
    labelled, universe = {}, {}
    n = len(bars)
    last = n - max(HORIZONS) - 1
    # rolling true-range mean, carried forward so the walk stays O(bars)
    trs = []
    for i in range(WINDOW // 4, last + 1):
        bar = bars[i]
        if not _usable(bar) or bar.get("skip"):
            # ⭐ A SKIPPED BAR STILL SITS IN THE SERIES. It is excluded from the
            # statistics but never removed from `bars`, so the classifier that
            # reads bar i-1 and i-2 keeps seeing the real tape. Deleting bars
            # would splice unrelated sessions together and manufacture gaps and
            # inside bars that never happened.
            continue
        c0 = bar["c"]
        prev = bars[i - 1]
        if not _usable(prev) or not prev["c"]:
            continue
        # 🔴 THE ATR IS LAGGED, AND THIS WAS A REAL BUG. It originally included
        # the bar being classified, which CONTAMINATES THE CONTROL WITH THE THING
        # IT IS CONTROLLING FOR: a long-wick bar has a bigger true range, so it
        # inflated its own denominator, scored a smaller |z|, and was compared
        # against a bucket of MILDER movers than it belonged in. Since the wick
        # shapes are precisely the ones with outsized ranges, the finding they
        # produced could not be trusted until this was lagged.
        # ⭐ The ATR now uses the 14 sessions BEFORE the bar, so the bucket is
        # decided by information that exists before the bar prints.
        atr_pct = (sum(trs) / len(trs)) / c0 * 100.0 if trs else 0.0
        trs.append(max(bar["h"] - bar["l"], abs(bar["h"] - prev["c"]),
                       abs(bar["l"] - prev["c"])))
        if len(trs) > 14:
            del trs[0]
        day_ret = (c0 - prev["c"]) / prev["c"] * 100.0
        bucket = move_bucket(day_ret, atr_pct)
        if bucket is None:
            continue
        # ⛔ ENTRY="OPEN" IS THE BID-ASK BOUNCE CONTROL, AND IT IS NOT OPTIONAL
        # FOR TRUSTING THE WICK RESULT. Measuring from the labelled bar's own
        # CLOSE puts that close in BOTH the label and the return denominator. A
        # long-lower-wick bar closes near its HIGH — more often at the ask — and
        # a long-upper-wick bar closes near its LOW, at the bid. Bid-ask bounce
        # alone would then manufacture EXACTLY the observed pattern: lower wick
        # negative, upper wick positive. Entering at the NEXT OPEN breaks that
        # link, and it is also the only entry a member could actually take.
        base_px = c0
        if entry == "open":
            nxt0 = bars[i + 1]
            if not _usable(nxt0) or not nxt0["o"]:
                continue
            base_px = nxt0["o"]
        fwd = []
        ok = True
        for h in HORIZONS:
            nxt = bars[i + h]
            if not _usable(nxt):
                ok = False
                break
            fwd.append(_clip((nxt["c"] - base_px) / base_px * 100.0))
        if not ok:
            continue
        date = (bar["t"], bucket)          # ⭐ the base-rate key is BOTH
        win5 = 1.0 if fwd[1] > 0 else 0.0

        u = universe.get(date)
        if u is None:
            u = universe[date] = [0, 0.0, 0.0, 0.0, 0.0]
        u[0] += 1
        u[1] += fwd[0]; u[2] += fwd[1]; u[3] += fwd[2]; u[4] += win5

        for lab in labels_for(bars, i, single_candle, classify_character,
                              decode_matches):
            k = (lab, date)
            e = labelled.get(k)
            if e is None:
                e = labelled[k] = [0, 0.0, 0.0, 0.0, 0.0]
            e[0] += 1
            e[1] += fwd[0]; e[2] += fwd[1]; e[3] += fwd[2]; e[4] += win5
    return labelled, universe


def merge(into, other):
    for k, v in other.items():
        e = into.get(k)
        if e is None:
            into[k] = list(v)
        else:
            for j in range(5):
                e[j] += v[j]
    return into


def summarize(labelled, universe, min_dates=MIN_DATES):
    """Per-label excess return over the DATE-MATCHED universe, date-clustered.

    The statistic is built in two steps, and the order is the whole point:
      1. For each DATE the label fired, its mean return minus the universe's
         mean return on that same date — the excess attributable to the label
         rather than to the day.
      2. The label's score is the mean of those per-date excesses, and its
         standard error is their spread across dates. Each date contributes
         once no matter how many tickers carried the label.
    """
    base = {}
    for cell, u in universe.items():
        if u[0]:
            base[cell] = (u[1] / u[0], u[2] / u[0], u[3] / u[0], u[4] / u[0])

    # ⛔ A CELL WITH ONLY THIS LABEL IN IT CANNOT MEASURE THE LABEL. When the
    # label's instances ARE the whole (date, bucket) population, the base rate is
    # the label's own mean and the excess is identically zero — which would
    # silently drag every average toward 0 and understate a real effect. Such
    # cells are dropped, not counted.
    per_label = {}
    for (lab, cell), e in labelled.items():
        u = universe.get(cell)
        b = base.get(cell)
        if not b or not e[0] or not u or u[0] <= e[0]:
            continue
        d = per_label.setdefault(lab, {"ex": [[], [], []], "win": [], "n": 0})
        d["n"] += e[0]
        for j in range(3):
            d["ex"][j].append(e[j + 1] / e[0] - b[j])
        d["win"].append(e[4] / e[0] - b[3])

    out = []
    for lab, d in per_label.items():
        nd = len(d["ex"][0])          # (date, bucket) cells the label fired in
        if nd < min_dates:
            continue
        row = {"label": lab, "n_instances": d["n"], "n_dates": nd}
        for j, h in enumerate(HORIZONS):
            xs = d["ex"][j]
            m = sum(xs) / nd
            var = sum((x - m) ** 2 for x in xs) / (nd - 1) if nd > 1 else 0.0
            se = math.sqrt(var / nd) if nd > 1 else 0.0
            row[f"excess_{h}d"] = m
            row[f"se_{h}d"] = se
            # ⛔ ZERO SPREAD WITH A NON-ZERO MEAN IS INFINITELY SIGNIFICANT, NOT
            # INSIGNIFICANT. Returning 0.0 here — as this did — reports the
            # strongest possible result as the weakest, and it sorts to the
            # bottom of the table where nobody looks. It cannot arise from real
            # bars (identical excess on every session), so in practice this
            # branch is a LOUD SIGNAL THAT THE INPUT IS DEGENERATE: a single
            # session, a constant series, or a label that wholly occupies its
            # cells. Surfacing it as infinity is what makes that visible.
            if se:
                row[f"t_{h}d"] = m / se
            else:
                row[f"t_{h}d"] = 0.0 if not m else math.copysign(math.inf, m)
        w = d["win"]
        row["excess_winrate_5d"] = sum(w) / len(w) * 100.0
        out.append(row)
    out.sort(key=lambda r: -abs(r.get("t_5d", 0.0)))
    return out
