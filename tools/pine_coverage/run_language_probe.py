# -*- coding: utf-8 -*-
"""run_language_probe.py - drive the language-coverage door questions until every input has a row.

  python tools/pine_coverage/run_language_probe.py --inputs <inputs.json> --out <rows.jsonl>

Runs `app/src/components/chart/engine/ast/languageCoverageDoors.measure.test.js` (mode A):
each input, `{key, path}` or `{key, source}`, is asked of BOTH lanes - the host lane's
production member door and the runtime lane's own compile check. It is restarted here until
the whole input list is answered, because one script can kill the process: the input being
asked is named in `current.txt` next to --out, and a death is recorded as a `threw` row for
THAT input only.

⛔ vitest exits 0 when it selects nothing, so success is judged by the ROW COUNT, never by
the exit code (the same rule as run_census.py).
"""
import argparse
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
APP = os.path.join(ROOT, "app")
TEST = "src/components/chart/engine/ast/languageCoverageDoors.measure.test.js"


def done_keys(out):
    ks = set()
    if os.path.exists(out):
        for line in open(out, encoding="utf-8"):
            try:
                ks.add(json.loads(line)["key"])
            except Exception:  # noqa: BLE001 - a torn tail line is re-asked
                pass
    return ks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inputs", required=True, help="json [{key, path | source}]")
    ap.add_argument("--out", required=True, help="jsonl, appended (resumable)")
    ap.add_argument("--max-restarts", type=int, default=40)
    a = ap.parse_args()
    inputs = os.path.abspath(a.inputs)
    out = os.path.abspath(a.out)
    items = json.load(open(inputs, encoding="utf-8"))
    cur = os.path.join(os.path.dirname(out), "current.txt")
    env = dict(os.environ, LANGUAGE_COVERAGE_INPUT=inputs, LANGUAGE_COVERAGE_OUT=out,
               NODE_OPTIONS="--max-old-space-size=6144")
    print("language probe inputs: %d" % len(items), flush=True)
    for attempt in range(a.max_restarts):
        before = done_keys(out)
        if len(before) >= len(items):
            break
        if os.path.exists(cur):
            os.remove(cur)
        rc = subprocess.call(["node", "node_modules/vitest/vitest.mjs", "run", TEST, "--maxWorkers=2"],
                             cwd=APP, env=env)
        after = done_keys(out)
        print("attempt %d rc=%s rows %d -> %d / %d" % (attempt, rc, len(before), len(after), len(items)), flush=True)
        if len(after) >= len(items):
            break
        killer = open(cur, encoding="utf-8").read().strip() if os.path.exists(cur) else ""
        if killer and killer not in after:
            with open(out, "a", encoding="utf-8") as f:
                f.write(json.dumps({"key": killer, "threw": "process died (rc=%s)" % rc}) + "\n")
            print("  recorded killer:", killer, flush=True)
        elif len(after) == len(before):
            sys.exit("no progress and no named killer - stopping rather than looping")
    n = len(done_keys(out))
    print("language probe rows: %d / %d" % (n, len(items)))
    if n < len(items):
        sys.exit(1)


if __name__ == "__main__":
    main()
