"""D-06 Part 6 — every gate run leaves a per-row snapshot, and "gate impact" is a DIFF.

⚰️ WHY THIS EXISTS, IN ONE INCIDENT. D-05 closed reporting the gate at
**5 MET / 3 NOT MET / 3 NOT MEASURABLE**. Re-run an hour later at the same tip it read
**6 / 3 / 2**. Nobody could say which row moved, because nothing had ever written down
what the rows WERE — every previous report quoted a tally from memory. The honest answer
had to be *"the mover cannot be established"*, and a programme that measures everything
else to the byte should not be guessing about its own headline number.

⛔ A TALLY IS NOT A SNAPSHOT. Three integers cannot tell you which row moved, and they
are exactly the shape that invites a recollection to stand in for a reading. The unit
here is the ROW — key, verdict, evidence, timestamp, HEAD.

⛔ AND A VERDICT CHANGE IS NOT AN EVIDENCE CHANGE. The soak row's evidence carries a
tick count that moves every hour while its verdict sits still; the canary row's evidence
carries a timestamp. If those were reported as "changes" the diff would be noise within a
day and nobody would read it. They are reported, separately, and never as gate impact.
"""
from __future__ import annotations

import datetime as _dt
import json
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SNAP_DIR = ROOT / "docs" / "discord-render" / "evidence" / "gate-snapshots"

SCHEMA = 1


def head_sha(root: pathlib.Path | None = None) -> str:
    """The tree's HEAD, or `"unknown"`. ⛔ Never raises and never guesses: a snapshot
    that cannot say which code produced it says so, rather than carrying a plausible
    sha from somewhere else."""
    try:
        r = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(root or ROOT),
                           capture_output=True, text=True, timeout=30,
                           encoding="utf-8", errors="replace")
        return (r.stdout or "").strip()[:9] or "unknown"
    except Exception:  # noqa: BLE001
        return "unknown"


def build(rows, *, sha: str | None = None, at: _dt.datetime | None = None,
          label: str = "") -> dict:
    """A snapshot from `flip_preconditions.evaluate()`'s rows."""
    at = at or _dt.datetime.now(_dt.timezone.utc)
    return {
        "schema": SCHEMA,
        "at": at.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "sha": sha if sha is not None else head_sha(),
        "label": label,
        "rows": [{"key": r.get("key") or r.get("precondition"),
                  "precondition": r.get("precondition"),
                  "state": r.get("state"),
                  "evidence": r.get("evidence")} for r in rows],
    }


def write(snap: dict, directory: pathlib.Path | None = None) -> pathlib.Path:
    d = pathlib.Path(directory or SNAP_DIR)
    d.mkdir(parents=True, exist_ok=True)
    stamp = snap["at"].replace(":", "").replace("-", "")
    p = d / f"{stamp}-{snap['sha']}.json"
    # ⚰️ CAUGHT BY RUNNING IT TWICE, WHICH IS THE ONLY REASON IT WAS FOUND. The gate
    # evaluates in well under a second, so two runs land in the SAME second and a
    # second-resolution filename silently overwrote the first — leaving one file where
    # there should have been two, and a diff that compared a snapshot with ITSELF and
    # reported "NO GATE CHANGE". A history that quietly drops entries is worse than no
    # history: it reads as evidence that nothing moved.
    n = 2
    while p.exists():
        p = d / f"{stamp}-{snap['sha']}-{n}.json"
        n += 1
    # ⛔ Write to a temp file then replace. `open('w')` truncates BEFORE the write can
    # fail, and a half-written snapshot is worse than none — it reads as a real reading.
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(snap, indent=1) + "\n", encoding="utf-8")
    tmp.replace(p)
    return p


def load(path) -> dict:
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))


def listing(directory: pathlib.Path | None = None) -> list:
    d = pathlib.Path(directory or SNAP_DIR)
    if not d.is_dir():
        return []
    return sorted(d.glob("*.json"))


