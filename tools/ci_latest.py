""""Latest" is DERIVED from the set of records, never written as a pointer.

⛔⛔ **E CP9 — `results/latest.json` IS DELETED, AND THIS REPLACES IT.** That file was the
only path two publishers both wrote, so it was the single write-conflict point on the
`ci-results` branch: every run rewrote the same blob, and two runs finishing together
produced a non-fast-forward on a file whose content neither needed to share.

⭐ **Per-run records never collide.** `results/<run_id>/summary.json` is written by exactly
one run, so two publishers touch disjoint paths and a rebase is a fast-forward by
construction. Removing the pointer removes the conflict; it does not need a lock.

⛔ **ZERO RECORDS IS NOT ZERO FAILURES.** A reader that finds no records says
**`ZERO-RECORDS`**, never "nothing was wrong" — this programme has mistaken "we could not
look" for "there was nothing to see" repeatedly, and an empty directory is the purest form
of that.

⚠️ **A malformed record is NAMED and the others are still read.** One unparseable file must
not blind a reader to the nine beside it, and it must not be silently skipped either.

⚠️ **Not to be confused with the OTHER `latest.json` in this repository** — `barspack/` and
`intradaypack/` publish R2 manifests under that name. They are a different artifact in a
different system and are untouched by this unit.

Usage:
    python tools/ci_latest.py --results results            # the newest record
    python tools/ci_latest.py --results results --list     # every record, newest first
    python tools/ci_latest.py --self-check
"""
from __future__ import annotations

import argparse
import json
import pathlib

OK, FAIL = 0, 1

ZERO = "ZERO-RECORDS"
MALFORMED = "MALFORMED"


def scan(results_dir) -> dict:
    """{records: [...], malformed: [...], latest: record|None, state: str}.

    A record is `results/<run_id>/summary.json`. `run_id` is compared NUMERICALLY when it
    looks numeric — GitHub run ids are integers and a string sort puts "9" after "34931".
    """
    base = pathlib.Path(results_dir)
    good, bad = [], []
    if base.is_dir():
        for d in sorted(base.iterdir()):
            if not d.is_dir():
                continue
            f = d / "summary.json"
            if not f.is_file():
                continue
            try:
                rec = json.loads(f.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                bad.append(d.name)
                continue
            rec.setdefault("run_id", d.name)
            rec["_dir"] = d.name
            good.append(rec)

    def key(rec):
        rid = str(rec.get("run_id") or rec["_dir"])
        return (1, int(rid)) if rid.isdigit() else (0, 0)

    good.sort(key=key, reverse=True)
    out = {"records": good, "malformed": bad, "latest": good[0] if good else None}
    if not good:
        # ⛔ Three distinguishable nothings, not one.
        out["state"] = ZERO if not bad else MALFORMED
    else:
        out["state"] = "OK"
    return out


def _self_check() -> int:
    import tempfile
    ok = True

    def show(label, got, want):
        nonlocal ok
        good = got == want
        ok &= good
        print("  %-58s -> %-14s %s" % (label, got, "ok" if good else "WRONG (want %s)" % (want,)))

    with tempfile.TemporaryDirectory() as td:
        base = pathlib.Path(td) / "results"

        # ⛔ NON-VACUITY FIRST: an empty tree must not read as a pass.
        r = scan(base)
        show("no directory at all -> ZERO-RECORDS", r["state"], ZERO)
        show("...and latest is None, never an empty dict", r["latest"], None)

        base.mkdir(parents=True)
        show("empty directory -> ZERO-RECORDS", scan(base)["state"], ZERO)

        for rid, verdict in (("34931366450", "RED"), ("9", "RED"), ("34949032368", "GREEN")):
            d = base / rid
            d.mkdir()
            (d / "summary.json").write_text(json.dumps({"run_id": rid, "verdict": verdict}),
                                            encoding="utf-8")
        r = scan(base)
        show("three records are all read", len(r["records"]), 3)
        show("latest is the MAX run id, numerically", r["latest"]["run_id"], "34949032368")
        # ⭐ the string-sort trap: "9" sorts after "34949032368" lexically
        show("a short run id does not win on a string sort",
             r["records"][-1]["run_id"], "9")

        # a malformed record is NAMED, the others still read
        bad = base / "34950000000"
        bad.mkdir()
        (bad / "summary.json").write_text("{not json", encoding="utf-8")
        r = scan(base)
        show("malformed record is NAMED", r["malformed"], ["34950000000"])
        show("...and the good ones are still read", len(r["records"]), 3)
        show("...and state is still OK because records exist", r["state"], "OK")

        # only-malformed is MALFORMED, not ZERO -- they are different facts
        with tempfile.TemporaryDirectory() as td2:
            b2 = pathlib.Path(td2) / "results" / "1"
            b2.mkdir(parents=True)
            (b2 / "summary.json").write_text("{nope", encoding="utf-8")
            r2 = scan(b2.parent)
            show("only-malformed -> MALFORMED, not ZERO-RECORDS", r2["state"], MALFORMED)

        # a directory with no summary.json is simply not a record
        (base / "34951111111").mkdir()
        show("a dir without summary.json is not counted", len(scan(base)["records"]), 3)

    print("SELF-CHECK:", "PASS" if ok else "FAIL")
    return OK if ok else FAIL


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--results", default="results")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return _self_check()

    r = scan(a.results)
    if r["malformed"]:
        print("MALFORMED records (named, not skipped): %s" % ", ".join(r["malformed"]))
    if r["state"] != "OK":
        print(r["state"])
        print("⛔ %s is not 'no failures' — it is 'no record to read'." % r["state"])
        return FAIL
    if a.list:
        for rec in r["records"]:
            print("%-14s %s" % (rec.get("run_id"), rec.get("verdict")))
        return OK
    print(json.dumps(r["latest"], indent=2))
    return OK


if __name__ == "__main__":
    raise SystemExit(main())
