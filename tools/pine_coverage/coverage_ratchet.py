# -*- coding: utf-8 -*-
"""coverage_ratchet.py - THE COVERAGE RATCHET: a committed script that transfers today keeps transferring.

  python tools/pine_coverage/coverage_ratchet.py --lane production            # measure + check (CI)
  python tools/pine_coverage/coverage_ratchet.py --lane runtime-on --write    # measure + update the snapshot
  python tools/pine_coverage/coverage_ratchet.py --lane production --rows <dir>/census.jsonl [--write]
                                                  # judge rows already measured (a CI artifact) instead

WHY (2026-11-16). The coverage census (`run_census.py`) is opt-in and runs on the dev PC only. A script
that transferred could silently stop transferring and every check stayed green. This runs the SAME census
(`coverageMapDoorCensus.measure.test.js`, through `run_census.drive`, the one loop) over the COMMITTED
corpus only (`corpus/committed/`: the scripts this public repo may hold; ⛔ never the reference-only
sample, which is not ours to publish and is not in CI), one lane per run, and compares the scripts that
transfer with the committed snapshot `docs/pine/coverage-ratchet.json` (keys + text sha, no script text).

THE PREDICATE is the coverage map's, imported, never restated (`coverage_map.py`):
  production   `transfers_fully`: the census's `clean` (isClean of step 0) and not a strategy that places
               orders. The headline "transfers fully" of docs/pine/COVERAGE-MAP.md.
  runtime-on   `runtime_on_transfers`: clean, or attached on the runtime lane, or a host document whose run
               half draws what its object program lost (`cleanByRunHalf`), and not placing orders.
Both read step 0 only, so the census runs with cap 1 (no peeling: the wall list is the map's job).

VERDICTS (exit code):
  0 PASS     every snapshot script still transfers. Newly transferring scripts are REPORTED, with the
             exact command that adds them, and do not fail: the builder who moved them updates the
             snapshot in the same PR (docs/pine/COVERAGE-MAP.md, "How to re-run").
  1 LOST     a snapshot script no longer transfers: each is named with what stopped it.
  2 REFUSED  the comparison would prove nothing, and says why:
               * the snapshot is vacuous (fewer scripts than the lane's FLOORS entry), malformed, or its
                 count disagrees with its own list;
               * the snapshot names a script that is not in corpus/committed, or whose text changed;
               * the run measured fewer scripts than the corpus holds, or the corpus holds fewer than
                 corpus/index.json says it does (a truncated checkout), or a row of another lane;
               * the census loop itself did not finish (`run_census.CensusRunError`).
⛔ The census's own exit code is never the verdict (vitest exits 0 when it selects nothing): the ROW COUNT
is, checked twice (in `run_census.drive` and here), and `ratchet-result.json` records it for the CI step to
read back.
"""
import argparse
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import coverage_map as CM  # noqa: E402 -- the predicates and the script sha: one authority
import run_census as RC  # noqa: E402 -- the census loop and the lane proof: one authority

SCHEMA = "uct.pine-coverage-ratchet/v1"
RESULT_SCHEMA = "uct.pine-coverage-ratchet-result/v1"
SNAPSHOT = os.path.join(ROOT, "docs", "pine", "coverage-ratchet.json")
CORPUS = os.path.join(ROOT, "corpus", "committed")
CORPUS_INDEX = os.path.join(ROOT, "corpus", "index.json")
KEY_PREFIX = "committed:"
LANES = (RC.LANE_PRODUCTION, RC.LANE_RUNTIME_ON)
#: step 0 is the whole predicate; a higher cap only peels (the coverage map's wall list)
CAP = 1
#: ⛔ THE NON-VACUITY FLOOR, per lane: a snapshot (or a write) with fewer transferring scripts is refused,
#: so emptying the snapshot cannot silence the ratchet. Set 2026-11-16 a little under the first measure
#: (master e9807547d0 + the ratchet PR, engine 61: production 58, runtime-on 86 of 266; the engine-60
#: coverage map's own census, cap 8, gives the same two sets). Lowering one is a code change, by name, in
#: the PR whose measurement needs it.
FLOORS = {RC.LANE_PRODUCTION: 50, RC.LANE_RUNTIME_ON: 75}
#: a corpus smaller than this is not the committed corpus (a sparse or broken checkout)
MIN_CORPUS = 200

EXIT_PASS, EXIT_LOST, EXIT_REFUSED = 0, 1, 2