def diff(old: dict, new: dict) -> dict:
    """What moved between two snapshots.

    ⛔ Keyed by ROW KEY, never by position. A row inserted into `CHECKS` would shift
    every row after it and a positional diff would report the whole table as changed —
    which is indistinguishable from the table actually changing.
    """
    o = {r["key"]: r for r in old.get("rows", [])}
    n = {r["key"]: r for r in new.get("rows", [])}
    verdict_changes, evidence_changes = [], []
    for k in sorted(set(o) & set(n)):
        if o[k]["state"] != n[k]["state"]:
            verdict_changes.append({"key": k, "precondition": n[k].get("precondition"),
                                    "from": o[k]["state"], "to": n[k]["state"],
                                    "evidence_from": o[k].get("evidence"),
                                    "evidence_to": n[k].get("evidence")})
        elif o[k].get("evidence") != n[k].get("evidence"):
            evidence_changes.append({"key": k, "precondition": n[k].get("precondition"),
                                     "state": n[k]["state"],
                                     "from": o[k].get("evidence"), "to": n[k].get("evidence")})
    return {
        "from": {"at": old.get("at"), "sha": old.get("sha")},
        "to": {"at": new.get("at"), "sha": new.get("sha")},
        "verdict_changes": verdict_changes,
        "evidence_changes": evidence_changes,
        "added": sorted(set(n) - set(o)),
        "removed": sorted(set(o) - set(n)),
        "unchanged": len([k for k in set(o) & set(n)
                          if o[k]["state"] == n[k]["state"]
                          and o[k].get("evidence") == n[k].get("evidence")]),
    }


def tally(snap: dict) -> dict:
    t: dict = {}
    for r in snap.get("rows", []):
        t[r["state"]] = t.get(r["state"], 0) + 1
    return t


def render(d: dict, out=print) -> None:
    out(f"  from {d['from']['at']} ({d['from']['sha']})  ->  {d['to']['at']} ({d['to']['sha']})")
    if not (d["verdict_changes"] or d["added"] or d["removed"]):
        # ⛔ SAID IN WORDS. "no change" has to be a printed sentence, not an empty
        # section — an empty section and a diff that never ran look identical.
        out(f"  NO GATE CHANGE — {d['unchanged']} row(s) identical, "
            f"{len(d['evidence_changes'])} with evidence that moved but the same verdict.")
    for c in d["verdict_changes"]:
        out(f"  ROW MOVED  {c['key']}: {c['from']} -> {c['to']}  ({c['precondition']})")
        out(f"             was: {str(c['evidence_from'])[:110]}")
        out(f"             now: {str(c['evidence_to'])[:110]}")
    for k in d["added"]:
        out(f"  ROW ADDED    {k}")
    for k in d["removed"]:
        out(f"  ROW REMOVED  {k}")
    for c in d["evidence_changes"]:
        out(f"  evidence only ({c['state']}) {c['key']}")


# ── self-check ───────────────────────────────────────────────────────────────

def _snap(rows, at="2026-09-15T00:00:00Z", sha="aaaaaaaaa"):
    return {"schema": SCHEMA, "at": at, "sha": sha, "label": "",
            "rows": [{"key": k, "precondition": k, "state": s, "evidence": e}
                     for k, s, e in rows]}


