"""READ-ONLY on the web pod: the Study report the owner asked for (2026-11-07): which questions members miss most, plus
the review state of the bank so the next pass knows what is approved.

Prints, from /data/study.db (opened read-only):
- the review state per segment family and skill (draft / approved / rejected / retired counts), so a generator never
  rewrites an item the owner already approved;
- per skill: attempts, members, accuracy, median answer time (scored attempts only, walk-throughs excluded);
- the 40 most-missed approved items with at least 5 attempts: miss rate, attempts, members, the question, the key, and
  the answer members gave most often when they missed (the confusion to teach against);
- the template-lesson items (lesson_origin 'template') by status, the placeholders the bank still carries.
Member ids are never printed, only counts. Writes nothing.

  ! powershell -File <scratchpad>/run_pod_py.ps1 -Script C:/Users/pgosz/uct-worktrees/study-hve-overlay/docs/study/bank_v2/pod_study_report.py
"""
import json
import os
import sqlite3
import statistics
from collections import Counter, defaultdict

MIN_ATTEMPTS, TOP = 5, 40


def main() -> None:
    db = os.environ.get("STUDY_DB_PATH") or os.path.join(os.environ.get("DATA_DIR", "/data"), "study.db")
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    c.row_factory = sqlite3.Row
    out = {}
    state = defaultdict(Counter)
    for r in c.execute("SELECT skill_id, review_status, count(*) n FROM study_items GROUP BY skill_id, review_status"):
        state[r["skill_id"]][r["review_status"]] = r["n"]
    out["review_state_by_skill"] = {k: dict(v) for k, v in sorted(state.items())}
    tmpl = Counter()
    for r in c.execute("SELECT review_status, count(*) n FROM study_items WHERE lesson_origin='template' GROUP BY review_status"):
        tmpl[r["review_status"]] = r["n"]
    out["template_lessons_by_status"] = dict(tmpl)
    # the ids, so a pass that replaces placeholder lessons touches only what the owner has NOT approved (an import at the
    # same version would swap an approved lesson silently; a higher version would send it back to draft)
    out["template_lesson_ids"] = {st: [r["id"] for r in c.execute(
        "SELECT id FROM study_items WHERE lesson_origin='template' AND review_status=? ORDER BY id", (st,))] for st in tmpl}
    items = {r["id"]: r for r in c.execute("SELECT id, skill_id, type, review_status, prompt_json, answer_json FROM study_items")}
    per_skill = defaultdict(lambda: {"attempts": 0, "correct": 0, "members": set(), "ms": []})
    per_item = defaultdict(lambda: {"attempts": 0, "misses": 0, "members": set(), "wrong": Counter()})
    for r in c.execute("SELECT user_id, item_id, correct, time_ms, answer_json FROM study_attempts WHERE scored=1"):
        it = items.get(r["item_id"])
        if not it:
            continue
        s = per_skill[it["skill_id"]]
        s["attempts"] += 1; s["correct"] += int(r["correct"] or 0); s["members"].add(r["user_id"])
        if r["time_ms"]:
            s["ms"].append(int(r["time_ms"]))
        p = per_item[r["item_id"]]
        p["attempts"] += 1; p["members"].add(r["user_id"])
        if not r["correct"]:
            p["misses"] += 1
            try:
                a = json.loads(r["answer_json"] or "null")
                a = a.get("answer", a) if isinstance(a, dict) else a
            except ValueError:
                a = r["answer_json"]
            p["wrong"][json.dumps(a, sort_keys=True)[:80]] += 1
    out["by_skill"] = {k: {"attempts": v["attempts"], "members": len(v["members"]),
                           "accuracy_pct": round(100 * v["correct"] / v["attempts"], 1) if v["attempts"] else None,
                           "median_seconds": round(statistics.median(v["ms"]) / 1000, 1) if v["ms"] else None}
                       for k, v in sorted(per_skill.items(), key=lambda kv: -kv[1]["attempts"])}
    missed = []
    for iid, p in per_item.items():
        it = items[iid]
        if p["attempts"] < MIN_ATTEMPTS or it["review_status"] != "approved":
            continue
        prompt = json.loads(it["prompt_json"] or "{}")
        missed.append({"id": iid, "skill": it["skill_id"], "type": it["type"],
                       "miss_rate_pct": round(100 * p["misses"] / p["attempts"], 1), "attempts": p["attempts"],
                       "members": len(p["members"]), "q": (prompt.get("q") or prompt.get("question") or "")[:140],
                       "key": json.loads(it["answer_json"] or "{}").get("answer"),
                       "most_common_wrong": p["wrong"].most_common(1)[0][0] if p["wrong"] else None})
    out["most_missed"] = sorted(missed, key=lambda m: (-m["miss_rate_pct"], -m["attempts"]))[:TOP]
    out["totals"] = {"scored_attempts": sum(v["attempts"] for v in per_skill.values()),
                     "members": len(set().union(*[v["members"] for v in per_skill.values()])) if per_skill else 0,
                     "items_with_5_plus_attempts": sum(1 for p in per_item.values() if p["attempts"] >= MIN_ATTEMPTS)}
    print(json.dumps(out, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
