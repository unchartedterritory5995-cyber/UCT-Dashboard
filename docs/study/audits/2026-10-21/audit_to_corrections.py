"""Turn the 2026-10-21 audit verdicts into docs/study/corrections records for the
segments that wait on no owner ruling. Idempotent: an item that already carries
an audit record is skipped. Prints what it appended per segment.

  python -I -X utf8 audit_to_corrections.py seg [seg ...]
"""
import json
import pathlib
import sys
from collections import Counter

REPO = pathlib.Path("C:/Users/pgosz/uct-worktrees/study-import")
AUDITS = REPO / "docs/study/audits/2026-10-21"
CORR = REPO / "docs/study/corrections"
BY = ('session audit 2026-10-21; the owner delegated the tightening '
      '("whatever you suggest honestly")')
FIELD_MAP = {
    "reveal_json.support": "reveal.support",
    "prompt_json.format": "prompt.format",
    "steps": "prompt.steps",
}
TS = "2026-10-21"


def records_for(row, audit_file):
    base = {"ts": TS, "item_id": row["item_id"], "segment": row["segment"], "owner_words": "whatever you suggest honestly",
            "by": BY, "audit": f"docs/study/audits/2026-10-21/{audit_file}#{row['item_id']}"}
    v = row["verdict"]
    if v == "cut":
        rec = dict(base, verdict="reject", reason=row.get("code") or "other", note=row.get("reason") or "")
        if row.get("duplicate_of"):
            rec["duplicate_of"] = row["duplicate_of"]
        return [rec]
    if v != "fix" or not row.get("fix"):
        return []
    fix = row["fix"]
    edits = [{"field": fix["field"], "after": fix["after"]}] + list(fix.get("also") or [])
    flat = []
    for e in edits:
        a = e["after"]
        if e["field"] == "answer" and isinstance(a, dict):
            # the audit hands the whole answer_json; the store keeps the key and the accept list apart
            flat.append({"field": "answer", "after": a["answer"]})
            if "accept" in a:
                flat.append({"field": "answer.accept", "after": a["accept"]})
        else:
            flat.append(e)
    out = []
    for e in flat:
        field = FIELD_MAP.get(e["field"], e["field"])
        rec = dict(base, verdict="fix", field=field, after=e["after"], status="confirmed",
                   note=row.get("reason") or "")
        if field == "lesson_text":
            rec["lesson_origin"] = "session"
        out.append(rec)
    return out


def main(segments):
    rows = []
    for name in ("auditA_verdicts.jsonl", "auditB_verdicts.jsonl", "auditC_verdicts.jsonl"):
        for line in (AUDITS / name).read_text(encoding="utf-8").splitlines():
            if line.strip():
                rows.append((name, json.loads(line)))
    for seg in segments:
        path = CORR / f"{seg}.jsonl"
        done = set()
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    r = json.loads(line)
                    if r.get("audit"):
                        done.add(r["item_id"])
        new = []
        tally = Counter()
        for audit_file, row in rows:
            if row["segment"] != seg or row["item_id"] in done:
                continue
            recs = records_for(row, audit_file)
            tally[row["verdict"]] += 1
            new.extend(recs)
        if new:
            text = path.read_text(encoding="utf-8") if path.exists() else ""
            with open(path, "a", encoding="utf-8", newline="\n") as fh:
                if text and not text.endswith("\n"):
                    fh.write("\n")
                for rec in new:
                    fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        print(f"{seg}: {dict(tally)} -> {len(new)} records")


if __name__ == "__main__":
    main(sys.argv[1:])
