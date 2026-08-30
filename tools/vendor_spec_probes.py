#!/usr/bin/env python3
"""Spec probes -- vendor DEFINITIONS implemented independently, then measured.

    python tools/vendor_spec_probes.py            # measure every probe
    python tools/vendor_spec_probes.py --control  # prove a probe can DISAGREE

⭐ WHAT THIS IS, AND WHAT IT IS NOT. `tools/vendor_truth.py` compares us to
numbers a human READ OFF THE VENDOR'S SCREEN; that is the real oracle and there
is no substitute for it. This file is the half that can run TODAY, with nobody
opening a chart: for the handful of indicators whose formula the vendor PUBLISHES
IN PROSE, it implements that published formula from scratch, in this file, and
measures our engine against it.

⛔⛔ A SPEC PROBE CAN FALSIFY, IT CANNOT CONFIRM. Getting a delta means we
disagree with the vendor's own written definition -- a hard finding, actionable
immediately. Getting NO delta means only that we agree with our READING of their
prose, which is a weaker claim than agreeing with their product: the prose may
be incomplete, and a shared misreading is exactly the failure `ast_conformance`'s
header names about the two lanes. So a green probe NEVER promotes a
`divergences.json` row to `confirmed`; only a real observation may do that, and
`vendor_truth.py` enforces the asymmetry.

⛔ THE IMPLEMENTATIONS BELOW ARE WRITTEN FROM THE VENDOR'S WORDS AND MUST NOT
IMPORT OURS. If a probe called `compute_atr_raw` it would be measuring a function
against itself, which is precisely the circularity
`tests/fixtures/indicators/_generate.py` already has and this whole directory
exists to escape. Every probe here is self-contained arithmetic.
"""

from __future__ import annotations

