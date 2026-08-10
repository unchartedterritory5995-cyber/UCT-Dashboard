"""JS and Python must answer the SAME thing for the pure-math vocabulary.

⭐⭐ THE DOMAIN REFUSALS ARE THE WHOLE POINT OF THIS FILE. Left to their defaults
the two languages disagree exactly where a member's data is ugliest:

    sqrt(-1)   JS -> NaN          Python -> ValueError (raises)
    log(0)     JS -> -Infinity    Python -> ValueError (raises)
    exp(1000)  JS -> Infinity     Python -> OverflowError (raises)
    -7 MOD 2   JS -> -1           Python -> 1   (floored vs truncated %)

Every one of those is reachable from an ordinary scan — a zero close on a halted
name, a negative spread inside a SQR. And the JS-side failure is the dangerous
one: `-Infinity` COMPARES AS THE SMALLEST THING IN THE UNIVERSE, so
`LOG(C) < 1` would silently match every halted symbol and quietly poison a
screen, while the Python lane simply exploded. Both lanes now answer NaN.

⛔ This is a PARITY test, not a maths test: it asserts the two lanes agree, which
is a property no single-lane unit test can see.
"""
import json
import math
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from api.services.ast_interpret import _POINTWISE  # noqa: E402

#: (name, args) -> the cases where the two languages natively disagree, plus
#: enough ordinary values that a lane which returned NaN for EVERYTHING would
#: still fail. ⛔ Without the ordinary values this passes vacuously.
CASES = [
    ("sqrt", [4.0]), ("sqrt", [0.0]), ("sqrt", [-1.0]), ("sqrt", [2.0]),
    ("ln", [math.e]), ("ln", [1.0]), ("ln", [0.0]), ("ln", [-3.0]),
    ("log10", [100.0]), ("log10", [1.0]), ("log10", [0.0]), ("log10", [-5.0]),
    ("exp", [0.0]), ("exp", [1.0]), ("exp", [1000.0]), ("exp", [-1000.0]),
    ("pow", [2.0, 10.0]), ("pow", [2.0, 0.5]), ("pow", [-8.0, 1.0 / 3.0]),
    ("pow", [10.0, 400.0]), ("pow", [0.0, 0.0]),
    ("mod", [7.0, 2.0]), ("mod", [-7.0, 2.0]), ("mod", [7.0, -2.0]),
    ("mod", [7.0, 0.0]), ("mod", [7.5, 2.0]),
    ("idiv", [7.0, 2.0]), ("idiv", [-7.0, 2.0]), ("idiv", [7.0, 0.0]),
    ("sin", [0.0]), ("sin", [1.0]), ("cos", [0.0]), ("cos", [1.0]),
    ("tan", [0.5]), ("atan", [1.0]), ("sinh", [1.0]), ("sinh", [1000.0]),
]

#: ⛔ DRIVEN THROUGH VITEST, NOT BARE `node`. `interpret.js` imports
#: `closedTable.json`, and Node's ESM loader demands an import attribute for that
#: while Vite resolves it natively — so a raw `node` run dies with
#: ERR_IMPORT_ATTRIBUTE_MISSING and the fixture SKIPS. A skipped parity test is
#: the worst outcome available here: it is the only assertion in this file that
#: compares the two lanes, and skipping it reports green while comparing nothing.
JS_SPEC = r"""
import { it } from 'vitest'
import fs from 'node:fs'
import { POINTWISE_FOR_PARITY as P } from './interpret.js'
import cases from './_parity_cases.json'

it('dump', () => {
  const out = cases.map(([name, args]) => {
    const v = P[name](...args)
    return (typeof v === 'number' && Number.isNaN(v)) ? 'nan'
         : (v === Infinity ? 'inf' : (v === -Infinity ? '-inf' : v))
  })
  // ⛔ A PLAIN PATH FROM vitest's CWD (`app/`), not `new URL(..., import.meta.url)`:
  // under vitest `import.meta.url` is not a file: URL and `writeFileSync` throws
  // "The URL must be of scheme file".
  fs.writeFileSync('src/components/chart/engine/ast/_parity_out.json', JSON.stringify(out))
})
"""


