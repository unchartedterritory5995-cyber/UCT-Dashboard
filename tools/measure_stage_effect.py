"""Does the IBD base STAGE change a structure's outcome? Measured, per bucket.

⭐⭐ THE QUESTION IBD NEVER ANSWERS. `base_count.py`'s docstring records the
central negative finding: across every source reached, **IBD publishes no win
rate, no average gain, no failure rate and no sample size for any base stage.**
The preference is asserted four ways ("usually best", "tend to be risky", "tend
to produce larger gains", "seldom a charm") and quantified zero times. This
harness measures it on our own universe, per structure, so the filter can be
kept or dropped on evidence instead of on a quotation.

⛔⛔ THE ANSWER IS STRUCTURE-DEPENDENT, WHICH IS WHY THIS TAKES A KEY. A first
pass measured `ema-crossback` at +18.5pp for early stages (n=511 vs 76),
`darvas-box` at -1.4pp (n=593 vs 35 — wrong sign, indistinguishable from zero),
and `parabolic-extension` on FOUR late-stage anchors, which is not a
measurement. One number for "the stage effect" would have averaged those into
a claim none of them supports.

⛔ THE SLOW `stage_at` PATH IS THE ONLY CORRECT ONE. `base_count` ends with a
deleted fast whole-history timeline and the reason: `zigzag` scales its
threshold to the series' own return sigma, so segmenting `bars[:i+1]` is not a
prefix of segmenting `bars` — the one-pass version LEADS, which is look-ahead in
the direction that flatters a late-stage filter. This harness pays for the slow
path, and it can afford to because it only asks for a stage where the DETECTOR
FIRED. Detection is the cheap half (`BaseCtx` segments lazily and
`parabolic_extension_state` never asks for swings), so a scan of hundreds of
thousands of anchors costs a few thousand stage calls.

⭐⭐ HISTORY DEPTH IS A CONFOUND, AND IT IS MEASURED HERE RATHER THAN ASSUMED.
The stage counter counts bases since the last reset, so a SHORT series has less
to count and biases every stage LOW — which pushes genuinely late bases into the
early bucket and would shrink any real effect toward zero. The first pass used a
900-bar tail. This one takes whatever `bars.db` holds (median 4,458 daily bars,
p90 8,045) and prints a TRUNCATION CONTROL: the same fired anchors re-staged
against a shallow prefix, so the direction and size of that bias is a number in
the output rather than a caveat in prose.

⛔ AND A SMALL LATE BUCKET IS REPORTED AS A SMALL LATE BUCKET. Below
`--min-late` the late rate is WITHHELD, not printed — `lesson_two_points_do_not_
establish_a_rate`. The floor's default is 75, which is the size of the
`ema-crossback` late bucket that produced the one answer this result is compared
against; a bucket smaller than that cannot be compared to it.

Usage:
    python tools/measure_stage_effect.py                       # parabolic-extension, full universe
    python tools/measure_stage_effect.py --sample 400 --depth 900     # reproduce the first pass
    python tools/measure_stage_effect.py --only ema-crossback,darvas-box
"""
from __future__ import annotations

import argparse
import collections
import math
import os
import pathlib
import random
import sqlite3
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Sandboxes every /data pin and arms the shared-root tripwire. MUST come before
# any product import — the paths are captured at module import.
import conftest                                                     # noqa: E402

# ⛔ THE TWO DBs THIS READS ARE POINTED BACK AT THE LIVE FILES, AND BOTH ARE
# OPENED READ-ONLY — the same idiom as `tools/measure_anchor_clustering.py` and
# `tools/two_engine_agreement.py`. conftest sandboxes every /data pin, which is
# right for a test and wrong for a measurement: an empty sandbox would make this
# report a confident zero. `bars_sqlite._conn` normally opens bars.db READ-WRITE
# to set PRAGMAs, so it is swapped for a `mode=ro` handle rather than trusted.
# The tripwire stays armed and its verdict is printed at the end.
LIVE_SCREENER = os.environ.get("UCT_LIVE_SCREENER_DB", r"C:\data\screener.db")
LIVE_BARS = os.environ.get("UCT_LIVE_BARS_DB", r"C:\data\bars.db")
os.environ["SCREENER_DB_PATH"] = LIVE_SCREENER