import argparse
import math
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.abspath(os.path.join(_HERE, ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

NAN = float("nan")


# ─── the bar series every probe runs on ──────────────────────────────────────
# Deterministic and hand-shaped: a trend, a gap, a shock and a quiet stretch, so
# a true-range difference at the left edge is actually visible rather than lost
# in a flat series. No randomness -- this file must reproduce byte for byte.
def series(n=80):
    bars = []
    price = 100.0
    for i in range(n):
        price += math.sin(i / 4.0) * 1.6 + (0.35 if i < 40 else -0.2)
        if i == 12:
            price += 6.0        # a gap, so |h - prev_c| dominates the TR
        if i == 30:
            price -= 4.5        # and one the other way
        hi = price + 0.9 + (0.6 if i % 7 == 0 else 0.0)
        lo = price - 0.9 - (0.5 if i % 5 == 0 else 0.0)
        op = price - 0.2
        bars.append({"t": 20260100 + i, "o": op, "h": hi, "l": lo, "c": price,
                     "v": 1000 + i})
    return bars


# ─── the vendor's published definitions, implemented here ────────────────────

def pine_tr(bars, handle_na=True):
    """TradingView `ta.tr(handle_na)`.

    Their reference: *"the true range … max(high - low, abs(high - close[1]),
    abs(low - close[1]))"*, and for `handle_na = true`, *"if it is the first bar
    … returns high - low"* (with `false` the first bar is `na`).
    """
    out = []
    for i, b in enumerate(bars):
        if i == 0:
            out.append(b["h"] - b["l"] if handle_na else NAN)
            continue
        pc = bars[i - 1]["c"]
        out.append(max(b["h"] - b["l"], abs(b["h"] - pc), abs(b["l"] - pc)))
    return out


def pine_rma(src, length):
    """TradingView `ta.rma` -- Wilder's smoother, alpha = 1/length, seeded with
    `ta.sma(source, length)`, its first value landing on bar `length - 1`."""
    out = [NAN] * len(src)
    if length <= 0 or len(src) < length:
        return out
    seed = sum(src[:length]) / length
    out[length - 1] = seed
    prev = seed
    for i in range(length, len(src)):
        prev = (prev * (length - 1) + src[i]) / length
        out[i] = prev
    return out


def pine_atr(bars, length):
    """TradingView `ta.atr(length)`, documented as `ta.rma(ta.tr(true), length)`."""
    return pine_rma(pine_tr(bars, handle_na=True), length)


def pine_ema(src, length):
    """TradingView `ta.ema` -- alpha = 2/(length+1), seeded with the SMA of the
    first `length` values, first value on bar `length - 1`."""
    out = [NAN] * len(src)
    if length <= 0 or len(src) < length:
        return out
    alpha = 2.0 / (length + 1.0)
    prev = sum(src[:length]) / length
    out[length - 1] = prev
    for i in range(length, len(src)):
        prev = prev * (1 - alpha) + src[i] * alpha
        out[i] = prev
    return out


def pine_sma(src, length):
    out = [NAN] * len(src)
    for i in range(length - 1, len(src)):
        out[i] = sum(src[i - length + 1:i + 1]) / length
    return out


# ─── measuring ours against theirs ───────────────────────────────────────────

def ours(formula, bars):
    """Our engine's column for a formula, through the real interpreter."""
    from api.services.ast_interpret import interpret
    import json as _json
    import subprocess
    # The parser is JS-only (decision D-A1), so probes carry hand-built canonical
    # trees rather than shelling out -- the same choice `corpus.json` makes.
    return interpret(formula, bars)


def call(name, *args):
    """A canonical `call` node. Hand-built, because there is one parser and it is
    in JS."""
    out = []
    for a in args:
        if isinstance(a, str):
            out.append({"type": "series", "name": a})
        elif isinstance(a, (int, float)):
            out.append({"type": "num", "value": a})
        else:
            out.append(a)
    return {"type": "call", "name": name, "args": out}


def _first_value(col):
    for i, v in enumerate(col):
        if v is not None and isinstance(v, (int, float)) and math.isfinite(v):
            return i, float(v)
    return None, None


def _compare(label, mine, theirs, tol=1e-9):
    """Report BOTH the first-value index and the worst delta.

    ⭐ THE INDEX IS REPORTED SEPARATELY ON PURPOSE. Two engines can differ about
    WHICH BAR an indicator starts on while every shared bar agrees to the bit --
    an alignment divergence, invisible to a comparison that only walks the bars
    both produced. That is exactly the ATR case, so the instrument that measures
    it must be able to see it.
    """
    mi, mv = _first_value(mine)
    ti, tv = _first_value([None if (isinstance(v, float) and math.isnan(v)) else v
                           for v in theirs])
    worst = 0.0
    compared = 0
    for i in range(min(len(mine), len(theirs))):
        a = mine[i]
        b = theirs[i]
        if a is None or b is None:
            continue
        if isinstance(a, float) and not math.isfinite(a):
            continue
        if isinstance(b, float) and not math.isfinite(b):
            continue
        worst = max(worst, abs(float(a) - float(b)))
        compared += 1
    return {
        "label": label,
        "our_first_bar": mi, "their_first_bar": ti,
        "our_first_value": mv, "their_first_value": tv,
        "aligned": mi == ti,
        "worst": worst, "compared": compared,
        "agrees": (mi == ti) and worst <= tol and compared > 0,
    }


PROBES = []


def probe(fn):
    PROBES.append(fn)
    return fn


@probe
def probe_atr():
    """ATR(14) -- ours vs `ta.rma(ta.tr(true), 14)`."""
    bars = series()
    mine = ours(call("atr", "high", "low", "close", 14), bars)
    return _compare("atr(high, low, close, 14)", mine, pine_atr(bars, 14))


@probe
def probe_ema():
    """EMA(10) -- ours vs alpha = 2/(n+1) seeded with the SMA of the first 10."""
    bars = series()
    mine = ours(call("ema", "close", 10), bars)
    closes = [b["c"] for b in bars]
    return _compare("ema(close, 10)", mine, pine_ema(closes, 10))


@probe
def probe_rma():
    """RMA(14) -- ours vs Wilder's, alpha = 1/n, SMA-seeded."""
    bars = series()
    mine = ours(call("rma", "close", 14), bars)
    closes = [b["c"] for b in bars]
    return _compare("rma(close, 14)", mine, pine_rma(closes, 14))


@probe
def probe_sma():
    """SMA(20) -- the boring one, and it is here as the CALIBRATION. If a
    stateless window disagrees, the harness itself is suspect and every other
    row on this page is uninterpretable."""
    bars = series()
    mine = ours(call("sma", "close", 20), bars)
    closes = [b["c"] for b in bars]
    return _compare("sma(close, 20)", mine, pine_sma(closes, 20))


def run(out=sys.stdout):
    results = [fn() for fn in PROBES]
    print("=" * 78, file=out)
    print("SPEC PROBES -- our engine vs the vendor's PUBLISHED definition", file=out)
    print("=" * 78, file=out)
    print("⛔ a delta here FALSIFIES; agreement CONFIRMS NOTHING (see the header)\n",
          file=out)
    disagree = 0
    for r in results:
        mark = "✅" if r["agrees"] else "🔴"
        print(f"{mark} {r['label']}", file=out)
        print(f"     first value : ours bar {r['our_first_bar']} = "
              f"{r['our_first_value']!r}", file=out)
        print(f"                   spec bar {r['their_first_bar']} = "
              f"{r['their_first_value']!r}", file=out)
        if not r["aligned"]:
            print(f"     ⛔ ALIGNMENT: we start {abs((r['our_first_bar'] or 0) - (r['their_first_bar'] or 0))} "
                  f"bar(s) later than the published definition", file=out)
        print(f"     worst |Δ|   : {r['worst']:.10g} over {r['compared']} shared bars",
              file=out)
        if not r["agrees"]:
            disagree += 1
        print("", file=out)
    print("-" * 78, file=out)
    print(f"{len(results)} probes, {disagree} disagree with the published definition",
          file=out)
    return 1 if disagree else 0


def control(out=sys.stdout):
    """THE CONTROL: prove a probe can report disagreement.

    ⛔ WITHOUT IT, FOUR GREEN PROBES ARE UNINTERPRETABLE. A `_compare` with an
    inverted test, or one that silently compares zero bars, prints exactly the
    same page as four genuine agreements.
    """
    bars = series()
    closes = [b["c"] for b in bars]
    true_col = pine_sma(closes, 20)
    bent = [None if (isinstance(v, float) and math.isnan(v)) else v + 1.0
            for v in true_col]
    same = _compare("control: spec vs itself", true_col, true_col)
    off = _compare("control: spec vs itself + 1.0", bent, true_col)
    shifted = _compare("control: spec vs itself shifted one bar",
                       [None] + list(true_col)[:-1], true_col)
    print("CONTROL -- can a probe DISAGREE?", file=out)
    print("-" * 78, file=out)
    print(f"identical            → agrees={same['agrees']}  (want True)", file=out)
    print(f"one unit off         → agrees={off['agrees']}  worst={off['worst']:.4g} "
          f"(want False)", file=out)
    print(f"one BAR off          → agrees={shifted['agrees']}  "
          f"aligned={shifted['aligned']} (want False, False)", file=out)
    ok = same["agrees"] and not off["agrees"] and not shifted["agrees"] \
        and not shifted["aligned"]
    print(f"\n{'✅ the probe discriminates on BOTH axes: value and alignment.' if ok else '⛔ THE PROBE DOES NOT DISCRIMINATE.'}",
          file=out)
    return 0 if ok else 1


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--control", action="store_true")
    args = ap.parse_args(argv)
    return control() if args.control else run()


if __name__ == "__main__":
    raise SystemExit(main())
