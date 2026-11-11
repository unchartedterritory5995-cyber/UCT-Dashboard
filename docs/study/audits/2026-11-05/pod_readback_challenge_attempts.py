"""Read-only readback of the pod's study.db: the challenge attempts that carried RECORD KEYS beside the
choice (Spot the Kicker's picked_bar / picked_kind since 2026-11-04; Hard mode's picked_setup) and were
scored against the whole dict by the one-key unwrap in study_scoring._as_answer_value (fixed 2026-11-05).
Re-scores each one here, by the fixed rule (the choice, compared the way score_exact compares, with the
key's accept list), so it works before AND after the fix deploys, and prints how many stored verdicts
flip to correct, per skill and per ET day, and how many members are touched (ids counted, never printed).
Never writes.

Run on the pod with the scratchpad runner:
  powershell -File run_pod_py.ps1 -Script pod_readback_challenge_attempts.py
"""
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.getcwd())
from api.services import study_scoring, study_store as ss  # noqa: E402


def parse_iso(s: str) -> datetime:
    s = (s or "").replace("Z", "+00:00")
    dt = datetime.fromisoformat(s)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

db = os.environ.get("STUDY_DB_PATH") or "/data/study.db"
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
con.row_factory = sqlite3.Row
rows = con.execute(
    "SELECT a.id, a.user_id, a.item_id, a.answer_json, a.correct, a.score, a.answered_at, "
    "i.type, i.skill_id, i.answer_json AS key_json, i.difficulty "
    "FROM study_attempts a JOIN study_items i ON i.id = a.item_id "
    "WHERE a.scored = 1 AND (a.answer_json LIKE '%picked_kind%' OR a.answer_json LIKE '%picked_setup%') "
    "ORDER BY a.id").fetchall()


def rescored(answer: dict, key: dict) -> bool:
    """The fixed rule: {choice}/{answer} is the value whatever else rides beside it."""
    val = answer.get("choice", answer.get("answer")) if isinstance(answer, dict) else answer
    k = key if isinstance(key, dict) else {"answer": key}
    accepted = [k.get("answer")] + list(k.get("accept") or [])
    got = study_scoring._norm(val)
    return got != "" and any(got == study_scoring._norm(x) for x in accepted if x is not None)


out = {"db": db, "attempts_with_record_keys": len(rows), "stored_correct": 0, "stored_wrong": 0,
       "flip_to_correct": 0, "stay_wrong": 0, "members_touched": 0, "xp_owed_total": 0,
       "by_skill": {}, "by_day": {}, "first_at": None, "last_at": None}
members = set()
for r in rows:
    try:
        ans = json.loads(r["answer_json"] or "{}")
        key = json.loads(r["key_json"] or "{}")
    except ValueError:
        continue
    right = rescored(ans, key)
    stored = int(r["correct"] or 0)
    out["stored_correct" if stored else "stored_wrong"] += 1
    day = ss.et_day_of(parse_iso(r["answered_at"]))
    sk = out["by_skill"].setdefault(r["skill_id"], {"attempts": 0, "flip": 0})
    dy = out["by_day"].setdefault(day, {"attempts": 0, "flip": 0})
    sk["attempts"] += 1
    dy["attempts"] += 1
    if right and not stored:
        out["flip_to_correct"] += 1
        sk["flip"] += 1
        dy["flip"] += 1
        members.add(r["user_id"])
        out["xp_owed_total"] += ss.XP_CORRECT * int(r["difficulty"] or 1) - ss.XP_WRONG
    elif not right:
        out["stay_wrong"] += 1
    out["first_at"] = out["first_at"] or r["answered_at"]
    out["last_at"] = r["answered_at"]
out["members_touched"] = len(members)
print(json.dumps(out, indent=1, sort_keys=True))