# ─── the corpus ───────────────────────────────────────────────────────────────

def corpus_scripts(corpus=CORPUS):
    """{key: {"path", "sha"}} for every committed script, key `committed:<stem>` (the census's own key)."""
    out = {}
    if os.path.isdir(corpus):
        for name in sorted(os.listdir(corpus)):
            if not name.endswith(".pine"):
                continue
            p = os.path.join(corpus, name)
            src = open(p, encoding="utf-8").read()
            out[KEY_PREFIX + name[:-len(".pine")]] = {"path": os.path.abspath(p), "sha": CM.script_sha(src), "src": src}
    return out


def corpus_problems(scripts, index=CORPUS_INDEX):
    """Why this corpus is not the whole committed corpus ([] = it is)."""
    probs = []
    try:
        want = json.load(open(index, encoding="utf-8"))["counts"]["committed"]
    except (OSError, ValueError, KeyError, TypeError) as e:
        return ["corpus/index.json unreadable (%s): cannot say how many committed scripts there should be" % e]
    if len(scripts) != want:
        probs.append("corpus/committed holds %d scripts, corpus/index.json says %d" % (len(scripts), want))
    if len(scripts) < MIN_CORPUS:
        probs.append("corpus/committed holds %d scripts, under the floor %d" % (len(scripts), MIN_CORPUS))
    return probs


# ─── the predicate (imported) and why a row does not meet it ─────────────────

_KILLED = None


def _killed():
    """The runtime kill list's hashes, read once (`coverage_map.runtime_killed_hashes`, the one reader)."""
    global _KILLED
    if _KILLED is None:
        _KILLED = CM.runtime_killed_hashes()
    return _KILLED


def transfers(lane, row, src):
    usage = CM.order_usage_of(src)
    if lane == RC.LANE_RUNTIME_ON:
        return CM.runtime_on_transfers(row, CM.places_orders(usage), CM.is_runtime_killed(src, _killed()),
                                       CM.is_host_listed(src))
    return CM.transfers_fully(row, usage, src)


def wall_of(lane, row, src):
    """One line: what stops a row from transferring (step 0), identifiers only."""
    usage = CM.order_usage_of(src)
    if CM.places_orders(usage):
        return "a strategy that places orders (%s)" % ", ".join(sorted(usage["orders"]))
    if row is None:
        return "no census row"
    st = (row.get("steps") or [{}])[0]
    if row.get("clean") and CM.is_host_listed(src) and not (
            lane == RC.LANE_RUNTIME_ON and row.get("attached") and st.get("lane") == "runtime"):
        return ("on the host known-divergence list (app/src/components/chart/engine/hostKnownDivergence.json): "
                "a committed capture grades DIVERGE on the host lane, refused by name (pine:known-divergence)")
    if (lane == RC.LANE_RUNTIME_ON and row.get("attached") and st.get("lane") == "runtime"
            and CM.is_runtime_killed(src, _killed())):
        return "on the runtime kill list (api/data/pine_runtime_killlist.json): its runtime lane is refused by name"
    if row.get("stuck") == "killed":
        return "killed: %s" % (st.get("threw") or "process died")
    if st.get("threw"):
        return "threw: %s" % str(st.get("threw"))[:160]
    parts = []
    if lane == RC.LANE_RUNTIME_ON and st.get("runtimeDeclined"):
        parts.append("runtime declined %s" % st["runtimeDeclined"].get("code"))
    if not st.get("attached"):
        guards = [r.get("guard") for r in st.get("refusals") or [] if r.get("guard")]
        parts.append("refused %s" % (guards[0] if guards else (st.get("guard") or "(no guard)")))
    else:
        if st.get("installed") is False:
            parts.append("install failed")
        guards = sorted({r.get("guard") for r in st.get("refusals") or [] if r.get("guard")})
        if guards:
            parts.append("attached with refusals %s" % ", ".join(guards))
        if st.get("lossVerdict") not in (None, "clean"):
            parts.append("objects %s" % st.get("lossVerdict"))
            # ⭐⭐ PARITY UNIT 1 - the run half that would draw what the host program lost, as bound
            rhb = st.get("runHalfBound") or {}
            if lane == RC.LANE_RUNTIME_ON and rhb:
                parts.append("run half %s%s" % (rhb.get("state"), " %s" % rhb["code"] if rhb.get("code") else ""))
                if row.get("cleanByRunHalf") and CM.is_runtime_killed(src, _killed()):
                    parts.append("on the runtime kill list (api/data/pine_runtime_killlist.json)")
        if st.get("withheldObjects"):
            parts.append("object program withheld")
        if (st.get("withheldPaints") or 0) > 0:
            parts.append("%d paint(s) withheld" % st["withheldPaints"])
    return "; ".join(parts) or "not clean"


