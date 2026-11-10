"""The vitest shard plan for the full-suite workflow, and the PROOF that it is a partition.

⛔⛔ **WHY THE VITEST JOB IS SHARDED.** It ran UNSHARDED under `timeout-minutes: 100` and
every nightly since 2026-10-28 was killed at that cap (GitHub shows "cancelled"): no totals
line, `collected: 0`, an INVALID record every night. The workflow's own comment said "if
the suite approaches ~80 minutes, shard it (`--shard=i/n`) rather than raising this again".

⛔ **A SHARD PLAN THAT IS NOT A PARTITION IS WORSE THAN NO SHARDING** (`pytest_shards.py`'s
rule, same reason): a file in two shards runs twice, a file in none is never tested, and the
second looks exactly like a pass. `--prove` refuses the plan unless the shards' union equals
the full file list, no file sits in two shards, no shard is empty, and no shard is absent.

⚠️ **THE PLAN IS COMPUTED BY VITEST, NOT HERE.** `app/scripts/vitest-shard-plan.mjs` asks
vitest for its relevant test files and calls the configured sequencer's own `shard()` once
per index — the code `vitest run --shard=i/n` runs. ⚰️ `npx vitest list --shard=i/n
--filesOnly` is NOT usable for this on vitest 4.0.18: `list --filesOnly` never applies
`--shard` (it is applied only at run time, in the pool), and measured on a local checkout it
printed all 4,581 files for `--shard=1/4`. A proof over that output would compare four
copies of one list. This module re-implements nothing; it only checks what vitest said.

Usage:
    python tools/vitest_shards.py --count                 # the shard count (4)
    python tools/vitest_shards.py --list                  # JSON array of shard ids (matrix)
    python tools/vitest_shards.py --prove plan.json       # exit 1 unless a partition
    python tools/vitest_shards.py --self-check
"""
from __future__ import annotations

import argparse
import collections
import json
import pathlib

OK, FAIL = 0, 1

#: ⛔ The ONE place the vitest shard count is written. The workflow's matrix, the
#: `--shard=i/n` denominator and the publisher's expected-shard list all derive from it.
COUNT = 4


def shard_ids(count: int = COUNT) -> list:
    """["1", "2", ..., "<count>"] — strings, because they are artifact-name suffixes."""
    return [str(i) for i in range(1, count + 1)]


def prove(plan: dict, count: int = COUNT) -> dict:
    """{"ok": bool, "problems": [...], "counts": {...}}. Never raises.

    ⛔ Every way a plan can fail to be a partition is a separate, NAMED problem."""
    problems = []
    if not isinstance(plan, dict):
        return {"ok": False, "problems": ["plan is not a JSON object — UNREADABLE"],
                "counts": {}}
    full = plan.get("full")
    shards = plan.get("shards")
    if not isinstance(full, list) or not full:
        problems.append("the full file list is empty or absent — nothing to partition")
        full = []
    if not isinstance(shards, dict):
        problems.append("no shard map in the plan")
        shards = {}
    if plan.get("count") not in (None, count):
        problems.append("plan was computed for %r shards, expected %d"
                        % (plan.get("count"), count))
    dupes_full = sorted(f for f, n in collections.Counter(full).items() if n > 1)
    if dupes_full:
        problems.append("the full list itself names %d file(s) twice: %s"
                        % (len(dupes_full), dupes_full[:5]))
    seen = {}
    overlap = set()
    for sid in shard_ids(count):
        files = shards.get(sid)
        if files is None:
            problems.append("shard %s/%d is ABSENT from the plan" % (sid, count))
            continue
        if not files:
            problems.append("shard %s/%d is EMPTY" % (sid, count))
        for f in files:
            if f in seen:
                overlap.add(f)
            seen.setdefault(f, sid)
    extra_ids = sorted(set(shards) - set(shard_ids(count)))
    if extra_ids:
        problems.append("the plan carries shard ids outside 1..%d: %s" % (count, extra_ids))
    union = set(seen)
    missing = sorted(set(full) - union)
    unknown = sorted(union - set(full))
    if overlap:
        problems.append("%d file(s) in MORE THAN ONE shard: %s"
                        % (len(overlap), sorted(overlap)[:5]))
    if missing:
        problems.append("%d file(s) in NO shard (never tested, reads as a pass): %s"
                        % (len(missing), missing[:5]))
    if unknown:
        problems.append("%d file(s) in a shard but not in the full list: %s"
                        % (len(unknown), unknown[:5]))
    counts = {"full": len(full), "union": len(union),
              "per_shard": {sid: len(shards.get(sid) or []) for sid in shard_ids(count)},
              "overlap": len(overlap), "missing": len(missing), "unknown": len(unknown)}
    return {"ok": not problems, "problems": problems, "counts": counts}