def self_check(out=print) -> int:
    sys.path.insert(0, str(HERE))
    from selfcheck import Cases
    cases = Cases("gate_snapshot")

    base = _snap([("a", "MET", "e1"), ("b", "NOT MET", "e2"), ("c", "NOT MEASURABLE", "e3")])

    # ⛔ NON-VACUITY, and it is the one the directive names.
    same = diff(base, _snap([("a", "MET", "e1"), ("b", "NOT MET", "e2"),
                             ("c", "NOT MEASURABLE", "e3")]))
    cases.add("two identical snapshots diff to NO CHANGE",
              same["verdict_changes"] == [] and same["added"] == [] and same["removed"] == []
              and same["evidence_changes"] == [] and same["unchanged"] == 3)

    # ⛔ THE MUTATION THIS RAIL IS FOR: a row moved and the diff must NAME it.
    moved = diff(base, _snap([("a", "MET", "e1"), ("b", "MET", "e2-now"),
                              ("c", "NOT MEASURABLE", "e3")]))
    cases.add("a row whose verdict moved is reported BY KEY, with both states",
              [(c["key"], c["from"], c["to"]) for c in moved["verdict_changes"]]
              == [("b", "NOT MET", "MET")])
    cases.add("...and it is not ALSO counted as an evidence-only change",
              moved["evidence_changes"] == [])

    # ⛔ The noise case: evidence moves, verdict does not. Reported, never as impact.
    eonly = diff(base, _snap([("a", "MET", "e1-93-ticks"), ("b", "NOT MET", "e2"),
                              ("c", "NOT MEASURABLE", "e3")]))
    cases.add("evidence that moved under a steady verdict is NOT a gate change",
              eonly["verdict_changes"] == []
              and [c["key"] for c in eonly["evidence_changes"]] == ["a"])

    # ⛔ Keyed, not positional.
    reordered = diff(base, _snap([("c", "NOT MEASURABLE", "e3"), ("a", "MET", "e1"),
                                  ("b", "NOT MET", "e2")]))
    cases.add("reordering the table is not a change (keyed, never positional)",
              reordered["verdict_changes"] == [] and reordered["unchanged"] == 3)

    added = diff(base, _snap([("a", "MET", "e1"), ("b", "NOT MET", "e2"),
                              ("c", "NOT MEASURABLE", "e3"), ("d", "MET", "e4")]))
    cases.add("a new row is reported as ADDED, never as a silent pass",
              added["added"] == ["d"] and added["removed"] == [])
    gone = diff(_snap([("a", "MET", "e1"), ("b", "NOT MET", "e2"),
                       ("c", "NOT MEASURABLE", "e3"), ("d", "MET", "e4")]), base)
    cases.add("a row that disappears is reported as REMOVED",
              gone["removed"] == ["d"])

    # ⛔ The rendered sentence, not the dict. `lesson_rail_the_sentence_not_just_the_guard`:
    # a caller reads the printed line, and an empty section reads like a diff that never ran.
    lines: list = []
    render(same, out=lines.append)
    cases.add("an unchanged diff SAYS 'NO GATE CHANGE' in words",
              any("NO GATE CHANGE" in l for l in lines))
    lines2: list = []
    render(moved, out=lines2.append)
    cases.add("...and a moved row prints ROW MOVED with the key",
              any("ROW MOVED" in l and "b" in l for l in lines2))

    # ⛔ A snapshot that cannot say which code produced it must say so, not invent one.
    cases.add("head_sha never raises and never returns empty",
              isinstance(head_sha(), str) and len(head_sha()) > 0)

    t = tally(base)
    cases.add("the tally is DERIVED from the rows, not carried beside them",
              t == {"MET": 1, "NOT MET": 1, "NOT MEASURABLE": 1})

    # write -> load round trip, into a temp dir (never the repo's evidence)
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        p = write(base, directory=pathlib.Path(td))
        cases.add("a written snapshot loads back identical", load(p) == base)
        cases.add("...and no .tmp file is left behind",
                  list(pathlib.Path(td).glob("*.tmp")) == [])
        # ⛔ THE COLLISION. The gate runs in under a second, so two runs share a
        # second-resolution stamp. Overwriting would leave ONE file where two runs
        # happened and make the next diff compare a snapshot with itself.
        p2 = write(_snap([("a", "NOT MET", "e1")]), directory=pathlib.Path(td))
        cases.add("a second snapshot in the SAME second does not overwrite the first",
                  p2 != p and p.exists() and p2.exists()
                  and len(list(pathlib.Path(td).glob("*.json"))) == 2)
        cases.add("...and the first one still holds its own rows",
                  load(p)["rows"][0]["state"] == "MET"
                  and load(p2)["rows"][0]["state"] == "NOT MET")
    return 0 if cases.report(out) == 0 else 1


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if "--self-check" in argv:
        return self_check()
    files = [a for a in argv if not a.startswith("-")]
    if len(files) == 2:
        render(diff(load(files[0]), load(files[1])))
        return 0
    snaps = listing()
    if "--list" in argv or len(snaps) < 2:
        for p in snaps:
            s = load(p)
            print(f"  {s['at']}  {s['sha']}  {tally(s)}  {p.name}")
        if len(snaps) < 2:
            print(f"  {len(snaps)} snapshot(s) — a diff needs two. Run the gate again.")
        return 0
    render(diff(load(snaps[0]), load(snaps[-1])))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
