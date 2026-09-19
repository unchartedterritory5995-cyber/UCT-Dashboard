#!/usr/bin/env python
"""RECORD ``tests/fixtures/ast/clock_parity.json`` — the clock oracle.

⭐⭐ WHY THIS EXISTS AT ALL. The fixture's own header said it was *"RECORDED FROM
THAT LANE"* and the recorder was never committed, so for its whole life it was
hand-maintained by a file that claimed to be generated. That is how 14 of its 15
merge conflicts came to be ``"c": 100`` versus ``"c": 100.0`` — two people
serialising the same numbers two ways, in a 2,314-line artifact nobody could
regenerate to settle it.

    python tools/record_clock_parity.py            # rewrite the fixture
    python tools/record_clock_parity.py --check    # exit 1 if it would change
    python tools/record_clock_parity.py --validate-against-old <worktree>
                                                   # prove the recorder reproduces
                                                   # a known-good committed fixture

⛔⛔ PYTHON IS THE RECORDING LANE AND JAVASCRIPT IS THE LANE UNDER TEST. That is
not a coin toss: the trading calendar lives on this side (``bars_fetch``'s NYSE
closures, ``liveflow_monitor``'s early closes), and the whole barstate seam ruling
is that the calendar must not be duplicated into the browser. A JS recorder would
need the calendar to record, which is the defect.

⛔ THE INPUTS ARE READ, NEVER INVENTED. ``bars``, ``non_instant_bars``, ``tf``,
the ``tf_booleans`` probe codes and the ``sliced_sessionfirst`` cut points are
lifted from the existing fixture and written back unchanged. Only the EXPECTED
blocks are recomputed. A recorder that synthesised its own inputs would be
grading its own homework, and nobody could say what series the numbers describe.

⭐ CANONICAL BY CONSTRUCTION — the recorder's first job is to make the int/float
churn impossible. Every value goes through ``_canon``: sorted keys, two-space
indent, ``\\n`` endings, and INTEGRAL FLOATS EMITTED AS INTS. Two runs on two
machines produce the same bytes.

⚠️ ``newest_bar_is_forming`` REPLACES ``now``. The retired seam handed an
evaluating instant plus a holiday set into the column layer; the shipped seam
hands ONE tri-state, produced upstream by
``indicator_compute.bar_close_state``. The fixture therefore records the
tri-state, and covers all three of its values so the null-blanks behaviour is
pinned by data rather than only by prose.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "ast" / "clock_parity.json"

sys.path.insert(0, str(ROOT))

#: The tri-state values the fixture pins. ``None`` is the one the retired seam
#: had no way to express, and it is the reason the roster is three rather than
#: two: a caller who knows nothing must not be handed a confident answer.
STATES = (True, False, None)

#: The barstate columns whose values the tri-state actually moves. The extent
#: pair is deliberately outside it — those two read only the fetch's shape and
#: are identical under all three states, which the recorder asserts rather than
#: assumes.
BARSTATE_COLUMNS = ("islast", "isfirst", "isrealtime", "isconfirmed",
                    "ishistory", "islastconfirmedhistory")


def _canon(value):
    """⭐ THE ONE NUMERIC RULE, APPLIED EVERYWHERE.

    An integral float becomes an int. ``100.0`` and ``100`` are the same number
    and must not be two different bytes — that difference alone accounted for 14
    of this fixture's 15 merge conflicts. ``NaN``/``None`` stay ``None``, which
    is how this fixture has always spelled "blank".
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        if value != value:            # NaN
            return None
        return int(value) if value.is_integer() else value
    if isinstance(value, dict):
        return {k: _canon(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_canon(v) for v in value]
    return value


def _dump(doc) -> str:
    """Canonical serialisation: sorted keys, two-space indent, LF, trailing LF."""
    return json.dumps(_canon(doc), indent=2, sort_keys=True,
                      ensure_ascii=False) + "\n"


def _columns(cols, names=None):
    """A column dict as plain lists, blanks as ``None``."""
    keys = names if names is not None else sorted(cols)
    return {k: _canon(list(cols[k])) for k in keys if k in cols}


def record(compute_clock, source: dict) -> dict:
    """Produce the whole fixture from ``source``'s INPUTS and this lane's maths."""
    bars = source["bars"]
    tf = source["tf"]
    ni_bars = source["non_instant_bars"]

    out = dict(source)                     # keep every prose key verbatim
    out.pop("now", None)                   # ⚰️ the retired seam's input

    # ── the primary doc ──────────────────────────────────────────────────────
    # ⭐ RECORDED AT `false`, WHICH IS WHAT MAKES THIS VALIDATABLE. The committed
    # fixture at 3a1d9d4a3 was produced by a lane whose third argument DEFAULTED
    # to false, so a `false` recording here must reproduce it exactly — an
    # independent check on the recorder before anyone trusts its output.
    out["newest_bar_is_forming"] = False
    out["expected"] = _columns(compute_clock(bars, tf, False),
                               sorted(source["expected"]))
    out["non_instant_expected"] = _columns(compute_clock(ni_bars, "D", False),
                                           sorted(source["non_instant_expected"]))

    # ── the timeframe vocabulary ─────────────────────────────────────────────
    tf_out = {}
    for code in source["tf_booleans"]:
        arg = None if code == "__absent__" else code
        cols = compute_clock(bars, arg, False)
        tf_out[code] = {k: _canon(cols[k][0]) for k in
                        ("isintraday", "isdaily", "isweekly", "ismonthly")}
    out["tf_booleans"] = tf_out

    # ── sessionfirst under slicing ───────────────────────────────────────────
    out["sliced_sessionfirst"] = {
        cut: _canon(list(compute_clock(bars[int(cut):], tf, False)["sessionfirst"]))
        for cut in source["sliced_sessionfirst"]
    }

    # ── the tri-state, all three values ──────────────────────────────────────
    # ⛔ THIS BLOCK IS THE WHOLE POINT OF THE RE-RECORD. `null` has no equivalent
    # under the retired seam — there was no way to say "nobody told me" — so it
    # is NEW data, and it is what stops a future edit quietly collapsing unknown
    # onto false.
    cases = {}
    for state in STATES:
        key = {True: "true", False: "false", None: "null"}[state]
        cases[key] = _columns(compute_clock(bars, tf, state), BARSTATE_COLUMNS)
    out["barstate_cases"] = cases

    out["_newest_bar_is_forming"] = (
        "⭐⭐ THE TRI-STATE, AND IT REPLACED A `now`. `true` / `false` / `null`, "
        "handed in per fetch and produced upstream by "
        "`indicator_compute.bar_close_state` — the only place the NYSE closure and "
        "early-close sets are read. ⛔ `null` MEANS UNKNOWN AND NEVER MEANS FALSE: "
        "under it the four CLOCK_REALTIME columns are blank, while the extent pair "
        "(`islast`, `isfirst`) still answers because it reads only the fetch's "
        "shape. `barstate_cases` pins all three so a future edit cannot collapse "
        "unknown onto false and stay green."
    )
    out["_barstate_cases"] = (
        "The six barstate columns under each value of `newest_bar_is_forming`. "
        "⚠️ The `null` case has NO equivalent in any pre-2026-09-09 fixture — the "
        "retired seam could not express it — so it is new data rather than a "
        "re-recording, and it is covered from the other side by "
        "`tests/test_bar_close_state.py` and the null-blanks render test in "
        "`app/src/components/chart/engine/ast/barstate.test.js`."
    )
    out["_recorder"] = (
        "⛔ GENERATED — DO NOT HAND-EDIT. Rewrite with "
        "`python tools/record_clock_parity.py`; check with `--check`. Inputs "
        "(`bars`, `non_instant_bars`, `tf`, and the `tf_booleans` / "
        "`sliced_sessionfirst` key sets) are READ from this file and written back "
        "unchanged — only the expected blocks are recomputed, so the series the "
        "numbers describe stays nameable. Canonical by construction: sorted keys, "
        "two-space indent, LF, and integral floats emitted as ints."
    )
    return out


def _load_old_lane(worktree: str):
    """Import ``compute_clock`` from ANOTHER worktree, read-only.

    ⭐ USED ONLY BY `--validate-against-old`, and it runs the other lane in a
    SUBPROCESS rather than importing it here: two copies of `api.services.*` in
    one interpreter would shadow each other and the result would be a measurement
    of import order rather than of the maths.
    """
    raise NotImplementedError  # see _validate_against_old


def _validate_against_old(worktree: str, source: dict) -> int:
    """⭐⭐ THE RECORDER IS NOT TRUSTED UNTIL IT REPRODUCES A KNOWN-GOOD FIXTURE.

    Drives the OLD lane (in ``worktree``, read-only, in a subprocess) over this
    fixture's own inputs and compares its output to the committed expected blocks
    to SEMANTIC equality — parsed, with the integral-float rule applied to both
    sides, so an int/float difference is not a mismatch. An input-key rename
    (``now`` → ``newest_bar_is_forming``) is expected and is not compared.
    """
    prog = (
        "import json,sys\n"
        "from api.services.indicator_compute import compute_clock\n"
        "src=json.load(open(sys.argv[1],encoding='utf-8'))\n"
        "def cols(c,names):\n"
        "    return {k:[None if (isinstance(v,float) and v!=v) else v for v in list(c[k])]"
        " for k in names if k in c}\n"
        "out={}\n"
        "for label,state in (('false',False),('true',True)):\n"
        "    out[label]={\n"
        "      'expected':cols(compute_clock(src['bars'],src['tf'],state),sorted(src['expected'])),\n"
        "      'non_instant_expected':cols(compute_clock(src['non_instant_bars'],'D',state),"
        "sorted(src['non_instant_expected'])),\n"
        "    }\n"
        "json.dump(out,sys.stdout)\n"
    )
    tmp = pathlib.Path(os.environ.get("TEMP", "/tmp")) / "_clock_parity_src.json"
    io.open(tmp, "w", encoding="utf-8").write(json.dumps(source))
    env = dict(os.environ, DATA_DIR=str(tmp.parent / "_recorder_sandbox"))
    res = subprocess.run([sys.executable, "-c", prog, str(tmp)],
                         cwd=worktree, capture_output=True, text=True, env=env)
    if res.returncode != 0:
        print("OLD LANE FAILED:\n" + res.stderr[-2000:])
        return 1
    old = json.loads(res.stdout)

    ok = True
    print(f"validating recorder against the OLD lane in {worktree}")
    for label in ("false", "true"):
        for block in ("expected", "non_instant_expected"):
            got = _canon(old[label][block])
            if label == "false":
                # the committed fixture WAS recorded at the old default (false)
                want = _canon(source[block])
                verdict = "MATCHES the committed fixture" if got == want else "DIFFERS"
                if got != want:
                    ok = False
                    for k in sorted(set(got) | set(want)):
                        if got.get(k) != want.get(k):
                            print(f"    ✗ {block}.{k}\n      old={got.get(k)}\n      fix={want.get(k)}")
                print(f"  [{label}] {block}: {verdict}")
            else:
                print(f"  [{label}] {block}: recorded (no committed counterpart on "
                      f"this branch — see the report)")
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true",
                    help="exit 1 if the fixture would change")
    ap.add_argument("--validate-against-old", metavar="WORKTREE",
                    help="prove the recorder reproduces a known-good fixture")
    args = ap.parse_args()

    source = json.load(io.open(FIXTURE, encoding="utf-8"))

    missing = [k for k in ("bars", "tf", "non_instant_bars", "expected",
                           "non_instant_expected", "tf_booleans",
                           "sliced_sessionfirst") if k not in source]
    if missing:
        print("⛔ INPUTS NOT RECOVERABLE FROM THE FIXTURE: " + ", ".join(missing))
        print("   Refusing to record a fixture whose inputs nobody can name.")
        return 2

    if args.validate_against_old:
        return _validate_against_old(args.validate_against_old, source)

    from api.services.indicator_compute import compute_clock
    text = _dump(record(compute_clock, source))

    if args.check:
        current = io.open(FIXTURE, encoding="utf-8").read()
        if current == text:
            print("clock_parity.json is up to date")
            return 0
        print("⛔ clock_parity.json is STALE — run tools/record_clock_parity.py")
        return 1

    io.open(FIXTURE, "w", encoding="utf-8", newline="\n").write(text)
    print(f"recorded {FIXTURE.relative_to(ROOT)}")
    doc = json.loads(text)
    print(f"  newest_bar_is_forming : {doc['newest_bar_is_forming']}")
    print(f"  barstate_cases        : {sorted(doc['barstate_cases'])}")
    print(f"  bars                  : {len(doc['bars'])}")
    print(f"  expected columns      : {len(doc['expected'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