from api.services import bars_sqlite                                # noqa: E402

_RO_BARS = sqlite3.connect(
    "file:%s?mode=ro" % LIVE_BARS.replace("\\", "/"), uri=True,
    check_same_thread=False)
bars_sqlite._conn = lambda: _RO_BARS

from tools.probe import Probe                                       # noqa: E402
from tools.run_lift_ledger import (                                 # noqa: E402
    load_universe, WINDOWS, DEFAULT_WINDOW)
from api.services.screener import base_catalog as bc                # noqa: E402
from api.services.screener import base_count                        # noqa: E402
from api.services.screener import bases                             # noqa: E402
from api.services.screener import lift_ledger as ll                 # noqa: E402
from api.services.screener import technicals                        # noqa: E402

#: The ledger's own draw seed. Same universe, same order, so a result here and a
#: row in the lift ledger describe the same tickers.
UNIVERSE_SEED = 7

#: `load_universe` materialises every ticker's bars at once. At full depth over
#: the whole screener universe that is ~17M bar dicts and several GB, so this
#: harness STREAMS instead — one ticker loaded, scanned, discarded. The ticker
#: draw below is `load_universe`'s, line for line; `verify_loader` proves the
#: two agree rather than asserting it, because a second copy of a universe
#: definition is exactly `lesson_a_second_authority_over_one_value`.
DEFAULT_DEPTH = 20000

#: Minimum usable bars for a ticker to enter the sample — `load_universe`'s.
MIN_TICKER_BARS = 400


def universe_tickers(sample: int, seed: int = UNIVERSE_SEED) -> list:
    """`load_universe`'s ticker draw, without the bars."""
    from api.services.screener import snapshot_db
    db = snapshot_db.get_db_path()
    con = sqlite3.connect("file:%s?mode=ro" % db.replace("\\", "/"), uri=True)
    day = con.execute(
        "select max(snapshot_date) from screener_rows").fetchone()[0]
    tickers = [r[0] for r in con.execute(
        "select ticker from screener_rows where snapshot_date=? order by ticker",
        (day,))]
    random.Random(seed).shuffle(tickers)
    return tickers[:sample]


def bars_for(ticker: str, depth: int):
    """`load_universe`'s per-ticker load, with the depth as a parameter."""
    raw = bars_sqlite.get_bars(ticker, "D", depth) or []
    bars = technicals.usable_bars(
        [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}
         for r in raw])
    return bars if len(bars) >= MIN_TICKER_BARS else None


def verify_loader(n: int = 20) -> None:
    """The CONTROL: at depth 3000 the streamed loader IS `load_universe`.

    ⛔ A HARNESS THAT DEFINES ITS OWN UNIVERSE HAS TWO AUTHORITIES OVER ONE
    VALUE, and the failure is silent — a slightly different draw produces
    slightly different numbers and nothing disagrees out loud. This runs the
    real function on a small sample and demands byte-equality, so the only
    difference between them is the depth this harness varies on purpose.
    """
    ref = load_universe(n)
    mine = {}
    for t in universe_tickers(n):
        b = bars_for(t, 3000)
        if b is not None:
            mine[t] = b
    if set(mine) != set(ref):
        raise SystemExit(
            "loader control FAILED: ticker sets differ (%d vs %d)"
            % (len(mine), len(ref)))
    for t in ref:
        if mine[t] != ref[t]:
            raise SystemExit("loader control FAILED: bars differ for %s" % t)
    print("[control] streamed loader == load_universe(%d) at depth 3000 "
          "(%d tickers)" % (n, len(ref)))


