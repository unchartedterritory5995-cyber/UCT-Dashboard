#!/usr/bin/env python3
"""Vendor truth -- the only instrument in this repo that can say we are RIGHT.

Read ``tests/fixtures/vendor/README.md`` first. The one-paragraph version:

  Every other numeric rail here compares us to US. `ast_conformance --check`
  proves the two lanes agree with each other; the golden fixtures are generated
  by `indicator_compute.compute_case` (`_generate.py:305`), which is the thing
  they are supposed to be checking; `chart_parity` compares a picture to a
  committed picture. So our indicators could disagree with TradingView on every
  bar of every symbol and EVERY GATE IN THIS REPOSITORY WOULD STAY GREEN.

  This file compares our numbers to numbers a human read off the vendor's own
  screen. It is the only file here whose inputs did not come from us.

    python tools/vendor_truth.py --check      # the gate: every observation, every delta
    python tools/vendor_truth.py --coverage   # what truth we HOLD, by shape
    python tools/vendor_truth.py --selfcheck  # THE POSITIVE CONTROL

⛔⛔ THE FAILURE MODE THIS FILE IS WRITTEN AGAINST IS ITS OWN EMPTINESS.
An empty observation store makes `--check` iterate nothing, find nothing and exit
0, which reads as "no divergences" and is really "no measurements". That is the
`lesson_a_gate_that_cannot_fail` shape, and it is the single most likely way this
harness becomes decorative. So:

  * `--check` EXITS NON-ZERO on an empty store and says why. Silence is never
    success here.
  * every report leads with the count of observations it actually ran, never with
    the count of deltas it found -- a zero is meaningless without its denominator
    (`lesson_a_hit_rate_is_meaningless_without_its_base_rate`).
  * `--selfcheck` plants a KNOWN disagreement and requires the harness to catch
    it. A harness that cannot fail on a planted defect cannot pass on a real one
    (`lesson_mutation_harness_needs_a_control`).

⛔ AND IT IS BLIND TO ONE THING BY CONSTRUCTION, STATED UP FRONT rather than
discovered later. It interprets the RECORDED `engine.ast`, not the vendor script,
because there is exactly one parser and it is in JS (decision D-A1). So this file
cannot see a TRANSLATOR drift -- a change that makes `pine.js` emit a different
tree for the same source would leave every number here green. That half is owned
by `app/src/components/chart/engine/ast/vendorTruth.test.js`, which re-translates
each observation's `script.source` and asserts it still produces the recorded
`engine.ast`. Neither file covers the pair alone; both are required and both are
named in each other's header so the pair cannot be half-remembered.
"""

from __future__ import annotations

