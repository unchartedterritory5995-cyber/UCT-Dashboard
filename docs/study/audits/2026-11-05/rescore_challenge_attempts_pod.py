"""Repair, on the pod, the challenge attempts the one-key unwrap scored wrong (study_scoring._as_answer_value,
fixed 2026-11-05): Spot the Kicker posted {choice, picked_bar, picked_kind} since 2026-11-04, so every one of
its attempts compared the whole dict against the key and was stored as a miss, with the miss XP.

For each such attempt whose CHOICE matches the item's key under the fixed rule and whose stored verdict is
wrong, in ONE transaction:
  * study_attempts: correct = 1, score = 1.0;
  * study_profile: xp += (XP_CORRECT x difficulty - XP_WRONG), level recomputed, exactly the credit
    record_attempt would have given; study_weekly_xp of the attempt's ET week += the same;
  * study_item_state: misses - 1 (never below 0) and last_correct = 1 when the attempt is the member's
    latest on that item (the due rung is left as it stands: it only schedules a review);
  * study_skill: mastery / band / reps recomputed over the member's attempts the way record_attempt does.
Nothing else: no streak (a streak credits only a finished DAILY set), no badge. Idempotent: a repaired row
is stored correct and is never selected again. Dry run unless APPLY is True. Run it AFTER the fix is live on
the web pod, or new attempts keep arriving mis-scored behind it.

Run on the pod with the scratchpad runner:
  powershell -File run_pod_py.ps1 -Script rescore_challenge_attempts_DRY.py     (APPLY = False)
  powershell -File run_pod_py.ps1 -Script rescore_challenge_attempts_APPLY.py   (APPLY = True)
"""
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.getcwd())
from api.services import study_scoring, study_store as ss  # noqa: E402

APPLY = False
db = os.environ.get("STUDY_DB_PATH") or "/data/study.db"


def rescored(answer, key) -> bool:
    val = answer.get("choice", answer.get("answer")) if isinstance(answer, dict) else answer
    k = key if isinstance(key, dict) else {"answer": key}
    accepted = [k.get("answer")] + list(k.get("accept") or [])
    got = study_scoring._norm(val)
    return got != "" and any(got == study_scoring._norm(x) for x in accepted if x is not None)


def parse_iso(s: str) -> datetime:
    s = (s or "").replace("Z", "+00:00")
    dt = datetime.fromisoformat(s)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


con = sqlite3.connect(db)
con.row_factory = sqlite3.Row
rows = con.execute(
    "SELECT a.id, a.user_id, a.item_id, a.answer_json, a.correct, a.answered_at, i.type, i.skill_id, "
    "i.answer_json AS key_json, i.difficulty FROM study_attempts a JOIN study_items i ON i.id = a.item_id "
    "WHERE a.scored = 1 AND a.correct = 0 AND (a.answer_json LIKE '%picked_kind%' OR a.answer_json LIKE '%picked_setup%') "
    "ORDER BY a.id").fetchall()
plan = []
for r in rows:
    try:
        ans = json.loads(r["answer_json"] or "{}")
        key = json.loads(r["key_json"] or "{}")
    except ValueError:
        continue
    if rescored(ans, key):
        delta = ss.XP_CORRECT * int(r["difficulty"] or 1) - ss.XP_WRONG
        when = parse_iso(r["answered_at"])
        plan.append({"id": int(r["id"]), "user": r["user_id"], "item": r["item_id"], "skill": r["skill_id"],
                     "delta": delta, "week": ss.week_of(ss.et_day_of(when))})

by_user = {}
for p in plan:
    u = by_user.setdefault(p["user"], {"attempts": 0, "xp": 0})
    u["attempts"] += 1
    u["xp"] += p["delta"]
print(json.dumps({"db": db, "candidates_stored_wrong": len(rows), "to_repair": len(plan),
                  "members": len(by_user), "xp_total": sum(p["delta"] for p in plan),
                  "per_member": sorted(by_user.values(), key=lambda v: -v["attempts"])[:20],
                  "first_ids": [p["id"] for p in plan[:10]]}, indent=1))
if not APPLY or not plan:
    print("dry run" if not APPLY else "nothing to repair")
    raise SystemExit(0)

now = datetime.now(timezone.utc)
stamp = now.isoformat()
with con:
    for p in plan:
        con.execute("UPDATE study_attempts SET correct = 1, score = 1.0 WHERE id = ? AND correct = 0", (p["id"],))
        prof = con.execute("SELECT xp FROM study_profile WHERE user_id = ?", (p["user"],)).fetchone()
        if prof is not None:
            xp = int(prof["xp"] or 0) + p["delta"]
            con.execute("UPDATE study_profile SET xp = ?, level = ?, updated_at = ? WHERE user_id = ?",
                        (xp, 1 + xp // ss.XP_PER_LEVEL, stamp, p["user"]))
        con.execute("INSERT INTO study_weekly_xp (user_id, week_et, xp) VALUES (?,?,?) "
                    "ON CONFLICT(user_id, week_et) DO UPDATE SET xp = xp + excluded.xp",
                    (p["user"], p["week"], p["delta"]))
        latest = con.execute("SELECT id FROM study_attempts WHERE user_id = ? AND item_id = ? ORDER BY id DESC LIMIT 1",
                             (p["user"], p["item"])).fetchone()
        if latest is not None and int(latest["id"]) == p["id"]:
            con.execute("UPDATE study_item_state SET misses = MAX(0, misses - 1), last_correct = 1 "
                        "WHERE user_id = ? AND item_id = ?", (p["user"], p["item"]))
        else:
            con.execute("UPDATE study_item_state SET misses = MAX(0, misses - 1) WHERE user_id = ? AND item_id = ?",
                        (p["user"], p["item"]))
    for user, skill in sorted({(p["user"], p["skill"]) for p in plan}):
        arows = con.execute(
            "SELECT a.answered_at, a.score, i.difficulty FROM study_attempts a JOIN study_items i ON i.id = a.item_id "
            "WHERE a.user_id = ? AND i.skill_id = ? AND a.scored = 1 ORDER BY a.id DESC LIMIT 200", (user, skill)).fetchall()
        mastery = ss._mastery_from_attempts(arows, now)
        con.execute("UPDATE study_skill SET mastery = ?, reps = ?, band = ? WHERE user_id = ? AND skill_id = ?",
                    (mastery, len(arows), ss._band(mastery, len(arows)), user, skill))
print(f"done: repaired {len(plan)} attempt(s) for {len(by_user)} member(s), {sum(p['delta'] for p in plan)} XP credited")