# ── statistics ──────────────────────────────────────────────────────────────

def rate_se(wins: int, n: int):
    if n <= 0:
        return None, None
    p = wins / n
    return p, math.sqrt(p * (1 - p) / n)


def cluster_bootstrap_delta(rows, key_index: int, trials: int = 2000,
                            seed: int = 13):
    """SE of the early-minus-late delta, resampling whole CLUSTERS.

    ⭐ THE NAIVE BINOMIAL SE ASSUMES INDEPENDENT ANCHORS AND THEY ARE NOT.
    `docs/base_lift_clustering.json` measures `parabolic-extension` at
    rho=0.35 over same-DATE groups — a design effect near 7 — because a
    parabolic tape lifts many names on one day. Both the ticker and the date
    axis are resampled here and the WIDER of the two is what a reader should
    believe.

    Returns `(se, dropped)`; `dropped` counts trials in which one bucket came
    up empty and the delta was undefined.
    """
    groups = collections.defaultdict(list)
    for r in rows:
        groups[r[key_index]].append(r)
    keys = list(groups)
    if len(keys) < 2:
        return None, trials
    rng = random.Random(seed)
    out, dropped = [], 0
    for _ in range(trials):
        ew = en = lw = ln = 0
        for _ in range(len(keys)):
            for r in groups[keys[rng.randrange(len(keys))]]:
                if r[3]:                      # early
                    en += 1
                    ew += 1 if r[4] else 0
                else:
                    ln += 1
                    lw += 1 if r[4] else 0
        if en == 0 or ln == 0:
            dropped += 1
            continue
        out.append(ew / en - lw / ln)
    if len(out) < trials // 2:
        return None, dropped
    mean = sum(out) / len(out)
    var = sum((x - mean) ** 2 for x in out) / (len(out) - 1)
    return math.sqrt(var), dropped


# ── the scan ────────────────────────────────────────────────────────────────

def scan(key: str, tickers: list, depth: int, shallow: int, resets: list,
         p: Probe) -> list:
    """Every fired anchor, with its causal stage and its graded outcome.

    Rows are
    `(ticker, date, stage, is_early, won, shallow_stage, i, series_len,
      swept_stages)`.
    """
    st = bc._BY_KEY[key]
    window = WINDOWS.get(key, DEFAULT_WINDOW)
    horizon = ll.HORIZON_BARS
    # ⛔ DERIVED FROM THE BIAS, NEVER TYPED. `parabolic-extension` is bearish and
    # is graded SHORT; grading it long would publish the opposite of the claim
    # its name makes — the `stage-4-breakdown` defect the ledger records.
    direction = ll.direction_for_bias(st.bias)
    rows = []
    for ticker in tickers:
        with p.item(ticker):
            bars = bars_for(ticker, depth)
            if bars is None:
                p.skip("under %d usable bars" % MIN_TICKER_BARS)
                continue
            n = len(bars)
            anchors = 0
            for i in range(window, n - horizon - 1, horizon):
                anchors += 1
                w = bars[max(0, i + 1 - window):i + 1]
                try:
                    if not st.detect(bases._context(w, w)):
                        continue
                except Exception:                              # noqa: BLE001
                    continue
                stage = base_count.stage_at(bars, i)
                if stage is None:
                    continue                  # refused: too little history
                res = ll.outcome(bars, i, horizon=horizon, direction=direction)
                if res is None:
                    continue
                sh = None
                if shallow:
                    # ⭐ THE TRUNCATION CONTROL. The SAME anchor, re-staged
                    # against only the last `shallow` bars of history — which is
                    # what a short tail actually hands the counter.
                    lo = max(0, i + 1 - shallow)
                    sh = base_count.stage_at(bars[lo:i + 1], i - lo)
                # ⛔⛔ THE RESET IS OURS, NOT IBD'S, AND THE LATE BUCKET'S SIZE
                # DEPENDS ON IT. `RESET_DRAWDOWN_PCT` is stamped `origin: uct`
                # and its own comment calls it "a placeholder to be SWEPT,
                # never a number to defend". A stage count that resets on a 33%
                # drawdown will reset OFTEN on exactly the volatile names a
                # parabolic detector selects — so how many late-stage anchors
                # exist at all is partly a consequence of a number we invented.
                # Sweeping it here makes that visible instead of load-bearing.
                swept = tuple(base_count.stage_at(bars, i, r) for r in resets)
                rows.append((ticker, bars[i].get("t"), stage,
                             bool(base_count.is_early_stage(stage)), bool(res),
                             sh, i, n, swept))
            p.ok() if anchors else p.skip("no anchor fits the window")
    return rows


