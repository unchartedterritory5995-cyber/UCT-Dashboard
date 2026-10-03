"""Wave 13 lane 13B -- ruling R3's ONE home, `sample_size.py`, and its client twin `lib/sampleSize.js`.

Rails:
  * the bands sit exactly on their boundaries: n = 9, 10, 24, 25 (and 0);
  * the Wilson and Student-t ranges are pinned against an independent oracle (scipy's own
    `binomtest(...).proportion_ci(method="wilson")` and `t.ppf`, values recorded below), never
    against this module's own output;
  * PARITY: the real JS file is run under node over the same grid as the Python and every output
    is compared EXACTLY -- a restatement of the constants in this test would be a third authority,
    so the JS is executed, not read. A planted-defect control proves the comparison can fail;
  * plan_grading (13A) reads R3 from here: its names ARE this module's functions, not copies.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from api.services.journal_two import sample_size as ss

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "app" / "src" / "pages" / "journal-2-0" / "lib" / "sampleSize.js"


# ── the bands, on their boundaries ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("n,band,wording", [
    (0, "too_few", "too few to judge"), (9, "too_few", "too few to judge"),
    (10, "thin", "thin sample"), (24, "thin", "thin sample"),
    (25, "normal", None), (200, "normal", None),
])
def test_the_r3_bands_sit_on_their_boundaries(n, band, wording):
    assert ss.band(n) == band
    assert ss.sample(n) == {"n": n, "band": band, "wording": wording}
    r = ss.rate_stat(min(n, 3), n)
    assert (r["band"], r["wording"]) == (band, wording)
    # A range is shown in the thin band ONLY (R3: "10-24 thin sample, with a range").
    assert (r["range"] is not None) == (band == "thin")
    m = ss.mean_stat([float(i % 3) for i in range(n)])
    assert (m["band"], m["wording"], m["range"] is not None) == (band, wording, band == "thin")


def test_the_constants_are_the_ruling():
    assert (ss.TOO_FEW_BELOW, ss.NORMAL_FROM, ss.RANGE_Z) == (10, 25, 1.96)
    assert ss.WORDING == {"too_few": "too few to judge", "thin": "thin sample", "normal": None}


# ── the ranges, against an independent oracle ───────────────────────────────────────────────

# scipy 1.17: binomtest(k, n).proportion_ci(0.95, method="wilson"), rounded to 3 places.
@pytest.mark.parametrize("k,n,lo,hi", [
    (7, 12, 0.320, 0.807),      # 0.31951..., 0.80674...
    (10, 20, 0.299, 0.701),     # 13A's own pinned case
    (0, 10, 0.0, 0.278),
    (10, 10, 0.722, 1.0),
    (3, 24, 0.043, 0.310),
])
def test_wilson_matches_the_oracle(k, n, lo, hi):
    assert ss.wilson(k, n) == (lo, hi)


def test_wilson_with_no_sample_is_none():
    assert ss.wilson(0, 0) is None
    assert ss.rate_stat(0, 0)["rate"] is None


# scipy: [round(t.ppf(0.975, d), 3) for d in 1..30]
ORACLE_T975 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179,
               2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06,
               2.056, 2.052, 2.048, 2.045, 2.042]


def test_the_t_table_is_the_oracle():
    assert list(ss.T975) == ORACLE_T975
    assert ss.t_crit(31) == ss.RANGE_Z


def test_the_mean_range_is_a_student_t_interval():
    # mean 0.541667, sd 1.440618, n 12: scipy gives (-0.37366, 1.45699).
    v = [2.0, -1.0, 1.5, -1.0, 3.0, -0.5, 0.8, -1.0, 2.2, -1.0, 1.1, 0.4]
    assert ss.t_interval(v) == (-0.374, 1.457)
    m = ss.mean_stat(v)
    assert m == {"n": 12, "mean": 0.5417, "band": "thin", "wording": "thin sample", "range": [-0.374, 1.457]}


def test_rounding_is_half_up_not_bankers():
    # round(0.03125, 4) == 0.0312 (banker's); the JS twin's Math.floor(x + 0.5) gives 0.0313.
    assert ss._round(0.03125, 4) == 0.0313
    assert ss.rate_stat(1, 32)["rate"] == 0.0313


# ── 13A reads R3 from here ──────────────────────────────────────────────────────────────────

def test_plan_grading_reads_r3_from_the_one_home():
    from api.services.journal_two import plan_grading as pg
    assert pg.rate_stat is ss.rate_stat
    assert pg.wilson is ss.wilson
    assert pg.sample_band is ss.band
    assert pg.SAMPLE_WORDING is ss.WORDING
    assert (pg.CONSTANTS["SAMPLE_TOO_FEW_BELOW"], pg.CONSTANTS["SAMPLE_NORMAL_FROM"], pg.CONSTANTS["RANGE_Z"]) == (
        ss.TOO_FEW_BELOW, ss.NORMAL_FROM, ss.RANGE_Z)
    import ast
    tree = ast.parse((ROOT / "api" / "services" / "journal_two" / "plan_grading.py").read_text(encoding="utf-8"))
    defs = {n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
    assert not defs & {"wilson", "rate_stat", "sample_band"}
    # No string literal restates the wording (a comment may name it; code may not).
    assert not [n for n in ast.walk(tree) if isinstance(n, ast.Constant) and n.value in ("too few to judge", "thin sample")]


# ── parity: the JS file, executed ───────────────────────────────────────────────────────────

def _grid():
    rates = [(k, n) for n in range(0, 61) for k in range(0, n + 1)]
    means = []
    seed = 12345
    for n in range(0, 41):
        vals = []
        for _ in range(n):
            seed = (seed * 1103515245 + 12345) % 2147483648
            vals.append(round((seed / 2147483648) * 8 - 3, 4))   # an R between -3 and +5
        means.append(vals)
    return rates, means


_NODE_SCRIPT = r"""
import { pathToFileURL } from 'node:url'
const mod = await import(pathToFileURL(process.argv[1]).href)
let raw = ''
for await (const chunk of process.stdin) raw += chunk
const { rates, means } = JSON.parse(raw)
const out = {
  constants: { TOO_FEW_BELOW: mod.TOO_FEW_BELOW, NORMAL_FROM: mod.NORMAL_FROM, RANGE_Z: mod.RANGE_Z,
               WORDING: mod.WORDING, T975: mod.T975 },
  rates: rates.map(([k, n]) => [mod.rateStat(k, n), mod.wilson(k, n)]),
  means: means.map((v) => [mod.meanStat(v), mod.tInterval(v)]),
  bands: Array.from({ length: 61 }, (_, n) => mod.band(n)),
}
process.stdout.write(JSON.stringify(out))
"""


def _run_js(js_path: Path, payload: dict) -> dict:
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not on PATH")
    proc = subprocess.run([node, "--input-type=module", "-e", _NODE_SCRIPT, str(js_path)],
                          input=json.dumps(payload), capture_output=True, text=True, encoding="utf-8",
                          timeout=60, check=False)
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.strip(), "node printed nothing: a failed invocation, not a pass"
    return json.loads(proc.stdout)


def _python_side(rates, means) -> dict:
    return {
        "constants": {"TOO_FEW_BELOW": ss.TOO_FEW_BELOW, "NORMAL_FROM": ss.NORMAL_FROM, "RANGE_Z": ss.RANGE_Z,
                      "WORDING": ss.WORDING, "T975": list(ss.T975)},
        "rates": [[ss.rate_stat(k, n), list(w) if (w := ss.wilson(k, n)) is not None else None] for k, n in rates],
        "means": [[ss.mean_stat(v), list(t) if (t := ss.t_interval(v)) is not None else None] for v in means],
        "bands": [ss.band(n) for n in range(61)],
    }


def _diffs(py: dict, js: dict) -> list[str]:
    out = []
    if py["constants"] != js["constants"]:
        out.append(f"constants: {py['constants']} != {js['constants']}")
    if py["bands"] != js["bands"]:
        out.append("bands differ")
    for kind in ("rates", "means"):
        for i, (a, b) in enumerate(zip(py[kind], js[kind])):
            if a != b:
                out.append(f"{kind}[{i}]: py {a} != js {b}")
        if len(py[kind]) != len(js[kind]):
            out.append(f"{kind}: {len(py[kind])} vs {len(js[kind])}")
    return out


def test_the_python_and_js_implementations_agree_exactly():
    rates, means = _grid()
    js = _run_js(JS, {"rates": rates, "means": means})
    py = _python_side(rates, means)
    # Non-vacuity: the grid reaches all three bands and real ranges on both kinds.
    assert len(js["rates"]) == len(rates) > 1800 and len(js["means"]) == 41
    assert {r[0]["band"] for r in js["rates"]} == {"too_few", "thin", "normal"}
    assert sum(1 for r in js["means"] if r[0]["range"] is not None) == 15     # n = 10..24
    assert _diffs(py, js) == []


def test_the_parity_rail_can_fail(tmp_path):
    """Control: a JS copy whose band ends at 9 is caught by the same comparison."""
    src = JS.read_text(encoding="utf-8")
    assert "export const TOO_FEW_BELOW = 10\n" in src.replace("\r\n", "\n")
    bad = tmp_path / "sampleSize.js"
    bad.write_text(src.replace("export const TOO_FEW_BELOW = 10", "export const TOO_FEW_BELOW = 9"), encoding="utf-8")
    rates, means = _grid()
    diffs = _diffs(_python_side(rates, means), _run_js(bad, {"rates": rates, "means": means}))
    assert diffs and any("constants" in d for d in diffs) and any(d.startswith("rates[") for d in diffs)