import argparse
import io
import json
import math
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")  # the box default is cp1252

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.abspath(os.path.join(_HERE, ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

VENDOR_DIR = os.path.join(_ROOT, "tests", "fixtures", "vendor")
OBS_DIR = os.path.join(VENDOR_DIR, "observations")
DIVERGENCES = os.path.join(VENDOR_DIR, "divergences.json")

#: The shapes coverage is measured over. NOT a list of scripts -- the failure
#: modes live in the shapes, and a shape reporting zero names a whole class of
#: bug this repo currently cannot see. See the README for why these three.
SHAPES = ("stateless", "seeded", "stateful")

#: Every field an observation must carry. A missing one is refused rather than
#: defaulted: a vendor number without provenance is indistinguishable from a
#: number somebody made up, and the whole value of this directory is that the
#: difference is knowable.
REQUIRED = ("id", "shape", "script", "engine", "market", "vendor", "provenance")
REQUIRED_PROVENANCE = ("platform", "who", "when")


class VendorTruthError(RuntimeError):
    """A refusal that names its own reason, in this file's own vocabulary."""


def _load_json(path):
    with io.open(path, encoding="utf-8") as fh:
        return json.load(fh)


def load_observations(obs_dir=None):
    """Every observation on disk, validated. Refuses rather than skipping.

    ⛔ ``obs_dir`` DEFAULTS TO ``None`` AND RESOLVES ``OBS_DIR`` AT CALL TIME,
    which is not a style choice. Written as ``obs_dir=OBS_DIR`` the module
    constant is captured when the function is DEFINED, so the directory can never
    be redirected afterwards -- the harness would read the real store no matter
    what a caller asked for. That is the shape of a knob that looks live and is
    inert (``lesson_a_measured_knob_is_inert_if_the_consumer_skips_its_stage``),
    and it surfaced as a test that pointed the harness at a temp directory and
    got the empty-store refusal from the real one.

    ⛔ A MALFORMED OBSERVATION IS AN ERROR, NOT A SKIP. A `--check` that quietly
    skipped the file it could not read would report a clean run over a store it
    had not looked at -- the same shape as the empty-store failure, one level in.
    """
    obs_dir = OBS_DIR if obs_dir is None else obs_dir
    if not os.path.isdir(obs_dir):
        return []
    out = []
    for name in sorted(os.listdir(obs_dir)):
        if not name.endswith(".json") or name.startswith("_"):
            continue
        path = os.path.join(obs_dir, name)
        try:
            obs = _load_json(path)
        except Exception as exc:                       # noqa: BLE001
            raise VendorTruthError(f"{name}: unreadable ({exc})") from exc
        missing = [k for k in REQUIRED if k not in obs]
        if missing:
            raise VendorTruthError(
                f"{name}: missing {', '.join(missing)}. Every field is required; see "
                f"tests/fixtures/vendor/README.md. A vendor number without provenance "
                f"cannot be told apart from one somebody invented."
            )
        if obs["shape"] not in SHAPES:
            raise VendorTruthError(
                f"{name}: shape {obs['shape']!r} is not one of {SHAPES}. Coverage is "
                f"measured over shapes, so an unknown shape would be counted nowhere."
            )
        prov_missing = [k for k in REQUIRED_PROVENANCE if not obs["provenance"].get(k)]
        if prov_missing:
            raise VendorTruthError(
                f"{name}: provenance is missing {', '.join(prov_missing)}. "
                f"'Who read this number, off what, and when' is the whole difference "
                f"between an oracle and a mirror."
            )
        if not (obs.get("vendor") or {}).get("values"):
            raise VendorTruthError(
                f"{name}: carries no vendor values. An observation with nothing "
                f"observed is the empty store wearing a filename."
            )
        obs["_file"] = name
        out.append(obs)
    return out


def load_divergences(path=DIVERGENCES):
    doc = _load_json(path)
    return {r["id"]: r for r in doc.get("rows", [])}


def evaluate(obs):
    """Our column for this observation's tree over the VENDOR'S OWN bars.

    ⭐ THE BARS ARE THEIRS, AND THAT IS THE WHOLE POINT. Computing against our
    own bars would leave a delta unattributable between a maths difference and a
    data difference -- two causes, one number, no finding. Given identical
    inputs a delta IS a maths delta.
    """
    from api.services.ast_interpret import interpret

    bars = obs["market"]["bars"]
    return interpret(obs["engine"]["ast"], bars, opts={"tf": obs["market"].get("timeframe")})


def tolerance_for(obs):
    """The vendor's own display precision, and NOTHING else.

    ⛔ THIS IS NOT A KNOB. It states how many decimals the vendor SHOWED, so a
    delta smaller than half a displayed unit is unmeasurable rather than absent.
    Widening it to make a delta go away converts a finding into a silence, which
    is the one move `README.md` forbids by name.
    """
    dec = obs["vendor"].get("readDecimals")
    if dec is None:
        raise VendorTruthError(
            f"{obs['id']}: vendor.readDecimals is required -- without it there is no "
            f"way to tell 'we differ' from 'they printed fewer digits than we did'."
        )
    return 0.5 * (10 ** -int(dec))


def compare(obs, column=None):
    """Every recorded vendor value against our own. Returns a list of rows."""
    col = evaluate(obs) if column is None else column
    bars = obs["market"]["bars"]
    index = {}
    for i, bar in enumerate(bars):
        index[str(bar["t"])] = i
    tol = tolerance_for(obs)
    rows = []
    for key, want in sorted(obs["vendor"]["values"].items()):
        if key not in index:
            raise VendorTruthError(
                f"{obs['id']}: vendor value at bar {key} has no matching bar in "
                f"market.bars. The plotted value and the OHLCV must come off the "
                f"same chart or a delta cannot be attributed."
            )
        i = index[key]
        got = col[i] if i < len(col) else None
        if got is None or (isinstance(got, float) and not math.isfinite(got)):
            rows.append({"bar": key, "index": i, "vendor": want, "ours": None,
                         "delta": None, "verdict": "WE-HAVE-NO-VALUE"})
            continue
        delta = float(got) - float(want)
        rows.append({
            "bar": key, "index": i, "vendor": float(want), "ours": float(got),
            "delta": delta,
            "verdict": "MATCH" if abs(delta) <= tol else "DELTA",
        })
    return rows


def _explained_by(obs):
    """The divergence row this observation says explains it, or None."""
    return (obs.get("expect") or {}).get("explains")


def check(observations=None, divergences=None, out=sys.stdout):
    """The gate. Returns an exit code; prints a report that leads with the
    denominator."""
    obs_list = load_observations(OBS_DIR) if observations is None else observations
    rows_by_id = load_divergences() if divergences is None else divergences

    print("=" * 78, file=out)
    print("VENDOR TRUTH", file=out)
    print("=" * 78, file=out)

    if not obs_list:
        # ⛔ THE EMPTY-STORE REFUSAL. This is the branch this whole file is
        # written around: iterate nothing, find nothing, exit 0 is how a harness
        # becomes decorative without anybody deciding to make it so.
        print(
            "\n⛔ NO VENDOR OBSERVATIONS ARE HELD -- 0 files in\n"
            "   tests/fixtures/vendor/observations/.\n\n"
            "   This is NOT a pass. It means nothing in this repository has ever\n"
            "   compared an indicator to a number produced outside it, so every\n"
            "   green gate here proves only self-consistency.\n\n"
            "   The harness is built and waiting. To fill it, follow the\n"
            "   transcription protocol in tests/fixtures/vendor/README.md --\n"
            "   three observations, one per shape, is the minimum that makes\n"
            "   'we match TradingView' a measured statement instead of a hope.\n",
            file=out)
        return 2

    by_shape = {s: 0 for s in SHAPES}
    total_values = 0
    deltas = []
    empties = []
    for obs in obs_list:
        by_shape[obs["shape"]] += 1
        rows = compare(obs)
        total_values += len(rows)
        for row in rows:
            if row["verdict"] == "DELTA":
                deltas.append((obs, row))
            elif row["verdict"] == "WE-HAVE-NO-VALUE":
                empties.append((obs, row))

    # ⭐ THE DENOMINATOR FIRST, ALWAYS. "0 divergences" over 0 comparisons and
    # "0 divergences" over 400 are opposite facts that print the same way.
    print(f"\nran     : {len(obs_list)} observations, {total_values} compared values",
          file=out)
    print(f"shapes  : " + " · ".join(f"{s} {by_shape[s]}" for s in SHAPES), file=out)
    print(f"matched : {total_values - len(deltas) - len(empties)}", file=out)
    print(f"deltas  : {len(deltas)}", file=out)
    print(f"blank   : {len(empties)} (we produced no value where the vendor plotted one)",
          file=out)

    unexplained = 0
    for obs, row in deltas:
        rid = _explained_by(obs)
        rule = rows_by_id.get(rid) if rid else None
        # ⛔ ONLY A `confirmed` OR `accepted` ROW MAY EXPLAIN A DELTA. A
        # `suspected` row is a belief nobody has measured; letting one silence a
        # measurement would let us explain away the very finding that would have
        # tested the belief.
        ok = bool(rule) and rule.get("status") in ("confirmed", "accepted")
        tag = f"EXPLAINED by {rid}" if ok else (
            f"ANTICIPATED but {rid} is '{rule.get('status')}', not confirmed" if rule
            else "UNEXPLAINED")
        if not ok:
            unexplained += 1
        print(f"\n  {obs['id']}  bar {row['bar']}", file=out)
        print(f"    vendor {row['vendor']}   ours {row['ours']}   Δ {row['delta']:+.10g}",
              file=out)
        print(f"    → {tag}", file=out)

    for obs, row in empties:
        print(f"\n  {obs['id']}  bar {row['bar']}: the vendor plotted "
              f"{row['vendor']} and we produced NOTHING. A blank where a vendor "
              f"draws a line is a divergence about REACH, not about arithmetic.",
              file=out)

    if unexplained or empties:
        print(f"\n⛔ {unexplained} unexplained delta(s), {len(empties)} blank(s).",
              file=out)
        print("   Each is a bug until a divergences.json row says otherwise -- and "
              "a row\n   may only be written from a MEASUREMENT, never from a "
              "plausible story.", file=out)
        return 1

    print("\n✅ every recorded vendor value is matched or explained.", file=out)
    return 0


def coverage(out=sys.stdout):
    """What truth we hold, by shape. A zero here names a class of blindness."""
    obs_list = load_observations(OBS_DIR)
    by_shape = {s: [] for s in SHAPES}
    for obs in obs_list:
        by_shape[obs["shape"]].append(obs["id"])

    print("VENDOR-TRUTH COVERAGE", file=out)
    print("-" * 78, file=out)
    for shape in SHAPES:
        held = by_shape[shape]
        mark = "✅" if held else "⛔"
        print(f"{mark} {shape:10s} {len(held)}", file=out)
        for oid in held:
            print(f"       {oid}", file=out)
        if not held:
            print(f"       NOTHING HELD. {_BLIND[shape]}", file=out)
    total = sum(len(v) for v in by_shape.values())
    print("-" * 78, file=out)
    print(f"{total} observations", file=out)
    return 0 if total else 2


_BLIND = {
    "stateless": "We cannot detect a plain arithmetic disagreement (window "
                 "alignment, weighting).",
    "seeded": "We cannot detect a SEEDING disagreement -- the class that decays "
              "toward agreement, so it is invisible in any late window and wrong "
              "forever at the left edge. This is the highest-value gap.",
    "stateful": "We cannot detect a LATCHING disagreement -- one differing bar "
                "changes every later bar, so this is where a small maths "
                "difference produces a completely different indicator.",
}


def selfcheck(out=sys.stdout):
    """THE POSITIVE CONTROL: plant a known disagreement, require detection.

    ⛔ WITHOUT THIS, A GREEN `--check` IS UNINTERPRETABLE. A comparator with a
    reversed conditional, an off-by-one bar index, or a tolerance read from the
    wrong field all produce "everything matches" over a real store. So this
    builds an observation whose answer is known by construction, breaks it by a
    stated amount, and fails if the harness does not notice.
    """
    bars = [{"t": 20260100 + i, "o": 10.0 + i, "h": 10.0 + i, "l": 10.0 + i,
             "c": 10.0 + i, "v": 100} for i in range(1, 31)]
    ast = {"type": "call", "name": "sma",
           "args": [{"type": "series", "name": "close"}, {"type": "num", "value": 5}]}
    base = {
        "id": "_selfcheck", "shape": "stateless",
        "script": {"dialect": "pine", "source": "plot(ta.sma(close, 5))", "plot": "plot0"},
        "engine": {"formula": "sma(close, 5)", "ast": ast},
        "market": {"symbol": "_SYNTHETIC", "timeframe": "1D", "bars": bars},
        "vendor": {"readDecimals": 2, "values": {}},
        "provenance": {"platform": "_selfcheck", "who": "vendor_truth.py",
                       "when": "n/a", "note": "SYNTHETIC. Not vendor truth."},
    }
    col = evaluate(base)
    # A bar we definitely computed: closes are 11..40, so sma(5) at index 9 is
    # the mean of closes 6..10 -> 15.0 + ... derived, not typed.
    idx = 9
    truth = col[idx]
    if truth is None or not math.isfinite(truth):
        print("⛔ SELFCHECK BROKEN: the engine produced no value at the probe bar.",
              file=out)
        return 1
    key = str(bars[idx]["t"])

    ok_case = dict(base)
    ok_case["vendor"] = {"readDecimals": 2, "values": {key: round(truth, 2)}}
    ok_rows = compare(ok_case, column=col)

    # The planted disagreement: one full unit, far outside a 2-decimal tolerance.
    bad_case = dict(base)
    bad_case["vendor"] = {"readDecimals": 2, "values": {key: round(truth + 1.0, 2)}}
    bad_rows = compare(bad_case, column=col)

    agreeing = ok_rows[0]["verdict"] == "MATCH"
    detected = bad_rows[0]["verdict"] == "DELTA"

    print("SELFCHECK -- can this harness fail?", file=out)
    print("-" * 78, file=out)
    print(f"engine at bar {key}          : {truth!r}", file=out)
    print(f"agreeing value  → {ok_rows[0]['verdict']:6s} (want MATCH)", file=out)
    print(f"planted +1.0    → {bad_rows[0]['verdict']:6s} (want DELTA, "
          f"Δ {bad_rows[0]['delta']:+.4g})", file=out)
    if agreeing and detected:
        print("\n✅ the harness DISCRIMINATES: it passes a true value and fails a "
              "planted one.", file=out)
        return 0
    print("\n⛔ THE HARNESS DOES NOT DISCRIMINATE. Every green --check it has ever "
          "printed is uninterpretable.", file=out)
    return 1


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check", action="store_true", help="every observation, every delta")
    ap.add_argument("--coverage", action="store_true", help="what truth we hold, by shape")
    ap.add_argument("--selfcheck", action="store_true", help="the positive control")
    args = ap.parse_args(argv)
    if args.selfcheck:
        return selfcheck()
    if args.coverage:
        return coverage()
    if args.check or True:
        return check()


if __name__ == "__main__":
    raise SystemExit(main())