def reset_sweep(rows: list, resets: list, min_late: int) -> None:
    """The same anchors bucketed under other values of OUR reset knob."""
    if not resets:
        return
    print("\nsensitivity to `RESET_DRAWDOWN_PCT` (origin: uct, swept — the "
          "module's own instruction)")
    print("  %-9s%9s%9s%11s%11s%11s%9s"
          % ("reset", "n early", "n late", "early", "late", "delta", "SE"))
    for j, r in enumerate(resets):
        early = [x for x in rows if base_count.is_early_stage(x[8][j]) is True]
        late = [x for x in rows if base_count.is_early_stage(x[8][j]) is False]
        ep, ese = rate_se(sum(1 for x in early if x[4]), len(early))
        lp, lse = rate_se(sum(1 for x in late if x[4]), len(late))
        ok = len(late) >= min_late and len(early) >= min_late
        print("  %-9s%9d%9d%11s%11s%11s%9s"
              % ("%.2f" % r, len(early), len(late),
                 "%.1f%%" % (100 * ep) if ep is not None else "-",
                 "%.1f%%" % (100 * lp) if ok else "(withheld)",
                 "%+.1fpp" % (100 * (ep - lp)) if ok else "-",
                 "%.1fpp" % (100 * math.sqrt(ese ** 2 + lse ** 2))
                 if ok else "-"))