# ─── the rows ─────────────────────────────────────────────────────────────────

def read_rows(path):
    """({key: row}, [problems]) of a census.jsonl. A key answered twice is a problem (which row counts?)."""
    rows, probs, torn = {}, [], 0
    if not os.path.isfile(path):
        return {}, ["no census rows at %s" % path]
    for line in open(path, encoding="utf-8"):
        if not line.strip():
            continue
        try:
            d = json.loads(line)
            k = d["key"]
        except (ValueError, KeyError, TypeError):
            torn += 1
            continue
        if k in rows:
            probs.append("%s answered twice" % k)
        rows[k] = d
    if torn:
        probs.append("%d unreadable line(s) in %s" % (torn, path))
    return rows, probs


def measured_problems(lane, rows, scripts):
    """⛔ A RUN THAT MEASURED FEWER SCRIPTS THAN IT SHOULD: every committed script answered once, in this
    lane, and nothing else."""
    probs = []
    missing = sorted(set(scripts) - set(rows))
    stray = sorted(set(rows) - set(scripts))
    if missing:
        probs.append("measured %d of %d committed scripts; no row for %s%s" % (
            len(scripts) - len(missing), len(scripts), ", ".join(missing[:5]), " ..." if len(missing) > 5 else ""))
    if stray:
        probs.append("rows for %d script(s) not in corpus/committed: %s" % (len(stray), ", ".join(stray[:5])))
    other = sorted({RC.row_lane(r) for r in rows.values() if RC.row_lane(r) != lane})
    if other:
        probs.append("rows of another lane %s in a %s run" % (other, lane))
    return probs


def transfer_set(lane, rows, scripts):
    return {k for k in scripts if k in rows and transfers(lane, rows[k], scripts[k]["src"])}


# ─── the snapshot ─────────────────────────────────────────────────────────────

def load_snapshot(path=SNAPSHOT):
    if not os.path.isfile(path):
        return None
    return json.load(open(path, encoding="utf-8"))


def snapshot_problems(doc, lane, scripts):
    """Why this snapshot cannot be compared against ([] = it can)."""
    if not isinstance(doc, dict) or doc.get("schema") != SCHEMA:
        return ["the snapshot is missing or not %s" % SCHEMA]
    sec = (doc.get("lanes") or {}).get(lane)
    if not isinstance(sec, dict) or not isinstance(sec.get("scripts"), dict):
        return ["the snapshot has no %s lane" % lane]
    names = sec["scripts"]
    probs = []
    if sec.get("count") != len(names):
        probs.append("the %s lane says count %r but lists %d scripts" % (lane, sec.get("count"), len(names)))
    if len(names) < FLOORS[lane]:
        probs.append("VACUOUS: the %s lane lists %d scripts, under the floor %d (FLOORS in coverage_ratchet.py)"
                     % (lane, len(names), FLOORS[lane]))
    unknown = sorted(k for k in names if k not in scripts)
    if unknown:
        probs.append("the %s lane names %d script(s) not in corpus/committed: %s" % (lane, len(unknown), ", ".join(unknown[:5])))
    changed = sorted(k for k, sha in names.items() if k in scripts and scripts[k]["sha"] != sha)
    if changed:
        probs.append("the text of %d snapshot script(s) changed since the snapshot (sha differs): %s - re-measure and "
                     "--write" % (len(changed), ", ".join(changed[:5])))
    return probs


def snapshot_text(doc):
    return json.dumps(doc, indent=1, sort_keys=True, ensure_ascii=True) + "\n"


def write_snapshot(path, doc, lane, keys, scripts):
    doc = dict(doc or {})
    doc["schema"] = SCHEMA
    doc["about"] = ("The committed-corpus scripts (corpus/committed) that transfer on each lane, by the coverage "
                    "map's predicate. Written by tools/pine_coverage/coverage_ratchet.py --write; checked by the "
                    "pine-heavy coverage-ratchet legs. Keys and text sha only.")
    lanes = dict(doc.get("lanes") or {})
    lanes[lane] = {"count": len(keys), "scripts": {k: scripts[k]["sha"] for k in sorted(keys)}}
    doc["lanes"] = lanes
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(snapshot_text(doc))
    os.replace(tmp, path)


