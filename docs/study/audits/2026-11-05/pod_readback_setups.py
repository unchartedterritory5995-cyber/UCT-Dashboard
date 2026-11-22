"""Read-only readback of the pod's study.db around the 2026-11-05 import (PR #819):
statuses, versions and grades of the setups items, the three live Gap Support
lessons that printed None%, the 15 lessons carrying the owner's notes, and the
levels drafts. Prints JSON. Never writes."""
import json
import os
import sqlite3

db = os.environ.get("STUDY_DB_PATH") or "/data/study.db"
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
con.row_factory = sqlite3.Row
SETUP_SKILLS = ("setup.family1.launchpad", "setup.family3.kicker", "setup.family3.hve", "setup.family4.oops",
                "setup.family4.slingshot", "setup.family3.gap_support", "setup.intraday.go_signal")
out = {}
q = ("SELECT id, skill_id, sym, asof, version, review_status, lesson_text, reveal_json, bars_ref, import_flags "
     "FROM study_items WHERE source_ref LIKE 'docs/study/setups/setup_examples.json%'")
rows = [dict(r) for r in con.execute(q)]
by = {}
for r in rows:
    k = f"{r['skill_id']}|{r['review_status']}|v{r['version']}"
    by[k] = by.get(k, 0) + 1
out["setups_by_skill_status_version"] = dict(sorted(by.items()))
out["setups_total"] = len(rows)
out["setups_with_none_in_lesson"] = sorted(f"{r['sym']} {r['asof']} ({r['review_status']})" for r in rows
                                           if "None" in (r["lesson_text"] or ""))
out["setups_with_pending_note"] = sum(1 for r in rows if "owner ruling pending" in (r["lesson_text"] or ""))
grades = {}
for r in rows:
    try:
        g = (json.loads(r["reveal_json"] or "{}") or {}).get("example_grade")
    except ValueError:
        g = None
    if g:
        grades[g] = grades.get(g, 0) + 1
out["setups_example_grades"] = grades
out["setups_flagged"] = sum(1 for r in rows if r["import_flags"] and r["import_flags"] not in ("null", "[]"))
live_none = {"si_b8b6df7ef791": "EDU", "si_392fa99527a1": "MU", "si_5300cd8fafc6": "UAL"}
out["live_gap_support"] = []
for r in rows:
    if r["id"] in live_none:
        lt = r["lesson_text"] or ""
        out["live_gap_support"].append({"sym": live_none[r["id"]], "status": r["review_status"], "version": r["version"],
                                        "none": "None" in lt, "tail": lt[-150:]})
notes = [r for r in rows if "Owner's note:" in (r["lesson_text"] or "")]
out["owner_note_items"] = {"count": len(notes),
                           "versions": sorted({r["version"] for r in notes}),
                           "statuses": sorted({r["review_status"] for r in notes}),
                           "syms": sorted(r["sym"] for r in notes)}
lv = [dict(r) for r in con.execute("SELECT id, skill_id, sym, asof, version, review_status, bars_ref, source_ref, "
                                   "import_flags FROM study_items WHERE type='levels'")]
out["levels"] = {"total": len(lv),
                 "from_bank": sum(1 for r in lv if "setup_examples.json" in (r["source_ref"] or "")),
                 "statuses": sorted({r["review_status"] for r in lv}),
                 "bank_bars_resolved": sum(1 for r in lv if "setup_examples.json" in (r["source_ref"] or "") and r["bars_ref"]),
                 "bank_flagged": sum(1 for r in lv if "setup_examples.json" in (r["source_ref"] or "")
                                     and r["import_flags"] and r["import_flags"] not in ("null", "[]"))}
out["approved_total"] = con.execute("SELECT COUNT(*) FROM study_items WHERE review_status='approved'").fetchone()[0]
print(json.dumps(out, indent=1, sort_keys=True))