def report(key: str, rows: list, min_late: int, shallow: int,
           tickers_scanned: int, resets: list) -> None:
    st = bc._BY_KEY[key]
    direction = ll.direction_for_bias(st.bias)
    print("\n" + "=" * 74)
    print("%s (%s)  graded %s  window %d  tickers %d"
          % (st.label, key, direction, WINDOWS.get(key, DEFAULT_WINDOW),
             tickers_scanned))
    print("=" * 74)

    if not rows:
        print("NOT ANSWERABLE: the detector fired at no stageable anchor.")
        return

    per_stage = collections.Counter(r[2] for r in rows)
    wins_stage = collections.Counter(r[2] for r in rows if r[4])
    print("\nstage distribution (causal, full history)")
    print("  %-8s%8s%9s%9s" % ("stage", "n", "wins", "rate"))
    for s in sorted(per_stage):
        n, w = per_stage[s], wins_stage[s]
        print("  %-8s%8d%9d%9s"
              % (s, n, w, "%.1f%%" % (100.0 * w / n) if n else "-"))

    early = [r for r in rows if r[3]]
    late = [r for r in rows if not r[3]]
    ew = sum(1 for r in early if r[4])
    lw = sum(1 for r in late if r[4])
    ep, ese = rate_se(ew, len(early))
    lp, lse = rate_se(lw, len(late))

    print("\n%-14s%8s%9s%12s%10s" % ("bucket", "n", "wins", "rate", "SE"))
    print("%-14s%8d%9d%12s%10s"
          % ("early 1-2", len(early), ew,
             "%.1f%%" % (100 * ep) if ep is not None else "-",
             "%.1fpp" % (100 * ese) if ese is not None else "-"))
    answerable = len(late) >= min_late and len(early) >= min_late
    if answerable:
        print("%-14s%8d%9d%12s%10s"
              % ("late 3+", len(late), lw, "%.1f%%" % (100 * lp),
                 "%.1fpp" % (100 * lse)))
    else:
        # ⛔ THE RATE IS WITHHELD, NOT ROUNDED. A rate on a handful of anchors
        # is the thing this harness exists to refuse to print.
        print("%-14s%8d%9s%12s%10s"
              % ("late 3+", len(late), "(withheld)", "(withheld)", "-"))

    if not answerable:
        print("\nNOT ANSWERABLE at this sample size.")
        print("  late-stage anchors obtained: %d (floor %d)"
              % (len(late), min_late))
        print("  The floor is the size of the `ema-crossback` late bucket "
              "(n=76) that")
        print("  produced the one measurable stage answer on file — a bucket "
              "smaller")
        print("  than that cannot be compared with it, so no rate is printed.")
    else:
        delta = ep - lp
        naive = math.sqrt(ese ** 2 + lse ** 2)
        se_t, drop_t = cluster_bootstrap_delta(rows, 0)
        se_d, drop_d = cluster_bootstrap_delta(rows, 1)
        print("\ndelta (early - late)  %+.1fpp" % (100 * delta))
        print("  SE, naive binomial            %.1fpp" % (100 * naive))
        print("  SE, bootstrap over TICKERS    %s (%d/2000 trials dropped)"
              % ("%.1fpp" % (100 * se_t) if se_t else "-", drop_t))
        print("  SE, bootstrap over DATES      %s (%d/2000 trials dropped)"
              % ("%.1fpp" % (100 * se_d) if se_d else "-", drop_d))
        worst = max(x for x in (naive, se_t, se_d) if x is not None)
        print("  believe the WIDEST:           %.1fpp  =>  %+.1fpp +/- %.1fpp"
              % (100 * worst, 100 * delta, 100 * worst))
        print("  delta / widest SE             %.2f" % (delta / worst))

    if shallow:
        seen = [r for r in rows if r[5] is not None]
        if seen:
            lower = sum(1 for r in seen if r[5] < r[2])
            same = sum(1 for r in seen if r[5] == r[2])
            higher = sum(1 for r in seen if r[5] > r[2])
            seen_late = [r for r in seen if not r[3]]
            moved = sum(1 for r in seen_late
                        if base_count.is_early_stage(r[5]) is True)
            print("\ntruncation control: the SAME anchors re-staged on a "
                  "%d-bar history" % shallow)
            print("  stageable at all      %d of %d" % (len(seen), len(rows)))
            print("  shallow stage LOWER   %d (%.1f%%)"
                  % (lower, 100.0 * lower / len(seen)))
            print("  shallow stage same    %d" % same)
            print("  shallow stage HIGHER  %d" % higher)
            print("  late anchors the short history would call EARLY: %d "
                  "of %d" % (moved, len(seen_late)))
            # ⛔ A CONTROL THAT CANNOT BITE PROVES NOTHING. If every fired
            # anchor sits at an index below `shallow`, the two histories ARE
            # the same series and "no difference" is a tautology
            # (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`). So
            # the number of anchors the control could actually have moved is
            # printed beside its verdict.
            deep = [r for r in seen if r[6] + 1 > shallow]
            deep_lower = sum(1 for r in deep if r[5] < r[2])
            idx = sorted(r[6] for r in seen)
            print("  anchors deeper than the short history: %d of %d "
                  "(median anchor index %d)"
                  % (len(deep), len(seen), idx[len(idx) // 2]))
            print("  of those, shallow stage LOWER: %d (%s)"
                  % (deep_lower, "%.1f%%" % (100.0 * deep_lower / len(deep))
                     if deep else "n/a"))
            # ⭐ THE DECOMPOSITION. A short tail changes TWO things at once —
            # which anchors exist (a 900-bar tail only reaches the last ~3.5
            # years) and how each one is staged. Bucketing THIS anchor set by
            # the SHALLOW stage holds the first fixed and varies only the
            # second, so a delta that moves between the two lines is a
            # RESTAGING effect and one that does not is an ERA effect.
            se_rows = [r for r in seen
                       if base_count.is_early_stage(r[5]) is not None]
            se_e = [r for r in se_rows
                    if base_count.is_early_stage(r[5]) is True]
            se_l = [r for r in se_rows
                    if base_count.is_early_stage(r[5]) is False]
            if len(se_e) >= min_late and len(se_l) >= min_late:
                p1, s1 = rate_se(sum(1 for r in se_e if r[4]), len(se_e))
                p2, s2 = rate_se(sum(1 for r in se_l if r[4]), len(se_l))
                print("  same anchors bucketed by the SHALLOW stage: "
                      "%+.1fpp +/- %.1fpp (n %d / %d)"
                      % (100 * (p1 - p2),
                         100 * math.sqrt(s1 ** 2 + s2 ** 2),
                         len(se_e), len(se_l)))

    reset_sweep(rows, resets, min_late)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--only", default="parabolic-extension",
                    help="comma-separated structure keys")
    ap.add_argument("--sample", type=int, default=4000,
                    help="tickers to draw from the ledger's seed-7 order "
                         "(the screener universe is smaller than the default, "
                         "so this takes all of it)")
    ap.add_argument("--depth", type=int, default=DEFAULT_DEPTH,
                    help="daily bars per ticker; the default takes whatever "
                         "bars.db holds")
    ap.add_argument("--shallow", type=int, default=900,
                    help="re-stage every fired anchor on a history this "
                         "short, to measure the truncation bias; 0 to skip")
    ap.add_argument("--min-late", type=int, default=75,
                    help="late-bucket floor below which no rate is printed")
    ap.add_argument("--reset-sweep", default="0.50,0.99",
                    help="extra `RESET_DRAWDOWN_PCT` values to bucket the SAME "
                         "anchors under; '' to skip. The default brackets the "
                         "module's 0.33 with a looser reset and one that "
                         "effectively never fires.")
    ap.add_argument("--skip-control", action="store_true")
    args = ap.parse_args()
    resets = [float(x) for x in args.reset_sweep.split(",") if x.strip()]

    keys = [k.strip() for k in args.only.split(",") if k.strip()]
    unknown = [k for k in keys if k not in bc._BY_KEY]
    if unknown:
        raise SystemExit("unknown structure key(s): %s" % ", ".join(unknown))

    if not args.skip_control:
        verify_loader()

    tickers = universe_tickers(args.sample)
    print("[universe] %d tickers drawn (seed %d), depth %d bars"
          % (len(tickers), UNIVERSE_SEED, args.depth))

    for key in keys:
        t0 = time.time()
        # ⛔ THE FLOOR IS ON TICKERS SCANNED, NOT ON ANCHORS FIRED. A structure
        # that never fires is a real finding; a scan that never RAN is not, and
        # the probe's job is to make those two distinguishable.
        with Probe("stage effect: %s" % key,
                   expect_min=max(1, len(tickers) // 2)) as p:
            rows = scan(key, tickers, args.depth, args.shallow, resets, p)
            p.result("fired anchors with a stage", len(rows))
            p.result("late-stage (3+) anchors", sum(1 for r in rows if not r[3]))
        print("[scan] %s in %.0fs" % (key, time.time() - t0))
        report(key, rows, args.min_late, args.shallow, len(tickers), resets)

    refused = len(conftest.SHARED_ROOT_VIOLATIONS)
    print("\n[tripwire] writes refused into the shared root: %d" % refused)
    return 1 if refused else 0


if __name__ == "__main__":
    raise SystemExit(main())
