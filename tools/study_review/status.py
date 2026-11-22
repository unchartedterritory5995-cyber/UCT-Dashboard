"""One page that says where the Study review stands: python status.py  ->  prints it and writes REVIEW_STATUS.md.

Reads the review answers (verdicts/verdicts.jsonl), the sample queue (chat_review.py's own logic), the apply batches
(scratchpad agents/review*/ work files) and the standing rules (docs/study/REVIEW_LEARNINGS.md).
"""
import collections
import glob
import json
import os
import re

import chat_review as cr

HOME = os.path.dirname(os.path.abspath(__file__))
REPO = "C:/Users/pgosz/uct-worktrees/study-hve-overlay"
SCRATCH = "C:/Users/pgosz/AppData/Local/Temp/claude/681e09c7414dd9be/2f78f6e0-6093-4957-b7d1-8a17d08b7f18/scratchpad/agents"


def main():
    recs = {}
    for line in open(os.path.join(HOME, "verdicts", "verdicts.jsonl"), encoding="utf-8"):
        if line.strip():
            r = json.loads(line)
            recs[r["id"]] = r
    qrec = [r for r in recs.values() if r.get("kind") == "q"]
    drec = [r for r in recs.values() if r.get("kind") == "decision"]
    tot = collections.Counter(r["v"] for r in qrec)
    idx, calls = cr.load("index.json"), cr.load("calls.json")
    try:
        queue, decided = cr.queue(idx, calls, {r["id"]: r for r in qrec})
        q_left = sum(1 for _, i in queue if not decided(i))
        q_total = len(queue)
    except Exception:
        q_left = q_total = None
    applied, pending = set(), collections.defaultdict(list)
    for d in sorted(glob.glob(SCRATCH + "/review*")):
        for f in glob.glob(d + "/F*.json") + glob.glob(d + "/SET*.json") + glob.glob(d + "/V*.json"):
            if re.search(r"\.(upgrade|check|final|preview)\.json$", f):
                continue
            j = json.load(open(f, encoding="utf-8"))
            if not isinstance(j, dict) or "reviewed" not in j:
                continue
            done = os.path.exists(f[:-5] + ".final.json")
            for it in j["reviewed"]:
                if done:
                    applied.add((j["unit"], it["key"]))
                else:
                    pending[os.path.basename(d)].append((j["unit"], it["key"]))
    unapplied = [r for r in qrec if r["v"] != "keep" and (r["unit"].replace("-", "."), r["key"]) not in applied]
    per = collections.defaultdict(collections.Counter)
    for r in qrec:
        per[r["unit"].replace("-", ".")][r["v"]] += 1
    rules = len(re.findall(r"^\d+\. \*\*", open(REPO + "/docs/study/REVIEW_LEARNINGS.md", encoding="utf-8").read(), re.M))
    L = ["# Study review status", "",
         f"- **Sample review:** {sum(tot.values())} answered ({tot['keep']} good, {tot['fix']} change, {tot['cut']} remove)"
         + (f"; {q_left} of {q_total} left in the sample" if q_left is not None else ""),
         f"- **Decisions:** {len(drec)} answered of 134",
         f"- **Answers not yet applied:** {len(unapplied)}" + (f" (batches running: {', '.join(sorted(pending))})" if pending else ""),
         f"- **Standing rules from his review:** {rules} (docs/study/REVIEW_LEARNINGS.md)", "",
         "## Lessons he has sampled", "", "| Lesson | Good | Change | Remove | Status |", "|---|---|---|---|---|"]
    for u, c in sorted(per.items()):
        bad = c["fix"] + c["cut"]
        waiting = sum(1 for r in unapplied if r["unit"].replace("-", ".") == u)
        status = ("reworked (failed sample)" if bad >= 3 else ("fixes applied" if bad else "approved so far")) + (f", {waiting} answer(s) not applied yet" if waiting else "")
        L.append(f"| {u} | {c['keep']} | {c['fix']} | {c['cut']} | {status} |")
    out = "\n".join(L) + "\n"
    open(os.path.join(HOME, "REVIEW_STATUS.md"), "w", encoding="utf-8").write(out)
    print(out)


if __name__ == "__main__":
    main()