def _py(name, args):
    v = _POINTWISE[name](*args)
    if isinstance(v, float) and math.isnan(v):
        return "nan"
    if v == math.inf:
        return "inf"
    if v == -math.inf:
        return "-inf"
    return v


@pytest.fixture(scope="module")
def js_results():
    app = ROOT / "app"
    if not (app / "node_modules").exists():
        pytest.skip("node_modules absent; JS lane not runnable on this box")
    # ⛔ THE SPEC LIVES BESIDE THE MODULE IT DRIVES. Dropped in `app/` it sits
    # outside vitest's include pattern and the runner never picks it up -- which
    # this file reports as a hard failure rather than a skip, but is still an
    # afternoon lost to the wrong diagnosis.
    d = app / "src" / "components" / "chart" / "engine" / "ast"
    spec = d / "_parity_math.test.js"
    cases_f = d / "_parity_cases.json"
    out_f = d / "_parity_out.json"
    spec.write_text(JS_SPEC, encoding="utf-8")
    cases_f.write_text(json.dumps(CASES), encoding="utf-8")
    out_f.unlink(missing_ok=True)
    try:
        # ⚠️ RUN FROM `app/`, never `--root app` — that spelling produces phantom
        # failures on this box and is a recorded trap.
        r = subprocess.run(
            # ⛔ NO `--reporter=basic`. This vitest resolves that as a CUSTOM
            # REPORTER MODULE and dies in `loadCustomReporterModule` before a
            # single test runs -- which looks exactly like "the spec is broken".
            ["npx", "vitest", "run",
             "src/components/chart/engine/ast/" + spec.name],
            cwd=str(app), capture_output=True, text=True, timeout=420, shell=True,
        )
        if not out_f.exists():
            # ⛔ NOT A SKIP. If the JS lane cannot run, this file has compared
            # nothing, and reporting that as "skipped" is how a parity rail comes
            # to pass forever while the lanes drift apart.
            pytest.fail(
                "the JS lane produced no results, so NOTHING was compared.\n"
                f"exit={r.returncode}\nstdout={r.stdout[-1500:]}\nstderr={r.stderr[-1500:]}")
        return json.loads(out_f.read_text(encoding="utf-8"))
    finally:
        for f in (spec, cases_f, out_f):
            f.unlink(missing_ok=True)


def test_the_case_list_is_not_empty_and_covers_the_refusals():
    """⛔ NON-VACUITY. Everything below is trivially true on an empty list, and a
    parity run that skipped the domain cases would prove only the easy half."""
    assert len(CASES) >= 30
    names = {n for n, _ in CASES}
    assert {"sqrt", "ln", "log10", "exp", "pow", "mod", "idiv"} <= names
    assert ("ln", [0.0]) in CASES and ("sqrt", [-1.0]) in CASES


@pytest.mark.parametrize("name,args", CASES)
def test_python_never_raises_and_never_returns_an_infinity(name, args):
    """An infinity is not an answer: it compares as larger (or smaller) than every
    threshold a member could write, and would win every comparison silently."""
    v = _py(name, args)
    assert v not in ("inf", "-inf"), f"{name}{args} returned an infinity"


def test_the_two_lanes_agree_everywhere(js_results):
    py = [_py(n, a) for n, a in CASES]
    mismatches = []
    for (n, a), p, j in zip(CASES, py, js_results):
        same = (p == j) or (
            isinstance(p, float) and isinstance(j, float) and abs(p - j) <= 1e-9 * max(1.0, abs(p))
        )
        if not same:
            mismatches.append(f"{n}{a}: py={p!r} js={j!r}")
    # ⛔ THE NAMES GO IN THE MESSAGE, not the differ — vitest and pytest both
    # abbreviate long lists, and a rail whose job is to say WHICH case parted
    # company must not report through an ellipsis.
    assert not mismatches, "lanes disagree:\n  " + "\n  ".join(mismatches)


def test_mod_truncates_toward_zero_in_the_python_lane():
    """⛔ THE ONE THAT LOOKS FINE AND IS NOT. Python's `%` is FLOORED: `-7 % 2` is
    `1`. TC2000 and JS truncate: `-1`. Borrowing the operator would have been a
    silent sign flip on every negative input."""
    assert _POINTWISE["mod"](-7.0, 2.0) == -1.0
    assert _POINTWISE["mod"](7.0, -2.0) == 1.0