def _self_check() -> int:
    ok = True

    def show(label, got, want):
        nonlocal ok
        good = got == want
        ok &= good
        print("  %-58s -> %-8s %s" % (label, got, "ok" if good else "WRONG (want %s)" % (want,)))

    full = ["a", "b", "c", "d", "e", "f", "g", "h"]
    good = {"count": 4, "full": full,
            "shards": {"1": ["a", "b"], "2": ["c", "d"], "3": ["e", "f"], "4": ["g", "h"]}}
    show("a true partition is ok", prove(good)["ok"], True)
    show("ids are derived from COUNT", shard_ids(), ["1", "2", "3", "4"])
    lost = json.loads(json.dumps(good))
    lost["shards"]["4"] = ["g"]
    show("a file in NO shard is refused", prove(lost)["ok"], False)
    twice = json.loads(json.dumps(good))
    twice["shards"]["1"].append("c")
    show("a file in TWO shards is refused", prove(twice)["ok"], False)
    absent = json.loads(json.dumps(good))
    absent["shards"].pop("3")
    show("an ABSENT shard is refused", prove(absent)["ok"], False)
    # ⚰️ The vitest-4 `list --shard` shape: every shard prints the whole suite.
    copies = {"count": 4, "full": full, "shards": {s: list(full) for s in shard_ids()}}
    show("four copies of the full list (list --shard) is refused", prove(copies)["ok"], False)
    show("an empty plan is refused, never a vacuous pass", prove({})["ok"], False)
    show("a non-object plan is refused", prove(None)["ok"], False)
    # ⛔ NON-VACUITY: the refusals above must not all be the same message.
    show("the refusals NAME different problems",
         len({prove(x)["problems"][0] for x in (lost, twice, absent)}), 3)
    print("SELF-CHECK:", "PASS" if ok else "FAIL")
    return OK if ok else FAIL


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--count", action="store_true", help="print the shard count")
    ap.add_argument("--list", action="store_true", help="print the shard ids as JSON")
    ap.add_argument("--prove", metavar="PLAN_JSON")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return _self_check()
    if a.count:
        print(COUNT)
        return OK
    if a.list:
        print(json.dumps(shard_ids()))
        return OK
    if a.prove:
        try:
            plan = json.loads(pathlib.Path(a.prove).read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            print("::error title=vitest shard plan UNREADABLE::%s" % e)
            return FAIL
        r = prove(plan)
        print("vitest %s, sequencer %s" % (plan.get("vitest_version"), plan.get("sequencer")))
        print(json.dumps(r["counts"], indent=2))
        if not r["ok"]:
            for p in r["problems"]:
                print("::error title=vitest shard plan is NOT a partition::%s" % p)
            return FAIL
        print("PARTITION PROVED: %d files, %d shards, union = full, no overlap, none missing"
              % (r["counts"]["full"], COUNT))
        return OK
    ap.print_help()
    return FAIL


if __name__ == "__main__":
    raise SystemExit(main())
