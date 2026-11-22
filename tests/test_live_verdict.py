"""The live checks' verdict (tools/live_verdict.py): a live check that measured nothing is INCONCLUSIVE, never PASS.
Coordinator ruling 2026-11-20, after the e90 live check printed PASS on a run with no Fred RS legend and 0 worker replies."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools"))

import live_verdict as lv  # noqa: E402


def test_the_self_check_proves_every_branch():
    assert lv.self_check() == 0


def test_a_run_that_measured_nothing_is_inconclusive_and_a_real_one_passes(tmp_path):
    ok_step = {"step": "symbol RDDT", "legend": "Fred RS41.55", "legendValue": 41.55, "flags": []}
    blind = {"step": "symbol RDDT", "legend": None, "legendValue": None, "flags": ["no-legend"]}
    rt = {"dir": "res", "tag": "x/assets/runtimeWorker-abc.js", "ok": True, "msg": None}
    nothing = lv._synthetic(str(tmp_path), "nothing", [blind] * 13, [])
    real = lv._synthetic(str(tmp_path), "real", [ok_step] * 13, [rt] * 20)
    assert lv.verdict(nothing, ["has no bar on"])[0] == lv.INCONCLUSIVE
    assert lv.verdict(real, ["has no bar on"])[0] == lv.PASS