# ─── the commands a builder runs ─────────────────────────────────────────────

def update_commands(lane):
    rel = "tools/pine_coverage/coverage_ratchet.py"
    cmds = []
    run_id, repo = os.environ.get("GITHUB_RUN_ID"), os.environ.get("GITHUB_REPOSITORY")
    if run_id and repo:
        cmds.append("gh run download %s --repo %s -n pine-coverage-ratchet-%s -D <scratch>/ratchet-%s && "
                    "python %s --lane %s --rows <scratch>/ratchet-%s/census.jsonl --write"
                    % (run_id, repo, lane, lane, rel, lane, lane))
    cmds.append("python C:/Users/Patrick/uct-clips/tools/heavy_lock.py run --label ratchet-%s -- python %s --lane %s --write"
                % (lane, rel, lane))
    return cmds


# ─── the run ──────────────────────────────────────────────────────────────────

def measure(lane, scripts, out_dir):
    """The census over every committed script, in `lane`, into `out_dir` (must be empty: ⛔ never judge a
    census.jsonl left by another tree as today's)."""
    if os.path.isdir(out_dir) and os.listdir(out_dir):
        raise RC.CensusRunError("--out %s is not empty: a ratchet measures into a fresh directory" % out_dir)
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "inputs.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump({k: v["sha"] for k, v in sorted(scripts.items())}, f, indent=1, sort_keys=True)
        f.write("\n")
    items = [{"key": k, "path": scripts[k]["path"], "cap": CAP} for k in sorted(scripts)]
    print("coverage ratchet: measuring %d committed scripts, lane %s, cap %d -> %s" % (len(items), lane, CAP, out_dir),
          flush=True)
    RC.drive(items, out_dir, lane)
    return os.path.join(out_dir, "census.jsonl")


