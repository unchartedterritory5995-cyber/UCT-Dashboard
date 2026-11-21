"""THE LIVE CHECKS' VERDICT (coordinator ruling 2026-11-20): a live check that measured nothing is INCONCLUSIVE, never PASS.

⚰️ 2026-11-20 18:33Z: the e90 live check started a minute after the deploy, Fred RS never appeared on its chart (the House
install pressed, no legend on any of 13 steps), its worker log held 0 replies, and it printed PASS because "0 replies refused
the hole sentence". An absence is evidence only where the instrument could have seen a presence.

verdict(run_dir, forbid) -> (verdict, why), verdict one of PASS / FAIL / INCONCLUSIVE, read from a fred_rs_wprobe.py run dir:
  INCONCLUSIVE  no sweep.json, no step, ANY step without the Fred RS legend (`no-legend`), or no RUNTIME worker reply
                (`runtimeWorker` tag): the check could not have seen what it looks for;
  FAIL          a runtime reply whose message matches any of `forbid` (regexes);
  PASS          otherwise.
`python tools/live_verdict.py --self-check` proves each branch on synthetic runs (railed by tests/test_live_verdict.py);
`python tools/live_verdict.py <run_dir> <regex>...` prints the verdict of a real run (exit 0 PASS, 1 FAIL, 2 INCONCLUSIVE).
A run dir is what the Fred RS live sweep writes (`sweep.json` with members -> steps, `wlog-*.json` worker replies); it is
local evidence and never committed. This file holds the verdict logic and its synthetic cases only."""
import glob
import json
import os
import re
import sys
import tempfile

PASS, FAIL, INCONCLUSIVE = "PASS", "FAIL", "INCONCLUSIVE"


def _load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def verdict(run_dir, forbid=()):
    sweep_path = os.path.join(run_dir, "sweep.json")
    if not os.path.exists(sweep_path):
        return INCONCLUSIVE, "no sweep.json: the sweep did not run"
    sweep = _load(sweep_path)
    steps = [s for m in (sweep.get("members") or {}).values() for s in (m.get("steps") or [])]
    if not steps:
        return INCONCLUSIVE, "the sweep recorded no step"
    blind = [s.get("step") for s in steps if "no-legend" in (s.get("flags") or []) or s.get("legend") is None]
    if blind:
        return INCONCLUSIVE, f"{len(blind)}/{len(steps)} steps had no Fred RS legend on the chart (first: {blind[0]!r})"
    replies = []
    for f in glob.glob(os.path.join(run_dir, "wlog-*.json")):
        replies += [e for e in _load(f) if isinstance(e, dict) and e.get("dir") == "res"]
    runtime = [e for e in replies if "runtimeWorker" in str(e.get("tag") or "")]
    if not runtime:
        return INCONCLUSIVE, f"0 runtime worker replies ({len(replies)} replies in all): nothing the check looks for was measured"
    pats = [re.compile(p) for p in forbid]
    bad = [str(e.get("msg") or "")[:200] for e in runtime if any(p.search(str(e.get("msg") or "")) for p in pats)]
    if bad:
        return FAIL, f"{len(bad)} of {len(runtime)} runtime replies say what is forbidden: {bad[0]!r}"
    return PASS, f"{len(steps)} steps with the legend, {len(runtime)} runtime replies, none forbidden"


def _synthetic(tmp, name, steps, replies):
    d = os.path.join(tmp, name)
    os.makedirs(d)
    if steps is not None:
        with open(os.path.join(d, "sweep.json"), "w", encoding="utf-8") as fh:
            json.dump({"members": {"tfs": {"steps": steps}}}, fh)
    with open(os.path.join(d, "wlog-tfs.json"), "w", encoding="utf-8") as fh:
        json.dump(replies, fh)
    return d


def self_check():
    ok_step = {"step": "symbol RDDT", "legend": "Fred RS41.55", "legendValue": 41.55, "flags": []}
    blind_step = {"step": "symbol RDDT", "legend": None, "legendValue": None, "flags": ["no-legend"]}
    rt = lambda msg=None: {"dir": "res", "tag": "x/assets/runtimeWorker-abc.js", "ok": msg is None, "msg": msg}
    host = {"dir": "res", "tag": "x/assets/hostLaneWorker-abc.js", "ok": True, "msg": None}
    hole = r"`SPX` has no bar on \d+, after its history began"
    cases = [
        ("⚰️ the 18:33Z run: no legend on any step, 0 replies -> INCONCLUSIVE", [blind_step] * 3, [], INCONCLUSIVE),
        ("legends drawn but 0 runtime replies (host replies only) -> INCONCLUSIVE", [ok_step], [host, host], INCONCLUSIVE),
        ("one step without the legend -> INCONCLUSIVE", [ok_step, blind_step], [rt()], INCONCLUSIVE),
        ("no sweep at all -> INCONCLUSIVE", None, [rt()], INCONCLUSIVE),
        ("⛔ CONTROL: real legends and runtime replies, none forbidden -> PASS", [ok_step, ok_step], [rt(), host], PASS),
        ("a runtime reply saying the forbidden sentence -> FAIL", [ok_step],
         [rt(), rt("a `request.security` cannot be read — `SPX` has no bar on 1761053400, after its history began")], FAIL),
        ("⛔ another symbol's sentence is not the forbidden one -> PASS", [ok_step],
         [rt("`this symbol's daily bars` has no bar on 1777907100, after its history began")], PASS),
    ]
    good = 0
    with tempfile.TemporaryDirectory() as tmp:
        for i, (name, steps, replies, want) in enumerate(cases):
            got, why = verdict(_synthetic(tmp, f"c{i}", steps, replies), [hole])
            ok = got == want
            good += ok
            print(f"  [{'PASS' if ok else 'FAIL'}] {name} (got {got}: {why})")
    print(f"[self-check] {good}/{len(cases)}")
    return 0 if good == len(cases) else 1


if __name__ == "__main__":
    if sys.argv[1:2] == ["--self-check"]:
        sys.exit(self_check())
    v, why = verdict(sys.argv[1], sys.argv[2:])
    print(f"{v}: {why}")
    sys.exit({PASS: 0, FAIL: 1, INCONCLUSIVE: 2}[v])
