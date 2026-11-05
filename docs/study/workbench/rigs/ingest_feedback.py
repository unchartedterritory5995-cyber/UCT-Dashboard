"""Append new workbench feedback rows (verbatim) to docs/study/audits/2026-10-24/owner_verdicts.jsonl (CRLF on disk).

Shell v2 (2026-11-03): a row may carry `parts` (one rank 1..5 Cut/Weak/Okay/Good/Great per listed part of the page,
with optional words). The whole-piece row is written as before, and every ranked part becomes its own row
(pass "workbench-part") so a rank on "the pointer chip" is as durable as a score on the piece.
"""
import json, io
SRC = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study\walkthrough\feedback.jsonl"
DST = r"C:\Users\pgosz\uct-worktrees\study-hve-overlay\docs\study\audits\2026-10-24\owner_verdicts.jsonl"
s = io.open(DST, encoding="utf-8", newline="").read()
nl = "\r\n" if "\r\n" in s else "\n"
have = set()
for l in s.splitlines():
    if l.strip() and '"pass": "workbench' in l:
        r = json.loads(l); have.add((r.get("pass"), r.get("piece"), r.get("part"), r.get("owner_words"), r.get("score_100"), r.get("rank")))
rows = [json.loads(l) for l in open(SRC, encoding="utf-8") if l.strip()]
add, seen = [], set()
for r in rows:
    k = ("workbench", r["step"], None, r.get("note", ""), r.get("score"), None)
    if k not in seen and k not in have:
        seen.add(k)
        add.append({"pass": "workbench", "date": r["ts"][:10], "ts": r["ts"], "piece": r["step"], "title": r.get("title"), "batch": r.get("batch"),
                    "score_100": r.get("score"), "owner_words": r.get("note", ""), "by": "owner",
                    "parts_ranked": len(r.get("parts") or []),
                    "note": "local workbench (127.0.0.1:8793), one piece at a time; score out of 100"})
    for pt in r.get("parts") or []:
        kk = ("workbench-part", r["step"], pt.get("id"), pt.get("note", ""), None, pt.get("rank"))
        if kk in seen or kk in have: continue
        seen.add(kk)
        add.append({"pass": "workbench-part", "date": r["ts"][:10], "ts": r["ts"], "piece": r["step"], "title": r.get("title"), "batch": r.get("batch"),
                    "part": pt.get("id"), "part_label": pt.get("label"), "rank": pt.get("rank"), "rank_word": pt.get("rank_word"),
                    "owner_words": pt.get("note", ""), "by": "owner",
                    "note": "local workbench v2: one rank per listed part of the page (1 Cut, 2 Weak, 3 Okay, 4 Good, 5 Great)"})
if add:
    s = s.rstrip("\r\n") + nl + nl.join(json.dumps(a, ensure_ascii=False) for a in add) + nl
    io.open(DST, "w", encoding="utf-8", newline="").write(s)
print("appended", len(add))