def rows_dir_problems(rows_path, lane, scripts):
    """`--rows`: the rows were measured on THESE texts (inputs.json beside them) and in THIS lane (lane.jsonl)."""
    d = os.path.dirname(os.path.abspath(rows_path))
    probs = []
    try:
        RC.assert_lane_measured(d, lane)
    except RC.CensusRunError as e:
        probs.append(str(e))
    try:
        measured = json.load(open(os.path.join(d, "inputs.json"), encoding="utf-8"))
    except (OSError, ValueError) as e:
        return probs + ["no readable inputs.json beside %s (%s): cannot say which texts were measured" % (rows_path, e)]
    diff = sorted(k for k in scripts if measured.get(k) != scripts[k]["sha"])
    if diff:
        probs.append("%d script(s) here differ from the texts the rows were measured on: %s" % (len(diff), ", ".join(diff[:5])))
    return probs


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass
    ap = argparse.ArgumentParser(description="The coverage ratchet over corpus/committed (see the module docstring).")
    ap.add_argument("--lane", required=True, choices=LANES)
    ap.add_argument("--out", default=None, help="an EMPTY directory to measure into (default: a new temp directory)")
    ap.add_argument("--rows", default=None, help="judge this census.jsonl (with lane.jsonl and inputs.json beside it) "
                                                 "instead of measuring")
    ap.add_argument("--write", action="store_true", help="update the snapshot's lane from the measurement")
    ap.add_argument("--snapshot", default=SNAPSHOT)
    ap.add_argument("--corpus", default=CORPUS, help=argparse.SUPPRESS)
    ap.add_argument("--corpus-index", default=CORPUS_INDEX, help=argparse.SUPPRESS)
    ap.add_argument("--summary", default=None, help="append a markdown summary here (CI: $GITHUB_STEP_SUMMARY)")
    a = ap.parse_args(argv)
    lane = a.lane
    gha = os.environ.get("GITHUB_ACTIONS") == "true"
    scripts = corpus_scripts(a.corpus)
    out_dir = os.path.abspath(a.out) if a.out else tempfile.mkdtemp(prefix="coverage-ratchet-%s-" % lane)
    result = {"schema": RESULT_SCHEMA, "lane": lane, "expected": len(scripts), "measured": 0, "transfer": None,
              "snapshot": None, "lost": [], "gained": [], "problems": [], "verdict": None}

    def finish(verdict, code):
        result["verdict"] = verdict
        where = os.path.dirname(os.path.abspath(a.rows)) if a.rows else out_dir
        os.makedirs(where, exist_ok=True)
        with open(os.path.join(where, "ratchet-result.json"), "w", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(result, indent=1, sort_keys=True) + "\n")
        for p in result["problems"]:
            print(("::error title=coverage ratchet (%s)::" % lane if gha else "REFUSED: ") + p)
        for x in result["lost"]:
            print(("::error title=coverage ratchet (%s): stopped transferring::" % lane if gha else "LOST: ")
                  + "%s - %s" % (x["key"], x["wall"]))
        for k in result["gained"]:
            print(("::notice title=coverage ratchet (%s): newly transferring::" % lane if gha else "GAINED: ") + k)
        if result["gained"] or result["lost"]:
            print("update the snapshot in the PR that moved it (docs/pine/COVERAGE-MAP.md, How to re-run):")
            for c in update_commands(lane):
                print("  " + c)
        line = ("VERDICT: %s - lane %s, measured %d of %d committed scripts, %s transfer, snapshot %s, lost %d, gained %d"
                % (verdict, lane, result["measured"], result["expected"], result["transfer"], result["snapshot"],
                   len(result["lost"]), len(result["gained"])))
        print(line, flush=True)
        if a.summary:
            with open(a.summary, "a", encoding="utf-8") as f:
                f.write("### coverage ratchet, %s lane\n\n%s\n\n" % (lane, line))
                for x in result["lost"]:
                    f.write("- LOST `%s`: %s\n" % (x["key"], x["wall"]))
                for k in result["gained"]:
                    f.write("- newly transferring `%s`\n" % k)
                for p in result["problems"]:
                    f.write("- REFUSED: %s\n" % p)
                if result["gained"] or result["lost"]:
                    f.write("\nUpdate the snapshot in this PR:\n\n```\n%s\n```\n" % "\n".join(update_commands(lane)))
                f.write("\n")
        return code

    result["problems"] += corpus_problems(scripts, a.corpus_index)
    if result["problems"]:
        return finish("REFUSED", EXIT_REFUSED)
    try:
        if a.rows:
            rows_path = a.rows
            result["problems"] += rows_dir_problems(rows_path, lane, scripts)
        else:
            rows_path = measure(lane, scripts, out_dir)
    except RC.CensusRunError as e:
        result["problems"].append("the census did not finish: %s" % e)
        return finish("REFUSED", EXIT_REFUSED)
    rows, probs = read_rows(rows_path)
    result["measured"] = len(set(rows) & set(scripts))
    result["problems"] += probs + measured_problems(lane, rows, scripts)
    if result["problems"]:
        return finish("REFUSED", EXIT_REFUSED)
    now = transfer_set(lane, rows, scripts)
    result["transfer"] = len(now)
    doc = load_snapshot(a.snapshot)

    if a.write:
        if len(now) < FLOORS[lane]:
            result["problems"].append("%d scripts transfer on %s, under the floor %d: refusing to write a vacuous "
                                      "snapshot (if the drop is real, lower FLOORS['%s'] in coverage_ratchet.py in this "
                                      "same PR)" % (len(now), lane, FLOORS[lane], lane))
            return finish("REFUSED", EXIT_REFUSED)
        had = set((((doc or {}).get("lanes") or {}).get(lane) or {}).get("scripts") or {})
        for k in sorted(had - now):
            print("REMOVED from the %s snapshot (no longer transfers: %s): %s" % (lane, wall_of(lane, rows.get(k), scripts[k]["src"])
                                                                               if k in scripts else "not in the corpus", k))
        for k in sorted(now - had):
            print("ADDED to the %s snapshot: %s" % (lane, k))
        write_snapshot(a.snapshot, doc, lane, now, scripts)
        result["snapshot"] = len(now)
        print("wrote %s (%s lane: %d scripts)" % (a.snapshot, lane, len(now)))
        return finish("WRITTEN", EXIT_PASS)

    result["problems"] += snapshot_problems(doc, lane, scripts)
    if result["problems"]:
        return finish("REFUSED", EXIT_REFUSED)
    snap = set(doc["lanes"][lane]["scripts"])
    result["snapshot"] = len(snap)
    result["lost"] = [{"key": k, "wall": wall_of(lane, rows.get(k), scripts[k]["src"])} for k in sorted(snap - now)]
    result["gained"] = sorted(now - snap)
    if result["lost"]:
        return finish("LOST", EXIT_LOST)
    return finish("PASS", EXIT_PASS)


if __name__ == "__main__":
    sys.exit(main())
